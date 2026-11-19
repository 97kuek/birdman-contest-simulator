// A frozen, advected field in launch-platform axes, in metres and seconds.
// RGB encodes signed longitudinal, lateral and vertical perturbations. The water
// shader samples the same byte grid with the same interpolation as the flight.
export const WIND_GRID_SIZE = 32;
// Coprime with the grid size: trial offsets visit different rows as well as columns.
export const WIND_OFFSET_ROW_STRIDE = 7;
const CHANNELS = 4;
export const windGrid = new Uint8Array(WIND_GRID_SIZE ** 2 * CHANNELS);
let seed = 202507;
for (let i = 0; i < windGrid.length; i += CHANNELS) {
  for (let c = 0; c < 3; c++) {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    windGrid[i + c] = seed >>> 24;
  }
  windGrid[i + 3] = 255;
}

const smooth = t => t * t * (3 - 2 * t);
const wrap = n => ((n % WIND_GRID_SIZE) + WIND_GRID_SIZE) % WIND_GRID_SIZE;
function knot(right, forward) {
  return (wrap(forward) * WIND_GRID_SIZE + wrap(right)) * CHANNELS;
}

export function breezeAt(field, right, forward, seconds, gustOffset = 0) {
  // Positive head/cross components mean flow toward the shore/left.
  const x = (right + field.cross * seconds) / field.cellMetres + gustOffset;
  const y = (forward + field.head * seconds) / field.cellMetres + gustOffset * WIND_OFFSET_ROW_STRIDE;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = knot(ix, iy), b = knot(ix + 1, iy), c = knot(ix, iy + 1), d = knot(ix + 1, iy + 1);
  function component(channel) {
    const near = (1 - fx) * windGrid[a + channel] + fx * windGrid[b + channel];
    const far = (1 - fx) * windGrid[c + channel] + fx * windGrid[d + channel];
    return 2 * ((1 - fy) * near + fy * far) / 255 - 1;
  }
  return {
    headwind: field.head + field.along * component(0),
    crosswind: field.cross + field.lateral * component(1),
    updraft: field.vertical * component(2),
  };
}
