import assert from 'node:assert/strict';
import test from 'node:test';
import { Raycaster, Vector3 } from 'three';
import { createAircraft } from '../src/rendering/aircraft.js';
import { createCockpitDisplay } from '../src/rendering/aircraft/display.js';
import { createQx25Aircraft } from '../src/rendering/aircraft/qx25.js';
import { createRenAircraft } from '../src/rendering/aircraft/ren.js';

test('全機の計器でCanvasの左上をGLB表示面の左上に写す', t => {
  globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
  t.after(() => { delete globalThis.document; });
  for (const [aircraftId, create] of [
    ['ren', createRenAircraft], ['ryukai', createAircraft], ['qx25', createQx25Aircraft],
  ]) {
    const aircraft = create();
    createCockpitDisplay(aircraft, { aircraftId, describe() {} });
    const face = aircraft.getObjectByName('cockpit-screen');
    const { position, uv } = face.geometry.attributes;
    assert.equal(face.material.map.flipY, false);
    for (let i = 0; i < position.count; i++) {
      assert.equal(uv.getX(i), position.getX(i) < 0 ? 0 : 1);
      assert.equal(uv.getY(i), position.getY(i) > 0 ? 0 : 1);
    }
  }
});

test('聯のGPSはペダルが一周しても操縦者から四隅まで見える', () => {
  const aircraft = createRenAircraft();
  const screen = aircraft.getObjectByName('cockpit-screen');
  screen.geometry.computeBoundingBox();
  const { min, max } = screen.geometry.boundingBox;
  const objects = [];
  aircraft.traverseVisible(part => {
    if (part.isMesh && !part.material.transparent) objects.push(part);
  });
  for (let step = 0; step < 24; step++) {
    aircraft.userData.poseMechanisms({ crankAngle: step * Math.PI / 12 });
    aircraft.updateMatrixWorld(true);
    const eye = aircraft.getObjectByName('pilot-eye').getWorldPosition(new Vector3());
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        const corner = screen.localToWorld(new Vector3(.96 * x, .96 * y, max.z));
        const direction = corner.sub(eye);
        const ray = new Raycaster(eye, direction.clone().normalize(), .012, direction.length() + .0001);
        assert.equal(ray.intersectObjects(objects, false)[0]?.object.name, 'cockpit-screen');
      }
    }
  }
});
