// Reference free-flight spar from the 3D outline. Station is measured outboard
// from the centreline. Height and local slope describe the same curved wing.
const rootSlope = Math.tan(4 * Math.PI / 180);
const halfSpan = 16.1, tipBend = 1.43, bendExponent = 2.5;

export function renSparHeight(station) {
  const x = Math.abs(station);
  return 1.535 + x * rootSlope + tipBend * (x / halfSpan) ** bendExponent;
}

export function renSparOutboardSlope(station) {
  return rootSlope + tipBend * bendExponent / halfSpan * (Math.abs(station) / halfSpan) ** (bendExponent - 1);
}

// Chords at the panel joints on the Windnauts three-view (2023, p.20), metres.
export const wingStations = [[0, 1.053], [4.6, 1.053], [8.7, .859], [12.7, .768], [16.1, .471]];
export function renWingChord(station) {
  const x = Math.min(halfSpan, Math.abs(station));
  const i = Math.max(1, wingStations.findIndex(([end]) => x <= end));
  const [a, root] = wingStations[i - 1], [b, tip] = wingStations[i];
  return root + (tip - root) * (x - a) / (b - a);
}

// The drawing gives the guy-wire pickup at 8.40 m and a positive limit
// load of 1.5 g. Ultimate strength and modal damping are game assumptions.
export const REN_STRUCTURE = Object.freeze({
  wireStation: 8.4, limitLoad: 1.5, ultimateToLimit: 1.5,
  trimTip: tipBend, halfMass: .45 * 33.2 / 2, damping: .22,
});

// Bending at the first unsupported outboard panel. A lift ellipse and a
// linearly tapering mass distribution give different inertial relief arms.
function outboardArms() {
  let lift = 0, moment = 0, massMoment = 0;
  const strips = 96;
  for (let i = 0; i < strips; i++) {
    const x = (i + .5) / strips, arm = Math.max(0, x * halfSpan - REN_STRUCTURE.wireStation);
    const weight = Math.sqrt(1 - x*x);
    lift += weight;
    moment += weight * arm;
    massMoment += (1 - .8*x) / .6 * arm / strips;
  }
  return { lift: moment / lift, mass: massMoment };
}
const arms = outboardArms();
export function renWingResponse(left, right, state, mass, gravity) {
  const halfWeight = mass * gravity / 2;
  const reference = halfWeight * arms.lift - REN_STRUCTURE.halfMass * gravity * arms.mass;
  const capacity = reference * REN_STRUCTURE.limitLoad * REN_STRUCTURE.ultimateToLimit;
  const normal = (left + right) / mass;
  const omega = Math.sqrt(halfWeight / (REN_STRUCTURE.halfMass * REN_STRUCTURE.trimTip));
  function panel(force, tip = 0, velocity = 0) {
    const moment = force * arms.lift - REN_STRUCTURE.halfMass * normal * arms.mass;
    // Tip displacement is relative to the published free-flight outline.
    const target = REN_STRUCTURE.trimTip * (moment / reference - 1);
    return { moment, acceleration: omega * (omega * (target - tip) - 2 * REN_STRUCTURE.damping * velocity) };
  }
  const l = panel(left, state.leftTip, state.leftTipRate), r = panel(right, state.rightTip, state.rightTipRate);
  const maximum = Math.max(Math.abs(l.moment), Math.abs(r.moment));
  const failedSide = maximum < capacity ? null : Math.abs(l.moment) === Math.abs(r.moment) ? 'both'
    : Math.abs(l.moment) > Math.abs(r.moment) ? 'left' : 'right';
  return { leftMoment: l.moment, rightMoment: r.moment, leftTipAcceleration: l.acceleration,
    rightTipAcceleration: r.acceleration, leftTwist: 0, rightTwist: 0, utilization: maximum / capacity, limitMoment: capacity, failedSide };
}
