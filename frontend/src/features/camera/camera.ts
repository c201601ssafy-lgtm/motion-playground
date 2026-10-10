// 웹캠 접근. 프레임은 브라우저 안에서만 쓰고 저장·전송하지 않는다.

export type CameraErrorKind = "denied" | "no-device" | "in-use" | "insecure" | "unsupported" | "unknown";

export interface CameraError {
  kind: CameraErrorKind;
  message: string;
}

const MESSAGES: Record<CameraErrorKind, string> = {
  denied: "카메라 권한이 거부되었습니다. 주소창의 카메라 아이콘에서 허용해 주세요.",
  "no-device": "사용할 수 있는 카메라가 없습니다.",
  "in-use": "다른 프로그램이 카메라를 사용 중입니다.",
  insecure: "카메라는 https 또는 localhost에서만 사용할 수 있습니다.",
  unsupported: "이 브라우저는 카메라를 지원하지 않습니다.",
  unknown: "카메라를 켜지 못했습니다.",
};

export function classifyCameraError(err: unknown): CameraError {
  const name = (err as { name?: string } | null)?.name ?? "";
  let kind: CameraErrorKind = "unknown";
  if (name === "NotAllowedError" || name === "SecurityError") kind = "denied";
  else if (name === "NotFoundError" || name === "OverconstrainedError") kind = "no-device";
  else if (name === "NotReadableError" || name === "AbortError") kind = "in-use";
  else if (name === "InsecureContextError") kind = "insecure";
  else if (name === "UnsupportedError") kind = "unsupported";
  return { kind, message: MESSAGES[kind] };
}

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user", frameRate: { ideal: 30 } },
};

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!window.isSecureContext) throw Object.assign(new Error("insecure"), { name: "InsecureContextError" });
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("unsupported"), { name: "UnsupportedError" });
  }
  const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function closeCamera(video: HTMLVideoElement | null, stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
  if (video) video.srcObject = null;
}
