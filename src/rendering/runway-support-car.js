import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

function reflectiveGlass(surface) {
  // Reflector only captures a texture. The authored mesh stays in the vehicle,
  // with its Blender geometry, hierarchy and silver coating at every distance.
  const capture = new Reflector(surface.geometry, {
    textureWidth: 384, textureHeight: 192, multisample: 0, clipBias: .002,
  });
  const { normal, position } = surface.geometry.attributes;
  const axis = new THREE.Vector3().fromBufferAttribute(normal, 0).normalize();
  const point = new THREE.Vector3().fromBufferAttribute(position, 0);
  const plane = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis));
  plane.setPosition(axis.clone().multiplyScalar(point.dot(axis)));
  const inversePlane = plane.clone().invert();
  const projection = { value: new THREE.Matrix4() };
  const strength = { value: 0 };
  const silver = surface.material.clone();
  surface.material = silver;
  silver.onBeforeCompile = shader => {
    shader.uniforms.mirrorTexture = { value: capture.getRenderTarget().texture };
    shader.uniforms.mirrorProjection = projection;
    shader.uniforms.mirrorStrength = strength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 mirrorProjection;\nvarying vec4 mirrorUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nmirrorUv = mirrorProjection * vec4(transformed, 1.0);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D mirrorTexture;\nuniform float mirrorStrength;\nvarying vec4 mirrorUv;')
      .replace('#include <opaque_fragment>', `if (mirrorStrength > 0.0) {
        vec3 reflection = texture2DProj(mirrorTexture, mirrorUv).rgb;
        outgoingLight = mix(outgoingLight, reflection * diffuseColor.rgb, mirrorStrength);
      }
      #include <opaque_fragment>`);
  };
  const offset = new THREE.Vector3();
  const eye = new THREE.Vector3();
  let last = -Infinity;
  surface.onBeforeRender = function (renderer, scene, camera) {
    // Mirrors seen inside another mirror keep the authored silver surface.
    if (renderer.getRenderTarget()) {
      strength.value = 0;
      return;
    }
    capture.matrixWorld.multiplyMatrices(this.matrixWorld, plane);
    offset.setFromMatrixPosition(capture.matrixWorld).sub(camera.getWorldPosition(eye));
    const weight = 1 - THREE.MathUtils.smoothstep(offset.length(), 1.5, 2.2);
    if (weight === 0 || offset.dot(eye.set(0, 0, 1).transformDirection(capture.matrixWorld)) >= 0) {
      strength.value = 0;
      last = -Infinity;
      return;
    }
    const now = performance.now();
    if (now - last >= 40) {
      this.visible = false;
      try {
        capture.onBeforeRender(renderer, scene, camera);
      } finally {
        this.visible = true;
      }
      projection.value.copy(capture.material.uniforms.textureMatrix.value).multiply(inversePlane);
      last = now;
    }
    strength.value = weight;
  };
}

export function createRunwaySupportCar(group) {
  group.name = '追走車';
  for (const name of ['MirrorSurface', 'DoorMirrorPort', 'DoorMirrorStarboard']) {
    reflectiveGlass(group.getObjectByName(name));
  }
  const eye = new THREE.Vector3();
  group.traverse(part => {
    const insideOpacity = part.material?.userData.interiorOpacity;
    if (insideOpacity === undefined) return;
    const glass = part.material.clone();
    part.material = glass;
    const outsideOpacity = glass.opacity;
    glass.depthWrite = false;
    glass.onBeforeRender = (renderer, scene, camera) => {
      group.worldToLocal(camera.getWorldPosition(eye));
      const inside = Math.abs(eye.x) < .83 && eye.y > .9 && eye.y < 2.22 && Math.abs(eye.z) < 2.25;
      glass.opacity = inside ? insideOpacity : outsideOpacity;
    };
  });
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const hub = group.getObjectByName('Wheel' + i);
    const near = hub.getObjectByName('Wheel' + i + 'Near');
    const far = hub.getObjectByName('Wheel' + i + 'Far');
    const lod = new THREE.LOD();
    far.visible = false;
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
