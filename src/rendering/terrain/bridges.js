import * as THREE from 'three';

export function riverBridges(detail, photo) {
  const deckPositions = [], deckUV = [], rails = [];
  const [west, north, east, south] = detail.bounds;
  for (const { width, points } of detail.bridges) {
    for (let k = 1; k < points.length; k++) {
      const a = new THREE.Vector3(...points[k - 1]), b = new THREE.Vector3(...points[k]);
      const normal = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize();
      function at(t, offset, lift = 0) {
        const point = a.clone().lerp(b, t).addScaledVector(normal, offset);
        point.y += 0.09 + 0.35*Math.sin(Math.PI*t) + lift;
        return point;
      }
      const sections = Math.ceil(a.distanceTo(b) / 3.5);
      for (let j = 0; j < sections; j++) {
        const t0 = j/sections, t1 = (j+1)/sections;
        const corners = [at(t0,-width/2),at(t0,width/2),at(t1,width/2),at(t1,-width/2)];
        for (const corner of [0,1,2,0,2,3]) {
          const p = corners[corner];
          deckPositions.push(p.x,p.y,p.z);
          deckUV.push((p.x-west)/(east-west),1-(p.z-north)/(south-north));
        }
        for (const side of [-1,1]) {
          const edge = side * width/2;
          rails.push([at(t0,edge,-0.25),at(t1,edge,-0.25),0.34,0.55]);
          rails.push([at(t0,edge,0.92),at(t1,edge,0.92),0.09,0.1]);
          rails.push([at(t0,edge),at(t0,edge,0.92),0.09,0.09]);
        }
      }
    }
  }
  const group = new THREE.Group();
  group.name = 'Matsubara river bridge · mapped centreline and DEM abutments';
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(deckPositions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(deckUV,2));
  group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:photo,side:THREE.DoubleSide})));
  const steel = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),
    new THREE.MeshBasicMaterial({color:0x8e9289}),rails.length);
  const object = new THREE.Object3D();
  const axis = new THREE.Vector3(0,0,1);
  rails.forEach(([a,b,width,height],i) => {
    const delta = b.clone().sub(a);
    object.position.copy(a).lerp(b,0.5);
    object.scale.set(width,height,delta.length());
    object.quaternion.setFromUnitVectors(axis,delta.normalize());
    object.updateMatrix();
    steel.setMatrixAt(i,object.matrix);
  });
  group.add(steel);
  return group;
}
