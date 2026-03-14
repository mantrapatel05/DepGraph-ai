"""
FastAPI auth service.
Exposes users via REST API — the boundary between Python backend and TypeScript frontend.
"""
from fastapi import FastAPI, HTTPException, Depends
from typing import List
from sqlalchemy.orm import Session
from .models import User
from .schemas import UserResponse, UserCreate

app = FastAPI(title="Auth Service")


@app.get("/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: int):
    """
    Returns UserResponse which includes user_email.
    TypeScript client maps user_email → userEmail.
    """
    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.post("/users", response_model=UserResponse)
async def create_user(data: UserCreate):
    """Create a new user with user_email."""
    user = User(
        user_email=data.user_email,
        full_name=data.full_name
    )
    return user


@app.get("/users", response_model=List[UserResponse])
async def list_users():
    """List all users. Returns list of UserResponse objects."""
    return await User.all()


@app.delete("/users/{user_id}")
async def delete_user(user_id: int):
    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await user.delete()
    return {"message": f"User {user.user_email} deleted"}
