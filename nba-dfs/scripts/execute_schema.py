#!/usr/bin/env python3
"""
Execute the database schema against Supabase.
Uses the Supabase SQL execution endpoint.
"""

import os
import json
import urllib.request
import urllib.error
import ssl

# Read environment variables from .env.local
def load_env():
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env.local')
    env_vars = {}
    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                env_vars[key] = value
    return env_vars

def read_schema():
    """Read the SQL schema file."""
    schema_path = os.path.join(os.path.dirname(__file__), '..', 'supabase', 'schema.sql')
    with open(schema_path, 'r') as f:
        return f.read()

def parse_sql_statements(sql):
    """Parse SQL into individual statements, handling functions properly."""
    statements = []
    current = []
    in_function = False

    for line in sql.split('\n'):
        stripped = line.strip()

        # Skip empty lines and standalone comments
        if not stripped or (stripped.startswith('--') and not current):
            continue

        current.append(line)

        # Track function blocks (they contain $$ delimiters)
        if 'CREATE OR REPLACE FUNCTION' in line.upper():
            in_function = True

        if in_function and '$$ LANGUAGE plpgsql;' in stripped:
            in_function = False
            statements.append('\n'.join(current))
            current = []
        elif not in_function and stripped.endswith(';') and '$$' not in stripped:
            statements.append('\n'.join(current))
            current = []

    if current:
        statements.append('\n'.join(current))

    return [s.strip() for s in statements if s.strip() and not s.strip().startswith('--')]

def execute_sql_statement(url, api_key, sql):
    """Execute a single SQL statement using Supabase's query endpoint."""

    # Create SSL context that doesn't verify (for testing)
    ctx = ssl.create_default_context()

    headers = {
        'apikey': api_key,
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }

    # Try the /rest/v1/rpc endpoint with a raw SQL function
    # Note: This requires the function to exist or special permissions

    data = json.dumps({'query': sql}).encode('utf-8')

    req = urllib.request.Request(
        f'{url}/rest/v1/rpc/exec_sql',
        data=data,
        headers=headers,
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as response:
            return {'success': True, 'status': response.status}
    except urllib.error.HTTPError as e:
        return {'success': False, 'status': e.code, 'error': e.read().decode()}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def check_table_exists(url, api_key, table_name):
    """Check if a table exists by trying to query it."""
    ctx = ssl.create_default_context()

    headers = {
        'apikey': api_key,
        'Authorization': f'Bearer {api_key}',
    }

    req = urllib.request.Request(
        f'{url}/rest/v1/{table_name}?select=*&limit=1',
        headers=headers,
        method='GET'
    )

    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as response:
            return True
    except urllib.error.HTTPError as e:
        if e.code == 404 or 'does not exist' in e.read().decode().lower():
            return False
        return False
    except:
        return False

def main():
    print("=" * 60)
    print("NBA DFS Optimizer - Schema Executor")
    print("=" * 60)
    print()

    # Load environment
    env = load_env()
    url = env.get('NEXT_PUBLIC_SUPABASE_URL')
    api_key = env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')

    if not url or not api_key:
        print("ERROR: Missing Supabase credentials in .env.local")
        return 1

    print(f"Supabase URL: {url}")
    print()

    # Check existing tables
    tables = ['teams', 'players', 'games', 'player_game_stats', 'injuries',
              'game_odds', 'player_props', 'projections', 'dk_salaries', 'lineups']

    print("Checking existing tables...")
    existing = []
    missing = []
    for table in tables:
        if check_table_exists(url, api_key, table):
            existing.append(table)
        else:
            missing.append(table)

    print(f"  Existing: {len(existing)} tables")
    print(f"  Missing:  {len(missing)} tables")

    if existing:
        print(f"  Found: {', '.join(existing)}")
    if missing:
        print(f"  Need to create: {', '.join(missing)}")

    print()

    if not missing:
        print("All tables already exist!")
        return 0

    # Read and parse schema
    schema_sql = read_schema()
    statements = parse_sql_statements(schema_sql)
    print(f"Parsed {len(statements)} SQL statements from schema.sql")
    print()

    # The anon key cannot execute DDL statements directly
    # We need to output instructions for manual execution
    print("=" * 60)
    print("IMPORTANT: DDL Execution Required")
    print("=" * 60)
    print()
    print("The Supabase anon key cannot create tables directly.")
    print("Please run the schema SQL in one of these ways:")
    print()
    print("OPTION 1: Supabase Dashboard (Recommended)")
    print("-" * 40)
    print("1. Go to: https://supabase.com/dashboard")
    print("2. Select your project")
    print("3. Click 'SQL Editor' in the sidebar")
    print("4. Click '+ New query'")
    print("5. Paste the SQL below and click 'Run'")
    print()
    print("OPTION 2: Supabase CLI")
    print("-" * 40)
    print("1. Install: npm install -g supabase")
    print("2. Login: supabase login")
    print("3. Link: supabase link --project-ref tmvrebdhsjuqiejomodg")
    print("4. Run: supabase db push")
    print()
    print("=" * 60)
    print("SQL SCHEMA TO EXECUTE:")
    print("=" * 60)
    print()
    print(schema_sql)

    return 0

if __name__ == '__main__':
    exit(main())
