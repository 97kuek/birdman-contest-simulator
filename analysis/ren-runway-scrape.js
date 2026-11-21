// Replay the prescribed approach and rollout through the same skeleton and
// wing-line attachment used on screen. The physics grip radius is horizontal.
import { Group, Vector3 } from 'three';
import { CG_HEIGHT } from '../src/domain/aircraft-dynamics.js';
import { wingGripSpan } from '../src/domain/runway-support.js';
import { createRunwayCrew, wingLineAnchor } from '../src/rendering/runway-crew.js';

function crewMeasurement() {
  const crew = createRunwayCrew(), base = new Group();
  const anchor = new Vector3(), palm = new Vector3();
  return (s, phase) => {
    base.rotation.set(s.pitch, -s.heading, -(s.bank ?? 0), 'YXZ');
    base.position.set(s.right, s.height, -s.forward)
      .add(anchor.set(0, -CG_HEIGHT, 0).applyEuler(base.rotation));
    crew.update(s, phase, s.t, base);
    if (!s.scrapingWing || !s.catchers) return null;
    const sign = s.scrapingWing === 'right' ? 1 : -1;
    const wing = sign > 0 ? '右翼' : '左翼';
    const member = crew.group.getObjectByName(wing + 'キャッチャー・' + s.catchers.station + 'm');
    wingLineAnchor(anchor, s, sign * wingGripSpan, base);
    const handM = Math.min(...['左手', '右手'].map(name =>
      member.getObjectByName(name).getWorldPosition(palm).distanceTo(anchor)));
    const runner = s.catchers[s.scrapingWing];
    return { handM, aheadM: runner.forward + anchor.z, acrossM: runner.right - anchor.x };
  };
}

export function scrapeReport(landing, dt) {
  const catches = [], trials = [];
  for (const bank of [15, -15]) {
    for (const crosswind of [-.5, 0, .5]) {
      const windField = () => ({ crosswind, headwind: 0, updraft: 0 });
      const measure = crewMeasurement();
      let gap;
      const run = landing(bank, { windField, observePose(s, phase) {
        if (!gap) gap = measure(s, phase);
      } });
      catches.push({ bank, crosswind, scrapeS: run.scrapeS, gripS: bank > 0 ? run.rightGripS : run.leftGripS, ...gap });
    }
  }
  const calm = () => ({ crosswind: 0, headwind: 0, updraft: 0 });
  for (const [name, options] of [['full', {}], ['withoutTyreSide', { corneringStiffness: 0 }],
    ['withoutTipYaw', { omitTipYaw: true }]]) {
    let loads;
    const trace = [];
    const run = landing(15, { windField: calm, ...options, observeLoads(value) { loads = value; },
      observePose(s, phase) {
        if (phase === 'rollout' && s.t > 0 && s.t <= 5 + dt / 2)
          trace.push({ t: s.t, offsetM: s.right, headingDeg: s.heading * 180 / Math.PI, ...loads });
      } });
    trials.push({ name, scrapeS: run.scrapeS, trace });
  }
  console.log(JSON.stringify({ catches, trials }));
}
