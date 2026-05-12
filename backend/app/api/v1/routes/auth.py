from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_admin
from app.models import Admin
from app.schemas.auth import AdminPublic, LoginRequest, Token
from app.services.auth_service import authenticate_admin, create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(body: LoginRequest, db: Annotated[Session, Depends(get_db)]) -> Token:
    admin = authenticate_admin(db, body.email, body.password)
    if not admin:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return create_access_token(admin.id)


@router.get("/me", response_model=AdminPublic)
def me(admin: Annotated[Admin, Depends(get_current_admin)]) -> Admin:
    return admin
