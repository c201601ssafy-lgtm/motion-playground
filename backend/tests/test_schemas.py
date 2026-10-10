import json

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from app.core.config import REPO_ROOT

SCHEMAS = REPO_ROOT / "schemas"
EVALS = REPO_ROOT / "evals"


def _schema(name: str) -> Draft202012Validator:
    schema = json.loads((SCHEMAS / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def _jsonl(name: str) -> list[dict]:
    lines = (EVALS / name).read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


@pytest.mark.parametrize(
    ("schema", "sample"),
    [
        ("gesture-event.schema.json", "gesture-events-sample.jsonl"),
        ("gesture-record.schema.json", "gesture-records-sample.jsonl"),
    ],
)
def test_samples_conform(schema: str, sample: str) -> None:
    validator = _schema(schema)
    items = _jsonl(sample)
    assert items
    for item in items:
        validator.validate(item)


def test_event_schema_rejects_none_gesture() -> None:
    validator = _schema("gesture-event.schema.json")
    event = _jsonl("gesture-events-sample.jsonl")[0] | {"type": "NONE"}
    assert not validator.is_valid(event)
