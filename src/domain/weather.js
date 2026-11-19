import { breezeAt } from './lake-breeze.js';

// Lake wind speed is the mean headwind over open water, in m/s. Gust speed
// bounds the horizontal departure from that mean. Updraft is positive upward.
const STEADY_WIND_SPEED = 1.2;
export const WIND_RISE_METRES = Object.freeze({ current: 40, previous: 100 });
function steadyWind(label, headwind, crosswind) {
  return Object.freeze({ label, lakeWindSpeed: STEADY_WIND_SPEED, gustSpeed: 0, headwind, crosswind });
}
// The east shore faces the lake. Components are resolved about the launch
// platform, whose bearing is 295°. A westerly is 25° left of its forward axis.
function localWeather(period, level, speed, along, lateral, vertical) {
  const day = period === 'day';
  const westWind = day ? speed : -speed;
  const label = (day ? '昼の湖風' : '夜の陸風') + '・' + level;
  const angle = -25 * Math.PI / 180;
  const field = Object.freeze({ head: westWind * Math.cos(angle), cross: westWind * Math.sin(angle),
    along, lateral, vertical });
  return Object.freeze({ label, period, field, lakeWindSpeed: Math.abs(westWind), gustSpeed: along });
}
export const WEATHER = Object.freeze({
  head: steadyWind('向かい風', STEADY_WIND_SPEED, 0),
  tail: steadyWind('追い風', -STEADY_WIND_SPEED, 0),
  cross: steadyWind('横風', 0, -STEADY_WIND_SPEED),
  'day-easy': localWeather('day', '初級', 0.85, 0.25, 0.22, 0.055),
  'day-normal': localWeather('day', '中級', 1.50, 0.75, 0.60, 0.18),
  'day-hard': localWeather('day', '上級', 2.10, 1.55, 1.35, 0.35),
  'night-easy': localWeather('night', '初級', 0.60, 0.20, 0.18, 0.045),
  'night-normal': localWeather('night', '中級', 1.00, 0.55, 0.50, 0.14),
  'night-hard': localWeather('night', '上級', 1.45, 0.95, 1.05, 0.29),
  reference: Object.freeze({ label: '基準風', lakeWindSpeed: STEADY_WIND_SPEED, gustSpeed: 0,
    description: 'ログに合わせた推定向かい風 0〜1.2 m/s' }),
  calm: Object.freeze({ label: '無風', lakeWindSpeed: 0, gustSpeed: 0,
    description: '仮想条件。水平風・鉛直風ともに 0 m/s' }),
  gust: Object.freeze({ label: '変動風', lakeWindSpeed: 2.2, gustSpeed: 1.15,
    description: '仮想条件。沖の平均向かい風 2.2 m/s、水平変動は最大 ±1.15 m/s、鉛直風は最大 ±0.40 m/s' }),
});

// Repeatable scenario waves. Signed periods encode travel direction.
// Horizontal amplitudes are fractions of gustSpeed, vertical amplitudes are m/s.
const SWELL = { wavelength: 116, period: 43, phase: 0, amplitude: 0.70 };
const RIPPLE = { wavelength: 37, period: -19, phase: 0.8, amplitude: 0.30 };
const LIFT = { wavelength: 96, period: 52, phase: -0.65, amplitude: 0.29 };
const SINK = { wavelength: 46, period: -31, phase: 0.55, amplitude: 0.11 };
const FULL_TURN = 2 * Math.PI;

function wave({ wavelength, period, phase, amplitude }, pathLength, elapsed) {
  return amplitude * Math.sin(FULL_TURN * (pathLength / wavelength + elapsed / period) + phase);
}

export function windAt(mode, position, elapsed, riseLength = WIND_RISE_METRES.current) {
  if (!Object.hasOwn(WEATHER, mode)) throw new RangeError('Unknown weather mode: ' + mode);
  const weather = WEATHER[mode];
  const pathLength = typeof position === 'number' ? position : position.pathLength ?? 0;
  if (weather.field) {
    const gustOffset = position.gustOffset ?? 0;
    const wind = breezeAt(weather.field, position.right ?? 0, position.forward ?? pathLength, elapsed, gustOffset);
    // The mean lake surface blocks normal flow. Its vertical gust component
    // recovers smoothly over an assumed 3 m layer; horizontal wind persists.
    const heightFraction = Math.max(0, Math.min(1, (position.height ?? 3) / 3));
    wind.updraft *= heightFraction ** 2 * (3 - 2 * heightFraction);
    return wind;
  }
  if (weather.headwind !== undefined) return { headwind: weather.headwind, crosswind: weather.crosswind, updraft: 0 };
  const exposure = Math.max(0, Math.min(1, pathLength / riseLength));
  const mean = weather.lakeWindSpeed * exposure;
  if (!weather.gustSpeed || exposure === 0) return { headwind: mean, updraft: 0 };

  const blend = exposure * exposure * (3 - 2 * exposure);
  return {
    headwind: mean + blend * weather.gustSpeed * (wave(SWELL, pathLength, elapsed) + wave(RIPPLE, pathLength, elapsed)),
    updraft: blend * (wave(LIFT, pathLength, elapsed) + wave(SINK, pathLength, elapsed)),
  };
}

// Angles on the wind dial are clockwise from the aircraft nose, pointing downwind.
export function windReading(mode, heading, position, elapsed) {
  const { headwind, crosswind = 0 } = windAt(mode, position, elapsed);
  return {
    speed: Math.hypot(headwind, crosswind),
    angle: Math.PI - heading - Math.atan2(-crosswind, headwind),
  };
}
