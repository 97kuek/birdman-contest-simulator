// Reference spar in the rendered free-flight outline, in metres above model origin.
export function renSparHeight(station) {
  const x = Math.abs(station);
  return 1.535 + x * Math.tan(4 * Math.PI / 180) + 1.43 * (x / 16.1) ** 2.5;
}
