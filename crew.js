import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {LAUNCH, RAMP_LENGTH, rampAt} from './flight.js';

const vec=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const down=vec(0,-1,0), cloth='#4eacb6', navy='#252d36', trim='#dbefeb';
const finish=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88});
const sphere=new THREE.SphereGeometry(1,16,12);
const deckAngle=-LAUNCH.deckDeg*Math.PI/180, deckRun=RAMP_LENGTH*Math.cos(deckAngle);
const deckY=z=>LAUNCH.edgeHeight+Math.min(z,deckRun)*Math.tan(deckAngle);

// Elliptical cross sections define the jaw, shoulders, waist and tapered limbs.
function loft(rows) {
  const vertices=[], indices=[], n=20;
  for(const [y,width,depth,z=0] of rows){
    for(let j=0;j<n;j++){
      const a=j*2*Math.PI/n;
      vertices.push(width*Math.cos(a),y,z+depth*Math.sin(a));
    }
  }
  for(let i=0;i<rows.length-1;i++)for(let j=0;j<n;j++){
    const a=i*n+j,b=i*n+(j+1)%n;
    indices.push(a,a+n,b,b,a+n,b+n);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);
  geometry.computeVertexNormals();return geometry;
}

// All clothing seams, facial features and shoe details on a moving bone share a draw call.
function assembly(build){
  const shapes=[];
  function part(shape,color,x=0,y=0,z=0,sx=1,sy=1,sz=1,tilt=0){
    const g=shape.clone().scale(sx,sy,sz).rotateZ(tilt).translate(x,y,z);
    g.deleteAttribute('uv');
    const c=new THREE.Color(color),colors=new Float32Array(g.attributes.position.count*3);
    for(let i=0;i<colors.length;i+=3)c.toArray(colors,i);
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));shapes.push(g);
  }
  build(part,(color,...transform)=>part(sphere,color,...transform));
  const mesh=new THREE.Mesh(mergeGeometries(shapes),finish);
  mesh.castShadow=mesh.receiveShadow=true;return mesh;
}
const profiles=[
  {name:'左翼',side:-1,scale:.98,skin:'#c68e72',hair:'#262528',shoe:'#e3e4d7',phase:.25},
  {name:'胴体',side:0,scale:1.035,skin:'#c9987c',hair:'#2e2927',shoe:'#374250',phase:2.25},
  {name:'右翼',side:1,scale:1.01,skin:'#d3a187',hair:'#232322',shoe:'#ece9e0',phase:4.55},
];
function person(profile){
  const {skin,hair,shoe,side}=profile;
  const root=new THREE.Group();root.name='プッシャー・'+profile.name;
  const torso=assembly((part,oval)=>{
    part(loft([[-.09,.145,.108],[0,.168,.117],[.13,.143,.104],[.30,.173,.119],[.43,.205,.117],[.49,.178,.095],[.52,.085,.073]]),cloth);
    oval('#42949f',0,-.065,.004,.153,.022,.112);
    oval(trim,0,.501,-.012,.083,.018,.076);
    oval(skin,0,.542,-.009,.062,.083,.057);
    // A back print with a pale disc and a split wing motif, as seen from the gantry.
    oval(trim,0,.305,.114,.097,.098,.008);
    for(const s of [-1,1])oval('#267d8c',s*.037,.317,.123,.048,.012,.004,s*.34);
    oval('#237886',0,.282,.124,.009,.038,.005,-.24);
    oval(trim,-.085,.385,-.108,.029,.024,.007);
  });
  const head=assembly((part,oval)=>{
    part(loft([[-.11,.037,.041,-.028],[-.084,.068,.067,-.018],[-.036,.086,.09],[.033,.093,.10],[.093,.080,.079],[.12,.038,.043]]),skin);
    oval(hair,0,.070,.013,.098,.089,.108);
    oval(hair,-.037,.049,-.072,.061,.026,.039,-.34);
    for(const s of [-1,1]){
      oval(skin,s*.09,-.009,.004,.018,.034,.018);
      oval(hair,s*.081,.022,.024,.015,.044,.067);
      oval('#302a29',s*.037,.004,-.088,.015,.005,.006);
      oval(hair,s*.038,.022,-.085,.023,.005,.007,s*.12);
    }
    oval(skin,0,-.020,-.093,.017,.024,.023);
    oval('#925e53',0,-.062,-.084,.021,.004,.004);
    if(side===1)oval(hair,0,.041,.108,.052,.048,.045);
  });
  head.position.set(0,.665,-.02);torso.add(head);root.add(torso);
  function limb(arm,sign){
    const length=arm?.29:.415, lowerLength=arm?.26:.415;
    const upper=assembly((part,oval)=>{
      const r=arm?.057:.086;
      part(loft([[-length,.67*r,.7*r],[-length*.75,.83*r,.87*r],[-length*.32,r,r],[0,.85*r,.91*r]]),arm?skin:navy);
      oval(arm?cloth:navy,0,0,0,r,r,r);
      const cuff=arm?.15:.27, width=arm?.077:.105;
      part(loft([[-cuff,width,width*.95],[-cuff+.018,width*1.03,width],[-.035,width*1.06,width],[0,width*.85,width*.9]]),arm?cloth:'#303c48');
      oval(arm?'#4598a4':'#25313b',0,-cuff+.005,0,width*1.02,.010,width*.98);
    });
    const lower=assembly((part,oval)=>{
      const r=arm?.045:.059;
      part(loft([[-lowerLength,r*.62,r*.72],[-lowerLength*.65,r*.72,r*.85],[-lowerLength*.28,r*1.13,r*1.10],[0,r,r]]),arm?skin:navy);
      oval(arm?skin:navy,0,0,0,r,r,r);
      if(!arm)oval('#465059',0,-lowerLength+.035,0,.044,.041,.045);
    });
    const end=assembly((part,oval)=>{
      if(arm){
        oval(skin,0,-.014,-.025,.039,.026,.051);
        for(let i=0;i<4;i++)oval(skin,(i-1.5)*.014,-.008,-.063,.008,.013,.025-i*.002);
        oval(skin,-sign*.036,-.004,-.036,.014,.015,.03);
      }else{
        oval('#d8ddd7',0,-.054,-.045,.061,.023,.132);
        oval(shoe,0,-.029,-.047,.059,.041,.123);
        oval(shoe,0,-.006,.025,.054,.055,.056);
        for(let i=0;i<3;i++)oval('#929da0',0,.005-i*.003,-.048-i*.017,.035,.004,.004,sign*.09);
      }
    });
    root.add(upper,lower,end);
    return {upper,lower,end,length,lowerLength,sign};
  }
  const arms=[-1,1].map(s=>limb(true,s)),legs=[-1,1].map(s=>limb(false,s));
  root.scale.setScalar(profile.scale);
  return {root,torso,head,arms,legs,...profile};
}

const axis=vec(), bend=vec(), joint=vec(), segment=vec();
function reach(limb,from,to,pole){
  axis.subVectors(to,from);const d=Math.max(.001,axis.length());axis.divideScalar(d);
  const a=limb.length,b=limb.lowerLength;
  const span=THREE.MathUtils.clamp(d,Math.abs(a-b)+.001,a+b-.0001);
  const along=(a*a-b*b+span*span)/(2*span);
  bend.copy(pole).addScaledVector(axis,-pole.dot(axis)).normalize();
  joint.copy(from).addScaledVector(axis,along).addScaledVector(bend,Math.sqrt(Math.max(0,a*a-along*along)));
  function bone(mesh,start,end,length){
    segment.subVectors(end,start);mesh.position.copy(start);
    mesh.scale.y=segment.length()/length;
    mesh.quaternion.setFromUnitVectors(down,segment.normalize());
  }
  bone(limb.upper,from,joint,a);bone(limb.lower,joint,to,b);limb.end.position.copy(to);
}

export function createLaunchCrew(){
  const group=new THREE.Group(), members=profiles.map(person);
  group.name='プラットフォームのプッシャー';group.add(...members.map(p=>p.root));
  let previousTime=-1,previousLaunch=null;
  const start=vec(),target=vec(),pole=vec();
  function update(launch,elapsed){
    const time=Math.min(elapsed,launch.duration+1.1);
    if(previousLaunch===launch && previousTime===time)return;
    previousTime=time;previousLaunch=launch;
    const cos=Math.cos(launch.heading),sin=Math.sin(launch.heading);
    for(const p of members){
      // At oblique headings the outside wing runner moves inboard onto the fan.
      const lateral=p.side ? p.side*(3.12-1.65*Math.abs(sin)) : .29;
      const aft=p.side?1.15:1.79;
      const x0=cos*lateral-sin*aft, z0=deckRun+sin*lateral+cos*aft;
      // The runners finish inside the curved lip (including shoe and stride clearance).
      const safe=t=>{
        const x=x0+t*launch.rightStep,z=z0-t*launch.forwardStep;
        return Math.abs(x)<6.43 && Math.hypot(x,Math.max(0,deckRun-z)+.52)<9.87;
      };
      let stop=launch.pushed;
      if(!safe(stop)){
        let lo=0,hi=stop;
        for(let i=0;i<12;i++){const m=(lo+hi)/2;if(safe(m))lo=m;else hi=m;}
        stop=lo;
      }
      const releasedAt=Math.sqrt(2*stop/launch.acceleration);
      const after=Math.max(0,time-releasedAt), relax=THREE.MathUtils.smoothstep(after,0,.59);
      const travel=rampAt(launch,Math.min(time,releasedAt)).travel;
      const x=x0+travel*launch.rightStep,z=z0-travel*launch.forwardStep;
      p.root.position.set(x,deckY(z),z);p.root.rotation.y=-launch.heading;
      const gait=p.phase+travel*Math.PI/1.10, run=Math.min(1,travel*2)*(1-relax);
      const crouch=.12*relax, bounce=.034*Math.cos(2*gait)*run;
      p.torso.position.set(0,.785+bounce-crouch,0);
      p.torso.rotation.x=-.34-.18*run+.16*relax;
      p.torso.rotation.z=.025*Math.sin(gait)*run;
      p.torso.updateMatrix();
      p.head.rotation.x=-p.torso.rotation.x*.65;
      for(const leg of p.legs){
        const s=leg.sign,cycle=Math.sin(gait)*s, swing=Math.cos(gait)*s;
        start.set(s*.094,p.torso.position.y,0);
        target.set(s*.105,.078+Math.max(0,swing)*.21*run,s*.125*(1-run)+cycle*.39*run);
        target.y+=(target.z*cos+target.x*sin)*Math.tan(deckAngle);
        reach(leg,start,target,pole.set(s*.035,0,-1));
        leg.end.rotation.x=-.24*run*Math.max(0,swing);
      }
      for(const arm of p.arms){
        const s=arm.sign;
        start.set(s*.186,.45,0).applyMatrix4(p.torso.matrix);
        const aircraftY=launch.edgeHeight+(RAMP_LENGTH-travel)*launch.dropStep+LAUNCH.deckClearance;
        const gripX=p.side?s*.174:s*.08-lateral;
        const gripY=aircraftY+(p.side?.535:.34)-p.root.position.y;
        target.set(gripX,gripY,(p.side?.565:1.32)-aft+.056).divideScalar(p.scale);
        target.lerp(segment.set(s*.22,.61,-.16),relax);
        reach(arm,start,target,pole.set(s*.58,-.24,.82));
      }
    }
  }
  return {group,update};
}
