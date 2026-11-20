// Isolate initial bank in calm air. Use the same wheel, propeller, ground
// contact and catcher models as the interactive 富士川 trial (SI units).
import { createRunwayTrial } from '../src/application/runway-trial.js';
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { STEPS_PER_SECOND } from '../src/domain/flight.js';
import { poweredGroundRoll } from '../src/domain/powered-launch.js';
import { createLandingRoll } from '../src/domain/runway-rollout.js';
import { geometryAt, hullAtControls } from '../src/domain/water-contact.js';
import { runwayHalfWidth, runwayLength, runwayVerge } from '../src/domain/runway-support.js';
import { RAD_PER_RPM } from '../src/domain/units.js';
import { createRenAircraft } from '../src/rendering/aircraft/ren.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const hull = modelHull(createRenAircraft()), profile = aircraftProfile('ren');
const trim = createRunwayTrial(hull).advance(32, 0, 0, 300).sample;
const dt = 1 / STEPS_PER_SECOND, radians = Math.PI / 180;
function landing(bankDegrees) {
  const bank = bankDegrees * radians;
  const geometry = geometryAt(0, hullAtControls(hull, 0, 0, trim.wing), bank);
  const contact = { ...trim, bank, t: 0, forward: 676, right: 0, groundSpeed: 7, verticalSpeed: -.36,
    pitch: 0, rollRate: 0, pitchRate: 0, yawRate: 0, heading: 0, track: 0, height: -geometry.bottom,
    contactSide: geometry.contactSide, contactAft: geometry.contactAft };
  const roll = createLandingRoll(hull, contact, 'calm', 0);
  const wheels = poweredGroundRoll(profile, { edgeRight: 0, edgeForward: contact.forward - profile.releaseWheelAft,
    edgeHeight: 0, heading: 0, speed: 0, length: 0, pushed: 0, push: 0, dropStep: 0, rightStep: 0, forwardStep: 1 }, 'calm', 0);
  let wheel = { t: 0, speed: contact.groundSpeed, travel: 0, omega: contact.rpm * RAD_PER_RPM,
    angle: contact.propellerAngle, reserve: contact.reserve, watts: 0 };
  const s = { ...contact };
  roll(s, 0);
  const result = { bankDegrees, firstContactSideM: s.contactSide };
  for (let tick = 1; tick <= 60 * STEPS_PER_SECOND; tick++) {
    const next = wheels.advance(wheel, dt, 0, false, s.tipDragN + s.catcherBrakeN);
    const travel = next.travel - wheel.travel;
    s.forward += travel * Math.cos(s.track);
    s.right += travel * Math.sin(s.track);
    Object.assign(s, { t: next.t, groundSpeed: next.speed, rpm: next.omega / RAD_PER_RPM });
    const held = roll(s, dt);
    if (tick === 2 * STEPS_PER_SECOND) result.headingAt2s = s.heading / radians;
    if (s.caughtWing) result.wingGripS ??= s.t;
    if (s.catcherBrakeN > 0) result.rearGripS ??= s.t;
    if (!s.groundSpeed) result.stoppedS ??= s.t;
    const exited = Math.abs(s.right) > runwayHalfWidth + runwayVerge || s.forward > runwayLength + runwayVerge;
    if (exited || held) return { ...result, outcome: exited ? '範囲外' : '停止', endS: s.t,
      rolloutM: next.travel, lateralM: s.right };
    wheel = next;
  }
  throw new Error('Catcher recovery did not finish');
}
console.table([-18, 0, 18].map(landing).map(row => Object.fromEntries(Object.entries(row).map(
  ([key, value]) => [key, typeof value === 'number' ? +value.toFixed(2) : value]))));
