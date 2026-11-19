import * as THREE from 'three';
import { addRigidAssembly, bentTube, mesh, finishGeometry, rod, surfacePatch } from './mesh-parts.js';

const radians = Math.PI / 180;
function symmetricDepth(t, thickness, chord) {
  return 5 * thickness * chord * (.2969*Math.sqrt(t) - .126*t - .3516*t*t + .2843*t**3 - .1036*t**4);
}

function horizontalTail(root, m) {
  const pivot = new THREE.Group();
  pivot.name = 'elevator-hinge';
  pivot.position.set(0, 1.40, 3.70);
  root.add(pivot);
  const tail = new THREE.Group();
  tail.name = 'horizontal-tail';
  tail.rotation.x = -1.2 * radians;
  pivot.add(tail);
  const vertices = [], indices = [];
  const bays = 16, n = 40;
  const half = 1.40, chord = .67;
  function point(x, u, upper) {
    return [x, (upper ? 1 : -1)*symmetricDepth(u,.12,chord), -.168 + u*chord];
  }
  for (let i = 0; i <= bays; i++) {
    const x = half * (2*i/bays - 1);
    for (let j = 0; j < n; j++) {
      const u = (1 - Math.cos(2*Math.PI*j/n)) / 2;
      vertices.push(...point(x,u,j <= n/2));
      const a = i*n + j, b = i*n + (j+1)%n;
      if (i) indices.push(a-n, b-n, a, a, b-n, b);
    }
    if (i === 0 || i === bays) {
      for (let j=1; j < n-1; j++) indices.push(i*n, i*n+j, i*n+j+1);
    }
  }
  mesh(tail, finishGeometry(vertices, indices), m.tailSkin, 'naca0012-horizontal-tail');
  const ribs = new THREE.Group();
  ribs.name = 'elevator-structure';
  rod(ribs,[-half+.005,0,0],[half-.005,0,0],.0175,m.carbon,'horizontal-spar');
  for (let i = -6; i <=6; i++) {
    const x=i*.21;
    surfacePatch(ribs,'cap',12,1,(u,v)=> {
      const pt=point(x+(v-.5)*.006, u,true);
      pt[1]+=.0008;
      return pt;
    },m.rib);
  }
  addRigidAssembly(tail, ribs);
  return pivot;
}

const hingeZ = 3.784;
const finStations = [
  [.450,3.512,4.255], [.511,3.526,4.384], [.68,3.537,4.358],
  [1.13,3.547,4.289], [1.265,3.550,4.267], [1.326,3.550,3.786],
];
function finPoint(y, zFraction, side) {
  const idx = Math.max(1,finStations.findIndex(s=>s[0]>=y));
  const [a,l0,t0] = finStations[idx-1], [b,l1,t1] = finStations[idx];
  const f = (y-a)/(b-a);
  const leading = THREE.MathUtils.lerp(l0,l1,f), end=THREE.MathUtils.lerp(t0,t1,f);
  const z = zFraction(leading,end);
  return [side*symmetricDepth(THREE.MathUtils.clamp((z-leading)/(end-leading),0,1),.09,end-leading),y,z];
}

function finPart(parent, moving, m) {
  const name = moving ? 'rudder' : 'vertical-stabilizer';
  const vertices=[], indices=[];
  const ys = [];
  for (let i=0; i<finStations.length-1; i++) {
    const a=finStations[i][0], b=finStations[i+1][0];
    for(let j=0;j<4;j++) ys.push(a+(b-a)*j/4);
  }
  ys.push(finStations.at(-1)[0]);
  const steps=12, count=(steps+1)*2;
  function point(y,u,side) {
    const p=finPoint(y,(le,te)=>moving ?
      THREE.MathUtils.lerp(hingeZ+.001,te,u) : THREE.MathUtils.lerp(le,hingeZ-.002,u),side);
    if (moving) p[2] -= hingeZ;
    return p;
  }
  for (const [i,y] of ys.entries()) {
    for(let j=0;j<count;j++) {
      const side = j <=steps ? 1:-1;
      const t=(side===1?j:count-1-j)/steps;
      vertices.push(...point(y,t,side));
      const a=i*count+j,b=i*count+(j+1)%count;
      if(i) indices.push(a-count,a,b-count,a,b,b-count);
    }
    if (i===0 || i===ys.length-1) {
      for(let j=1;j<count-1;j++) indices.push(i*count,i*count+j,i*count+j+1);
    }
  }
  mesh(parent,finishGeometry(vertices,indices),m.ivory,name);
  // A blue sail-shaped flash spans the hinge. Two shorter green curves sit
  // below it. Evaluate distal edges on the tapered panel at their own height.
  for (const side of [-1,1]) {
    for (const [front,back,mat,outline] of [
      [3.575,4.39,m.blue,t=>[.775+.07*(t-.30)**2,
        .775+.07*(t-.30)**2+.26*THREE.MathUtils.smoothstep(t,0,.77)]],
      [3.58,3.98,m.mint,t=>[.632+.026*Math.sin(t*2*Math.PI),
        .632+.026*Math.sin(t*2*Math.PI)+.038*Math.sin(Math.PI*t)**.72]],
      [3.84,4.32,m.mint,t=>[.55+.033*Math.sin(t*2*Math.PI),
        .55+.033*Math.sin(t*2*Math.PI)+.047*Math.sin(Math.PI*t)**.72]],
    ]) {
      const from=Math.max(front,moving?hingeZ+.001:front);
      const to=Math.min(back,moving?back:hingeZ-.002);
      if (to<=from) continue;
      surfacePatch(parent,name+'-paint',28,5,(u,v)=>{
        const nominal=THREE.MathUtils.lerp(from,to,u);
        const t=(nominal-front)/(back-front);
        const [lo,hi]=outline(t);
        const y=THREE.MathUtils.lerp(lo,hi,v);
        const pt=finPoint(y,(le,te)=>THREE.MathUtils.clamp(nominal,le,te),side);
        pt[0]+=side*.0017;
        if(moving) pt[2]-=hingeZ;
        return pt;
      },mat);
    }
  }

}

export function addQxTail(root,m) {
  const fixed = new THREE.Group();
  fixed.name='qx-tail-hardware';
  // Straight tapered CFRP boom, painted ivory as in the team photograph.
  const boom=mesh(fixed,new THREE.CylinderGeometry(.035,.0525,4.868-1.47,16),m.boom,'tail-boom');
  boom.position.set(0,.45,(4.868+1.47)/2);
  boom.rotation.x=Math.PI/2;
  for(const z of [1.62,3.54,3.784,4.785]) {
    const radius=THREE.MathUtils.lerp(.054,.036,(z-1.47)/(4.868-1.47));
    rod(fixed,[0,.45,z-.015],[0,.45,z+.015],radius+.002,m.carbon,'boom-collar');
  }
  rod(fixed,[0,.466,3.70],[0,1.393,3.70],.018,m.carbon,'vertical-post');
  rod(fixed,[-.06,1.40,3.70],[.06,1.40,3.70],.023,m.aluminium,'elevator-bearing');
  for (const y of [.52,1.20]) {
    rod(fixed,[0,y-.039,hingeZ],[0,y+.039,hingeZ],.018,m.aluminium,'rudder-hinge-pin');
  }
  for(const side of [-1,1]) {
    bentTube(fixed,[[side*.027,.458,3.48],[side*.04,.472,3.61],[side*.043,.497,3.737],
      [side*.050,.503,3.82]],.003,m.carbon,'rudder-pushrod');
  }
  addRigidAssembly(root,fixed);
  finPart(root,false,m);
  const rudder=new THREE.Group();
  rudder.name='rudder-hinge';
  rudder.position.z=hingeZ;
  root.add(rudder);
  finPart(rudder,true,m);
  return horizontalTail(root,m);
}
