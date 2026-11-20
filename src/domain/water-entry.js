// A reduced-order water-entry model. Each station represents an effective
// waterplane area, trapped volume and opening, not the outline of a sealed hull.
import { waterWing } from './water-wing.js';
import { wingBendShape } from './wing-structure.js';
import { GRAVITY } from './units.js';
import { aircraftProfile } from './aircraft-profiles.js';
import { REN_STRUCTURE, renSparHeight } from './ren-wing.js';
import { CG_HEIGHT } from './aircraft-dynamics.js';

export const WATER_RUNOUT_SECONDS = 4;
const WATER_DENSITY = 1000, HZ = 120;
const UNLOAD_SECONDS = .65;
const cached = new WeakMap();
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));

function history(contact, hull) {
  const profile = aircraftProfile(contact.aircraftId), powered = !!profile.propulsion;
  const mass = profile.mass, half = profile.span / 2;
  const side = contact.contactSide ?? 0, aft = contact.contactAft ?? 0;
  const strikeSpeed = Math.max(0, -contact.verticalSpeed + side * (contact.rollRate ?? 0) + aft * (contact.pitchRate ?? 0));
  const hinge = powered ? REN_STRUCTURE.wireStation : profile.design.aircraftId === 'qx25' ? .80 : .60;
  const panels = [-1, 1].map(sign => waterWing(contact.wing, sign, half, hinge));
  const panelIndex = x => Number(x > 0);
  const impactArea = .65; // effective area after 12 cm immersion, not at first contact
  const wingUp = x => powered ? renSparHeight(x) - CG_HEIGHT : profile.wingHeight + (x / half) ** 2 * 1.05;
  const unloadedTip = powered ? -REN_STRUCTURE.trimTip : 0;
  const tipAt = (x, t) => {
    const initial = contact.wing?.[x > 0 ? 'rightTip' : 'leftTip'] ?? 0;
    return unloadedTip + (initial - unloadedTip) * Math.exp(-t / UNLOAD_SECONDS);
  };
  const bendAt = (x, t) => tipAt(x, t) * wingBendShape(contact.aircraftId ?? 'ryukai', Math.abs(x) / half);
  const cells = [];
  function cell(x, z, up, area, volume, opening) {
    cells.push({ x, z, up, area, volume, opening, flooded: 0 });
  }
  // Two open cockpit bays and four wing flotation stations. Wet film and
  // damaged covering admit water; the ribs retain residual displacement.
  const keel = Math.max(-.53, Math.min(...(hull.bodyPlanar ?? hull.planar ?? hull).map(point => point[1])));
  const cockpitOpening = .003 + .006 * clamp(strikeSpeed / 3, 0, 1);
  for (const z of [-.62,.62]) cell(0, z, keel, .24, .090, cockpitOpening);
  for (const sign of [-1,1]) {
    for (const fraction of [.30,.82]) {
      const x = sign * fraction * half;
      cell(x, 0, wingUp(x), .72, .075, .003);
    }
  }
  // Resolve the first wet vertex back to aircraft coordinates. A wingtip
  // touches before the flotation stations do. Its brief slamming force and
  // drag act at that tip, and produce opposite moments on opposite wings.
  const sp0 = Math.sin(contact.pitch), cp0 = Math.cos(contact.pitch);
  const rotatedUp = -contact.height * cp0 + aft * sp0;
  const impact = Math.abs(side) > 1 ? {
    z: aft * cp0 + contact.height * sp0,
    up: rotatedUp * Math.cos(contact.bank) + side * Math.sin(contact.bank),
    x: side * Math.cos(contact.bank) - rotatedUp * Math.sin(contact.bank),
  } : null;
  let s = { height: contact.height ?? -keel, verticalSpeed: contact.verticalSpeed, bank: contact.bank, pitch: contact.pitch,
    leftFold: panels[0].fold, rightFold: panels[1].fold,
    bankRate: contact.rollRate ?? 0, pitchVelocity: contact.pitchRate ?? 0, heading: contact.heading,
    yaw: contact.yawRate ?? 0, forward: contact.forward, right: contact.right, groundSpeed: contact.groundSpeed };
  const samples = [s], dt = 1/HZ;
  const brokenAt = panels.map(panel => panel.failed ? 0 : Infinity);
  for (let i = 1; i <= HZ * WATER_RUNOUT_SECONDS; i++) {
    const cb = Math.cos(s.bank), sb = Math.sin(s.bank), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    const t = i * dt, moments = [0, 0];
    const airFraction = Math.min(1, (s.groundSpeed / Math.max(.01, contact.groundSpeed)) ** 2) * Math.exp(-t / UNLOAD_SECONDS);
    let vertical = -mass * GRAVITY + (contact.airborneLiftN ?? 0) * airFraction, roll = 0, pitch = 0, resistance = 0, yaw = 0;
    for (const c of cells) {
      const which = panelIndex(c.x);
      const panel = panels[which];
      const { x, up } = c.x ? panel.position(c.x, c.up + bendAt(c.x,t)) : c;
      const zUp = up * cb - x * sb;
      const depth = Math.max(0, -(s.height + zUp * cp - c.z * sp));
      if (!depth) continue;
      const displaced = Math.min(c.volume, c.area * depth);
      c.flooded = Math.min(c.volume * .80, c.flooded + dt * .62 * (c.x && panel.failed ? .025 : c.opening) * Math.sqrt(2 * GRAVITY * depth));
      const lever = (x * cb + up * sb) * cp, longitudinal = c.z * cp + zUp * sp;
      const localUp = s.verticalSpeed - lever * s.bankRate - longitudinal * s.pitchVelocity;
      const wetted = Math.min(1, displaced / c.volume);
      const force = Math.max(0, WATER_DENSITY * (GRAVITY * Math.max(0, displaced - c.flooded)
        - .65 * c.area * wetted * localUp * Math.abs(localUp)));
      const localForward = s.groundSpeed - lever * s.yaw;
      const drag = .5 * WATER_DENSITY * Math.min(depth,.24) * Math.sqrt(c.area) * .85 * localForward * Math.abs(localForward);
      if (c.x) moments[which] += force * cb * cp * Math.max(0, Math.abs(c.x) - hinge);
      vertical += force;
      roll -= lever * force;
      pitch -= longitudinal * force + drag * Math.max(0, -zUp);
      resistance += drag;
      yaw += lever * drag;
    }
    if (impact && t < .45) {
      const lever = (impact.x * cb + impact.up * sb) * cp;
      const rotated = impact.up * cb - impact.x * sb;
      const longitudinal = impact.z * cp + rotated * sp;
      const depth = -(s.height + rotated * cp - impact.z * sp);
      const entry = Math.max(0, lever*s.bankRate + longitudinal*s.pitchVelocity - s.verticalSpeed);
      const wet = clamp(Math.max(0, depth)/.12, 0, 1) * (1 - t/.45);
      const slam = .5 * WATER_DENSITY * impactArea * wet * entry**2;
      const drag = .5 * WATER_DENSITY * .10 * wet * s.groundSpeed**2;
      moments[panelIndex(side)] += slam * cb * cp * Math.max(0, Math.abs(impact.x) - hinge);
      vertical += slam;
      pitch -= longitudinal * slam;
      roll -= lever * slam;
      yaw += lever * drag;
      resistance += drag;
    }
    panels.forEach((panel, index) => {
      const x = index ? half : -half;
      const tip = panel.position(x, wingUp(x) + bendAt(x,t));
      const tipHeight = s.height + (tip.up * cb - tip.x * sb) * cp;
      panel.advance(moments[index], airFraction, tipHeight, s.bank, s.pitch, dt);
      if (panel.failed && brokenAt[index] === Infinity) brokenAt[index] = t;
    });
    // Smooth the final fraction of the finite replay into the settled pose.
    const settle = clamp((WATER_RUNOUT_SECONDS - t) / .55, 0, 1);
    const v = (s.verticalSpeed + vertical / mass * dt) * settle;
    const p = (s.bankRate + roll / profile.rollInertia * dt) * Math.exp(-.7*dt) * settle;
    const q = (s.pitchVelocity + pitch / profile.pitchInertia * dt) * Math.exp(-1.4*dt) * settle;
    const r = (s.yaw + yaw / (profile.rollInertia + profile.pitchInertia) * dt) * Math.exp(-2.5*dt) * settle;
    const speed = Math.max(0, s.groundSpeed - resistance / mass * dt) * settle;
    const heading = s.heading + dt * (r + s.yaw) / 2;
    const track = contact.track + heading - contact.heading;
    const travel = dt * (s.groundSpeed + speed) / 2;
    s = { leftFold: panels[0].fold, rightFold: panels[1].fold, height: s.height + dt*(v+s.verticalSpeed)/2, verticalSpeed: v, bank: s.bank + dt*(p+s.bankRate)/2,
      pitch: s.pitch + dt*(q+s.pitchVelocity)/2, bankRate: p, pitchVelocity: q, yaw: r, heading,
      forward: s.forward + travel*Math.cos(track), right: s.right + travel*Math.sin(track), groundSpeed: speed };
    samples.push(s);
  }
  return { samples, hull, brokenAt, tipAt, half };
}

export function waterEntry(contact, hull, time) {
  let record = cached.get(contact);
  if (!record || record.hull !== hull) {
    record = history(contact,hull);
    cached.set(contact,record);
  }
  const pos = time * HZ, index = Math.floor(pos), fraction = pos - index;
  const a = record.samples[index], b = record.samples[index+1] ?? a;
  const mix = key => a[key] + fraction * (b[key] - a[key]);
  const s = Object.fromEntries(Object.keys(a).map(key => [key,mix(key)]));
  // Hermite interpolation preserves position and its first derivative when
  // seeking across physics steps, including the instant of water contact.
  function smooth(key, rateA, rateB) {
    const d = b[key] - a[key], f = fraction;
    const c2 = 3*d - (2*rateA + rateB)/HZ, c3 = -2*d + (rateA + rateB)/HZ;
    s[key] = a[key] + f*(rateA/HZ + f*(c2 + f*c3));
    return rateA + HZ*f*(2*c2 + 3*f*c3);
  }
  s.pitchVelocity = smooth('pitch',a.pitchVelocity,b.pitchVelocity);
  s.bankRate = smooth('bank',a.bankRate,b.bankRate);
  s.yaw = smooth('heading',a.yaw,b.yaw);
  s.verticalSpeed = smooth('height',a.verticalSpeed,b.verticalSpeed);
  const trackA = contact.track + a.heading - contact.heading, trackB = contact.track + b.heading - contact.heading;
  smooth('forward', a.groundSpeed*Math.cos(trackA), b.groundSpeed*Math.cos(trackB));
  smooth('right', a.groundSpeed*Math.sin(trackA), b.groundSpeed*Math.sin(trackB));
  s.track = contact.track + s.heading - contact.heading;
  const [left, right] = record.brokenAt.map(t => time >= t);
  return { ...s, leftTip: record.tipAt(-record.half,time), rightTip: record.tipAt(record.half,time),
    failedSide: left && right ? 'both' : left ? 'left' : right ? 'right' : null };
}
