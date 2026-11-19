import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { FlightSession } from '../src/application/flight-session.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { createQx25Aircraft } from '../src/rendering/aircraft/qx25.js';

// Read the actual morphed spar ring. Averaging its vertices removes the
// skin's rotation about the spar and isolates the solver's vertical bending.
function tipHeightReader(spar) {
  const positions = spar.geometry.attributes.position;
  const tipX = positions.getX(positions.count - 1);
  const indices = [];
  for (let i = 0; i < positions.count; i++) {
    if (positions.getX(i) === tipX) indices.push(i);
  }
  const point = new Vector3();
  return () => indices.reduce((sum, i) => sum + spar.getVertexPosition(i, point).y, 0) / indices.length;
}

for (const [id, factory, left, right] of [
  ['ryukai', createAircraft, 'left-tapered-spar', 'right-tapered-spar'],
  ['qx25', createQx25Aircraft, '-1-main-spar', '1-main-spar'],
]) {
  test(id + ' の左右の主桁が助走中から荷重で曲がり、離台前後で翼端高さが連続する', () => {
    const model = factory();
    const session = new FlightSession([[-1, -.45], [1, -.45], [0, .5]], 'head', undefined, undefined, id);
    const attempt = session.startAttempt();
    const pose = model.userData.poseMechanisms;
    const spars = [model.getObjectByName(left), model.getObjectByName(right)];
    const readHeights = spars.map(tipHeightReader);
    pose(session.onDeck);
    const rest = readHeights.map(read => read());
    let previous;
    for (const fraction of [.5, .75, .999999, 1]) {
      const { sample } = attempt.advance(session.launch.duration * fraction, 0, 0);
      pose(sample);
      const deflections = readHeights.map((read, i) => read() - rest[i]);
      for (const [i, side] of ['left', 'right'].entries()) {
        assert.ok(sample.wing[side + 'Tip'] > .05);
        assert.ok(Math.abs(deflections[i] - sample.wing[side + 'Tip']) < 1e-6,
          side + ' spar deflected ' + deflections[i] + ' m, expected ' + sample.wing[side + 'Tip']);
        assert.equal(spars[i].morphTargetInfluences[1], sample.wing[side + 'Twist']);
        if (fraction === 1) assert.ok(Math.abs(deflections[i] - previous[i]) < 1e-4);
      }
      previous = deflections;
    }
    pose(session.onDeck);
    assert.deepEqual(readHeights.map(read => read()), rest);
  });
}
