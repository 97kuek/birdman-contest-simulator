import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAircraft} from './aircraft.js';
import {BASE_DESIGN, CG_HEIGHT, LAUNCH, launchProfile, rampAt, createFlight, previousFactors, simulateFlight, poseAt, WATER_RUNOUT_SECONDS, waterRunoutPose} from './flight.js';
import {observations, officialDistance, courseAt} from './race2025.js';
import {pullupLog} from './pullup-data.js';
import {pullupErrors, pullupSeries, recoveryErrors, recoveryEvents} from './pullup-analysis.js';
import {launchCue} from './captions.js';
import {openingTrace} from './replay.js';
import {modelHull} from './trials.js';
import {WEATHER, windAt} from './weather.js';

function calculate(design) {
  const hull=modelHull(createAircraft(design.span,design.incidence));
  return {hull,run:simulateFlight(design,hull)};
}
test('Identical launches are deterministic, with independent effects from span and incidence',()=>{
  const {hull,run}=calculate(BASE_DESIGN);
  assert.deepEqual(run,simulateFlight(BASE_DESIGN,hull));
  for(const design of [{span:30,incidence:3.2},{span:25.1,incidence:6}]){
    const other=calculate(design).run;
    assert.deepEqual(other.samples[0],run.samples[0]);
    assert.ok(Math.abs(other.distance-run.distance)>0.1);
  }
});

test('All design limits finish at first hull contact and score the aftmost point',()=>{
  for(const span of [18,25.1,32])for(const incidence of [-2,3.2,8]){
    const {run,hull}=calculate({span,incidence});
    const first=run.samples[0],last=run.samples.at(-1);
    assert.equal(first.height,LAUNCH.edgeHeight+LAUNCH.deckClearance+CG_HEIGHT);
    assert.equal(first.distance,0);
    assert.ok(Math.abs(first.speed-LAUNCH.speed)<1e-9);
    for(const p of run.samples){
      const low=Math.min(...hull.map(([z,y])=>p.height+y*Math.cos(p.pitch)-z*Math.sin(p.pitch)));
      if(p===last)assert.ok(Math.abs(low)<1e-7);
      else assert.ok(low>0);
    }
    const aft=Math.max(...hull.map(([z,y])=>z*Math.cos(last.pitch)+y*Math.sin(last.pitch)));
    assert.ok(Math.abs(run.tailRight-(last.right-aft*Math.sin(last.heading)))<1e-8);
    assert.ok(Math.abs(run.tailForward-(last.forward-aft*Math.cos(last.heading)))<1e-8);
    assert.equal(run.distance,Math.hypot(run.tailRight,run.tailForward));
    const touching=hull.filter(([z,y])=>Math.abs(last.height+y*Math.cos(last.pitch)-z*Math.sin(last.pitch))<1e-7);
    assert.ok(touching.some(([z,y])=>{
      const along=z*Math.cos(last.pitch)+y*Math.sin(last.pitch);
      return Math.abs(run.contactRight-last.right+along*Math.sin(last.heading))<1e-7 &&
        Math.abs(run.contactForward-last.forward+along*Math.cos(last.heading))<1e-7;
    }));
    assert.deepEqual(poseAt(run,Infinity),last);
    assert.ok(Number.isFinite(poseAt(run,run.duration-.001).height));
  }
});

test('Base flight dives, recovers, then flares within the 2025 observation envelopes',()=>{
  const {run}=calculate(BASE_DESIGN);
  const dive=poseAt(run,3.1), recovery=poseAt(run,7.1);
  assert.ok(dive.speed>11 && recovery.speed<10.5);
  assert.ok(recovery.bottomHeight>dive.bottomHeight+1);
  for(const {t,distance,sensorHeight,airspeed} of observations.filter(p=>p.t>=10 && p.t<=50)){
    const s=poseAt(run,t);
    assert.ok(Math.abs(s.distance-distance)<12, 'GPS radius at '+t);
    assert.ok(Math.abs(s.bottomHeight-sensorHeight)<1.7, 'height at '+t);
    assert.ok(Math.abs(s.speed-airspeed)<1.2, 'airspeed at '+t);
  }
  assert.ok(run.duration>observations.at(-1).t-3 && run.duration<observations.at(-1).t+3);
  assert.ok(Math.abs(run.distance-officialDistance)<15);
  assert.ok(run.samples.at(-1).pathLength-run.distance>30);
});

test('Common course starts along the ramp and extends smoothly beyond recorded positions',()=>{
  assert.deepEqual(courseAt(0),{right:0,forward:0,heading:0});
  for(const length of [35,120,200,315,465,550]){
    const before=courseAt(length-.001), after=courseAt(length+.001);
    assert.ok(Math.abs(after.heading-before.heading)<.0001);
    assert.ok(Math.abs(Math.hypot(after.right-before.right,after.forward-before.forward)-.002)<1e-8);
  }
});

test('Launch diagnostics reproduce the preceding flight and compare all three signals on the same clock',()=>{
  const {run,hull}=calculate(BASE_DESIGN);
  const previous=simulateFlight(BASE_DESIGN,hull,previousFactors);
  assert.ok(Math.abs(previous.distance-432.35)<.02);
  const expected=simulateFlight(BASE_DESIGN,hull,{release:true,pilot:true,wind:true});
  assert.deepEqual(expected,run);
  const old=pullupErrors(pullupSeries(previous)), current=pullupErrors(pullupSeries(run));
  for(const key of ['height','speed','pitchDeg']) assert.ok(current[key]<old[key]);
  assert.ok(Math.abs(poseAt(run,7.1).bottomHeight-9.02)<.9);
  assert.equal(run.samples[0].pitch,0);
  const shifted=calculate({span:25.1,incidence:5}).run;
  // These designs score nearly the same radius after turning, but fly different paths.
  assert.ok(Math.abs(shifted.duration-run.duration)>2);
  assert.ok(Math.abs(poseAt(shifted,3).height-poseAt(run,3).height)>1);
});

test('Trough-aligned measurements use the same clock and survive an unknown height offset',()=>{
  const actual=recoveryEvents(pullupLog);
  assert.equal(actual.bottom,3);
  assert.equal(actual.crest,6.75);
  assert.ok(Math.abs(actual.gain-2.26)<1e-8);
  assert.equal(actual.fastest,3);
  assert.ok(Math.abs(actual.noseUp-3.01)<0.01);
  const shifted=recoveryEvents(pullupLog.map(p=>({...p,height:p.height+10})));
  assert.equal(shifted.duration,actual.duration);
  assert.ok(Math.abs(shifted.gain-actual.gain)<1e-8);
  assert.deepEqual(recoveryErrors(pullupLog),{speed:0,pitch:0});
});

test('Later pilot engagement changes recovery and costs pitch and speed accuracy at fixed wind',()=>{
  const {hull,run}=calculate(BASE_DESIGN);
  const normal=pullupSeries(run);
  const delayed=pullupSeries(simulateFlight(BASE_DESIGN,hull,{onsetMetres:5}));
  const actual=recoveryEvents(pullupLog);
  for (const key of ['duration','gain']) {
    assert.ok(Math.abs(recoveryEvents(delayed)[key]-actual[key])<Math.abs(recoveryEvents(normal)[key]-actual[key]));
  }
  for (const key of ['speed','pitch']) assert.ok(recoveryErrors(delayed)[key]>recoveryErrors(normal)[key]);
});


test('Wind scenarios share launch conditions and apply a repeatable position/time field',()=>{
  for(const mode of ['calm','reference','gust'])assert.deepEqual(windAt(mode,0,0),{headwind:0,updraft:0});
  assert.deepEqual(windAt('reference',20,3),{headwind:0.6,updraft:0});
  assert.deepEqual(windAt('reference',20,3,100),{headwind:0.24,updraft:0});
  assert.deepEqual(windAt('calm',90,18),{headwind:0,updraft:0});
  const {headwind,updraft}=windAt('gust',100,12);
  assert.notEqual(windAt('gust',100,13).headwind,headwind);
  assert.notEqual(windAt('gust',101,12).updraft,updraft);
  const next=windAt('gust',100.0001,12.0001);
  assert.ok(Math.abs(next.headwind-headwind)<0.001 && Math.abs(next.updraft-updraft)<0.001);
  assert.throws(()=>windAt('storm',20,3),RangeError);
});

test('Wind changes lift and touchdown while sampled airspeed uses the local relative velocity',()=>{
  const {hull,run}=calculate(BASE_DESIGN);
  assert.ok(Math.abs(run.distance-430.68969472545405)<1e-6);
  assert.deepEqual(simulateFlight(BASE_DESIGN,hull,{weather:'reference'}),run);
  const calm=simulateFlight(BASE_DESIGN,hull,{weather:'calm'});
  const gust=simulateFlight(BASE_DESIGN,hull,{weather:'gust'});
  assert.deepEqual(gust,simulateFlight(BASE_DESIGN,hull,{weather:'gust'}));
  assert.deepEqual(gust.samples[0],calm.samples[0]);
  assert.ok(Math.abs(calm.duration-gust.duration)>2);
  for(const flight of [run,calm,gust]){
    assert.equal(flight.samples.at(-1).bottomHeight,0);
    for(const p of flight.samples){
      const airSpeed=Math.hypot(p.groundSpeed+p.headwind,p.verticalSpeed-p.updraft);
      assert.equal(p.speed,airSpeed);
    }
    const a=flight.samples[30],b=flight.samples[32],middle=flight.samples[31];
    assert.ok(Math.abs((b.pathLength-a.pathLength)/(b.t-a.t)-middle.groundSpeed)<0.01);
    assert.ok(Math.abs((b.height-a.height)/(b.t-a.t)-middle.verticalSpeed)<0.01);
  }
  assert.ok(gust.samples.some(p=>p.updraft>0.2) && gust.samples.some(p=>p.updraft< -0.2));
});


test('Pilot input timing is repeatable across render cadences and neutral returns the manual CG to center',()=>{
  const {hull}=calculate(BASE_DESIGN);
  function fly(weather,onset,interval,input=1){
    const live=createFlight(BASE_DESIGN,hull,{weather});
    function advance(end,command){
      for(let t=live.time+interval;t<end;t+=interval)live.advanceTo(t,command);
      live.advanceTo(end,command);
    }
    advance(onset,0);
    advance(onset+1,input);
    advance(120,0);
    return live.result;
  }
  for(const weather of Object.keys(WEATHER)){
    const reference=simulateFlight(BASE_DESIGN,hull,{weather});
    const neutral=fly(weather,1.5,0.17,0);
    assert.deepEqual(neutral,fly(weather,1.5,0.31,0));
    assert.notEqual(neutral.distance,reference.distance);
    assert.ok(Math.abs(neutral.samples.at(-1).shift)<0.001);
    const early=fly(weather,1.5,0.017);
    assert.deepEqual(early,fly(weather,1.5,0.31));
    assert.deepEqual(early.samples.filter(p=>p.t<=1.5),neutral.samples.filter(p=>p.t<=1.5));
    assert.ok(Math.abs(early.distance-fly(weather,3,0.13).distance)>0.1);
    const forward=fly(weather,1.5,0.1,-1);
    assert.ok(poseAt(early,2.5).pitch>poseAt(forward,2.5).pitch);
    assert.equal(early.samples.at(-1).bottomHeight,0);
    for(let i=1;i<early.samples.length;i++){
      const prev=early.samples[i-1],next=early.samples[i];
      assert.ok(Math.abs(next.shift-prev.shift)<=0.15*(next.t-prev.t)+1e-9);
    }
  }
});

test('The collision hull for the next launch is independent of the last landing pose',()=>{
  const aircraft=createAircraft(BASE_DESIGN.span,BASE_DESIGN.incidence);
  const atLaunch=modelHull(aircraft);
  aircraft.rotation.set(0.08,1.13,0,'YXZ');
  aircraft.position.set(180,1,-420);
  assert.deepEqual(modelHull(aircraft),atLaunch);
});


test('Replay records applied commands including holds, release gaps, reversals and water contact',()=>{
  const {hull}=calculate(BASE_DESIGN);
  const live=createFlight(BASE_DESIGN,hull);
  live.advanceTo(0.001,1);
  live.advanceTo(1);
  live.advanceTo(2,1);
  live.advanceTo(2.5,1);
  live.advanceTo(3,-1);
  live.advanceTo(3.5);
  live.advanceTo(120,-1);
  const run=live.result;
  assert.deepEqual(run.inputs,[
    {start:1,end:2.5,direction:1},{start:2.5,end:3,direction:-1},{start:3.5,end:run.duration,direction:-1}
  ]);
  const trace=openingTrace(run);
  assert.equal(trace.at(-1).t,Math.min(10,run.duration));
  assert.equal(trace[0].height,run.samples[0].bottomHeight);
  assert.equal(trace[40].pitchDeg,poseAt(run,2).pitch*180/Math.PI);
  const end=2.18, last=poseAt(run,end);
  const short={duration:end,samples:[...run.samples.filter(s=>s.t<end),last]};
  assert.equal(openingTrace(short).at(-1).t,end);
});

test('Ramp push, hand-off and chosen heading share the same fixed deck and reference conditions',()=>{
  const normal=launchProfile();
  assert.equal(normal.speed,8);
  assert.equal(normal.duration,2.5);
  assert.ok(launchProfile(1,2).speed<normal.speed);
  assert.ok(launchProfile(1.15).speed>normal.speed);
  const {hull}=calculate(BASE_DESIGN);
  for(const direction of [-30,0,30]){
    const options={push:0.85,coast:2,direction,weather:'gust'};
    const live=createFlight(BASE_DESIGN,hull,options);
    const profile=launchProfile(options.push,options.coast,direction);
    const start=live.current();
    assert.equal(start.distance,0);
    assert.equal(start.right,profile.edgeRight);
    assert.equal(start.forward,profile.edgeForward);
    assert.equal(start.heading,direction*Math.PI/180);
    assert.ok(Math.abs(profile.edgeRight-10*profile.rightStep)<1e-10);
    assert.ok(Math.abs(profile.edgeForward-10*profile.forwardStep+10*Math.cos(LAUNCH.deckDeg*Math.PI/180))<1e-10);
    assert.ok(Math.abs(start.speed-profile.speed)<1e-12);
    assert.ok(Math.abs(rampAt(profile,profile.handoffTime).travel-8)<1e-12);
    assert.ok(Math.abs(rampAt(profile,profile.duration).travel-10)<1e-12);
    live.advanceTo(120);
    const run=live.result;
    assert.equal(run.distance,Math.hypot(run.tailRight-profile.edgeRight,run.tailForward-profile.edgeForward));
    assert.deepEqual(run.launch,simulateFlight(BASE_DESIGN,hull,options).launch);
  }
});


test('Countdown captions release the push on GO',()=>{
  assert.deepEqual([0,2.1,4.2,5.3,6.3,7.3,8.3].map(t=>launchCue(t).label),['左翼、いいですか？','右翼、いいですか？','行きます','3','2','1','GO']);
  assert.equal(launchCue(8.299).go,false);
  assert.equal(launchCue(8.3).go,true);
  assert.ok(Math.abs(launchCue(8.34).elapsed-.04)<1e-8);
});

test('Opposite steering mirrors the bank, course and wingtip contact during simultaneous pitch input',()=>{
  const {hull}=calculate(BASE_DESIGN);
  function turn(sign,step){
    const live=createFlight(BASE_DESIGN,hull);
    live.advanceTo(1);
    for(let t=1+step;t<3;t+=step)live.advanceTo(t,1,sign);
    live.advanceTo(3,1,sign);
    live.advanceTo(120,0,sign);
    return live.result;
  }
  const left=turn(-1,.08), right=turn(1,.12);
  assert.deepEqual(left,turn(-1,.23));
  const l=poseAt(left,2.4), r=poseAt(right,2.4);
  assert.ok(l.heading<0 && l.bank<0 && l.shift>0);
  assert.ok(l.sideslipDeg>0 && l.track>l.heading);
  assert.ok(poseAt(left,5).right<0 && poseAt(right,5).right>0);
  assert.ok(Math.abs(l.right+r.right)<1e-8 && Math.abs(l.forward-r.forward)<1e-8);
  assert.ok(Math.abs(right.contactRight-right.samples.at(-1).right)>3);
  assert.equal(right.samples.at(-1).bottomHeight,0);
  assert.deepEqual(right.turnInputs,[{start:1,end:right.duration,direction:1}]);
  const released=createFlight(BASE_DESIGN,hull);
  released.advanceTo(1,0,1);
  const held=released.current();
  assert.equal(held.rudderDeg,10);
  released.advanceTo(1+1/120);
  const neutral=released.current();
  assert.equal(neutral.rudderDeg,0);
  assert.ok(neutral.yawRate>0 && neutral.bank>0);
  released.advanceTo(2.125,0,-1);
  released.advanceTo(120);
  // Replay shows the step at the recorded input boundary, even off the pose sample grid.
  assert.equal(poseAt(released.result,0).rudderDeg,10);
  assert.equal(poseAt(released.result,1).rudderDeg,0);
  assert.equal(poseAt(released.result,2.123).rudderDeg,-10);
  assert.equal(poseAt(released.result,2.125).rudderDeg,0);
});

test('Training rudder derivatives set the initial side force and yaw acceleration',()=>{
  const {hull}=calculate(BASE_DESIGN);
  const flight=createFlight(BASE_DESIGN,hull,{weather:'calm',release:false,pilot:false});
  const dt=1/120, pressureArea=0.5*1.164*8**2*17.92;
  flight.advanceTo(dt,0,1);
  const s=flight.current();
  const yawAcceleration=pressureArea*24.514*0.000305*10/1028.254;
  assert.ok(Math.abs(s.yawRate/dt-yawAcceleration)<0.002);
  assert.ok(s.heading>0 && s.track<0 && s.sideslipDeg<0);
  assert.ok(Math.abs(s.bank)<0.0001);
});

test('Wind cards use platform directions for deck and airborne flow',()=>{
  const {hull}=calculate(BASE_DESIGN);
  const first=weather=>createFlight(BASE_DESIGN,hull,{weather}).current();
  const calm=first('calm'), head=first('head'), tail=first('tail'), cross=first('cross');
  assert.ok(head.speed>calm.speed && tail.speed<calm.speed && cross.sideslipDeg<0);
  assert.deepEqual(windAt('cross',0,0),windAt('cross',300,40));
  assert.equal(windAt('cross',30,12).crosswind,-1.2);
});

test('Weight shift moves the pilot while the hands and outer contact hull stay fixed',()=>{
  const model=createAircraft(), pilot=model.getObjectByName('pilot');
  const body=pilot.getObjectByName('pilot-weight-shift'), grip=pilot.getObjectByName('pilot-grip-skin');
  const initial=grip.getWorldPosition(grip.position.clone()), hull=modelHull(model);
  pilot.userData.setBodyOffset(.05);
  assert.equal(body.position.z,.05);
  assert.ok(grip.getWorldPosition(grip.position.clone()).equals(initial));
  assert.deepEqual(modelHull(model),hull);
});

test('Water runout follows contact velocity, slows to rest, and preserves the scored sample',()=>{
  const hull=[[-1,-.45],[1,-.45],[0,.5]];
  const contact=Object.freeze({forward:120,right:10,height:.45,bottomHeight:0,t:24,pitch:0,bank:0,
    track:-Math.PI/4,heading:0,groundSpeed:8,verticalSpeed:-.5,shift:0,rudderDeg:0});
  const wind={headwind:1,crosswind:0};
  const at=t=>waterRunoutPose(contact,t,hull,wind);
  assert.deepEqual(at(0),contact);
  const first=at(.001), midway=at(2), rest=at(WATER_RUNOUT_SECONDS);
  assert.ok(Math.abs(Math.hypot(first.forward-120,first.right-10)/.001-8)<.01);
  assert.ok(first.right<contact.right && midway.forward>first.forward && rest.forward>midway.forward);
  assert.ok(first.groundSpeed>midway.groundSpeed && midway.groundSpeed>rest.groundSpeed);
  assert.equal(rest.groundSpeed,0);
  assert.equal(rest.speed,1);
  assert.equal(rest.t,24);
  assert.deepEqual(at(20),rest);
});
