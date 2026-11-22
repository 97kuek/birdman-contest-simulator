import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { prepareSceneryLod } from '../src/rendering/terrain/scenery-lod.js';

test('会場の親座標・個体色を保ち、反射や望遠の各カメラで地物の精度を選び直す', () => {
  const site = new Group();
  site.position.set(120, 0, -180);
  site.rotation.y = .7;
  const geometry = new BoxGeometry();
  geometry.userData.venueLod = { indices: Array.from(geometry.index.array.slice(0, 12)), error: .06 };
  const source = new InstancedMesh(geometry, new MeshBasicMaterial(), 2);
  source.position.set(6, 2, 5);
  for (let i = 0; i < 2; i++) {
    source.setMatrixAt(i, new Matrix4().makeTranslation(i * 3, i, -10));
    source.setColorAt(i, new Color(.2 + i * .3, .3, .4));
  }
  site.add(source);
  site.updateMatrixWorld();
  const placement = new Matrix4();
  source.getMatrixAt(1, placement);
  placement.premultiply(source.matrixWorld);

  prepareSceneryLod(site);
  site.updateMatrixWorld();
  const cell = site.children[0].children[0];
  const [near, far] = cell.children;
  const m = new Matrix4(), c = new Color();
  const originalColour = new Color();
  source.getColorAt(1, originalColour);
  for (const mesh of [near, far]) {
    mesh.getMatrixAt(1, m);
    assert.deepEqual(m.premultiply(mesh.matrixWorld), placement);
    mesh.getColorAt(1, c);
    assert.ok(c.equals(originalColour));
    assert.strictEqual(mesh.material, source.material);
  }
  assert.strictEqual(far.geometry.attributes.uv, geometry.attributes.uv);
  const point = new Vector3().setFromMatrixPosition(placement);
  const camera = new PerspectiveCamera(70, 1.5, .1, 10000);
  function visible(z, fov, y, height = 1440) {
    camera.userData.renderHeight = height;
    camera.fov = fov;
    camera.position.copy(point).add(new Vector3(0, y, z));
    camera.lookAt(point);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    cell.update(camera);
    return [near.visible, far.visible];
  }
  assert.deepEqual(visible(8, 70, 1), [true, false]);
  assert.deepEqual(visible(160, 70, -8), [false, true]);
  assert.deepEqual(visible(160, 5, 1), [true, false]);
  assert.deepEqual(visible(40, 70, 1, 1440), [true, false]);
  assert.deepEqual(visible(40, 70, 1, 288), [false, true]);
  assert.deepEqual(visible(450, 70, 1, 288), [false, false]);
  assert.deepEqual(visible(450, 70, 1, 1266), [false, true]);
  assert.deepEqual(visible(6000, 70, 1), [false, false]);
});
