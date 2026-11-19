import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeadingInput } from '../src/presentation/pilot-controls.js';
import { FlightSession } from '../src/application/flight-session.js';

function fixture() {
  const session = new FlightSession([[-1, -0.45], [1, -0.45], [0, 0.5]], 'head');
  const read = () => session.launch.direction;
  const input = createHeadingInput(read, value => session.select('head', value));
  return { session, input, read };
}

test('機首はキーリピートや描画頻度に依存せず、押していた時間だけ連続して回る', () => {
  const dense = fixture(), sparse = fixture();
  for (const { input } of [dense, sparse]) input.begin('ArrowRight', 1, 100);
  dense.input.advance(133);
  const fine = dense.read();
  dense.input.advance(147);
  assert.ok(fine > 0 && dense.read() > fine && dense.read() < 1);
  dense.input.begin('ArrowRight', 1, 360);
  dense.input.advance(580);
  for (const { input } of [dense, sparse]) input.end('ArrowRight', 809, true);
  assert.equal(dense.read(), sparse.read());
  assert.ok(!Number.isInteger(dense.read()));
  const stopped = dense.read();
  dense.input.advance(3600);
  assert.equal(dense.read(), stopped);
  const sample = dense.session.startAttempt().advance(0, 0, 0).sample;
  assert.equal(sample.heading, stopped * (Math.PI / 180));
});

test('短いタップは微調整になり、押し替え・キャンセル・台端で入力が残らない', () => {
  const { input, read } = fixture();
  input.begin(1, -1, 100);
  input.end(1, 100, true);
  assert.equal(read(), -0.1);
  input.begin('ArrowLeft', -1, 200);
  input.advance(5000);
  assert.equal(read(), -30);
  input.begin('ArrowRight', 1, 5010);
  input.end('ArrowLeft', 5040, true);
  input.advance(5100);
  assert.ok(read() > -30 && read() < -29);
  const frozen = read();
  input.cancel();
  input.advance(5200);
  input.end('ArrowRight', 5400, true);
  assert.equal(read(), frozen);
});
