import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// TORICA 25th_Analysis, flightDataPlot/src/2025_Tatsumi.csv at 115723c2.
function readPinnedRows(path, expectedBlob, fields) {
  const raw = readFileSync(path);
  const blob = createHash('sha1').update('blob ' + raw.length + '\0').update(raw).digest('hex');
  assert.equal(blob, expectedBlob, 'Use the linked competition CSV revision');
  const [header, ...lines] = raw.toString('utf8').trim().split(/\r?\n/);
  const columns = header.split(',').map(key => key.trim());
  const indices = fields.map(key => columns.indexOf(key));
  assert.ok(indices.every(i => i >= 0), 'Required telemetry columns must be present');
  return lines.map(line => {
    const cells = line.split(',');
    return indices.map(i => Number(cells[i]));
  });
}

export function readTatsumiLog(path) {
  return readPinnedRows(path, '24ce501f21a25c5ef42e5b71acae320862691096', ['Time','Altitude','Airspeed','Pitch','AoS','Yaw','Roll'])
    .map(([time,height,speed,pitch,aos,yaw,roll]) => ({ time, height, speed, pitchDeg: -pitch, aos, yaw, roll }));
}

export function readRollLog(path) {
  return readPinnedRows(path, '9cce461e0fc803541f131cd6177a8c110967fc6e',
    ['FlightTime','bno_roll','data_air_bno_roll']).map(([time,main,air]) => ({ time, main, air }));
}

// Least-squares angle change in degrees/second over the actual recording times.
export function angleSlope(samples, getAngle) {
  const meanTime = samples.reduce((sum, p) => sum + p.t, 0) / samples.length;
  const meanAngle = samples.reduce((sum, p) => sum + getAngle(p), 0) / samples.length;
  let covariance = 0, timeVariance = 0;
  for (const sample of samples) {
    const dt = sample.t - meanTime;
    covariance += dt * (getAngle(sample) - meanAngle);
    timeVariance += dt * dt;
  }
  return timeVariance > 0 ? covariance / timeVariance : null;
}
