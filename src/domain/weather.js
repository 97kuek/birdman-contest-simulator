// Lake wind speed is the mean headwind over open water, in m/s. Gust speed
// bounds the horizontal departure from that mean. Updraft is positive upward.
const STEADY_WIND_SPEED = 1.2;
export const WIND_RISE_METRES = Object.freeze({ current: 40, previous: 100 });
function steadyWind(label, headwind, crosswind) {
  return Object.freeze({ label, lakeWindSpeed: STEADY_WIND_SPEED, gustSpeed: 0, headwind, crosswind });
}
export const WEATHER = Object.freeze({
  head: steadyWind('向かい風', STEADY_WIND_SPEED, 0),
  tail: steadyWind('追い風', -STEADY_WIND_SPEED, 0),
  cross: steadyWind('横風', 0, -STEADY_WIND_SPEED),
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

export function windAt(mode, pathLength, elapsed, riseLength = WIND_RISE_METRES.current) {
  if (!Object.hasOwn(WEATHER, mode)) throw new RangeError('Unknown weather mode: ' + mode);
  const weather = WEATHER[mode];
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
