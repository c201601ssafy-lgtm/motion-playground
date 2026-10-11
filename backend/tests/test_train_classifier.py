import importlib.util
import json
import sys
from pathlib import Path

import pytest

from app.core.config import REPO_ROOT

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "train_classifier.py"
spec = importlib.util.spec_from_file_location("train_classifier", SCRIPT)
tc = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
sys.modules["train_classifier"] = tc
spec.loader.exec_module(tc)  # type: ignore[union-attr]

SAMPLE = REPO_ROOT / "evals" / "gesture-records-sample.jsonl"


def test_frame_features_are_position_and_scale_invariant() -> None:
    rec = json.loads(SAMPLE.read_text(encoding="utf-8").splitlines()[0])
    lm = next(f["landmarks"] for f in rec["frames"] if f["landmarks"])
    moved = [[x * 0.5 + 0.2, y * 0.5 + 0.1, z] for x, y, z in lm]
    a, b = tc.frame_features(lm), tc.frame_features(moved)
    assert len(a) == 42 + 10
    assert a == pytest.approx(b, abs=1e-6)


def test_scores() -> None:
    s = tc.scores(["PINCH", "PINCH", "FIST", "FIST"], ["PINCH", "FIST", "FIST", "FIST"])
    assert s["accuracy"] == 0.75
    assert s["recall"] == {"PINCH": 0.5, "FIST": 1.0}


def test_rows_skip_frames_without_hand() -> None:
    recs = tc.load_records([SAMPLE])
    rows = tc.frames_of(recs)
    with_hand = sum(1 for r in recs for f in r["frames"] if f.get("landmarks"))
    assert len(rows) == with_hand
    assert {r["subject"] for r in rows} == {"syn01", "syn02", "syn03"}


def test_leave_one_subject_out_on_synthetic(tmp_path: Path) -> None:
    pytest.importorskip("sklearn")
    assert tc.main([str(SAMPLE), "--out", str(tmp_path)]) == 0
    report = json.loads((tmp_path / "classifier-compare.json").read_text(encoding="utf-8"))
    assert set(report["folds"]) == {"syn01", "syn02", "syn03"}
    # 각 폴드는 시험 피험자를 학습에서 뺀다
    total = report["frames"]
    for fold in report["folds"].values():
        assert fold["train_n"] + fold["rf"]["n"] == total
    assert 0 <= report["overall"]["rf"]["accuracy"] <= 1
