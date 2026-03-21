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
-- 4. Invitations table — required for invite link flow
--    Run this if the table doesn't exist yet in your Supabase project.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invitations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token       TEXT NOT NULL UNIQUE,
    inviter_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    used        BOOLEAN NOT NULL DEFAULT FALSE,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations (token);
-- Index for finding all invites by a user
CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON public.invitations (inviter_id);

-- RLS: enable row-level security
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can insert their own invitations
CREATE POLICY IF NOT EXISTS "invitations_insert_own"
    ON public.invitations FOR INSERT
    TO authenticated
    WITH CHECK (inviter_id = auth.uid());

-- Policy: authenticated users can read any unused invitation (needed to validate a token)
CREATE POLICY IF NOT EXISTS "invitations_select_any"
    ON public.invitations FOR SELECT
    TO authenticated
    USING (true);

-- Policy: authenticated users can mark an invitation as used
--   (both the invitee who uses the link AND the inviter who generated it)
CREATE POLICY IF NOT EXISTS "invitations_update_used"
    ON public.invitations FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- 5. cancel_friend_request RPC
--    Deletes a pending outgoing friend request by friendship ID.
--    Only the requester (person who sent it) can cancel their own request.
--    Run this in your Supabase SQL editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_friend_request(p_friendship_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.friendships
    WHERE id = p_friendship_id
      AND requester_id = auth.uid()   -- only the sender can cancel
      AND status = 'pending';         -- only pending requests can be cancelled
END;
$$;
