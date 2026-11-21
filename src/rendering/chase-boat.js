import { createChaseCourse } from './chase-course.js';

// The camera stays on the mean water level while the hull rides the swell.
export function createChaseBoat(group) {
  group.name = '追走艇';
  const hull = group.getObjectByName('BoatHull');
  const eye = group.getObjectByName('BoatEye');

  const positionAt = createChaseCourse();
  function update(samples, time, waveTime, firstLand, stopTime) {
    const state = positionAt(samples, time, firstLand, stopTime);
    group.position.set(state.right, 0, -state.forward);
    group.rotation.y = -state.heading;
    // The observation camera rides the mean water level. Only the hull rides the swell.
    hull.position.y = .009 * Math.sin(waveTime * .72);
    const heel = Math.atan(state.turn * state.speed / 9.81) * .48;
    hull.rotation.set(.003 * Math.sin(waveTime * .58), 0, -heel + .004 * Math.sin(waveTime * .66));
    return state.speed;
  }
  return { group, eye, update };
}
