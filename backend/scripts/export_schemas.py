"""AI 도구 입출력 JSON Schema → schemas/tool-calls.schema.json. 실행: uv run python scripts/export_schemas.py"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import REPO_ROOT  # noqa: E402
from app.tools.registry import TOOLS  # noqa: E402

OUT = REPO_ROOT / "schemas" / "tool-calls.schema.json"


def build() -> dict:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://github.com/jngbnss/holoforge-ai-lab/schemas/tool-calls.schema.json",
        "title": "HoloForge AI tutor tools",
        "description": "AI 튜터가 호출할 수 있는 도구의 입력·출력 스키마 (D-007). backend/app/tools/registry.py 에서 생성.",
        "tools": {
            t.name: {
                "description": t.description,
                "mutates": t.mutates,
                "input": t.input_model.model_json_schema(),
                "output": t.output_model.model_json_schema(),
            }
            for t in TOOLS.values()
        },
    }


if __name__ == "__main__":
    OUT.write_text(
        json.dumps(build(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    print(OUT)
