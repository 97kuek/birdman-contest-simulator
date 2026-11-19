import * as THREE from 'three';
import { pilotLaunchWeight } from './pilot-launch.js';
import { addQxWing } from './qx-wing.js';
import { addQxTail } from './qx-tail.js';
import { addQxCockpit } from './qx-cockpit.js';
import { addRigidAssembly, bentTube, box, ellipsoid, mesh, rod, shaded, surfacePatch } from './mesh-parts.js';

// Each station gives fore/aft distance from the main spar, half-width, keel
// and crown. The cockpit narrows to an open, truncated fairing at the boom.
const sections = [
  [-1.70,.004,.254,.273],[-1.66,.087,.180,.350],[-1.55,.162,.112,.447],
  [-1.37,.237,.053,.542],[-1.12,.286,.018,.608],[-.82,.316,.004,.643],
  [-.45,.327,0,.649],[0,.319,.008,.634],[.46,.295,.028,.613],
  [.90,.239,.072,.592],[1.26,.157,.114,.573],[1.55,.091,.164,.554],
  [1.70,.057,.508,.546],
];
function podPoint(z, angle, side=1) {
  const i=Math.max(1,sections.findIndex(row=>row[0] >= z));
  const start=sections[i-1], end=sections[i], f=(z-start[0])/(end[0]-start[0]);
  const width=THREE.MathUtils.lerp(start[1],end[1],f);
  const floor=THREE.MathUtils.lerp(start[2],end[2],f);
  const top=THREE.MathUtils.lerp(start[3],end[3],f);
  const rounded=v=>Math.sign(v)*Math.abs(v)**.78;
  return [side*width*rounded(Math.cos(angle)),(top+floor+(top-floor)*rounded(Math.sin(angle)))/2,z];
}
function identification() {
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  if (canvas) { canvas.width = 512; canvas.height = 160; }
  const ctx = canvas?.getContext('2d');
  let map;
  if (ctx) {
    ctx.font = 'italic 135px "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#262b30';
    ctx.fillText('QX-25',256,86,490);
    map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshBasicMaterial({map:map??null,visible:!!map,alphaTest:.3,side:THREE.DoubleSide,
    polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
}

function addPod(root,m) {
  // Split along actual loft stations so the canopy and the adjacent hard shell
  // meet on one common ring. Leave the underside open for the pilot's legs.
  for (const [first,last,canopy,open] of [
    [0,5,true,false],[5,6,false,false],[6,10,false,true],[10,12,false,false],
  ]) {
    const seam=open?-.68:-Math.PI/2;
    const part=surfacePatch(root,canopy?'qx-clear-canopy':'qx-cowling',40,last-first,(u,v)=>{
      const index=first+Math.round(v*(last-first));
      return podPoint(sections[index][0],seam+u*(Math.PI-2*seam));
    },canopy?m.glass:m.ivory);
    if(canopy) { part.castShadow=false; part.renderOrder=3; }
  }
  const structure=new THREE.Group();
  structure.name='qx-cowling-details';
  for(const z of [-.82,-.48]) {
    const ring=[];
    for (let j=0;j<=24;j++) ring.push(podPoint(z,-Math.PI/2+j*Math.PI/12));
    bentTube(structure,ring,.005,z===-.82?m.aluminium:m.trim,'canopy-seal');
  }
  const mark=identification();
  for(const side of [-1,1]) {
    for(const theta of [-.59,.84]) {
      const chain=sections.filter(row=>row[0]<=-.82).map(row=>podPoint(row[0],theta,side));
      bentTube(structure,chain,.0035,m.aluminium,'clear-panel-seam');
    }
    // Broad wing-root fillet. Its leading shoulder wraps the sides of the pod
    // and widens to the 1.60 m central panel in the published plan view.
    for(const upper of [false,true]) {
      surfacePatch(structure,'root-fillet',30,12,(u,v)=>{
        const innerZ=THREE.MathUtils.lerp(-.81,1.62,u);
        const outerZ=THREE.MathUtils.lerp(-.383,.672,u);
        const z=THREE.MathUtils.lerp(innerZ,outerZ,1-(1-v)**2.25);
        const top=podPoint(innerZ,upper?-.18:-.85,side);
        const chordAtSpan=.105-.077*(u-.365)+4*.050*u*(1-u);
        const thickness=.071*Math.sin(Math.PI*Math.sqrt(u));
        return [side*THREE.MathUtils.lerp(Math.abs(top[0])*.96,.803,v),
          THREE.MathUtils.lerp(top[1],chordAtSpan+(upper?thickness:-thickness),(1-(1-v)**2)),z];
      },m.ivory);
    }
    // Typeset identification and independently drawn curved color stripes.
    surfacePatch(root,'qx-25-identification',18,4,(u,v)=>{
      const p=podPoint(.10+(side>0?1-u:u)*1.15,.22+.71*v,side);
      p[0]+=.003*side;
      return p;
    },mark,true);
    for(const [start,end,base,breadth,mat] of [
      [-.64,.35,.27,.14,m.mint],[-.63,-.31,-.02,.16,m.blue],[-.61,-.40,-.13,.077,m.blue],
      [.32,1.17,.06,.16,m.blue],[.40,1.11,.10,.065,m.blue],[-.36,.94,.99,.041,m.lime],
    ]) {
      surfacePatch(structure,'cowl-stripe',32,2,(u,v)=>{
        const angle=base+.20*Math.sin(u*Math.PI*1.65)+(v-.5)*breadth*Math.sin(Math.PI*u)**.7;
        const p=podPoint(start+(end-start)*u,angle,side);
        p[0]+=.002*side;
        return p;
      },mat);
    }
  }
  addRigidAssembly(root,structure);
}

function auxiliaryLegs(root,m) {
  const pairs=[];
  for(const side of [-1,1]) {
    const hinge=new THREE.Group();
    hinge.name=side<0?'left-auxiliary-leg':'right-auxiliary-leg';
    hinge.position.set(side*.50,.130,-.01);
    root.add(hinge);
    // Local +Z follows the leg. Zero angle is the horizontal stowed
    // position shown in the mechanism detail. Positive pitch lowers the foot.
    const socket=new THREE.Group();
    socket.name='leg-socket';
    rod(socket,[-.031,0,0],[.031,0,0],.014,m.aluminium,'pin');
    rod(socket,[0,0,.005],[0,0,.25],.013,m.carbon,'outer-sleeve');
    rod(socket,[0,0,.228],[0,0,.249],.016,m.aluminium,'sleeve-bushing');
    const coil=[];
    for(let j=0;j<=72;j++) {
      const angle=2*Math.PI*5*j/72;
      coil.push([-.024+.048*j/72,.021*Math.cos(angle),.021*Math.sin(angle)]);
    }
    bentTube(socket,coil,.0024,m.aluminium,'torsion-spring');
    addRigidAssembly(hinge,socket);
    let parent=hinge;
    const stages=[];
    for(let k=0;k<3;k++) {
      const slider=new THREE.Group();
      slider.name='telescoping-stage-'+(k+1);
      parent.add(slider);
      rod(slider,[0,0,.014],[0,0,.243],.0105-.002*k,m.carbon,'telescoping-leg');
      rod(slider,[0,0,.226],[0,0,.242],.0125-.002*k,m.aluminium,'collar');
      stages.push(slider);
      parent=slider;
    }
    ellipsoid(parent,[0,0,.252],[.017,.013,.024],m.shoe,'foot-pad');
    const cover=box(root,[side*.50,.164,-.036],[.079,.020,.092],m.ivory,'retraction-cover');
    pairs.push({hinge,stages,cover});
  }
  return extended=>{
    for(const {hinge,stages,cover} of pairs) {
      hinge.rotation.x=(80*Math.PI/180)*extended;
      for(const stage of stages) stage.position.z=.01+.157*extended;
      cover.visible=extended>.93;
    }
  };
}

export function createQx25Aircraft() {
  const root=new THREE.Group();
  root.name='QX-25';
  const m={
    ivory:shaded('#f7f8ee',{roughness:.50}),
    film:shaded('#e5f4ed',{roughness:.28,transparent:true,opacity:.30,depthWrite:false,side:THREE.FrontSide}),
    glass:shaded('#bcdce4',{roughness:.12,transparent:true,opacity:.20,depthWrite:false,side:THREE.DoubleSide}),
    tailSkin:shaded('#f0f1e7',{transparent:true,opacity:.9,roughness:.43}),
    rib:shaded('#8eb2bd'), trailing:shaded('#586666'), carbon:shaded('#343940'),
    boom:shaded('#e6e6da'),aluminium:shaded('#a8b1ae',{metalness:.49}),trim:shaded('#c6cfb8'),
    mint:shaded('#55b7ab'),blue:shaded('#3886bb'),lime:shaded('#a6c959'),
    skin:shaded('#ba8766'),suit:shaded('#e4af38'),helmet:shaded('#e8eddf',{roughness:.35}),
    pants:shaded('#353f4b'),shoe:shaded('#30383a'),padding:shaded('#708276'),gold:shaded('#e8c769'),
  };
  for (const [name,material] of Object.entries(m)) material.name=name;
  const flexWing=addQxWing(root,m);
  addPod(root,m);
  const posePilot=addQxCockpit(root,m);
  const elevator=addQxTail(root,m);
  const poseLegs=auxiliaryLegs(root,m);
  root.userData.poseMechanisms=sample=>{
    const onDeck=sample.t===undefined;
    elevator.rotation.x=-THREE.MathUtils.degToRad(sample.elevatorDeg??0);
    poseLegs(onDeck?1:1-THREE.MathUtils.smoothstep(sample.t,.04,.50));
    flexWing(sample);
    posePilot(sample,pilotLaunchWeight(sample));
  };
  root.userData.poseMechanisms({t:2});
  return root;
}
