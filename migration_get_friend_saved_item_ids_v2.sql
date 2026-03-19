-- ============================================================
-- MIGRATION: Update get_friend_saved_item_ids RPC
-- Returns item_id + saver_id + saver_name so the frontend
-- can display "Via [Friend Name]" on Save Inheritance cards.
-- Run in Supabase SQL Editor.
--
-- Must DROP first because the return type is changing
-- (old version returned only item_id).
-- ============================================================

DROP FUNCTION IF EXISTS get_friend_saved_item_ids(uuid);

CREATE FUNCTION get_friend_saved_item_ids(p_user_id uuid)
RETURNS TABLE (
    item_id   uuid,
    saver_id  uuid,
    saver_name text
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    -- Step 1: Find all direct friends of p_user_id
    WITH my_friends AS (
        SELECT
            CASE
                WHEN requester_id = p_user_id THEN receiver_id
                ELSE requester_id
            END AS friend_id
        FROM friendships
        WHERE (requester_id = p_user_id OR receiver_id = p_user_id)
          AND status = 'accepted'
    ),
    -- Step 2: Find items those friends have saved (via endorsements)
    -- that are NOT already in p_user_id's direct-friend feed
    -- (i.e. item.added_by is not a direct friend or themselves)
    friend_saves AS (
        SELECT
            e.item_id,
            e.user_id AS saver_id,
            p.display_name AS saver_name
        FROM endorsements e
        JOIN my_friends mf ON e.user_id = mf.friend_id
        JOIN profiles p ON p.id = e.user_id
        -- Only surface items whose original adder is NOT a direct friend of p_user_id
        -- (those already appear in the normal feed — no need to show twice)
        WHERE e.item_id NOT IN (
            SELECT ki.id
            FROM knowledge_items ki
            JOIN my_friends mf2 ON ki.added_by = mf2.friend_id
            WHERE ki.visibility = 'friends'
        )
        -- Also exclude items p_user_id added themselves
        AND e.item_id NOT IN (
            SELECT ki.id
            FROM knowledge_items ki
            WHERE ki.added_by = p_user_id
        )
    )
    SELECT DISTINCT ON (item_id)
        item_id,
        saver_id,
        saver_name
    FROM friend_saves
    ORDER BY item_id, saver_name;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_friend_saved_item_ids(uuid) TO authenticated;
