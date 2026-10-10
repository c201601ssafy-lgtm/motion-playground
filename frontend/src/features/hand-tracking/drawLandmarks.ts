import type { HandFrame } from "./types";
import { HAND_CONNECTIONS } from "./types";

/** 디버그 오버레이. 캔버스는 video와 같은 CSS 변환(거울)을 받으므로 원본 좌표로 그린다. */
export function drawLandmarks(canvas: HTMLCanvasElement, frame: HandFrame | null, color = "#3fb950"): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!frame) return;
  const pts = frame.landmarks;
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = pts[a];
    const pb = pts[b];
    if (!pa || !pb) continue;
    ctx.moveTo(pa.x * w, pa.y * h);
    ctx.lineTo(pb.x * w, pb.y * h);
  }
  ctx.stroke();
  ctx.fillStyle = "#f0f6fc";
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const pc = frame.palm_center;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pc.x * w, pc.y * h, 6, 0, Math.PI * 2);
  ctx.fill();
}
