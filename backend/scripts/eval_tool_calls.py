"""AI 튜터 도구 호출 평가 (spec §17, D-009).

입력: evals/tool-call-cases.jsonl
출력: evals/reports/tool-calls-<provider>.json / .md

지표
- 도구 선택률: 기대 도구를 모두 호출했는가 (expected_tools_any 는 그중 하나)
- 인자 정확도: 기대 인자가 일치하는가 (숫자는 값 비교)
- 실행 성공률: 호출한 도구가 오류 없이 실행됐는가
- 미근거 숫자 비율: 답변에 도구 결과에 없는 숫자가 있었던 비율
- 사실 일치율: 답변에 기대 사실(문자열)이 모두 들어 있는가
실행: uv run python scripts/eval_tool_calls.py --provider mock|ollama [--min-selection 0.9]
"""

import argparse
import json
import statistics
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai.mock import MockAdapter  # noqa: E402
from app.ai.ollama import OllamaAdapter  # noqa: E402
from app.ai.provider import FallbackAdapter, LLMSettings  # noqa: E402
from app.ai.tutor import TutorRequest, answer  # noqa: E402
from app.assembly.engine import AssemblyEngine  # noqa: E402
from app.assembly.schemas import AttemptRequest  # noqa: E402
from app.core.config import REPO_ROOT  # noqa: E402
from app.core.db import SessionStore  # noqa: E402
from app.core.model_loader import get_model  # noqa: E402
from app.tools.registry import ToolContext  # noqa: E402

MODEL = get_model("gearbox")


def _place(engine: AssemblyEngine, pid: str, **kw) -> None:
    slot = MODEL.slot_for_part(pid)
    assert slot is not None
    req = {"part_id": pid, "position": slot.position, "yaw_deg": slot.yaw_deg} | kw
    engine.attempt(AttemptRequest(**req))


SCENARIOS = {
    "empty": lambda e: None,
    "base_only": lambda e: _place(e, "base-plate"),
    "two_shafts": lambda e: [_place(e, p) for p in ("base-plate", "shaft-input", "shaft-idler")],
    "wrong_orientation": lambda e: _place(e, "base-plate", yaw_deg=90),
    "missing_parent": lambda e: [_place(e, "base-plate"), _place(e, "gear-input-12t")],
    "complete": lambda e: e.assemble_all(),
}


def setup_session(store: SessionStore, scenario: str) -> str:
    sid = store.create("gearbox")
    store.update(sid, lambda _m, state: SCENARIOS[scenario](AssemblyEngine(MODEL, state)))
    return sid


def args_match(expected: dict, actual: dict) -> bool:
    for k, v in expected.items():
        a = actual.get(k)
        if isinstance(v, int | float) and isinstance(a, int | float):
            if abs(float(a) - float(v)) > 1e-6:
                return False
        elif a != v:
            return False
    return True


def run_case(case: dict, store: SessionStore, adapter) -> dict:
    sid = setup_session(store, case["scenario"])
    ctx = ToolContext(session_id=sid, store=store)
    r = answer(
        TutorRequest(question=case["question"], selected_part=case.get("selected_part")),
        ctx,
        adapter,
    )
    used = [u.name for u in r.used_tools]
    exp = case.get("expected_tools", [])
    any_of = case.get("expected_tools_any", [])
    selected = all(t in used for t in exp) and (not any_of or any(t in used for t in any_of))
    arg_checks = []
    for tool, exp_args in case.get("expected_args", {}).items():
        calls = [u for u in r.used_tools if u.name == tool]
        arg_checks.append(any(args_match(exp_args, u.arguments) for u in calls))
    exec_ok = [("error" not in u.result) for u in r.used_tools]
    facts = case.get("expected_facts", [])
    return {
        "id": case["id"],
        "question": case["question"],
        "used_tools": [{"name": u.name, "arguments": u.arguments} for u in r.used_tools],
        "tool_selected": selected,
        "args_ok": all(arg_checks) if arg_checks else None,
        "exec_success": all(exec_ok) if exec_ok else None,
        "ungrounded": any(w.startswith("UNGROUNDED") for w in r.warnings),
        "facts_ok": all(f in r.answer for f in facts) if facts else None,
        "warnings": r.warnings,
        "answer": r.answer,
        "latency_ms": r.latency_ms,
        "degraded": r.degraded,
    }


def rate(values: list) -> float | None:
    v = [x for x in values if x is not None]
    return round(sum(1 for x in v if x) / len(v), 4) if v else None


def summarize(results: list[dict]) -> dict:
    lat = [r["latency_ms"] for r in results]
    return {
        "cases": len(results),
        "tool_selection_rate": rate([r["tool_selected"] for r in results]),
        "argument_accuracy": rate([r["args_ok"] for r in results]),
        "execution_success_rate": rate([r["exec_success"] for r in results]),
        "ungrounded_answer_rate": rate([r["ungrounded"] for r in results]),
        "fact_match_rate": rate([r["facts_ok"] for r in results]),
        "latency_ms_p50": round(statistics.median(lat), 1) if lat else None,
        "latency_ms_max": round(max(lat), 1) if lat else None,
        "degraded_cases": sum(1 for r in results if r["degraded"]),
    }


def to_markdown(provider: str, summary: dict, results: list[dict]) -> str:
    s = summary
    pct = lambda v: "-" if v is None else f"{v * 100:.0f}%"  # noqa: E731
    lines = [
        f"# Tool-call Evaluation — {provider}",
        "",
        "| 지표 | 값 |",
        "|---|---|",
        f"| 케이스 | {s['cases']} |",
        f"| 도구 선택률 | {pct(s['tool_selection_rate'])} |",
        f"| 인자 정확도 | {pct(s['argument_accuracy'])} |",
        f"| 실행 성공률 | {pct(s['execution_success_rate'])} |",
        f"| 미근거 숫자 답변 비율 | {pct(s['ungrounded_answer_rate'])} |",
        f"| 사실 일치율 | {pct(s['fact_match_rate'])} |",
        f"| 지연 p50 / 최대 | {s['latency_ms_p50']} / {s['latency_ms_max']} ms |",
        f"| 폴백(degraded) | {s['degraded_cases']} |",
        "",
        "| 케이스 | 도구 | 선택 | 인자 | 사실 | 경고 |",
        "|---|---|---|---|---|---|",
    ]
    mark = lambda v: "-" if v is None else ("✅" if v else "❌")  # noqa: E731
    for r in results:
        tools = ", ".join(u["name"] for u in r["used_tools"]) or "(없음)"
        lines.append(
            f"| {r['id']} | {tools} | {mark(r['tool_selected'])} | {mark(r['args_ok'])} | {mark(r['facts_ok'])} | {', '.join(r['warnings'])} |"
        )
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    # Windows 콘솔(cp949)에서도 한국어·기호를 출력할 수 있게
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--provider", choices=["mock", "ollama"], default="mock")
    ap.add_argument("--cases", type=Path, default=REPO_ROOT / "evals" / "tool-call-cases.jsonl")
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "evals" / "reports")
    ap.add_argument(
        "--min-selection", type=float, default=None, help="도구 선택률이 이보다 낮으면 실패(exit 1)"
    )
    args = ap.parse_args(argv)

    cases = [
        json.loads(line)
        for line in args.cases.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if args.provider == "ollama":
        s = LLMSettings()
        make = lambda: FallbackAdapter(  # noqa: E731
            OllamaAdapter(
                s.ollama_base_url, s.ollama_model, timeout_s=max(s.ollama_timeout_s, 120)
            ),
            MockAdapter(),
        )
    else:
        make = MockAdapter

    with tempfile.TemporaryDirectory() as tmp:
        store = SessionStore(Path(tmp) / "eval.sqlite3")
        results = []
        for c in cases:
            results.append(run_case(c, store, make()))
            print(f"  {c['id']}: {[u['name'] for u in results[-1]['used_tools']]}", file=sys.stderr)

    summary = summarize(results)
    args.out.mkdir(parents=True, exist_ok=True)
    stem = f"tool-calls-{args.provider}"
    (args.out / f"{stem}.json").write_text(
        json.dumps(
            {"provider": args.provider, "summary": summary, "results": results},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    md = to_markdown(args.provider, summary, results)
    (args.out / f"{stem}.md").write_text(md, encoding="utf-8", newline="\n")
    print(md)
    if (
        args.min_selection is not None
        and (summary["tool_selection_rate"] or 0) < args.min_selection
    ):
        print(
            f"도구 선택률 {summary['tool_selection_rate']} < {args.min_selection}", file=sys.stderr
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
