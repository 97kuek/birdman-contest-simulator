// node analysis/pilot-shift-comparison.js /path/to/8d2e318 > docs/pilot-shift-comparison.csv
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pullupLog } from '../src/domain/pullup-data.js';

if (!process.argv[2]) throw Error('Pass the 8d2e318 source tree with its npm dependencies.');
console.log('version,control,seconds,height_m,airspeed_m_s,pitch_deg,cg_shift_m');
for (const { t, height, speed, pitchDeg } of pullupLog) {
  console.log(['log', 'contest', t, height, speed, pitchDeg, ''].join(','));
}

for (const [version, root] of [['8d2e318', resolve(process.argv[2])], ['current', resolve(import.meta.dirname, '..')]]) {
  const from = path => import(pathToFileURL(resolve(root, path)));
  const { createAircraft } = await from('src/rendering/aircraft.js');
  const { modelHull } = await from('src/rendering/collision-hull.js');
  const { BASE_DESIGN, createFlight, FLIGHT_LIMIT_SECONDS, poseAt } = await from('src/domain/flight.js');
  const hull = modelHull(createAircraft(BASE_DESIGN.span, BASE_DESIGN.incidence));
  for (const control of ['reference', 'neutral', 'forward', 'aft']) {
    const live = createFlight(BASE_DESIGN, hull, { weather: 'reference', referenceControl: control === 'reference' });
    live.advanceTo(1.5);
    const input = control === 'forward' ? -1 : control === 'aft' ? 1 : 0;
    live.advanceTo(2.5, input);
    live.advanceTo(FLIGHT_LIMIT_SECONDS);
    for (const { t } of pullupLog) {
      const sample = poseAt(live.result, t);
      const values = [sample.bottomHeight, sample.speed, sample.pitch * 180 / Math.PI, sample.shift];
      console.log([version, control, t, ...values.map(value => value.toFixed(7))].join(','));
    }
  }
}
