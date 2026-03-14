"""
SQLAlchemy ORM models.
user_email is mapped directly from the SQL column — MAPS_TO edge (confidence: 1.0)
"""
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()


class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_email = Column(String(255), unique=True, nullable=False)  # ← MAPS_TO schema.sql::users::user_email
    full_name = Column(String(255))
    created_at = Column(DateTime, default=func.now())
    is_active = Column(Boolean, default=True)

    def get_user_email(self) -> str:
        return self.user_email

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.user_email}>"


class Session(Base):
    __tablename__ = 'sessions'

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    session_token = Column(String(512), unique=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=func.now())
