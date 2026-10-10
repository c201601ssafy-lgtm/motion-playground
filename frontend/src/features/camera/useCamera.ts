import { useCallback, useEffect, useRef, useState } from "react";
import { type CameraError, classifyCameraError, closeCamera, openCamera } from "./camera";

export type CameraStatus = "off" | "starting" | "on" | "error";

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("off");
  const [error, setError] = useState<CameraError | null>(null);

  const start = useCallback(async () => {
    if (!videoRef.current || streamRef.current) return;
    setStatus("starting");
    setError(null);
    try {
      streamRef.current = await openCamera(videoRef.current);
      setStatus("on");
    } catch (err) {
      setError(classifyCameraError(err));
      setStatus("error");
    }
  }, []);

  const stop = useCallback(() => {
    closeCamera(videoRef.current, streamRef.current);
    streamRef.current = null;
    setStatus("off");
  }, []);

  useEffect(() => () => closeCamera(videoRef.current, streamRef.current), []);

  return { videoRef, status, error, start, stop };
}
