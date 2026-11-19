// Lake wind speed is the mean headwind over open water, in m/s. Gust speed
// bounds the horizontal departure from that mean. Updraft is positive upward.
// The three fields are repeatable scenarios, not a weather observation series.
export const WEATHER = Object.freeze({
  head: Object.freeze({label:'向かい風',lakeWindSpeed:1.2,gustSpeed:0,headwind:1.2,crosswind:0}),
  tail: Object.freeze({label:'追い風',lakeWindSpeed:1.2,gustSpeed:0,headwind:-1.2,crosswind:0}),
  cross: Object.freeze({label:'横風',lakeWindSpeed:1.2,gustSpeed:0,headwind:0,crosswind:-1.2}),
  reference: Object.freeze({label:'基準風', lakeWindSpeed:1.2, gustSpeed:0,
    description:'ログに合わせた推定向かい風 0〜1.2 m/s'}),
  calm: Object.freeze({label:'無風', lakeWindSpeed:0, gustSpeed:0,
    description:'仮想条件。水平風・鉛直風ともに 0 m/s'}),
  gust: Object.freeze({label:'変動風', lakeWindSpeed:2.2, gustSpeed:1.15,
    description:'仮想条件。沖の平均向かい風 2.2 m/s、水平変動は最大 ±1.15 m/s、鉛直風は最大 ±0.40 m/s'}),
});

const tau = 2 * Math.PI;
export function windAt(mode, pathLength, elapsed, riseLength = 40) {
  const weather = WEATHER[mode];
  if (!Object.hasOwn(WEATHER, mode)) throw new RangeError('Unknown weather mode: ' + mode);
  if (weather.headwind !== undefined) return {headwind:weather.headwind,crosswind:weather.crosswind,updraft:0};
  const exposure = Math.max(0, Math.min(1, pathLength / riseLength));
  const mean = weather.lakeWindSpeed * exposure;
  if (!weather.gustSpeed || exposure === 0) return {headwind:mean, updraft:0};

  // Two drifting wavelengths in each direction stand in for passing patches
  // of moving air. Each design sees the same field at matching position/time.
  const swell = Math.sin(tau * (pathLength / 116 + elapsed / 43));
  const ripple = Math.sin(tau * (pathLength / 37 - elapsed / 19) + 0.8);
  const lift = Math.sin(tau * (pathLength / 96 + elapsed / 52) - 0.65);
  const sink = Math.sin(tau * (pathLength / 46 - elapsed / 31) + 0.55);
  const blend = exposure * exposure * (3 - 2 * exposure);
  return {
    headwind: mean + blend * weather.gustSpeed * (0.70 * swell + 0.30 * ripple),
    updraft: blend * (0.29 * lift + 0.11 * sink),
  };
}
