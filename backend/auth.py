from typing import Optional
from fastapi import Header, HTTPException
from database import supabase


def _verify_token(token: str) -> str:
    try:
        response = supabase.auth.get_user(token)
        return response.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_optional_user(authorization: Optional[str] = Header(None)) -> Optional[str]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return _verify_token(authorization[7:])
    except HTTPException:
        return None


def get_required_user(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    return _verify_token(authorization[7:])
