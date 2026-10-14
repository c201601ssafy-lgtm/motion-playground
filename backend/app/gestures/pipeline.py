"""제스처 상태 머신·좌표 필터 Python 포팅 (평가용).

frontend/src/features/gestures/{stateMachine,filters,pipeline}.ts 와 같은 규칙.
녹화된 랜드마크(JSONL)를 앱과 같은 방식으로 재생해 정확도·안정성·지연을 잰다.
"""

import math
from dataclasses import dataclass, field
from typing import Literal

from app.gestures.features import INDEX_TIP, THUMB_TIP, HandFeatures, Point, extract
from app.gestures.rule_classifier import GestureType, classify

MIN_HOLD_FRAMES = 3
MIN_CONFIDENCE = 0.6
SWITCH_COOLDOWN_MS = 150.0
LOST_FRAMES = 5

FilterName = Literal["none", "ema", "one-euro"]


class EmaFilter:
    def __init__(self, alpha: float = 0.35) -> None:
        self.alpha = alpha
        self.prev: Point | None = None

    def __call__(self, p: Point, _t_ms: float) -> Point:
        a = self.alpha
        self.prev = (
            p
            if self.prev is None
            else tuple(a * x + (1 - a) * y for x, y in zip(p, self.prev, strict=True))
        )  # type: ignore[assignment]
        return self.prev  # type: ignore[return-value]

    def reset(self) -> None:
        self.prev = None


class _OneEuro1D:
    def __init__(self, min_cutoff: float, beta: float, d_cutoff: float) -> None:
        self.min_cutoff, self.beta, self.d_cutoff = min_cutoff, beta, d_cutoff
        self.x_prev: float | None = None
        self.dx_prev = 0.0
        self.t_prev = 0.0

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1 / (2 * math.pi * cutoff)
        return 1 / (1 + tau / dt)

    def __call__(self, x: float, t_s: float) -> float:
        if self.x_prev is None:
            self.x_prev, self.t_prev = x, t_s
            return x
        dt = max(t_s - self.t_prev, 1e-3)
        dx = (x - self.x_prev) / dt
        a_d = self._alpha(self.d_cutoff, dt)
        dx_hat = a_d * dx + (1 - a_d) * self.dx_prev
        a = self._alpha(self.min_cutoff + self.beta * abs(dx_hat), dt)
        x_hat = a * x + (1 - a) * self.x_prev
        self.x_prev, self.dx_prev, self.t_prev = x_hat, dx_hat, t_s
        return x_hat

    def reset(self) -> None:
        self.x_prev = None
        self.dx_prev = 0.0


class OneEuroFilter:
    def __init__(
        self, min_cutoff: float = 1.0, beta: float = 0.007 * 640, d_cutoff: float = 1.0
    ) -> None:
        self.f = [_OneEuro1D(min_cutoff, beta, d_cutoff) for _ in range(3)]

    def __call__(self, p: Point, t_ms: float) -> Point:
        return tuple(f(v, t_ms / 1000) for f, v in zip(self.f, p, strict=True))  # type: ignore[return-value]

    def reset(self) -> None:
        for f in self.f:
            f.reset()


class NoFilter:
    def __call__(self, p: Point, _t_ms: float) -> Point:
        return p

    def reset(self) -> None:
        pass


def make_filter(name: FilterName) -> EmaFilter | OneEuroFilter | NoFilter:
    return {"ema": EmaFilter, "one-euro": OneEuroFilter, "none": NoFilter}[name]()


@dataclass
class GestureEvent:
    type: GestureType
    phase: Literal["start", "hold", "end"]
    position: Point
    t_ms: float


@dataclass
class StateMachine:
    active: GestureType = "NONE"
    candidate: GestureType = "NONE"
    count: int = 0
    last_switch: float = -math.inf
    missing: int = 0

    def update(
        self, c: GestureType | None, confidence: float, now: float
    ) -> list[tuple[str, GestureType]]:
        """반환: [(phase, gesture)] — 위치는 호출자가 붙인다."""
        out: list[tuple[str, GestureType]] = []
        if c is None:
            self.missing += 1
            self.candidate, self.count = "NONE", 0
            if self.active != "NONE" and self.missing >= LOST_FRAMES:
                out.append(("end", self.active))
                self.active, self.last_switch = "NONE", now
            return out
        self.missing = 0
        t = c if confidence >= MIN_CONFIDENCE else "NONE"
        if t == self.candidate:
            self.count += 1
        else:
            self.candidate, self.count = t, 1
        if (
            self.candidate != self.active
            and self.count >= MIN_HOLD_FRAMES
            and now - self.last_switch >= SWITCH_COOLDOWN_MS
        ):
            if self.active != "NONE":
                out.append(("end", self.active))
            self.active, self.last_switch = self.candidate, now
            if self.active != "NONE":
                out.append(("start", self.active))
            return out
        if self.active != "NONE":
            out.append(("hold", self.active))
        return out


def control_point(lm: list[Point], f: HandFeatures, gesture: GestureType) -> Point:
    if gesture == "POINT":
        return lm[INDEX_TIP]
    if gesture == "PINCH":
        a, b = lm[THUMB_TIP], lm[INDEX_TIP]
        return tuple((x + y) / 2 for x, y in zip(a, b, strict=True))  # type: ignore[return-value]
    return f.palm_center


@dataclass
class FrameResult:
    t_ms: float
    raw: GestureType | None  # 이번 프레임 분류 (손 없으면 None)
    active: GestureType  # 상태 머신 확정 제스처
    events: list[GestureEvent] = field(default_factory=list)


def replay(
    frames: list[dict], aspect: float = 1.0, filter_name: FilterName = "one-euro"
) -> list[FrameResult]:
    """녹화 프레임([{t, landmarks, handedness_score}])을 앱과 같은 파이프라인으로 재생."""
    sm = StateMachine()
    flt = make_filter(filter_name)
    kind: str | None = None
    out: list[FrameResult] = []
    for fr in frames:
        t = float(fr["t"])
        lm_raw = fr.get("landmarks")
        if not lm_raw:
            flt.reset()
            kind = None
            evs = sm.update(None, 0.0, t)
            out.append(
                FrameResult(t, None, sm.active, [GestureEvent(g, p, (0, 0, 0), t) for p, g in evs])
            )  # type: ignore[arg-type]
            continue
        lm = [tuple(p) for p in lm_raw]
        f = extract(lm, aspect)  # type: ignore[arg-type]
        raw = classify(f, sm.active)
        if sm.active == "NONE":
            kind = None
        evs = sm.update(raw, float(fr.get("handedness_score", 1.0)), t)
        events = []
        for phase, g in evs:
            k = "pinch" if g == "PINCH" else "point" if g == "POINT" else "palm"
            if k != kind:
                flt.reset()
                kind = k
            pos = flt(control_point(lm, f, g), t)  # type: ignore[arg-type]
            events.append(GestureEvent(g, phase, pos, t))  # type: ignore[arg-type]
        out.append(FrameResult(t, raw, sm.active, events))
    return out
