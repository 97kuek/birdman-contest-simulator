import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// TORICA 25th_Analysis, flightDataPlot/src/2025_Tatsumi.csv at 115723c2.
export function readTatsumiLog(path) {
  const raw = readFileSync(path);
  const blob = createHash('sha1').update('blob ' + raw.length + '\0').update(raw).digest('hex');
  assert.equal(blob, '24ce501f21a25c5ef42e5b71acae320862691096', 'Use the linked competition CSV revision');
  const [header, ...lines] = raw.toString('utf8').trim().split(/\r?\n/);
  const columns = header.split(',');
  const rows = lines.map(line => line.split(',').map(Number));
  const index = name => columns.indexOf(name);
  return rows.map(row => ({ time: row[index('Time')], height: row[index('Altitude')],
    speed: row[index('Airspeed')], pitchDeg: -row[index('Pitch')] }));
}

// Least-squares pitch change in degrees/second over the actual recording times.
export function pitchSlope(samples, getPitch) {
  const meanTime = samples.reduce((sum, p) => sum + p.t, 0) / samples.length;
  const meanPitch = samples.reduce((sum, p) => sum + getPitch(p), 0) / samples.length;
  let covariance = 0, timeVariance = 0;
  for (const sample of samples) {
    const dt = sample.t - meanTime;
    covariance += dt * (getPitch(sample) - meanPitch);
    timeVariance += dt * dt;
  }
  return timeVariance > 0 ? covariance / timeVariance : null;
}
