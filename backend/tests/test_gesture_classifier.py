import json

import pytest

from app.core.config import REPO_ROOT
from app.gestures.features import extract
from app.gestures.rule_classifier import classify

CASES = [
    json.loads(line)
    for line in (REPO_ROOT / "evals" / "gesture-cases.jsonl")
    .read_text(encoding="utf-8")
    .splitlines()
    if line.strip()
]


def test_cases_cover_all_gestures() -> None:
    assert {c["expect"]["gesture"] for c in CASES} == {"NONE", "OPEN_PALM", "POINT", "PINCH", "FIST"}


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_matches_frontend(case: dict) -> None:
    """프론트엔드 TS 구현이 만든 기대값과 같은 특징·제스처를 내야 한다."""
    f = extract([tuple(p) for p in case["landmarks"]], case["aspect"])
    exp = case["expect"]
    assert f.finger_states == exp["finger_states"]
    assert f.finger_folded == exp["finger_folded"]
    assert f.pinch_distance == pytest.approx(exp["pinch_distance"], abs=1e-4)
    assert classify(f, case["prev"]) == exp["gesture"]


def test_wrong_landmark_count() -> None:
    with pytest.raises(ValueError):
        extract([(0.0, 0.0, 0.0)] * 20)
