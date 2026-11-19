import * as THREE from 'three';
import { addRigidAssembly, bentTube, box, ellipsoid, rod, shaded, surfacePatch } from './mesh-parts.js';

function addPilot(group,m){
  const pilot=new THREE.Group(), body=new THREE.Group(), grips=new THREE.Group();
  pilot.name='pilot';body.name='prone-pilot';grips.name='pilot-grip';
  const detail={hair:shaded('#302728'),trim:shaded('#a0cbd1'),rubber:shaded('#323746'),
    lips:shaded('#ac7360'),eye:shaded('#d9c7b5'),iris:shaded('#312c2b'),
    strap:shaded('#263b46'),pants:shaded('#273442'),shell:shaded('#397088',{roughness:.35})};
  // Elliptical sections leave room for cheekbones, a tapered jaw and an open face.
  const face=[
    [.205,.019,.027,-.774],[.218,.045,.050,-.762],[.242,.064,.070,-.748],
    [.269,.078,.083,-.740],[.304,.085,.088,-.737],[.337,.083,.088,-.738],
    [.365,.076,.077,-.736],[.386,.059,.057,-.735],[.399,.019,.023,-.735],
  ];
  surfacePatch(body,'face',32,face.length-1,(u,v)=>{
    const [y,rx,rz,z]=face[Math.round(v*(face.length-1))], a=u*2*Math.PI;
    return [rx*Math.cos(a),y,z+rz*Math.sin(a)];
  },m.skin);
  ellipsoid(body,[0,.262,-.629],[.060,.067,.105],m.skin,'neck');
  ellipsoid(body,[0,.311,-.716],[.090,.096,.084],detail.hair,'hair');
  // The helmet skirt sits low at the back while the brow stays above the eyes.
  surfacePatch(body,'open-face-helmet',40,18,(u,v)=>{
    const a=2*Math.PI*u, edge=1.72+.50*Math.sin(a);
    const t=.012+v*edge;
    return [.102*Math.sin(t)*Math.cos(a),.337+.101*Math.cos(t),-.731+.113*Math.sin(t)*Math.sin(a)];
  },detail.shell);
  for(const side of [-1,1]){
    const at=(x,y,z)=>[side*x,y,z];
    ellipsoid(body,at(.079,.279,-.737),[.016,.026,.015],m.skin,'ear');
    ellipsoid(body,at(.090,.279,-.737),[.005,.015,.009],detail.lips,'ear-fold');
    const eye=ellipsoid(body,at(.034,.303,-.815),[.017,.006,.006],detail.eye,'eye');
    eye.rotation.y=-side*.28;
    ellipsoid(body,at(.034,.303,-.820),[.006,.006,.0025],detail.iris,'iris');
    bentTube(body,[at(.016,.318,-.819),at(.034,.322,-.817),at(.055,.317,-.804)],.004,detail.hair,'eyebrow');
    bentTube(body,[at(.076,.339,-.791),at(.085,.290,-.763),at(.072,.245,-.757),at(.030,.216,-.769)],.0055,detail.strap,'chin-strap');
    bentTube(body,[at(.070,.385,-.799),at(.091,.365,-.768),at(.098,.343,-.719)],.0038,detail.trim,'shell-stripe');
    for(let i=0;i<3;i++){
      const z=-.755+i*.024;
      const vent=ellipsoid(body,at(.042,.426-Math.abs(i-1)*.004,z),[.006,.004,.011],detail.rubber,'helmet-vent');
      vent.rotation.z=-side*.38;
    }
  }
  ellipsoid(body,[0,.285,-.820],[.013,.023,.017],m.skin,'nose-bridge');
  ellipsoid(body,[0,.274,-.835],[.017,.010,.010],m.skin,'nose');
  bentTube(body,[[-.021,.249,-.811],[0,.247,-.819],[.021,.249,-.811]],.0027,detail.lips,'mouth');
  const sleeves=[];
  // Follow the prone pilot silhouette along the pod, including the bent knees and shoes.
  ellipsoid(body,[0,.235,-.410],[.150,.091,.25],m.suit,'chest');
  ellipsoid(body,[0,.222,-.135],[.133,.081,.217],m.suit,'waist');
  ellipsoid(body,[0,.217,.052],[.137,.090,.172],detail.pants,'hips');
  function muscle(parent,a,b,width,depth,material,name){
    const v=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const centre=a.map((n,i)=>(n+b[i])*.5);
    const part=ellipsoid(parent,centre,[width,depth,.5*v.length()+.014],material,name);
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),v.normalize());return part;
  }
  for(const s of [-1,1]){
    const at=(x,y,z)=>[s*x,y,z];
    bentTube(body,[at(.103,.30,-.57),at(.130,.304,-.40),at(.113,.279,-.22),at(.108,.260,-.11)],.007,detail.trim,'jersey-seam');
    muscle(body,at(.065,.204,.08),at(.075,.173,.45),.072,.074,detail.pants,'thigh');
    muscle(body,at(.075,.175,.45),at(.066,.286,.85),.050,.051,detail.pants,'calf');
    muscle(body,at(.066,.286,.84),at(.064,.279,.99),.042,.044,detail.rubber,'shoe');
    const shoulder=new THREE.Vector3(...at(.139,.246,-.46)),elbow=new THREE.Vector3(...at(.144,.169,-.648));
    const sleeve=muscle(pilot,shoulder.toArray(),elbow.toArray(),.044,.049,m.suit,'upper-arm');
    sleeves.push({sleeve,shoulder,elbow});
    // Forearms and hands stay at the grips as the shoulders shift on the chest rest.
    muscle(grips,at(.144,.168,-.634),at(.167,.210,-.792),.031,.033,m.skin,'forearm');
    muscle(grips,at(.167,.208,-.777),at(.171,.218,-.818),.024,.023,m.skin,'palm');
    for(let i=0;i<4;i++){
      const y=.207+i*.0085,z=-.79-i*.008;
      bentTube(grips,[at(.184,y,z+.004),at(.187,y,z-.013),at(.174,y,z-.021),at(.166,y,z-.015)],.0046,m.skin,'curled-finger');
    }
    muscle(grips,at(.159,.224,-.808),at(.164,.232,-.832),.009,.010,m.skin,'thumb');
  }
  const moving=new THREE.Group();moving.name='pilot-weight-shift';
  addRigidAssembly(moving,body);pilot.add(moving);
  const upper=new THREE.Vector3(),axis=new THREE.Vector3(), along=new THREE.Vector3(0,0,1);
  pilot.userData.setBodyOffset=z=>{
    moving.position.z=z;
    for(const {sleeve,shoulder,elbow} of sleeves){
      upper.copy(shoulder);upper.z+=z;
      axis.subVectors(elbow,upper);
      sleeve.position.copy(upper).lerp(elbow,.5);
      sleeve.scale.z=axis.length()*.5+.014;
      sleeve.quaternion.setFromUnitVectors(along,axis.normalize());
    }
  };
  addRigidAssembly(pilot,grips);group.add(pilot);
}

export function addCockpit(group, m) {
  const hardware = new THREE.Group();
  hardware.name = 'cockpit';
  for (const side of [-1, 1]) {
    const x = 0.173 * side;
    bentTube(hardware, [[side * 0.08, 0.14, -1.34], [x, 0.10, -1.05],
      [side * 0.204, 0.096, -0.55], [side * 0.207, 0.106, 0.46]], 0.014, m.frame, 'floor-longeron');
    bentTube(hardware, [[x, 0.096, -0.78], [side * 0.20, 0.22, -0.81],
      [side * 0.185, 0.404, -0.72], [side * 0.135, 0.486, -0.62], [0, 0.51, -0.61]],
    0.015, m.mint, 'green-forward-hoop');
    bentTube(hardware, [[side * 0.20, 0.086, -0.52], [side * 0.214, 0.25, -0.54],
      [side * 0.198, 0.48, -0.50], [side * 0.103, 0.554, -0.44], [0, 0.558, -0.44]],
    0.018, m.gold, 'yellow-hoop');
    rod(hardware, [side * 0.19, 0.125, -0.43], [side * 0.17, 0.52, -0.18], 0.012, m.frame, 'diagonal-brace');
    rod(hardware, [side * 0.17, 0.52, -0.18], [side * 0.16, 0.14, 0.36], 0.013, m.frame, 'wing-mount');
    rod(hardware, [x, 0.13, -0.73], [x, 0.29, -0.87], 0.010, m.carbon, 'handgrip');
    ellipsoid(hardware, [x, 0.13, -0.74], [0.023, 0.022, 0.026], m.gold, 'pivot');

  }
  rod(hardware, [-0.173, 0.10, -0.99], [0.173, 0.10, -0.99], 0.014, m.frame, 'floor-crossmember');
  rod(hardware, [-0.165, 0.14, -0.42], [0.165, 0.14, -0.42], 0.015, m.carbon, 'rest-crossmember');
  box(hardware, [0, 0.149, -0.42], [0.26, 0.043, 0.39], m.helmet, 'prone-chest-rest');
  const panel = box(hardware, [0, 0.201, -1.042], [0.122, 0.031, 0.089], m.carbon, 'airspeed-display');
  panel.rotation.x = -0.48;
  const lens = box(hardware, [0, 0.219, -1.035], [0.089, 0.008, 0.058], m.display, 'instrument-face');
  lens.rotation.x = panel.rotation.x;
  bentTube(hardware, [[0.07, 0.176, -1.04], [0.12, 0.105, -0.92], [0.17, 0.112, -0.58],
    [0.174, 0.36, -0.49], [0.106, 0.523, -0.39]], 0.004, m.carbon, 'sensor-cable');
  addPilot(group,m);
  addRigidAssembly(group, hardware);
}
