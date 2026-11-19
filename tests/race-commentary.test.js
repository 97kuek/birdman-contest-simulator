import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRaceCommentary } from '../src/application/race-commentary.js';

const pose = { distance: 18, pitch: .02, verticalSpeed: -.8, bank: 0, bottomHeight: 7 };

test('実況は実際に降下から上昇した時だけ引き起こしを伝え、直後は間を置く', () => {
  const calls = createRaceCommentary(1);
  assert.ok(calls.airborne({ ...pose, t: 0 }));
  assert.equal(calls.airborne({ ...pose, t: 2 }), undefined);
  assert.equal(calls.airborne({ ...pose, t: 4, pitch: -.1, verticalSpeed: .4 }), undefined);
  assert.match(calls.airborne({ ...pose, t: 4.2, verticalSpeed: .4 }), /機首/);
  assert.equal(calls.airborne({ ...pose, t: 5, distance: 101 }), undefined);
  assert.match(calls.airborne({ ...pose, t: 10, distance: 120 }), /100メートル/);
});

test('試技と到達距離に応じて離台・着水の字幕が変わる', () => {
  const first = createRaceCommentary(1), second = createRaceCommentary(2);
  assert.notEqual(first.airborne({ ...pose, t: 0 }), second.airborne({ ...pose, t: 0 }));
  assert.notEqual(first.landing({ distance: 80 }), second.landing({ distance: 80 }));
  assert.notEqual(first.landing({ distance: 80 }), first.landing({ distance: 401 }));
});

test('区域への接近は距離実況に優先し、向きを戻した後は再び警告できる', () => {
  const calls = createRaceCommentary(1);
  const tick = (t, risk) => calls.airborne({ ...pose, t, distance: 405 }, risk);
  tick(0, false);
  assert.match(tick(10, true), /このままだと飛行禁止区域/);
  assert.equal(tick(10.5, false), undefined);
  assert.equal(tick(10.9, true), undefined);
  assert.match(tick(12, false), /湖の方へ/);
  assert.match(tick(15, true), /飛行禁止区域/);
});
