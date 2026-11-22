import { loadAircraftTemplate } from './model.js';
import { createQx25Aircraft as assemble } from './qx25-model.js';

const template = await loadAircraftTemplate('qx25');

export function createQx25Aircraft() {
  return assemble(template);
}
