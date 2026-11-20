// Static torsion of a clamped-free half wing, strip aerodynamics, constant GJ.
// Usage: node analysis/ren-divergence.js [GJ_Nm2] [EA_minus_AC_fraction] [speed_mps]
import { pathToFileURL } from 'node:url';
import { AIR_DENSITY, CRUISE_AIRCRAFT } from '../src/domain/powered-cruise.js';
import { criticalPressure } from '../src/domain/ren-divergence.js';

const plane = CRUISE_AIRCRAFT.ren;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [rigidity = 2000, offset = .10, speed = plane.speed] = process.argv.slice(2).map(Number);
  if (!Number.isFinite(speed) || speed < 0) throw new RangeError('Invalid airspeed');
  const qD = criticalPressure({ rigidity, offset });
  const q = .5 * AIR_DENSITY * speed ** 2;
  console.log('仮定 GJ %s N·m²、弾性軸−空力中心 %s 翼弦、対気速度 %s m/s', rigidity, offset, speed);
  console.log('臨界動圧 %s Pa、発散速度 %s m/s、動圧比 q/qD %s', qD.toFixed(2),
    Math.sqrt(2 * qD / AIR_DENSITY).toFixed(2), (q / qD).toFixed(3));
  console.log(q >= qD ? '一次ねじりモードの静的安定限界を超過' :
    offset <= 0 ? 'この線形モデルでは正の発散動圧なし' : '一次ねじりモードは静的に安定');
}
