import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAircraft } from './aircraft.js';
import { BASE_DESIGN } from './flight.js';
import { setupTrials } from './trials.js';
import {createLaunchCrew} from './crew.js';
import { createPlatform } from './platform.js';
import { addLandscape } from './landscape.js';
import {WEATHER,windAt} from './weather.js';
import { addLakeAndSky, lakeReflectionLayer, sunDirection } from './lake.js';

const $ = selector => document.querySelector(selector);
const paths = {
  play:'M7 4.5 19 12 7 19.5z', pause:'M7 5h3v14H7z M14 5h3v14h-3z',
  chart:'M3 4v15h18 M6 14l4-5 4 3 6-7',
  book:'M3 5q5-2 9 1 4-3 9-1v14q-5-2-9 1-4-3-9-1z M12 6v14',
  pin:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  plus:'M5 12h14m-7-7v14', minus:'M5 12h14', frame:'M3 9V4h5m8 0h5v5m0 6v5h-5m-8 0H3v-5',
  undo:'M3 6v5h5m-5 0a8 8 0 1 1 2 7', close:'m6 6 12 12m0-12L6 18'
};
for (const el of document.querySelectorAll('[data-icon]')) {
  el.outerHTML = '<svg aria-hidden="true" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="'+paths[el.dataset.icon]+'"/></svg>';
}
const dialog=$('#source-dialog');
$('#sources').onclick=()=>dialog.showModal();
$('#close-sources').onclick=()=>dialog.close();
dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}};

const fullButton=$('#fullscreen');
if(!document.fullscreenEnabled)fullButton.hidden=true;
fullButton.onclick=async()=>{
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }catch{fullButton.hidden=true;}
};
document.addEventListener('fullscreenchange',()=>{
  const label=document.fullscreenElement?'全画面表示を終了':'全画面表示';
  fullButton.title=label;fullButton.setAttribute('aria-label',label);
});
const base=BASE_DESIGN;
const state={...base,view:'aircraft'};
const host=$('#canvas-host');
const viewer=$('#viewer');
const status=$('#loading');

function release(group){
  const geometry=new Set(), materials=new Set();
  group.traverse(o=>{
    if(o.geometry) geometry.add(o.geometry);
    if(o.material) for(const m of [].concat(o.material)) materials.add(m);
  });
  for(const g of geometry) g.dispose();
  for(const m of materials) m.dispose();
}

async function start() {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,logarithmicDepthBuffer:true,powerPreference:'high-performance'});
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','竜海と松原湖岸の3Dモデル。ドラッグで回転、ホイールで拡大縮小');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0xb7d6de);
  scene.fog=new THREE.FogExp2(0xd2dfda,.00009);
  const camera=new THREE.PerspectiveCamera(38,1,.18,56000);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=.12;
  controls.maxPolarAngle=Math.PI*.49;
  controls.minDistance=2.8;
  controls.maxDistance=4800;
  controls.zoomSpeed=.9;
  controls.panSpeed=.7;
  const ambient=new THREE.HemisphereLight(0xfffaf0,0xb5cfcf,2.15);
  ambient.layers.enable(lakeReflectionLayer);
  scene.add(ambient);
  const sun=new THREE.DirectionalLight(0xfff1d6,2.1);
  sun.position.copy(sunDirection).multiplyScalar(60);
  sun.layers.enable(lakeReflectionLayer);
  sun.castShadow=true;
  Object.assign(sun.shadow.camera,{left:-25,right:25,top:25,bottom:-25,near:.5,far:120});
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.normalBias=.017;
  sun.shadow.bias=-.00022;
  scene.add(sun);
  const lake=addLakeAndSky(scene);
  const facility=new THREE.Group();
  facility.rotation.y=THREE.MathUtils.degToRad(65);
  scene.add(facility);
  const platform=createPlatform({shoreDistance:168});
  facility.add(platform);
  platform.traverse(o=>{o.layers.enable(lakeReflectionLayer);if(o.isMesh){o.receiveShadow=true;o.castShadow=true;}});
  const crew=createLaunchCrew();
  crew.group.traverse(o=>o.layers.enable(lakeReflectionLayer));
  facility.add(crew.group);
  const modelBase=new THREE.Group();
  modelBase.position.set(0,10+3*Math.tan(3.5*Math.PI/180)+.04,3);
  facility.add(modelBase);
  let trials;
  const aircraft=createAircraft(base.span,base.incidence);
  aircraft.traverse(o=>o.layers.enable(lakeReflectionLayer));
  modelBase.add(aircraft);
  const pilotBody=aircraft.getObjectByName('pilot-weight-shift');
  const world=(x,y,z)=>facility.localToWorld(new THREE.Vector3(x,y,z));
  const attachedModes=new Set(['pilot','boat']);
  const viewEye=new THREE.Vector3(), viewFocus=new THREE.Vector3(), viewOrientation=new THREE.Quaternion();
  let boatApproach=0, boatTime=0;
  function followAircraft(mode){
    if(mode==='boat'){
      const now=performance.now();
      if(!trials?.atWater)boatApproach=0;
      else boatApproach=Math.min(1,boatApproach+Math.min(100,now-boatTime)/3500);
      boatTime=now;
      const reach=Math.max(1,1.05/camera.aspect);
      viewEye.set(modelBase.position.x+19*reach,1.65,modelBase.position.z-33*reach);
      if(trials?.atWater){
        // Stay alongside the glider after contact, including on narrow displays.
        const heading=-modelBase.rotation.y;
        const reach=THREE.MathUtils.clamp(state.span/25.1,.85,1.2);
        const side=19*reach, ahead=9*reach;
        viewEye.lerp(viewFocus.set(modelBase.position.x+side*Math.cos(heading)+ahead*Math.sin(heading),
          2.1,modelBase.position.z+side*Math.sin(heading)-ahead*Math.cos(heading)),THREE.MathUtils.smoothstep(boatApproach,0,1));
      }
      camera.position.copy(facility.localToWorld(viewEye));
      controls.target.copy(modelBase.localToWorld(viewFocus.set(0,0.45,0)));
      camera.up.set(0,1,0);camera.lookAt(controls.target);camera.updateMatrixWorld();
      return;
    }
    // Keep the lens just ahead of the face and move it with the prone pilot.
    viewEye.set(0,.304,-.86+pilotBody.position.z);viewFocus.set(0,.304,-12+pilotBody.position.z);
    camera.position.copy(modelBase.localToWorld(viewEye));
    controls.target.copy(modelBase.localToWorld(viewFocus));
    camera.up.set(0,1,0).applyQuaternion(modelBase.getWorldQuaternion(viewOrientation));
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
  }
  function setView(mode){
    state.view=mode;
    const ratio=Math.max(1,1.38/camera.aspect);
    let pos,target;
    const fixed=attachedModes.has(mode);
    controls.enabled=!fixed;
    camera.fov=mode==='pilot'?76:fixed?45:38;
    camera.near=mode==='pilot'?0.02:0.18;
    camera.updateProjectionMatrix();
    document.querySelector('.gestures').textContent=mode==='boat'?(trials?.atWater?'ボートから着水地点を表示':'湖面上1.65 mから追走'):fixed?'機体の姿勢に追従':'ドラッグで回転　·　スクロールで拡大';
    if(fixed){
      followAircraft(mode);
    }else if(mode==='tracks'){
      const bounds=trials.trackBounds;
      const forward=(bounds.far+bounds.near)/2, right=(bounds.left+bounds.right)/2;
      const extent=Math.max(45,bounds.far-bounds.near);
      const horizontal=Math.tan(camera.fov*Math.PI/360)*camera.aspect;
      const mobile=matchMedia('(max-width:740px) and (orientation:portrait)').matches;
      const visibleFraction=mobile?1:1-($('#comparison').offsetWidth+32)/host.clientWidth;
      const distance=Math.max(35,extent*.59/(horizontal*Math.max(.32,visibleFraction)));
      target=world(right,4,-forward);
      pos=world(bounds.right+distance,4+distance*.3,-forward+distance*.08);
    }else{
      const {x,y,z}=modelBase.position;
      target=world(x-.65,y+.7,z-.2);
      pos=world(x+13*ratio,y+.7+6.3*ratio,z-32*ratio);
    }
    if(!fixed){
      camera.up.set(0,1,0);
      camera.position.copy(pos);
      controls.target.copy(target);
      controls.update();
    }
    for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===mode || b.dataset.view==='aircraft' && !fixed));
  }
  for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>setView(b.dataset.view==='aircraft' && trials?.atWater?'tracks':b.dataset.view);
  $('#camera-reset').onclick=()=>setView(state.view);
  function zoom(factor){
    if(attachedModes.has(state.view)){
      camera.fov=THREE.MathUtils.clamp(camera.fov*factor,25,96);
      camera.updateProjectionMatrix();
      return;
    }
    const offset=camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance));
    camera.position.copy(controls.target).add(offset);controls.update();
  }
  $('#zoom-in').onclick=()=>zoom(.78);$('#zoom-out').onclick=()=>zoom(1/.78);
  function framePanel(){
    const panel=document.body.dataset.stage==='setup'?$('#flight-settings'):null;
    const w=host.clientWidth,h=host.clientHeight;
    if(panel && w && h){
      const r=panel.getBoundingClientRect(), bottomSheet=r.width>w*.78;
      camera.setViewOffset(w,h,bottomSheet?0:(w-r.left)*.5,bottomSheet?(h-r.top)*.43:0,w,h);
    }else camera.clearViewOffset();
  }
  const panelObserver=new ResizeObserver(framePanel);
  panelObserver.observe($('#flight-settings'));panelObserver.observe($('#comparison'));
  function resize(){
    const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();
    renderer.setSize(w,h,false);framePanel();
    if(trials && state.view==='tracks')setView('tracks');
  }
  const initialView=location.hash.slice(1);
  resize();setView(['pilot','boat'].includes(initialView)?initialView:'aircraft');
  new ResizeObserver(resize).observe(host);
  const north=new THREE.Vector3(),center=new THREE.Vector3();
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let last=0, sceneTime=0;
  renderer.setAnimationLoop(now=>{
    if(now-last<30)return;
    const elapsed=last?Math.min((now-last)/1000,0.15):0;last=now;
    trials?.tick(now);
    if(attachedModes.has(state.view)) followAircraft(state.view);
    else controls.update();
    const weatherMode=trials?.weather ?? document.querySelector('input[name="weather"]:checked').value;
    const weather=WEATHER[weatherMode];
    // Keep the water phase continuous when launching, finishing or skipping a replay.
    const flightClock=trials?.weatherTime;
    sceneTime+=elapsed;
    const visualTime=reduceMotion.matches?0:sceneTime;
    const fluctuation=weather.gustSpeed ? windAt(weatherMode,150,reduceMotion.matches?0:(flightClock??sceneTime)).headwind-weather.lakeWindSpeed : 0;
    lake.update(camera,visualTime,weather.lakeWindSpeed,fluctuation,Math.atan2(weather.crosswind??0,weather.headwind??1));
    center.copy(controls.target).project(camera);
    north.copy(controls.target);north.z-=1;north.project(camera);
    const bearing=Math.atan2((north.x-center.x)*camera.aspect,north.y-center.y);
    $('.compass svg').style.transform='rotate('+bearing+'rad)';
    renderer.render(scene,camera);
  });
  const landscape=await addLandscape(scene);
  // Reflect the actual terrain, pines and buildings as well as the glider.
  landscape.traverse(part=>part.layers.enable(lakeReflectionLayer));
  lake.setShallows(landscape.userData.shallows);
  trials=setupTrials({facility,crew,modelBase,aircraft,
    setView,view:()=>state.view,
    moveCamera:delta=>{camera.position.add(delta);controls.target.add(delta);},
    releaseModel:release,
    onWaterContact:(right,forward,sample)=>{
      if(reduceMotion.matches)return;
      const direction=new THREE.Vector3(Math.sin(sample.track),0,-Math.cos(sample.track)).transformDirection(facility.matrixWorld);
      lake.touch(world(right,0,-forward),direction,Math.abs(sample.verticalSpeed));
    }});
  status.hidden=true;
  host.dataset.ready='true';
}
start().catch(error=>{
  console.error(error);
  status.textContent='3Dシーンを読み込めませんでした。WebGL対応ブラウザで再読み込みしてください。';
});
