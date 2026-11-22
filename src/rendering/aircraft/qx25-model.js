import { MathUtils } from 'three';
import { matchingParts } from './model.js';
import { bindGliderPilot } from './glider-pilot.js';
import { pilotLaunchWeight } from './pilot-launch.js';
import { bindWingFlex } from './wing-flex.js';

export function createQx25Aircraft(template) {
  const root = template.clone();
  const elevator = root.getObjectByName('elevator-hinge');
  const flex = bindWingFlex(root);
  const pilot = bindGliderPilot(root, 'qx25');
  const covers = matchingParts(root, 'retraction-cover');
  const jacks = ['left-auxiliary-leg', 'right-auxiliary-leg'].map((name, i) => {
    const hinge = root.getObjectByName(name);
    const stages = [1, 2, 3].map(n => hinge.getObjectByName('telescoping-stage-' + n));
    return { hinge, stages, cover: covers[i] };
  });
  root.userData.poseMechanisms = sample => {
    elevator.rotation.x = -MathUtils.degToRad(sample.elevatorDeg ?? 0);
    const extended = sample.t === undefined ? 1 : 1-MathUtils.smoothstep(sample.t, .04, .50);
    for (const { hinge, stages, cover } of jacks) {
      hinge.rotation.x = MathUtils.degToRad(80) * extended;
      for (const stage of stages) stage.position.z = .01+.157*extended;
      cover.visible = extended > .93;
    }
    flex(sample);
    pilot(sample, pilotLaunchWeight(sample));
  };
  root.userData.poseMechanisms({ t: 2 });
  return root;
}
