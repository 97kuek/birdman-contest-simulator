import {ConvexHull} from 'three/addons/math/ConvexHull.js';
import * as THREE from 'three';
import {setupCaptions,launchCue} from './captions.js';
import {setupReplay} from './replay.js';
import {windAt} from './weather.js';
import { BASE_DESIGN, CG_HEIGHT, LAUNCH, RAMP_LENGTH, launchProfile, rampAt, FLIGHT_LIMIT_SECONDS, SAMPLES_PER_SECOND, createFlight, hull2D, simulateFlight, WATER_RUNOUT_SECONDS, waterRunoutPose } from './flight.js';

const $ = id => document.getElementById(id);
const colors = ['#b7441c','#65489b','#217547','#bd3468','#0567a5'];
const radians = Math.PI/180;

export function modelHull(model) {
  // Compose only aircraft-local transforms so a previous landing pose cannot
  // change hull vertices through floating point cancellation in world space.
  const hinge=model.getObjectByName('rudder-hinge');
  const point=new THREE.Vector3(), points=[], fixed=[], fin=[];
  function collect(part,transform,moving=false){
    if(part.name==='pilot')return; // Interior pose cannot affect first water contact.
    if(part.isMesh){
      const attr=part.geometry.attributes.position;
      for(let i=0;i<attr.count;i++){
        point.fromBufferAttribute(attr,i).applyMatrix4(transform);
        points.push([point.z,point.y-CG_HEIGHT]);
        (moving?fin:fixed).push(point.clone());
      }
    }
    for(const child of part.children){
      if(child.matrixAutoUpdate)child.updateMatrix();
      const local=child===hinge?new THREE.Matrix4().makeTranslation(child.position):child.matrix;
      collect(child,new THREE.Matrix4().multiplyMatrices(transform,local),moving || child===hinge);
    }
  }
  collect(model,new THREE.Matrix4());
  const hull=hull2D(points);
  function corners(points){
    const shell=new ConvexHull().setFromPoints(points);
    return [...new Set(shell.faces.flatMap(face=>[face.edge.head().point,face.edge.next.head().point,face.edge.prev.head().point]))];
  }
  hull.fixed=corners(fixed).map(p=>[p.z,p.y-CG_HEIGHT,p.x]);
  hull.fin=corners(fin).map(p=>[p.z,p.y-CG_HEIGHT,p.x]);
  hull.hingeZ=hinge.position.z;
  hull.spatial=[...hull.fixed,...hull.fin];
  return hull;
}

function trail(run, color, reference){
  const geometry=new THREE.BufferGeometry();
  if(run){
    geometry.setFromPoints(run.samples.map(s=>new THREE.Vector3(s.right,s.height,-s.forward)));
  }else{
    const capacity=FLIGHT_LIMIT_SECONDS*SAMPLES_PER_SECOND+2;
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(3*capacity),3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0,0);
  }
  const material=reference
    ? new THREE.LineDashedMaterial({color,dashSize:2.4,gapSize:1,depthTest:false})
    : new THREE.LineBasicMaterial({color,depthTest:false});
  const line=new THREE.Line(geometry,material);
  line.renderOrder=3;
  if(!run)line.frustumCulled=false;
  if(reference) line.computeLineDistances();
  const marker=new THREE.Mesh(new THREE.RingGeometry(.55,.9,32),
    new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,depthTest:false}));
  marker.rotation.x=-Math.PI/2;
  if(run)marker.position.set(run.tailRight,.05,-run.tailForward);
  marker.visible=Boolean(run);
  marker.renderOrder=4;
  const group=new THREE.Group();group.add(line,marker);
  return {group,line,marker};
}

function extendTrail(line,samples){
  const geometry=line.geometry, positions=geometry.attributes.position;
  const start=geometry.drawRange.count;
  if(start===samples.length)return;
  for(let i=start;i<samples.length;i++){
    const s=samples[i];
    positions.setXYZ(i,s.right,s.height,-s.forward);
  }
  positions.addUpdateRange(3*start,3*(samples.length-start));
  positions.needsUpdate=true;
  geometry.setDrawRange(0,samples.length);
}

// Retain the latest completed flight per wind and heading. Only the active pair needs GPU geometry.
export function setupTrials({facility,crew,modelBase,aircraft,setView,view,moveCamera,releaseModel,onWaterContact}){
  const weatherControls=[...document.querySelectorAll('input[name="weather"]')];
  const selectedWeather=()=>weatherControls.find(control=>control.checked).value;
  const rudder=aircraft.getObjectByName('rudder-hinge');
  const {setBodyOffset}=aircraft.getObjectByName('pilot').userData;
  const pilotBody=aircraft.getObjectByName('pilot-weight-shift');
  const hull=modelHull(aircraft);
  let direction=0;
  let launch=launchProfile(1,0,direction);
  const historyKey=()=>mode+'/'+direction;
  const flightOptions=()=>({weather:mode,push:launch.push,coast:launch.coast,direction:launch.direction});
  let mode=selectedWeather();
  const records=new Map();
  const baseKey='reference';
  let active=null, atWater=false, review=null;
  const captions=setupCaptions();
  let countdown=null;
  const latestByConditions=new Map();
  let resultRecord=null;
  let landing=null;
  function stage(name){
    document.body.dataset.stage=name;
    $('flight-settings').hidden=name!=='setup';
    $('comparison').hidden=name!=='result';
    $('replay-panel').hidden=name!=='replay';
    $('flight-hud').hidden=!['flight','replay','landing'].includes(name);
    $('landing-call').hidden=name!=='landing';
    $('align-panel').hidden=name!=='align';
    $('launch-call').hidden=name!=='countdown';
    $('wind-meter').hidden=!['align','countdown','flight','replay'].includes(name);
    $('flight-action').hidden=!['align','countdown','flight'].includes(name);
    $('flight-action').textContent=name==='flight'?'飛行を中断':'準備に戻る';
    $('previous-result').hidden=!latestByConditions.has(historyKey());
  }
  const held=new Map();
  let manualNumber=0;
  function pilotInput(axis=1){
    const directions=new Set(held.values());
    return Number(directions.has(axis))-Number(directions.has(-axis));
  }
  function clearInput(){held.clear();}
  function setInput(source,value){
    if(!active || (held.get(source)??0)===value)return;
    // Integrate to the event time using the previous command, even between rendered frames.
    tick(performance.now());
    if(!active)return;
    if(value)held.set(source,value);
    else held.delete(source);
  }
  function changeDirection(step){
    direction=Math.max(-30,Math.min(30,direction+step));
    $('launch-direction').value=direction===0?'正面 0°':(direction<0?'左 ':'右 ')+Math.abs(direction)+'°';
    $('direction-left').disabled=direction===-30;
    $('direction-right').disabled=direction===30;
    changeConditions();
  }
  $('direction-left').onclick=()=>changeDirection(-1);
  $('direction-right').onclick=()=>changeDirection(1);
  const arrows={ArrowDown:1,ArrowUp:-1,ArrowLeft:-2,ArrowRight:2};
  let lastDirectionStep=0;
  window.addEventListener('keydown',e=>{
    if(e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('input, select, textarea, dialog, [contenteditable=true]'))return;
    const command=arrows[e.key], aiming=document.body.dataset.stage==='align';
    if(aiming && Math.abs(command)===2){
      e.preventDefault();
      const now=performance.now();
      if(!e.repeat || now-lastDirectionStep>=90){
        changeDirection(Math.sign(command));lastDirectionStep=now;
      }
    }else if(aiming && e.code==='Space' && (!e.target.closest?.('button') || e.target.closest('#align-panel'))){
      e.preventDefault();if(!e.repeat)confirmHeading();
    }else if(active && command){
      e.preventDefault();if(!e.repeat)setInput(e.key,command);
    }
  });
  window.addEventListener('keyup',e=>{if(held.has(e.key)){e.preventDefault();setInput(e.key,0);}});
  // A held drag on the pilot's viewport gives touch screens the same two input axes.
  const canvas=$('canvas-host');
  let touch=null;
  canvas.addEventListener('pointerdown',e=>{
    if(e.pointerType!=='touch' || !active || view()!=='pilot' || touch)return;
    touch={id:e.pointerId,x:e.clientX,y:e.clientY};
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(e.pointerId!==touch?.id)return;
    const dx=e.clientX-touch.x,dy=e.clientY-touch.y;
    setInput('touch-turn',Math.abs(dx)>18?2*Math.sign(dx):0);
    setInput('touch-pitch',Math.abs(dy)>18?Math.sign(dy):0);
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{
    if(e.pointerId!==touch?.id)return;
    touch=null;setInput('touch-turn',0);setInput('touch-pitch',0);
  });
  function releaseInput(){
    if(active)tick(performance.now());
    clearInput();
  }
  window.addEventListener('blur',releaseInput);
  function resetCaptionClock(){
    if(countdown)countdown.last=performance.now();
    if(document.hidden || $('source-dialog').open)captions.clear();
  }
  new MutationObserver(resetCaptionClock).observe($('source-dialog'),{attributes:true,attributeFilter:['open']});
  document.addEventListener('visibilitychange',()=>{
    resetCaptionClock();
    if(!active)return;
    if(document.hidden)releaseInput();
    if(active)active.previousTime=performance.now();
  });
  function cacheReference(){
    const color='#174d5b';
    const run=simulateFlight(BASE_DESIGN,hull,flightOptions());
    const record={run,color,reference:true,label:'基準機',...trail(run,color,true)};
    facility.add(record.group);
    records.set(baseKey,record);
  }
  function pose(s) {
    const old=modelBase.getWorldPosition(new THREE.Vector3());
    const {right, forward, heading} = s;
    setBodyOffset(.47*(s.shift??0));
    rudder.rotation.y=(s.rudderDeg??0)*radians;
    modelBase.rotation.set(s.pitch,-heading,-(s.bank??0),'YXZ');
    const offset=new THREE.Vector3(0,-CG_HEIGHT,0).applyEuler(modelBase.rotation);
    modelBase.position.set(right,s.height,-forward).add(offset);
    if(view()==='aircraft')moveCamera(modelBase.getWorldPosition(new THREE.Vector3()).sub(old));
  }
  function renderWind(heading,pathLength,t,preview=false){
    const wind=windAt(mode,pathLength,t);
    const speed=Math.hypot(wind.headwind,wind.crosswind??0);
    const relative=heading+Math.atan2(-(wind.crosswind??0),wind.headwind);
    const along=Math.cos(relative), side=Math.sin(relative);
    const from=Math.abs(side)<.22?(along>=0?'正面':'後方'):(side>0?'左':'右')+(Math.abs(along)<.22?'横':along>0?'前':'後');
    $('wind-arrow').style.transform='rotate('+(180-relative/radians)+'deg)';
    $('wind-arrow').style.opacity=speed<.05?0:1;
    $('wind-place').textContent=preview?'プラットフォームの風':'現在地の風';
    $('wind-value').textContent=speed<.05?'無風':from+'から '+speed.toFixed(1)+' m/s';
    const vertical=Math.abs(wind.updraft);
    $('wind-detail').textContent=vertical>=.05?(wind.updraft>0?'上昇流 ':'下降流 ')+vertical.toFixed(1)+' m/s':'▲ 機首　矢印は風の流れ';
  }
  function instruments(s,phase){
    const tilt=(value,positive,negative)=>Math.abs(value/radians)<.1?'水平':(value>0?positive:negative)+Math.abs(value/radians).toFixed(1)+'°';
    renderWind(s.heading,s.pathLength??0,s.t??0);
    $('phase').textContent=phase;
    const course=Math.atan2(Math.sin(s.track??s.heading),Math.cos(s.track??s.heading))/radians;
    $('course-value').textContent='進路 '+(Math.abs(course)<.5?'0°':(course<0?'左 ':'右 ')+Math.abs(course).toFixed(0)+'°');
    $('instrument-time').textContent=(s.t??0).toFixed(1)+' s';
    $('speed-value').textContent=s.speed.toFixed(1);
    $('height-value').textContent=(s.bottomHeight??s.height-CG_HEIGHT).toFixed(1);
    const vertical=s.verticalSpeed??0;
    $('climb-label').textContent=Math.abs(vertical)<.05?'昇降':vertical>0?'上昇中':'下降中';
    $('climb-value').textContent=Math.abs(vertical).toFixed(1);
    $('pitch-value').textContent=tilt(s.pitch,'上','下');
    const rudder=s.rudderDeg??0;
    $('rudder-value').textContent=rudder?(rudder>0?'右':'左')+Math.abs(rudder).toFixed(0)+'°':'中立';
    $('bank-value').textContent=tilt(s.bank??0,'右','左');
    $('pitch-horizon').style.transform='rotate('+(-(s.bank??0)/radians)+'deg) translateY('+Math.max(-14,Math.min(14,s.pitch/radians))+'px)';
  }
  function waterPose(run, seconds){
    const contact=run.samples.at(-1);
    return waterRunoutPose(contact,seconds,hull,windAt(run.weather,contact.pathLength,contact.t));
  }
  const replay=setupReplay({
    showPose(s, afterContact){
      const {record}=review;
      if(afterContact>0)s=waterPose(record.run,afterContact);
      pose(s);
      record.line.geometry.setDrawRange(0,s.t>=record.run.duration ? record.run.samples.length : Math.floor(s.t*SAMPLES_PER_SECOND)+1);
      record.marker.visible=s.t>=record.run.duration;
      instruments(s,record.marker.visible?'着水・リプレイ':'リプレイ');

    },
    onClose(){
      const prior=review;
      prior.record.line.geometry.setDrawRange(0,prior.record.run.samples.length);
      prior.record.marker.visible=true;
      for(const r of records.values())r.group.visible=true;
      modelBase.position.copy(prior.position);modelBase.rotation.copy(prior.rotation);
      rudder.rotation.y=prior.rudder;
      setBodyOffset(prior.pilotZ);
      review=null;
      stage('result');
      setView(prior.view);
      prior.button.focus({preventScroll:true});
    }
  });
  function openReplay(record,button){
    if(!record || active || review)return;
    captions.clear();
    review={record,button,pilotZ:pilotBody.position.z,rudder:rudder.rotation.y,position:modelBase.position.clone(),rotation:modelBase.rotation.clone(),view:view()};
    for(const r of records.values())r.group.visible=r===record || r.reference;
    setView('pilot');
    stage('replay');
    replay.open(record,records.get(baseKey).run);
  }
  $('result-replay').onclick=()=>openReplay(resultRecord,$('result-replay'));

  function showResult(record){
    resultRecord=record;
    $('result-distance').textContent=record.run.distance.toFixed(2);
    $('result-duration').textContent=record.run.duration.toFixed(1);
    stage('result');
    $('result-heading').focus({preventScroll:true});
  }
  function prepare(){
    captions.clear();
    atWater=false;
    for(const r of records.values())r.group.visible=false;
    resultRecord=null;
    placeOnDeck();
    setView('aircraft');
    stage('setup');
    document.querySelector('.setup-title').focus({preventScroll:true});
  }
  $('previous-result').onclick=()=>{
    if(!records.has(baseKey))cacheReference();
    let previous=records.get('latest');
    if(!previous){
      const saved=latestByConditions.get(historyKey());
      previous={...saved,...trail(saved.run,saved.color,false)};
      facility.add(previous.group);
      records.set('latest',previous);
    }
    pose(waterPose(previous.run,WATER_RUNOUT_SECONDS));
    atWater=true;
    for(const r of records.values())r.group.visible=true;
    crew.update(launch,Infinity);
    showResult(previous);
    setView('boat');
  };
  $('retry').onclick=()=>{
    aim();
  };
  function aim(){
    for(const r of records.values())r.group.visible=false;
    atWater=false;
    placeOnDeck();
    stage('align');
    captions.show('東京理科大学・鳥科の竜海です。');
    setView('pilot');
    renderWind(launch.heading,0,0,true);
    $('viewer').focus({preventScroll:true});
  }
  function confirmHeading(){
    if(document.body.dataset.stage!=='align')return;
    if(!records.has(baseKey))cacheReference();
    for(const r of records.values())r.group.visible=false;
    const live=createFlight(BASE_DESIGN,hull,flightOptions());
    countdown={live,seconds:0,last:performance.now()};
    stage('countdown');
    $('call-text').textContent='左翼、いいですか？';
    $('launch-call').classList.remove('go');
    captions.clear();
    $('viewer').focus({preventScroll:true});
  }
  $('confirm-heading').onclick=confirmHeading;
  function start(live,now,elapsed){
    const color=colors[manualNumber%colors.length];
    manualNumber++;
    const record={label:'試技 '+manualNumber,color,reference:false,...trail(null,color,false)};
    facility.add(record.group);
    record.line.geometry.setDrawRange(0,0);
    record.marker.visible=false;
    atWater=false;
    clearInput();
    active={record,live,clock:elapsed,previousTime:now,airborne:false,distanceCall:0};
    stage('flight');
    $('viewer').focus({preventScroll:true});
    tick(active.previousTime);
    if(matchMedia('(max-width:740px)').matches)$('viewer').scrollIntoView({block:'start'});
  }
  function finish(){
    if(!active)return;
    const {record,live}=active;
    record.run=live.result;
    extendTrail(record.line,live.samples);
    const prior=records.get('latest');
    if(prior)disposeTrail(prior);
    records.set('latest',record);
    const run=record.run;
    record.marker.position.set(run.tailRight,.05,-run.tailForward);
    const last=run.samples.at(-1);
    pose(last);
    onWaterContact?.(run.contactRight,run.contactForward,last);
    record.line.geometry.setDrawRange(0,run.samples.length);
    record.marker.visible=true;
    active=null;atWater=true;clearInput();
    latestByConditions.set(historyKey(),{run,label:record.label,color:record.color});
    instruments(last,'着水');
    stage('landing');
    captions.clear();
    landing={record,start:performance.now()};
  }
  function tick(now){
    if(review){replay.tick(now);return;}
    if(countdown){
      if(!document.hidden && !$('source-dialog').open)
        countdown.seconds+=Math.max(0,now-countdown.last)/1000;
      countdown.last=Math.max(now,countdown.last);
      const cue=launchCue(countdown.seconds);
      if($('call-text').textContent!==cue.label)$('call-text').textContent=cue.label;
      if(cue.go){
        const {live}=countdown;
        countdown=null;
        $('launch-call').classList.add('go');
        start(live,now,cue.elapsed);
      }
      return;
    }
    if(landing){
      const {record}=landing;
      const seconds=(now-landing.start)/1000;
      const floating=waterPose(record.run,seconds);
      pose(floating);
      instruments(floating,'着水');
      if(seconds<WATER_RUNOUT_SECONDS)return;
      landing=null;
      for(const r of records.values())r.group.visible=true;
      showResult(record);return;
    }
    if(!active)return;
    const elapsed=Math.max(0,now-active.previousTime)/1000;
    if(!document.hidden)active.clock+=elapsed;
    active.previousTime=Math.max(now,active.previousTime);
    crew.update(launch,active.clock);
    const t=active.clock-launch.duration, {record,live}=active;
    $('launch-call').hidden=active.clock>=0.65;
    let s;
    if(t<0){
      const ramp=rampAt(launch,active.clock), remaining=RAMP_LENGTH-ramp.travel;
      const pitch=LAUNCH.pitchDeg*radians, wind=windAt(mode,0,0);
      const airspeed=Math.hypot(ramp.speed*Math.cos(launch.heading)+wind.headwind,ramp.speed*Math.sin(launch.heading)+(wind.crosswind??0));
      s={height:launch.edgeHeight+LAUNCH.deckClearance+CG_HEIGHT+remaining*launch.dropStep,
        right:launch.edgeRight-remaining*launch.rightStep,forward:launch.edgeForward-remaining*launch.forwardStep,heading:launch.heading,speed:airspeed,pitch};
    }else{
      live.advanceTo(t,pilotInput(),pilotInput(2));
      extendTrail(record.line,live.samples);
      if(live.result){finish();return;}
      s=live.current();
      const mark=Math.min(400,Math.floor(s.distance/100)*100);
      if(!active.airborne){
        active.airborne=true;
        captions.show('竜海が、琵琶湖へ飛び出しました。');
      }else if(mark>active.distanceCall){
        active.distanceCall=mark;
        captions.show(mark+' m を通過しました。');
      }
    }
    pose(s);
    instruments(s,t<0?(active.clock<launch.handoffTime?'助走・押走':'助走・手放し'):t<1?'離台':'滑空中');
  }
  function placeOnDeck(){
    crew.update(launch,0);
    setBodyOffset(0);
    rudder.rotation.y=0;
    modelBase.position.set(launch.edgeRight-RAMP_LENGTH*launch.rightStep,
      launch.edgeHeight+LAUNCH.deckClearance+RAMP_LENGTH*launch.dropStep,
      -launch.edgeForward+RAMP_LENGTH*launch.forwardStep);
    modelBase.rotation.set(0,-launch.heading,0);
  }
  placeOnDeck();
  function disposeTrail(record){
    facility.remove(record.group);
    releaseModel(record.group);
  }
  function changeConditions(){
    for(const record of records.values())disposeTrail(record);
    records.clear();
    mode=selectedWeather();
    launch=launchProfile(1,0,direction);
    renderWind(launch.heading,0,0,true);
    placeOnDeck();
    $('previous-result').hidden=!latestByConditions.has(historyKey());
  }
  for(const control of weatherControls){
    control.addEventListener('change',changeConditions);
  }
  $('flight-action').onclick=()=>{
    if(!active){countdown=null;prepare();return;}
    disposeTrail(active.record);
    active=null;clearInput();
    prepare();
  };
  $('launch').onclick=aim;
  $('launch').disabled=false;
  stage('setup');
  return {
    tick,
    get weather(){return mode;},
    get atWater(){return atWater && !review;},
    get weatherTime(){return review ? replay.time : active ? Math.max(0,active.clock-launch.duration) : null;},
    get trackBounds(){
      const bounds={left:0,right:0,near:0,far:0};
      for(const record of records.values())for(const s of record.run.samples){
        bounds.left=Math.min(bounds.left,s.right);bounds.right=Math.max(bounds.right,s.right);
        bounds.near=Math.min(bounds.near,s.forward);bounds.far=Math.max(bounds.far,s.forward);
      }
      return bounds;
    },
  };
}
