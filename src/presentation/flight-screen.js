import { MAX_LAUNCH_HEADING_DEGREES, WATER_RUNOUT_SECONDS } from '../domain/flight.js';
import { createRaceCommentary } from '../application/race-commentary.js';
import { launchCue } from '../application/launch-sequence.js';
import { FlightRecords } from '../application/flight-records.js';
import { showRecordBoard } from './record-board.js';
import { byId as $ } from './dom.js';
import { setupCaptions } from './captions.js';
import { setupReplay } from './replay.js';
import { bindPilotControls } from './pilot-controls.js';
import { aircraftCards, bindAircraftPicker } from './aircraft-picker.js';
import { updateWindMeter } from './wind-meter.js';

const colors = ['#b7441c', '#65489b', '#217547', '#bd3468', '#0567a5'];
const trialColor = (number) => colors[(number - 1) % colors.length];
const GO_CAPTION_SECONDS = 0.65;
const LANDING_CAMERA_DELAY_SECONDS = 2.5;
const SHORE_CHECK_SECONDS = 0.25;
const RULING_CAMERA_DELAY_MS = 800;
const RULING_REVEAL_MS = 2700;
const RECORD_REVEAL_DELAY_MS = 3500;

// FlightSession holds the history; only the current trial needs a visible trail.
export function selectedWeather() {
  const choice = name => document.querySelector('input[name="' + name + '"]:checked').value;
  return choice('period') + '-' + choice('difficulty');
}

export function setupTrials({
  session,
  aircraftPose,
  selectAircraft,
  crewTime,
  crewAnswer,
  makeTrail,
  setView,
  view,
  startLandingCamera,
  sceneSeconds,
  playSplash,
}) {
  const weatherControls = document.querySelectorAll('input[name="period"],input[name="difficulty"]');
  const records = new FlightRecords(() => window.localStorage);
  const renderWind = (s) => updateWindMeter(visibleWeather(), s);
  let latestRecord = null;
  let screen = 'setup';
  let active = null,
    atWater = false,
    review = null;
  const captions = setupCaptions();
  let countdown = null;
  let resultRecord = null;
  let landing = null, ruling = null;
  const releaseWaveTimes = new WeakMap();
  function stage(name) {
    stopHeading();
    if (name !== 'flight' && name !== 'countdown') tilt.end();
    screen = name;
    document.body.dataset.stage = screen;
    $('flight-settings').hidden = name !== 'setup';
    $('comparison').hidden = name !== 'result';
    $('replay-panel').hidden = name !== 'replay';
    $('align-panel').hidden = name !== 'align';
    $('launch-call').hidden = name !== 'countdown';
    $('wind-meter').hidden = !['align', 'countdown', 'flight', 'replay'].includes(name);
    $('flight-action').hidden = !(['align', 'countdown', 'flight'].includes(name) || (name === 'result' && resultRecord));
    $('flight-action').textContent = name === 'flight' ? '飛行を中断' : '準備に戻る';
    $('previous-result').hidden = !session.latest;
  }
  const { tilt, pilotInput, clearInput, releaseInput, advanceHeading, stopHeading } = bindPilotControls({
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
      aircraftPose.pose(s);
      record.trail.replayTo(record.run, s.t);
      renderWind(s);
    },
    onClose() {
      const prior = review;
      prior.record.trail.showContact(prior.record.run);
      aircraftPose.pose(prior.pose);
      review = null;
      stage('result');
      setView(prior.view);
      prior.button.focus({ preventScroll: true });
    },
  });
  function openReplay(record, button) {
    if (!record || active || review) return;
    captions.clear();
    review = { record, button, pose: aircraftPose.sample, view: view() };
    record.trail.setVisible(true);
    setView('pilot');
    stage('replay');
    replay.open(record);
  }
  $('result-replay').onclick = () => openReplay(resultRecord, $('result-replay'));

  function showResult(record) {
    resultRecord = record;
    announceResult({ kind: 'scored', run: record.run, score: records.forRun(record.run) });
  }
  function announceResult(outcome) {
    showRecordBoard(outcome);
    stage('result');
    $('result-heading').focus({ preventScroll: true });
  }
  function clearRuling() {
    ruling?.trail.dispose();
    ruling = null;
  }
  function prepare() {
    clearRuling();
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
    aircraftPose.pose(session.waterPose(previous.run, WATER_RUNOUT_SECONDS));
    atWater = true;
    previous.trail.setVisible(true);
    crewTime(Infinity);
    showResult(previous);
    setView('boat');
  };
  $('return-to-setup').onclick = prepare;
  $('retry').onclick = aim;
  function aim() {
    clearRuling();
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
    tilt.calibrate();
    countdown = { seconds: 0, last: performance.now() };
    stage('countdown');
    displayCall(launchCue(0, session.aircraftId));
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
    const side = cue.wing === 'left' ? '左' : cue.wing === 'right' ? '右' : '';
    $('call-speaker').textContent = side && side + (session.aircraftId === 'qx25' ? '側' : '翼');
    $('call-text').textContent = cue.label;
  }
  function start(now, elapsed) {
    const attempt = session.startAttempt();
    const color = trialColor(attempt.number);
    const record = {
      releaseWaveTime: sceneSeconds() + session.launch.duration - elapsed,
      label: '試技 ' + attempt.number,
      color,
      trail: makeTrail(null, color),
    };
    atWater = false;
    clearInput();
    active = { record, attempt, clock: elapsed, previousTime: now, airborne: false, nextShoreCheck: 0, shoreAhead: false, commentary: createRaceCommentary(attempt.number, aircraftCards[session.aircraftId].name) };
    stage('flight');
    $('viewer').focus({ preventScroll: true });
    tick(active.previousTime);
  }
  function finish(run) {
    if (!active) return;
    const { record, commentary } = active;
    record.run = run;
    releaseWaveTimes.set(run, record.releaseWaveTime);
    records.record(run);
    record.trail.extend(run.samples);
    latestRecord?.trail.dispose();
    latestRecord = record;
    record.trail.showContact(run);
    const last = run.samples.at(-1);
    aircraftPose.pose(last);
    playSplash(last);
    active = null;
    atWater = true;
    clearInput();
    stage('landing');
    captions.show(commentary.landing(run), 3200);
    landing = { record, start: performance.now(), boatAt: null };
  }
  function disqualify(sample, now) {
    const { trail } = active.record;
    trail.extend([...active.attempt.samples, sample]);
    ruling = { trail, samples: active.attempt.samples, stopTime: sample.t, start: now, cameraMoved: false };
    active = null;
    atWater = false;
    clearInput();
    captions.clear();
    aircraftPose.pose(sample);
    stage('ruling');
    captions.show('ああ、飛行禁止区域に入った！', RULING_REVEAL_MS);
  }
  function showRuling(now) {
    const elapsed = now - ruling.start;
    if (!ruling.cameraMoved && elapsed >= RULING_CAMERA_DELAY_MS) {
      ruling.cameraMoved = true;
      setView('boat');
    }
    if (elapsed < RULING_REVEAL_MS) return;
    captions.clear();
    announceResult({ kind: 'disqualified' });
  }
  function tick(now) {
    if (screen === 'ruling') {
      showRuling(now);
      return;
    }
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
      const cue = launchCue(countdown.seconds, session.aircraftId);
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
      aircraftPose.pose(floating);
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
    if (frame.phase === 'disqualified') {
      disqualify(frame.sample, now);
      return;
    }
    if (frame.phase === 'touchdown') {
      finish(frame.run);
      return;
    }
    const s = frame.sample;
    if (frame.phase === 'release' || frame.phase === 'glide') {
      record.trail.extend(attempt.samples);
      active.airborne = true;
      if (s.t >= active.nextShoreCheck) {
        active.shoreAhead = session.shoreAhead(s);
        active.nextShoreCheck = s.t + SHORE_CHECK_SECONDS;
      }
      const call = active.commentary.airborne(s, active.shoreAhead);
      if (call) captions.show(call, active.shoreAhead ? 6500 : 3000);
    }
    aircraftPose.pose(s);
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
  bindAircraftPicker(session.aircraftId, () => screen === 'setup', id => {
    ({ session, aircraftPose } = selectAircraft(id));
    changeConditions();
  });
  $('launch').onclick = aim;
  $('launch').disabled = false;
  stage('setup');
  return {
    tick,
    get showFlag() { return screen === 'align' || screen === 'countdown' || (active && !active.airborne); },
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
    boatRoute(now) {
      if (ruling) return { samples: ruling.samples, time: ruling.stopTime + (now - ruling.start) / 1000, stopTime: ruling.stopTime };
      if (active) return { samples: active.attempt.samples, time: active.clock - session.launch.duration };
      const run = review?.record.run ?? landing?.record.run ?? resultRecord?.run;
      if (!run) return {};
      const time = review ? replay.time : run.duration + (landing ? (now - landing.start) / 1000 : WATER_RUNOUT_SECONDS);
      return { samples: run.samples, time, stopTime: run.duration };
    },
    waveTime() {
      if (review) return releaseWaveTimes.get(review.record.run) + replay.time;
      if (active) return active.record.releaseWaveTime + active.clock - session.launch.duration;
      if (landing) return landing.record.releaseWaveTime + landing.record.run.duration + (performance.now() - landing.start) / 1000;
      return sceneSeconds();
    },
    get contactRun() {
      return landing?.record.run ?? review?.record.run;
    },
    contactAge(now) {
      if (landing) return Math.max(0, (now - landing.start) / 1000);
      if (review) return replay.time - review.record.run.duration;
      return -1;
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
