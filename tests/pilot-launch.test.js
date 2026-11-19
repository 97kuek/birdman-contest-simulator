import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { launchProfile, RAMP_LENGTH } from '../src/domain/launch.js';
import { deckHeight,deckRun } from '../src/rendering/launch-deck.js';
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { createQx25Aircraft } from '../src/rendering/aircraft/qx25.js';

const point = new Vector3();

// Measure the lowest vertex of each shoe against the actual tilted runway.
function shoeClearance(ankle, clearance, heading, travel) {
  const originZ=deckRun - travel*launchProfile(1,0,heading*180/Math.PI).forwardStep;
  let minimum = Infinity;
  ankle.traverse(part => {
    if (!part.isMesh) return;
    const positions = part.geometry.attributes.position;
    for (let i=0; i<positions.count; i++) {
      point.fromBufferAttribute(positions,i).applyMatrix4(part.matrixWorld);
      const rampZ = point.z*Math.cos(heading) + point.x*Math.sin(heading);
      minimum = Math.min(minimum,point.y+clearance+deckHeight(originZ)-deckHeight(originZ+rampZ));
    }
  });
  return minimum;
}

for (const [id, factory] of [['ryukai',createAircraft],['qx25',createQx25Aircraft]]) {
  test(id+' の靴底が助走台に接し、台端直前に踏み切って両脚を引き込む',()=>{
    const model=factory(), pilot=model.getObjectByName('pilot');
    const ankles=[];
    pilot.traverse(part=>{ if(part.name==='ankle') ankles.push(part); });
    assert.equal(ankles.length,2);
    const clearance=aircraftProfile(id).deckClearance;
    const eye=model.getObjectByName('pilot-eye'), panel=model.getObjectByName('cockpit-display-mount');
    const pose=sample=>{
      model.userData.poseMechanisms(sample);
      model.updateMatrixWorld(true);
      const eyePosition=eye.getWorldPosition(new Vector3()), display=panel.getWorldPosition(new Vector3());
      assert.ok(eyePosition.z-display.z>.18 && eyePosition.y>display.y);
      return ankles.map(part=>shoeClearance(part,clearance,sample.heading??0,sample.rampTravel??RAMP_LENGTH));
    };
    for(const heading of [0,-.4,.4]){
      const standing=pose({rampTravel:0,groundSpeed:0,heading});
      assert.ok(standing.every(height=>Math.abs(height)<.003),String(standing));
      const raised=[false,false];
      for(let travel=.1;travel<8.8;travel+=.20){
        const soles=pose({rampTravel:travel,groundSpeed:Math.sqrt(6.4*travel),heading});
        assert.ok(Math.abs(Math.min(...soles))<.003,String(soles));
        soles.forEach((height,foot)=>{ if(height>.12) raised[foot]=true; });
      }
      assert.deepEqual(raised,[true,true]);
    }
    const takeoff=pose({rampTravel:9.68,groundSpeed:8});
    assert.ok(Math.min(...takeoff)>.13);
    const atLip=pose({rampTravel:RAMP_LENGTH,groundSpeed:8});
    const leaving=pose({t:0,groundSpeed:8});
    assert.deepEqual(leaving,atLip);
    const retracted=pose({t:.18,groundSpeed:8});
    assert.ok(Math.min(...retracted) > Math.max(...atLip));
    for(const part of ankles) assert.ok(part.getWorldPosition(new Vector3()).y>.18);
    assert.deepEqual(pose({t:5,groundSpeed:10}),retracted);
    assert.deepEqual(pose({rampTravel:RAMP_LENGTH,groundSpeed:8}),atLip);
  });
}
