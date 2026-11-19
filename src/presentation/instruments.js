import { CG_HEIGHT } from '../domain/flight.js';
import { windAt } from '../domain/weather.js';
import { byId as $ } from './dom.js';

import { RADIANS_PER_DEGREE as radians } from '../domain/units.js';
export function createInstruments(weather) {
  function renderWind(heading, pathLength, t) {
    const wind = windAt(weather(), pathLength, t);
    const speed = Math.hypot(wind.headwind, wind.crosswind ?? 0);
    const relative = heading + Math.atan2(-(wind.crosswind ?? 0), wind.headwind);
    const along = Math.cos(relative),
      side = Math.sin(relative);
    const from =
      Math.abs(side) < 0.22
        ? along >= 0
          ? '正面'
          : '後方'
        : (side > 0 ? '左' : '右') + (Math.abs(along) < 0.22 ? '横' : along > 0 ? '前' : '後');
    $('wind-arrow').style.transform = 'rotate(' + (180 - relative / radians) + 'deg)';
    $('wind-arrow').style.opacity = speed < 0.05 ? 0 : 1;
    $('wind-value').textContent = speed.toFixed(1) + ' m/s';
    const label = speed < 0.05 ? '無風' : from + 'からの風 ' + speed.toFixed(1) + ' m/s';
    $('wind-meter').setAttribute('aria-label', label);
    $('wind-meter').title = label;
  }
  function instruments(s, phase) {
    const tilt = (value, positive, negative) =>
      Math.abs(value / radians) < 0.1
        ? '水平'
        : (value > 0 ? positive : negative) + Math.abs(value / radians).toFixed(1) + '°';
    renderWind(s.heading, s.pathLength ?? 0, s.t ?? 0);
    $('phase').textContent = phase;
    const course = Math.atan2(Math.sin(s.track ?? s.heading), Math.cos(s.track ?? s.heading)) / radians;
    $('course-value').textContent =
      '進路 ' +
      (Math.abs(course) < 0.5 ? '0°' : (course < 0 ? '左 ' : '右 ') + Math.abs(course).toFixed(0) + '°');
    $('instrument-time').textContent = (s.t ?? 0).toFixed(1) + ' s';
    $('speed-value').textContent = s.speed.toFixed(1);
    $('height-value').textContent = (s.bottomHeight ?? s.height - CG_HEIGHT).toFixed(1);
    const vertical = s.verticalSpeed ?? 0;
    $('climb-label').textContent = Math.abs(vertical) < 0.05 ? '昇降' : vertical > 0 ? '上昇中' : '下降中';
    $('climb-value').textContent = Math.abs(vertical).toFixed(1);
    $('pitch-value').textContent = tilt(s.pitch, '上', '下');
    const rudder = s.rudderDeg ?? 0;
    $('rudder-value').textContent = rudder
      ? (rudder > 0 ? '右' : '左') + Math.abs(rudder).toFixed(0) + '°'
      : '中立';
    $('bank-value').textContent = tilt(s.bank ?? 0, '右', '左');
    $('pitch-horizon').style.transform =
      'rotate(' +
      -(s.bank ?? 0) / radians +
      'deg) translateY(' +
      Math.max(-14, Math.min(14, s.pitch / radians)) +
      'px)';
  }
  return { renderWind, instruments };
}
