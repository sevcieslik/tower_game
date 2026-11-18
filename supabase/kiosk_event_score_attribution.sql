-- Utility Geo Guess: atomic score attribution to kiosk and event (v2)
--
-- IMPORTANT: Run this migration in Supabase SQL Editor BEFORE deploying
-- index.html from feature/kiosk-event-auto-attribution-20261118.
--
-- This does NOT replace/drop public.submit_game_score. It calls the existing
-- function inside the SAME DB transaction, then attaches the current event,
-- active kiosk, sales rep and source to the inserted game_entries row.
-- A failed attribution rolls back the whole save. The old RPC remains usable
-- by older kiosks while the new frontend is deployed.

BEGIN;

-- Persist the event assigned to each kiosk, separately from game_settings.
ALTER TABLE public.kiosks
  ADD COLUMN IF NOT EXISTS event_id uuid
  REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS kiosks_event_id_idx
  ON public.kiosks(event_id);

-- Migrate the known CEATI Ipad2 without touching other/older kiosks.
UPDATE public.kiosks
SET event_id = '5d775de5-2542-4444-8f3c-aee89446da46'::uuid
WHERE id = '0e3e41ed-4130-48f8-b29b-b60529a3b201'::uuid
  AND event_id IS NULL;

-- The frontend calls this new, atomic wrapper.
-- Original submit_game_score remains the sole source of score validation
-- and score-row insertion. Its parameter types are read from pg_proc so that
-- text/uuid and numeric/double precision variants can be supported safely.
CREATE OR REPLACE FUNCTION public.submit_game_score_v2(
  p_device_key text,
  p_name text,
  p_email text,
  p_score_km numeric,
  p_consent boolean
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_legacy_oid oid;
  v_argnames text[];
  v_argtypes oidvector;
  v_function_count integer;
  v_sql text;
  v_entry_id uuid;
  v_default_event uuid;
  v_event_id uuid;
  v_kiosk_id uuid;
  v_sales_rep_id uuid;
  v_source text := 'web';
BEGIN
  -- Match exactly the existing five-input-parameter function used by
  -- the current application. Fail closed if the signature is unexpected.
  SELECT count(*)
  INTO v_function_count
  FROM pg_catalog.pg_proc f
  JOIN pg_catalog.pg_namespace ns ON ns.oid = f.pronamespace
  WHERE ns.nspname = 'public'
    AND f.proname = 'submit_game_score'
    AND f.pronargs = 5
    AND ARRAY[
      'p_device_key', 'p_name', 'p_email', 'p_score_km', 'p_consent'
    ]::text[] <@ f.proargnames;

  IF v_function_count <> 1 THEN
    RAISE EXCEPTION
      'Expected one 5-parameter public.submit_game_score; found %',
      v_function_count;
  END IF;

  SELECT f.oid, f.proargnames, f.proargtypes
  INTO v_legacy_oid, v_argnames, v_argtypes
  FROM pg_catalog.pg_proc f
  JOIN pg_catalog.pg_namespace ns ON ns.oid = f.pronamespace
  WHERE ns.nspname = 'public'
    AND f.proname = 'submit_game_score'
    AND f.pronargs = 5
    AND ARRAY[
      'p_device_key', 'p_name', 'p_email', 'p_score_km', 'p_consent'
    ]::text[] <@ f.proargnames
  LIMIT 1;

  -- Build ONLY fixed, schema-qualified SQL. Types are sourced from pg_proc,
  -- never concatenated from player input. No score/email/device values are
  -- interpolated into the SQL text.
  v_sql := pg_catalog.format(
    'SELECT public.submit_game_score(' ||
    'p_device_key => $1::%s, ' ||
    'p_name => $2::%s, ' ||
    'p_email => $3::%s, ' ||
    'p_score_km => $4::%s, ' ||
    'p_consent => $5::%s)::uuid',
    pg_catalog.format_type(v_argtypes[
      pg_catalog.array_position(v_argnames, 'p_device_key') - 1
    ], NULL),
    pg_catalog.format_type(v_argtypes[
      pg_catalog.array_position(v_argnames, 'p_name') - 1
    ], NULL),
    pg_catalog.format_type(v_argtypes[
      pg_catalog.array_position(v_argnames, 'p_email') - 1
    ], NULL),
    pg_catalog.format_type(v_argtypes[
      pg_catalog.array_position(v_argnames, 'p_score_km') - 1
    ], NULL),
    pg_catalog.format_type(v_argtypes[
      pg_catalog.array_position(v_argnames, 'p_consent') - 1
    ], NULL)
  );

  EXECUTE v_sql INTO STRICT v_entry_id
  USING p_device_key, p_name, p_email, p_score_km, p_consent;

  IF v_entry_id IS NULL THEN
    RAISE EXCEPTION 'Score save returned no entry ID';
  END IF;

  SELECT s.current_event_id
  INTO v_default_event
  FROM public.game_settings s
  WHERE s.id = true;

  -- The exact device key (local browser storage) identifies the kiosk.
  -- Inactive/unknown devices are treated as ordinary web sessions.
  SELECT k.id, k.sales_rep_id, k.event_id
  INTO v_kiosk_id, v_sales_rep_id, v_event_id
  FROM public.kiosks k
  WHERE k.device_key::text = p_device_key
    AND k.active IS TRUE
  ORDER BY k.created_at DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    v_source := 'kiosk';
    -- Respect the kiosk's explicit assignment, including "No event".
    -- For a newly registered kiosk the Admin UI defaults this to
    -- game_settings.current_event_id during registration.

    UPDATE public.kiosks
    SET last_seen = now()
    WHERE id = v_kiosk_id;
  ELSE
    v_kiosk_id := NULL;
    v_sales_rep_id := NULL;
    v_event_id := v_default_event;
    v_source := 'web';
  END IF;

  UPDATE public.game_entries e
  SET
    event_id = v_event_id,
    kiosk_id = v_kiosk_id,
    sales_rep_id = v_sales_rep_id,
    source = v_source
  WHERE e.id = v_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Score was not found for attribution (entry ID %)', v_entry_id;
  END IF;

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_game_score_v2(
  text, text, text, numeric, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_game_score_v2(
  text, text, text, numeric, boolean
) TO anon, authenticated;

COMMIT;

-- Verification (read-only):
-- SELECT id, name, active, event_id, sales_rep_id
-- FROM public.kiosks
-- WHERE name ILIKE '%ipad%';
--
-- SELECT pg_get_function_identity_arguments(p.oid) AS signature,
--        p.prorettype::regtype AS return_type
-- FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
-- WHERE n.nspname='public' AND p.proname IN
-- ('submit_game_score', 'submit_game_score_v2');
--
-- After a new test game:
-- SELECT name, source, event_id, kiosk_id, sales_rep_id, played_at
-- FROM public.game_entries ORDER BY played_at DESC LIMIT 5;
