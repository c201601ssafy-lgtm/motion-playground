// 단계별 지연 계측 (D-009). 고정 크기 링버퍼에 ms 값을 모아 p50/p95를 낸다.

export type LatencyStage = "landmark" | "gesture" | "dispatch" | "endToEnd";
export const LATENCY_STAGES: LatencyStage[] = ["landmark", "gesture", "dispatch", "endToEnd"];

export const STAGE_LABEL: Record<LatencyStage, string> = {
  landmark: "랜드마크 추출",
  gesture: "제스처 판정",
  dispatch: "명령 처리",
  endToEnd: "프레임→명령",
};

export class RingBuffer {
  private data: number[] = [];
  private next = 0;
  constructor(private readonly capacity = 300) {}

  push(v: number): void {
    if (this.data.length < this.capacity) this.data.push(v);
    else this.data[this.next] = v;
    this.next = (this.next + 1) % this.capacity;
  }

  values(): number[] {
    return [...this.data];
  }

  get size(): number {
    return this.data.length;
  }

  clear(): void {
    this.data = [];
    this.next = 0;
  }
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export interface StageStats {
  p50: number | null;
  p95: number | null;
  n: number;
}

export class LatencyTracker {
  private buffers = new Map<LatencyStage, RingBuffer>(LATENCY_STAGES.map((s) => [s, new RingBuffer()]));

  record(stage: LatencyStage, ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) this.buffers.get(stage)!.push(ms);
  }

  stats(): Record<LatencyStage, StageStats> {
    const out = {} as Record<LatencyStage, StageStats>;
    for (const s of LATENCY_STAGES) {
      const v = this.buffers.get(s)!.values();
      out[s] = { p50: percentile(v, 50), p95: percentile(v, 95), n: v.length };
    }
    return out;
  }

  clear(): void {
    for (const b of this.buffers.values()) b.clear();
  }
}

export const latency = new LatencyTracker();
