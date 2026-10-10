import re

from fastapi import APIRouter, HTTPException

from app.core.model_loader import get_model
from app.core.model_schema import MechanismModel

router = APIRouter()

_MODEL_ID = re.compile(r"^[a-z0-9-]+$")


@router.get("/models/{model_id}")
def read_model(model_id: str) -> MechanismModel:
    if not _MODEL_ID.match(model_id):
        raise HTTPException(status_code=404, detail="model not found")
    try:
        return get_model(model_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="model not found") from None
