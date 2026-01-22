#!/usr/bin/env python3
"""
Execute the database schema against Supabase using the service role key.
"""

import json
import urllib.request
import urllib.error
import ssl

SUPABASE_URL = "https://tmvrebdhsjuqiejomodg.supabase.co"
SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtdnJlYmRoc2p1cWllam9tb2RnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTA1Njc2NSwiZXhwIjoyMDg0NjMyNzY1fQ.X9wELYenjjvORnLNFoKp4sarXePEe986f8JCP7RyWYU"

# Full schema SQL
SCHEMA_SQL = """
-- Teams table
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY,
    name TEXT,
    full_name TEXT,
    abbreviation TEXT,
    city TEXT,
    conference TEXT,
    division TEXT
);

-- Players table
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    position TEXT,
    height TEXT,
    weight TEXT,
    jersey_number TEXT,
    team_id INTEGER REFERENCES teams(id),
    is_active BOOLEAN DEFAULT TRUE
);

-- Games table
CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY,
    date DATE,
    datetime TIMESTAMPTZ,
    season INTEGER,
    status TEXT,
    home_team_id INTEGER REFERENCES teams(id),
    visitor_team_id INTEGER REFERENCES teams(id),
    home_team_score INTEGER,
    visitor_team_score INTEGER
);

-- Player game stats table
CREATE TABLE IF NOT EXISTS player_game_stats (
    id BIGSERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id),
    game_id INTEGER REFERENCES games(id),
    minutes TEXT,
    pts INTEGER,
    reb INTEGER,
    ast INTEGER,
    stl INTEGER,
    blk INTEGER,
    turnover INTEGER,
    fg3m INTEGER,
    dk_points DECIMAL(6,2),
    UNIQUE(player_id, game_id)
);

-- Injuries table
CREATE TABLE IF NOT EXISTS injuries (
    id BIGSERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id),
    status TEXT,
    return_date TEXT,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- Game odds table
CREATE TABLE IF NOT EXISTS game_odds (
    id BIGSERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id),
    vendor TEXT,
    spread_home DECIMAL(4,1),
    total DECIMAL(5,1),
    moneyline_home INTEGER,
    moneyline_away INTEGER,
    captured_at TIMESTAMPTZ DEFAULT NOW()
);

-- Player props table
CREATE TABLE IF NOT EXISTS player_props (
    id BIGSERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id),
    player_id INTEGER REFERENCES players(id),
    vendor TEXT,
    prop_type TEXT,
    line_value DECIMAL(5,1),
    over_odds INTEGER,
    under_odds INTEGER,
    captured_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projections table
CREATE TABLE IF NOT EXISTS projections (
    id BIGSERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id),
    game_id INTEGER REFERENCES games(id),
    minutes_proj DECIMAL(4,1),
    dk_proj DECIMAL(5,2),
    dk_floor DECIMAL(5,2),
    dk_ceiling DECIMAL(5,2),
    ownership_proj DECIMAL(5,2),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(player_id, game_id)
);

-- DraftKings salaries table
CREATE TABLE IF NOT EXISTS dk_salaries (
    id BIGSERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id),
    game_id INTEGER REFERENCES games(id),
    salary INTEGER,
    roster_position TEXT,
    UNIQUE(player_id, game_id)
);

-- Lineups table
CREATE TABLE IF NOT EXISTS lineups (
    id BIGSERIAL PRIMARY KEY,
    game_date DATE,
    total_salary INTEGER,
    projected_points DECIMAL(6,2),
    players JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- DraftKings points calculation function
CREATE OR REPLACE FUNCTION calculate_dk_points(
    pts INTEGER,
    reb INTEGER,
    ast INTEGER,
    stl INTEGER,
    blk INTEGER,
    tov INTEGER,
    fg3m INTEGER
) RETURNS DECIMAL(6,2) AS $$
DECLARE
    base_points DECIMAL(6,2);
    double_count INTEGER;
    bonus DECIMAL(6,2);
BEGIN
    base_points := (pts * 1.0) + (reb * 1.25) + (ast * 1.5) +
                   (stl * 2.0) + (blk * 2.0) + (tov * -0.5) + (fg3m * 0.5);
    double_count := 0;
    IF pts >= 10 THEN double_count := double_count + 1; END IF;
    IF reb >= 10 THEN double_count := double_count + 1; END IF;
    IF ast >= 10 THEN double_count := double_count + 1; END IF;
    IF stl >= 10 THEN double_count := double_count + 1; END IF;
    IF blk >= 10 THEN double_count := double_count + 1; END IF;
    bonus := 0;
    IF double_count >= 3 THEN bonus := 3.0;
    ELSIF double_count >= 2 THEN bonus := 1.5;
    END IF;
    RETURN base_points + bonus;
END;
$$ LANGUAGE plpgsql;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_players_team_id ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_players_active ON players(is_active);
CREATE INDEX IF NOT EXISTS idx_games_date ON games(date);
CREATE INDEX IF NOT EXISTS idx_games_home_team ON games(home_team_id);
CREATE INDEX IF NOT EXISTS idx_games_visitor_team ON games(visitor_team_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_player_game_stats_player ON player_game_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_player_game_stats_game ON player_game_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_injuries_player ON injuries(player_id);
CREATE INDEX IF NOT EXISTS idx_injuries_active ON injuries(is_active);
CREATE INDEX IF NOT EXISTS idx_game_odds_game ON game_odds(game_id);
CREATE INDEX IF NOT EXISTS idx_player_props_player ON player_props(player_id);
CREATE INDEX IF NOT EXISTS idx_player_props_game ON player_props(game_id);
CREATE INDEX IF NOT EXISTS idx_projections_player ON projections(player_id);
CREATE INDEX IF NOT EXISTS idx_projections_game ON projections(game_id);
CREATE INDEX IF NOT EXISTS idx_dk_salaries_player ON dk_salaries(player_id);
CREATE INDEX IF NOT EXISTS idx_dk_salaries_game ON dk_salaries(game_id);
CREATE INDEX IF NOT EXISTS idx_lineups_date ON lineups(game_date);
"""

def execute_sql(sql):
    """Execute SQL using Supabase's postgres endpoint."""
    ctx = ssl.create_default_context()

    headers = {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    }

    # Use the query endpoint
    data = json.dumps({'query': sql}).encode('utf-8')

    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/rpc/query',
        data=data,
        headers=headers,
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, context=ctx, timeout=60) as response:
            return {'success': True, 'status': response.status, 'data': response.read().decode()}
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        return {'success': False, 'status': e.code, 'error': error_body}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def check_table(table_name):
    """Check if a table exists."""
    ctx = ssl.create_default_context()
    headers = {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
    }
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/{table_name}?select=*&limit=1',
        headers=headers
    )
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as response:
            return True
    except:
        return False

def main():
    print("=" * 60)
    print("NBA DFS - Executing Schema with Service Role Key")
    print("=" * 60)
    print()

    # First, try to execute the full schema
    print("Attempting to execute schema...")
    result = execute_sql(SCHEMA_SQL)

    if result.get('success'):
        print("Schema execution returned success!")
    else:
        print(f"Direct execution returned: {result.get('status', 'N/A')}")
        if 'error' in result:
            print(f"Response: {result['error'][:500]}")

    print()
    print("Verifying tables...")

    tables = ['teams', 'players', 'games', 'player_game_stats', 'injuries',
              'game_odds', 'player_props', 'projections', 'dk_salaries', 'lineups']

    results = {}
    for table in tables:
        exists = check_table(table)
        results[table] = exists
        status = "✓" if exists else "✗"
        print(f"  {status} {table}")

    print()
    created = sum(1 for v in results.values() if v)
    print(f"Tables verified: {created}/{len(tables)}")

    if created == len(tables):
        print("\nAll tables created successfully!")
    else:
        print("\nSome tables may need to be created manually in the SQL Editor.")

if __name__ == '__main__':
    main()
