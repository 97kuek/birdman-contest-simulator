import * as THREE from 'three';
import { FLIGHT_LIMIT_SECONDS, SAMPLES_PER_SECOND } from '../domain/flight.js';

export function createFlightTrail(run, color, reference, { facility, release }) {
  const geometry = new THREE.BufferGeometry();
  if (run) {
    geometry.setFromPoints(run.samples.map((s) => new THREE.Vector3(s.right, s.height, -s.forward)));
  } else {
    const capacity = FLIGHT_LIMIT_SECONDS * SAMPLES_PER_SECOND + 2;
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(3 * capacity), 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setDrawRange(0, 0);
  }
  const material = reference
    ? new THREE.LineDashedMaterial({ color, dashSize: 2.4, gapSize: 1, depthTest: false })
    : new THREE.LineBasicMaterial({ color, depthTest: false });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 3;
  if (!run) line.frustumCulled = false;
  if (reference) line.computeLineDistances();
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.9, 32),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false }),
  );
  marker.rotation.x = -Math.PI / 2;
  if (run) marker.position.set(run.tailRight, 0.05, -run.tailForward);
  marker.visible = Boolean(run);
  marker.renderOrder = 4;
  const group = new THREE.Group();
  group.add(line, marker);
  facility.add(group);
  return {
    setVisible(visible) {
      group.visible = visible;
    },
    extend(samples) {
      extendTrail(line, samples);
    },
    showContact(completed) {
      line.geometry.setDrawRange(0, completed.samples.length);
      marker.position.set(completed.tailRight, 0.05, -completed.tailForward);
      marker.visible = true;
    },
    replayTo(completed, seconds) {
      const touched = seconds >= completed.duration;
      line.geometry.setDrawRange(
        0,
        touched ? completed.samples.length : Math.floor(seconds * SAMPLES_PER_SECOND) + 1,
      );
      marker.visible = touched;
      return touched;
    },
    dispose() {
      facility.remove(group);
      release(group);
    },
  };
}

function extendTrail(line, samples) {
  const geometry = line.geometry,
    positions = geometry.attributes.position;
  const start = geometry.drawRange.count;
  if (start === samples.length) return;
  for (let i = start; i < samples.length; i++) {
    const s = samples[i];
    positions.setXYZ(i, s.right, s.height, -s.forward);
  }
  positions.addUpdateRange(3 * start, 3 * (samples.length - start));
  positions.needsUpdate = true;
  geometry.setDrawRange(0, samples.length);
}
