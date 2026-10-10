// 좌표 안정화 필터. 모두 같은 인터페이스라 런타임에 바꿔 끼울 수 있다.

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface PointFilter {
  readonly name: FilterName;
  filter(p: Point3, timestampMs: number): Point3;
  reset(): void;
}

export type FilterName = "none" | "ema" | "one-euro";

export class NoFilter implements PointFilter {
  readonly name = "none";
  filter(p: Point3): Point3 {
    return p;
  }
  reset(): void {}
}

export class EmaFilter implements PointFilter {
  readonly name = "ema";
  private prev: Point3 | null = null;
  constructor(private readonly alpha = 0.35) {}
  filter(p: Point3): Point3 {
    const a = this.alpha;
    this.prev = this.prev
      ? { x: a * p.x + (1 - a) * this.prev.x, y: a * p.y + (1 - a) * this.prev.y, z: a * p.z + (1 - a) * this.prev.z }
      : { ...p };
    return this.prev;
  }
  reset(): void {
    this.prev = null;
  }
}

/** One Euro Filter (Casiez et al., 2012): 느릴 때 강하게, 빠를 때 약하게 평활화. */
class OneEuro1D {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly dCutoff: number,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tSec: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tSec;
      return x;
    }
    const dt = Math.max(tSec - this.tPrev, 1e-3);
    const dx = (x - this.xPrev) / dt;
    const aD = OneEuro1D.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = OneEuro1D.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = tSec;
    return xHat;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
  }
}

export class OneEuroFilter implements PointFilter {
  readonly name = "one-euro";
  private fx: OneEuro1D;
  private fy: OneEuro1D;
  private fz: OneEuro1D;

  /** 좌표가 0..1 정규화라 beta는 화면 픽셀 기준 값보다 크게 잡는다. */
  constructor(minCutoff = 1.0, beta = 0.007 * 640, dCutoff = 1.0) {
    this.fx = new OneEuro1D(minCutoff, beta, dCutoff);
    this.fy = new OneEuro1D(minCutoff, beta, dCutoff);
    this.fz = new OneEuro1D(minCutoff, beta, dCutoff);
  }

  filter(p: Point3, timestampMs: number): Point3 {
    const t = timestampMs / 1000;
    return { x: this.fx.filter(p.x, t), y: this.fy.filter(p.y, t), z: this.fz.filter(p.z, t) };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}

export function createFilter(name: FilterName): PointFilter {
  if (name === "ema") return new EmaFilter();
  if (name === "one-euro") return new OneEuroFilter();
  return new NoFilter();
}
