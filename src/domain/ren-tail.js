import { liftCoefficient } from './aerodynamic-lift.js';
import { AIR_DENSITY } from './powered-cruise.js';

// Windnauts 2023 three-view, p.20. Heights locate the centres on the 3D model.
export const REN_TAIL = Object.freeze({
  horizontal: Object.freeze({ span: 3.38, area: 2.01, arm: 5.30, height: 1.53 }),
  vertical: Object.freeze({ span: 2.90, area: 2.16, arm: 6.10, height: 2.29 }),
});

// Forces in the local section plane. Positive normal velocity produces a
// restoring (negative normal) force. Both tailplanes are all-moving NACA 0009.
export function tailSection({ span, area }) {
  const efficiency = 0.8, clMax = 1.1; // estimates in absence of section polars
  const aspect = span ** 2 / area;
  const slope = 2 * Math.PI / (1 + 2 / (efficiency * aspect));
  function force(axial, normal, incidence) {
    const speed = Math.hypot(axial, normal);
    if (!speed) return { axial: 0, normal: 0 };
    const cl = liftCoefficient(Math.atan2(normal, axial) + incidence, slope, clMax);
    const qS = 0.5 * AIR_DENSITY * speed ** 2 * area;
    const lift = qS * cl, drag = lift * cl / (Math.PI * efficiency * aspect);
    // Zero-lift tail drag is already included in the design-point polar.
    return { axial: (lift * normal - drag * axial) / speed,
      normal: (-lift * axial - drag * normal) / speed };
  }
  return (axial, normal, incidence, slipstream, immersedFraction) => {
    const ambient = force(axial, normal, incidence);
    if (!slipstream) return ambient;
    const immersed = force(axial + slipstream, normal, incidence);
    return { axial: ambient.axial + immersedFraction * (immersed.axial - ambient.axial),
      normal: ambient.normal + immersedFraction * (immersed.normal - ambient.normal) };
  };
}
