import assert from 'node:assert/strict';
import test from 'node:test';
import { Raycaster, Vector3 } from 'three';
import { createRenAircraft } from '../src/rendering/aircraft/ren.js';
import { matchingParts } from '../src/rendering/aircraft/model.js';

const position = node => node.getWorldPosition(new Vector3());

test('聯のクランク一周で両足の靴底がペダルに接し、膝と足首が一定長の脚でつながる', () => {
  const model = createRenAircraft();
  const crank = model.getObjectByName('pedal-crank');
  const [pedals, shoes, hips, knees, ankles, thighs, calves] = [
    'pedal', 'cycling-shoe', 'cycling-hip', 'cycling-knee', 'cycling-ankle', 'cycling-thigh', 'cycling-calf',
  ].map(name => matchingParts(model, name));
  model.position.set(24, 12, -5);
  model.rotation.set(.2, -.3, .4);
  for (let degree = 0; degree <= 360; degree++) {
    model.userData.poseMechanisms({ crankAngle: degree * Math.PI / 180 });
    model.updateMatrixWorld(true);
    const left = position(pedals[0]).sub(position(crank));
    const right = position(pedals[1]).sub(position(crank));
    assert.ok(left.clone().add(right).length() < 1e-6);
    for (const [i, pedal] of pedals.entries()) {
      const knee = position(knees[i]);
      const hip = position(hips[i]), ankle = position(ankles[i]);
      for (const [limb, start, end] of [[thighs[i], hip, knee], [calves[i], knee, ankle]]) {
        assert.ok(Math.abs(start.distanceTo(end) - limb.userData.jointLength) < 1e-6);
        assert.ok(position(limb).distanceTo(start.clone().lerp(end, .5)) < 1e-6);
        const axis = limb.localToWorld(new Vector3(0, 1, 0)).sub(position(limb)).normalize();
        assert.ok(axis.distanceTo(end.clone().sub(start).normalize()) < 1e-6);
      }
      // Cast against the exported triangles from inside the contact patch on
      // both deck rails. Rays from opposite sides meet at the tread surface.
      const normal = pedal.localToWorld(new Vector3(0, 1, 0)).sub(position(pedal)).normalize();
      for (const z of [-.021, .023]) {
        const from = pedal.localToWorld(new Vector3(.008, .10, z));
        const down = new Raycaster(from, normal.clone().negate());
        const platform = down.intersectObjects(pedal.children.filter(part => part.isMesh))[0];
        const below = from.addScaledVector(normal, -.20);
        const up = new Raycaster(below, normal);
        const tread = up.intersectObjects(shoes[i].children.filter(part => part.isMesh))[0];
        assert.ok(platform && tread);
        assert.ok(platform.point.distanceTo(tread.point) < 1e-6);
      }
    }
  }
});

test('聯の惰行でプロペラだけが回り、シークしても同じ踏み位置に戻る', () => {
  const model = createRenAircraft();
  const legs = ['pedal', 'cycling-shoe', 'cycling-knee', 'cycling-ankle'].flatMap(n => matchingParts(model, n));
  const pose = (crankAngle, propellerAngle) => {
    model.userData.poseMechanisms({ crankAngle, propellerAngle });
    model.updateMatrixWorld(true);
    return legs.map(part => part.matrixWorld.toArray());
  };
  const active = pose(2.2, 4.4);
  assert.deepEqual(pose(2.2, 12), active);
  assert.equal(model.getObjectByName('propeller').rotation.z, 12);
  pose(5, 18);
  assert.deepEqual(pose(2.2, 4.4), active);
});

test('左右の脚のスキンは各機体のボーンに追従する', () => {
  const a = createRenAircraft(), b = createRenAircraft();
  function calfVertices(model) {
    let leg;
    model.traverse(part => { if (part.isSkinnedMesh && part.material.name === 'skin') leg = part; });
    return matchingParts(model, 'cycling-calf').map(calf => {
      const boneIndex = leg.skeleton.bones.indexOf(calf);
      assert.ok(boneIndex >= 0);
      const { skinIndex, skinWeight } = leg.geometry.attributes;
      let index = 0;
      while (index < skinIndex.count && (skinIndex.getX(index) !== boneIndex || skinWeight.getX(index) !== 1)) index++;
      assert.ok(index < skinIndex.count);
      return () => leg.getVertexPosition(index, new Vector3());
    });
  }
  const vertices = [calfVertices(a), calfVertices(b)];
  for (const aircraft of [a, b]) aircraft.updateMatrixWorld(true);
  const atRest = vertices[1].map(read => read());
  a.userData.poseMechanisms({ crankAngle: Math.PI });
  a.updateMatrixWorld(true);
  for (const [i, p] of atRest.entries()) {
    assert.ok(vertices[0][i]().distanceTo(p) > .1);
    assert.ok(vertices[1][i]().distanceTo(p) < 1e-6);
  }
});
