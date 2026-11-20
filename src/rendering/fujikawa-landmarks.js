import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inBounds, surfaceHeight } from './terrain/surface.js';

// Roof corners traced clockwise on the 1024px-wide GSI runway mosaic.
// Heights and gable rises are visual estimates. These buildings lie west of the levee.
const roofs = [
  [[138,634],[205,632],[206,664],[138,666],9,2.8],
  [[142,670],[205,668],[206,706],[142,707],8.5,2],
  [[145,713],[204,712],[204,727],[145,728],7,1.1],
  [[145,751],[205,749],[207,785],[146,789],7.8,1.7],
  [[120,756],[142,755],[142,787],[122,789],5.5,.8],
  [[78,611],[95,610],[97,660],[79,661],6,1.2],
  [[99,616],[117,615],[116,669],[98,668],5,.8],
  [[56,446],[96,449],[87,501],[50,498],8,1.9],
  [[94,402],[120,399],[125,412],[96,417],5,.7],
  [[213,451],[240,445],[245,456],[217,465],5,.7],
  [[216,475],[239,468],[244,482],[220,489],5.2,.9],
  [[116,809],[145,807],[146,828],[117,830],5.8,.8],
  [[228,308],[240,305],[244,322],[229,325],4.5,1.1],
  [[170,257],[182,259],[178,278],[166,276],4,.8],
  [[268,568],[279,561],[287,577],[275,584],4.5,.8],
];

function roofBuildings(point, photo, bounds) {
  const roofPositions = [], uv = [], walls = [];
  const [west, north, east, south] = bounds;
  for (const [a, b, c, d, height, rise] of roofs) {
    let ground = [a,b,c,d].map(p => point(...p));
    if (ground[0].distanceTo(ground[1]) < ground[1].distanceTo(ground[2]))
      ground = [ground[1], ground[2], ground[3], ground[0]];
    const eaveHeight = Math.max(...ground.map(p => p.y)) + height;
    const eaves = ground.map(v => new THREE.Vector3(v.x, eaveHeight, v.z));
    const ridge = (a, b) => new THREE.Vector3().lerpVectors(eaves[a], eaves[b], .5)
      .add(new THREE.Vector3(0, rise, 0));
    const near = ridge(0,3), far = ridge(1,2);
    const roof = [eaves[0],near,far,eaves[0],far,eaves[1],near,eaves[3],eaves[2],near,eaves[2],far];
    for (const p of roof) {
      roofPositions.push(p.x,p.y,p.z);
      uv.push((p.x-west)/(east-west),1-(p.z-north)/(south-north));
    }
    // FrontSide normals point outwards in world X/Z coordinates.
    for (let i=0; i<4; i++) {
      const j=(i+1)%4;
      for (const v of [ground[i],eaves[i],eaves[j],ground[i],eaves[j],ground[j]]) walls.push(v.x,v.y,v.z);
    }
    for (const v of [eaves[3],near,eaves[0],eaves[1],far,eaves[2]]) walls.push(v.x,v.y,v.z);
  }
  function geometry(vertices) {
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(vertices,3));
    result.computeVertexNormals();
    return result;
  }
  const roofGeometry = geometry(roofPositions);
  roofGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
  const group = new THREE.Group();
  group.name = '堤内地の屋根と建物';
  group.add(new THREE.Mesh(roofGeometry,new THREE.MeshBasicMaterial({map:photo,side:THREE.DoubleSide})),
    new THREE.Mesh(geometry(walls),new THREE.MeshLambertMaterial({color:0xb8b2a3,side:THREE.DoubleSide})));
  return group;
}

function riparianTrees(rows, point, foliage) {
  const group = new THREE.Group();
  group.name = '河川敷の樹林帯と生け垣';
  const transform = new THREE.Object3D(), colour = new THREE.Color();
  for (const [form, texture] of Object.entries(foliage)) {
    const tall = form === 'canopy';
    const plants = rows.filter(row => (row[2] > 3) === tall);
    const cards = tall ? 3 : 2;
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: texture, alphaTest: .32, side: THREE.DoubleSide,
    });
    const geometry = new THREE.PlaneGeometry(1, 1).translate(0, .5, 0);
    const mesh = new THREE.InstancedMesh(geometry, material, plants.length * cards);
    plants.forEach(([u,v,height,radius,brightness], i) => {
      transform.position.copy(point(u,v));
      transform.scale.set(radius*2.4, height*1.13, 1);
      const shade = THREE.MathUtils.clamp(brightness/110,.72,1.25);
      colour.setRGB(shade*1.04,shade,shade*.91);
      for (let k=0; k<cards; k++) {
        transform.rotation.y = u*.47+v*.31 + k*Math.PI/cards;
        transform.updateMatrix();
        const index = i*cards+k;
        mesh.setMatrixAt(index,transform.matrix);
        mesh.setColorAt(index,colour);
      }
    });
    group.add(mesh);
  }
  return group;
}

// River-edge blocks are visible as a pale, repeating band around the southeast
// curve. Trace that band along the bank; spacing and block profile are approximate.
function riverRevetment(point) {
  const path = [[608,905],[619,902],[629,897],[635,890],[638,880],
    [637,871],[628,819],[613,735],[594,631],[576,535],[554,418],[535,321],
    [517,225],[504,158],[494,102]].map(([u,v]) => new THREE.Vector2(u,v));
  const blocks = [];
  for (let i=1; i<path.length; i++) {
    const delta = new THREE.Vector2().subVectors(path[i],path[i-1]);
    const angle = Math.atan2(delta.x,delta.y);
    const steps = Math.ceil(delta.length()/1.6);
    const bankNormal = new THREE.Vector2(-delta.y,delta.x).normalize();
    for (let j=0; j<steps; j++) {
      for (const row of [0,1]) {
        const at = path[i-1].clone().lerp(path[i],(j+row*.45)/steps).addScaledVector(bankNormal,row*1.05);
        blocks.push([point(at.x,at.y),angle,row]);
      }
    }
  }
  const geometry = new THREE.CylinderGeometry(.64,1.02,1,5,1);
  const revetment = new THREE.InstancedMesh(geometry,new THREE.MeshLambertMaterial({color:0xffffff}),blocks.length);
  revetment.name = '滑走路東側の護岸ブロック';
  const matrix=new THREE.Object3D(), colour=new THREE.Color();
  blocks.forEach(([p,angle,row],i) => {
    matrix.position.copy(p).y += .12;
    matrix.rotation.set(0,angle + .19*Math.sin(i*3),.12*row);
    matrix.scale.set(1.04,.74 + .26*Math.cos(i),1.30);
    matrix.updateMatrix();
    revetment.setMatrixAt(i,matrix.matrix);
    colour.setHex(row ? 0x888a7c : 0xa1a094).multiplyScalar(.89+.16*Math.sin(i*24.3));
    revetment.setColorAt(i,colour);
  });
  return revetment;
}

function ballFields(point) {
  // Backstops sit behind the pale dirt fans in the northern baseball/softball fields.
  const supports=[], netPositions=[], netIndices=[];
  for (const [u,v,rotation] of [[302,264,2.3],[352,284,-.8],[308,326,2.4],[385,245,1.0],[482,586,-.7]]) {
    const origin=point(u,v);
    const rotate=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),rotation);
    const pts=[[-8,2.2],[-4,0],[4,0],[8,2.2]].map(([x,z]) =>
      new THREE.Vector3(x,0,z).applyQuaternion(rotate).add(origin));
    for (const p of pts) supports.push(new THREE.CylinderGeometry(.075,.075,5.8,5).translate(p.x,p.y+2.9,p.z));
    for (let i=1; i<pts.length; i++) {
      const a=pts[i-1], b=pts[i], k=netPositions.length/3;
      netPositions.push(a.x,a.y,a.z,b.x,b.y,b.z,a.x,a.y+5.5,a.z,b.x,b.y+5.5,b.z);
      netIndices.push(k,k+1,k+2,k+2,k+1,k+3);
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(netPositions,3));
  geo.setIndex(netIndices);
  const group=new THREE.Group();
  group.name='河川敷グラウンドのバックネット';
  group.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x446553,transparent:true,
    opacity:.23,side:THREE.DoubleSide,depthWrite:false})),
    new THREE.Mesh(mergeGeometries(supports),new THREE.MeshLambertMaterial({color:0x7c8677})));
  for (const geo of supports) geo.dispose();
  return group;
}

// Two parallel road decks on the Route 1 alignment visible in the orthophoto.
function roadBridge(point) {
  const start=point(245,190), end=point(1200,-211);
  const direction=new THREE.Vector3().subVectors(end,start).setY(0).normalize();
  const distance=Math.hypot(end.x-start.x,end.z-start.z);
  const angle=Math.atan2(-direction.z,direction.x);
  const group=new THREE.Group();
  group.name='国道1号・新富士川橋';
  group.position.set((start.x+end.x)/2,16.5,(start.z+end.z)/2);
  group.rotation.y=angle;
  const decks=[], girders=[], concrete=[];
  function box(list,w,h,d,x,y,z) {
    list.push(new THREE.BoxGeometry(w,h,d).translate(x,y,z));
  }
  for (const z of [-5.8,5.8]) {
    box(decks,distance,.65,10,0,0,z);
    box(girders,distance,1.65,6.8,0,-1.15,z);
    for (const edge of [-4.85,4.85]) box(concrete,distance,.72,.34,0,.64,z+edge);
    const spans=Math.round(distance/64);
    for (let i=0;i<=spans;i++) {
      const x=distance*(i/spans-.5);
      box(concrete,2.3,15,3.1,x,-9,z);
      box(concrete,2.7,1.3,8.4,x,-2.6,z);
    }
  }
  for (const [batch,color] of [[decks,0x676762],[girders,0x52685e],[concrete,0xb6b4a8]]) {
    group.add(new THREE.Mesh(mergeGeometries(batch),
      new THREE.MeshLambertMaterial({color})));
    for (const geom of batch) geom.dispose();
  }
  return group;
}

export function fieldLandmarks(runway, river, trees, foliage) {
  const [west,north,east] = runway.layer.bounds;
  const metres = (east-west)/1024;
  const point = (u,v) => {
    const x=west+u*metres, z=north+v*metres;
    const surface=inBounds(x,z,runway.layer.bounds) ? runway : river;
    return new THREE.Vector3(x,surfaceHeight(surface,x,z),z);
  };
  const landmarks=new THREE.Group();
  landmarks.name='富士川河口の地物';
  landmarks.add(roofBuildings(point,runway.photo,runway.layer.bounds),riparianTrees(trees,point,foliage),
    roadBridge(point),riverRevetment(point),ballFields(point));
  return landmarks;
}
