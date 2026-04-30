from fastapi import APIRouter
from schemas.models import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health_check():
    return HealthResponse()
