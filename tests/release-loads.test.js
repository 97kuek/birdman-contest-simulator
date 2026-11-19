import assert from 'node:assert/strict';
import test from 'node:test';
import { aircraftDynamics, releaseState } from '../src/domain/aircraft-dynamics.js';
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { BASE_DESIGN, createFlight, launchProfile } from '../src/domain/flight.js';
import { cgShiftFromBody } from '../src/domain/pilot-shift.js';

const hull = [[-1,-.45],[1,-.45]];
const launch = launchProfile();
const state = releaseState(launch,true,true);
const profile = aircraftProfile();
const solve = releaseExperiment => aircraftDynamics(BASE_DESIGN, launch, { referenceControl:true,
  weather:'reference', wind:true, pilot:true, contestOpening:true, releaseExperiment });
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-10, a+' vs '+b);

test('点荷重は左右の桁を曲げ、台端通過後に残る手の力とモーメントを各一度だけ加える', () => {
  const experiment = { handForceAt:t => t < .15 ? 25 : 0, handArm:-.25, supportStation:3.12 };
  const plain = solve(), support = solve(experiment);
  const a = plain.rates(state,0,0,0), b = support.rates(state,0,0,0);
  close(b.w-a.w,50/profile.mass);
  close(b.q-a.q,50*(experiment.handArm+cgShiftFromBody(state.bodyShift))/profile.pitchInertia);
  assert.ok(b.leftTipRate > a.leftTipRate);
  close(b.leftTipRate,b.rightTipRate);
  assert.deepEqual(plain.rates(state,.15,0,0),support.rates(state,.15,0,0));
});

test('尾翼に当たる上向きの局所風は機首下げを強める。主翼と機上の風は同じ', () => {
  const air = solve(), gust = solve({ tailUpdraftAt: x => Math.abs(x) <= 1 ? .25 : 0 });
  const edge = { ...state,pathLength:profile.tailArm };
  assert.deepEqual(gust.loadsAt(edge,.35),air.loadsAt(edge,.35));
  const a = air.rates(edge,.35,0,0), b = gust.rates(edge,.35,0,0);
  assert.ok(b.q < a.q);
  assert.ok(b.w > a.w);
  assert.deepEqual(gust.rates(state,0,0,0),air.rates(state,0,0,0));
});

test('追加荷重をゼロにした基準飛行は10秒間の全収録点で通常の試技を再現する', () => {
  const run = releaseExperiment => {
    const f = createFlight(BASE_DESIGN,hull,{ referenceControl:true, releaseExperiment });
    f.advanceTo(10);
    return f.samples;
  };
  assert.deepEqual(run({ handForceAt:() => 0, tailUpdraftAt:() => 0 }), run());
});

test('片翼の支持力はその翼の桁を曲げ、反対側を下げるロールモーメントを生む', () => {
  const rates = side => solve({ freeLateral:true, supportStation:3.12, handArm:-.25,
    handForceAt:(_, wing) => wing === side ? 25 : 0 }).rates(state,0,0,0);
  const none = rates(null), left = rates('left'), right = rates('right');
  close(left.w-none.w,25/profile.mass);
  close(right.w,left.w);
  close(left.p-none.p,25*3.12/profile.rollInertia);
  close(right.p-none.p,-25*3.12/profile.rollInertia);
  assert.ok(left.leftTipRate > left.rightTipRate);
  close(left.leftTipRate,right.rightTipRate);
});

test('正面・水平で翼持ちの左右を入れ替えると自由飛行のバンクも鏡像になる', () => {
  function run(late) {
    const f = createFlight(BASE_DESIGN,hull,{ referenceControl:true, releaseExperiment:{
      freeLateral:true, handArm:-.25, supportStation:3.12,
      handForceAt:(t,side) => t < (side === late ? 1/30 : 0) ? 25 : 0,
    } });
    f.advanceTo(10);
    return f.samples;
  }
  const left = run('left'), right = run('right');
  assert.ok(left.some(p => Math.abs(p.bank) > 1e-5));
  for (const [i,p] of left.entries()) {
    close(p.bank,-right[i].bank);
    close(p.pitch,right[i].pitch);
    close(p.wing.leftTip,right[i].wing.rightTip);
  }
});

test('片翼の局所風は計器位置の気流を変えず、風を当てた翼の揚力を増やし、左右入替でロールの向きが反転する', () => {
  const withWind = side => solve({ freeLateral:true,
    wingWindAt:(_,wing) => wing === side ? {updraft:.25} : undefined });
  const left = withWind('left'), right = withWind('right');
  const plain = solve({freeLateral:true}).loadsAt(state,0);
  const l = left.loadsAt(state,0), r = right.loadsAt(state,0);
  assert.deepEqual(l.air,plain.air);
  assert.ok(l.structure.leftLift>plain.structure.leftLift);
  close(l.structure.rightLift,plain.structure.rightLift);
  close(l.gustRoll,-r.gustRoll);
  assert.ok(left.rates(state,0,0,0,l).p>0);
});
