import logging
from email.message import EmailMessage

import aiosmtplib

from app.config import get_settings

logger = logging.getLogger(__name__)


async def send_admin_alert_email(subject: str, body: str) -> bool:
    settings = get_settings()
    if not settings.email_address or not settings.email_app_password:
        logger.warning("Email not configured; skipping SMTP send for: %s", subject)
        return False
    admin_email = settings.admin_email
    msg = EmailMessage()
    msg["From"] = settings.email_address
    msg["To"] = admin_email
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.email_address,
            password=settings.email_app_password,
            start_tls=True,
            timeout=30,
        )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to send alert email: %s", exc)
        return False
