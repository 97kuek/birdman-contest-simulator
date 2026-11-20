// Run with node analysis/ren-power-step.js. Heights refer to the centre of gravity.
import { createFlight, REN_DESIGN } from '../src/domain/flight.js';
import { RADIANS_PER_DEGREE } from '../src/domain/units.js';
import { createRenAircraft } from '../src/rendering/aircraft/ren.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const hull = modelHull(createRenAircraft());
const cruiseSeconds = 90;
console.log('rudder,watts,seconds,airspeed_mps,height_change_m,vertical_speed_mps,rpm,bank_deg,track_change_deg');
for (const rudder of [0, 1]) {
  for (const watts of [0, 203, 300]) {
    const flight = createFlight(REN_DESIGN, hull, { weather: 'calm' });
    flight.advanceTo(cruiseSeconds);
    const start = flight.current();
    for (let seconds = 0; seconds <= 10; seconds++) {
      flight.advanceTo(cruiseSeconds + seconds, 0, rudder, watts);
      const s = flight.current();
      if (s.t !== cruiseSeconds + seconds) throw new Error('Flight ended before comparison completed');
      const values = [s.speed, s.height - start.height, s.verticalSpeed, s.rpm,
        s.bank / RADIANS_PER_DEGREE, (s.track - start.track) / RADIANS_PER_DEGREE];
      console.log([rudder, watts, seconds, ...values.map(value => value.toFixed(6))].join(','));
    }
  }
}
