import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.api.v1.router import api_router
from app.config import clear_settings_cache, get_settings
from app.db import SessionLocal
from app.models import Admin
from app.services.scheduler_service import start_scheduler, stop_scheduler
from app.utils.security import hash_password

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _run_migrations() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    os.chdir(backend_root)
    ini = backend_root / "alembic.ini"
    cfg = Config(str(ini))
    command.upgrade(cfg, "head")
    logger.info("Alembic migrations applied (head).")


def _ensure_admin() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        email = settings.admin_email.lower().strip()
        existing = db.scalar(select(Admin).where(Admin.email == email))
        if existing:
            return
        db.add(
            Admin(
                email=email,
                hashed_password=hash_password(settings.admin_password),
                full_name="System Administrator",
                is_active=True,
            )
        )
        db.commit()
        logger.info("Bootstrap admin created for %s", email)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    clear_settings_cache()
    settings = get_settings()
    if settings.run_startup_db_setup:
        try:
            await asyncio.to_thread(_run_migrations)
        except Exception:
            logger.exception(
                "Alembic migrations failed. Fix DATABASE_URL, then run from backend folder: "
                "alembic upgrade head"
            )
        try:
            await asyncio.to_thread(_ensure_admin)
        except Exception:
            logger.exception(
                "Admin bootstrap failed (often because migrations did not run). "
                "Check DATABASE_URL and logs above."
            )
    else:
        logger.warning("RUN_STARTUP_DB_SETUP=false — skipping migrations and admin bootstrap.")
    try:
        start_scheduler()
    except Exception:
        logger.exception("Scheduler failed to start.")
    yield
    stop_scheduler()


app = FastAPI(
    title="AI Vehicle Access Management System",
    version="1.0.0",
    lifespan=lifespan,
)


@app.exception_handler(OperationalError)
async def db_operational_error_handler(_: Request, __: OperationalError) -> JSONResponse:
    """Avoid opaque 500s when Postgres is unreachable (wrong DATABASE_URL, VPN, etc.)."""
    logger.exception("Database operational error")
    return JSONResponse(
        status_code=503,
        content={
            "detail": (
                "Database unavailable: cannot reach Postgres. "
                "In the repo root .env set DATABASE_URL to your Supabase URI (Settings - Database). "
                "Use sslmode=require. If the direct host fails DNS, try the connection pooler URL. "
                "Restart the API after changes."
            )
        },
    )


@app.exception_handler(ProgrammingError)
async def db_programming_error_handler(_: Request, __: ProgrammingError) -> JSONResponse:
    logger.exception("Database schema error")
    return JSONResponse(
        status_code=503,
        content={
            "detail": (
                "Database schema is missing or out of date. From the backend folder run: "
                "alembic upgrade head (with the same DATABASE_URL as the API)."
            )
        },
    )


_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
def health():
    return {"status": "ok", "service": "vehicle-access-api"}
