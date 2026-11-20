import { poseAt, WATER_RUNOUT_SECONDS } from '../domain/flight.js';

import { aircraftCards } from './aircraft-picker.js';
import { byId } from './dom.js';

export function setupReplay({ showPose, onClose, playSplash }) {
  const panel = byId('replay-panel'),
    play = byId('replay-play'),
    seek = byId('replay-seek'),
    speed = byId('replay-speed');
  const rates = [1, 2, 0.5];
  let endTime = 0,
    rateIndex = 0,
    run = null,
    time = 0,
    last = 0,
    playing = false;
  function setRate(index) {
    rateIndex = index;
    speed.textContent = rates[index] + '×';
    speed.title = '再生速度 ' + rates[index] + '倍（押すと' + rates[(index + 1) % rates.length] + '倍）';
    speed.setAttribute('aria-label', speed.title);
  }
  speed.onclick = () => {
    tick(performance.now());
    setRate((rateIndex + 1) % rates.length);
  };
  function display() {
    seek.value = String(time);
    byId('replay-time').textContent = time.toFixed(2) + ' / ' + endTime.toFixed(2) + ' s';
    showPose(poseAt(run, Math.min(run.duration, time)), Math.max(0, time - run.duration));
    play.dataset.state = playing ? 'pause' : time >= endTime ? 'restart' : 'play';
    play.title = playing ? '一時停止' : time >= endTime ? '最初から再生' : '再生';
    play.setAttribute('aria-label', play.title);
  }
  function tick(now) {
    if (!playing || now <= last) return;
    const previousTime = time;
    if (!document.hidden) time = Math.min(endTime, time + ((now - last) * rates[rateIndex]) / 1000);
    if (previousTime < run.duration && time >= run.duration) playSplash(run.samples.at(-1));
    last = now;
    if (time >= endTime) playing = false;
    display();
  }
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
  });
  play.onclick = () => {
    if (playing) {
      tick(performance.now());
      playing = false;
    } else {
      if (time >= endTime) time = 0;
      last = performance.now();
      playing = true;
    }
    display();
  };
  seek.oninput = () => {
    const selected = Number(seek.value);
    time = endTime - selected < 0.01 ? endTime : selected;
    playing = false;
    display();
  };
  byId('replay-close').onclick = () => {
    playing = false;
    run = null;
    panel.hidden = true;
    onClose();
  };
  return {
    tick,
    get playing() { return playing; },
    get time() {
      return run ? time : null;
    },
    open(record) {
      run = record.run;
      endTime = run.duration + WATER_RUNOUT_SECONDS;
      time = 0;
      last = performance.now();
      playing = true;
      setRate(0);
      seek.max = String(endTime);
      byId('replay-title').textContent = aircraftCards[run.aircraftId ?? 'ryukai'].name + ' ／ ' + record.label;
      panel.hidden = false;
      display();
      play.focus({ preventScroll: true });
    },
  };
}
