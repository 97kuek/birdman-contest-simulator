import {courseAt} from './race2025.js';
import {WEATHER, windAt} from './weather.js';

// SI units. Distance is positive out over the lake, pitch is positive nose-up.
export const BASE_DESIGN = Object.freeze({ span: 25.1, incidence: 3.2 });
export const LAUNCH = Object.freeze({ speed: 8, deckDeg: -3.5, pitchDeg: 0, pathDeg: -7, pitchRateDeg: -14, edgeHeight: 10, mass: 100, deckClearance: 0.35, headwind: WEATHER.reference.lakeWindSpeed });
export const CG_HEIGHT = 0.45;
const rad = Math.PI / 180;
const g = 9.80665;
export const RAMP_LENGTH=10;

// Constant effective push along the deck; after hand-off only the slope accelerates the glider.
export function launchProfile(push=1, coast=0, direction=0){
  if(!Number.isFinite(push)||push<=0||!Number.isFinite(coast)||coast<0||coast>RAMP_LENGTH||!Number.isFinite(direction)||Math.abs(direction)>=90){
    throw new RangeError('Invalid ramp push or hand-off distance.');
  }
  const deck=LAUNCH.deckDeg*rad, heading=direction*rad;
  const fanAngle=Math.atan2(Math.cos(deck)*Math.sin(heading),Math.cos(heading));
  const rightStep=Math.sin(fanAngle), forwardStep=Math.cos(deck)*Math.cos(fanAngle);
  const dropStep=-Math.sin(deck)*Math.cos(fanAngle);
  const edgeRight=RAMP_LENGTH*rightStep;
  const edgeForward=RAMP_LENGTH*(forwardStep-Math.cos(deck));
  const edgeHeight=LAUNCH.edgeHeight-edgeForward*Math.tan(-deck);
  const downhill=g*dropStep;
  const acceleration=downhill+push*(LAUNCH.speed**2/(2*RAMP_LENGTH)+g*Math.sin(deck));
  const pushed=RAMP_LENGTH-coast;
  const handoffSpeed=Math.sqrt(2*acceleration*pushed);
  const handoffTime=handoffSpeed/acceleration;
  const speed=Math.sqrt(handoffSpeed**2+2*downhill*coast);
  const duration=handoffTime+2*coast/(speed+handoffSpeed);
  return {push,coast,direction,heading,rightStep,forwardStep,dropStep,edgeRight,edgeForward,edgeHeight,downhill,acceleration,pushed,handoffSpeed,handoffTime,speed,duration};
}

export function rampAt(profile,time){
  const t=Math.min(profile.duration,Math.max(0,time));
  if(t<=profile.handoffTime)return {travel:0.5*profile.acceleration*t*t,speed:profile.acceleration*t};
  const dt=t-profile.handoffTime;
  return {travel:profile.pushed+dt*(profile.handoffSpeed+0.5*profile.downhill*dt),
    speed:profile.handoffSpeed+dt*profile.downhill};
}
const stepsPerSecond = 120;
const dt = 1 / stepsPerSecond;
export const SAMPLES_PER_SECOND = 20;
export const FLIGHT_LIMIT_SECONDS = 120;

// A convex hull of the model's (aft, up) vertices is sufficient for straight,
// wings-level flight. Rotation about the CG may change which part hits first.
export function hull2D(points) {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  function chain(list) {
    const hull = [];
    for (const p of list) {
      while (hull.length > 1) {
        const a = hull.at(-2), b = hull.at(-1);
        if ((b[0]-a[0])*(p[1]-a[1]) > (b[1]-a[1])*(p[0]-a[0])) break;
        hull.pop();
      }
      hull.push(p);
    }
    return hull.slice(0,-1);
  }
  return [...chain(sorted), ...chain(sorted.reverse())];
}

function geometryAt(pitch,hull,bank=0) {
  const c=Math.cos(pitch), s=Math.sin(pitch), cb=Math.cos(bank), sb=Math.sin(bank);
  let bottom=Infinity, aft=-Infinity, contactAft=0, contactSide=0, tailSide=0;
  for(const [z,y,x=0] of (bank && hull.spatial || hull)){
    const up=y*cb-x*sb, h=up*c-z*s, back=z*c+up*s;
    if(h<bottom){bottom=h;contactAft=back;contactSide=x*cb+y*sb;}
    if(back>aft){aft=back;tailSide=x*cb+y*sb;}
  }
  return {bottom,aft,contactAft,contactSide,tailSide};
}

// Visual runout after the scored first contact. The drag and flotation response
// are approximations; the logged flight samples end at contact.
export const WATER_RUNOUT_SECONDS = 4;

export function waterRunoutPose(contact, seconds, hull, wind) {
  if (seconds <= 0) return contact;
  const t = Math.min(seconds, WATER_RUNOUT_SECONDS);
  const remaining = 1 - t / WATER_RUNOUT_SECONDS;
  const travel = contact.groundSpeed * WATER_RUNOUT_SECONDS / 4 * (1 - remaining ** 4);
  const groundSpeed = contact.groundSpeed * remaining ** 3;
  const along = Math.cos(contact.track), across = Math.sin(contact.track);
  const pitch = contact.pitch * remaining ** 2 - .045 * Math.sin(t * 3) * remaining ** 3;
  const bank = contact.bank * remaining ** 2;
  const bottom = geometryAt(pitch, hull, bank).bottom;
  const immersion = .12 * (1 - remaining ** 2);
  const heave = Math.max(-.18, Math.min(0, contact.verticalSpeed * .17)) * Math.sin(4 * t) * remaining ** 3;
  return {...contact, forward: contact.forward + along * travel, right: contact.right + across * travel,
    groundSpeed, speed: Math.hypot(along * groundSpeed + wind.headwind, across * groundSpeed + (wind.crosswind ?? 0)),
    height: -bottom - immersion + heave, bottomHeight: 0, verticalSpeed: 0, pitch, bank,
    rudderDeg: contact.rudderDeg * remaining, shift: contact.shift * remaining};
}

// A bounded, post-stall section approximation. The coefficient and stall
// envelope are assumptions, not tunnel measurements of Kamuy or Kimera.
function liftCoefficient(angle, slope, maximum) {
  const linear = slope * angle;
  if (Math.abs(linear) <= maximum) return linear;
  const beyondStall = Math.abs(angle) - maximum / slope;
  return Math.sign(linear) * maximum * Math.max(0.45, Math.cos(2*beyondStall));
}

// TORICA Tatsumi.csv and AerodynamicCalculator.cs, revision 3bddd010.
// Body axes: forward, right, down. beta and dr are degrees; p and r are rad/s.
export const RUDDER_LIMIT_DEG=10;
function lateralLoads(beta, rudderRightDeg, rollRate, yawRate, speed, span, pressureArea){
  const rateScale=span/(2*speed);
  const p=rollRate*rateScale, r=yawRate*rateScale;
  const dr=-rudderRightDeg; // TORICA maps the right-hand input to negative dr.
  const cy=-0.005465*beta-0.541162*p+0.170132*r+0.002134*dr;
  const cl=-0.004723*beta-0.794553*p+0.203250*r+0.000044*dr;
  const cn=-0.000285*beta-0.100557*p-0.007178*r-0.000305*dr;
  return {side:pressureArea*cy,roll:pressureArea*span*cl,yaw:pressureArea*span*cn};
}

// Switches reproduce the preceding model and isolate one early-flight assumption at a time.
export const previousFactors = Object.freeze({release:false, pilot:false, wind:false});
export const referenceTiming = Object.freeze({returnSeconds:0.45, onsetMetres:0});
export function createFlight({span, incidence}, hull, {release=true, pilot=true, wind=true, weather='reference', push=1, coast=0, direction=0,
  referenceControl=false, returnSeconds=referenceTiming.returnSeconds, onsetMetres=referenceTiming.onsetMetres} = {}) {
  if (!(returnSeconds > 0) || !Number.isFinite(returnSeconds) || !Number.isFinite(onsetMetres)) {
    throw new RangeError('Pilot return time must be positive and timing parameters must be finite.');
  }
  const area = 17.92 * span / BASE_DESIGN.span;
  // Training-model parameters for Tatsumi, with the drawing span retained for design input.
  const effectiveSpan = span * (24.514 / BASE_DESIGN.span);
  const effectiveAR = effectiveSpan**2 / area;
  const efficiency = 0.987, chord = 0.812, tailArm = 2.9, tailArea = 1.736;
  const pitchInertia = 51, rho = 1.164;
  const wingSlope = (0.103 / rad) * (1 + 2/(efficiency*33.534)) / (1+2/(efficiency*effectiveAR));
  const tailSlope = 0.079 / rad;
  // Reference lift and tail load that trim the baseline at its design cruise.
  const baseCL = LAUNCH.mass*g/(0.5*rho*10.5**2*17.92);
  const tailCL0 = (-0.132 + baseCL*0.1)/(0.346+tailArea/17.92*0.1);
  const wingCL0 = baseCL-tailCL0*tailArea/17.92;
  const clamp = (v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  // The wind gradient is a scenario, not a measured lake wind field.
  const windRiseLength = wind ? 40 : 100;
  const pilotEngagementLength = pilot ? 40 : 65;
  const launch=launchProfile(push,coast,direction);
  const cos=Math.cos(launch.heading), sin=Math.sin(launch.heading);
  function airflow(state,t){
    const [distance,,u,w,pitch,,,bank,heading,,,v]=state;
    const wind=windAt(weather,distance,t,windRiseLength);
    const headingCos=referenceControl?cos:Math.cos(heading), headingSin=referenceControl?sin:Math.sin(heading);
    const crosswind=wind.crosswind??0;
    const headwind=wind.headwind*headingCos+crosswind*headingSin;
    const airU=u+headwind, airW=w-wind.updraft;
    const airV=referenceControl && wind.crosswind===undefined?0:v-wind.headwind*headingSin+crosswind*headingCos;
    const speed=Math.hypot(airU,airW,airV);
    const cp=Math.cos(pitch), sp=Math.sin(pitch), cb=Math.cos(bank), sb=Math.sin(bank);
    const down=sp*airU-cp*airW;
    const beta=Math.atan((cb*airV+sb*down)/speed)/rad;
    const alpha=referenceControl?pitch-Math.atan2(airW,airU):
      Math.atan2(cb*down-sb*airV,cp*airU+sp*airW);
    return {speed,alpha,beta,airU,airW,cp,sp,cb,sb,headwind,updraft:wind.updraft};
  }
  function rates(state,t,pilotInput,turnInput){
    const [distance,height,u,w,,q,shift,,heading,,,v,p,rYaw]=state;
    const {speed,alpha,beta,airU,airW,cp,sp,cb,sb}=airflow(state,t);
    const pressure=0.5*rho*speed**2;
    const h = Math.max(0,height+0.555-CG_HEIGHT);
    const r = 33*(h/effectiveSpan)**1.5, groundFactor = (0.23+r)/(1+r);
    const wingAngle = wingCL0/wingSlope+alpha+(incidence-BASE_DESIGN.incidence)*rad;
    const cl = liftCoefficient(wingAngle,wingSlope,1.4);
    const downwash = (wingCL0-groundFactor*cl)/(Math.PI*efficiency*effectiveAR);
    const tailCL = liftCoefficient(tailCL0/tailSlope + alpha + downwash + q*tailArm/speed,tailSlope,1.4);
    const wingLift = pressure*area*cl, tailLift = pressure*tailArea*tailCL;
    const lift = wingLift+tailLift;
    const wingStall = Math.max(0,Math.abs(wingAngle)-1.4/wingSlope);
    const parasite = 0.015*(0.7*area+0.3*17.92);
    const drag = pressure*(parasite+area*(groundFactor*(lift/(pressure*area))**2/(Math.PI*effectiveAR*efficiency)+1.25*Math.sin(wingStall)**2));
    const moment = -0.132*pressure*area*chord + wingLift*0.1*chord - tailArm*tailLift + lift*shift;
    // A shared, rate-limited weight-shift controller damps the launch phugoid.
    // As water approaches it trades airspeed for a shallower descent.
    const clearance = Math.max(0,height-CG_HEIGHT);
    const targetSpeed = 7.9+1.95*clamp(clearance/2.0,0,1);
    const flare=clamp(1-clearance/1.6,0,1);
    const trimShift = 0.03*(speed-targetSpeed) - 0.06*w - 0.2*q;
    const flareShift = flare*(0.07-0.12*w);
    const engagement = clamp((distance-(pilot ? onsetMetres : 0))/pilotEngagementLength, 0, 1);
    // The recorded reference uses the calibrated pilot model; player input targets a neutral CG on release.
    const desired = referenceControl ? clamp(engagement*(trimShift+flareShift), -0.11, 0.11) : 0.11*pilotInput;
    // Vary only the early return from a forward CG; the actuator still has its speed limit.
    const returning = pilot && distance<40 && shift<0 && desired>shift;
    const responseTime = returning ? returnSeconds : referenceTiming.returnSeconds;
    const shiftRate=clamp((desired-shift)/responseTime,-0.15,0.15);
    if(referenceControl){
      return [u,w,(-drag*airU-lift*airW)/(speed*LAUNCH.mass),
        (lift*airU-drag*airW)/(speed*LAUNCH.mass)-g,q,moment/pitchInertia,shiftRate,
        0,0,u*sin,u*cos,0,0,0];
    }

    const loads=lateralLoads(beta,turnInput*RUDDER_LIMIT_DEG,p,rYaw,speed,effectiveSpan,pressure*area);
    const axial=lift*Math.sin(alpha)-drag*Math.cos(alpha);
    const normal=-lift*Math.cos(alpha)-drag*Math.sin(alpha);
    const down=loads.side*sb+normal*cb;
    const forwardForce=axial*cp+down*sp, upForce=axial*sp-down*cp;
    const rightForce=loads.side*cb-normal*sb;
    // Body angular rates to yaw/pitch/bank derivatives (YXZ in the renderer).
    const headingRate=(q*sb+rYaw*cb)/cp;
    const pitchRate=q*cb-rYaw*sb, bankRate=p+headingRate*sp;
    // Diagonal body inertia approximation using the Tatsumi roll/yaw principal moments.
    const ix=993.022, iz=1028.254;
    const pDot=(loads.roll+(pitchInertia-iz)*q*rYaw)/ix;
    const qDot=(moment+(iz-ix)*rYaw*p)/pitchInertia;
    const rDot=(loads.yaw+(ix-pitchInertia)*p*q)/iz;
    const sh=Math.sin(heading), ch=Math.cos(heading);
    // u,v are ground velocity in the rotating, horizontal heading frame.
    return [Math.hypot(u,v),w,forwardForce/LAUNCH.mass+headingRate*v,upForce/LAUNCH.mass-g,
      pitchRate,qDot,shiftRate,bankRate,headingRate,u*sh+v*ch,u*ch-v*sh,
      rightForce/LAUNCH.mass-headingRate*u,pDot,rDot];
  }
  const pitch = (release ? LAUNCH.pitchDeg : LAUNCH.deckDeg)*rad;
  const flightPath = (release ? LAUNCH.pathDeg : LAUNCH.deckDeg)*rad;
  const pitchRate = release ? LAUNCH.pitchRateDeg*rad : 0;
  const initialShift = pilot ? -0.04 : 0; // Effective CG displacement, forward negative.
  let state = [0, launch.edgeHeight + CG_HEIGHT + LAUNCH.deckClearance, launch.speed*Math.cos(flightPath),
    launch.speed*Math.sin(flightPath), pitch, pitchRate, initialShift,0,launch.heading,0,0,0,0,0];
  let rudderDeg=0, collisionHull=hull;
  function setRudder(command){
    const degrees=command*RUDDER_LIMIT_DEG;
    if(degrees===rudderDeg)return;
    rudderDeg=degrees;
    collisionHull=hull;
    if(degrees && hull.fin){
      const c=Math.cos(degrees*rad), s=Math.sin(degrees*rad);
      const moved=hull.fin.map(([z,y,x])=>[
        hull.hingeZ+c*(z-hull.hingeZ)-s*x,y,c*x+s*(z-hull.hingeZ)
      ]);
      collisionHull=hull.fixed.concat(moved);
    }
    clearance=state[1]+geometryAt(state[4],collisionHull,state[7]).bottom;
  }
  function sample(t, state) {
    const [pathLength, height, u, w, pitch] = state;
    const bank=state[7];
    let [heading,right,forward]=state.slice(8);
    if(referenceControl){
      const course=courseAt(pathLength);
      right=course.right*cos+course.forward*sin;
      forward=course.forward*cos-course.right*sin;
      heading=course.heading+launch.heading;
    }
    const {speed,headwind,updraft,beta}=airflow(state,t);
    const track=referenceControl?heading:heading+Math.atan2(state[11],u);
    return {t,pathLength,right:right+launch.edgeRight,forward:forward+launch.edgeForward,heading,track,bank,
      distance:Math.hypot(right,forward),height,bottomHeight:height+geometryAt(pitch,collisionHull,bank).bottom,
      pitch,speed,groundSpeed:Math.hypot(u,state[11]),verticalSpeed:w,shift:state[6],headwind,updraft,
      rudderDeg,sideslipDeg:beta,rollRate:state[12],yawRate:state[13]};
  }
  const samples = [sample(0, state)];
  let clearance = state[1] + geometryAt(state[4],hull).bottom;
  let step=0, result=null;
  const inputs=[], turnInputs=[];
  function integrate(pilotInput,turnInput) {
    step++;
    // Fixed-step midpoint integration is independent of display frame rate.
    const t = (step-1)*dt;
    const k1 = rates(state,t,pilotInput,turnInput);
    const k2 = rates(state.map((value,i)=>value + dt*k1[i]/2),t+dt/2,pilotInput,turnInput);
    const next = state.map((value,i)=>value + dt*k2[i]);
    const nextClearance = next[1] + geometryAt(next[4],collisionHull,next[7]).bottom;
    if (nextClearance <= 0 || clearance<=0) {
      const fraction = clearance<=0?0:clearance/(clearance-nextClearance);
      const hit = state.map((value,i)=>value + fraction*(next[i]-value));
      const shape = geometryAt(hit[4],collisionHull,hit[7]);
      hit[1] = -shape.bottom;
      const last = sample((step-1+fraction)*dt,hit);
      samples.push(last);
      const sh=Math.sin(last.heading), ch=Math.cos(last.heading);
      const tailRight=last.right-shape.aft*sh+shape.tailSide*ch;
      const tailForward=last.forward-shape.aft*ch-shape.tailSide*sh;
      const contactRight=last.right-shape.contactAft*sh+shape.contactSide*ch;
      const contactForward=last.forward-shape.contactAft*ch-shape.contactSide*sh;
      result = {tailRight, tailForward, contactRight, contactForward, contactSide:shape.contactSide, weather, launch, design:{span,incidence}, samples, inputs, turnInputs, duration:last.t,
        distance:Math.hypot(tailRight-launch.edgeRight,tailForward-launch.edgeForward)};
      return;
    }
    state = next;
    clearance = nextClearance;
    if (step % (stepsPerSecond/SAMPLES_PER_SECOND) === 0) samples.push(sample(step*dt,state));
  }
  return {
    samples,
    get result(){ return result; },
    get time(){ return result?.duration ?? step*dt; },
    current(){ return result?.samples.at(-1) ?? sample(step*dt,state); },
    advanceTo(seconds, pilotInput=0, turnInput=0){
      const target=Math.floor(Math.min(seconds,FLIGHT_LIMIT_SECONDS)*stepsPerSecond+1e-9);
      const start=step*dt;
      if(target<=step || result)return;
      turnInput=Math.max(-1,Math.min(1,turnInput));
      setRudder(turnInput);
      while(step<target && !result) integrate(pilotInput,turnInput);
      for(const [log,command] of [[inputs,pilotInput],[turnInputs,turnInput]]){
        if(!command)continue;
        const end=result?.duration ?? step*dt;
        const last=log.at(-1);
        if(last?.direction===command && last.end===start)last.end=end;
        else log.push({start,end,direction:command});
      }
      if(!result && step>=FLIGHT_LIMIT_SECONDS*stepsPerSecond){
        throw new Error('Flight did not reach the water within the simulation window.');
      }
    }
  };
}

export function simulateFlight(design, hull, options) {
  const flight=createFlight(design,hull,{...options,referenceControl:true});
  flight.advanceTo(FLIGHT_LIMIT_SECONDS);
  return flight.result;
}

export function poseAt(run, t) {
  // The surface follows the command immediately in the training model.
  // Zero-order hold preserves reversals between the 20 Hz recorded poses.
  const held=run.turnInputs?.find(i=>i.start<=Math.max(0,t) && t<i.end);
  const rudderDeg=(held?.direction??0)*RUDDER_LIMIT_DEG;
  if(t <= 0) return {...run.samples[0],rudderDeg};
  if(t >= run.duration) return run.samples.at(-1);
  const i = Math.min(Math.floor(t*SAMPLES_PER_SECOND),run.samples.length-2);
  const a=run.samples[i], b=run.samples[i+1], f=(t-a.t)/(b.t-a.t);
  const lerp=k=>a[k]+f*(b[k]-a[k]);
  return {t, right:lerp('right'), forward:lerp('forward'), heading:lerp('heading'), bank:lerp('bank'),track:lerp('track'),rudderDeg,
    sideslipDeg:lerp('sideslipDeg'),rollRate:lerp('rollRate'),yawRate:lerp('yawRate'),
    distance:lerp('distance'), pathLength:lerp('pathLength'), height:lerp('height'),
    bottomHeight:lerp('bottomHeight'), pitch:lerp('pitch'), speed:lerp('speed'),
    groundSpeed:lerp('groundSpeed'), verticalSpeed:lerp('verticalSpeed'), shift:lerp('shift'), headwind:lerp('headwind'), updraft:lerp('updraft')};
}
