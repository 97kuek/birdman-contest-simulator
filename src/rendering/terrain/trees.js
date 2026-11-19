import * as THREE from 'three';

// One coloured mesh per tree form, instanced over all locations of that form.
function treeGeometry(pine, variant) {
  const positions = [], colors = [], indices = [];
  const tint = new THREE.Color();
  function vertex(x, y, z, color, shade) {
    positions.push(x, y, z);
    tint.setHex(color).multiplyScalar(shade);
    colors.push(tint.r, tint.g, tint.b);
    return positions.length / 3 - 1;
  }
  function wood(a, b, r0, r1) {
    const dir = b.clone().sub(a).normalize();
    const side = dir.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
    const other = dir.clone().cross(side);
    const start = positions.length / 3;
    for (const [centre, radius] of [[a,r0], [b,r1]]) {
      for (let j = 0; j < 5; j++) {
        const angle = j * Math.PI * 2 / 5;
        const offset = side.clone().multiplyScalar(Math.cos(angle)).addScaledVector(other, Math.sin(angle));
        const pt = centre.clone().addScaledVector(offset, radius);
        vertex(pt.x, pt.y, pt.z, 0x6c6050, 0.83 + 0.17 * offset.x);
      }
    }
    for (let j = 0; j < 5; j++) {
      const k = (j + 1) % 5;
      indices.push(start+j,start+k,start+j+5, start+k,start+k+5,start+j+5);
    }
  }
  const barkBase = new THREE.Vector3(0,-0.04,0);
  const fork = new THREE.Vector3(0.045 + variant * 0.011, pine ? 0.44 : 0.31, 0.035);
  wood(barkBase, fork, pine ? 0.027 : 0.036, 0.02);
  const clumps = pine ? 5 : 3;
  for (let k = 0; k < clumps; k++) {
    const angle = k * 2.4 + variant * 0.71;
    const lateral = (k === 0 ? 0.04 : 0.17 + 0.026*k);
    const cx = fork.x + lateral * Math.cos(angle), cz = fork.z + lateral * Math.sin(angle);
    const cy = (pine ? 0.91 : 0.81) - k * (pine ? 0.078 : 0.095);
    if (pine || !k) wood(fork, new THREE.Vector3(cx,cy-0.035,cz), 0.016, 0.007);
    const radius = pine ? 0.22 + k*0.009 : 0.39;
    const height = pine ? 0.145 : 0.31;
    const start = positions.length/3;
    const count = pine ? 8 : 7;
    const foliage = pine ? [0x466044,0x526943,0x455b40][variant] : [0x58744b,0x526e48,0x647c50][variant];
    vertex(cx,cy+height,cz,foliage,1.23);
    for (let tier = 0; tier < 2; tier++) {
      for (let j = 0; j < count; j++) {
        const a = 2*Math.PI*j/count + angle + tier*0.17;
        const lobe = 1 + 0.14*Math.sin(a*3.4+k*2+variant);
        const r = radius*lobe*(tier ? 0.85 : 1);
        const y = cy + height*((tier ? -0.52 : 0.15) + 0.13*Math.sin(a*3+k));
        vertex(cx+Math.cos(a)*r,y,cz+Math.sin(a)*r*0.86,foliage,
          (tier ? 0.67 : 0.98) + 0.12*Math.cos(a+0.8));
      }
    }
    const base = vertex(cx,cy-height,cz,foliage,0.57);
    for (let j = 0; j < count; j++) {
      const a=start+1+j,b=start+1+(j+1)%count;
      indices.push(start,b,a, a,b,b+count, a,b+count,a+count, a+count,b+count,base);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geom.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geom.setIndex(indices);
  return geom;
}

export function shorelineTrees(trees) {
  const group = new THREE.Group();
  group.name = 'Matsubara pine belt and wooded hillside · ortho canopy estimates';
  const material = new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.DoubleSide });
  const transform = new THREE.Object3D();
  for (let form = 0; form < 6; form++) {
    const instances = trees.filter(([, , , , hill], i) => (hill ? 3 : 0) + i % 3 === form);
    if (!instances.length) continue;
    const mesh = new THREE.InstancedMesh(treeGeometry(form < 3, form % 3),material,instances.length);
    instances.forEach(([x,y,z,h],i) => {
      transform.position.set(x,y,z);
      transform.rotation.y = i*2.39996;
      transform.scale.set(h,h,h*(0.88+0.16*Math.sin(i)));
      transform.updateMatrix();
      mesh.setMatrixAt(i,transform.matrix);
    });
    group.add(mesh);
  }
  return group;
}
