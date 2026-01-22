-- NBA DFS Optimizer Database Schema
-- Run this SQL in Supabase SQL Editor to create all required tables

-- ============================================
-- TEAMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY,
    name TEXT,
    full_name TEXT,
    abbreviation TEXT,
    city TEXT,
    conference TEXT,
    division TEXT
);

-- ============================================
-- PLAYERS TABLE
-- ============================================
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

-- ============================================
-- GAMES TABLE
-- ============================================
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

-- ============================================
-- PLAYER GAME STATS TABLE
-- ============================================
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

-- ============================================
-- INJURIES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS injuries (
    id BIGSERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id),
    status TEXT,
    return_date TEXT,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- ============================================
-- GAME ODDS TABLE
-- ============================================
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

-- ============================================
-- PLAYER PROPS TABLE
-- ============================================
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

-- ============================================
-- PROJECTIONS TABLE
-- ============================================
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

-- ============================================
-- DRAFTKINGS SALARIES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS dk_salaries (
    id BIGSERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id),
    game_id INTEGER REFERENCES games(id),
    salary INTEGER,
    roster_position TEXT,
    UNIQUE(player_id, game_id)
);

-- ============================================
-- LINEUPS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS lineups (
    id BIGSERIAL PRIMARY KEY,
    game_date DATE,
    total_salary INTEGER,
    projected_points DECIMAL(6,2),
    players JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- DRAFTKINGS POINTS CALCULATION FUNCTION
-- ============================================
-- Scoring:
--   PTS = 1 point
--   REB = 1.25 points
--   AST = 1.5 points
--   STL = 2 points
--   BLK = 2 points
--   TOV = -0.5 points
--   3PM = 0.5 points
-- Bonuses:
--   Double-double = 1.5 bonus
--   Triple-double = 3 bonus (replaces double-double bonus)

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
    -- Calculate base points
    base_points := (pts * 1.0) +
                   (reb * 1.25) +
                   (ast * 1.5) +
                   (stl * 2.0) +
                   (blk * 2.0) +
                   (tov * -0.5) +
                   (fg3m * 0.5);

    -- Count categories with 10+ for double-double/triple-double
    -- Categories: points, rebounds, assists, steals, blocks
    double_count := 0;
    IF pts >= 10 THEN double_count := double_count + 1; END IF;
    IF reb >= 10 THEN double_count := double_count + 1; END IF;
    IF ast >= 10 THEN double_count := double_count + 1; END IF;
    IF stl >= 10 THEN double_count := double_count + 1; END IF;
    IF blk >= 10 THEN double_count := double_count + 1; END IF;

    -- Calculate bonus (triple-double overrides double-double)
    bonus := 0;
    IF double_count >= 3 THEN
        bonus := 3.0;  -- Triple-double bonus
    ELSIF double_count >= 2 THEN
        bonus := 1.5;  -- Double-double bonus
    END IF;

    RETURN base_points + bonus;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- INDEXES FOR BETTER QUERY PERFORMANCE
-- ============================================
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
