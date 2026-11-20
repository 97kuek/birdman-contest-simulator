import * as THREE from 'three';
import { surfaceHeight } from './terrain/surface.js';

// The northern half opens onto sports fields to the west. The river-side track
// stays between the mown grass and an irregular belt of reeds and broadleaf scrub.
function noise(distance, seed) {
  const i = Math.floor(distance), f = distance - i;
  const hash = n => {
    const v = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  return THREE.MathUtils.lerp(hash(i), hash(i+1), f*f*(3-2*f));
}

function vegetationProfile(forward, sign) {
  const east = sign > 0;
  const widen = THREE.MathUtils.smoothstep(forward, 390, 530);
  const track = (east ? 24.5 + widen*5.5 : 29.8 + widen*26)
    + 1.05 * noise(forward/31, sign+7);
  const front = track + (east ? 2.1 : .6) + 2.9*noise(forward/14, sign+11);
  const width = (east ? 8.1 : 5.7) + 3.9*noise(forward/38,sign+15);
  const rises = noise(forward/41,sign+43), hollows = noise(forward/11,sign+22);
  const entrance = east ? 1 : THREE.MathUtils.smoothstep(Math.abs(forward-425), 4, 13);
  const opening = east ? 1 : .30+.70*THREE.MathUtils.smoothstep(noise(forward/49,9),.15,.7);
  const ends = THREE.MathUtils.smoothstep(forward,-4,18) * THREE.MathUtils.smoothstep(857-forward,0,21);
  const height = (.8+1.8*rises+.7*hollows) * opening * entrance * ends;
  return { track, front, width, height };
}

function stripGeometry(rows, point, kind) {
  const pos=[], colors=[], uv=[], index=[];
  const tint=new THREE.Color();
  let columns;
  rows.forEach(({ forward, sign, track, front, width, height }, j) => {
    // Each cross section consists of [rightward distance, height, brightness].
    // The crest and undercut front vary independently, keeping the skyline uneven.
    const wave = noise(forward/6.8,sign+4);
    const alpha = THREE.MathUtils.smoothstep(forward+13,0,19) * THREE.MathUtils.smoothstep(864-forward,0,19);
    let profile;
    if (kind === 'mown') {
      profile = [[14.98,.045,.91],[16,.055,1.10],[18.5,.065,1.16],
        [track-1.15,.065,.98],[track-.9,.06,.89]];
    } else if (kind === 'track') {
      profile = [[track-1.15,.075,.72],[track-.68,.09,1.04],[track+.60,.09,.98],
        [track+1.05,.075,.71]];
    } else {
      profile = [[track+1.0,.065,.86],[front-.40,.035,.69],[front+.24,.26*height,.68],
        [front+width*.19,height*(.65+.18*wave),.83],[front+width*(.34+.1*wave),height*(.90+.2*wave),1.13],
        [front+width*.68,height*(.76+.21*noise(forward/9,sign+12)),1.05],
        [front+width*.87,height*.48,.77],[front+width,.035,.57]];
    }
    columns = profile.length;
    const patch = .87+.22*noise(forward/18,sign+31)+.11*noise(forward/4.8,sign+32);
    for (const [widthAt,tip,shade] of profile) {
      const p=point(widthAt*sign,forward);
      pos.push(p.x,p.y+tip,p.z);
      let base = kind === 'track' ? 0x8e8f88 : 0xffffff;
      // The landward side has a grass margin without the parallel river-side path.
      if (kind === 'track' && sign < 0) base = 0x636e47;
      tint.setHex(base).multiplyScalar(shade*patch);
      colors.push(tint.r,tint.g,tint.b,alpha);
      uv.push(widthAt/(kind==='scrub' ? 3.3 : 4.2),forward/(kind==='scrub' ? 3.5 : 5.2));
    }
    if (j===0) return;
    for (let k=0;k<columns-1;k++) {
      const a=(j-1)*columns+k,b=a+1,c=a+columns,d=c+1;
      if (sign > 0) index.push(a,b,c,b,d,c);
      else index.push(a,c,b,b,c,d);
    }
  });
  const geom=new THREE.BufferGeometry();
  geom.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geom.setAttribute('color',new THREE.Float32BufferAttribute(colors,4));
  geom.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geom.setIndex(index);
  return geom;
}

function maskedPlants(atlas, placements, slot) {
  const geometry = new THREE.PlaneGeometry(1,1).translate(0,.5,0);
  const uv=geometry.getAttribute('uv');
  // Half-texel gutter keeps neighbouring atlas cards out of the silhouette.
  for (let i=0;i<uv.count;i++) uv.setX(i,(slot+(uv.getX(i)*.992+.004))/4);
  const material=new THREE.MeshBasicMaterial({map:atlas,side:THREE.DoubleSide,alphaTest:.26});
  const plants=new THREE.InstancedMesh(geometry,material,placements.length);
  const item=new THREE.Object3D(), tint=new THREE.Color();
  placements.forEach(({p,width,height,rotation,shade}, i)=>{
    item.position.copy(p);
    item.rotation.y=rotation;
    item.scale.set(width,height,1);
    item.updateMatrix();
    plants.setMatrixAt(i,item.matrix);
    tint.setRGB(shade*1.06,shade,shade*.90);
    plants.setColorAt(i,tint);
  });
  return plants;
}

export function runwayVerge(surface, runway, mown, scrub, atlas, gravel) {
  const group=new THREE.Group();
  group.name='滑走路の刈草帯・管理道と夏の河畔植生';
  for (const texture of [mown,scrub,atlas]) {
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=8;
  }
  for (const texture of [mown,scrub]) texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  const heading=THREE.MathUtils.degToRad(runway.trueBearingDegrees);
  const sin=Math.sin(heading), cos=Math.cos(heading);
  function point(right, forward) {
    const x=runway.southThreshold[0]+right*cos+forward*sin;
    const z=runway.southThreshold[1]+right*sin-forward*cos;
    return new THREE.Vector3(x,surfaceHeight(surface,x,z),z);
  }
  let state=36018;
  const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
  const placements=[[],[],[],[]];
  function plant(slot,p,width,height,shade) {
    placements[slot].push({p,width,height,shade,rotation:random()*Math.PI*2});
  }
  const mats={};
  for (const [kind,map] of [['mown',mown],['track',gravel],['scrub',scrub]]) {
    mats[kind]=new THREE.MeshBasicMaterial({map,vertexColors:true,transparent:true,
      polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3});
    mats[kind].onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        vec2 secondary = mat2(0.81,-0.59,0.59,0.81) * vMapUv * 0.67 + vec2(.13,.67);
        diffuseColor *= mix(texture2D(map,vMapUv),texture2D(map,secondary),.44);`);
    };
  }
  for (const sign of [-1,1]) {
    const rows=[];
    for(let forward=-13.75;forward<=865;forward+=1.25) {
      rows.push({forward,sign,...vegetationProfile(forward,sign)});
    }
    for(const kind of ['mown','track','scrub']) group.add(new THREE.Mesh(stripGeometry(rows,point,kind),mats[kind]));

    // Vary clump spacing, width and height within patches. The dense body above
    // supplies volume while individual leaf tips and seed heads break the edge.
    for(let forward=0;forward<850;forward+=.8+random()*.65) {
      const {front,width,height,track}=vegetationProfile(forward,sign);
      const patch=.70+.58*noise(forward/12,sign+31);
      for(let k=0;k<3;k++) {
        const lateral=15.12+(track-16.2)*random();
        const p=point(sign*lateral,forward+random()-.5);
        p.y+=.055;
        const tall=(lateral-15)/(track-15);
        plant(0,p,.48+random()*1.06,(.055+random()*.075)*(1+.80*tall)*patch,1.24+random()*.22);
      }
      if(height<.10) continue;
      const near=point(sign*(front+random()*1.7),forward);
      plant(1,near,.9+random()*1.15,(.39+random()*.63)*height,.96+random()*.20);
      for(let k=0;k<3;k++) {
        const depth=random();
        const p=point(sign*(front+depth*width),forward+random()*1.4);
        const crown=height*Math.sin(depth*Math.PI);
        p.y+=.28*crown;
        const slot=random()<.10 ? 1 : (random()<.5 ? 2 : 3);
        const breadth=2.8+random()*3.7;
        plant(slot,p,breadth,(.78+random()*.63)*height+.18, .83+random()*.32);
      }
    }
  }
  placements.forEach((items,i)=>group.add(maskedPlants(atlas,items,i)));
  return group;
}
