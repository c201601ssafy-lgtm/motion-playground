import { useEffect, useState, type RefObject } from "react";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { MEDIAPIPE_WASM_URL } from "../hand-tracking/handTracker";

export interface PosePoint { x: number; y: number; z: number; visibility: number }
export interface PoseFrame { points: PosePoint[]; at: number; demo?: boolean }
const listeners = new Set<(frame: PoseFrame | null) => void>();
export const poseBus = {
  subscribe(fn: (frame: PoseFrame | null) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  publish(frame: PoseFrame | null) { for (const fn of listeners) fn(frame); },
};
const CONNECTIONS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];

export function usePoseTracking(videoRef: RefObject<HTMLVideoElement | null>, overlayRef: RefObject<HTMLCanvasElement | null>, active: boolean) {
  const [status, setStatus] = useState("대기");
  useEffect(() => {
    if (!active) { setStatus("대기"); return; }
    let cancelled = false, handle = 0, model: PoseLandmarker | null = null, lastAt = -Infinity, lastVideo = -1;
    setStatus("상체 모델 불러오는 중…");
    const init = async () => {
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
      for (const delegate of ["GPU", "CPU"] as const) {
        try {
          model = await PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { delegate, modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" },
            runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
          });
          break;
        } catch (err) { if (delegate === "CPU") throw err; }
      }
      if (cancelled) { model?.close(); return; }
      setStatus("상체 추적 중");
      const tick = (now: number) => {
        if (cancelled) return;
        const video = videoRef.current, canvas = overlayRef.current;
        try {
          if (video && video.readyState >= 2 && video.currentTime !== lastVideo && now - lastAt >= 66) {
            lastAt = now; lastVideo = video.currentTime;
            const result = model!.detectForVideo(video, now);
            const points = result.landmarks[0]?.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 }));
            poseBus.publish(points ? { points, at: now } : null);
            if (canvas) {
              canvas.width = video.videoWidth; canvas.height = video.videoHeight;
              const ctx = canvas.getContext("2d");
              if (ctx && points) {
                ctx.strokeStyle = "#c084fc"; ctx.lineWidth = 3;
                for (const [a, b] of CONNECTIONS) {
                  const p = points[a!]!, q = points[b!]!;
                  if (p.visibility < 0.6 || q.visibility < 0.6) continue;
                  ctx.beginPath(); ctx.moveTo(p.x * canvas.width, p.y * canvas.height); ctx.lineTo(q.x * canvas.width, q.y * canvas.height); ctx.stroke();
                }
              }
            }
          }
          handle = requestAnimationFrame(tick);
        } catch { setStatus("상체 인식 중 오류가 발생했습니다. 카메라를 다시 켜 주세요."); poseBus.publish(null); }
      };
      handle = requestAnimationFrame(tick);
    };
    init().catch(() => { if (!cancelled) setStatus("상체 모델을 불러오지 못했습니다. 네트워크를 확인하세요."); });
    return () => { cancelled = true; cancelAnimationFrame(handle); model?.close(); poseBus.publish(null); const canvas = overlayRef.current; canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); };
  }, [active, videoRef, overlayRef]);
  return status;
}
