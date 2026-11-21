import { Group } from 'three';
import { practiceBuoys } from '../domain/ren-practice.js';

export function createPracticeBuoys(model) {
  const group = new Group();
  practiceBuoys.forEach(({ right, forward }, index) => {
    const buoy = model.clone();
    buoy.traverse(part => {
      if (part.userData.buoyBand) part.visible = part.userData.buoyBand <= index + 1;
    });
    buoy.position.set(right, 0, -forward);
    group.add(buoy);
  });
  group.visible = false;
  return group;
}
