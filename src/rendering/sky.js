import * as THREE from 'three';
import { atmosphere } from './lake-shaders.js';

export function createSkyDome(uniforms, haze = 0) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { ...uniforms, haze: { value: haze } },
    vertexShader: `varying vec3 ray;
      void main() {
        ray = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `varying vec3 ray;
      uniform float haze;
      ${atmosphere}
      void main() {
        vec3 direction = normalize(ray);
        vec3 color = skyColor(direction);
        if (haze > 0. && nightScene < .5) {
          // A thin, pale cloud layer over the foothills, still blue overhead.
          float height = max(direction.y, 0.);
          vec2 p = direction.xz / max(.12, height + .08);
          float cloud = .60 * noiseField(p) + .40 * noiseField(p * 3.4);
          float veil = haze * (1. - .45 * height) * (.60 + .40 * cloud);
          color = mix(color, vec3(.78, .82, .83), veil);
        }
        gl_FragColor = vec4(color, 1.);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(48000, 48, 24), material);
  dome.renderOrder = -10;
  return dome;
}
