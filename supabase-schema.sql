-- Supabase Schema for TCGP (Pokémon TCG Collection Game)
-- This schema mirrors the Firebase Firestore structure

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create players table (equivalent to Firebase 'players' collection)
CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
    email TEXT NOT NULL,
    role TEXT DEFAULT 'player' CHECK (role IN ('player', 'vip', 'admin')),
    collection JSONB DEFAULT '[]'::jsonb,
    packs_by_gen JSONB DEFAULT '{}'::jsonb,
    last_draw_time BIGINT DEFAULT 0,
    available_packs INTEGER DEFAULT 3,
    points INTEGER DEFAULT 0,
    bonus_packs INTEGER DEFAULT 0,
    current_booster JSONB DEFAULT '[]'::jsonb,
    booster_revealed_cards JSONB DEFAULT '[]'::jsonb,
    notifications_enabled BOOLEAN DEFAULT false,
    admin_notification JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create sessions table (equivalent to Firebase 'sessions' collection)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    email TEXT NOT NULL,
    session_id TEXT NOT NULL,
    last_ping BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);
CREATE INDEX IF NOT EXISTS idx_players_role ON players(role);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_players_updated_at ON players;
CREATE TRIGGER update_players_updated_at
    BEFORE UPDATE ON players
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_sessions_updated_at ON sessions;
CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own player data" ON players;
DROP POLICY IF EXISTS "Users can update their own player data" ON players;
DROP POLICY IF EXISTS "Users can insert their own player data" ON players;
DROP POLICY IF EXISTS "Admins can view all player data" ON players;
DROP POLICY IF EXISTS "Admins can update all player data" ON players;
DROP POLICY IF EXISTS "Admins can delete player data" ON players;
DROP POLICY IF EXISTS "Users can view their own session" ON sessions;
DROP POLICY IF EXISTS "Users can update their own session" ON sessions;
DROP POLICY IF EXISTS "Users can insert their own session" ON sessions;
DROP POLICY IF EXISTS "Users can delete their own session" ON sessions;

-- RLS Policies for players table
-- Users can view their own data
CREATE POLICY "Users can view their own player data"
    ON players FOR SELECT
    USING (auth.uid() = user_id);

-- Users can update their own data (but cannot change role unless admin)
CREATE POLICY "Users can update their own player data"
    ON players FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id
        AND (
            -- Non-admins cannot change their role
            role = (SELECT role FROM players WHERE user_id = auth.uid())
            OR EXISTS (
                SELECT 1 FROM players
                WHERE user_id = auth.uid()
                AND role = 'admin'
            )
        )
    );

-- Users can insert their own data (only as 'player' role unless they are admin)
CREATE POLICY "Users can insert their own player data"
    ON players FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND (
            -- Non-admins may only insert themselves as 'player'
            role = 'player'
            OR EXISTS (
                SELECT 1 FROM players
                WHERE user_id = auth.uid()
                AND role = 'admin'
            )
        )
    );

-- Admins can view all data
CREATE POLICY "Admins can view all player data"
    ON players FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM players 
            WHERE user_id = auth.uid() 
            AND role = 'admin'
        )
    );

-- Admins can update all data
CREATE POLICY "Admins can update all player data"
    ON players FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM players 
            WHERE user_id = auth.uid() 
            AND role = 'admin'
        )
    );

-- Admins can delete player data
CREATE POLICY "Admins can delete player data"
    ON players FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM players 
            WHERE user_id = auth.uid() 
            AND role = 'admin'
        )
    );

-- RLS Policies for sessions table
CREATE POLICY "Users can view their own session"
    ON sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own session"
    ON sessions FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own session"
    ON sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own session"
    ON sessions FOR DELETE
    USING (auth.uid() = user_id);

-- Create a function to get or create player record
CREATE OR REPLACE FUNCTION get_or_create_player(
    p_user_id UUID,
    p_email TEXT
)
RETURNS UUID AS $$
DECLARE
    player_id UUID;
BEGIN
    -- Try to get existing player
    SELECT id INTO player_id
    FROM players
    WHERE user_id = p_user_id;
    
    -- If not exists, create new player
    IF player_id IS NULL THEN
        INSERT INTO players (user_id, email, role, collection, packs_by_gen, points, bonus_packs)
        VALUES (p_user_id, p_email, 'player', '[]'::jsonb, '{}'::jsonb, 0, 0)
        RETURNING id INTO player_id;
    END IF;
    
    RETURN player_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions (minimal privileges for security)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON players TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO authenticated;
GRANT EXECUTE ON FUNCTION get_or_create_player TO authenticated;

-- Note: Anon users have very limited access through RLS policies
-- Only authenticated users can modify data

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Schema created successfully! Tables: players, sessions';
    RAISE NOTICE 'RLS policies enabled for security';
    RAISE NOTICE 'You can now import your data using the migration script';
END $$;
