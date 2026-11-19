import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { windGrid, WIND_GRID_SIZE } from '../domain/lake-breeze.js';
import { atmosphere, waterField } from './lake-shaders.js';

export const lakeReflectionLayer = 1;
export const sunDirection = new THREE.Vector3(0.72,0.67,-0.24).normalize();

// Camera-centred concentric rings resolve the nearby water silhouette without tessellating the basin.
function lakeGeometry(sectors) {
  const positions=[0,0,0], indices=[];
  const rings=112;
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

export function addLakeAndSky(scene, compact = false) {
  const env={nightScene:{value:0},windAngle:{value:0},clockTime:{value:0},meanWind:{value:1.2},gust:{value:0},sunlight:{value:sunDirection}};
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
  const water=new Reflector(lakeGeometry(compact ? 96 : 144),{
    textureWidth:compact ? 384 : 640,textureHeight:compact ? 288 : 480,multisample:0,
    shader:{name:'BiwaWater',uniforms:{...env,
      localWindGrid:{value:null},localWind:{value:new THREE.Vector4()},windPlatform:{value:new THREE.Vector2()},
      windOffset:{value:-1},fieldTime:{value:0},tDiffuse:{value:null},color:{value:null},textureMatrix:{value:null},
      boatWake:{value:new THREE.Vector4()},wakeStrength:{value:0},
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

        // Far rings represent the mean surface; finer wavelengths remain in the fragment normals.
        if(radius<70.) {
          float height=waves(vWorld.xz,shallowness(shoreUV(vWorld.xz)),max(.10,radius*.075)).x;
          vWorld.y+=height*(1.-smoothstep(24.,70.,radius));
        }
        mirrorCoord=textureMatrix*vec4(position,1.);
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader:`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec4 boatWake; // stern position and aft axis, world XZ
      uniform float wakeStrength;
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
        vec3 refl=texture2D(tDiffuse,clamp(lookup,0.,1.)).rgb;
        if(edge<.025) refl=mix(skyColor(reflect(-eye,n)),refl,smoothstep(0.,.025,edge));
        float mottling=noiseField(p*.012)*.65+noiseField(p*.003)*.35;
        vec3 deep=mix(vec3(.018,.065,.079),vec3(.031,.140,.149),mottling);
        vec3 scatter=deep*(.84+.34*max(dot(n,sunlight),0.));
        if(shallow>.001){
          vec3 imageColor=texture2D(bottomPhoto,clamp(uv+n.xz*.00012,0.,1.)).rgb;
          scatter=mix(scatter,imageColor,shallow*.80);
        }
        if(nightScene>.5) scatter*=vec3(.24,.33,.46);
        vec3 water=mix(scatter,refl,fresnel);
        float gloss=mix(540.,110.,clamp(pixel*.8,0.,1.));
        float highlight=pow(max(dot(n,normalize(eye+sunlight)),0.),gloss);
        water+=mix(vec3(.95,.78,.52),vec3(.63,.78,.98),nightScene)*highlight*(.13+.50*(1.-facing));
        water=mix(water,mix(vec3(.52,.65,.71),vec3(.055,.085,.13),nightScene),1.-exp(-dist*.000065));
        if(wakeStrength>.01) {
          vec2 delta=p-boatWake.xy;
          float aft=dot(delta,boatWake.zw);
          if(aft>0. && aft<18.) {
            float across=abs(dot(delta,vec2(-boatWake.w,boatWake.z)));
            float width=.85+aft*.26;
            float arm=1.-smoothstep(.07,.38+pixel,abs(across-width));
            float prop=(1.-smoothstep(.12,1.+aft*.06,across))*exp(-aft*.22);
            float foam=(.45*arm+prop)*smoothstep(0.,1.,aft)*(1.-smoothstep(5.,18.,aft));
            water=mix(water,mix(vec3(.67,.83,.81),vec3(.20,.32,.41),nightScene),min(1.,foam*wakeStrength*(.4+.6*noiseField(p*3.))));
          }
        }
        if(impact.z>=0. && impact.z<6.){
          float age=impact.z;
          vec2 local=p-impact.xy;
          float side=dot(local,vec2(-impactDirection.y,impactDirection.x));
          float along=dot(local,impactDirection)-min(age*1.3,2.);
          float radius=length(vec2(side,along*.62));
          float crest=radius-1.35*age;
          float foam=exp(-crest*crest/.09)+.7*exp(-radius*radius/(.4+age));
          water=mix(water,mix(vec3(.74,.89,.86),vec3(.25,.36,.45),nightScene),clamp(foam*impactPower*exp(-age*.75)*(.35+.65*noiseField(p*3.)),0.,.9));
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
  const fieldTexture=new THREE.DataTexture(windGrid,WIND_GRID_SIZE,WIND_GRID_SIZE);
  fieldTexture.minFilter=fieldTexture.magFilter=THREE.LinearFilter;
  fieldTexture.wrapS=fieldTexture.wrapT=THREE.RepeatWrapping;
  fieldTexture.needsUpdate=true;
  uniforms.localWindGrid.value=fieldTexture;
  const spray=new THREE.InstancedMesh(new THREE.SphereGeometry(1,6,4),new THREE.MeshBasicMaterial({color:0xd7f0ee}),48);
  spray.visible=false;spray.frustumCulled=false;
  scene.add(spray);
  const droplet=new THREE.Object3D(), velocities=[];
  const stern=new THREE.Vector3(), aftAxis=new THREE.Vector3();
  let impactTime=-Infinity;
  return {
    setNight(night, direction) {
      env.nightScene.value=uniforms.nightScene.value=night ? 1 : 0;
      // Reflector clones shader uniforms, including the light vector.
      env.sunlight.value=direction;
      uniforms.sunlight.value.copy(direction);
      spray.material.color.setHex(night ? 0x8fabc0 : 0xd7f0ee);
    },
    setWake(boat, strength) {
      uniforms.wakeStrength.value = strength;
      if (strength <= .01) return;
      boat.localToWorld(stern.set(0, 0, 2.65));
      aftAxis.set(0, 0, 1).transformDirection(boat.matrixWorld);
      uniforms.boatWake.value.set(stern.x, stern.z, aftAxis.x, aftAxis.z);
    },
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
    update(camera,t,windSpeed,gustSpeed,angle=0,field,fieldTime=0,platformYaw=0,gustOffset=0){
      uniforms.windOffset.value=field ? gustOffset : -1;
      if(field){
        uniforms.localWind.value.set(field.head,field.cross,field.along,field.lateral);
        uniforms.windPlatform.value.set(Math.cos(platformYaw),Math.sin(platformYaw));
        uniforms.fieldTime.value=fieldTime;
      }
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
