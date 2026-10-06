export const DIAL_GEOMETRY = Object.freeze({
  centerX: 360,
  centerY: 330,
  faceRadius: 280,
  shoulderOffsetX: 246,
  shoulderOffsetY: 23,
  capRadius: 16,
  sectorHalfWidth: 10,
  clearanceDegrees: 1
});

const { centerX, centerY, faceRadius, shoulderOffsetX, shoulderOffsetY, capRadius, sectorHalfWidth, clearanceDegrees } = DIAL_GEOMETRY;
const lipDegrees = Math.atan2(shoulderOffsetY, shoulderOffsetX) * 180 / Math.PI;
// A complete fan extends 10 normalized units past its center. Solve for the
// playable arc so even that outer ray clears the sloped bottom of the window:
// start - (180 - 2 * start) * 10 / 100 >= lip + clearance.
const fanFraction = sectorHalfWidth / 100;
const startDegrees = Math.ceil((lipDegrees + clearanceDegrees + 180 * fanFraction) / (1 + 2 * fanFraction) * 10) / 10;
export const DIAL_ARC = Object.freeze({
  lipDegrees,
  startDegrees,
  endDegrees: 180 - startDegrees,
  spanDegrees: 180 - 2 * startDegrees
});

// Network positions and scores stay normalized, including existing rooms.
// The renderer also maps the outer fan at -10/110; only input is clamped.
export function angleForPosition(position) {
  return DIAL_ARC.startDegrees + position / 100 * DIAL_ARC.spanDegrees;
}

export function positionForAngle(angle) {
  return Math.max(0, Math.min(100, (angle - DIAL_ARC.startDegrees) / DIAL_ARC.spanDegrees * 100));
}

export function dialPoint(position, radius) {
  const angle = Math.PI - angleForPosition(position) * Math.PI / 180;
  return [centerX + Math.cos(angle) * radius, centerY - Math.sin(angle) * radius];
}

const left = centerX - faceRadius, right = centerX + faceRadius;
export const DIAL_SHUTTER_PATH = `M${left} ${centerY} A${faceRadius} ${faceRadius} 0 0 1 ${right} ${centerY} Z`;
export const DIAL_WINDOW_PATH = `M${left} ${centerY} A${faceRadius} ${faceRadius} 0 0 1 ${right} ${centerY} A${capRadius} ${capRadius} 0 0 1 ${right - 2 * capRadius} ${centerY} L${centerX + shoulderOffsetX} ${centerY - shoulderOffsetY} L${centerX} ${centerY} L${centerX - shoulderOffsetX} ${centerY - shoulderOffsetY} L${left + 2 * capRadius} ${centerY} A${capRadius} ${capRadius} 0 0 1 ${left} ${centerY} Z`;
