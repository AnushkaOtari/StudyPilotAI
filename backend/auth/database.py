from functools import lru_cache
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, sessionmaker


DATABASE_URL = "sqlite:///./studypilot.db"
Base = declarative_base()


@lru_cache
def get_engine() -> Engine:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
    __import__("auth.models")
    Base.metadata.create_all(bind=engine)
    return engine


def get_session_local() -> sessionmaker:
    return sessionmaker(autocommit=False, autoflush=False, bind=get_engine())


def get_db() -> Generator:
    db = get_session_local()()
    try:
        yield db
    finally:
        db.close()
