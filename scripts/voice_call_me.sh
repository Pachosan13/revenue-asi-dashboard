#!/usr/bin/env bash
set -euo pipefail

# One-click real call smoke (Supabase Cloud)
#
# Required env:
#   DB_URL='postgresql://postgres:<PASSWORD>@<HOST>:6543/postgres?sslmode=require'
#
# Optional env overrides:
#   SUPABASE_PROJECT_REF='cdrrlkxgurckuyceiguo'
#   ACCOUNT_ID='a0e3fc34-0bc4-410f-b363-a25b00fa16b8'
#   PHONE='+50765699957'
#   SOURCE='encuentra24'
#   MAKE='Jeep' MODEL='Wrangler' YEAR='2007' PRICE='12500'
#   DRY_RUN='false'
#   DISPATCH_LIMIT='10'
#   POLL_SECONDS='30'
#
# Usage:
#   DB_URL='...' bash scripts/voice_call_me.sh

DB_URL="${DB_URL:-}"
if [[ -z "$DB_URL" ]]; then
  echo "Missing DB_URL env var"
  exit 2
fi

SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-cdrrlkxgurckuyceiguo}"
ACCOUNT_ID="${ACCOUNT_ID:-a0e3fc34-0bc4-410f-b363-a25b00fa16b8}"
PHONE="${PHONE:-+50765699957}"
SOURCE="${SOURCE:-encuentra24}"
MAKE="${MAKE:-Jeep}"
MODEL="${MODEL:-Wrangler}"
YEAR="${YEAR:-2007}"
PRICE="${PRICE:-12500}"
DRY_RUN="${DRY_RUN:-false}"
DISPATCH_LIMIT="${DISPATCH_LIMIT:-10}"
POLL_SECONDS="${POLL_SECONDS:-30}"

echo "== Creating touch_run (voice) =="
TR_ID="$(
  psql "$DB_URL" -v ON_ERROR_STOP=1 -t -A <<SQL
with acct as (
  select '${ACCOUNT_ID}'::uuid as account_id
),
camp as (
  select c.id as campaign_id
  from public.campaigns c, acct
  where c.account_id = acct.account_id
  order by c.created_at desc
  limit 1
),
lead as (
  insert into public.leads (id, account_id, contact_name, phone, created_at, updated_at)
  select gen_random_uuid(), acct.account_id, 'Usuario', '${PHONE}', now(), now()
  from acct
  on conflict do nothing
  returning id
),
lead_pick as (
  select id from lead
  union all
  select l.id
  from public.leads l, acct
  where l.account_id = acct.account_id and l.phone = '${PHONE}'
  order by l.created_at desc
  limit 1
),
ins as (
  insert into public.touch_runs (
    id, account_id, campaign_id, campaign_run_id, lead_id,
    step, channel, payload, scheduled_at, status, meta, created_at, updated_at
  )
  select
    gen_random_uuid(),
    acct.account_id,
    camp.campaign_id,
    gen_random_uuid(),
    lp.id,
    (1000000 + (random()*1000000)::int),
    'voice',
    jsonb_build_object(
      'voice_mode','realtime',
      'voice', jsonb_build_object(
        'mode','realtime',
        'source','${SOURCE}',
        'listing', jsonb_build_object('make','${MAKE}','model','${MODEL}','year',${YEAR}::int,'price',${PRICE}::int),
        'to_phone','${PHONE}'
      ),
      'routing', jsonb_build_object('advance_on','call_status')
    ),
    now(),
    'queued',
    '{}'::jsonb,
    now(),
    now()
  from acct, camp, lead_pick lp
  returning id
)
select id from ins;
SQL
)"

echo "TOUCH_RUN_ID=$TR_ID"

echo
echo "== Trigger dispatch-engine (dry_run=${DRY_RUN}) =="
curl -sS -X POST "https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/dispatch-engine" \
  -H 'Content-Type: application/json' \
  --data "{\"limit\":${DISPATCH_LIMIT},\"dry_run\":${DRY_RUN}}" | cat
echo

echo
echo "== Polling for provider_call_id (up to ${POLL_SECONDS}s) =="
deadline=$(( $(date +%s) + POLL_SECONDS ))
while true; do
  now=$(date +%s)
  if (( now > deadline )); then
    echo "Timed out waiting for provider_call_id"
    break
  fi

  out="$(
    psql "$DB_URL" -v ON_ERROR_STOP=1 -t -A -v touch_run_id="$TR_ID" <<'SQL'
select
  tr.status || '|' || coalesce(tr.error,'') || '|' || coalesce(vc.provider_call_id,'') || '|' || coalesce(vc.last_error,'')
from public.touch_runs tr
left join public.voice_calls vc on vc.touch_run_id = tr.id
where tr.id = :'touch_run_id'
order by vc.created_at desc nulls last
limit 1;
SQL
  )"

  status="$(echo "$out" | cut -d'|' -f1)"
  err="$(echo "$out" | cut -d'|' -f2)"
  call_id="$(echo "$out" | cut -d'|' -f3)"
  last_err="$(echo "$out" | cut -d'|' -f4)"

  if [[ -n "$call_id" ]]; then
    echo "OK provider_call_id=$call_id status=$status"
    break
  fi

  if [[ "$status" == "failed" ]]; then
    echo "FAILED status=failed error=$err last_error=$last_err"
    break
  fi

  sleep 2
done

echo
echo "== Final DB snapshot =="
psql "$DB_URL" -v ON_ERROR_STOP=1 -v touch_run_id="$TR_ID" <<'SQL'
select id, status, error, executed_at, sent_at, updated_at
from public.touch_runs where id = :'touch_run_id';

select id, provider, provider_call_id, status, last_error, created_at, updated_at
from public.voice_calls
where touch_run_id = :'touch_run_id'
order by created_at desc;

select event, provider, created_at, payload
from public.dispatch_events
where touch_run_id = :'touch_run_id'
order by created_at;
SQL


