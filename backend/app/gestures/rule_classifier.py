"""D-002 규칙 기반 분류기. frontend/src/features/gestures/ruleClassifier.ts 와 동일 규칙."""

from typing import Literal

from app.gestures.features import HandFeatures

GestureType = Literal["NONE", "OPEN_PALM", "POINT", "PINCH", "FIST"]

PINCH_ENTER = 0.35
PINCH_EXIT = 0.5


def classify(f: HandFeatures | None, prev: GestureType = "NONE") -> GestureType:
    if f is None:
        return "NONE"
    limit = PINCH_EXIT if prev == "PINCH" else PINCH_ENTER
    if f.pinch_distance < limit and not f.finger_folded["index"]:
        return "PINCH"
    # 엄지는 가려지거나 오검출이 잦아 판정에서 뺀다 (D-014)
    if all(v for k, v in f.finger_states.items() if k != "thumb"):
        return "OPEN_PALM"
    if f.finger_states["index"] and all(f.finger_folded[k] for k in ("middle", "ring", "pinky")):
        return "POINT"
    if all(f.finger_folded.values()):
        return "FIST"
    return "NONE"
