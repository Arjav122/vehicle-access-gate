import asyncio
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.services.alert_service import run_visitor_overstay_checks
from app.services.email_service import send_admin_alert_email

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _overstay_job() -> None:
    db: Session = SessionLocal()
    try:
        ids = run_visitor_overstay_checks(db)
        if ids:
            body = (
                f"Visitor overstay alerts processed for {len(ids)} visitor(s). "
                f"IDs: {', '.join(str(i) for i in ids)}"
            )
            asyncio.run(
                send_admin_alert_email(
                    subject="[Vehicle Access] Visitor overstay alert",
                    body=body,
                )
            )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Overstay job failed: %s", exc)
    finally:
        db.close()


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    settings = get_settings()
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        _overstay_job,
        "interval",
        seconds=max(15, settings.visitor_overstay_check_cron_seconds),
        id="visitor_overstay",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("APScheduler started (visitor overstay checks).")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
