// 평기어 외곽선 (사다리꼴 이빨 근사). 교육용 시각화이며 인벌류트 치형이 아니다.

export interface Point2 {
  x: number;
  y: number;
}

export function gearOutline(teeth: number, module: number): Point2[] {
  const pitch = (module * teeth) / 2;
  const tip = pitch + module; // 이끝원 (addendum = m)
  const root = pitch - 1.25 * module; // 이뿌리원 (dedendum = 1.25m)
  const step = (Math.PI * 2) / teeth;
  const points: Point2[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    // 이뿌리 → 이 옆면 → 이끝 → 이 옆면: 피치 원에서 이 두께 ≈ 간격
    const angles: [number, number][] = [
      [a, root],
      [a + step * 0.2, tip],
      [a + step * 0.45, tip],
      [a + step * 0.65, root],
    ];
    for (const [ang, r] of angles) points.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
  }
  return points;
}
