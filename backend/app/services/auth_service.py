from datetime import datetime, timedelta, timezone
from uuid import UUID

from jose import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Admin
from app.schemas.auth import Token
from app.utils.security import verify_password


def authenticate_admin(db: Session, email: str, password: str) -> Admin | None:
    normalized = email.lower().strip()
    admin = db.scalar(select(Admin).where(Admin.email == normalized))
    if not admin or not admin.is_active:
        return None
    if not verify_password(password, admin.hashed_password):
        return None
    return admin


def create_access_token(admin_id: UUID) -> Token:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.jwt_access_token_expire_minutes
    )
    payload = {"sub": str(admin_id), "exp": expire}
    token = jwt.encode(
        payload,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    return Token(access_token=token)
