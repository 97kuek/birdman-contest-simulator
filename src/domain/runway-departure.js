import { CG_HEIGHT } from './aircraft-dynamics.js';

// Radius of 聯's modelled tyre. A wheel can briefly unload and touch again
// while the pilot is still accelerating on the runway.
const tyreRadius = .072;

export function createRunwayDeparture(profile) {
  let liftOff = null, departureComplete = false;
  return {
    get liftOff() { return liftOff; },
    supportWheel(state, shape, clearance, watts, seconds) {
      if (!liftOff && clearance >= tyreRadius)
        liftOff = { seconds, forwardTravel: state.forward - profile.releaseWheelAft };
      // A low skip may already be visible to the crew. Keep the wheels
      // available until the aircraft has climbed one undercarriage depth.
      if (clearance >= profile.deckClearance) departureComplete = true;
      if (departureComplete || clearance >= 0 || watts <= 0) return false;
      const { contactAft: aft, contactSide: side } = shape;
      // geometryAt returns the contact in level axes, also when banked.
      const hubUp = tyreRadius - profile.deckClearance - CG_HEIGHT;
      const hubSide = hubUp * Math.sin(state.bank);
      const pitchOffset = hubUp * Math.cos(state.bank) * Math.sin(state.pitch);
      if (!profile.wheelStations.some(z => Math.hypot(aft - z * Math.cos(state.pitch) - pitchOffset, side - hubSide) <= tyreRadius))
        return false;

      // An inelastic runway normal arrests only the downward speed at this
      // wheel. The same impulse changes the CG velocity and angular rates.
      const downward = aft * state.q + side * state.p - state.w;
      if (downward > 0) {
        const impulse = downward / (1 / profile.mass + aft ** 2 / profile.pitchInertia + side ** 2 / profile.rollInertia);
        state.w += impulse / profile.mass;
        state.q -= aft * impulse / profile.pitchInertia;
        state.p -= side * impulse / profile.rollInertia;
      }
      state.height = -shape.bottom;
      return true;
    },
  };
}
