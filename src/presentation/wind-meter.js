import { windReading } from '../domain/weather.js';
import { RADIANS_PER_DEGREE } from '../domain/units.js';
import { byId } from './dom.js';

export function updateWindMeter(weather, sample) {
  const { speed, angle } = windReading(weather, sample.heading, sample, sample.windTime ?? sample.t ?? 0);
  const direction = ['後方', '左後方', '左横', '左前方', '正面', '右前方', '右横', '右後方'];
  const sector = (Math.round(angle / (Math.PI / 4)) % 8 + 8) % 8;
  const label = speed < 0.05 ? '無風' : direction[sector] + 'からの風 ' + speed.toFixed(1) + ' m/s';
  const arrow = byId('wind-arrow');
  arrow.style.transform = 'rotate(' + angle / RADIANS_PER_DEGREE + 'deg)';
  arrow.style.opacity = speed < 0.05 ? 0 : 1;
  byId('wind-value').textContent = speed.toFixed(1) + ' m/s';
  byId('wind-meter').setAttribute('aria-label', label);
  byId('wind-meter').title = label;
}
