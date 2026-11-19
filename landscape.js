import * as THREE from 'three';

const assets = new URL('./terrain/', document.baseURI);

function assetUrl(name) {
  return new URL(name, assets);
}
const missing = -32768;
const water = -32767;

async function readAsset(name, format) {
  const binary=format==='binary';
  const response = await fetch(assetUrl(binary ? name+'.gz' : name));
  if (!response.ok) throw new Error(`Terrain asset ${name}: ${response.status}`);
  if(!binary)return response.json();
  const bytes=new Uint8Array(await response.arrayBuffer());
  // Some static hosts already decode .gz through the Content-Encoding header.
  if(bytes[0]!==0x1f || bytes[1]!==0x8b)return bytes.buffer;
  if(typeof DecompressionStream==='function'){
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  const {gunzipSync}=await import('three/addons/libs/fflate.module.js');
  return gunzipSync(bytes).buffer;
}

function inBounds(x, z, bounds) {
  return bounds && x > bounds[0] && x < bounds[2] && z > bounds[1] && z < bounds[3];
}

// Sample the same two triangles that terrainMesh emits, including their diagonal.
// This is also the height that finer data has to meet at the edge of a hole.
function surfaceHeight(surface, x, z) {
  const { layer, heights } = surface;
  const { bounds, width, height } = layer;
  const u = THREE.MathUtils.clamp((x-bounds[0])/(bounds[2]-bounds[0])*(width-1),0,width-1);
  const v = THREE.MathUtils.clamp((z-bounds[1])/(bounds[3]-bounds[1])*(height-1),0,height-1);
  const i = Math.min(Math.floor(u),width-2), j = Math.min(Math.floor(v),height-2);
  const fx = u-i, fz = v-j, at = j*width+i;
  const a = heights[at], b = heights[at+1], c = heights[at+width], d = heights[at+width+1];
  return fx+fz <= 1 ? a+(b-a)*fx+(c-a)*fz : d+(c-d)*(1-fx)+(b-d)*(1-fz);
}

function terrainMesh(layer, elevations, texture, parent) {
  const { width, height, bounds, hole } = layer;
  const [west, north, east, south] = bounds;
  const dx = (east - west) / (width - 1);
  const dz = (south - north) / (height - 1);
  const positions = new Float32Array(width * height * 3);
  const uv = new Float32Array(width * height * 2);
  const tint = texture ? null : new Float32Array(positions.length);
  const indices = [];
  const heights = new Float32Array(width * height);

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const k = j * width + i;
      const v = elevations[k];
      const x = west + i * dx;
      const z = north + j * dz;
      positions[k * 3] = x;
      let y = v === water ? -0.7 : (v === missing ? 0 : Math.max(0.12, v * 0.1));
      const fromEdge = Math.min(i,j,width-1-i,height-1-j);
      if (parent && fromEdge < 3) {
        y = THREE.MathUtils.lerp(surfaceHeight(parent,x,z),y,fromEdge/3);
      }
      heights[k] = y;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      uv[k * 2] = i / (width - 1);
      uv[k * 2 + 1] = 1 - j / (height - 1);

      // Ridge shading uses real relief. This material also works with no scene lights.
      if (tint) {
        const vEast = elevations[j * width + Math.min(i + 1, width - 1)];
        const vNorth = elevations[Math.max(j - 1, 0) * width + i];
        const gradient = vEast > water && vNorth > water ? (vEast - vNorth) * 0.1 / dx : 0;
        const brightness = THREE.MathUtils.clamp(1 + gradient * 0.5, 0.67, 1.28);
        const high = THREE.MathUtils.clamp((v * 0.1 - 40) / 380, 0, 1);
        tint[k * 3] = (0.135 - high * 0.038) * brightness;
        tint[k * 3 + 1] = (0.217 - high * 0.042) * brightness;
        tint[k * 3 + 2] = (0.183 - high * 0.026) * brightness;
      }

      if (i === width - 1 || j === height - 1 || inBounds(x + dx / 2, z + dz / 2, hole)) continue;
      const a = k, b = k + 1, c = k + width, d = c + 1;
      for (const [p, q, r] of [[a, c, b], [b, c, d]]) {
        const vp = elevations[p], vq = elevations[q], vr = elevations[r];
        if (vp === missing || vq === missing || vr === missing) continue;
        if (vp === water && vq === water && vr === water) continue;
        indices.push(p, q, r);
      }
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(indices);
  if (texture) geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (tint) geom.setAttribute('color', new THREE.BufferAttribute(tint, 3));
  const mat = new THREE.MeshBasicMaterial({ map: texture, vertexColors: Boolean(tint),
    polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-2 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = `GSI terrain · ${layer.name}`;
  return {mesh,layer,heights,photo:texture};
}

function roofForm(plan, height) {
  let dx = 0, dz = 0, longest = 0;
  for (let i = 0; i < plan.length; i++) {
    const a = plan[i], b = plan[(i+1)%plan.length];
    const x = b.x-a.x, z = b.y-a.y, len = Math.hypot(x,z);
    if (len > longest) { longest=len; dx=x/len; dz=z/len; }
  }
  const area = Math.abs(THREE.ShapeUtils.area(plan));
  if (area < 30 || area > 310 || height > 6) return null;
  let lo=Infinity,hi=-Infinity,left=Infinity,right=-Infinity;
  for (const p of plan) {
    const u=p.x*dx+p.y*dz, v=-p.x*dz+p.y*dx;
    lo=Math.min(lo,u); hi=Math.max(hi,u); left=Math.min(left,v); right=Math.max(right,v);
  }
  const width=right-left;
  if (width < 3 || width > 15 || area / ((hi-lo)*width) < 0.84) return null;
  return { nx:-dz, nz:dx, mid:(left+right)*0.5, half:width*0.5, rise:Math.min(2.5,width*0.19) };
}

function shorelineBuildings(buildings, bounds, photo, facadeTexture) {
  const wallPositions=[], wallColors=[], wallUV=[], roofPositions=[], roofUV=[];
  const [west,north,east,south]=bounds;
  const paint=new THREE.Color();
  const plaster=[0xe6dcc6,0xd7d1b9,0xc3b297,0xebdfcd,0xacb6af,0xc8bca8];
  for (const [base,height,points] of buildings) {
    const plan=[];
    for (let i=0; i<points.length; i+=2) plan.push(new THREE.Vector2(points[i],points[i+1]));
    const form=roofForm(plan,height);
    const eave=base+height-(form ? form.rise*0.65 : 0);
    const seed=Math.abs(Math.floor(plan[0].x*19+plan[0].y*31));
    const atlasRow=form ? seed%2 : (height>6 || Math.abs(THREE.ShapeUtils.area(plan))>240 ? 2 : 1);
    function side(p) { return p.x*form.nx+p.y*form.nz-form.mid; }
    function roofY(p) {
      return form ? eave+form.rise*Math.max(0,1-Math.abs(side(p))/form.half) : eave;
    }
    function roofCorner(p) {
      roofPositions.push(p.x,roofY(p),p.y);
      roofUV.push((p.x-west)/(east-west),1-(p.y-north)/(south-north));
    }
    // Split mapped triangles on the ridge. This keeps pitched slopes planar
    // and preserves the actual footprint of a house with clipped corners.
    function splitRoof(tri, sign) {
      const poly=[];
      for (let i=0;i<3;i++) {
        const a=tri[i], b=tri[(i+1)%3], fa=sign*side(a), fb=sign*side(b);
        if (fa>=0) poly.push(a);
        if (fa*fb<0) poly.push(a.clone().lerp(b,fa/(fa-fb)));
      }
      for (let i=1;i<poly.length-1;i++) {
        roofCorner(poly[0]);roofCorner(poly[i]);roofCorner(poly[i+1]);
      }
    }
    for (const ids of THREE.ShapeUtils.triangulateShape(plan,[])) {
      const tri=ids.map(i=>plan[i]);
      if (form) {splitRoof(tri,1);splitRoof(tri,-1);}
      else tri.forEach(roofCorner);
    }
    for (let i=0;i<plan.length;i++) {
      const a=plan[i],b=plan[(i+1)%plan.length], len=a.distanceTo(b);
      if(len<0.01) continue;
      const shade=0.79+0.17*(b.x-a.x-0.4*(b.y-a.y))/len;
      paint.setHex(plaster[seed%plaster.length]).multiplyScalar(shade);
      // Match one texture repeat to an integer number of window bays so
      // the final window in each facade finishes before the corner.
      const bays=Math.max(1,Math.round(len/(atlasRow===2 ? 6.2 : 4.5)));
      function corner(p,y,u,v,row) {
        wallPositions.push(p.x,y,p.y);wallColors.push(paint.r,paint.g,paint.b);
        wallUV.push(u,1-(row+(1-v)*0.98+0.01)/4);
      }
      function band(bottom,top,row) {
        corner(a,bottom,0,0,row);corner(a,top,0,1,row);corner(b,top,bays,1,row);
        corner(a,bottom,0,0,row);corner(b,top,bays,1,row);corner(b,bottom,bays,0,row);
      }
      band(base-3,base,3);
      const floors=Math.max(1,Math.round((eave-base)/3));
      for (let j=0;j<floors;j++) band(base+(eave-base)*j/floors,base+(eave-base)*(j+1)/floors,atlasRow);
      if (!form) continue;
      const ends=[a,b], fa=side(a),fb=side(b);
      if (fa*fb<0) ends.splice(1,0,a.clone().lerp(b,fa/(fa-fb)));
      for(let j=1;j<ends.length;j++){
        const p=ends[j-1],q=ends[j],yp=roofY(p),yq=roofY(q);
        if(Math.max(yp,yq)<eave+0.01)continue;
        const u0=p.distanceTo(a)/len*bays, u1=q.distanceTo(a)/len*bays;
        corner(p,eave,u0,0,3);corner(p,yp,u0,(yp-eave)/3,3);corner(q,yq,u1,(yq-eave)/3,3);
        corner(p,eave,u0,0,3);corner(q,yq,u1,(yq-eave)/3,3);corner(q,eave,u1,0,3);
      }
    }
  }
  function mesh(positions,uv,texture,colors) {
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    return new THREE.Mesh(g,new THREE.MeshBasicMaterial({map:texture,vertexColors:Boolean(colors),side:THREE.DoubleSide}));
  }
  const group=new THREE.Group();
  group.name='GSI building footprints · estimated heights and roof forms';
  group.add(mesh(wallPositions,wallUV,facadeTexture,wallColors),mesh(roofPositions,roofUV,photo));
  return group;
}

function matsubaraGround(detail, buffer, texture, parent) {
  const { bounds, vertices, triangles } = detail;
  const [west, north, east, south] = bounds;
  const Index = vertices > 65535 ? Uint32Array : Uint16Array;
  const indexOffset = vertices * 6;
  if (buffer.byteLength !== indexOffset + triangles * 3 * Index.BYTES_PER_ELEMENT) {
    throw new Error('Invalid Matsubara terrain mesh');
  }
  const samples = new Int16Array(buffer, 0, vertices * 3);
  const positions = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  for (let i = 0; i < vertices; i++) {
    // Restore exact shared boundary coordinates after decimetre quantisation.
    const qx = samples[i*3], qz = samples[i*3+2];
    const x = qx === Math.round((east-west)*10) ? east-west : qx*0.1;
    const z = qz === Math.round((south-north)*10) ? south-north : qz*0.1;
    const distance = Math.min(x,z,east-west-x,south-north-z);
    let y = samples[i*3+1]*0.01;
    if (distance < 3.9) y = THREE.MathUtils.lerp(surfaceHeight(parent,west+x,north+z),y,distance/3.9);
    positions.set([west+x,y,north+z],i*3);
    uv.set([x / (east - west), 1 - z / (south - north)], i * 2);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setIndex(new THREE.BufferAttribute(new Index(buffer, indexOffset), 1));
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ map: texture,
    polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-2 }));
  mesh.name = 'Matsubara beach and estuary · clipped DEM1A';
  return mesh;
}

function riverBridges(detail, photo) {
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

function shorelineTrees(trees) {
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

async function readLayer(layer,loader) {
  const [buffer, photo] = await Promise.all([
    readAsset(layer.name + '.bin', 'binary'),
    layer.name === 'basin' ? null : loader.loadAsync(assetUrl(layer.name + '.jpg').href)
  ]);
  if (buffer.byteLength !== layer.width * layer.height * 2) {
    throw new Error(`Invalid elevation grid: ${layer.name}`);
  }
  if (photo) {
    photo.colorSpace = THREE.SRGBColorSpace;
    photo.anisotropy = 4;
  }
  return {layer,elevations:new Int16Array(buffer),photo};
}

/** Local metres relative to the launch, east +X, south +Z, lake surface Y=0. */
export async function addLandscape(scene) {
  const loader = new THREE.TextureLoader();
  const [assetsByLayer, objects, detail, detailBuffer, detailPhoto, shallowsMask, facades, landMask] = await Promise.all([
    readAsset('index.json','json').then(layers=>Promise.all(layers.map(layer=>readLayer(layer,loader)))),
    readAsset('shoreline.json','json'),
    readAsset('matsubara.json', 'json'), readAsset('matsubara.bin', 'binary'),
    loader.loadAsync(assetUrl('matsubara.jpg').href), loader.loadAsync(assetUrl('shallows.png').href),
    loader.loadAsync(assetUrl('facades.jpg').href), loader.loadAsync(assetUrl('land-mask.png').href)
  ]);
  facades.colorSpace = THREE.SRGBColorSpace;
  facades.wrapS = THREE.RepeatWrapping;
  facades.anisotropy = 4;
  detailPhoto.colorSpace = THREE.SRGBColorSpace;
  detailPhoto.anisotropy = 4;
  const parts = [];
  for (const {layer,elevations,photo} of assetsByLayer) {
    parts.push(terrainMesh(layer,elevations,photo,parts[parts.length-1]));
  }
  const group = new THREE.Group();
  group.name = 'Lake Biwa · Matsubara';
  group.add(...parts.map(p => p.mesh));
  const shore = parts.find(p => p.layer.name === 'shore');
  group.add(matsubaraGround(detail, detailBuffer, detailPhoto, shore), riverBridges(detail, detailPhoto));
  group.userData.shallows = {photo:detailPhoto,mask:shallowsMask,bounds:detail.bounds,
    landMask,landBounds:shore.layer.bounds};
  const close = [], distant = [];
  for (const building of objects.buildings) {
    const outline = building[2];
    let inside = true;
    for (let i = 0; i < outline.length; i += 2) {
      if (!inBounds(outline[i], outline[i + 1], detail.bounds)) { inside = false; break; }
    }
    (inside ? close : distant).push(building);
  }
  group.add(shorelineBuildings(close, detail.bounds, detailPhoto, facades));
  group.add(shorelineBuildings(distant, shore.layer.bounds, shore.photo, facades));
  const beyondDetail = objects.trees.filter(([x, , z]) => !inBounds(x, z, detail.bounds));
  group.add(shorelineTrees(beyondDetail.concat(detail.trees)));
  scene.add(group);
  return group;
}
