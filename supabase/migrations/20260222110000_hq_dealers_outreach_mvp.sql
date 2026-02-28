begin;

create extension if not exists pgcrypto;

create table if not exists public.hq_dealer_vdp_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  dealer_url text not null,
  listing_url text not null,
  inventory_url text null,
  scraped_at timestamptz null,
  status text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, dealer_url, listing_url)
);

create index if not exists hq_dealer_vdp_links_account_dealer_idx
  on public.hq_dealer_vdp_links (account_id, dealer_url);

create index if not exists hq_dealer_vdp_links_account_scraped_idx
  on public.hq_dealer_vdp_links (account_id, scraped_at desc);

create table if not exists public.hq_dealer_prospects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  dealer_url text not null,
  email text null,
  city text null,
  vdp_count integer not null default 0,
  last_scraped_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, dealer_url)
);

create index if not exists hq_dealer_prospects_account_eligibility_idx
  on public.hq_dealer_prospects (account_id, vdp_count desc, updated_at desc);

create table if not exists public.hq_dealer_outreach (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  dealer_url text not null,
  token text not null unique,
  sent_at timestamptz null,
  clicked_at timestamptz null,
  booked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, dealer_url)
);

create index if not exists hq_dealer_outreach_account_dealer_idx
  on public.hq_dealer_outreach (account_id, dealer_url);

create index if not exists hq_dealer_outreach_sent_idx
  on public.hq_dealer_outreach (account_id, sent_at);

do $$
begin
  if exists (select 1 from pg_proc where proname='set_updated_at') then
    drop trigger if exists trg_hq_dealer_vdp_links_updated_at on public.hq_dealer_vdp_links;
    create trigger trg_hq_dealer_vdp_links_updated_at
      before update on public.hq_dealer_vdp_links
      for each row execute function set_updated_at();

    drop trigger if exists trg_hq_dealer_prospects_updated_at on public.hq_dealer_prospects;
    create trigger trg_hq_dealer_prospects_updated_at
      before update on public.hq_dealer_prospects
      for each row execute function set_updated_at();

    drop trigger if exists trg_hq_dealer_outreach_updated_at on public.hq_dealer_outreach;
    create trigger trg_hq_dealer_outreach_updated_at
      before update on public.hq_dealer_outreach
      for each row execute function set_updated_at();
  end if;
end $$;

grant usage on schema public to anon, authenticated, authenticator;
grant select, insert, update, delete on table public.hq_dealer_vdp_links to anon, authenticated, authenticator;
grant select, insert, update, delete on table public.hq_dealer_prospects to anon, authenticated, authenticator;
grant select, insert, update, delete on table public.hq_dealer_outreach to anon, authenticated, authenticator;

notify pgrst, 'reload schema';

commit;
