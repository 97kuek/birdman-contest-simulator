import { MAX_LAUNCH_HEADING_DEGREES, WATER_RUNOUT_SECONDS } from '../domain/flight.js';
import { launchCue } from '../application/launch-sequence.js';
import { byId as $ } from './dom.js';
import { setupCaptions } from './captions.js';
import { setupReplay } from './replay.js';
import { bindPilotControls } from './pilot-controls.js';
import { updateWindMeter } from './wind-meter.js';

const colors = ['#b7441c', '#65489b', '#217547', '#bd3468', '#0567a5'];
const trialColor = (number) => colors[(number - 1) % colors.length];
const GO_CAPTION_SECONDS = 0.65;
const LANDING_CAMERA_DELAY_SECONDS = 3.0;
const RECORD_REVEAL_DELAY_MS = 5000;

// FlightSession holds the history; only the current trial needs a visible trail.
export function selectedWeather() {
  const choice = name => document.querySelector('input[name="' + name + '"]:checked').value;
  return choice('period') + '-' + choice('difficulty');
}

export function setupTrials({
  session,
  aircraftPose,
  crewTime,
  crewAnswer,
  makeTrail,
  setView,
  view,
  startLandingCamera,
  onWaterContact,
  playSplash,
}) {
  const weatherControls = document.querySelectorAll('input[name="period"],input[name="difficulty"]');
  const { pose } = aircraftPose;
  const renderWind = (s) => updateWindMeter(visibleWeather(), s);
  let latestRecord = null;
  let screen = 'setup';
  let active = null,
    atWater = false,
    review = null;
  const captions = setupCaptions();
  let countdown = null;
  let resultRecord = null;
  let landing = null;
  function stage(name) {
    stopHeading();
    screen = name;
    document.body.dataset.stage = screen;
    $('flight-settings').hidden = name !== 'setup';
    $('comparison').hidden = name !== 'result';
    $('replay-panel').hidden = name !== 'replay';
    $('align-panel').hidden = name !== 'align';
    $('launch-call').hidden = name !== 'countdown';
    $('wind-meter').hidden = !['align', 'countdown', 'flight', 'replay'].includes(name);
    $('flight-action').hidden = !['align', 'countdown', 'flight'].includes(name);
    $('flight-action').textContent = name === 'flight' ? '飛行を中断' : '準備に戻る';
    $('previous-result').hidden = !session.latest;
  }
  const { pilotInput, clearInput, releaseInput, advanceHeading, stopHeading } = bindPilotControls({
    isFlying: () => Boolean(active),
    isAiming: () => screen === 'align',
    view,
    readHeading: () => session.launch.direction,
    setHeading,
    confirmHeading,
    advanceToInputTime: () => tick(performance.now()),
  });
  function setHeading(value) {
    const angle = Math.max(-MAX_LAUNCH_HEADING_DEGREES, Math.min(MAX_LAUNCH_HEADING_DEGREES, value));
    if (angle === session.launch.direction) return;
    changeConditions(angle);
    $('direction-left').disabled = session.launch.direction === -MAX_LAUNCH_HEADING_DEGREES;
    $('direction-right').disabled = session.launch.direction === MAX_LAUNCH_HEADING_DEGREES;
  }
  function resetCaptionClock() {
    if (countdown) countdown.last = performance.now();
    if (document.hidden || $('source-dialog').open) {
      releaseInput();
      captions.clear();
    }
  }
  new MutationObserver(resetCaptionClock).observe($('source-dialog'), {
    attributes: true,
    attributeFilter: ['open'],
  });
  document.addEventListener('visibilitychange', () => {
    resetCaptionClock();
    if (active) active.previousTime = performance.now();
  });
  const replay = setupReplay({
    playSplash,
    showPose(s, afterContact) {
      const { record } = review;
      if (afterContact > 0) s = session.waterPose(record.run, afterContact);
      pose(s);
      record.trail.replayTo(record.run, s.t);
      renderWind(s);
    },
    onClose() {
      const prior = review;
      prior.record.trail.showContact(prior.record.run);
      aircraftPose.restore(prior.pose);
      review = null;
      stage('result');
      setView(prior.view);
      prior.button.focus({ preventScroll: true });
    },
  });
  function openReplay(record, button) {
    if (!record || active || review) return;
    captions.clear();
    review = { record, button, pose: aircraftPose.capture(), view: view() };
    record.trail.setVisible(true);
    setView('pilot');
    stage('replay');
    replay.open(record, session.referenceFor(record.run));
  }
  $('result-replay').onclick = () => openReplay(resultRecord, $('result-replay'));

  function showResult(record) {
    resultRecord = record;
    $('result-distance').textContent = record.run.distance.toFixed(2);
    const share = new URL('https://twitter.com/intent/tweet');
    share.searchParams.set('text', '竜海で ' + record.run.distance.toFixed(2) + ' m 飛びました！ #鳥人間コンテストシミュレーター');
    share.searchParams.set('url', 'https://97kuek.github.io/birdman-contest-simulator/');
    $('share-result').href = share.href;
    stage('result');
    $('result-heading').focus({ preventScroll: true });
  }
  function prepare() {
    captions.clear();
    crewAnswer('', 0);
    atWater = false;
    latestRecord?.trail.setVisible(false);
    resultRecord = null;
    aircraftPose.placeOnDeck(session.launch, session.onDeck);
    setView('aircraft');
    stage('setup');
    document.querySelector('.setup-title').focus({ preventScroll: true });
  }
  $('previous-result').onclick = () => {
    let previous = latestRecord;
    if (!previous) {
      const saved = session.latest;
      const color = trialColor(saved.number);
      previous = {
        ...saved,
        label: '試技 ' + saved.number,
        color,
        trail: makeTrail(saved.run, color),
      };
      latestRecord = previous;
    }
    pose(session.waterPose(previous.run, WATER_RUNOUT_SECONDS));
    atWater = true;
    previous.trail.setVisible(true);
    crewTime(Infinity);
    showResult(previous);
    setView('boat');
  };
  $('retry').onclick = () => {
    aim();
  };
  function aim() {
    resultRecord = null;
    session.prepareAttempt();
    latestRecord?.trail.setVisible(false);
    atWater = false;
    aircraftPose.placeOnDeck(session.launch, session.onDeck);
    stage('align');
    captions.clear();
    setView('pilot');
    renderWind(session.onDeck);
    $('viewer').focus({ preventScroll: true });
  }
  function confirmHeading() {
    if (screen !== 'align') return;
    advanceHeading(performance.now());
    countdown = { seconds: 0, last: performance.now() };
    stage('countdown');
    displayCall(launchCue(0));
    $('launch-call').classList.remove('go');
    captions.clear();
    $('viewer').focus({ preventScroll: true });
  }
  $('confirm-heading').onclick = confirmHeading;
  function displayCall(cue) {
    const call = $('launch-call');
    if ($('call-text').textContent === cue.label && call.dataset.wing === cue.wing) return;
    call.dataset.wing = cue.wing;
    $('call-speaker').hidden = !cue.wing;
    $('call-speaker').textContent = cue.wing === 'left' ? '左翼' : cue.wing === 'right' ? '右翼' : '';
    $('call-text').textContent = cue.label;
  }
  function start(now, elapsed) {
    const attempt = session.startAttempt();
    const color = trialColor(attempt.number);
    const record = {
      label: '試技 ' + attempt.number,
      color,
      trail: makeTrail(null, color),
    };
    atWater = false;
    clearInput();
    active = { record, attempt, clock: elapsed, previousTime: now, airborne: false, distanceCall: 0 };
    stage('flight');
    $('viewer').focus({ preventScroll: true });
    tick(active.previousTime);
  }
  function finish(run) {
    if (!active) return;
    const { record } = active;
    record.run = run;
    record.trail.extend(run.samples);
    latestRecord?.trail.dispose();
    latestRecord = record;
    record.trail.showContact(run);
    const last = run.samples.at(-1);
    pose(last);
    playSplash(last);
    onWaterContact?.(run.contactRight, run.contactForward, last);
    active = null;
    atWater = true;
    clearInput();
    stage('landing');
    captions.show('竜海、ここで着水です！', 3900);
    landing = { record, start: performance.now(), boatAt: null };
  }
  function tick(now) {
    if (screen === 'align') {
      advanceHeading(now);
      return;
    }
    if (review) {
      replay.tick(now);
      return;
    }
    if (countdown) {
      if (!document.hidden && !$('source-dialog').open)
        countdown.seconds += Math.max(0, now - countdown.last) / 1000;
      countdown.last = Math.max(now, countdown.last);
      const cue = launchCue(countdown.seconds);
      displayCall(cue);
      crewAnswer(cue.wing, cue.elapsed);
      if (cue.go) {
        countdown = null;
        $('launch-call').classList.add('go');
        start(now, cue.elapsed);
      }
      return;
    }
    if (landing) {
      const { record } = landing;
      const seconds = (now - landing.start) / 1000;
      const floating = session.waterPose(record.run, seconds);
      pose(floating);
      if (seconds >= LANDING_CAMERA_DELAY_SECONDS && landing.boatAt === null) {
        startLandingCamera();
        landing.boatAt = now;
      }
      if (landing.boatAt === null || now - landing.boatAt < RECORD_REVEAL_DELAY_MS) return;
      landing = null;
      showResult(record);
      return;
    }
    if (!active) return;
    const elapsed = Math.max(0, now - active.previousTime) / 1000;
    if (!document.hidden) active.clock += elapsed;
    active.previousTime = Math.max(now, active.previousTime);
    crewTime(active.clock);
    const { record, attempt } = active;
    $('launch-call').hidden = active.clock >= GO_CAPTION_SECONDS;
    const frame = attempt.advance(active.clock, pilotInput(), pilotInput(2));
    if (frame.phase === 'touchdown') {
      finish(frame.run);
      return;
    }
    const s = frame.sample;
    if (frame.phase === 'release' || frame.phase === 'glide') {
      record.trail.extend(attempt.samples);
      const mark = Math.min(400, Math.floor(s.distance / 100) * 100);
      if (!active.airborne) {
        active.airborne = true;
        captions.show('竜海、飛び出した！');
      } else if (mark > active.distanceCall) {
        active.distanceCall = mark;
        captions.show(mark + 'メートルを越えてきました！');
      }
    }
    pose(s);
    renderWind(s);
  }
  aircraftPose.placeOnDeck(session.launch, session.onDeck);
  function changeConditions(direction = session.launch.direction) {
    latestRecord?.trail.dispose();
    latestRecord = null;
    session.select(selectedWeather(), direction);
    renderWind(session.onDeck);
    aircraftPose.placeOnDeck(session.launch, session.onDeck);
    $('previous-result').hidden = !session.latest;
  }
  for (const control of weatherControls) {
    control.addEventListener('change', () => changeConditions());
  }
  $('flight-action').onclick = () => {
    if (!active) {
      countdown = null;
      prepare();
      return;
    }
    active.record.trail.dispose();
    active = null;
    clearInput();
    prepare();
  };
  function visibleWeather() {
    return review?.record.run.weather ?? resultRecord?.run.weather ?? session.weather;
  }
  $('launch').onclick = aim;
  $('launch').disabled = false;
  stage('setup');
  return {
    tick,
    get soundPhase() {
      if (review) return replay.playing ? (replay.time < review.record.run.duration ? 'glide' : 'landing') : 'paused';
      if (active) return active.airborne ? 'glide' : 'run';
      return screen;
    },
    get weather() {
      return visibleWeather();
    },
    get atWater() {
      return atWater && !review;
    },
    get weatherTime() {
      return review ? replay.time : active ? Math.max(0, active.clock - session.launch.duration) : null;
    },
    get trackBounds() {
      const bounds = { left: 0, right: 0, near: 0, far: 0 };
      for (const s of latestRecord?.run.samples ?? []) {
        bounds.left = Math.min(bounds.left, s.right);
        bounds.right = Math.max(bounds.right, s.right);
        bounds.near = Math.min(bounds.near, s.forward);
        bounds.far = Math.max(bounds.far, s.forward);
      }
      return bounds;
    },
  };
}
