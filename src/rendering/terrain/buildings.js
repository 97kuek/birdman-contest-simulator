import * as THREE from 'three';

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

export function shorelineBuildings(buildings, bounds, photo, facadeTexture) {
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
