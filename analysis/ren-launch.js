// Deterministic deck-to-flight comparisons. Heights are CG relative to release.
import { FlightSession } from '../src/application/flight-session.js';

const hull = [[-1,-.45],[1,-.45],[7,.4],[0,.9,-16.1],[0,.9,16.1]];
console.log('wind,boost_s,roll_s,roll_m,release_ground_mps,release_air_mps,release_cg_m,min_delta_m,first_sink_arrest_s,delta_10s_m');
for (const [wind, boost] of [['calm',0],['head',0],['tail',0],['tail',3]]) {
  const session = new FlightSession(hull,wind,undefined,undefined,'ren');
  const attempt = session.startAttempt(), launch = session.launch;
  const release = attempt.advance(launch.duration,0,0).sample;
  let min = release.height, arrest = null, last;
  for (let k=1; k<=1200; k++) {
    last = attempt.advance(launch.duration+k/120,0,0,k/120 <= boost ? 300 : 203).sample;
    min = Math.min(min,last.height);
    if (arrest === null && last.verticalSpeed >= 0) arrest = k/120;
  }
  console.log([wind,boost,launch.duration,launch.releaseTravel,release.groundSpeed,release.speed,
    release.height,min-release.height,arrest,last.height-release.height].map(x=>typeof x==='number'?x.toFixed(3):x).join(','));
}
