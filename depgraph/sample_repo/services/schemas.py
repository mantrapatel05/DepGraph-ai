"""
Pydantic schemas for API serialization.
user_email here SERIALIZES_TO userEmail in TypeScript via snake_to_camel convention.
"""
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


class UserResponse(BaseModel):
    """
    Pydantic response model. When serialized to JSON:
      user_email → "user_email" key in JSON payload
    TypeScript client reads this as userEmail (camelCase convention).
    """
    id: int
    user_email: str          # ← SERIALIZES_TO types.ts::UserDTO::userEmail
    full_name: Optional[str] = None
    created_at: Optional[datetime] = None
    is_active: bool = True

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    user_email: str
    full_name: Optional[str] = None


class SessionResponse(BaseModel):
    session_token: str
    user_id: int
    expires_at: datetime
