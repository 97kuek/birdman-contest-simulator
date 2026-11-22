import * as THREE from 'three';
import { terrainAssets } from './assets.js';

let grainPromise;

// The Blender material stores a north-up land-use mask and its footprint in metres.
// The three mask channels identify cultivated/playing fields, roads, and shingle.
export async function addFlatlandDetail(landscape, directory) {
  const materials = new Set();
  landscape.traverse(part => {
    if (part.material?.userData.flatlandMask) materials.add(part.material);
  });
  if (!materials.size) return;
  grainPromise ??= terrainAssets('terrain').texture('flatland-grain.webp').then(texture => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    return texture;
  });
  await Promise.all([...materials].map(async material => {
    const spec = material.userData;
    const [grain, mask] = await Promise.all([
      grainPromise, terrainAssets(directory).texture(spec.flatlandMask),
    ]);
    mask.flipY = false;
    mask.anisotropy = 4;
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey();
    material.customProgramCacheKey = () => previousKey + '|flatland';
    material.onBeforeCompile = function (shader, renderer) {
      previous.call(this, shader, renderer);
      shader.uniforms.flatlandMask = { value: mask };
      shader.uniforms.surfaceGrain = { value: grain };
      shader.uniforms.fieldMetres = { value: new THREE.Vector2(...spec.flatlandSize) };
      shader.uniforms.fieldAxis = { value: new THREE.Vector2(...spec.flatlandAxis) };
      shader.uniforms.rowSpacing = { value: spec.flatlandRows };
      shader.uniforms.rowContrast = { value: spec.flatlandContrast };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float landViewDepth;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nlandViewDepth = -mvPosition.z;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D flatlandMask, surfaceGrain;
          uniform vec2 fieldMetres, fieldAxis;
          uniform float rowSpacing, rowContrast;
          varying float landViewDepth;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (landViewDepth < 360.0) {
            vec3 landUse = texture2D(flatlandMask, vMapUv).rgb;
            vec2 metres = vMapUv * fieldMetres;
            vec2 field = vec2(dot(metres, fieldAxis), dot(metres, vec2(-fieldAxis.y, fieldAxis.x)));
            vec3 grains = texture2D(surfaceGrain, field / 5.1).rgb - .5;
            float row = field.x / rowSpacing;
            float footprint = fwidth(row);
            float bands = cos(6.2831853 * row + .20 * sin(field.y * .094))
              * (1.0 - smoothstep(.16, .49, footprint));
            float landContrast = dot(landUse, vec3(grains.g * .86 + bands * rowContrast,
              grains.r * .75, grains.b * 1.2));
            diffuseColor.rgb *= 1.0 + landContrast * (1.0 - smoothstep(95.0, 360.0, landViewDepth));
          }`);
    };
    material.needsUpdate = true;
  }));
}
