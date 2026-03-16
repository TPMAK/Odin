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

-- ============================================================
-- 8. UPDATE search_knowledge_items_hybrid RPC
--    Adds visibility gate so private items never appear in
--    other users' search results.
--
--    Changes from original:
--      1. allowed_items CTE now filters by visibility:
--         - 'friends' items → visible to self + direct friends
--         - 'private' items → visible to owner only
--      2. personal_note stripped for non-friend items
--    Run this in Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION search_knowledge_items_hybrid(
  query_text      TEXT,
  query_embedding vector(1536),
  match_threshold FLOAT,
  max_matches     INT,
  user_id         UUID
)
RETURNS TABLE (
  id                   UUID,
  title                TEXT,
  description          TEXT,
  enriched_description TEXT,
  address              TEXT,
  latitude             NUMERIC,
  longitude            NUMERIC,
  url                  TEXT,
  photo_url            TEXT,
  added_by             UUID,
  added_by_name        TEXT,
  personal_note        TEXT,
  visibility           TEXT,
  trust_level          TEXT,
  combined_score       FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH friend_ids AS (
    -- Direct accepted friendships (bidirectional single-row model)
    SELECT CASE
      WHEN requester_id = user_id THEN receiver_id
      ELSE requester_id
    END AS friend_id
    FROM friendships
    WHERE (requester_id = user_id OR receiver_id = user_id)
      AND status = 'accepted'
  ),
  fof_ids AS (
    -- Friend-of-friend: 2-hop, excluding self and direct friends
    SELECT DISTINCT CASE
      WHEN f.requester_id = fi.friend_id THEN f.receiver_id
      ELSE f.requester_id
    END AS fof_id
    FROM friendships f
    JOIN friend_ids fi ON (f.requester_id = fi.friend_id OR f.receiver_id = fi.friend_id)
    WHERE f.status = 'accepted'
      AND (CASE WHEN f.requester_id = fi.friend_id THEN f.receiver_id ELSE f.requester_id END) != user_id
      AND (CASE WHEN f.requester_id = fi.friend_id THEN f.receiver_id ELSE f.requester_id END)
          NOT IN (SELECT friend_id FROM friend_ids)
  ),
  allowed_items AS (
    -- ── Odin Trust Layer: Visibility gate ─────────────────
    -- Rule 1: Own items — all visibility levels, trust = 'self'
    -- Rule 2: Friends' items — not private, trust = 'friends'
    -- Rule 3: FOF items — friends-visibility only, trust = 'extended_circle'
    -- Rule 4: Strangers' items — never allowed
    SELECT ki.id AS item_id, ki.added_by AS item_owner,
      CASE
        WHEN ki.added_by = user_id                          THEN 'self'
        WHEN ki.added_by IN (SELECT friend_id FROM friend_ids) THEN 'friends'
        ELSE 'extended_circle'
      END AS trust_level
    FROM knowledge_items ki
    WHERE
      ki.added_by = user_id
      OR (
        ki.added_by IN (SELECT friend_id FROM friend_ids)
        AND ki.visibility != 'private'
      )
      OR (
        ki.added_by IN (SELECT fof_id FROM fof_ids)
        AND ki.visibility = 'friends'
      )
  ),
  semantic_search AS (
    SELECT
      ki.id,
      ki.title,
      ki.description,
      ki.enriched_description,
      ki.address,
      ki.latitude,
      ki.longitude,
      ki."URL"::TEXT                                   AS url,
      ki.photo_url,
      -- Strip identity for FOF
      CASE WHEN ai.trust_level = 'extended_circle' THEN NULL ELSE ki.added_by END   AS added_by,
      CASE WHEN ai.trust_level = 'extended_circle' THEN NULL ELSE ki.added_by_name END AS added_by_name,
      -- Strip personal_note for non-friends
      CASE
        WHEN ai.trust_level IN ('self', 'friends') THEN ki.personal_note
        ELSE NULL
      END                                              AS personal_note,
      ki.visibility,
      ai.trust_level,
      1 - (ki.embedding <=> query_embedding)           AS semantic_similarity
    FROM knowledge_items ki
    JOIN allowed_items ai ON ki.id = ai.item_id
    WHERE ki.embedding IS NOT NULL
  ),
  text_search AS (
    SELECT
      ki.id,
      ts_rank(ki.ts, plainto_tsquery('simple', query_text)) AS text_rank
    FROM knowledge_items ki
    WHERE ki.ts @@ plainto_tsquery('simple', query_text)
      AND ki.id IN (SELECT item_id FROM allowed_items)
  ),
  keyword_search AS (
    SELECT
      ki.id,
      CASE
        WHEN ki.keywords && string_to_array(lower(query_text), ' ') THEN 0.3
        ELSE 0
      END AS keyword_bonus
    FROM knowledge_items ki
    WHERE ki.keywords IS NOT NULL
      AND ki.id IN (SELECT item_id FROM allowed_items)
  )
  SELECT
    s.id, s.title, s.description, s.enriched_description,
    s.address, s.latitude, s.longitude, s.url,
    s.photo_url, s.added_by, s.added_by_name, s.personal_note,
    s.visibility, s.trust_level,
    (
      COALESCE(s.semantic_similarity, 0) * 0.6 +
      COALESCE(t.text_rank, 0)           * 0.3 +
      COALESCE(k.keyword_bonus, 0)       * 0.1
    ) AS combined_score
  FROM semantic_search s
  LEFT JOIN text_search   t ON s.id = t.id
  LEFT JOIN keyword_search k ON s.id = k.id
  WHERE (
    s.semantic_similarity >= match_threshold
    OR t.text_rank   > 0
    OR k.keyword_bonus > 0
  )
  ORDER BY combined_score DESC
  LIMIT max_matches;
END;
$$;


-- ============================================================
-- Notification clear timestamp (cross-device persistence)
-- Stores when a user last cleared all their notifications so
-- the filter works across devices / new sessions.
-- Run in Supabase SQL Editor → Dashboard → SQL Editor
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notifs_cleared_at TIMESTAMPTZ;

-- ============================================================
-- Secure cross-user notification insert for friend requests
-- The notifications table RLS prevents User A from inserting
-- a notification where user_id = User B directly from the client.
-- This SECURITY DEFINER function bypasses RLS so the sender
-- can notify the receiver.
-- Run in Supabase SQL Editor → Dashboard → SQL Editor
-- ============================================================
CREATE OR REPLACE FUNCTION notify_friend_request(
    p_receiver_id UUID,
    p_actor_id    UUID,
    p_message     TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Only insert if not already notified (avoid duplicates from retries)
    INSERT INTO notifications (user_id, actor_id, type, message)
    VALUES (p_receiver_id, p_actor_id, 'friend_request', p_message)
    ON CONFLICT DO NOTHING;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION notify_friend_request(UUID, UUID, TEXT) TO authenticated;

-- ============================================================
-- Pending friend requests WITH profile names/emails
-- Direct profile queries are blocked by RLS; these SECURITY
-- DEFINER functions join internally so names always resolve.
-- Run in Supabase SQL Editor → Dashboard → SQL Editor
-- ============================================================
CREATE OR REPLACE FUNCTION get_pending_friend_requests_with_profiles(p_user_id UUID)
RETURNS TABLE (
    out_id           UUID,
    out_requester_id UUID,
    out_requester_name TEXT,
    out_email        TEXT,
    out_avatar_url   TEXT,
    out_created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id                                              AS out_id,
        f.requester_id                                    AS out_requester_id,
        COALESCE(p.display_name, p.email, 'Unknown')     AS out_requester_name,
        p.email                                           AS out_email,
        p.avatar_url                                      AS out_avatar_url,
        f.created_at                                      AS out_created_at
    FROM friendships f
    JOIN profiles p ON p.id = f.requester_id
    WHERE f.receiver_id = p_user_id
      AND f.status = 'pending'
    ORDER BY f.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_pending_friend_requests_with_profiles(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION get_outgoing_friend_requests_with_profiles(p_user_id UUID)
RETURNS TABLE (
    out_id          UUID,
    out_receiver_id UUID,
    out_receiver_name TEXT,
    out_email       TEXT,
    out_avatar_url  TEXT,
    out_created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id                                              AS out_id,
        f.receiver_id                                     AS out_receiver_id,
        COALESCE(p.display_name, p.email, 'Unknown')     AS out_receiver_name,
        p.email                                           AS out_email,
        p.avatar_url                                      AS out_avatar_url,
        f.created_at                                      AS out_created_at
    FROM friendships f
    JOIN profiles p ON p.id = f.receiver_id
    WHERE f.requester_id = p_user_id
      AND f.status = 'pending'
    ORDER BY f.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_outgoing_friend_requests_with_profiles(UUID) TO authenticated;

-- ============================================================
-- Cancel a sent friend request atomically:
--   1. Deletes the pending friendship row
--   2. Deletes the friend_request notification from the receiver
-- SECURITY DEFINER so step 2 can delete a row owned by another user.
-- Run in Supabase SQL Editor → Dashboard → SQL Editor
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_friend_request(p_friendship_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_receiver_id UUID;
BEGIN
    -- Fetch receiver before deleting (and verify caller is the requester)
    SELECT receiver_id INTO v_receiver_id
    FROM friendships
    WHERE id = p_friendship_id
      AND requester_id = auth.uid()
      AND status = 'pending';

    IF v_receiver_id IS NULL THEN
        RAISE EXCEPTION 'Friend request not found or not authorised to cancel';
    END IF;

    -- Delete the friendship row
    DELETE FROM friendships
    WHERE id = p_friendship_id
      AND requester_id = auth.uid();

    -- Remove the friend_request notification from the receiver's inbox
    DELETE FROM notifications
    WHERE user_id  = v_receiver_id
      AND actor_id = auth.uid()
      AND type     = 'friend_request';
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_friend_request(UUID) TO authenticated;

-- ============================================================
-- ONBOARDING: Invite tokens + onboarding completion
-- Run in Supabase SQL Editor
-- Added: March 2026
-- ============================================================

-- 1. invitations table
--    Stores one-time invite tokens so inviters can auto-connect
--    with new users after Google OAuth completes.
CREATE TABLE IF NOT EXISTS invitations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token        TEXT UNIQUE NOT NULL,         -- random token in the invite URL
    inviter_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    invitee_email TEXT,                        -- optional: who was invited
    used         BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at      TIMESTAMPTZ
);

-- Index for fast token lookups on login
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations (token);

-- RLS: anyone authenticated can read (needed for new user to look up their token)
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read invitations"
    ON invitations FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Inviter can insert their own invitations"
    ON invitations FOR INSERT
    TO authenticated
    WITH CHECK (inviter_id = auth.uid());

CREATE POLICY "Inviter can update their own invitations"
    ON invitations FOR UPDATE
    TO authenticated
    USING (inviter_id = auth.uid() OR used = false);

-- 2. Mark onboarding_completed_at (column already exists in profiles)
--    Just confirming — no ALTER needed. Already in schema as of March 2026.
--    profiles.onboarding_completed_at TIMESTAMPTZ nullable
--    NULL = new user (show onboarding), NOT NULL = returning user (skip)
