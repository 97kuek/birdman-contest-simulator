import { Color, DynamicDrawUsage, Float32BufferAttribute } from 'three';
import { windAt } from '../domain/weather.js';

// Deform the authored cloth along its span. The inset uses the same upper
// and lower hems even when the glTF vertex order differs from Blender's.
export function createPlatformFlag(platform) {
  let group, cloth;
  platform.traverse(part => {
    if (part.userData.platformRole === 'flag') group = part;
    if (part.userData.platformRole === 'cloth') cloth = part;
  });
  const geometry = cloth.geometry.clone();
  cloth.geometry = geometry;
  const rest = geometry.getAttribute('position').clone();
  const fabric = geometry.getAttribute('position').setUsage(DynamicDrawUsage);
  const colors = geometry.getAttribute('color');
  const stations = [...new Set(Array.from({ length: rest.count }, (_, i) => rest.getX(i)))].sort((a,b) => a-b);
  const strips = stations.length - 1;
  const length = stations[strips] - stations[0];
  geometry.computeBoundingBox();
  const poleHeight = geometry.boundingBox.max.y;
  const points = new Float32BufferAttribute(new Float32Array(stations.length * 2 * 3), 3);
  const stripColors = [], top = [], bottom = [];
  for (let i = 0; i < rest.count; i++) {
    const column = stations.indexOf(rest.getX(i));
    if (top[column] === undefined || rest.getY(i) > rest.getY(top[column])) top[column] = i;
    if (bottom[column] === undefined || rest.getY(i) < rest.getY(bottom[column])) bottom[column] = i;
  }
  for (const i of top) stripColors.push('#' + new Color().fromBufferAttribute(colors, i).getHexString());
  const hems = [...top, ...bottom];
  const refreshHems = () => hems.forEach((vertex, i) => points.copyAt(i, fabric, vertex));
  refreshHems();
  // In a calm wind the free end can hang below its original bounding box.
  cloth.frustumCulled = false;

  function update(weather, gustOffset, windTime, fabricTime) {
    const wind = windAt(weather, {right: group.position.x, forward: -group.position.z,
      height: group.position.y + poleHeight, gustOffset}, windTime);
    const x = -(wind.crosswind ?? 0), z = wind.headwind;
    const speed = Math.hypot(x, z), stretch = speed / Math.hypot(speed, .65);
    const dirX = speed ? x / speed : 0, dirZ = speed ? z / speed : 1;
    for (let i = 0; i < rest.count; i++) {
      const span = rest.getX(i) - stations[0], u = span / length;
      const ripple = .095 * stretch * u * Math.sin(u * 11 - fabricTime * (4 + Math.min(speed, 4)));
      const reach = span * (.09 + .91 * stretch);
      const drop = u ** 1.25 * length * Math.sqrt(1 - stretch ** 2);
      fabric.setXYZ(i, stations[0] + dirX * reach + dirZ * ripple, rest.getY(i) - drop,
        rest.getZ(i) + dirZ * reach - dirX * ripple);
    }
    fabric.needsUpdate = true;
    geometry.computeVertexNormals();
    refreshHems();
    return wind;
  }
  return { group, points, strips, stripColors, poleHeight, update };
}
