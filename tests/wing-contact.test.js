import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { CG_HEIGHT } from '../src/domain/flight.js';
import { aircraftShoreContact } from '../src/domain/shoreline.js';
import { WING_STRUCTURE } from '../src/domain/wing-structure.js';
import { geometryAt, hullAtControls } from '../src/domain/water-contact.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { createQx25Aircraft } from '../src/rendering/aircraft/qx25.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' vs ' + b);
for (const [id, factory] of [['ryukai', createAircraft], ['qx25', createQx25Aircraft]]) {
  test(id + ' の外皮・桁・リブのたわみ、ねじれ、破損を左右独立に再現し、接水位置を描画頂点に一致させる', () => {
    const model = factory(), hull = modelHull(model);
    const parts = [];
    model.getObjectByName('main-wing').traverse(part => { if (part.geometry) parts.push(part); });
    const wing = { leftTip: .65, rightTip: -.35, leftTwist: -.05, rightTwist: .06 };
    const point = new Vector3();
    const failures = [[undefined, 0, 0], ['left', 8000, 0], ['right', 0, 7000],
      ['left', -6000, 0], ['right', 0, -8000], ['both', 7000, -8000], ['both', -8000, 7000]];
    for (const [failedSide, leftMoment, rightMoment] of failures) {
      const loaded = { ...wing, failedSide, leftMoment, rightMoment };
      model.userData.poseMechanisms({ t: 3, wing: loaded });
      const vertices = [...hull.bodySpatial];
      for (const part of parts) {
        const side = part.userData.wingSide < 0 ? 'left' : 'right';
        const broken = failedSide === side || failedSide === 'both';
        const moment = loaded[side + 'Moment'];
        assert.deepEqual(part.morphTargetInfluences,
          [wing[side + 'Tip'], wing[side + 'Twist'], Number(broken && moment > 0), Number(broken && moment < 0)]);
        if (!part.isMesh) continue;
        for (let i = 0; i < part.geometry.attributes.position.count; i++) {
          part.getVertexPosition(i, point);
          vertices.push([point.z, point.y - CG_HEIGHT, point.x]);
        }
      }
      for (const bank of [-.35, .42]) {
        const pitch = .18;
        const expected = geometryAt(pitch, vertices, bank);
        const actual = geometryAt(pitch, hullAtControls(hull, 0, 0, loaded), bank);
        for (const field of ['bottom', 'aft', 'contactAft', 'contactSide', 'tailSide']) near(actual[field], expected[field]);
      }
    }
    model.userData.poseMechanisms({ wing });
    for (const part of parts) assert.deepEqual(part.morphTargetInfluences, [0, 0, 0, 0]);
    const leadingMesh = model.getObjectByName(id === 'ryukai' ? 'right-wing-skin' : '1-leading-shell');
    const position = leadingMesh.geometry.attributes.position;
    let tipX = 0, leading = 0, root = 0;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      if (x > tipX || (x === tipX && position.getZ(i) < position.getZ(leading))) {
        tipX = x;
        leading = i;
      }
      if (x === 0) root = i;
    }
    const unloaded = leadingMesh.getVertexPosition(leading, new Vector3());
    const rootY = leadingMesh.getVertexPosition(root, point).y;
    const referenceTip = WING_STRUCTURE[id].referenceTip;
    model.userData.poseMechanisms({ t: 8, wing: { ...wing, rightTip: referenceTip, rightTwist: 0 } });
    near(leadingMesh.getVertexPosition(leading, point).y - unloaded.y, referenceTip);
    model.userData.poseMechanisms({ t: 8, wing: { ...wing, rightTip: 0, rightTwist: .04 } });
    assert.ok(leadingMesh.getVertexPosition(leading, point).y > unloaded.y);
    near(leadingMesh.getVertexPosition(root, point).y, rootY);
    // A root overload is visible at 20% semi-span, well inboard of the tip.
    let inner = 0;
    for (let i = 1; i < position.count; i++) {
      if (Math.abs(position.getX(i) - .2 * tipX) < Math.abs(position.getX(inner) - .2 * tipX)) inner = i;
    }
    model.userData.poseMechanisms({ t: 7, wing });
    const intact = leadingMesh.getVertexPosition(inner, new Vector3());
    for (const sign of [-1, 1]) {
      model.userData.poseMechanisms({ t: 7, wing: { ...wing, failedSide: 'right', rightMoment: sign * 8000 } });
      leadingMesh.getVertexPosition(inner, point);
      assert.ok(sign * (point.y - intact.y) > 1);
      assert.ok(point.x < intact.x);
      near(leadingMesh.getVertexPosition(root, point).y, rootY);
    }
    model.userData.poseMechanisms({ t: 15, wing });
    for (const part of parts) assert.equal(part.morphTargetInfluences[2], 0);
  });
}

test('バンク時の翼端がたわんで岸線に届くと進入を検出する', () => {
  const hull = modelHull(createAircraft());
  const wing = { leftTip: 0, rightTip: 0, leftTwist: 0, rightTwist: 0 };
  const pose = { right: 0, forward: 0, heading: 0, pitch: 0, bank: .35, wing };
  const [, y, x] = hull.wingTips.right;
  const shoreRight = x * Math.cos(pose.bank) + (y + .6) * Math.sin(pose.bank);
  const hit = aircraftShoreContact(hull, (fromX, fromY, toX) =>
    fromX >= shoreRight ? 0 : toX >= shoreRight ? (shoreRight - fromX) / (toX - fromX) : null);
  assert.equal(hit(pose, pose), null);
  const raised = { ...pose, wing: { ...wing, rightTip: 1.2 } };
  near(hit(pose, raised), .5);
});

test('QX-25主桁の1Gたわみを半スパンの四分点で三面図に照合する', () => {
  const model = createQx25Aircraft();
  const spar = model.getObjectByName('1-main-spar'), positions = spar.geometry.attributes.position;
  model.userData.poseMechanisms({ t: 6, wing: { leftTip: 0, rightTip: 1.234, leftTwist: 0, rightTwist: 0 } });
  const point = new Vector3(), halfSpan = positions.getX(positions.count - 1);
  for (const [fraction, expected] of [[.25, .10], [.5, .36], [.75, .74]]) {
    const station = fraction * halfSpan;
    let after = 0;
    while (positions.getX(after) < station) after++;
    const before = after - 1, a = positions.getX(before), b = positions.getX(after);
    const travel = i => spar.getVertexPosition(i, point).y - positions.getY(i);
    const interpolated = travel(before) + (station - a) / (b - a) * (travel(after) - travel(before));
    assert.ok(Math.abs(interpolated - expected) < .001);
  }
});
