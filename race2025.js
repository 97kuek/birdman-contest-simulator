// Sampled from TORICA's 2025_Tatsumi.csv. The origin is log time 3.9 s.
// Coordinates are horizontal metres in the launch platform frame. See flight-validation.md.
export const observations = [
  [0, 0.0, 0.0, 11.78, 7.99],
  [3.1, 6.6, 24.1, 6.77, 11.59],
  [7.1, 18.0, 61.1, 9.02, 9.52],
  [10, 23.8, 84.5, 8.41, 10.05],
  [15, 30.1, 129.8, 7.59, 10.03],
  [20, 38.3, 172.6, 6.06, 10.08],
  [25, 41.0, 217.4, 5.11, 9.86],
  [30, 38.2, 262.3, 3.29, 9.73],
  [33, 33.0, 288.5, 2.64, 9.92],
  [35, 28.0, 304.3, 2.24, 9.67],
  [40, 10.0, 344.4, 1.09, 10.16],
  [42, 1.4, 358.6, 1.51, 9.60],
  [45, -14.1, 378.3, 0.62, 9.77],
  [47, -26.2, 390.0, 0.47, 9.31],
  [50, -46.0, 405.8, 0.42, 8.82],
  [52, -58.5, 414.2, 0.22, 8.75],
  [54.23, -70.5, 421.3, 0.04, 7.69],
].map(([t, right, forward, sensorHeight, airspeed]) => ({
  t, right, forward, distance: Math.hypot(right, forward), sensorHeight, airspeed,
}));

export const officialDistance = 433.02;

// Ground-track directions estimated from broad intervals of the GPS trace.
// All designs follow this course. Continue on the last tangent beyond the data.
const radians = Math.PI / 180;
const headings = [[0, 0], [35, 18], [120, 8], [200, 7], [315, -17], [465, -58]];
export function courseAt(length) {
  let right = 0, forward = 0;
  for (let i = 1; i < headings.length; i++) {
    const [start, from] = headings[i - 1], [end, to] = headings[i];
    const curvature = (to - from) * radians / (end - start);
    const arc = Math.min(length, end) - start;
    const initial = from * radians, heading = initial + arc * curvature;
    right += (Math.cos(initial) - Math.cos(heading)) / curvature;
    forward += (Math.sin(heading) - Math.sin(initial)) / curvature;
    if (length <= end) return { right, forward, heading };
  }
  const [end, to] = headings.at(-1);
  const heading = to * radians;
  return {right: right + (length-end)*Math.sin(heading),
    forward: forward + (length-end)*Math.cos(heading), heading};
}
