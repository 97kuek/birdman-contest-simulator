export const runwayLength = 850;
export const runwayHalfWidth = 15;
export const runwayVerge = 8;
export function isOnPavement(right, forward) {
  return Math.abs(right) <= runwayHalfWidth && forward >= 0 && forward <= runwayLength;
}

// Illustrative waiting stations along the 850 m runway, measured from its
// south threshold. Catchers initially wait just outside the paved strip.
export const catcherStations = Object.freeze([64, 190, 320, 450, 580, 710, 825]);
export const catcherRunSpeed = 4.5;
export const catcherVerge = 18.2;

const vergeRunLength = 100;
const vergePaceRatio = .5;
function vergePosition(station, aircraftForward) {
  const jog = Math.max(0, (aircraftForward - station + vergeRunLength) * vergePaceRatio);
  return Math.min(runwayLength, station + vergeRunLength, station + jog);
}

// The crew wait off the pavement and start jogging as the glider approaches.
export function waitingCatcher(station, side, offset, aircraftForward) {
  const alongVerge = vergePosition(station, aircraftForward);
  return { right: side * catcherVerge, forward: alongVerge + offset,
    jogging: alongVerge > station && alongVerge < Math.min(runwayLength, station + vergeRunLength), holding: false };
}
export const rearCatchPoints = Object.freeze({
  frame: { side: -1, right: -.36, aft: .90, offset: -5 },
  tail: { side: 1, right: .29, aft: 5.83, offset: -7 },
});

export function predictedCatcherStation(sample) {
  // Select the crew nearest a short running intercept, while the plane
  // is still rolling fast enough for their braking force to matter.
  const interceptSeconds = 5;
  const meetingPoint = sample.forward + sample.groundSpeed * Math.cos(sample.track) * interceptSeconds;
  return teamNearestMeetingPoint(meetingPoint);
}

function teamNearestMeetingPoint(forward) {
  const distance = station => Math.abs(vergePosition(station, forward) - forward);
  return catcherStations.reduce((a, b) => distance(a) <= distance(b) ? a : b);
}

// Estimate the room needed for the pilot to react, descend with the propeller
// stopped and roll to a halt. These are simulator margins, not field procedures.
export function shouldCallForLanding(sample, runwayLength) {
  const along = sample.groundSpeed * Math.cos(sample.track);
  if (Math.abs(along) < .5) return false;
  const remaining = along > 0 ? runwayLength - sample.forward : sample.forward;
  const reactionSeconds = 5, descentMetresPerSecond = .22, deceleration = .22;
  const airSeconds = reactionSeconds + Math.max(0, sample.bottomHeight) / descentMetresPerSecond;
  const rollout = Math.abs(along) * sample.groundSpeed / (2 * deceleration);
  return remaining <= Math.abs(along) * airSeconds + rollout + 32;
}

// The ground team can approach a descending aircraft without supporting it.
// Estimate the meeting point only over the last few seconds of the approach.
export const wingGripSpan = 12.5;
// Distances are modelled lanes, not positions surveyed from the film. Relative
// to the centreline trial, one wing runner stays on the grass for longer.
export const wingLaneStagger = 1.5;
const approachHorizon = 9;
const laneResponseSeconds = 1.2;
const minimumAlongSpeed = 2;
export const catcherSprint = 6.2;
const turnInSeconds = 2;
export const catcherSideGap = 2.2;
const catcherPoints = {
  left: { side: -1, right: -wingGripSpan, aft: .28, offset: 0, entryHorizon: 5, wing: true },
  right: { side: 1, right: wingGripSpan, aft: .28, offset: 0, entryHorizon: 5, wing: true },
  frame: { ...rearCatchPoints.frame, entryHorizon: approachHorizon, laneGap: 1.4 },
  tail: { ...rearCatchPoints.tail, entryHorizon: 8, laneGap: catcherSideGap },
};

export function moveRunner(member, right, forward, maxTravel) {
  const dx = right - member.right, df = forward - member.forward;
  const distance = Math.hypot(dx, df);
  const fraction = distance ? Math.min(1, maxTravel / distance) : 0;
  return { right: member.right + fraction * dx, forward: member.forward + fraction * df, holding: false };
}

export function waitingTeam(station, forward) {
  const team = { station };
  for (const [name, point] of Object.entries(catcherPoints))
    team[name] = waitingCatcher(station, point.side, point.offset, forward);
  return team;
}

export function advanceCatcherApproach(team, sample, dt, wingStagger = wingLaneStagger) {
  const timeToGround = sample.verticalSpeed < 0 ? Math.max(0, sample.bottomHeight) / -sample.verticalSpeed : Infinity;
  const approaching = timeToGround <= approachHorizon && sample.bottomHeight <= 2;
  if (!approaching && !team) return null;
  const lead = Math.min(approachHorizon, timeToGround);
  const ahead = sample.forward + lead * sample.groundSpeed * Math.cos(sample.track);
  const station = teamNearestMeetingPoint(ahead);
  team ??= waitingTeam(station, sample.forward);
  const next = { station: team.station };
  if (!approaching || (team.station !== station && Math.abs(sample.forward - team.station) > 80)) {
    const waiting = waitingTeam(team.station, sample.forward);
    let returned = true;
    for (const name of Object.keys(catcherPoints)) {
      const target = waiting[name];
      next[name] = moveRunner(team[name], target.right, target.forward, catcherRunSpeed * dt);
      if (Math.hypot(next[name].right - target.right, next[name].forward - target.forward) > .01) returned = false;
    }
    return returned ? null : next;
  }
  const cos = Math.cos(sample.heading), sin = Math.sin(sample.heading);
  const sx = Math.sin(sample.track), sf = Math.cos(sample.track);
  for (const [name, point] of Object.entries(catcherPoints)) {
    const laneGap = point.wing ? catcherSideGap + point.side * wingStagger : point.laneGap;
    const lateral = point.right + point.side * laneGap;
    // The wing team continues along the verges while the fuselage crew cuts
    // in. Blend the change of lane; nobody steps sideways across the runway.
    const progress = Math.min(1, Math.max(0, (point.entryHorizon - timeToGround) / turnInSeconds));
    const lane = sample.right + lateral * cos - point.aft * sin;
    const verge = point.side * catcherVerge;
    const targetRight = verge + (lane - verge) * progress;
    const targetForward = sample.forward - lateral * sin - point.aft * cos;
    const runner = team[name];
    const dx = targetRight - runner.right, df = targetForward - runner.forward;
    const along = Math.max(minimumAlongSpeed, sample.groundSpeed + (dx * sx + df * sf) / laneResponseSeconds);
    const inward = (dx * sf - df * sx) / laneResponseSeconds;
    next[name] = moveRunner(runner, runner.right + (along * sx + inward * sf) * dt,
      runner.forward + (along * sf - inward * sx) * dt, catcherSprint * dt);
  }
  return next;
}
