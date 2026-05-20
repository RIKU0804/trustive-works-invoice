import hmac

from fastapi import Header, HTTPException, status

from .config import settings


def verify_api_key(x_api_key: str = Header(..., alias="X-API-Key")) -> str:
    # 定数時間比較でタイミング攻撃を防ぐ
    if not hmac.compare_digest(x_api_key, settings.api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
    return x_api_key
