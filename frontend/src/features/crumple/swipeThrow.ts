export interface SwipePoint { x: number; y: number; at: number }

/** Coordinates are fractions of the play area's height, so viewport size does not change power. */
export function swipeShot(points: SwipePoint[]) {
  const end = points.at(-1), start = points[0];
  if (!end || !start || end.at - start.at < 30 || start.y - end.y < 0.08) return null;
  const recent = points.find(p => end.at - p.at <= 150) ?? start;
  const dt = (end.at - recent.at) / 1000;
  if (dt < 0.025) return null;
  const up = (recent.y - end.y) / dt;
  if (up < 0.35) return null;
  return { power: Math.max(0.65, Math.min(1.3, 0.65 + up * 0.28)),
    aim: Math.max(-1.5, Math.min(1.5, (end.x - recent.x) / dt * 0.45)) };
}
