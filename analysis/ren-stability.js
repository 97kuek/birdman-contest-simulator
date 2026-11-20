// Local small-disturbance Jacobians at the 203 W free-air trim.
// node analysis/ren-stability.js matrix | Rscript -e 'd<-read.csv(file("stdin")); for (m in split(d,d$mode)) print(eigen(xtabs(value~row+col,m))$values)'
import { FlightSession } from '../src/application/flight-session.js';
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { releaseState } from '../src/domain/aircraft-dynamics.js';
import { poweredFlightDynamics } from '../src/domain/powered-flight.js';
import { launchProfile } from '../src/domain/launch.js';
import { RAD_PER_RPM } from '../src/domain/units.js';

const profile = aircraftProfile('ren'), plane = profile.propulsion;
if (process.argv[2] === 'matrix') {
  const launch = launchProfile();
  const dynamics = poweredFlightDynamics(profile, launch, 'calm', 0);
  const trim = { ...releaseState(launch, true, true, profile), height: 1e6, u: plane.speed, w: 0,
    omega: plane.rpm * RAD_PER_RPM };
  console.log('mode,row,col,value');
  for (const [mode, variables] of Object.entries({ longitudinal: ['u','w','pitch','q','omega'], lateral: ['v','bank','p','r'] })) {
    for (const col of variables) {
      const h = 1e-5 * Math.max(1, Math.abs(trim[col]));
      const rates = delta => dynamics.rates({ ...trim, [col]: trim[col] + delta }, 0, 0, 0);
      const plus = rates(h), minus = rates(-h);
      for (const row of variables) console.log([mode, row, col, (plus[row]-minus[row])/(2*h)].join(','));
    }
  }
} else {
  // Prescribed ground run, same heading, neutral controls, 203 W after release.
  const hull = [[-1,-.45],[1,-.45],[7,.4],[0,.9,-16.1],[0,.9,16.1]];
  console.log('weather,seconds,ground_speed,airspeed,cg_height_change,vertical_speed,pitch_deg,rotor_rpm');
  for (const weather of ['calm','tail','head']) {
    const session = new FlightSession(hull, weather, undefined, undefined, 'ren');
    const run = session.startAttempt(), release = session.launch.duration;
    const h0 = run.advance(release,0,0).sample.height;
    for (let i = 0; i <= 200; i++) {
      const {sample:s} = run.advance(release+i/20,0,0,203);
      console.log([weather,i/20,s.groundSpeed,s.speed,s.height-h0,s.verticalSpeed,s.pitch*180/Math.PI,s.rpm].join(','));
    }
  }
}
