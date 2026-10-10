from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HOLOFORGE_", env_file=".env", extra="ignore")

    db_path: Path = Path("holoforge.sqlite3")
    models_dir: Path = REPO_ROOT / "models"


settings = Settings()
