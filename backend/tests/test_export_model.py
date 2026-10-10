import json

from app.core.config import REPO_ROOT
from app.core.model_loader import load_model


def test_static_model_json_is_up_to_date() -> None:
    """frontend/public/models/gearbox.json 이 YAML과 같아야 한다. 다르면 scripts/export_model.py 실행."""
    static = json.loads(
        (REPO_ROOT / "frontend" / "public" / "models" / "gearbox.json").read_text(encoding="utf-8")
    )
    model = load_model(REPO_ROOT / "models" / "gearbox")
    assert static == model.model_dump(mode="json")
