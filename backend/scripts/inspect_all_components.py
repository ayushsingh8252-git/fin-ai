import sys
import os
import inspect
import importlib

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath('.'))

from app.agent_tools import registry as agent_registry
from app.mcp import registry as mcp_registry
from app.config import settings
from app import models

agent_registry.ensure_bootstrapped()
catalog = agent_registry.unified_catalog()

print(f"=== TOTAL CATALOG TOOLS: {len(catalog)} ===")

by_conn = {}
for item in catalog:
    conn = item['connector']
    by_conn.setdefault(conn, []).append(item)

for conn, tools in by_conn.items():
    configured = tools[0]['status'] if tools else 'unknown'
    print(f"\nConnector [{conn}] (Status: {configured}, Tools: {len(tools)}):")
    for t in tools:
        tname = t['tool']
        desc = t.get('description', '')[:80]
        req = t.get('input_schema', {}).get('required', [])
        print(f"  - {tname}: req={req} | {desc}...")

print("\n=== CHECKING DATABASE TABLES ===")
from app.database import engine
from sqlalchemy import inspect as sa_inspect
inspector = sa_inspect(engine)
tables = inspector.get_table_names()
print("Database tables in SQLite:", tables)

print("\n=== CHECKING SERVICES ===")
import app.services
service_files = [f[:-3] for f in os.listdir('app/services') if f.endswith('.py') and not f.startswith('__')]
print(f"Found {len(service_files)} service files in app/services:")
for sf in sorted(service_files):
    print(f"  - {sf}")

print("\n=== CHECKING MCP CONNECTORS ===")
mcp_connectors = mcp_registry.all_connectors()
for c in mcp_connectors:
    missing = c.missing_config()
    print(f"  - {c.name} ({c.display_name}): is_configured={c.is_configured()}, missing={missing}")

