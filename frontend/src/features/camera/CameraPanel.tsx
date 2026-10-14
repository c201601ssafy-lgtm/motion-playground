import type { ReactNode, RefObject } from "react";
import styles from "./CameraPanel.module.css";
import type { CameraError } from "./camera";
import type { CameraStatus } from "./useCamera";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: CameraError | null;
  onStart: () => void;
  onStop: () => void;
  overlay?: ReactNode;
  children?: ReactNode;
  idleHint?: string;
  compact?: boolean;
}

export function CameraPanel({ videoRef, status, error, onStart, onStop, overlay, children, idleHint, compact = false }: Props) {
  return (
    <section className={`${styles.panel} ${compact ? styles.compact : ""}`} aria-label="웹캠">
      <div className={styles.preview} data-status={status}>
        {/* 거울처럼 보이도록 좌우 반전. 랜드마크 오버레이도 같은 변환을 받는다. */}
        <video ref={videoRef} className={styles.video} muted playsInline />
        {overlay}
        {status !== "on" && (
          <div className={styles.placeholder}>
            {status === "starting" ? "카메라 켜는 중…" : idleHint ?? "카메라 꺼짐 (마우스로도 조작 가능)"}
          </div>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error.message}
        </p>
      )}
      <div className={styles.row}>
        {status === "on" ? (
          <button type="button" onClick={onStop}>
            카메라 끄기
          </button>
        ) : (
          <button type="button" onClick={onStart} disabled={status === "starting"}>
            카메라 켜기
          </button>
        )}
        <span className={styles.privacy}>영상은 저장·전송하지 않습니다</span>
      </div>
      {children}
    </section>
  );
}
