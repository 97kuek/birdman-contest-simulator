import * as THREE from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';

export const lakeReflectionLayer = 1;
export const sunDirection = new THREE.Vector3(0.72,0.67,-0.24).normalize();

const atmosphere = `
uniform float clockTime;
uniform float meanWind;
uniform float gust;
uniform float windAngle;
vec2 windDirection(vec2 d){float c=cos(windAngle), s=sin(windAngle);return vec2(c*d.x-s*d.y,s*d.x+c*d.y);}
uniform vec3 sunlight;
float hash(vec2 p) {
  vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float noiseField(vec2 p) {
  vec2 i=floor(p), f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
}
vec3 skyColor(vec3 ray) {
  float h=max(ray.y,0.);
  float sunDot=max(dot(ray,sunlight),0.);
  vec3 color=mix(vec3(.65,.77,.81),vec3(.15,.37,.65),pow(h,.45));
  vec2 p=ray.xz/max(.08,h+.055)*1.35-windDirection(vec2(.906,.423))*clockTime*(.0006+meanWind*.0007);
  float cloud=.55*noiseField(p)+.28*noiseField(p*2.04+14.)+.12*noiseField(p*4.2)+.05*noiseField(p*9.1);
  float cover=smoothstep(.50,.70,cloud)*smoothstep(.008,.15,h);
  color=mix(color,mix(vec3(.74,.79,.80),vec3(.98,.95,.86),cloud),cover*.86);
  return color+vec3(.46,.36,.18)*pow(sunDot,28.)+vec3(.9,.77,.48)*smoothstep(.9996,.99994,sunDot);
}
`;

// Camera-centred concentric rings resolve the nearby water silhouette without tessellating the basin.
function lakeGeometry() {
  const positions=[0,0,0], indices=[];
  const sectors=144, rings=112;
  let radius=0;
  for(let ring=0;ring<rings;ring++){
    radius+=0.16*Math.pow(1.098,ring);
    for(let j=0;j<sectors;j++){
      const a=2*Math.PI*j/sectors;
      positions.push(radius*Math.cos(a),radius*Math.sin(a),0);
      const i=1+ring*sectors+j, next=1+ring*sectors+(j+1)%sectors;
      if(ring===0) indices.push(0,i,next);
      else indices.push(i-sectors,i,next,next,next-sectors,i-sectors);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  return geometry;
}

const waterField = `
uniform sampler2D shallowMask;
uniform vec4 shoreBounds;
uniform float shoreReady;
uniform vec3 impact; // contact x, z and elapsed seconds
uniform vec2 impactDirection;
uniform float impactPower;
vec2 shoreUV(vec2 p){return vec2((p.x-shoreBounds.x)/(shoreBounds.z-shoreBounds.x),
                                  (shoreBounds.w-p.y)/(shoreBounds.w-shoreBounds.y));}
float shallowness(vec2 uv){
  if(shoreReady<.5 || any(lessThan(uv,vec2(0.))) || any(greaterThan(uv,vec2(1.)))) return 0.;
  return texture2D(shallowMask,uv).g;
}
// A finite directional spectrum. Height, d(height)/dx, d(height)/dz share wave phases.
// Frequencies follow the gravity–capillary deep-water dispersion relation in SI units.
vec3 band(vec2 p,vec2 dir,float wavelength,float amplitude,float phase,float footprint){
  float k=6.2831853/wavelength;
  float omega=sqrt(9.80665*k+.000073*k*k*k);
  float angle=k*dot(p,dir)-omega*clockTime+phase;
  float filtered=1.-smoothstep(.16,.55,footprint/wavelength);
  // A second oblique mode spreads each band into short, intersecting crests.
  float spread=.36+.13*sin(phase+1.);
  vec2 oblique=vec2(dir.x*cos(spread)-dir.y*sin(spread),dir.x*sin(spread)+dir.y*cos(spread));
  float k2=k*1.17, omega2=sqrt(9.80665*k2+.000073*k2*k2*k2);
  float secondary=k2*dot(p,oblique)-omega2*clockTime+phase*2.34+1.2;
  return filtered*amplitude*(.63*vec3(sin(angle),dir*(k*cos(angle)))+
                             .37*vec3(sin(secondary),oblique*(k2*cos(secondary))));
}
vec3 waves(vec2 p,float shore,float footprint){
  vec3 landing=vec3(0.);
  float age=impact.z;
  if(age>0. && age<7.){
    vec2 delta=p-impact.xy;
    float r=length(delta), ring=r-1.35*age;
    float envelope=exp(-ring*ring/.62-age*.52);
    float pulse=.035*sin(ring*7.)*envelope;
    float slope=.035*envelope*(7.*cos(ring*7.)-2.*ring/.62*sin(ring*7.));
    landing=vec3(pulse,slope*delta/max(r,.02))*smoothstep(0.,.12,age)
           *(1.-smoothstep(5.,7.,age))*(1.-smoothstep(.12,.35,footprint));
  }
  vec2 drift=p*.016-windDirection(vec2(.906,.423))*clockTime*.022;
  float waveGroup=.76+.48*noiseField(drift);
  float windScale=.13+.64*meanWind+.28*gust;
  float offshore=1.-.72*shore;
  vec3 surface=band(p,windDirection(vec2(.921,.390)),9.7,.027,0.,footprint)
              +band(p,windDirection(vec2(.725,.689)),4.1,.021,2.,footprint)
              +band(p,windDirection(vec2(.984,.178)),1.82,.014,4.,footprint);
  surface*=offshore;
  surface+=band(p,windDirection(vec2(.852,.524)),.78,.009,1.,footprint)
          +band(p,windDirection(vec2(.558,.830)),.34,.004,3.,footprint)
          +band(p,windDirection(vec2(.996,-.091)),.151,.002,5.,footprint);
  return surface*windScale*waveGroup+landing;
}
`;

export function addLakeAndSky(scene) {
  const env={windAngle:{value:0},clockTime:{value:0},meanWind:{value:1.2},gust:{value:0},sunlight:{value:sunDirection}};
  const sky=new THREE.Mesh(new THREE.SphereGeometry(48000,48,24),new THREE.ShaderMaterial({
    side:THREE.BackSide,depthWrite:false,depthTest:false,uniforms:env,
    vertexShader:`varying vec3 ray; void main(){ray=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec3 ray;
    ${atmosphere}
    void main(){gl_FragColor=vec4(skyColor(normalize(ray)),1.);
      #include <colorspace_fragment>
    }`
  }));
  sky.layers.enable(lakeReflectionLayer);
  sky.renderOrder=-10;
  scene.add(sky);
  const water=new Reflector(lakeGeometry(),{
    textureWidth:640,textureHeight:480,multisample:0,
    shader:{name:'BiwaWater',uniforms:{...env,tDiffuse:{value:null},color:{value:null},textureMatrix:{value:null},
      impact:{value:new THREE.Vector3(0,0,-100)},impactDirection:{value:new THREE.Vector2(0,-1)},impactPower:{value:1},landMask:{value:null},landReady:{value:0},
      landBounds:{value:new THREE.Vector4(0,0,1,1)},shoreBounds:{value:new THREE.Vector4(0,0,1,1)},shoreReady:{value:0},shallowMask:{value:null},bottomPhoto:{value:null}},
    vertexShader:`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform mat4 textureMatrix;
      varying vec3 vWorld;
      varying vec4 mirrorCoord;
      ${atmosphere}
      ${waterField}
      void main(){
        vWorld=(modelMatrix*vec4(position,1.)).xyz;
        float radius=length(position.xy);
        float shallow=shallowness(shoreUV(vWorld.xz));
        // Far rings represent the mean surface; finer wavelengths remain in the fragment normals.
        float height=waves(vWorld.xz,shallow,max(.10,radius*.075)).x;
        height*=1.-smoothstep(24.,70.,radius);
        vWorld.y+=height;
        mirrorCoord=textureMatrix*vec4(position,1.);
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader:`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D tDiffuse;
      uniform sampler2D bottomPhoto;
      uniform sampler2D landMask;
      uniform vec4 landBounds;
      uniform float landReady;
      varying vec3 vWorld;
      varying vec4 mirrorCoord;
      ${atmosphere}
      ${waterField}
      void main(){
        #include <logdepthbuf_fragment>
        vec2 p=vWorld.xz, uv=shoreUV(p);
        vec2 landUV=vec2((p.x-landBounds.x)/(landBounds.z-landBounds.x),(landBounds.w-p.y)/(landBounds.w-landBounds.y));
        if(landReady>.5 && all(greaterThanEqual(landUV,vec2(0.))) && all(lessThanEqual(landUV,vec2(1.)))
           && texture2D(landMask,landUV).r>.98) discard;
        float shallow=shallowness(uv);
        vec3 eye=normalize(cameraPosition-vWorld);
        float dist=length(cameraPosition-vWorld);
        float pixel=max(length(dFdx(p)),length(dFdy(p)));
        vec3 wave=waves(p,shallow,pixel);
        vec3 n=normalize(vec3(-wave.y,1.,-wave.z));
        float facing=clamp(dot(n,eye),0.,1.);
        float fresnel=.021+.979*pow(1.-facing,5.);
        vec2 mirrorUV=mirrorCoord.xy/mirrorCoord.w;
        vec2 screenRight=vec2(viewMatrix[0][0],viewMatrix[2][0]);
        vec2 projectedSlopes=vec2(dot(n.xz,screenRight),dot(n.xz,normalize(eye.xz+vec2(.00001))));
        vec2 delta=projectedSlopes*vec2(.085,.22)*(1.-smoothstep(400.,2600.,dist));
        vec2 lookup=mirrorUV+delta;
        float edge=min(min(lookup.x,1.-lookup.x),min(lookup.y,1.-lookup.y));
        vec3 refl=mix(skyColor(reflect(-eye,n)),texture2D(tDiffuse,clamp(lookup,0.,1.)).rgb,smoothstep(0.,.025,edge));
        float mottling=noiseField(p*.012)*.65+noiseField(p*.003)*.35;
        vec3 deep=mix(vec3(.018,.065,.079),vec3(.031,.140,.149),mottling);
        vec3 scatter=deep*(.84+.34*max(dot(n,sunlight),0.));
        if(shallow>.001){
          vec3 imageColor=texture2D(bottomPhoto,clamp(uv+n.xz*.00012,0.,1.)).rgb;
          scatter=mix(scatter,imageColor,shallow*.80);
        }
        vec3 water=mix(scatter,refl,fresnel);
        float gloss=mix(540.,110.,clamp(pixel*.8,0.,1.));
        float highlight=pow(max(dot(n,normalize(eye+sunlight)),0.),gloss);
        water+=vec3(.95,.78,.52)*highlight*(.13+.50*(1.-facing));
        water=mix(water,vec3(.52,.65,.71),1.-exp(-dist*.000065));
        if(impact.z>=0. && impact.z<6.){
          float age=impact.z;
          vec2 local=p-impact.xy;
          float side=dot(local,vec2(-impactDirection.y,impactDirection.x));
          float along=dot(local,impactDirection)-min(age*1.3,2.);
          float radius=length(vec2(side,along*.62));
          float crest=radius-1.35*age;
          float foam=exp(-crest*crest/.09)+.7*exp(-radius*radius/(.4+age));
          water=mix(water,vec3(.74,.89,.86),clamp(foam*impactPower*exp(-age*.75)*(.35+.65*noiseField(p*3.)),0.,.9));
        }
        gl_FragColor=vec4(water,1.);
        #include <colorspace_fragment>
      }`
    }
  });
  water.camera.layers.set(lakeReflectionLayer);
  water.getRenderTarget().texture.type=THREE.UnsignedByteType;
  water.rotation.x=-Math.PI/2;
  scene.add(water);
  const uniforms=water.material.uniforms;
  const spray=new THREE.InstancedMesh(new THREE.SphereGeometry(1,6,4),new THREE.MeshBasicMaterial({color:0xd7f0ee}),48);
  spray.visible=false;spray.frustumCulled=false;
  scene.add(spray);
  const droplet=new THREE.Object3D(), velocities=[];
  let impactTime=-Infinity;
  return {
    touch(point,direction,sink){
      impactTime=performance.now();
      const power=THREE.MathUtils.clamp(.8+sink*.35,.8,2.2);
      uniforms.impact.value.set(point.x,point.z,0);
      uniforms.impactPower.value=power;
      uniforms.impactDirection.value.set(direction.x,direction.z);
      spray.position.copy(point);
      velocities.length=0;
      for(let i=0;i<spray.count;i++){
        const angle=i*2.39996, spread=(1.2+(i%7)*.34)*Math.sqrt(power);
        velocities.push(new THREE.Vector3(direction.x*2+Math.cos(angle)*spread,(1.8+i%9*.42)*Math.sqrt(power),direction.z*2+Math.sin(angle)*spread));
      }
    },
    setShallows({photo,mask,bounds,landMask,landBounds}){
      if(landMask && landBounds){
        uniforms.landMask.value=landMask;uniforms.landBounds.value.fromArray(landBounds);
        uniforms.landReady.value=1;
      }
      uniforms.shallowMask.value=mask;uniforms.bottomPhoto.value=photo;
      uniforms.shoreBounds.value.fromArray(bounds);uniforms.shoreReady.value=1;
    },
    update(camera,t,windSpeed,gustSpeed,angle=0){
      env.windAngle.value=uniforms.windAngle.value=angle;
      const age=(performance.now()-impactTime)/1000;
      uniforms.impact.value.z=age<7?age:-100;
      spray.visible=age<1.8;
      if(spray.visible){
        for(let i=0;i<velocities.length;i++){
          droplet.position.copy(velocities[i]).multiplyScalar(age);
          droplet.position.y-=4.9*age*age;
          const size=droplet.position.y>0?.04+(i%4)*.018:0;
          droplet.scale.set(size,size*1.5,size);droplet.updateMatrix();
          spray.setMatrixAt(i,droplet.matrix);
        }
        spray.instanceMatrix.needsUpdate=true;
      }
      env.clockTime.value=uniforms.clockTime.value=t;
      env.meanWind.value=uniforms.meanWind.value=windSpeed;
      env.gust.value=uniforms.gust.value=gustSpeed;
      water.position.set(camera.position.x,0,camera.position.z);
      sky.position.copy(camera.position);
    }
  };
}
