import "dotenv/config";

/**
 * Simulate Twilio StatusCallback posts to the Supabase Edge Function `voice-webhook`.
 *
 * Usage:
 *   node worker/tools/simulate-enc24-voice-callback.mjs \
 *     --touchRunId=<uuid> \
 *     --status=no-answer \
 *     --answeredBy=machine_start \
 *     --duration=0 \
 *     --baseUrl=https://<project-ref>.functions.supabase.co/voice-webhook
 *
 * Notes:
 * - This does NOT call Twilio. It calls your Edge Function directly.
 * - Use it to validate retries/fallback logic before real calls.
 */

function arg(name, def = null) {
  const p = process.argv.find((x) => x.startsWith(`${name}=`));
  if (!p) return def;
  return p.split("=").slice(1).join("=");
}

const touchRunId = arg("--touchRunId", "");
const callStatus = arg("--status", "no-answer");
const answeredBy = arg("--answeredBy", "unknown");
const duration = arg("--duration", "0");
const baseUrl =
  arg("--baseUrl", "") ||
  (process.env.SUPABASE_URL
    ? (() => {
        try {
          const u = new URL(process.env.SUPABASE_URL);
          const ref = u.hostname.split(".")[0];
          return `https://${ref}.functions.supabase.co/voice-webhook`;
        } catch {
          return "";
        }
      })()
    : "");

if (!touchRunId || !baseUrl) {
  console.error("Missing --touchRunId and/or --baseUrl");
  process.exit(1);
}

async function main() {
  const url = `${baseUrl}?mode=status&touch_run_id=${encodeURIComponent(touchRunId)}`;
  const fd = new FormData();
  fd.set("CallSid", `CA_TEST_${Date.now()}`);
  fd.set("CallStatus", callStatus);
  fd.set("AnsweredBy", answeredBy);
  fd.set("CallDuration", String(duration));

  const res = await fetch(url, { method: "POST", body: fd });
  const txt = await res.text();
  console.log("POST", url);
  console.log("HTTP", res.status);
  console.log(txt);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


