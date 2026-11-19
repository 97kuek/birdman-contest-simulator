import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const navy = '#252d36';
const uniforms = {
  ryukai: { cloth: '#4eacb6', hem: '#42949f', cuff: '#4598a4', trim: '#dbefeb' },
  qx25: { cloth: '#efa522', hem: '#d58b23', cuff: '#de941c', trim: '#b6761c' },
};
const finish=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88});
const sphere=new THREE.SphereGeometry(1,16,12);

// Elliptical cross sections define the jaw, shoulders, waist and tapered limbs.
export function bodyLoft(rows) {
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
export function createCrewHead(skin, hair, ponytail = false) {
  return assembly((part,oval)=>{
    part(bodyLoft([[-.11,.037,.041,-.028],[-.084,.068,.067,-.018],[-.036,.086,.09],[.033,.093,.10],[.093,.080,.079],[.12,.038,.043]]),skin);
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
    if(ponytail)oval(hair,0,.041,.108,.052,.048,.045);
  });
}

function person(profile, team){
  const { cloth, hem, cuff: sleeveEdge, trim } = uniforms[team];
  const {skin,hair,shoe,side}=profile;
  const root=new THREE.Group();root.name='プッシャー・'+profile.name;
  const torso=assembly((part,oval)=>{
    part(bodyLoft([[-.09,.145,.108],[0,.168,.117],[.13,.143,.104],[.30,.173,.119],[.43,.205,.117],[.49,.178,.095],[.52,.085,.073]]),cloth);
    oval(hem,0,-.065,.004,.153,.022,.112);
    oval(trim,0,.501,-.012,.083,.018,.076);
    oval(skin,0,.542,-.009,.062,.083,.057);
    if (team === 'ryukai') {
      oval(trim,0,.305,.114,.097,.098,.008);
      for(const s of [-1,1])oval('#267d8c',s*.037,.317,.123,.048,.012,.004,s*.34);
      oval('#237886',0,.282,.124,.009,.038,.005,-.24);
      oval(trim,-.085,.385,-.108,.029,.024,.007);
    } else {
      // Small chest print on the gold team shirts in the university's 2025 group photo.
      oval('#4b3a2e',-.085,.385,-.108,.022,.014,.006);
    }
  });
  const head=createCrewHead(skin, hair, side===1);
  head.position.set(0,.665,-.02);torso.add(head);root.add(torso);
  function limb(arm,sign){
    const length=arm?.29:.415, lowerLength=arm?.26:.415;
    const upper=assembly((part,oval)=>{
      const r=arm?.057:.086;
      part(bodyLoft([[-length,.67*r,.7*r],[-length*.75,.83*r,.87*r],[-length*.32,r,r],[0,.85*r,.91*r]]),arm?skin:navy);
      oval(arm?cloth:navy,0,0,0,r,r,r);
      const cuff=arm?.15:.27, width=arm?.077:.105;
      part(bodyLoft([[-cuff,width,width*.95],[-cuff+.018,width*1.03,width],[-.035,width*1.06,width],[0,width*.85,width*.9]]),arm?cloth:'#303c48');
      oval(arm?sleeveEdge:'#25313b',0,-cuff+.005,0,width*1.02,.010,width*.98);
    });
    const lower=assembly((part,oval)=>{
      const r=arm?.045:.059;
      part(bodyLoft([[-lowerLength,r*.62,r*.72],[-lowerLength*.65,r*.72,r*.85],[-lowerLength*.28,r*1.13,r*1.10],[0,r,r]]),arm?skin:navy);
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

export function createCrewMembers(team = 'ryukai') {
  return profiles.map(profile => person(profile, team));
}
