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
