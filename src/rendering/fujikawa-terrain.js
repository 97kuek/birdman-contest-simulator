import { addFlatlandDetail, loadSurfaceGrain } from './terrain/flatland.js';
import * as THREE from 'three';
import { loadVenueModel } from './authored-models.js';
import { terrainAssets } from './terrain/assets.js';

function addMountainHaze(material) {
  // The humid coastal plain loses more contrast than the summit above it.
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float coastalHaze;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float distanceFromField = length(position.xz);
        coastalHaze = (0.20 * smoothstep(1600.0, 6500.0, distanceFromField)
          + 0.26 * smoothstep(6500.0, 28000.0, distanceFromField))
          * exp(-max(position.y, 0.0) / 2100.0);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float coastalHaze;')
      .replace('#include <fog_fragment>', `#include <fog_fragment>
        #ifdef USE_FOG
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, coastalHaze);
        #endif`);
  };
}

// The 850 m ortho preserves the surveyed markings. The shared material tile
// supplies the aggregate and worn patches resolved from a low cockpit or cab.
function addPavementGrain(material, grain) {
  material.onBeforeCompile = shader => {
    shader.uniforms.surfaceGrain = { value: grain };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 pavementMetres;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\npavementMetres = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 pavementMetres;\nuniform sampler2D surfaceGrain;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float aggregate = texture2D(surfaceGrain, pavementMetres / 3.8).r - .5;
        vec2 patchUV = mat2(.8, -.6, .6, .8) * pavementMetres / 15.7;
        float patches = texture2D(surfaceGrain, patchUV).r - .5;
        // Preserve paint contrast as the camera crosses a runway marking.
        float asphalt = 1.0 - smoothstep(.17, .54, sampledDiffuseColor.r);
        diffuseColor.rgb *= 1.0 + asphalt * (1.65 * aggregate + .9 * patches);`);
  };
}

function addSurfaceDetail(material, detail, waterMask, clock) {
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.anisotropy = 8;
  material.onBeforeCompile = shader => {
    shader.uniforms.riverMask = { value: waterMask };
    shader.uniforms.riverTime = clock;
    shader.uniforms.grassDetail = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 groundMetres;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ngroundMetres = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 groundMetres;\nuniform sampler2D grassDetail;\nuniform sampler2D riverMask;\nuniform float riverTime;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float grass = smoothstep(0.018, 0.085, sampledDiffuseColor.g - sampledDiffuseColor.b);
        float blades = texture2D(grassDetail, groundMetres / 4.2).r - 0.5;
        float patches = texture2D(grassDetail, groundMetres.yx / 19.3).r - 0.5;
        diffuseColor.rgb *= mix(vec3(1.0),vec3(.72,.85,.48),grass);
        diffuseColor.rgb *= 1.0 + grass * (blades * 0.90 + patches * 0.25);
        float mask = texture2D(riverMask, vMapUv).r;
        if (mask > .01) {
          vec2 p = groundMetres;
          float t = riverTime;
          float wave = sin(p.y * .61 - t * 1.8 + sin(p.x * .18)) + .5 * sin(dot(p, vec2(.75,.92)) - t * 1.3);
          vec3 look = normalize(cameraPosition - vec3(p.x, 0.0, p.y));
          float grazing = pow(1.0 - clamp(abs(look.y),0.0,1.0), 4.0);
          float attenuation = 1.0 / (1.0 + 4.0 * length(fwidth(p)));
          vec3 water = mix(vec3(.035,.105,.10), vec3(.27,.44,.51), grazing);
          water += attenuation * (.022 * wave + .10 * smoothstep(.98,1.45,wave));
          diffuseColor.rgb = mix(diffuseColor.rgb, water * diffuse, mask * .87);
        }`);
  };
}

export async function addFujikawaTerrain(scene) {
  const assets = terrainAssets('fujikawa');
  const [landscape, { runway }, grass, waterMask, surfaceGrain] = await Promise.all([
    loadVenueModel('fujikawa-scenery'), assets.json('layers.json'),
    assets.texture('grass-detail.webp'), assets.texture('river-water.png'), loadSurfaceGrain(),
  ]);
  const facility = new THREE.Group();
  facility.name = '富士川滑空場 RWY 36';
  facility.userData.runway = runway;
  facility.position.set(runway.southThreshold[0], 0, runway.southThreshold[1]);
  facility.rotation.y = -THREE.MathUtils.degToRad(runway.trueBearingDegrees);
  facility.add(landscape);
  const riverTime = { value: 0 };
  // GLB images have top-left UVs; the water mask follows the same convention.
  waterMask.flipY = false;
  waterMask.needsUpdate = true;
  addSurfaceDetail(landscape.getObjectByName('DEM_runway').material, grass, waterMask, riverTime);
  for (const layer of ['river', 'mountains', 'fuji']) {
    addMountainHaze(landscape.getObjectByName('DEM_' + layer).material);
  }
  landscape.traverse(part => {
    const m = part.material;
    // Blend a second sampling direction on the grass and gravel strips.
    if (m?.transparent && m.userData.tile) {
      m.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
          vec2 secondary = mat2(0.81,-0.59,0.59,0.81) * vMapUv * 0.67 + vec2(.13,.67);
          diffuseColor *= mix(texture2D(map,vMapUv),texture2D(map,secondary),.44);`);
      };
    }
  });
  const pavement = landscape.getObjectByName('Pavement');
  addPavementGrain(pavement.material, surfaceGrain);
  const shadow = new THREE.Mesh(pavement.geometry, new THREE.ShadowMaterial({ opacity: .32,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  shadow.name = '滑走路面の影';
  shadow.receiveShadow = true;
  shadow.position.y = .017;
  pavement.add(shadow);
  await addFlatlandDetail(landscape, 'fujikawa');
  scene.add(facility);
  return { landscape, facility, riverTime };
}
