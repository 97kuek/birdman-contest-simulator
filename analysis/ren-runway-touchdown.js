// Isolate initial bank and steady crosswind. Use the same wheel, propeller, ground
// contact and catcher models as the interactive 富士川 trial (SI units).
import { createRunwayTrial } from '../src/application/runway-trial.js';
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { releaseState } from '../src/domain/aircraft-dynamics.js';
import { poweredFlightDynamics } from '../src/domain/powered-flight.js';
import { advanceState, STEPS_PER_SECOND } from '../src/domain/flight.js';
import { poweredGroundRoll } from '../src/domain/powered-launch.js';
import { createLandingRoll } from '../src/domain/runway-rollout.js';
import { geometryAt, hullAtControls } from '../src/domain/water-contact.js';
import { advanceCatcherApproach, shouldCallForLanding, runwayHalfWidth, runwayLength, runwayVerge } from '../src/domain/runway-support.js';
import { RAD_PER_RPM } from '../src/domain/units.js';
import { createRenAircraft } from '../src/rendering/aircraft/ren.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const hull = modelHull(createRenAircraft()), profile = aircraftProfile('ren');
const trim = createRunwayTrial(hull).advance(32, 0, 0, 300).sample;
const dt = 1 / STEPS_PER_SECOND, radians = Math.PI / 180;
const bankAngles = [-18, -15, -10, -6, -3, 0, 3, 6, 10, 15, 18];
function landing(bankDegrees, { earlyApproach = true, windField, omitTipYaw = false, corneringStiffness, observeLoads, observePose } = {}) {
  const bank = bankDegrees * radians;
  const geometry = geometryAt(0, hullAtControls(hull, 0, 0, trim.wing), bank);
  const contact = { ...trim, bank, t: 0, forward: 676, right: 0, groundSpeed: 7, verticalSpeed: -.36,
    pitch: 0, rollRate: 0, pitchRate: 0, yawRate: 0, heading: 0, track: 0, height: -geometry.bottom,
    contactSide: geometry.contactSide, contactAft: geometry.contactAft };
  // A prescribed five-second straight final gives every bank the same crew
  // warning and intercept distance. Compare against waiting until contact.
  if (earlyApproach) {
    for (let tick = 1; tick <= 5 * STEPS_PER_SECOND; tick++) {
      const seconds = 5 - tick * dt;
      const approach = { ...contact, t: -seconds,
        forward: contact.forward - contact.groundSpeed * seconds,
        height: contact.height - contact.verticalSpeed * seconds, bottomHeight: -contact.verticalSpeed * seconds };
      contact.catchers = advanceCatcherApproach(contact.catchers, approach, dt);
      observePose?.({ ...approach, catchers: contact.catchers }, 'flight');
    }
  }
  const roll = createLandingRoll(hull, contact, 'calm', 0, { windField, omitTipYaw, corneringStiffness, observeLoads });
  const wheels = poweredGroundRoll(profile, { edgeRight: 0, edgeForward: contact.forward - profile.releaseWheelAft,
    edgeHeight: 0, heading: 0, speed: 0, length: 0, pushed: 0, push: 0, dropStep: 0, rightStep: 0, forwardStep: 1 }, 'calm', 0, windField);
  let wheel = { t: 0, speed: contact.groundSpeed, travel: 0, omega: contact.rpm * RAD_PER_RPM,
    angle: contact.propellerAngle, reserve: contact.reserve, watts: 0 };
  const s = { ...contact };
  roll(s, 0);
  observePose?.(s, 'rollout');
  const checkpoints = [];
  const wingFirst = Math.abs(s.contactSide) > 1;
  const result = { bankDegrees, wheelS: wingFirst ? null : 0, scrapeS: wingFirst ? 0 : null,
    scrapeWing: wingFirst ? (s.contactSide < 0 ? 'left' : 'right') : null, peakHeadingDeg: 0, peakOffsetM: 0 };

  for (let tick = 1; tick <= 60 * STEPS_PER_SECOND; tick++) {
    const next = wheels.advance(wheel, dt, 0, false, s.tipDragN + s.catcherBrakeN);
    const travel = next.travel - wheel.travel;
    s.forward += travel * Math.cos(s.track);
    s.right += travel * Math.sin(s.track);
    Object.assign(s, { t: next.t, groundSpeed: next.speed, rpm: next.omega / RAD_PER_RPM });
    const held = roll(s, dt);
    observePose?.(s, 'rollout');
    if (s.wheelsOnGround) result.wheelS ??= s.t;
    if (s.scrapingWing && result.scrapeS == null) {
      result.scrapeS = s.t;
      result.scrapeWing = s.scrapingWing;
    }
    result.peakHeadingDeg = Math.max(result.peakHeadingDeg, Math.abs(s.heading / radians));
    result.peakOffsetM = Math.max(result.peakOffsetM, Math.abs(s.right));
    if ([1, 2, 5].includes(tick / STEPS_PER_SECOND)) {
      checkpoints.push({ seconds: tick / STEPS_PER_SECOND, offsetM: s.right,
        headingDeg: s.heading / radians, trackDeg: s.track / radians });
    }
    if (s.catchers.left.holding) result.leftGripS ??= s.t;
    if (s.catchers.right.holding) result.rightGripS ??= s.t;
    if (tick === 2 * STEPS_PER_SECOND) result.headingAt2s = s.heading / radians;
    if (s.caughtWing) result.wingGripS ??= s.t;
    if (s.catcherBrakeN > 0) result.rearGripS ??= s.t;
    if (!s.groundSpeed) result.stoppedS ??= s.t;
    const exited = Math.abs(s.right) > runwayHalfWidth + runwayVerge || s.forward > runwayLength + runwayVerge;
    if (exited || held) return { ...result, checkpoints, outcome: exited ? '範囲外' : '停止', endS: s.t,
      rolloutM: next.travel, lateralM: s.right };
    wheel = { ...next, speed: s.groundSpeed };
  }
  throw new Error('Catcher recovery did not finish');
}
function show(rows) {
  console.table(rows.map(row => Object.fromEntries(Object.entries(row).map(
    ([key, value]) => [key, typeof value === 'number' ? +value.toFixed(2) : value]))));
}

function fullTrial() {
  const trial = createRunwayTrial(hull, 'calm', 0, { preSpin: true });
  const times = {};
  for (let tick = 1; tick <= 150 * STEPS_PER_SECOND; tick++) {
    const { phase, sample: s } = trial.advance(tick * dt, 0, 0, times.call === undefined ? 203 : 0);
    if (phase === 'flight' && shouldCallForLanding(s, runwayLength)) times.call ??= s.t;
    if (times.call === undefined) continue;
    const elapsed = s.t - times.call;
    if (s.touchdownAt != null) times.touch ??= s.touchdownAt - times.call;
    if (s.catchers) {
      // A runner abreast is observable from a car. Gripping is a separate event.
      // This straight trial uses ±2 m fore/aft and 2.5 m either side of the CG.
      const { frame, tail } = s.catchers;
      if (Math.abs(frame.forward - s.forward) <= 2 && Math.abs(frame.right - s.right) <= 2.5)
        times.frameAbreast ??= elapsed;
      if (s.caughtWing) times.wingGrip ??= elapsed;
      if (frame.holding) times.frameGrip ??= elapsed;
      if (tail.holding) times.tailGrip ??= elapsed;
    }
    if (s.groundSpeed === 0) times.stop ??= elapsed;
    if (phase === 'landed') return times;
  }
  throw new Error('The full trial did not complete');
}

function calmReport() {
  for (const earlyApproach of [false, true]) {
    console.log(earlyApproach ? 'Approach before contact' : 'Wait until contact');
    show(bankAngles.map(bank => {
      const { checkpoints, leftGripS, rightGripS, scrapeWing, ...summary } = landing(bank, { earlyApproach });
      return summary;
    }));
  }
  console.log('Neutral 203 W trial, times relative to the call (s); call in trial time');
  show([fullTrial()]);
}

// An independent free-flight pair: measure actual translation before the tyres
// constrain the ground track. Its terminal state is not fed to the bank sweep.
function airborneDrift(windField) {
  const launch = { edgeRight: 0, edgeForward: 0, edgeHeight: 0, dropStep: 0, heading: 0, speed: 7 };
  const model = poweredFlightDynamics(profile, launch, 'calm', 0, windField);
  let s = { ...releaseState(launch, true, true, profile), height: 3, u: 7, w: -.36,
    pitch: 0, q: 0, omega: trim.rpm * RAD_PER_RPM, propellerAngle: 0,
    leftTip: trim.wing.leftTip, rightTip: trim.wing.rightTip };
  for (let tick = 0; tick < 2 * STEPS_PER_SECOND; tick++) {
    const t = tick * dt;
    const mid = advanceState(s, model.rates(s, t, 0, 0, undefined, 0), dt / 2, 0);
    s = advanceState(s, model.rates(mid, t + dt / 2, 0, 0, undefined, 0), dt, 0);
    const geometry = geometryAt(s.pitch, hullAtControls(hull, 0, 0, {
      leftTip: s.leftTip, rightTip: s.rightTip, leftTwist: 0, rightTwist: 0,
    }), s.bank);
    if (s.height + geometry.bottom <= 0) throw new Error('Airborne control touched the runway');
  }
  return { offsetM: s.right, headingDeg: s.heading / radians, trackDeg: (s.heading + Math.atan2(s.v, s.u)) / radians };
}

function crosswindReport() {
  const motion = [], catches = [], airborne = [];
  for (const crosswind of [-0.5, 0, 0.5]) {
    // Positive crosswind enters the relative airflow from aircraft right.
    const windField = () => ({ crosswind, headwind: 0, updraft: 0 });
    const wind = crosswind < 0 ? '左から' : crosswind > 0 ? '右から' : '無風';
    airborne.push({ wind, ...airborneDrift(windField) });
    for (const bank of bankAngles) {
      const full = landing(bank, { windField });
      const control = landing(bank, { windField, omitTipYaw: true });
      const a = full.checkpoints.at(-1), b = control.checkpoints.at(-1);
      motion.push({ bank, wind, offsetM: a.offsetM, headingDeg: a.headingDeg, trackDeg: a.trackDeg,
        noTipYawOffsetM: b.offsetM, noTipYawHeadingDeg: b.headingDeg,
        tipYawEffectDeg: a.headingDeg - b.headingDeg, tipOffsetEffectM: a.offsetM - b.offsetM });
      const scrapedWingGripS = full.scrapeWing === 'right' ? full.rightGripS : full.leftGripS;
      const gripMinusScrapeS = full.scrapeS != null && scrapedWingGripS != null ? scrapedWingGripS - full.scrapeS : null;
      catches.push({ bank, wind, scrapeWing: full.scrapeWing, scrapeS: full.scrapeS,
        leftGripS: full.leftGripS ?? null, rightGripS: full.rightGripS ?? null, gripMinusScrapeS,
        rearGripS: full.rearGripS ?? null, finalOffsetM: full.lateralM, outcome: full.outcome });
    }
  }
  console.log('2 s airborne from the same wings-level approach state');
  show(airborne);
  console.log('5 s after first contact; positive offset, heading and track are to runway right');
  show(motion);
  console.log('First contact to first grip of each wing and the first rear catcher (s)');
  show(catches);
}

// Machine-readable matched pairs for the Fujikawa side-force experiment.
function tyreReport() {
  const rows = [];
  for (const crosswind of [-.5, 0, .5]) {
    const windField = () => ({ headwind: 0, crosswind, updraft: 0 });
    for (const bank of [-15, 0, 15]) {
      for (const corneringStiffness of [2, 4, 8]) {
        const full = landing(bank, { windField, corneringStiffness });
        const control = landing(bank, { windField, corneringStiffness, omitTipYaw: true });
        rows.push({ crosswind, bank, corneringStiffness, ...full, withoutTipYaw: control.checkpoints });
      }
    }
  }
  console.log(JSON.stringify(rows, null, 2));
}

if (process.argv.includes('--scrape')) {
  const { scrapeReport } = await import('./ren-runway-scrape.js');
  scrapeReport(landing, dt);
} else if (process.argv.includes('--tyres')) tyreReport();
else if (process.argv.includes('--crosswind')) crosswindReport();
else calmReport();
