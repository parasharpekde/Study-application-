-- ==========================================================
-- FlowState: Supabase PostgreSQL Schema & Realtime Setup
-- ==========================================================
-- Run this script in your Supabase Project Dashboard -> SQL Editor

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. User Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    daily_goal_seconds INTEGER DEFAULT 18000, -- 5 hours default
    total_focus_seconds BIGINT DEFAULT 0,
    current_streak_days INTEGER DEFAULT 0,
    last_active_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Study Groups Table
CREATE TABLE IF NOT EXISTS public.study_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL, -- e.g. "FLOW-4921"
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT DEFAULT '⚡',
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Group Members Junction Table
CREATE TABLE IF NOT EXISTS public.group_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES public.study_groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(group_id, user_id)
);

-- 5. Focus Sessions Table (Work Logs)
CREATE TABLE IF NOT EXISTS public.focus_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    group_id UUID REFERENCES public.study_groups(id) ON DELETE SET NULL,
    mode TEXT NOT NULL CHECK (mode IN ('pomodoro', 'stopwatch')),
    task_name TEXT NOT NULL,
    tag TEXT NOT NULL DEFAULT '#DeepWork',
    duration_seconds INTEGER NOT NULL,
    completed_work TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Group Challenges Table
CREATE TABLE IF NOT EXISTS public.group_challenges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES public.study_groups(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    target_seconds BIGINT NOT NULL, -- e.g. 72000 (20 hours)
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Live Activity Reactions Table
CREATE TABLE IF NOT EXISTS public.group_reactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES public.focus_sessions(id) ON DELETE CASCADE,
    group_id UUID REFERENCES public.study_groups(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL, -- '🔥', '👏', '⚡', '☕', '🧠'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================================
-- Row Level Security (RLS) Policies
-- ==========================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_reactions ENABLE ROW LEVEL SECURITY;

-- Allow public read & auth write for demo simplicity (can be restricted further per production need)
DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.profiles;
CREATE POLICY "Allow public read access to profiles" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Allow public read access to groups" ON public.study_groups;
CREATE POLICY "Allow public read access to groups" ON public.study_groups FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can create groups" ON public.study_groups;
CREATE POLICY "Authenticated users can create groups" ON public.study_groups FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow public read group members" ON public.group_members;
CREATE POLICY "Allow public read group members" ON public.group_members FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can join groups" ON public.group_members;
CREATE POLICY "Users can join groups" ON public.group_members FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow public read focus sessions" ON public.focus_sessions;
CREATE POLICY "Allow public read focus sessions" ON public.focus_sessions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert focus sessions" ON public.focus_sessions;
CREATE POLICY "Users can insert focus sessions" ON public.focus_sessions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public read challenges" ON public.group_challenges;
CREATE POLICY "Allow public read challenges" ON public.group_challenges FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read reactions" ON public.group_reactions;
CREATE POLICY "Allow public read reactions" ON public.group_reactions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can post reactions" ON public.group_reactions;
CREATE POLICY "Authenticated users can post reactions" ON public.group_reactions FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ==========================================================
-- Enable Supabase Realtime for Multi-player Study Squads
-- ==========================================================
-- Enables broadcasting realtime database events to client subscriptions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'study_groups'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.study_groups;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'focus_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.focus_sessions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_challenges'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_challenges;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_reactions;
  END IF;
END $$;
