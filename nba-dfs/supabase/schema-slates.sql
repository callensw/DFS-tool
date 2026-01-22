-- DraftKings Slates Schema Update
-- Run this in Supabase SQL Editor to add slate support

-- ============================================
-- DRAFTKINGS SLATES TABLE
-- ============================================
-- Stores slate/contest info from DraftKings
CREATE TABLE IF NOT EXISTS dk_slates (
    id BIGSERIAL PRIMARY KEY,
    dk_draft_group_id INTEGER UNIQUE NOT NULL,
    name TEXT,
    game_count INTEGER,
    start_time TIMESTAMPTZ,
    start_time_suffix TEXT,  -- e.g., "6:00PM ET", "7:00PM ET"
    game_type TEXT,          -- "Classic", "Showdown", etc.
    sport TEXT DEFAULT 'NBA',
    games JSONB,             -- Array of game info from DK
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- UPDATE DK_SALARIES TABLE
-- ============================================
-- Add slate reference and DK-specific fields
ALTER TABLE dk_salaries
ADD COLUMN IF NOT EXISTS slate_id BIGINT REFERENCES dk_slates(id),
ADD COLUMN IF NOT EXISTS dk_player_id INTEGER,
ADD COLUMN IF NOT EXISTS name_id TEXT,
ADD COLUMN IF NOT EXISTS team TEXT;

-- Update unique constraint to be per-slate instead of per-game
-- First drop the old constraint if it exists
ALTER TABLE dk_salaries DROP CONSTRAINT IF EXISTS dk_salaries_player_id_game_id_key;

-- Add new unique constraint for player per slate
ALTER TABLE dk_salaries ADD CONSTRAINT dk_salaries_player_slate_unique
UNIQUE (dk_player_id, slate_id);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_dk_slates_draft_group ON dk_slates(dk_draft_group_id);
CREATE INDEX IF NOT EXISTS idx_dk_slates_start_time ON dk_slates(start_time);
CREATE INDEX IF NOT EXISTS idx_dk_salaries_slate ON dk_salaries(slate_id);
CREATE INDEX IF NOT EXISTS idx_dk_salaries_dk_player ON dk_salaries(dk_player_id);
