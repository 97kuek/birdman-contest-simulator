import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

function reflectiveGlass(surface) {
  const normal = new THREE.Vector3().fromBufferAttribute(surface.geometry.attributes.normal, 0).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const geometry = surface.geometry.clone().applyQuaternion(rotation.clone().invert());
  const mirror = new Reflector(geometry, {
    color: 0xdfe5e4, textureWidth: 384, textureHeight: 192, multisample: 0, clipBias: .002,
  });
  mirror.name = surface.name;
  mirror.position.copy(surface.position);
  mirror.quaternion.copy(surface.quaternion).multiply(rotation);
  mirror.scale.copy(surface.scale);
  surface.parent.add(mirror);
  surface.removeFromParent();
  const position = new THREE.Vector3();
  const reflect = mirror.onBeforeRender;
  let last = -Infinity;
  mirror.onBeforeRender = function(renderer, scene, camera) {
    const now = performance.now();
    if (now - last < 40 || camera.position.distanceToSquared(this.getWorldPosition(position)) > 2.25) return;
    last = now;
    reflect.call(this, renderer, scene, camera);
  };
}

export function createRunwaySupportCar(group) {
  group.name = '追走車';
  for (const name of ['MirrorSurface', 'DoorMirrorPort', 'DoorMirrorStarboard']) {
    reflectiveGlass(group.getObjectByName(name));
  }
  const eye = new THREE.Vector3();
  group.traverse(part => {
    const glass = part.material;
    if (!glass?.name.startsWith('CabGlass')) return;
    glass.depthWrite = false;
    glass.onBeforeRender = (renderer, scene, camera) => {
      group.worldToLocal(camera.getWorldPosition(eye));
      const inside = Math.abs(eye.x) < .83 && eye.y > .9 && eye.y < 2.22 && Math.abs(eye.z) < 2.25;
      glass.opacity = inside ? .025 : .26;
    };
  });
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const hub = group.getObjectByName('Wheel' + i);
    const near = hub.getObjectByName('Wheel' + i + 'Near');
    const far = hub.getObjectByName('Wheel' + i + 'Far');
    const lod = new THREE.LOD();
    lod.addLevel(near, 0);
    lod.addLevel(far, 45, .12);
    hub.add(lod);
    wheels.push(hub);
  }
  const tach = group.getObjectByName('Tachometer');
  const speedometer = group.getObjectByName('Speedometer');
  const tyreRadius = .325;
  return { group, setDistance(metres, speed = 0) {
    for (const hub of wheels) hub.rotation.x = -metres / tyreRadius;
    const kmh = THREE.MathUtils.clamp(speed * 3.6, 0, 180);
    speedometer.rotation.z = THREE.MathUtils.degToRad(135 - 270 * kmh / 180);
    tach.rotation.z = THREE.MathUtils.degToRad(135 - 270 * Math.min(4.5, .8 + speed * .11) / 6);
  } };
}
