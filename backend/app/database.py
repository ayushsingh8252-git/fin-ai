from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import settings

_is_sqlite = "sqlite" in settings.DATABASE_URL

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    # Managed Postgres (Neon) suspends idle compute and closes idle
    # connections server-side; without a pre-ping the first request after an
    # idle spell fails on a dead pooled connection ("SSL connection has been
    # closed unexpectedly"). Recycle stays under the provider's idle cutoff.
    **({} if _is_sqlite else {"pool_pre_ping": True, "pool_recycle": 240, "pool_size": 5, "max_overflow": 5}),
)

if _is_sqlite:
    # Default SQLite journal mode locks the whole file for the duration of a
    # write, which used to be fine when ingestion ran on in-process threads
    # sharing this same process's connections. Now that ingestion runs in a
    # separate celery-worker container/process (see worker.py + Celery
    # dispatch in api/upload.py), two independent OS processes write this
    # same file concurrently — WAL mode lets readers and a writer proceed
    # without blocking each other, which is the standard fix for exactly
    # this multi-process-writer pattern.
    @event.listens_for(engine, "connect")
    def _set_sqlite_wal(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
