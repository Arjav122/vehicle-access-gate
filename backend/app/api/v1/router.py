from fastapi import APIRouter

from app.api.v1.routes import auth, operations, residents, visitors

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(residents.router)
api_router.include_router(visitors.router)
api_router.include_router(operations.router)
