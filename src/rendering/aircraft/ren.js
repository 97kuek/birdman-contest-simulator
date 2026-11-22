import { loadAircraftTemplate } from './model.js';
import { createRenAircraft as assemble } from './ren-model.js';

const template = await loadAircraftTemplate('ren');

export function createRenAircraft() {
  return assemble(template);
}
