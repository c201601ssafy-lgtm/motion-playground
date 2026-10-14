"""학습 분류기(RandomForest) vs 규칙 분류기 비교 (spec §6, P5-8).

입력: datasets/gestures/raw/*.jsonl (없으면 evals/gesture-records-sample.jsonl — 합성 데이터)
출력: evals/reports/classifier-compare.json, classifier-compare.md

- 프레임 단위, 손이 감지된 프레임만 비교한다(손이 없으면 둘 다 NONE이라 비교 의미 없음).
- 사용자 단위 분리(leave-one-subject-out): 한 사람을 빼고 학습해 그 사람으로 시험한다.
  같은 사람의 프레임이 학습·시험에 섞이면 점수가 부풀기 때문이다.
- 특징: 손목 기준·손 크기로 정규화한 랜드마크 42개(x, y) + 규칙 분류기가 쓰는 손가락 특징 10개.

scikit-learn이 필요하다: uv sync --group ml
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import REPO_ROOT  # noqa: E402
from app.gestures.features import WRIST, extract, hand_size  # noqa: E402
from app.gestures.rule_classifier import classify  # noqa: E402

LABELS = ["OPEN_PALM", "POINT", "PINCH", "FIST", "NONE"]
FINGERS = ["thumb", "index", "middle", "ring", "pinky"]
FOLDED = ["index", "middle", "ring", "pinky"]


def load_records(paths: list[Path]) -> list[dict]:
    recs = []
    for p in paths:
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                recs.append(json.loads(line))
    return recs


def default_inputs() -> tuple[list[Path], str]:
    raw = sorted((REPO_ROOT / "datasets" / "gestures" / "raw").glob("*.jsonl"))
    if raw:
        return raw, "recorded"
    return [REPO_ROOT / "evals" / "gesture-records-sample.jsonl"], "synthetic"


def frame_features(lm: list[list[float]], aspect: float = 1.0) -> list[float]:
    """손목 원점, 손 크기 1로 맞춘 랜드마크 (x, y) 42개 + 손가락 특징 10개."""
    pts = [(p[0] * aspect, p[1]) for p in lm]
    wx, wy = pts[WRIST]
    size = hand_size([(x, y, 0.0) for x, y in pts]) or 1e-6
    coords = [v for x, y in pts for v in ((x - wx) / size, (y - wy) / size)]
    f = extract(lm, aspect)  # type: ignore[arg-type]
    rule = [float(f.finger_states[k]) for k in FINGERS] + [
        float(f.finger_folded[k]) for k in FOLDED
    ]
    return coords + rule + [f.pinch_distance]


def frames_of(records: list[dict]) -> list[dict]:
    """손이 감지된 프레임만: 특징, 라벨, 사용자, 규칙 분류 결과."""
    rows = []
    for rec in records:
        aspect = float(rec.get("aspect", 1.0))
        for fr in rec["frames"]:
            lm = fr.get("landmarks")
            if not lm or len(lm) != 21:
                continue
            rows.append(
                {
                    "x": frame_features(lm, aspect),
                    "label": rec["label"],
                    "subject": rec["subject_id"],
                    "lighting": rec["lighting"],
                    "rule": classify(extract(lm, aspect)),  # type: ignore[arg-type]
                }
            )
    return rows


def scores(y_true: list[str], y_pred: list[str]) -> dict:
    """Accuracy, Macro F1(실제로 나온 라벨만), 라벨별 recall."""
    labels = [lab for lab in LABELS if lab in y_true]
    acc = sum(t == p for t, p in zip(y_true, y_pred, strict=True)) / len(y_true) if y_true else 0.0
    f1s, recall = [], {}
    for lab in labels:
        tp = sum(t == lab and p == lab for t, p in zip(y_true, y_pred, strict=True))
        fp = sum(t != lab and p == lab for t, p in zip(y_true, y_pred, strict=True))
        fn = sum(t == lab and p != lab for t, p in zip(y_true, y_pred, strict=True))
        pr = tp / (tp + fp) if tp + fp else 0.0
        rc = tp / (tp + fn) if tp + fn else 0.0
        f1s.append(2 * pr * rc / (pr + rc) if pr + rc else 0.0)
        recall[lab] = round(rc, 4)
    return {
        "accuracy": round(acc, 4),
        "macro_f1": round(sum(f1s) / len(f1s), 4) if f1s else 0.0,
        "recall": recall,
        "n": len(y_true),
    }


def leave_one_subject_out(rows: list[dict], seed: int = 0) -> dict:
    from sklearn.ensemble import RandomForestClassifier

    subjects = sorted({r["subject"] for r in rows})
    if len(subjects) < 2:
        raise ValueError("사용자 단위 분리에는 피험자가 2명 이상 필요하다")
    folds = {}
    all_true: list[str] = []
    all_rf: list[str] = []
    all_rule: list[str] = []
    for s in subjects:
        train = [r for r in rows if r["subject"] != s]
        test = [r for r in rows if r["subject"] == s]
        model = RandomForestClassifier(n_estimators=200, random_state=seed, n_jobs=-1)
        model.fit([r["x"] for r in train], [r["label"] for r in train])
        rf = [str(p) for p in model.predict([r["x"] for r in test])]
        truth = [r["label"] for r in test]
        rule = [r["rule"] for r in test]
        folds[s] = {"rf": scores(truth, rf), "rule": scores(truth, rule), "train_n": len(train)}
        all_true += truth
        all_rf += rf
        all_rule += rule
    by_light: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    i = 0
    for s in subjects:
        for r in (r for r in rows if r["subject"] == s):
            g = by_light[r["lighting"]]
            g["true"].append(r["label"])
            g["rf"].append(all_rf[i])
            g["rule"].append(all_rule[i])
            i += 1
    return {
        "overall": {"rf": scores(all_true, all_rf), "rule": scores(all_true, all_rule)},
        "folds": folds,
        "by_lighting": {
            k: {"rf": scores(v["true"], v["rf"]), "rule": scores(v["true"], v["rule"])}
            for k, v in sorted(by_light.items())
        },
    }


def to_markdown(report: dict) -> str:
    o = report["overall"]
    lines = [
        "# Classifier Comparison — RandomForest vs 규칙 기반",
        "",
        f"- 데이터: {report['source']} ({', '.join(report['inputs'])})",
        f"- 프레임 {report['frames']}개 (손 감지된 프레임만), 피험자 {len(report['folds'])}명, 사용자 단위 분리(LOSO)",
        "",
        "| 분류기 | Accuracy | Macro F1 |",
        "|---|---|---|",
        f"| 규칙 기반 | {o['rule']['accuracy']:.1%} | {o['rule']['macro_f1']:.3f} |",
        f"| RandomForest (200그루) | {o['rf']['accuracy']:.1%} | {o['rf']['macro_f1']:.3f} |",
        "",
        "| 시험 피험자 | 규칙 Acc | RF Acc | 학습 프레임 |",
        "|---|---|---|---|",
    ]
    for s, f in report["folds"].items():
        lines.append(
            f"| {s} | {f['rule']['accuracy']:.1%} | {f['rf']['accuracy']:.1%} | {f['train_n']} |"
        )
    lines += ["", "| 조명 | 규칙 Acc | RF Acc |", "|---|---|---|"]
    for k, v in report["by_lighting"].items():
        lines.append(f"| {k} | {v['rule']['accuracy']:.1%} | {v['rf']['accuracy']:.1%} |")
    lines += ["", "| 라벨 | 규칙 Recall | RF Recall |", "|---|---|---|"]
    for lab in o["rule"]["recall"]:
        lines.append(
            f"| {lab} | {o['rule']['recall'][lab]:.1%} | {o['rf']['recall'].get(lab, 0):.1%} |"
        )
    if report["source"] == "synthetic":
        lines += [
            "",
            "> 합성 데이터 결과다. 합성 손은 규칙 분류기와 같은 가정(손가락 굽힘 각도)으로 만들어서 두 분류기 모두 점수가 높게 나온다. 실제 비교는 `#/record`로 모은 사람 데이터(`datasets/gestures/raw/`)로 다시 돌려야 한다.",
        ]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("inputs", nargs="*", type=Path, help="녹화 JSONL (없으면 기본 경로)")
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "evals" / "reports")
    args = ap.parse_args(argv)

    try:
        import sklearn  # noqa: F401
    except ImportError:
        print("scikit-learn이 없다. `uv sync --group ml` 후 다시 실행한다. (건너뜀)")
        return 0

    inputs = args.inputs or default_inputs()[0]
    records = load_records(inputs)
    source = "synthetic" if all(r.get("source") == "synthetic" for r in records) else "recorded"
    rows = frames_of(records)
    if len({r["subject"] for r in rows}) < 2:
        print("피험자가 2명 이상인 데이터가 없어 비교를 건너뛴다.")
        return 0
    report = {
        "source": source,
        "inputs": [p.name for p in inputs],
        "frames": len(rows),
        **leave_one_subject_out(rows),
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "classifier-compare.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    md = to_markdown(report)
    (args.out / "classifier-compare.md").write_text(md, encoding="utf-8", newline="\n")
    print(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
