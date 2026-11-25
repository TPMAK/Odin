-- Privacy: never keep a person's exact location. Round to 2 decimals (~1 km, suburb level)
-- on every insert/update, and round what is already stored.
-- Item place coordinates (knowledge_items.latitude/longitude) are NOT touched — those are the place, not the person.

CREATE OR REPLACE FUNCTION public.odin_round_user_location()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.user_latitude  := round(NEW.user_latitude::numeric, 2)::double precision;
  NEW.user_longitude := round(NEW.user_longitude::numeric, 2)::double precision;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_round_user_location ON public.search_events;
CREATE TRIGGER trg_round_user_location
  BEFORE INSERT OR UPDATE OF user_latitude, user_longitude ON public.search_events
  FOR EACH ROW EXECUTE FUNCTION public.odin_round_user_location();

DROP TRIGGER IF EXISTS trg_round_user_location ON public.knowledge_items;
CREATE TRIGGER trg_round_user_location
  BEFORE INSERT OR UPDATE OF user_latitude, user_longitude ON public.knowledge_items
  FOR EACH ROW EXECUTE FUNCTION public.odin_round_user_location();

UPDATE public.search_events
SET user_latitude = user_latitude, user_longitude = user_longitude
WHERE user_latitude IS NOT NULL OR user_longitude IS NOT NULL;
