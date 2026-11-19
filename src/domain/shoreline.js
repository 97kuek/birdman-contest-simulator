import { wingFoldDirection } from './wing-contact.js';

// Terrain rings are in metres east/south of the launch. Project them once into
// the solver's right/forward axes. Rings use the even–odd rule, including holes.
export function createShoreline(rings, facilityYaw) {
  const cos = Math.cos(facilityYaw), sin = Math.sin(facilityYaw);
  const bands = new Map();
  const bandAt = value => Math.floor(value / 32);
  for (const ring of rings) {
    const points = ring.map(([east, south]) => [cos * east - sin * south, -sin * east - cos * south]);
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i], [endX, endY] = points[(i + 1) % points.length];
      if (x === endX && y === endY) continue;
      const edge = { x, y, endX, endY, dx: endX - x, dy: endY - y };
      for (let b = bandAt(Math.min(y, endY)); b <= bandAt(Math.max(y, endY)); b++) {
        if (!bands.has(b)) bands.set(b, []);
        bands.get(b).push(edge);
      }
    }
  }

  // First fraction of a segment on land, including its boundary. A short
  // crossing can start and end on water, e.g. at a breakwater or river mouth.
  return function firstLand(x, y, endX, endY) {
    let inside = false;
    for (const edge of bands.get(bandAt(y)) ?? []) {
      if ((edge.y > y) !== (edge.endY > y) && x < edge.x + (y - edge.y) * edge.dx / edge.dy) inside = !inside;
    }
    if (inside) return 0;
    const dx = endX - x, dy = endY - y;
    let first = null;
    for (let b = bandAt(Math.min(y, endY)); b <= bandAt(Math.max(y, endY)); b++) {
      for (const edge of bands.get(b) ?? []) {
        const ax = edge.x - x, ay = edge.y - y;
        const determinant = dx * edge.dy - dy * edge.dx;
        let t;
        if (determinant === 0) {
          if (ax * edge.dy !== ay * edge.dx) continue;
          if (dx === 0 && dy === 0) {
            if (ax * (edge.endX - x) > 0 || ay * (edge.endY - y) > 0) continue;
            return 0;
          }
          const a = dx ? ax / dx : ay / dy;
          const c = dx ? (edge.endX - x) / dx : (edge.endY - y) / dy;
          if (Math.max(a, c) < 0 || Math.min(a, c) > 1) continue;
          t = Math.max(0, Math.min(a, c));
        } else {
          t = (ax * edge.dy - ay * edge.dx) / determinant;
          const u = (ax * dy - ay * dx) / determinant;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        }
        if (first === null || t < first) first = t;
      }
    }
    return first;
  };
}

// Follow the nose, tail and both wingtips as well as the CG. Bank and pitch
// move these points relative to the CG, especially in the last turn.
export function aircraftShoreContact(hull, firstLand) {
  if (!firstLand) return null;
  const vertices = hull.spatial ?? hull;
  const extremum = (component, sign) => vertices.reduce((a, b) =>
    sign * (b[component] ?? 0) > sign * (a[component] ?? 0) ? b : a);
  const left = extremum(2, -1), right = extremum(2, 1);
  const tips = [...new Set([extremum(0, -1), extremum(0, 1), left, right])];

  function project(s) {
    const sh = Math.sin(s.heading), ch = Math.cos(s.heading);
    const sp = Math.sin(s.pitch), cp = Math.cos(s.pitch), sb = Math.sin(s.bank), cb = Math.cos(s.bank);
    return tips.map(point => {
      let [aft, up, side = 0] = point;
      if (s.wing && hull.wingTips && (point === left || point === right)) {
        const key = point === left ? 'left' : 'right';
        const p = hull.wingTips[key], twist = s.wing[key + 'Twist'];
        const failed = wingFoldDirection(s.wing, key);
        aft = p[0] + twist * p[4];
        up = p[1] + s.wing[key + 'Tip'] * p[3] + twist * p[5] + failed * p[7];
        side = p[2] + Math.abs(failed) * p[6];
      }
      const back = aft * cp + (up * cb - side * sb) * sp;
      const across = side * cb + up * sb;
      return [s.right + across * ch - back * sh, s.forward - across * sh - back * ch];
    });
  }

  return (from, to) => {
    let earliest = firstLand(from.right, from.forward, to.right, to.forward);
    const start = project(from), end = project(to);
    for (let i = 0; i < start.length; i++) {
      const crossing = firstLand(...start[i], ...end[i]);
      if (crossing !== null && (earliest === null || crossing < earliest)) earliest = crossing;
      // An islet can fit between the wingtip and the fuselage.
      if (earliest === null && firstLand(to.right, to.forward, ...end[i]) !== null) earliest = 1;
    }
    return earliest;
  };
}
