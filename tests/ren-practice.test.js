import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchCue, prelaunchPedalSeconds } from '../src/application/launch-sequence.js';
import { FlightSession } from '../src/application/flight-session.js';
import { createFlight, REN_DESIGN } from '../src/domain/flight.js';
import { navigation, nextBuoy, practiceBuoys, reserveCapacityJ, pedalEffort, riderCriticalPower, riderClimate } from '../src/domain/ren-practice.js';
import { criticalPressure } from '../src/domain/ren-divergence.js';

const hull = [[-1,-.45],[1,-.45],[7,.4],[0,.9,-16.1],[0,.9,16.1]];
test('ペラ回しますの合図から定位置で全力で漕ぎ、GOでも回転位相を連続させる', () => {
  const session = new FlightSession(hull,'tail',undefined,undefined,'ren');
  const cue = launchCue(4.2,'ren');
  assert.equal(cue.label,'ペラ回します！');
  assert.equal(launchCue(4.19,'ren').spinSeconds,0);
  assert.equal(launchCue(5.3,'ren').label,'3');
  assert.equal(launchCue(8.3,'ren').go,true);
  const before = session.onDeckAt(prelaunchPedalSeconds);
  assert.equal(before.forward,session.onDeck.forward);
  assert.equal(before.watts,300);
  assert.ok(before.crankAngle > 0 && before.reserve < reserveCapacityJ);
  const run = session.startAttempt();
  const go = run.advance(0,0,0).sample;
  assert.equal(go.propellerAngle,before.propellerAngle);
  const first = run.advance(session.launch.duration,0,0).sample;
  assert.ok(first.propellerAngle > before.propellerAngle);
  const late = run.advance(session.launch.duration+3.45,0,0,203).sample;
  assert.ok(late.height < first.height - .3);
});

test('全力は加速余力を使い、漕ぎ止めると脚が止まってプロペラだけ回る', () => {
  const flight = createFlight(REN_DESIGN,hull,{weather:'calm'});
  flight.advanceTo(50,0,0,300);
  const depleted = flight.current();
  assert.equal(depleted.watts,300);
  assert.ok(depleted.reserve < reserveCapacityJ * .75);
  flight.advanceTo(51,0,0,0);
  const coast = flight.current();
  assert.equal(coast.crankAngle,depleted.crankAngle);
  assert.ok(coast.propellerAngle > depleted.propellerAngle && coast.reserve > depleted.reserve);
});

test('順番を飛ばしたブイは数えず、GPSと舵で横風のコースも完走できる', () => {
  assert.equal(nextBuoy(0,practiceBuoys[1]),0);
  const clip = (x,m) => Math.max(-m,Math.min(m,x));
  for (const weather of ['calm','cross']) {
    const f = createFlight(REN_DESIGN,hull,{weather});
    for (let step = 1; step <= 750; step++) {
      const s = f.current(), target = navigation(s);
      if (!target || f.result) break;
      const desiredBank = clip(.7*target.correction,.18);
      const rudder = clip(4*(desiredBank-s.bank)-3*s.rollRate-.7*s.yawRate,1);
      const elevator = clip(.07*(10-s.height)-.23*s.verticalSpeed-.2*s.pitch,.6);
      f.advanceTo(step*.1,elevator,rudder,s.height<9 ? 300 : 203);
    }
    assert.equal(f.current().courseLeg,3);
    assert.ok(f.current().courseTime > 0 && f.current().courseTime < 75);
  }
});

test('ねじり発散を一定翼弦の解析解と照合し、復元側の弾性軸で正の臨界値が消える', () => {
  const length=15, rigidity=2000, offset=.1, liftSlope=5.7, chord=.8;
  const q = criticalPressure({rigidity,offset,span:length,chord:()=>chord,liftSlope});
  const exact = rigidity*(Math.PI/(2*length))**2/(liftSlope*chord**2*offset);
  assert.ok(Math.abs(q/exact-1)<.0001);
  assert.equal(criticalPressure({rigidity,offset:0}),Infinity);
  assert.equal(criticalPressure({rigidity,offset:-.05}),Infinity);
  assert.ok(Math.abs(criticalPressure({rigidity:4000,offset}) / criticalPressure({rigidity,offset})-2)<1e-7);
});

test('高負荷の終盤は徐々に出力が下がり、休脚と低負荷で異なる速さで回復する', () => {
  let reserve = reserveCapacityJ, previous = 300;
  for (let sec = 0; sec < 350; sec++) {
    const next = pedalEffort(300, reserve, 1);
    assert.ok(next.watts <= previous && previous - next.watts < 4.2);
    reserve = next.reserve;
    previous = next.watts;
  }
  assert.ok(previous >= 210 && previous < 211);
  assert.ok(pedalEffort(0, reserve, 60).reserve > pedalEffort(175, reserve, 60).reserve);
  const hot = riderClimate('day-normal', 0);
  assert.ok(riderCriticalPower(hot, 1) < riderCriticalPower(hot, 7));
  assert.ok(riderCriticalPower(hot, 7) < riderCriticalPower(riderClimate('night-normal', 0), 7));
});
