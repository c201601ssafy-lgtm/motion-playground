"""모델 YAML → frontend/public/models/<id>.json.

백엔드 없이 배포되는 정적 사이트(GitHub Pages)에서 3D 보기용 폴백으로 쓴다.
조립 판정은 여전히 백엔드가 필요하다. 실행: uv run python scripts/export_model.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import REPO_ROOT  # noqa: E402
from app.core.model_loader import load_model  # noqa: E402

OUT_DIR = REPO_ROOT / "frontend" / "public" / "models"


def export(model_id: str = "gearbox") -> Path:
    model = load_model(REPO_ROOT / "models" / model_id)
    out = OUT_DIR / f"{model_id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(model.model_dump(mode="json"), ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    return out


if __name__ == "__main__":
    print(export(*sys.argv[1:]))
