import { lensMap, type Shape } from './lens';
import { GLASS } from './rim';

// The original Glisse dome and falloff. Pack X into neutral grey and Y into
// alpha, so one displacement pass replaces six RGB passes + compositing.
// Grey avoids Chromium's wide-gamut conversion of coloured displacement maps.
export function compactMap(shape: Shape) {
  const density = Math.min(1, Math.sqrt(32768 / (shape.width * shape.height)), 512 / Math.max(shape.width, shape.height));
  const map = lensMap(shape, GLASS, { angle: 45, glow: 0, spread: .5, glowPower: 1, edge: 0, edgeWidth: 1, edgePower: 1 }, density);
  const data = map.across;
  for (let i = 0; i < data.length; i += 4) {
    const coverage = map.light[i + 3] / 255;
    const x = Math.round(128 + (map.across[i] - 128) * coverage);
    const y = Math.round(128 + (map.down[i] - 128) * coverage);
    data[i] = data[i + 1] = data[i + 2] = x;
    data[i + 3] = y;
  }
  return { columns: map.columns, rows: map.rows, data };
}
