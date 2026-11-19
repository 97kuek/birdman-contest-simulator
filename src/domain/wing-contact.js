export function wingFoldDirection(wing, side) {
  if (wing?.failedSide !== side && wing?.failedSide !== 'both') return 0;
  return wing[side + 'Moment'] < 0 ? -1 : 1;
}

// Each vertex stores aft, up, span, bend-up, twist-aft, twist-up, fold-span
// and fold-up. These are the same linear morph coefficients used by the mesh.
export function wingContactTree(vertices) {
  vertices.sort((a, b) => a[2] - b[2]);
  function partition(start, end) {
    const min = Array(8).fill(Infinity), max = Array(8).fill(-Infinity);
    let children, points;
    if (end - start > 96) {
      const middle = Math.floor((start + end) / 2);
      children = [partition(start, middle), partition(middle, end)];
      for (let j = 0; j < 8; j++) {
        min[j] = Math.min(children[0].min[j], children[1].min[j]);
        max[j] = Math.max(children[0].max[j], children[1].max[j]);
      }
    } else {
      points = vertices.slice(start, end);
      for (const p of points) {
        for (let j = 0; j < 8; j++) {
          min[j] = Math.min(min[j], p[j]);
          max[j] = Math.max(max[j], p[j]);
        }
      }
    }
    return { min, max, children, points };
  }
  return partition(0, vertices.length);
}

export function projectHalfWing(tree, tip, twist, failed, pitch, bank, shape) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cb = Math.cos(bank), sb = Math.sin(bank);
  const folded = Math.abs(failed);
  const bottomX = -sb * cp, bottomY = cb * cp, bottomZ = -sp;
  const aftX = -sb * sp, aftY = cb * sp, aftZ = cp;
  function visit(node) {
    const { min, max } = node;
    const minX = min[2] + folded * min[6], maxX = max[2] + folded * max[6];
    const minY = min[1] + tip * (tip < 0 ? max[3] : min[3]) + twist * (twist < 0 ? max[5] : min[5]) + failed * (failed < 0 ? max[7] : min[7]);
    const maxY = max[1] + tip * (tip < 0 ? min[3] : max[3]) + twist * (twist < 0 ? min[5] : max[5]) + failed * (failed < 0 ? min[7] : max[7]);
    const minZ = min[0] + twist * (twist < 0 ? max[4] : min[4]), maxZ = max[0] + twist * (twist < 0 ? min[4] : max[4]);
    const bottom = bottomX * (bottomX < 0 ? maxX : minX) + bottomY * (bottomY < 0 ? maxY : minY) + bottomZ * (bottomZ < 0 ? maxZ : minZ);
    const aft = aftX * (aftX < 0 ? minX : maxX) + aftY * (aftY < 0 ? minY : maxY) + aftZ * (aftZ < 0 ? minZ : maxZ);
    if (bottom >= shape.bottom && aft <= shape.aft) return;
    if (node.children) {
      for (const child of node.children) visit(child);
      return;
    }
    for (const p of node.points) {
      const x = p[2] + folded * p[6], y = p[1] + tip * p[3] + twist * p[5] + failed * p[7], z = p[0] + twist * p[4];
      const up = y * cb - x * sb, vertical = up * cp - z * sp, back = z * cp + up * sp;
      if (vertical < shape.bottom) {
        shape.bottom = vertical;
        shape.contactAft = back;
        shape.contactSide = x * cb + y * sb;
      }
      if (back > shape.aft) {
        shape.aft = back;
        shape.tailSide = x * cb + y * sb;
      }
    }
  }
  visit(tree);
}
