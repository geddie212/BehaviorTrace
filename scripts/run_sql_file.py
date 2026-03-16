"""
Run a local .sql file against the Supabase Postgres database.

Usage:
  python scripts/run_sql_file.py SQL_commands/my_script.sql

Environment:
  - Reads .env from the repo root
  - Requires one of:
      DATABASE_URL
      SUPABASE_DB_URL
      SUPABASE_POSTGRES_URL

Optional fallback env vars:
  - SUPABASE_DB_HOST
  - SUPABASE_DB_PORT
  - SUPABASE_DB_NAME
  - SUPABASE_DB_USER
  - SUPABASE_DB_PASSWORD

Notes:
  - This executes raw SQL directly on Postgres.
  - The Supabase service-role key is not enough for raw SQL by itself.
  - Keep database credentials private.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv

try:
    import psycopg
except ImportError as exc:  # pragma: no cover - import error path
    raise SystemExit(
        "Missing dependency: psycopg\n"
        "Install it with: pip install psycopg[binary] python-dotenv"
    ) from exc


REPO_ROOT = Path(__file__).resolve().parents[1]


def load_environment() -> None:
    """Load environment variables from the repo root .env file."""
    load_dotenv(REPO_ROOT / ".env")


def build_database_url() -> str:
    """
    Resolve the database URL from common env var names.

    Returns:
      A PostgreSQL connection URL.
    """
    for key in ("DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_POSTGRES_URL"):
        value = os.getenv(key)
        if value:
            return value

    host = os.getenv("SUPABASE_DB_HOST")
    port = os.getenv("SUPABASE_DB_PORT", "5432")
    name = os.getenv("SUPABASE_DB_NAME", "postgres")
    user = os.getenv("SUPABASE_DB_USER", "postgres")
    password = os.getenv("SUPABASE_DB_PASSWORD")

    if host and password:
        return (
            f"postgresql://{quote_plus(user)}:{quote_plus(password)}"
            f"@{host}:{port}/{name}"
        )

    raise RuntimeError(
        "No database connection string found.\n"
        "Add one of these to .env:\n"
        "  DATABASE_URL\n"
        "  SUPABASE_DB_URL\n"
        "  SUPABASE_POSTGRES_URL\n\n"
        "Or provide the component vars:\n"
        "  SUPABASE_DB_HOST, SUPABASE_DB_PORT, SUPABASE_DB_NAME,\n"
        "  SUPABASE_DB_USER, SUPABASE_DB_PASSWORD\n\n"
        "The current .env service-role key can create rows through the Supabase API,\n"
        "but raw SQL files need a direct Postgres connection."
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Execute a local SQL file on Supabase Postgres.")
    parser.add_argument("sql_file", help="Path to a .sql file")
    return parser.parse_args()


def resolve_sql_path(sql_file_arg: str) -> Path:
    sql_path = Path(sql_file_arg)
    if not sql_path.is_absolute():
        sql_path = REPO_ROOT / sql_path

    sql_path = sql_path.resolve()

    if not sql_path.exists():
        raise FileNotFoundError(f"SQL file not found: {sql_path}")
    if sql_path.suffix.lower() != ".sql":
        raise ValueError(f"Expected a .sql file, got: {sql_path.name}")

    return sql_path


def execute_sql_file(sql_path: Path, database_url: str) -> None:
    sql_text = sql_path.read_text(encoding="utf-8")

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql_text)
        connection.commit()


def main() -> int:
    load_environment()
    args = parse_args()

    try:
        sql_path = resolve_sql_path(args.sql_file)
        database_url = build_database_url()
        execute_sql_file(sql_path, database_url)
    except Exception as error:  # pragma: no cover - CLI error path
        print(f"Error: {error}", file=sys.stderr)
        return 1

    print(f"Executed SQL successfully: {sql_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
