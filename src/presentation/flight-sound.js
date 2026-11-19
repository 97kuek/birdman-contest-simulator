import { byId } from './dom.js';

const PREFS_KEY = 'ryukai.sound.v1';
const AUDIBLE_PHASES = new Set(['align', 'countdown', 'run', 'glide', 'landing', 'result']);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function mixer(context) {
  function gain(destination, value = 0) {
    const node = context.createGain();
    node.gain.value = value;
    node.connect(destination);
    return node;
  }
  const ambience = gain(context.destination), instruments = gain(context.destination);
  const shore = gain(ambience), wind = gain(ambience), motor = gain(ambience);
  const footsteps = gain(ambience);
  const runners = [-1, 0, 1].map(side => {
    const pan = context.createStereoPanner();
    pan.pan.value = side * 0.55;
    pan.connect(footsteps);
    return pan;
  });
  let outboard, lastRate;
  const parameters = new Map();
  function level(node, value) {
    if (parameters.get(node) === value) return;
    parameters.set(node, value);
    const now = context.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(value, now, 0.018);
  }

  const recordings = new Map(), pending = new Set();
  function play(buffer, destination, loop = false, volume = 1, offset = 0, duration) {
    const player = context.createBufferSource();
    const envelope = gain(destination, volume);
    player.buffer = buffer;
    player.loop = loop;
    player.connect(envelope);
    player.onended = () => { player.disconnect(); envelope.disconnect(); };
    player.start(0, offset, duration);
    return player;
  }
  function load(name) {
    if (recordings.has(name) || pending.has(name)) return;
    pending.add(name);
    fetch('./sound/' + name + '.mp3').then(response => {
      if (!response.ok) throw new Error(response.statusText);
      return response.arrayBuffer();
    }).then(bytes => context.decodeAudioData(bytes)).then(buffer => {
      recordings.set(name, buffer);
      if (name === 'outboard') outboard = play(buffer, motor, true);
      if (name === 'shore') play(buffer, shore, true);
    }).catch(() => { /* A missing recording must not interrupt piloting. */ })
      .finally(() => pending.delete(name));
  }

  let windReady = false;
  function prepareAmbience() {
    for (const name of ['shore', 'deck-run', 'splash', 'outboard']) load(name);
    if (windReady) return;
    windReady = true;
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let filtered = 0;
    for (let i = 0; i < samples.length; i++) {
      filtered = 0.94 * filtered + 0.06 * (2 * Math.random() - 1);
      samples[i] = filtered;
    }
    play(buffer, wind, true);
  }

  return {
    prepareAmbience,
    enable(environment, electronic, running = false) {
      level(footsteps, environment && running ? 1 : 0);
      level(ambience, environment ? 1 : 0);
      level(instruments, electronic ? 1 : 0);
    },
    surroundings(height, distance, speed, cockpit, boatRange, boatSpeed) {
      const throttle = clamp(boatSpeed / 8, 0, 1);
      level(motor, (0.72 + 0.28 * throttle) / (1 + boatRange / 12));
      const rate = Math.round(88 + 14 * throttle) / 100;
      if (outboard && rate !== lastRate) {
        outboard.playbackRate.setTargetAtTime(rate, context.currentTime, .16);
        lastRate = rate;
      }
      level(shore, 0.30 / (1 + height / 7 + distance / 85));
      level(wind, Math.round(clamp(speed / 13, 0, 1) ** 2 * (cockpit ? 36 : 16)) / 100);
    },
    footfall(side, contact, view) {
      const buffer = recordings.get('deck-run');
      if (!buffer) return;
      // Eight different shoe contacts cut from one run, 320 ms per contact.
      const clip = (contact + (side + 1) * 3) % 8;
      const distanceGain = view === 'boat' ? 0.16 : view === 'pilot' ? 1 : 0.58;
      const volume = (side === 0 ? 0.95 : 0.29) * distanceGain;
      play(buffer, runners[side + 1], false, volume, clip * 0.32, 0.32);
    },
    effect(name, volume) {
      if (recordings.has(name)) play(recordings.get(name), ambience, false, volume);
    },
    pulse(hz) {
      const signal = context.createOscillator();
      const envelope = gain(instruments);
      const now = context.currentTime;
      signal.frequency.value = hz;
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(0.065, now + 0.006);
      envelope.gain.linearRampToValueAtTime(0, now + 0.06);
      signal.connect(envelope);
      signal.onended = () => { signal.disconnect(); envelope.disconnect(); };
      signal.start(now);
      signal.stop(now + 0.061);
    },
  };
}

export function setupFlightSound() {
  const instrument = byId('instrument-audio'), environment = byId('environment-audio');
  const settings = byId('sound-settings'), dialog = byId('source-dialog');
  const Audio = window.AudioContext ?? window.webkitAudioContext;
  if (!Audio) settings.hidden = true;
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY));
    instrument.checked = saved?.instrument ?? true;
    environment.checked = saved?.environment ?? true;
  } catch { /* Storage is optional in private browsing. */ }

  let context, mix, phase, lastPulse = -Infinity;
  function available() {
    return !document.hidden && !dialog.open;
  }
  function gates(cockpit) {
    const audible = available() && AUDIBLE_PHASES.has(phase);
    mix?.enable(audible && environment.checked, audible && cockpit && instrument.checked && phase === 'glide', phase === 'run');
  }
  function unlock() {
    if (!Audio || (!environment.checked && !instrument.checked)) return;
    context ??= new Audio();
    mix ??= mixer(context);
    if (context.state !== 'running') context.resume().catch(() => {});
    if (environment.checked) mix.prepareAmbience();
  }
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', unlock);
  for (const id of ['previous-result', 'launch', 'retry', 'result-replay', 'confirm-heading', 'replay-play']) {
    byId(id).addEventListener('click', unlock);
  }
  function reflectPreferences() {
    settings.dataset.muted = String(!instrument.checked && !environment.checked);
  }
  for (const control of [instrument, environment]) control.onchange = () => {
    reflectPreferences();
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ instrument: instrument.checked, environment: environment.checked }));
    } catch { /* Settings still apply for this visit. */ }
    unlock();
    gates(document.body.dataset.camera === 'pilot');
  };
  reflectPreferences();
  const silence = () => { mix?.enable(false, false); lastPulse = -Infinity; };
  document.addEventListener('visibilitychange', silence);
  window.addEventListener('pagehide', silence);
  new MutationObserver(() => { if (dialog.open) silence(); }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  return {
    update(nextPhase, sample, reading, view, boatRange, boatSpeed) {
      const cockpit = view === 'pilot';
      if (nextPhase === 'setup' && view === 'boat') nextPhase = 'align';
      if (phase !== nextPhase) lastPulse = -Infinity;
      phase = nextPhase;
      if (!mix || !sample) return;
      gates(cockpit);
      if (!available() || !AUDIBLE_PHASES.has(phase) || context.state !== 'running') return;
      if (environment.checked) {
        mix.surroundings(sample.bottomHeight, sample.distance ?? 0, reading.airspeed, cockpit, boatRange, boatSpeed);
      }
      if (phase === 'glide' && cockpit && instrument.checked && reading.toneHz) {
        if (sample.t < lastPulse || sample.t - lastPulse >= reading.intervalSeconds) {
          mix.pulse(reading.toneHz);
          lastPulse = sample.t;
        }
      } else lastPulse = -Infinity;
    },
    step(side, contact, view) {
      if (phase === 'run' && available() && environment.checked && context?.state === 'running')
        mix.footfall(side, contact, view);
    },
    splash(sample) {
      if (available() && environment.checked && context?.state === 'running')
        mix.effect('splash', clamp(0.84 + Math.abs(sample.verticalSpeed) * 0.16, 0.84, 1));
    },
  };
}
