from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Admin

security = HTTPBearer(auto_error=False)


def get_db_session() -> Session:
    raise RuntimeError("Use Depends(get_db)")


def get_current_admin(
    db: Annotated[Session, Depends(get_db)],
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
) -> Admin:
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    settings = get_settings()
    try:
        payload = jwt.decode(
            creds.credentials,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status_code=401, detail="Invalid token")
        admin_id = UUID(sub)
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token") from None

    admin = db.scalar(select(Admin).where(Admin.id == admin_id, Admin.is_active.is_(True)))
    if not admin:
        raise HTTPException(status_code=401, detail="Admin not found")
    return admin
