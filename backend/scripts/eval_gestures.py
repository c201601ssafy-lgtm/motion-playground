"""제스처 인식 평가 (D-009).

입력: datasets/gestures/raw/*.jsonl (없으면 evals/gesture-records-sample.jsonl — 합성 데이터)
출력: evals/reports/gesture-eval.json, gesture-eval.md

지표
- 프레임 단위: 분류기 원시 결과 vs 라벨 → Accuracy, Macro F1, 라벨별 Precision/Recall, 혼동행렬
- 클립 단위: 상태 머신이 확정한 제스처(최빈값) vs 라벨, 사용자별·조명별 정확도
- 판정 지연: 클립 시작부터 올바른 제스처가 처음 확정(start)될 때까지 ms
- 안정성(필터별): 확정 구간 위치 표준편차, 클립당 잘못된 전환(start) 횟수
"""

import argparse
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import REPO_ROOT  # noqa: E402
from app.gestures.pipeline import FilterName, replay  # noqa: E402

LABELS = ["OPEN_PALM", "PINCH", "FIST", "NONE"]
FILTERS: list[FilterName] = ["none", "ema", "one-euro"]


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


def prf(confusion: dict[str, Counter]) -> dict[str, dict[str, float]]:
    out = {}
    for lab in LABELS:
        tp = confusion[lab][lab]
        fp = sum(confusion[o][lab] for o in LABELS if o != lab)
        fn = sum(confusion[lab][o] for o in LABELS if o != lab)
        p = tp / (tp + fp) if tp + fp else 0.0
        r = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * p * r / (p + r) if p + r else 0.0
        out[lab] = {
            "precision": round(p, 4),
            "recall": round(r, 4),
            "f1": round(f1, 4),
            "support": tp + fn,
        }
    return out


def evaluate(records: list[dict]) -> dict:
    confusion: dict[str, Counter] = defaultdict(Counter)
    frames_total = frames_missing = 0
    clip_ok: list[bool] = []
    by_subject: dict[str, list[bool]] = defaultdict(list)
    by_lighting: dict[str, list[bool]] = defaultdict(list)
    latencies: list[float] = []
    stability: dict[str, dict[str, list[float]]] = {
        f: {"jitter": [], "false_starts": []} for f in FILTERS
    }

    for rec in records:
        label = rec["label"]
        frames = rec["frames"]
        aspect = float(rec.get("aspect", 1.0))
        results = replay(frames, aspect, "one-euro")
        for r in results:
            frames_total += 1
            if r.raw is None:
                frames_missing += 1
                continue
            confusion[label][r.raw] += 1

        actives = [r.active for r in results]
        decided = Counter(actives[len(actives) // 3 :]).most_common(1)[0][0] if actives else "NONE"
        ok = decided == label
        clip_ok.append(ok)
        by_subject[rec["subject_id"]].append(ok)
        by_lighting[rec["lighting"]].append(ok)

        if label != "NONE":
            t0 = frames[0]["t"] if frames else 0
            first = next(
                (
                    e.t_ms
                    for r in results
                    for e in r.events
                    if e.phase == "start" and e.type == label
                ),
                None,
            )
            if first is not None:
                latencies.append(first - t0)

        for fname in FILTERS:
            res = replay(frames, aspect, fname)
            starts = [e for r in res for e in r.events if e.phase == "start"]
            expected_starts = 0 if label == "NONE" else 1
            stability[fname]["false_starts"].append(max(0, len(starts) - expected_starts))
            pos = [e.position for r in res for e in r.events if e.phase == "hold"]
            if len(pos) > 2:
                sx = statistics.pstdev(p[0] for p in pos)
                sy = statistics.pstdev(p[1] for p in pos)
                stability[fname]["jitter"].append((sx**2 + sy**2) ** 0.5)

    per_label = prf(confusion)
    classified = sum(sum(c.values()) for c in confusion.values())
    correct = sum(confusion[lab][lab] for lab in LABELS)

    def acc(v: list[bool]) -> float:
        return round(sum(v) / len(v), 4) if v else 0.0

    return {
        "clips": len(records),
        "frames": frames_total,
        "frames_without_hand": frames_missing,
        "frame_accuracy": round(correct / classified, 4) if classified else 0.0,
        "macro_f1": round(sum(v["f1"] for v in per_label.values()) / len(LABELS), 4),
        "per_label": per_label,
        "confusion": {lab: {o: confusion[lab][o] for o in LABELS} for lab in LABELS},
        "clip_accuracy": acc(clip_ok),
        "by_subject": {k: acc(v) for k, v in sorted(by_subject.items())},
        "by_lighting": {k: acc(v) for k, v in sorted(by_lighting.items())},
        "decision_latency_ms": {
            "p50": round(statistics.median(latencies), 1) if latencies else None,
            "p95": round(sorted(latencies)[int(0.95 * (len(latencies) - 1))], 1)
            if latencies
            else None,
            "n": len(latencies),
        },
        "stability": {
            f: {
                "jitter_mean": round(statistics.fmean(s["jitter"]), 6) if s["jitter"] else None,
                "false_starts_per_clip": round(statistics.fmean(s["false_starts"]), 4)
                if s["false_starts"]
                else None,
            }
            for f, s in stability.items()
        },
    }


def to_markdown(report: dict, source: str, inputs: list[str]) -> str:
    r = report
    lines = [
        "# Gesture Evaluation",
        "",
        f"- 데이터: **{source}** ({', '.join(inputs)})",
        f"- 클립 {r['clips']}개, 프레임 {r['frames']}개 (손 없음 {r['frames_without_hand']})",
        f"- 프레임 정확도 **{r['frame_accuracy']:.3f}**, Macro F1 **{r['macro_f1']:.3f}**, 클립 정확도 **{r['clip_accuracy']:.3f}**",
        f"- 판정 지연 p50 {r['decision_latency_ms']['p50']} ms, p95 {r['decision_latency_ms']['p95']} ms (n={r['decision_latency_ms']['n']})",
        "",
        "## 라벨별",
        "",
        "| 라벨 | Precision | Recall | F1 | 프레임 수 |",
        "|---|---|---|---|---|",
    ]
    lines += [
        f"| {k} | {v['precision']:.3f} | {v['recall']:.3f} | {v['f1']:.3f} | {v['support']} |"
        for k, v in r["per_label"].items()
    ]
    lines += [
        "",
        "## 혼동행렬 (행=정답, 열=예측)",
        "",
        "| | " + " | ".join(LABELS) + " |",
        "|---" * (len(LABELS) + 1) + "|",
    ]
    lines += [
        f"| {k} | " + " | ".join(str(v[o]) for o in LABELS) + " |"
        for k, v in r["confusion"].items()
    ]
    lines += ["", "## 사용자별 / 조명별 클립 정확도", "", "| 구분 | 정확도 |", "|---|---|"]
    lines += [f"| 사용자 {k} | {v:.3f} |" for k, v in r["by_subject"].items()]
    lines += [f"| 조명 {k} | {v:.3f} |" for k, v in r["by_lighting"].items()]
    lines += [
        "",
        "## 필터별 안정성",
        "",
        "| 필터 | 위치 흔들림(표준편차) | 클립당 잘못된 전환 |",
        "|---|---|---|",
    ]
    lines += [
        f"| {k} | {v['jitter_mean']} | {v['false_starts_per_clip']} |"
        for k, v in r["stability"].items()
    ]
    if source == "synthetic":
        lines += ["", "> 합성 데이터 결과다. 실제 웹캠 녹화(`#/record`)로 다시 측정해야 한다."]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("inputs", nargs="*", type=Path)
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "evals" / "reports")
    args = ap.parse_args(argv)
    if args.inputs:
        inputs, source = args.inputs, "recorded"
    else:
        inputs, source = default_inputs()
    report = evaluate(load_records(inputs))
    report["source"] = source
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "gesture-eval.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    md = to_markdown(report, source, [p.name for p in inputs])
    (args.out / "gesture-eval.md").write_text(md, encoding="utf-8", newline="\n")
    print(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
