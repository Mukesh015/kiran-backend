// utils/geometry.js

/**
 * Volume of a horizontal cylinder partly filled
 * D = diameter (m)
 * L = length (m)
 * h = liquid depth from bottom (m)
 * returns m^3
 */
export function horizontalCylinderVolume(D, L, h) {
  const R = D / 2;
  if (h <= 0) return 0;
  if (h >= D) return Math.PI * R * R * L; // full

  const term1 = R * R * Math.acos((R - h) / R);
  const term2 = (R - h) * Math.sqrt(2 * R * h - h * h);
  const area = term1 - term2;

  return L * area;
}
