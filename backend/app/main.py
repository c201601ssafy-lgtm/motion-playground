from fastapi import FastAPI

from app.api import health, models, sessions

app = FastAPI(title="HoloForge AI Lab", version="0.1.0")
app.include_router(health.router, prefix="/api")
app.include_router(models.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
