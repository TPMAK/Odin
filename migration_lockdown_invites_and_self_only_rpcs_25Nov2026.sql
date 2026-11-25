-- Odin: lock down invitations + self-only guards on per-user RPCs (25 Nov 2026)
-- APPLIED to production Supabase on 25 Nov 2026 via MCP (migration: lockdown_invitations_and_self_only_rpcs). Kept here as the record.
-- Guard rule: caller must BE p_user_id (or be the n8n service role).

-- ── 1. invitations: no more open read; updates only by the inviter ──
DROP POLICY IF EXISTS "Authenticated users can read invitations" ON public.invitations;
CREATE POLICY "Inviter can read own invitations" ON public.invitations
  FOR SELECT TO authenticated USING (inviter_id = auth.uid());

DROP POLICY IF EXISTS "Inviter can update their own invitations" ON public.invitations;
CREATE POLICY "Inviter can update their own invitations" ON public.invitations
  FOR UPDATE TO authenticated
  USING (inviter_id = auth.uid()) WITH CHECK (inviter_id = auth.uid());

-- ── 2. self-only guards ──
CREATE OR REPLACE FUNCTION public.get_feed_items(p_user_id uuid, p_days integer DEFAULT 180)
 RETURNS SETOF knowledge_items LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH my_friends AS (
    SELECT CASE WHEN requester_id = p_user_id THEN receiver_id ELSE requester_id END AS friend_id
    FROM friendships
    WHERE status = 'accepted' AND (requester_id = p_user_id OR receiver_id = p_user_id)
  ),
  visible_users AS (
    SELECT friend_id AS user_id FROM my_friends
    UNION
    SELECT p_user_id
  )
  SELECT ki.*
  FROM knowledge_items ki
  JOIN visible_users vu ON ki.added_by = vu.user_id
  WHERE (p_user_id = auth.uid() OR coalesce(auth.role(), '') = 'service_role')
    AND ki.created_at >= now() - (p_days || ' days')::interval
    AND (ki.visibility IS DISTINCT FROM 'private' OR ki.added_by = p_user_id)
  ORDER BY ki.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_extended_circle_items(p_user_id uuid, p_days integer DEFAULT 180)
 RETURNS TABLE(id uuid, title text, photo_url text, address text, latitude numeric, longitude numeric, description text, type text, category_id uuid, feed_card_summary text, place_name text, created_at timestamp without time zone, added_by uuid, visibility text)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH my_friends AS (
    SELECT to_user AS friend_id FROM trust_connections
    WHERE from_user = p_user_id AND connection_type = 'friend'
  ),
  fof AS (
    SELECT DISTINCT tc.to_user AS fof_id
    FROM trust_connections tc
    JOIN my_friends mf ON tc.from_user = mf.friend_id
    WHERE tc.connection_type = 'friend'
      AND tc.to_user != p_user_id
      AND tc.to_user NOT IN (SELECT friend_id FROM my_friends)
  )
  SELECT ki.id, ki.title, ki.photo_url, ki.address, ki.latitude, ki.longitude, ki.description,
         ki.type, ki.category_id, ki.feed_card_summary, ki.place_name, ki.created_at,
         NULL::uuid AS added_by, ki.visibility
  FROM knowledge_items ki
  JOIN fof ON ki.added_by = fof.fof_id
  WHERE (p_user_id = auth.uid() OR coalesce(auth.role(), '') = 'service_role')
    AND ki.visibility = 'friends'
    AND ki.created_at >= now() - (p_days || ' days')::interval
  ORDER BY ki.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_friends_list(p_user_id uuid)
 RETURNS TABLE(out_friendship_id uuid, out_user_id uuid, out_email text, out_display_name text, out_avatar_url text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS DISTINCT FROM p_user_id AND coalesce(auth.role(), '') <> 'service_role' THEN RETURN; END IF;
    RETURN QUERY
    SELECT f.id,
        CASE WHEN f.requester_id = p_user_id THEN f.receiver_id ELSE f.requester_id END,
        p.email, p.display_name, p.avatar_url
    FROM public.friendships f
    JOIN public.profiles p ON p.id = (CASE WHEN f.requester_id = p_user_id THEN f.receiver_id ELSE f.requester_id END)
    WHERE f.status = 'accepted' AND (f.requester_id = p_user_id OR f.receiver_id = p_user_id)
    ORDER BY p.display_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_blocked_users(p_user_id uuid)
 RETURNS TABLE(out_blocked_user_id uuid, out_display_name text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS DISTINCT FROM p_user_id AND coalesce(auth.role(), '') <> 'service_role' THEN RETURN; END IF;
    RETURN QUERY
    SELECT CASE WHEN f.requester_id = p_user_id THEN f.receiver_id ELSE f.requester_id END, p.display_name
    FROM public.friendships f
    JOIN public.profiles p ON p.id = (CASE WHEN f.requester_id = p_user_id THEN f.receiver_id ELSE f.requester_id END)
    WHERE f.status = 'blocked' AND (f.requester_id = p_user_id OR f.receiver_id = p_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_friendship_status(p_user1 uuid, p_user2 uuid)
 RETURNS TABLE(out_status text, out_friendship_id uuid, out_direction text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS DISTINCT FROM p_user1 AND auth.uid() IS DISTINCT FROM p_user2
       AND coalesce(auth.role(), '') <> 'service_role' THEN
        RETURN QUERY SELECT 'none'::TEXT, NULL::UUID, 'none'::TEXT;
        RETURN;
    END IF;
    RETURN QUERY
    SELECT f.status, f.id, CASE WHEN f.requester_id = p_user1 THEN 'sent' ELSE 'received' END
    FROM public.friendships f
    WHERE (f.requester_id = p_user1 AND f.receiver_id = p_user2)
       OR (f.requester_id = p_user2 AND f.receiver_id = p_user1)
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'none'::TEXT, NULL::UUID, 'none'::TEXT;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_outgoing_friend_requests_with_profiles(p_user_id uuid)
 RETURNS TABLE(out_id uuid, out_receiver_id uuid, out_receiver_name text, out_email text, out_avatar_url text, out_created_at timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS DISTINCT FROM p_user_id AND coalesce(auth.role(), '') <> 'service_role' THEN RETURN; END IF;
    RETURN QUERY
    SELECT f.id, f.receiver_id, COALESCE(p.display_name, p.email, 'Unknown'), p.email, p.avatar_url, f.created_at
    FROM friendships f
    JOIN profiles p ON p.id = f.receiver_id
    WHERE f.requester_id = p_user_id AND f.status = 'pending'
    ORDER BY f.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_friend_requests(p_user_id uuid)
 RETURNS TABLE(out_id uuid, out_requester_id uuid, out_requester_name text, out_requester_email text, out_requester_avatar text, out_created_at timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS DISTINCT FROM p_user_id AND coalesce(auth.role(), '') <> 'service_role' THEN RETURN; END IF;
    RETURN QUERY
    SELECT f.id, f.requester_id, p.display_name, p.email, p.avatar_url, f.created_at
    FROM public.friendships f
    JOIN public.profiles p ON p.id = f.requester_id
    WHERE f.receiver_id = p_user_id AND f.status = 'pending'
    ORDER BY f.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_friend_requests_with_profiles(p_user_id uuid)
 RETURNS TABLE(out_id uuid, out_requester_id uuid, out_requester_name text, out_email text, out_avatar_url text, out_created_at timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS DISTINCT FROM p_user_id AND coalesce(auth.role(), '') <> 'service_role' THEN RETURN; END IF;
    RETURN QUERY
    SELECT f.id, f.requester_id, COALESCE(p.display_name, p.email, 'Unknown'), p.email, p.avatar_url, f.created_at
    FROM friendships f
    JOIN profiles p ON p.id = f.requester_id
    WHERE f.receiver_id = p_user_id AND f.status = 'pending'
    ORDER BY f.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_user_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE cnt INTEGER;
BEGIN
    IF auth.uid() IS DISTINCT FROM p_user_id AND coalesce(auth.role(), '') <> 'service_role' THEN RETURN 0; END IF;
    SELECT COUNT(*)::INTEGER INTO cnt FROM public.notifications WHERE user_id = p_user_id AND read = false;
    RETURN cnt;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_notifications(p_user_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, type text, item_id uuid, actor_name text, message text, read boolean, created_at timestamp with time zone, title text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF auth.uid() IS DISTINCT FROM p_user_id AND coalesce(auth.role(), '') <> 'service_role' THEN RETURN; END IF;
    RETURN QUERY
    SELECT n.id, n.type, n.item_id, n.actor_name, n.message, n.read, n.created_at, NULL::text AS title
    FROM public.notifications n
    WHERE n.user_id = p_user_id
    ORDER BY n.created_at DESC
    LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS DISTINCT FROM p_user_id AND coalesce(auth.role(), '') <> 'service_role' THEN RETURN; END IF;
    UPDATE public.notifications SET read = true WHERE user_id = p_user_id AND read = false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_friend_request(p_receiver_id uuid, p_actor_id uuid, p_message text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    -- Only the real sender can create this notification
    IF auth.uid() IS DISTINCT FROM p_actor_id AND coalesce(auth.role(), '') <> 'service_role' THEN RETURN; END IF;
    INSERT INTO notifications (user_id, actor_id, type, message)
    VALUES (p_receiver_id, p_actor_id, 'friend_request', p_message)
    ON CONFLICT DO NOTHING;
END;
$function$;

-- get_kb_count: stop answering for signed-out callers
CREATE OR REPLACE FUNCTION public.get_kb_count(p_user_id uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN p_user_id = auth.uid() OR coalesce(auth.role(), '') = 'service_role' THEN (
  WITH friend_ids AS (
    SELECT CASE WHEN requester_id = p_user_id THEN receiver_id ELSE requester_id END AS friend_id
    FROM friendships
    WHERE (requester_id = p_user_id OR receiver_id = p_user_id) AND status = 'accepted'
  ),
  visible_ids AS (
    SELECT id FROM knowledge_items WHERE added_by = p_user_id
    UNION
    SELECT ki.id FROM knowledge_items ki JOIN friend_ids fi ON ki.added_by = fi.friend_id
    WHERE ki.visibility = 'friends'
    UNION
    SELECT ki.id FROM endorsements e
    JOIN friend_ids fi ON e.user_id = fi.friend_id
    JOIN knowledge_items ki ON ki.id = e.item_id
    WHERE e.visibility = 'friends' AND ki.visibility = 'friends'
  )
  SELECT COUNT(DISTINCT id)::INTEGER FROM visible_ids) ELSE 0 END
$function$;

-- ── 3. signed-out visitors can't call any of these ──
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'get_feed_items(uuid, integer)', 'get_extended_circle_items(uuid, integer)',
    'get_friends_list(uuid)', 'get_blocked_users(uuid)', 'get_friendship_status(uuid, uuid)',
    'get_outgoing_friend_requests_with_profiles(uuid)', 'get_pending_friend_requests(uuid)',
    'get_pending_friend_requests_with_profiles(uuid)', 'get_unread_notification_count(uuid)',
    'get_user_notifications(uuid, integer)', 'mark_all_notifications_read(uuid)',
    'notify_friend_request(uuid, uuid, text)', 'get_kb_count(uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;
