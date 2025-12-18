-- Supabase Schema for TCGP (Pokémon TCG Collection Game)
-- This schema mirrors the Firebase Firestore structure

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create players table (equivalent to Firebase 'players' collection)
CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    _id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
    email TEXT NOT NULL,
    role TEXT DEFAULT 'player' CHECK (role IN ('player', 'vip', 'admin')),
    collection JSONB DEFAULT '[]'::jsonb,
    packsbygen JSONB DEFAULT '{}'::jsonb,
    lastdrawtime BIGINT DEFAULT 0,
    availablepacks INTEGER DEFAULT 3,
    points INTEGER DEFAULT 0,
    bonuspacks INTEGER DEFAULT 0,
    currentbooster JSONB DEFAULT '[]'::jsonb,
    boosterrevealedcards JSONB DEFAULT '[]'::jsonb,
    notifications_enabled BOOLEAN DEFAULT false,
    admin_notification JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create sessions table (equivalent to Firebase 'sessions' collection)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    _id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    email TEXT NOT NULL,
    session_id TEXT NOT NULL,
    last_ping BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(_id);
CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);
CREATE INDEX IF NOT EXISTS idx_players_role ON players(role);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(_id);
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
    USING (auth._id() = _id);

-- Users can update their own data (but cannot change role unless admin)
CREATE POLICY "Users can update their own player data"
    ON players FOR UPDATE
    USING (auth._id() = _id)
    WITH CHECK (auth._id() = _id);

-- Users can insert their own data (only as 'player' role unless they are admin)
CREATE POLICY "Users can insert their own player data"
    ON players FOR INSERT
    WITH CHECK (auth._id() = _id AND role = 'player');

-- Admins can view all data
CREATE POLICY "Admins can view all player data"
    ON players FOR SELECT
    USING ((auth.jwt() ->> 'email') = 'bryan.drouet24@gmail.com');

-- Admins can update all data
CREATE POLICY "Admins can update all player data"
    ON players FOR UPDATE
    USING ((auth.jwt() ->> 'email') = 'bryan.drouet24@gmail.com');

-- Admins can delete player data
CREATE POLICY "Admins can delete player data"
    ON players FOR DELETE
    USING ((auth.jwt() ->> 'email') = 'bryan.drouet24@gmail.com');

-- Prevent role changes unless admin via trigger (non-recursive)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
BEGIN
    RETURN (auth.jwt() ->> 'email') = 'bryan.drouet24@gmail.com';
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION prevent_role_change_unless_admin()
RETURNS trigger AS $$
BEGIN
    IF (NEW.role <> OLD.role) AND NOT is_admin() THEN
        RAISE EXCEPTION 'Seul un admin peut modifier le rôle';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_role_change_unless_admin ON players;
CREATE TRIGGER prevent_role_change_unless_admin
    BEFORE UPDATE ON players
    FOR EACH ROW
    EXECUTE FUNCTION prevent_role_change_unless_admin();

-- RLS Policies for sessions table
CREATE POLICY "Users can view their own session"
    ON sessions FOR SELECT
    USING (auth._id() = _id);

CREATE POLICY "Users can update their own session"
    ON sessions FOR UPDATE
    USING (auth._id() = _id);

CREATE POLICY "Users can insert their own session"
    ON sessions FOR INSERT
    WITH CHECK (auth._id() = _id);

CREATE POLICY "Users can delete their own session"
    ON sessions FOR DELETE
    USING (auth._id() = _id);

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
    WHERE _id = p_user_id;
    
    -- If not exists, create new player
    IF player_id IS NULL THEN
        INSERT INTO players (_id, email, role, collection, packsbygen, points, bonuspacks)
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
