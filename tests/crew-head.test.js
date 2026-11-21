import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, Raycaster, Vector3 } from 'three';
import { readModel } from '../analysis/model-fixture.js';
import { createCrewMembers } from '../src/rendering/crew-model.js';

test('全髪型で側頭部から頭頂まで地肌が髪を突き抜けない', async () => {
  const model = await readModel('ground-crew.glb');
  const head = model.getObjectByName('Head');
  const origin = head.getWorldPosition(new Vector3());
  const ray = new Raycaster();
  for (const style of ['HairSwept', 'HairCrop', 'HairTied']) {
    const hair = model.getObjectByName(style);
    if (hair.userData.crewRestScale) hair.scale.fromArray(hair.userData.crewRestScale);
    hair.updateWorldMatrix(true, true);
    function assertHair(point, direction) {
      ray.set(point.add(origin), direction);
      const [hit] = ray.intersectObjects([head, hair]);
      assert.ok(hit, style + ' misses head');
      assert.match(hit.object.material.name, /^Hair(Light)?$/, style + ' at ' + point.toArray());
    }
    // Grazing view of the temple from the launch camera.
    const temple = new Vector3(-.084, .070, .015);
    const towardFace = new Vector3(.35, -.112, .83).normalize();
    assertHair(temple.addScaledVector(towardFace, -1), towardFace);
    for (const y of [.073, .088, .106, .123, .134]) {
      for (let i = 0; i < 48; i++) {
        const angle = i * Math.PI / 24;
        const dir = new Vector3(Math.cos(angle), 0, Math.sin(angle));
        // Aim cardinal rays exactly along the axis at the hair mesh seam.
        if (i % 12 === 0) dir.set(Math.round(dir.x), 0, Math.round(dir.z));
        // At the forehead the sloping fringe may legitimately reveal skin.
        if (dir.z < -.6 && y < .088) continue;
        assertHair(new Vector3(dir.x, y, dir.z), dir.negate());
      }
    }
  }
});

test('地上クルーは同じGLBの首・選んだ髪・手足を使い、靴底を原点に置く', async () => {
  const model = await readModel('ground-crew.glb');
  // A rest-pose edit to the neck or a hairstyle in Blender must reach the game.
  model.getObjectByName('Neck').position.y += .05;
  const members = createCrewMembers(model, 'ren', 4);
  const position = object => object.getWorldPosition(new Vector3());
  const vertexCount = node => {
    let count = 0;
    node.traverse(part => { if (part.isMesh) count += part.geometry.attributes.position.count; });
    return count;
  };
  const head = model.getObjectByName('Head');
  const offset = position(head).sub(position(model.getObjectByName('Torso')));
  for (const member of members) {
    const hair = model.getObjectByName(member.style);
    assert.equal(member.head.geometry.attributes.position.count, vertexCount(head) + vertexCount(hair));
    assert.ok(member.head.position.distanceTo(offset) < 1e-5);
    for (const side of ['L', 'R']) {
      const index = side === 'L' ? 0 : 1;
      for (const [limb, name] of [[member.arms[index], 'Arm'], [member.legs[index], 'Leg']]) {
        for (const [part, suffix] of [[limb.upper, 'Upper'], [limb.lower, 'Lower'], [limb.end, 'End']]) {
          const source = model.getObjectByName(side + '_' + name + suffix);
          assert.equal(part.geometry.attributes.position.count, vertexCount(source));
          assert.ok(part.position.distanceTo(position(source)) < 1e-5);
        }
      }
      assert.ok(Math.abs(new Box3().setFromObject(member.legs[index].end, true).min.y) < 1e-4);
    }
  }
  assert.equal(model.getObjectByName('HairCrop').scale.length(), 0);
  assert.equal(model.getObjectByName('HairTied').scale.length(), 0);
});
