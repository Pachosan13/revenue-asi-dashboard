BEGIN;

-- 1) Tabla staging para resultados ENCUENTRA24 (lo que imprime tu runner)
CREATE TABLE IF NOT EXISTS lead_hunter.enc24_listings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NULL, -- por si luego lo conectas multi-tenant
  source            text NOT NULL DEFAULT 'encuentra24',

  listing_url       text NOT NULL,
  listing_url_hash  text GENERATED ALWAYS AS (md5(lower(listing_url))) STORED,

  ok                boolean NOT NULL DEFAULT false,
  stage             int NULL,
  method            text NULL,
  reason            text NULL,

  seller_name       text NULL,
  seller_profile_url text NULL,
  seller_address    text NULL,

  phone_e164        text NULL,
  wa_link           text NULL,

  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,

  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Un listing_url único (case-insensitive via hash)
CREATE UNIQUE INDEX IF NOT EXISTS enc24_listings_url_uq
  ON lead_hunter.enc24_listings (listing_url_hash);

-- Evita duplicados por teléfono (cuando existe)
CREATE INDEX IF NOT EXISTS enc24_listings_phone_idx
  ON lead_hunter.enc24_listings (phone_e164);

-- Para filtrar por "ok" reciente rápido
CREATE INDEX IF NOT EXISTS enc24_listings_ok_lastseen_idx
  ON lead_hunter.enc24_listings (ok, last_seen_at DESC);

-- 2) Updated_at trigger (si ya tienes tg_set_updated_at, úsalo)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='lead_hunter' AND p.proname='tg_set_updated_at'
  )
  THEN
    -- crea trigger solo si no existe
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname='trg_enc24_listings_set_updated_at'
    )
    THEN
      CREATE TRIGGER trg_enc24_listings_set_updated_at
      BEFORE UPDATE ON lead_hunter.enc24_listings
      FOR EACH ROW
      EXECUTE FUNCTION lead_hunter.tg_set_updated_at();
    END IF;
  END IF;
END$$;

-- 3) Ingest: recibe jsonb array con objetos como los que imprime tu runner
--    y hace UPSERT por listing_url.
CREATE OR REPLACE FUNCTION lead_hunter.ingest_enc24_results(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted int := 0;
  v_updated  int := 0;
  v_total    int := 0;
  r jsonb;
  v_url text;
  v_phone text;
  v_ok boolean;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'ingest_enc24_results expects a JSONB array';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) value
  LOOP
    v_total := v_total + 1;

    v_url := COALESCE(r->>'listing_url', r->>'url', r->>'listing', NULL);
    IF v_url IS NULL OR length(v_url) < 10 THEN
      -- si no hay URL válida, lo saltamos
      CONTINUE;
    END IF;

    v_phone := NULLIF(r->>'phone_e164', '');
    v_ok := COALESCE((r->>'ok')::boolean, false);

    -- UPSERT por listing_url_hash (derivado de listing_url)
    -- Para saber si fue insert vs update: miramos xmax (hack simple)
    WITH up AS (
      INSERT INTO lead_hunter.enc24_listings (
        listing_url,
        ok,
        stage,
        method,
        reason,
        seller_name,
        seller_profile_url,
        seller_address,
        phone_e164,
        wa_link,
        raw,
        last_seen_at
      )
      VALUES (
        v_url,
        v_ok,
        NULLIF(r->>'stage','')::int,
        NULLIF(r->>'method',''),
        NULLIF(r->>'reason',''),
        NULLIF(r->>'seller_name',''),
        NULLIF(r->>'seller_profile_url',''),
        NULLIF(r->>'seller_address',''),
        v_phone,
        NULLIF(r->>'wa_link',''),
        r,
        now()
      )
      ON CONFLICT (listing_url_hash)
      DO UPDATE SET
        ok = EXCLUDED.ok,
        stage = EXCLUDED.stage,
        method = EXCLUDED.method,
        reason = EXCLUDED.reason,
        seller_name = COALESCE(EXCLUDED.seller_name, lead_hunter.enc24_listings.seller_name),
        seller_profile_url = COALESCE(EXCLUDED.seller_profile_url, lead_hunter.enc24_listings.seller_profile_url),
        seller_address = COALESCE(EXCLUDED.seller_address, lead_hunter.enc24_listings.seller_address),
        phone_e164 = COALESCE(EXCLUDED.phone_e164, lead_hunter.enc24_listings.phone_e164),
        wa_link = COALESCE(EXCLUDED.wa_link, lead_hunter.enc24_listings.wa_link),
        raw = EXCLUDED.raw,
        last_seen_at = now()
      RETURNING (xmax = 0) AS inserted
    )
    SELECT
      CASE WHEN inserted THEN 1 ELSE 0 END,
      CASE WHEN inserted THEN 0 ELSE 1 END
    INTO v_inserted, v_updated
    FROM up;

  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated
  );
END;
$$;

COMMIT;
