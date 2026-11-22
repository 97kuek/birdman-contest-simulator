// Reproduce the recorded 300 → 203 → 0 W Fujikawa trial. Observe at 60 Hz;
// the production runway integrator takes its normal 1/120 s physics steps.
import { pathToFileURL } from 'node:url';
import { createRunwayTrial } from '../src/application/runway-trial.js';
import { runwayLength, shouldCallForLanding, wingLaneStagger } from '../src/domain/runway-support.js';
import { createRenAircraft } from '../src/rendering/aircraft/ren.js';
import { modelHull } from '../src/rendering/collision-hull.js';

export function measureCatcherApproach(hull, options = {}) {
  const trial = createRunwayTrial(hull, 'calm', 0, { ...options, preSpin: true });
  const result = { peakBank: 0 };
  let watts = 300;
  for (let tick = 0; tick <= 180 * 60; tick++) {
    const t = tick / 60;
    const { phase, sample: s, reason } = trial.advance(t, 0, 0, watts);
    if (s.liftOffAt != null && watts === 300) {
      result.lift = s.liftOffAt;
      watts = 203;
    }
    if (phase === 'flight' && watts === 203 && shouldCallForLanding(s, runwayLength)) {
      result.call = t;
      watts = 0;
    }
    const runner = s.catchers?.frame;
    if (result.call != null && runner && Math.abs(runner.forward - s.forward) <= 2 &&
                                         Math.abs(runner.right - s.right) <= 2.5) result.abreast ??= s.t;
    if (s.touchdownAt != null) {
      result.touch = s.touchdownAt;
      for (const role of ['left', 'right', 'frame', 'tail']) {
        if (s.catchers[role].holding) result[role] ??= s.t;
      }
      const degrees = s.bank * 180 / Math.PI;
      if (Math.abs(degrees) > Math.abs(result.peakBank)) result.peakBank = degrees;
      if (s.groundSpeed === 0) result.stop ??= s.t;
    }
    if (phase === 'landed') return result;
    if (phase === 'aborted') throw new Error(reason);
  }
  throw new Error('Runway trial did not finish');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hull = modelHull(createRenAircraft());
  const cases = [
    ['left inboard', { wingStagger: wingLaneStagger }],
    ['right inboard', { wingStagger: -wingLaneStagger }],
    ['equal lanes', { wingStagger: 0 }],
    ['left inboard, slack line', { wingStagger: wingLaneStagger, lineTakeupN: 0 }],
  ];
  console.table(cases.map(([approach, options]) => {
    const r = measureCatcherApproach(hull, options);
    const relative = key => +(r[key] - r.touch).toFixed(3);
    return { approach, callToAbreastS: +(r.abreast - r.call).toFixed(3), touchFromGoS: +r.touch.toFixed(3),
      leftS: relative('left'), rightS: relative('right'), frameS: relative('frame'), tailS: relative('tail'),
      stopS: relative('stop'), peakBankDeg: +r.peakBank.toFixed(4) };
  }));
}
