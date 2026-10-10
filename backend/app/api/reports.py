"""평가 리포트 조회 (실험 결과 화면용). 정해진 파일만 읽는다."""

import json
from typing import Any

from fastapi import APIRouter

from app.core.config import REPO_ROOT

router = APIRouter()

REPORTS_DIR = REPO_ROOT / "evals" / "reports"
REPORT_FILES = {
    "gesture": "gesture-eval.json",
    "tool_calls_mock": "tool-calls-mock.json",
    "tool_calls_ollama": "tool-calls-ollama.json",
    "tool_calls_ollama_baseline": "tool-calls-ollama-baseline.json",
}


@router.get("/reports")
def read_reports() -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, name in REPORT_FILES.items():
        path = REPORTS_DIR / name
        if not path.is_file():
            out[key] = None
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        # 결과 화면에는 요약만 보낸다 (도구 호출 리포트의 케이스별 답변 전문은 제외)
        if "summary" in data:
            data = {
                "provider": data.get("provider"),
                "summary": data["summary"],
                "cases": [
                    {
                        "id": r["id"],
                        "tool_selected": r["tool_selected"],
                        "args_ok": r["args_ok"],
                        "facts_ok": r["facts_ok"],
                        "warnings": r["warnings"],
                    }
                    for r in data.get("results", [])
                ],
            }
        out[key] = data
    return out
