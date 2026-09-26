"""Copy this app's data from a SQLite database into an empty Postgres one
(e.g. Neon), then verify row counts.

    python -m scripts.migrate_sqlite_to_postgres --source sqlite:////app/data/policy_engine.db \
        --target "$NEON_URL" [--dry-run] [--wipe-target]

- The target schema is created from models.py (create_all), so it is always
  the current schema; only columns that exist in *both* the source table and
  the model are copied (older source DBs may lack newer, nullable columns).
- Refuses to write into a target that already has rows, unless --wipe-target
  (drops and recreates every model table on the target — never the source).
- SQLite never enforced foreign keys; Postgres does. Rows whose FK points at
  a missing parent are reported, and the copy stops before writing anything
  unless --null-orphan-fks is given (then nullable orphan FKs become NULL,
  and rows with a non-nullable orphan FK are skipped and listed).
- The source is only ever read.
"""
import argparse
import os
import sys

from sqlalchemy import Integer, create_engine, func, inspect, select, text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import models  # noqa: E402

BATCH = 500


def _redact(url: str) -> str:
    return url.split("@")[-1] if "@" in url else url


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--target", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--wipe-target", action="store_true")
    ap.add_argument("--null-orphan-fks", action="store_true")
    args = ap.parse_args()

    src = create_engine(args.source)
    dst = create_engine(args.target, pool_pre_ping=True)
    meta = models.Base.metadata
    print(f"source: {_redact(args.source)}\ntarget: {_redact(args.target)}")

    src_tables = set(inspect(src).get_table_names())
    skipped = sorted(src_tables - set(meta.tables) - {"alembic_version"})
    if skipped:
        print("source tables not in models (not copied):", skipped)

    # ── Read everything first (source is small) and check FKs ──
    data = {}
    for table in meta.sorted_tables:
        if table.name not in src_tables:
            data[table.name] = []
            continue
        src_cols = {c["name"] for c in inspect(src).get_columns(table.name)}
        cols = [c for c in table.columns if c.name in src_cols]
        with src.connect() as conn:
            data[table.name] = [dict(r._mapping) for r in conn.execute(select(*cols))]

    pk_sets = {
        t.name: {tuple(r[c.name] for c in t.primary_key.columns) for r in data[t.name]}
        for t in meta.sorted_tables
    }
    problems = []
    for table in meta.sorted_tables:
        kept = []
        for row in data[table.name]:
            drop = False
            for fk in table.foreign_keys:
                col, parent = fk.parent, fk.column
                val = row.get(col.name)
                if val is None or parent.table.name not in pk_sets:
                    continue
                if (val,) in pk_sets[parent.table.name] or len(parent.table.primary_key.columns) != 1:
                    continue
                problems.append(f"{table.name}.{col.name}={val!r} -> missing {parent.table.name}")
                if args.null_orphan_fks and col.nullable:
                    row[col.name] = None
                elif args.null_orphan_fks:
                    drop = True
            if not drop:
                kept.append(row)
        data[table.name] = kept
    if problems:
        print(f"{len(problems)} orphan foreign key value(s):")
        for p in problems[:50]:
            print("  ", p)
        if not args.null_orphan_fks:
            print("Stopping before any write. Re-run with --null-orphan-fks to null/skip them.")
            return 2

    total = sum(len(v) for v in data.values())
    print(f"rows to copy: {total} across {sum(1 for v in data.values() if v)} tables")
    if args.dry_run:
        for name, rows in data.items():
            if rows:
                print(f"  {name}: {len(rows)}")
        return 0

    # ── Target: empty check / wipe, create schema ──
    existing = set(inspect(dst).get_table_names())
    if existing & set(meta.tables):
        with dst.connect() as conn:
            nonempty = [t for t in meta.sorted_tables if t.name in existing
                        and conn.execute(select(func.count()).select_from(t)).scalar()]
        if nonempty and not args.wipe_target:
            print("Target already has data in:", [t.name for t in nonempty], "— refusing (use --wipe-target).")
            return 3
        if args.wipe_target:
            meta.drop_all(dst)
            print("target tables dropped")
    meta.create_all(dst)

    # ── Copy in FK order, one transaction ──
    with dst.begin() as conn:
        for table in meta.sorted_tables:
            rows = data[table.name]
            for i in range(0, len(rows), BATCH):
                conn.execute(table.insert(), rows[i:i + BATCH])
            if rows:
                print(f"  {table.name}: {len(rows)}")
        # Integer autoincrement PKs: move sequences past the copied ids.
        for table in meta.sorted_tables:
            for col in table.primary_key.columns:
                if col.autoincrement is not False and isinstance(col.type, Integer) and data[table.name]:
                    conn.execute(text(
                        f"SELECT setval(pg_get_serial_sequence('{table.name}', '{col.name}'), "
                        f"(SELECT COALESCE(MAX({col.name}), 1) FROM {table.name}))"
                    ))

    # ── Verify ──
    bad = []
    with dst.connect() as conn:
        for table in meta.sorted_tables:
            n = conn.execute(select(func.count()).select_from(table)).scalar()
            if n != len(data[table.name]):
                bad.append((table.name, len(data[table.name]), n))
    if bad:
        print("COUNT MISMATCH:", bad)
        return 4
    print(f"verified: {total} rows copied, counts match on every table")
    return 0


if __name__ == "__main__":
    sys.exit(main())
