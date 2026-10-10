"""랜드마크 → 제스처 특징. frontend/src/features/gestures/features.ts 와 같은 계산."""

import math
from dataclasses import dataclass

Point = tuple[float, float, float]

WRIST, THUMB_MCP, THUMB_IP, THUMB_TIP = 0, 2, 3, 4
INDEX_MCP, INDEX_TIP, MIDDLE_MCP = 5, 8, 9
FINGER_JOINTS: dict[str, tuple[int, int, int, int]] = {
    "index": (5, 6, 7, 8),
    "middle": (9, 10, 11, 12),
    "ring": (13, 14, 15, 16),
    "pinky": (17, 18, 19, 20),
}
PALM_IDS = (0, 5, 9, 13, 17)

FINGER_STRAIGHT_MAX_DEG = 60.0
THUMB_STRAIGHT_MAX_DEG = 50.0
THUMB_SPREAD_MIN = 0.55


@dataclass(frozen=True)
class HandFeatures:
    finger_states: dict[str, bool]
    finger_folded: dict[str, bool]
    pinch_distance: float
    hand_size: float
    palm_center: Point


def _scaled(lm: list[Point], aspect: float) -> list[Point]:
    return [(x * aspect, y, z * aspect) for x, y, z in lm]


def _dist2d(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _bend_deg(a: Point, b: Point, c: Point) -> float:
    u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    v = (c[0] - b[0], c[1] - b[1], c[2] - b[2])
    lu, lv = math.hypot(*u), math.hypot(*v)
    if lu == 0 or lv == 0:
        return 180.0
    cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv)
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


def hand_size(lm: list[Point]) -> float:
    return _dist2d(lm[WRIST], lm[MIDDLE_MCP])


def extract(raw: list[Point], aspect: float = 1.0) -> HandFeatures:
    if len(raw) != 21:
        raise ValueError(f"랜드마크는 21개여야 함 (받은 수 {len(raw)})")
    lm = _scaled(raw, aspect)
    size = hand_size(lm) or 1e-6
    wrist = lm[WRIST]

    def extended(joints: tuple[int, int, int, int]) -> bool:
        mcp, pip, dip, tip = (lm[i] for i in joints)
        bend = _bend_deg(mcp, pip, tip) + _bend_deg(pip, dip, tip) / 2
        return bend < FINGER_STRAIGHT_MAX_DEG and _dist2d(wrist, tip) > _dist2d(wrist, pip)

    def folded(joints: tuple[int, int, int, int]) -> bool:
        _, pip, _, tip = joints
        return _dist2d(wrist, lm[tip]) < _dist2d(wrist, lm[pip])

    thumb_bend = _bend_deg(lm[THUMB_MCP], lm[THUMB_IP], lm[THUMB_TIP])
    thumb_spread = _dist2d(lm[THUMB_TIP], lm[INDEX_MCP]) / size
    states = {
        "thumb": thumb_bend < THUMB_STRAIGHT_MAX_DEG and thumb_spread > THUMB_SPREAD_MIN,
        **{name: extended(j) for name, j in FINGER_JOINTS.items()},
    }
    palm = tuple(sum(raw[i][k] for i in PALM_IDS) / len(PALM_IDS) for k in range(3))
    return HandFeatures(
        finger_states=states,
        finger_folded={name: folded(j) for name, j in FINGER_JOINTS.items()},
        pinch_distance=_dist2d(lm[THUMB_TIP], lm[INDEX_TIP]) / size,
        hand_size=size,
        palm_center=palm,  # type: ignore[arg-type]
    )
