-- Extend stage1 safe upsert to optionally attach structured details to raw.stage1
-- without clobbering reveal results (phone_e164/wa_link/seller_name).

begin;

create or replace function lead_hunter.upsert_enc24_listing_stage1(
  p_account_id uuid,
  p_listing_url text,
  p_listing_text text,
  p_page int,
  p_seen_at timestamptz default now(),
  p_stage1_extra jsonb default null
)
returns void
language sql
security definer
set search_path = lead_hunter, public
as $$
  insert into lead_hunter.enc24_listings (
    account_id,
    source,
    listing_url,
    raw,
    last_seen_at
  )
  values (
    p_account_id,
    'encuentra24',
    p_listing_url,
    jsonb_build_object(
      'stage1',
      jsonb_strip_nulls(
        jsonb_build_object(
          'listing_text', coalesce(p_listing_text,''),
          'page', p_page,
          'collected_at', to_char(p_seen_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) || coalesce(p_stage1_extra, '{}'::jsonb)
      )
    ),
    p_seen_at
  )
  on conflict (listing_url_hash) do update
  set
    account_id = coalesce(lead_hunter.enc24_listings.account_id, excluded.account_id),
    source = lead_hunter.enc24_listings.source,
    last_seen_at = greatest(coalesce(lead_hunter.enc24_listings.last_seen_at, excluded.last_seen_at), excluded.last_seen_at),
    raw = coalesce(lead_hunter.enc24_listings.raw, '{}'::jsonb) || excluded.raw,
    updated_at = now();
$$;

grant execute on function lead_hunter.upsert_enc24_listing_stage1(uuid, text, text, int, timestamptz, jsonb)
to anon, authenticated, service_role, authenticator;

notify pgrst, 'reload schema';
commit;


