-- ============================================================================
-- CollabBoard Supabase Schema
-- Run this script in the Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_locked BOOLEAN DEFAULT FALSE,
  auto_lock_enabled BOOLEAN DEFAULT FALSE,
  canvas_state JSONB DEFAULT '[]'::jsonb,
  media_elements JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast ordering by creation time
CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON public.rooms (created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- Allow server backend (Service Role or Anon Key) full access to rooms
CREATE POLICY "Allow full access for server backend" ON public.rooms
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Insert the default seed room if table is empty
INSERT INTO public.rooms (id, name, password_hash, is_locked, auto_lock_enabled, canvas_state, media_elements)
VALUES (
  'main-board',
  'Main Collaboration Room',
  '$2a$10$XtLSk.Hgjidx14mKSiYjX.tUbJ3wMD431bKMSqKM9I0dkATXww/yy',
  false,
  false,
  '[]'::jsonb,
  '[]'::jsonb
)
ON CONFLICT (id) DO NOTHING;
