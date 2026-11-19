import { rampAt, RAMP_LENGTH } from './launch.js';

// The pushers and undercarriage constrain the fuselage until release. Advance
// the same bending modes along that prescribed path so the tips already carry
// air load at the edge. The launch crew's individual hand forces are unknown.
export function rampWingMotion(launch, initial, loadsAt, stepSize) {
  const steps = Math.ceil(launch.duration / stepSize);
  const dt = launch.duration / steps;
  const samples = [];
  function flow(t, bending) {
    const ramp = rampAt(launch, t);
    const remaining = RAMP_LENGTH - ramp.travel;
    const state = { ...initial, ...bending, q: 0, pitch: 0,
      right: -remaining * launch.rightStep, forward: -remaining * launch.forwardStep,
      height: initial.height + remaining * launch.dropStep,
      u: ramp.speed * Math.hypot(launch.rightStep, launch.forwardStep), w: -ramp.speed * launch.dropStep };
    return loadsAt(state, t - launch.duration).structure;
  }
  function advance(initial, evaluated, target, elapsed) {
    return {
      leftTip: initial.leftTip + elapsed * evaluated.leftTipRate,
      rightTip: initial.rightTip + elapsed * evaluated.rightTipRate,
      leftTipRate: initial.leftTipRate + elapsed * target.leftTipAcceleration,
      rightTipRate: initial.rightTipRate + elapsed * target.rightTipAcceleration,
    };
  }
  let bending = { leftTip: 0, rightTip: 0, leftTipRate: 0, rightTipRate: 0 };
  for (let i = 0; i <= steps; i++) {
    const t = dt * i;
    const target = flow(t, bending);
    samples.push({ ...bending, leftTwist: target.leftTwist, rightTwist: target.rightTwist });
    if (i < steps) {
      const mid = advance(bending, bending, target, dt / 2);
      bending = advance(bending, mid, flow(t + dt / 2, mid), dt);
    }
  }
  return { release: bending, at(t) {
    const pos = Math.max(0, Math.min(steps, t / dt));
    const i = Math.min(steps - 1, Math.floor(pos)), mix = pos - i;
    const a = samples[i], b = samples[i + 1];
    const blend = key => a[key] + (b[key] - a[key]) * mix;
    return { leftTip: blend('leftTip'), rightTip: blend('rightTip'), leftTwist: blend('leftTwist'), rightTwist: blend('rightTwist') };
  } };
}
