import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, Group, Plane, Triangle, Vector3 } from 'three';
import { FlightSession } from '../src/application/flight-session.js';
import { aircraftDynamics, releaseState } from '../src/domain/aircraft-dynamics.js';
import { BASE_DESIGN, launchProfile, poseAt, waterRunoutPose } from '../src/domain/flight.js';
import { bodyShiftFromCg, cgShiftFromBody, PILOT_SHIFT } from '../src/domain/pilot-shift.js';
import { GRAVITY } from '../src/domain/units.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { createAircraftPose } from '../src/rendering/aircraft-pose.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' vs ' + expected);

test('前後の身体変位と空気力の法線成分から全機重心まわりのモーメントを求める', () => {
  const launch = launchProfile(), state = releaseState(launch, true, true);
  const { rates } = aircraftDynamics(BASE_DESIGN, launch, { weather: 'calm', referenceControl: false, pilot: true,
    wind: true, returnSeconds: .45, onsetMetres: 0 });
  state.pitch = -.12;
  const neutral = rates({ ...state, bodyShift: 0 }, 0, 0, 0);
  const normal = 100 * ((neutral.w + GRAVITY) * Math.cos(state.pitch) - neutral.u * Math.sin(state.pitch));
  for (const metres of [-.10, .05, .10]) {
    const expectedCg = (100 - 48 - 4) * metres / 100;
    close(cgShiftFromBody(metres), expectedCg);
    close(bodyShiftFromCg(expectedCg), metres);
    const displaced = rates({ ...state, bodyShift: metres }, 0, 0, 0);
    close((displaced.q - neutral.q) * 51, normal * expectedCg);
  }
  const session = new FlightSession([[-1,-.45],[1,-.45]], 'head');
  const attempt = session.startAttempt();
  close(attempt.advance(session.launch.duration - .001, 0, 0).sample.shift, session.onDeck.shift);
  close(attempt.advance(session.launch.duration, 0, 0).sample.shift, session.onDeck.shift);
  close(attempt.samples[0].pitchRate, -14 * Math.PI / 180);
  attempt.advance(session.launch.duration + .1, 0, 0);
  const middle = poseAt({ samples: attempt.samples, duration: .1 }, .025);
  close(middle.pitchRate, (attempt.samples[0].pitchRate + attempt.samples[1].pitchRate) / 2);
});

// Each triangle plane bounds the interior of its own pair of pod cross-sections.
// Use the actual shell mesh, including the narrowing tail, in aircraft-local axes.
function podSegments(model) {
  const segments = new Map();
  for (const name of ['clear-nose', 'pilot-pod']) {
    const { attributes, index } = model.getObjectByName(name).geometry;
    const vertex = i => new Vector3().fromBufferAttribute(attributes.position, index.getX(i));
    for (let i = 0; i < index.count; i += 3) {
      const tri = new Triangle(vertex(i), vertex(i + 1), vertex(i + 2));
      const lo = Math.min(tri.a.z, tri.b.z, tri.c.z), hi = Math.max(tri.a.z, tri.b.z, tri.c.z);
      if (lo === hi) continue;
      if (!segments.has(lo)) segments.set(lo, { lo, hi, planes: [] });
      segments.get(lo).planes.push(tri.getPlane(new Plane()));
    }
  }
  return [...segments.values()];
}

test('9姿勢で身体と目がポッド内に収まり、機首の計器までの余裕と両手の位置を保つ', () => {
  const model = createAircraft(), base = new Group();
  base.add(model);
  const pilot = model.getObjectByName('pilot'), body = pilot.getObjectByName('pilot-weight-shift');
  const grip = pilot.getObjectByName('pilot-grip-skin'), eye = pilot.getObjectByName('pilot-eye');
  const panel = model.getObjectByName('cockpit-display-mount');
  const skin = podSegments(model), point = new Vector3();
  const position = createAircraftPose({ modelBase: base, aircraft: model, view: () => 'pilot', display: { update() {} } });
  const panelBack = Math.max(...[-.0415,.0415].map(y => panel.localToWorld(new Vector3(0,y,0)).z));
  grip.updateWorldMatrix(true,false);
  const initialGrip = grip.matrixWorld.clone();
  for (let i = -4; i <= 4; i++) {
    const displacement = i * PILOT_SHIFT.maxBodyTravel / 4;
    position.pose({ t: 2, heading: 0, pitch: 0, right: 0, forward: 0, height: .45, shift: cgShiftFromBody(displacement) });
    base.updateMatrixWorld(true);
    close(body.position.z, displacement);
    close(eye.getWorldPosition(point).z, -.86 + displacement);
    assert.ok(point.z - panelBack > .19);
    const eyeSection = skin.find(s => point.z >= s.lo && point.z <= s.hi);
    assert.ok(eyeSection.planes.every(p => p.distanceToPoint(point) < -.20));
    assert.ok(new Box3().setFromObject(body, true).min.z - panelBack > .20);
    assert.deepEqual(grip.matrixWorld, initialGrip);
    pilot.traverse(mesh => {
      if (!mesh.isMesh) return;
      const attr = mesh.geometry.attributes.position;
      for (let j = 0; j < attr.count; j++) {
        point.fromBufferAttribute(attr, j).applyMatrix4(mesh.matrixWorld);
        const segment = skin.find(s => point.z >= s.lo && point.z <= s.hi);
        assert.ok(segment && segment.planes.every(p => p.distanceToPoint(point) < -.025), mesh.name);
      }
    });
  }
});

test('滑走中の角速度は描画姿勢に従い、停止すると回転によるピトー速度が消える', () => {
  const state = { heading: .8, track: .9, bank: -.1, pitch: .06, groundSpeed: 10,
    headwind: 99, pitchRate: 1, updraft: 2, forward: 0, right: 0, verticalSpeed: -.3, shift: .02, rudderDeg: 3 };
  const wind = { headwind: 1.2, crosswind: -.5, updraft: 0 }, hull = [[-1,-.45],[1,-.45]];
  const at = t => waterRunoutPose(state, t, hull, wind);
  const p = at(1.2), dt = .00001;
  const pitchDerivative = (at(1.2+dt).pitch - at(1.2-dt).pitch)/(2*dt);
  close(p.pitchRate, pitchDerivative * Math.cos(p.bank));
  const rest = at(4);
  close(rest.pitchRate, 0);
  close(rest.headwind, wind.headwind * Math.cos(state.heading) + wind.crosswind * Math.sin(state.heading));
  close(rest.updraft, 0);
});
