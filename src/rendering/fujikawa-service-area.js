import * as THREE from 'three';
import { addRigidAssembly, box, mesh, shaded } from './aircraft/mesh-parts.js';

// The cockpit film shows an open equipment lorry, then parked vans along the
// western verge. Their positions describe the test day rather than fixed buildings.
export function addServiceVehicles(facility, heightAt) {
  const white = shaded('#dfddd1'), body = shaded('#959e9a'), glass = shaded('#475c60');
  const rubber = shaded('#33383a'), alloy = shaded('#a6aaa4'), red = shaded('#af4538');
  const part = new THREE.Group();
  function runningGear(width, axles, radius) {
    for (const sign of [-1, 1]) for (const z of axles) {
      for (const [r, depth, offset, mat] of [[radius, .19, 0, rubber], [radius * .53, .025, .105, alloy]]) {
        const wheel = mesh(part, new THREE.CylinderGeometry(r, r, depth, 16), mat, 'wheel');
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sign * (width / 2 - .09 + offset), radius, z);
      }
    }
  }
  function park(name, x, forward, yaw) {
    const vehicle = new THREE.Group();
    vehicle.name = part.name = name;
    addRigidAssembly(vehicle, part);
    part.clear();
    vehicle.position.set(x, 0, -forward);
    const terrainPoint = facility.localToWorld(vehicle.position.clone());
    vehicle.position.y = heightAt(terrainPoint.x, terrainPoint.z);
    vehicle.rotation.y = yaw;
    facility.add(vehicle);
  }
  // Cab-over lorry with an open rear bay and a lowered loading platform.
  box(part, [0,.53,0], [1.69,.24,5.99], rubber, 'chassis');
  box(part, [0,.93,-2.21], [1.89,.84,1.53], white, 'cab');
  box(part, [0,1.65,-2.17], [1.80,.69,1.29], glass, 'windscreen');
  box(part, [0,2.03,-2.12], [1.90,.12,1.47], white, 'cab-roof');
  for (const sign of [-1,1]) {
    box(part, [sign*.9,1.67,-1.53], [.08,.68,.18], white, 'cab-pillar');
    box(part, [sign*.61,.97,-2.985], [.36,.16,.03], alloy, 'headlamp');
    box(part, [sign*1.005,1.97,.86], [.06,2.25,4.45], white, 'cargo-side');
    box(part, [sign*.78,.77,3.04], [.27,.14,.035], red, 'tail-lamp');
  }
  box(part, [0,1.98,-1.36], [2.0,2.25,.08], body, 'cargo-bulkhead');
  box(part, [0,3.10,.86], [2.08,.09,4.51], white, 'cargo-roof');
  box(part, [0,.90,.86], [2.08,.14,4.51], rubber, 'cargo-floor');
  box(part, [0,.59,3.56], [1.94,.08,1.03], alloy, 'tail-lift');
  runningGear(1.9, [-2.12,1.83], .35);
  park('試験班の機材車', -26.4, 213, -.06);

  for (const [x, forward, angle, paint] of [[-25,233,-.19,white],[-26,251,.08,body]]) {
    box(part, [0,.75,0], [1.65,.86,4.18], paint, 'van-body');
    box(part, [0,1.40,.05], [1.56,.55,3.70], glass, 'van-glazing');
    box(part, [0,1.73,.06], [1.64,.12,3.85], paint, 'van-roof');
    for (const side of [-1,1]) {
      for (const z of [-1.58,-.52,.97,1.80]) box(part,[side*.78,1.39,z],[.08,.62,.10],paint,'pillar');
      box(part,[side*.70,.92,2.10],[.14,.28,.04],red,'tail-lamp');
    }
    runningGear(1.63, [-1.25,1.23], .29);
    park('試験班の待機車', x, forward, angle);
  }
}
