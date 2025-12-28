// worker/run-encuentra24-stage2.mjs
import { resolveEncuentra24PhoneFromListing } from "./providers/phone-resolver/encuentra24_whatsapp_resolver.mjs";

function parseArg(name, def = null) {
  const a = process.argv.find((x) => x === name || x.startsWith(`${name}=`));
  if (!a) return def;
  if (a === name) return true;
  return a.split("=").slice(1).join("=");
}

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http"));
const headed = args.includes("--headed");

const loops = Number(parseArg("--loops", "1")) || 1;

if (!url) {
  console.error("Usage: node worker/run-encuentra24-stage2.mjs <listingUrl> [--headed] [--loops=5]");
  process.exit(1);
}

const email = String(parseArg("--email", "pacho@pachosanchez.com"));
const name = String(parseArg("--name", "Pacho"));
const phone8 = String(parseArg("--phone8", "67777777"));
const message = String(parseArg("--message", "Hola, me interesa. ¿Sigue disponible?"));

const beforePhoneTypeMs = Number(parseArg("--beforePhoneTypeMs", "650"));
const afterPhoneTypeMs = Number(parseArg("--afterPhoneTypeMs", "450"));
const countryReadyMaxMs = Number(parseArg("--countryReadyMaxMs", "8000"));
const perKeyDelay = Number(parseArg("--perKeyDelay", "80"));

const afterFillMs = Number(parseArg("--afterFillMs", "900"));
const afterClickCallMs = Number(parseArg("--afterClickCallMs", "1000"));
const waitTelMaxMs = Number(parseArg("--waitTelMaxMs", "12000"));

const retryClickCall = Boolean(parseArg("--retryClickCall", false));
const saveShots = Boolean(parseArg("--saveShots", false));

let last = null;

for (let i = 1; i <= loops; i++) {
  console.log(`\n---- run ${i}/${loops}`);
  console.log(url);

  last = await resolveEncuentra24PhoneFromListing(url, {
    enable_stage2: true,
    headless: !headed,
    prefer: "call_first",
    saveShots,
    delays: {
      beforePhoneTypeMs,
      afterPhoneTypeMs,
      countryReadyMaxMs,
      perKeyDelay,
      afterFillMs,
      afterClickCallMs,
      waitTelMaxMs,
      retryClickCall,
    },
    form: { email, name, phone8, message },
  });

  console.log(JSON.stringify(last, null, 2));
}

console.log("\n[FINAL]", last?.ok ? "✅ TELÉFONO CONFIRMADO" : "❌ No se pudo revelar teléfono");
if (last?.ok) {
  console.log(JSON.stringify({
    phone_e164: last.phone_e164,
    wa_link: last.wa_link,
    method: last.method,
    seller: last.seller_name,
    seller_profile_url: last.seller_profile_url,
  }, null, 2));
}
