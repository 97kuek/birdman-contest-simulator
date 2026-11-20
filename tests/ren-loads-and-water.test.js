import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlight, REN_DESIGN, waterRunoutPose } from '../src/domain/flight.js';
import { FlightSession } from '../src/application/flight-session.js';
import { renWingResponse } from '../src/domain/ren-wing.js';
import { GRAVITY } from '../src/domain/units.js';

const hull = [[-1,-.45],[1,-.45],[7,.4],[0,.9,-16.1],[0,.9,16.1]];
const halfWeight = 87.7 * GRAVITY / 2;

test('設計制限荷重は支え、片翼の過荷重ではその側だけが破断する', () => {
  const response = (left,right) => renWingResponse(halfWeight*left,halfWeight*right,{},87.7,GRAVITY);
  assert.equal(response(1.5,1.5).failedSide,null);
  assert.equal(response(3,1).failedSide,'left');
  assert.equal(response(1,3).failedSide,'right');
  assert.equal(response(3,3).failedSide,'both');
  assert.equal(response(1,1).leftTipAcceleration,0);
});

test('通常操作で急降下から引き起こすと破断し、折れた側の揚力を失って着水する', () => {
  const f = createFlight(REN_DESIGN,hull,{weather:'calm'});
  f.advanceTo(70,0,0,300);
  assert.equal(f.failure,null);
  f.advanceTo(73,-1,0,300);
  f.advanceTo(80,1,0,300);
  assert.equal(f.failure.wing.failedSide,'both');
  assert.equal(f.result,null);
  const atBreak = f.failure;
  const early = f.wreckAt(.1).sample;
  assert.ok(early.wing.foldFraction > 0 && early.wing.foldFraction < 1);
  const landed = f.wreckAt(10);
  assert.ok(landed.water && landed.sample.height < atBreak.height);
  assert.equal(landed.sample.wing.failedSide,'both');
  assert.equal(f.result,null);
  assert.equal(landed.water.distance,undefined);
});

test('背風発進は同じ押し方でも対気速度が下がり、離台直後の漕ぎ増しで沈みが減る', () => {
  function trial(weather, boosted) {
    const session = new FlightSession(hull,weather,undefined,undefined,'ren');
    const a = session.startAttempt(), t = session.launch.duration;
    const before = a.advance(t-.00001,0,0).sample, first = a.advance(t,0,0).sample;
    for (const key of ['right','forward','height','propellerAngle','groundSpeed','verticalSpeed']) {
      assert.ok(Math.abs(first[key]-before[key]) < .001,key);
    }
    const lowest = Math.min(...Array.from({length:200},(_,i)=>
      a.advance(t+(i+1)/20,0,0,boosted && i<60 ? 300 : 203).sample.height));
    return { first, loss: first.height-lowest };
  }
  const calm = trial('calm',false), tail = trial('tail',false), boost = trial('tail',true);
  assert.ok(tail.first.speed < calm.first.speed && tail.loss > calm.loss);
  assert.deepEqual(tail.first,boost.first);
  assert.ok(boost.loss < tail.loss);
});

// Isolate the first wet patch at the same station, bank and forward speed
// on either side. The local downward entry speed is the independent variable.
function entryContact(side, sink, wing = {}) {
  return { t:0,pitch:0,bank:Math.sign(side)*.16,height:side ? 1.55 : .60,
    groundSpeed:8,verticalSpeed:-sink,rollRate:0,pitchRate:0,heading:0,
    track:0,forward:0,right:0,shift:0,aircraftId:'ren',contactSide:side,contactAft:0,airborneLiftN:850,
    wing:{leftMoment:400,rightMoment:400,limitMoment:955,leftTip:0,rightTip:0,leftTwist:0,rightTwist:0,...wing} };
}

test('翼端をかすめても破断せず、強く打ち込んだ側だけが先に折れる', () => {
  for (const side of [-13, 13]) {
    for (const sink of [.25, .80]) {
      const contact = entryContact(side,sink);
      assert.equal(waterRunoutPose(contact,4,hull,'calm').wing.failedSide,null);
    }
    const hard = entryContact(side,3.8);
    const sideName = side > 0 ? 'right' : 'left';
    assert.equal(waterRunoutPose(hard,.001,hull,'calm').wing.failedSide,null);
    assert.equal(waterRunoutPose(hard,.25,hull,'calm').wing.failedSide,sideName);
    const settled = waterRunoutPose(hard,4,hull,'calm');
    assert.ok(settled.wing[sideName+'Fold'] < 0);
    assert.deepEqual(waterRunoutPose(hard,.001,hull,'calm').wing.failedSide,null);
    assert.deepEqual(waterRunoutPose(hard,4,hull,'calm'),settled);
  }
  const floating = (side,sink) => waterRunoutPose(entryContact(side,sink),4,hull,'calm');
  const gentle = floating(0,.35), left = floating(-13,3.8), right = floating(13,3.8);
  assert.equal(gentle.wing.failedSide,null);
  assert.ok(right.heading > .05 && Math.abs(left.heading+right.heading)<1e-8);
  assert.ok(Math.abs(gentle.bank) < 1e-8 && Math.abs(left.bank + right.bank) < 1e-8);
});

test('空中で上に折れた外翼が着水後も連続して動き、水面へ下がる', () => {
  const contact = entryContact(0,.35,{failedSide:'right', foldFraction:1});
  const pose = t => waterRunoutPose(contact,t,hull,'calm').wing;
  assert.ok(pose(.001).rightFold > .99);
  assert.ok(pose(.5).rightFold < pose(.1).rightFold);
  assert.ok(pose(4).rightFold < 0);
  assert.equal(pose(4).leftFold,0);
});
