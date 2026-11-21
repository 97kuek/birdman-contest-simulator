// The collision index uses the authored meshes in facility-local coordinates. Painted stripes and decals do not add collision surfaces.
import { Box3, Ray, Vector3 } from 'three';

export function createPlatformContact() {
  const cells = new Map(), bounds = new Box3(), cellWidth = 4;
  const ray = new Ray(), hit = new Vector3();
  const delta = new Vector3(), stepBounds = new Box3();
  function visit(box, fn) {
    for (let x = Math.floor(box.min.x / cellWidth); x <= Math.floor(box.max.x / cellWidth); x++) {
      for (let z = Math.floor(box.min.z / cellWidth); z <= Math.floor(box.max.z / cellWidth); z++) fn(x + '/' + z);
    }
  }
  function add(shape) {
    bounds.union(shape.box);
    visit(shape.box, key => {
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(shape);
    });
  }
  function addMesh(mesh) {
    const positions = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.index;
    const vertices = Array.from({ length: positions.count }, (_, i) =>
      new Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
    const count = index ? index.count : vertices.length;
    for (let i = 0; i < count; i += 3) {
      const triangle = [0, 1, 2].map(j => vertices[index ? index.getX(i + j) : i + j]);
      add({ vertices: triangle, box: new Box3().setFromPoints(triangle) });
    }
  }
  function firstHit(from, to) {
    stepBounds.makeEmpty().expandByPoint(from).expandByPoint(to);
    if (!bounds.intersectsBox(stepBounds)) return null;
    const length = delta.subVectors(to, from).length();
    if (!length) return null;
    ray.set(from, delta.divideScalar(length));
    let first = null;
    const tested = new Set();
    visit(stepBounds, key => {
      for (const shape of cells.get(key) ?? []) {
        if (tested.has(shape) || !shape.box.intersectsBox(stepBounds)) continue;
        tested.add(shape);
        let f = null;
        if (ray.intersectTriangle(...shape.vertices, false, hit)) f = hit.distanceTo(from) / length;
        if (f !== null && f <= 1 && (first === null || f < first)) first = f;
      }
    });
    return first;
  }
  // Sample the model hull by span and length; use both surfaces at each
  // station so a banked wing, propeller disk, nose or tail can strike first.
  function forAircraft(hull) {
    const sections = new Map();
    for (const point of hull.wings ? hull.bodySpatial : (hull.spatial ?? hull)) {
      const [aft, up, side = 0] = point;
      const key = Math.round(aft * 2) + '/' + Math.round(side * 2);
      const pair = sections.get(key) ?? [point, point];
      if (up < pair[0][1]) pair[0] = point;
      if (up > pair[1][1]) pair[1] = point;
      sections.set(key, pair);
    }
    // Glider wing vertices carry the same twist/bend coefficients as the
    // skin. Keep their local extrema instead of tracing a rigid trim outline.
    function addFlexibleWing(node) {
      if (node.children) { node.children.forEach(addFlexibleWing); return; }
      for (const point of node.points) {
        const [aft, up, side] = point;
        const key = 'wing/' + Math.round(aft * 2) + '/' + Math.round(side * 2);
        const pair = sections.get(key) ?? [point, point];
        if (up < pair[0][1]) pair[0] = point;
        if (up > pair[1][1]) pair[1] = point;
        sections.set(key, pair);
      }
    }
    if (hull.wings) {
      addFlexibleWing(hull.wings.left);
      addFlexibleWing(hull.wings.right);
    }
    const points = [...new Set([...sections.values()].flat())];
    const radius = Math.max(...points.map(p => Math.hypot(p[0], p[1], p[2] ?? 0)));
    function outside(a, b) {
      return Math.min(a.forward,b.forward) > radius - bounds.min.z ||
        Math.max(a.forward,b.forward) < -bounds.max.z - radius ||
        Math.min(a.right,b.right) > bounds.max.x + radius || Math.max(a.right,b.right) < bounds.min.x - radius ||
        Math.min(a.height,b.height) > bounds.max.y + radius;
    }
    function transform(s) {
      const cb = Math.cos(s.bank ?? 0), sb = Math.sin(s.bank ?? 0), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
      const ch = Math.cos(s.heading), sh = Math.sin(s.heading);
      return ([aft, up, side = 0, bend = 0, twistAft = 0, twistUp = 0], out) => {
        if (s.wing && (bend || twistAft || twistUp)) {
          const hand = side < 0 ? 'left' : 'right';
          const twist = s.wing[hand + 'Twist'];
          up += bend * s.wing[hand + 'Tip'] + twistUp * twist;
          aft += twistAft * twist;
        }
        const banked = up * cb - side * sb, across = side * cb + up * sb;
        const back = aft * cp + banked * sp;
        return out.set(s.right + across * ch - back * sh, s.height + banked * cp - aft * sp,
          -s.forward + across * sh + back * ch);
      };
    }
    const start = new Vector3(), end = new Vector3();
    return (a,b) => {
      if (outside(a,b)) return null;
      const from = transform(a), to = transform(b);
      let first = null;
      for (const point of points) {
        from(point, start);
        to(point, end);
        if (a.rampTravel !== undefined || (a.wheelClearance && point[1] < -a.wheelClearance + .006)) {
          // Contact with the running surface is normal during the supported
          // roll. Clear the 4 mm raised lane paint plus mesh rounding.
          start.y += .005;
          end.y += .005;
        }
        const f = firstHit(start, end);
        if (f !== null && (first === null || f < first)) first = f;
      }
      return first;
    };
  }
  return { addMesh, forAircraft };
}
