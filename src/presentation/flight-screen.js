import { MAX_LAUNCH_HEADING_DEGREES, WATER_RUNOUT_SECONDS } from '../domain/flight.js';
import { shouldCallForLanding } from '../domain/runway-support.js';
import { navigation, reserveCapacityJ } from '../domain/ren-practice.js';
import { createRaceCommentary } from '../application/race-commentary.js';
import { launchCue } from '../application/launch-sequence.js';
import { FlightRecords } from '../application/flight-records.js';
import { showRecordBoard } from './record-board.js';
import { byId as $ } from './dom.js';
import { setupCaptions } from './captions.js';
import { setupReplay } from './replay.js';
import { bindPedalControls } from './pedal-controls.js';
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
  selectAircraft, loadField, useField, drawWindOffset,
  crewTime,
  crewAnswer,
  distanceToBoat,
  makeTrail,
  setView,
  view,
  startLandingCamera,
  sceneSeconds,
  playSplash, soundHorn,
}) {
  const weatherControls = document.querySelectorAll('input[name="period"],input[name="difficulty"]');
  const records = new FlightRecords(() => window.localStorage);
  const renderWind = (s) => updateWindMeter(visibleWeather(), s);
  let latestRecord = null;
  let screen = 'setup';
  let field, runway, runwayWeather, runwayFlight, venueVersion = 0;
  let active = null,
    atWater = false,
    review = null;
  const captions = setupCaptions();
  const advanceToInputTime = () => tick(performance.now());
  const pedals = bindPedalControls(advanceToInputTime);
  let countdown = null;
  let resultRecord = null;
  let landing = null, ruling = null;
  const releaseWaveTimes = new WeakMap();
  function stage(name) {
    stopHeading();
    if (name !== 'flight' && name !== 'countdown') tilt.end();
    screen = name;
    if (name !== 'setup') $('loading').hidden = true;
    if (name !== 'flight') pedals.setActive(false);
    document.body.dataset.stage = screen;
    $('flight-settings').hidden = name !== 'setup';
    $('comparison').hidden = name !== 'result';
    $('replay-panel').hidden = name !== 'replay';
    $('align-panel').hidden = name !== 'align';
    $('launch-call').hidden = name !== 'countdown';
    $('wind-meter').hidden = !['align', 'countdown', 'flight', 'replay'].includes(name);
    $('flight-action').hidden = !(['align', 'countdown', 'flight'].includes(name) || (name === 'result' && resultRecord));
    $('flight-action').textContent = name === 'flight' ? '飛行を中断' : '準備に戻る';
    $('previous-result').hidden = Boolean(field) || !session.latest;
  }
  const { tilt, pilotInput, clearInput, releaseInput, advanceHeading, stopHeading } = bindPilotControls({
    isFlying: () => Boolean(active || runwayFlight),
    isAiming: () => screen === 'align',
    view,
    readHeading: () => session.launch.direction,
    setHeading,
    confirmHeading,
    advanceToInputTime,
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
    if (runwayFlight) runwayFlight.last = performance.now();
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
    if (field) {
      runwayFlight = null;
      clearInput();
      captions.clear();
      resetRunway();
      setView('aircraft');
      stage('setup');
      document.querySelector('.setup-title').focus({ preventScroll: true });
      return;
    }
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
    if (field) {
      tilt.prepare();
      resetRunway();
      clearInput();
      beginCountdown();
      setView(view());
      updateWindMeter(runwayWeather, runway.onGround);
      return;
    }
    clearRuling();
    resultRecord = null;
    tilt.prepare();
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
    beginCountdown();
  }
  function beginCountdown() {
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
    if (field) {
      runwayFlight = { seconds: elapsed, last: now, phase: 'roll', showCockpitAtLift: view() === 'aircraft',
        liftCallAt: null, releaseCalled: false, landingCalled: false };
      stage('flight');
      pedals.setActive(true, 300);
      flyRunway(now);
      return;
    }
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
    active = { record, attempt, clock: elapsed, previousTime: now, airborne: false, nextRadio: 0, lastBuoy: 0, nextShoreCheck: 0, shoreAhead: false, commentary: createRaceCommentary(attempt.number, aircraftCards[session.aircraftId].name) };
    stage('flight');
    pedals.setActive(session.aircraftId === 'ren');
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
  function stopAttempt(sample, now, reason) {
    const { trail } = active.record;
    trail.extend([...active.attempt.samples, sample]);
    ruling = { wreckAt: reason === 'structural-failure' && session.aircraftId === 'ren' ? active.attempt.wreckAt : null, outcome: { kind: reason, side: sample.wing?.failedSide }, trail, samples: active.attempt.samples, stopTime: sample.t, start: now, cameraMoved: false };
    active = null;
    atWater = false;
    clearInput();
    captions.clear();
    aircraftPose.pose(sample);
    stage('ruling');
    const side = { left: '左の主翼', right: '右の主翼', both: '両翼' }[sample.wing?.failedSide];
    captions.show(reason === 'structural-failure' ? side + 'が折れた！' : reason === 'platform-contact' ? '機体がプラットフォームに接触！' : 'ああ、飛行禁止区域に入った！', RULING_REVEAL_MS);
  }
  function showRuling(now) {
    const elapsed = now - ruling.start;
    let wreck;
    if (ruling.wreckAt) {
      wreck = ruling.wreckAt(elapsed / 1000);
      if (wreck.water && !atWater) {
        playSplash(wreck.sample);
        atWater = true;
      }
      aircraftPose.pose(wreck.water ? session.waterPose(wreck.water, elapsed/1000 + ruling.stopTime - wreck.water.duration) : wreck.sample);
    }
    if (!ruling.cameraMoved && elapsed >= RULING_CAMERA_DELAY_MS) {
      ruling.cameraMoved = true;
      setView('boat');
    }
    // Let the actual water entry play before the result covers any of it.
    if (wreck?.water && elapsed / 1000 + ruling.stopTime - wreck.water.duration < WATER_RUNOUT_SECONDS) return;
    if (elapsed < RULING_REVEAL_MS || (wreck && !wreck.water && !wreck.blocked && elapsed < 10000)) return;
    captions.clear();
    announceResult(ruling.outcome);
  }
  function boatAdvice(s) {
    const passed = s.courseLeg > active.lastBuoy;
    if (s.t < active.nextRadio && !passed) return '';
    const target = navigation(s);
    if (!target && !passed) return '';
    if (distanceToBoat(s) > 180) return '';
    active.lastBuoy = s.courseLeg;
    active.nextRadio = s.t + 10;
    active.radioUntil = s.t + 4.2;
    if (!target) return '3番通過、完走！ ' + s.courseTime.toFixed(1) + '秒。ここからは自由飛行です。';
    if (passed) return 'ブイ通過！ 次は' + target.number + '番、' + Math.round(target.metres) + 'メートル。';
    if (s.reserve < reserveCapacityJ * .2) return '脚の余力が少ない。一度ペースを落とそう。';
    const degrees = Math.round(Math.abs(target.correction) * 180 / Math.PI);
    if (degrees > 12) {
      const drift = Math.atan2(Math.sin(s.track - s.heading), Math.cos(s.track - s.heading));
      const lead = Math.abs(drift) > .12 ? (drift < 0 ? '左' : '右') + 'に流れてる。' : '';
      return lead + target.number + '番は進行方向の' + (target.correction < 0 ? '左' : '右') + degrees + '度。';
    }
    return target.number + '番まで' + Math.round(target.metres) + 'メートル、その進路で。';
  }
  function flyRunway(now) {
    const flight = runwayFlight;
    if (!document.hidden && !$('source-dialog').open) flight.seconds += Math.max(0, now - flight.last) / 1000;
    flight.last = Math.max(now, flight.last);
    $('launch-call').hidden = flight.seconds >= GO_CAPTION_SECONDS;
    const frame = runway.advance(flight.seconds, pilotInput(), pilotInput(2), pedals.watts);
    field.pose(frame.sample, frame.phase, flight.seconds);
    updateWindMeter(runwayWeather, frame.sample);
    const onApproach = frame.phase === 'flight' || frame.phase === 'rollout';
    if (onApproach && frame.sample.liftOffAt != null && flight.liftCallAt === null) {
      flight.liftCallAt = flight.seconds;
      if (frame.phase === 'flight' && flight.showCockpitAtLift) setView('pilot');
      captions.show('浮いた！', 2000, 'フォロワー');
    } else if (onApproach && field.wingFollowersReleased && !flight.releaseCalled && !flight.landingCalled &&
               flight.seconds - flight.liftCallAt >= .75) {
      flight.releaseCalled = true;
      captions.show('離した！', 2000, 'フォロワー');
    }
    if (frame.phase === 'flight' && !flight.landingCalled &&
        shouldCallForLanding(frame.sample, field.facility.userData.runway.length)) {
      flight.landingCalled = true;
      soundHorn();
      captions.show('減速ー！', 4200, '追走車・設計者');
    }
    if (frame.phase === flight.phase) return;
    flight.phase = frame.phase;
    if (frame.phase === 'rollout') {
      pedals.setActive(false);
    } else if (frame.phase === 'landed' || frame.phase === 'aborted') {
      runwayFlight = null;
      clearInput();
      captions.clear();
      stage('result');
      $('record-board').dataset.outcome = frame.phase;
      $('record-board').dataset.highlight = '';
      $('result-heading').textContent = frame.phase === 'landed' ? '着陸完了' : '地上試験終了';
      $('result-score').hidden = true;
      const outcome = { 'off-runway': '試験飛行エリアを外れました', 'ground-strike': '機体が地面に接触しました',
        'structural-failure': '主翼が破断しました' }[frame.reason] ?? (frame.onPavement ? '滑走路上で停止しました' : '路肩で停止しました');
      $('record-detail').textContent = outcome + '。南端から ' + Math.round(frame.sample.forward) + ' m。';
      for (const id of ['record-official', 'result-replay', 'share-result']) $(id).hidden = true;
      $('return-to-setup').hidden = false;
      $('result-heading').focus({ preventScroll: true });
    }
  }
  function tick(now) {
    if (field && !countdown) {
      if (runwayFlight) flyRunway(now);
      return;
    }
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
      if (field) {
        field.pose(runway.onGroundAt(cue.spinSeconds), 'countdown', 0);
        field.answer(cue.wing, cue.elapsed);
      } else {
        if (session.aircraftId === 'ren') aircraftPose.pose(session.onDeckAt(cue.spinSeconds));
        crewAnswer(cue.wing, cue.elapsed);
      }
      displayCall(cue);
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
    const frame = attempt.advance(active.clock, pilotInput(), pilotInput(2), pedals.watts);
    if (['disqualified', 'structural-failure', 'platform-contact'].includes(frame.phase)) {
      stopAttempt(frame.sample, now, frame.phase);
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
      const radio = session.aircraftId === 'ren' && !active.shoreAhead && boatAdvice(s);
      if (radio) captions.show(radio, 4200, '伴走艇');
      else if (call && (active.shoreAhead || s.t >= (active.radioUntil ?? 0))) captions.show(call, active.shoreAhead ? 6500 : 3000);
    }
    aircraftPose.pose(s);
    renderWind(s);
  }
  aircraftPose.placeOnDeck(session.launch, session.onDeck);
  function resetRunway() {
    runwayWeather = selectedWeather();
    document.body.dataset.period = runwayWeather.split('-')[0];
    field.setWeather(runwayWeather);
    runway = field.trial(runwayWeather, drawWindOffset());
    field.pose(runway.onGround);
    $('previous-result').hidden = true;
  }
  function changeConditions(direction = session.launch.direction) {
    if (field) return resetRunway();
    latestRecord?.trail.dispose();
    latestRecord = null;
    session.select(selectedWeather(), direction);
    renderWind(session.onDeck);
    aircraftPose.placeOnDeck(session.launch, session.onDeck);
    $('previous-result').hidden = Boolean(field) || !session.latest;
  }
  for (const control of weatherControls) {
    control.addEventListener('change', () => changeConditions());
  }
  $('flight-action').onclick = () => {
    if (field || !active) {
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
  const venueControls = [...document.querySelectorAll('input[name="venue"]')];
  function activateVenue(next) {
    field = next;
    const onRunway = Boolean(field);
    const camera = $('observer-camera');
    camera.dataset.view = onRunway ? 'car' : 'boat';
    camera.textContent = onRunway ? '追走車' : 'ボート';
    $('venue-caption').textContent = onRunway ? '静岡・富士川滑空場' : '彦根・松原湖岸';
    $('map-credit').textContent = onRunway ? '写真・標高：国土地理院（加工）' : '地形・写真・水域：国土地理院／国土数値情報';
    $('ambient-description').textContent = onRunway ? 'タイヤの転がる音、追走車のエンジンとクラクション、風切り音' : '波、風切り音、助走、着水、追走艇';
    $('result-score').hidden = false;
    useField(next);
  }
  $('map-credit').addEventListener('click', () => {
    if (field) $('fujikawa-sources').scrollIntoView({ block: 'start' });
  });
  async function chooseVenue() {
    const version = ++venueVersion;
    const selected = venueControls.find(option => option.checked).value;
    const loading = $('loading');
    $('launch').disabled = true;
    let next;
    if (selected === 'fujikawa') {
      loading.textContent = '富士川滑空場を読み込み中…';
      loading.hidden = false;
      try {
        next = await loadField();
      } catch (error) {
        if (version !== venueVersion) return;
        console.error(error);
        loading.textContent = '富士川滑空場を読み込めませんでした。もう一度会場を選んでください。';
        venueControls[0].checked = true;
        $('launch').disabled = false;
        return;
      }
    }
    if (version !== venueVersion) return;
    activateVenue(next);
    if (field) resetRunway();
    else if (session.weather !== selectedWeather()) changeConditions();
    else {
      aircraftPose.placeOnDeck(session.launch, session.onDeck);
      $('previous-result').hidden = !session.latest;
    }
    loading.hidden = true;
    $('launch').disabled = false;
  }
  for (const control of venueControls) control.onchange = chooseVenue;
  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => { if (runwayFlight) runwayFlight.showCockpitAtLift = false; });
  }
  bindAircraftPicker(session.aircraftId, () => screen === 'setup', async id => {
    venueVersion++;
    const loading = $('loading'), venues = $('venue-choices');
    venueControls[field ? 1 : 0].checked = true;
    venues.disabled = $('launch').disabled = $('previous-result').disabled = true;
    loading.textContent = aircraftCards[id].name + 'を読み込み中…';
    loading.hidden = false;
    try {
      const entry = await selectAircraft(id);
      if (field) activateVenue(null);
      ({ session, aircraftPose } = entry);
      venueControls[0].checked = true;
      venues.hidden = id !== 'ren';
      changeConditions();
      loading.hidden = true;
      return true;
    } catch (error) {
      console.error(error);
      loading.textContent = aircraftCards[id].name + 'を読み込めませんでした。もう一度機体を選んでください。';
      return false;
    } finally {
      venues.disabled = $('launch').disabled = $('previous-result').disabled = false;
    }
  });
  $('launch').onclick = aim;
  $('launch').disabled = false;
  stage('setup');
  return {
    tick,
    get showFlag() { return screen === 'align' || screen === 'countdown' || (active && !active.airborne); },
    get soundPhase() {
      if (field) return runwayFlight?.phase === 'flight' ? 'glide' : runwayFlight ? 'run' : screen;
      if (review) return replay.playing ? (replay.time < review.record.run.duration ? 'glide' : 'landing') : 'paused';
      if (active) return active.airborne ? 'glide' : 'run';
      return screen;
    },
    get weather() {
      return visibleWeather();
    },
    get cameraAtWater() {
      return !field && (review ? replay.time >= review.record.run.duration : atWater);
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
