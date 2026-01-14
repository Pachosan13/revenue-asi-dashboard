import http from "http";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const VOICE_GATEWAY_TOKEN = String(process.env.VOICE_GATEWAY_TOKEN ?? "").trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY ?? "").trim();
const VOICE_TEST_MODE = String(process.env.VOICE_TEST_MODE ?? "").trim() === "1" || String(process.env.VOICE_TEST_MODE ?? "").trim().toLowerCase() === "true";
const VOICE_CARRIER_PRIMARY_RAW = String(process.env.VOICE_CARRIER_PRIMARY ?? "twilio").trim().toLowerCase();
const VOICE_CARRIER_PRIMARY = (VOICE_CARRIER_PRIMARY_RAW === "telnyx" || VOICE_CARRIER_PRIMARY_RAW === "twilio") ? VOICE_CARRIER_PRIMARY_RAW : "twilio";
const OPENAI_TEXT_MODEL = String(process.env.OPENAI_TEXT_MODEL ?? "gpt-4.1-mini").trim();

// OpenAI Realtime WS
const OPENAI_REALTIME_MODEL = String(process.env.OPENAI_REALTIME_MODEL ?? "gpt-4o-realtime-preview").trim();
const OPENAI_REALTIME_URL = String(
  process.env.OPENAI_REALTIME_URL ??
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(OPENAI_REALTIME_MODEL)}`
).trim();

const SUPABASE_VOICE_HANDOFF_URL = String(process.env.SUPABASE_VOICE_HANDOFF_URL ?? "").trim();
const SUPABASE_VOICE_HANDOFF_TOKEN = String(process.env.SUPABASE_VOICE_HANDOFF_TOKEN ?? "").trim();

// Tuning knobs (defaults per spec; env overrides allowed)
// NOTE: RMS is normalized 0..1 (we divide int16 RMS by 32768).
const BARGE_IN_RMS = Number(process.env.BARGE_IN_RMS ?? "0.010");
const SPEAKING_RECENT_MS = Number(process.env.SPEAKING_RECENT_MS ?? "1200");
const DROP_AUDIO_MS = Number(process.env.DROP_AUDIO_MS ?? "120");
const BARGE_IN_DEBOUNCE_MS = Number(process.env.BARGE_IN_DEBOUNCE_MS ?? "0");
const MIN_CANCEL_INTERVAL_MS = Number(process.env.MIN_CANCEL_INTERVAL_MS ?? "120");
const BARGE_IN_SUSTAIN_MS = Number(process.env.BARGE_IN_SUSTAIN_MS ?? "80"); // require sustained energy above threshold
const VAD_THROTTLE_MS = Number(process.env.VAD_THROTTLE_MS ?? "0");
const MAX_STAGE_REPEATS = Number(process.env.MAX_STAGE_REPEATS ?? "2");
const MIN_COMMIT_BYTES = 3200; // 100ms at 16kHz PCM16 (16000 * 0.1 * 2)
const NO_COMMIT_BACKOFF_MS = 2500;
const TTS_ECHO_RMS_MIN = 0.0075;

// “Speed”: Realtime doesn’t expose true playback speed reliably.
// Best proxy: tighter phrasing + higher turn frequency + less tokens + no pauses.
const MAX_TOKENS_PER_TURN = Number(process.env.MAX_TOKENS_PER_TURN ?? "60");
const VOICE_NAME = String(process.env.OPENAI_VOICE ?? "alloy").trim();

// Deterministic TTS for ZERO drift (we do NOT let the model speak freely)
const OPENAI_TTS_MODEL = String(process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts").trim() || "gpt-4o-mini-tts";
const OPENAI_TTS_VOICE = String(process.env.OPENAI_TTS_VOICE ?? "alloy").trim();
// Prefer TTS_SPEED (new); fallback to legacy OPENAI_TTS_SPEED.
const TTS_SPEED = Number(process.env.TTS_SPEED ?? process.env.OPENAI_TTS_SPEED ?? "1.2");

// Telnyx Call Control API key (optional; used only for hangup on done)
const TELNYX_API_KEY = String(process.env.TELNYX_API_KEY ?? process.env.Telnyx_Api ?? "").trim();

function estMsForText(text, speed) {
  const s = String(text || "").trim();
  const words = s ? s.split(/\s+/).length : 0;
  const sp = Number(speed || 1.2) || 1.2;
  const ms = (words * 260) / sp;
  return Math.max(900, Math.floor(ms));
}

function nowMs() {
  return Date.now();
}

function jlog(obj) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
}

// Process-level safety: never crash the gateway from uncaught async errors.
// IMPORTANT: do NOT call process.exit() here. Health checks must keep working.
process.on("uncaughtException", (err) => {
  try {
    jlog({ event: "PROC_FATAL", kind: "uncaughtException", err: String(err?.stack || err?.message || err) });
  } catch {}
});

process.on("unhandledRejection", (reason) => {
  try {
    jlog({ event: "PROC_FATAL", kind: "unhandledRejection", err: String(reason?.stack || reason?.message || reason) });
  } catch {}
});

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function safeBase64Json(s) {
  if (!s) return null;
  try {
    return JSON.parse(Buffer.from(String(s), "base64").toString("utf8"));
  } catch {
    const j = safeJsonParse(String(s));
    return j;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ──────────────────────────────────────────────────────────────
// Audio helpers (μ-law PCMU 8k <-> PCM16 16k)
// ──────────────────────────────────────────────────────────────
const MULAW_DECODE_TABLE = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    let mu = ~i;
    let sign = (mu & 0x80) ? -1 : 1;
    let exponent = (mu >> 4) & 0x07;
    let mantissa = mu & 0x0f;
    let magnitude = ((mantissa << 1) + 1) << (exponent + 2);
    table[i] = sign * (magnitude - 33);
  }
  return table;
})();

function mulawToPcm16LEBytes(mulawBytes) {
  const out = Buffer.allocUnsafe(mulawBytes.length * 2);
  for (let i = 0; i < mulawBytes.length; i++) {
    const s = MULAW_DECODE_TABLE[mulawBytes[i]];
    out.writeInt16LE(s, i * 2);
  }
  return out;
}

function pcm16beToPcm16le(pcm16beBuf) {
  const out = Buffer.allocUnsafe(pcm16beBuf.length);
  for (let i = 0; i < pcm16beBuf.length; i += 2) {
    out[i] = pcm16beBuf[i + 1];
    out[i + 1] = pcm16beBuf[i];
  }
  return out;
}

function pcm16leToPcm16be(pcm16leBuf) {
  const out = Buffer.allocUnsafe(pcm16leBuf.length);
  for (let i = 0; i < pcm16leBuf.length; i += 2) {
    out[i] = pcm16leBuf[i + 1];
    out[i + 1] = pcm16leBuf[i];
  }
  return out;
}

function pcm16leUpsample2x(pcm16leBuf) {
  const sampleCount = pcm16leBuf.length / 2;
  if (sampleCount < 2) return pcm16leBuf;
  const out = Buffer.allocUnsafe((sampleCount * 2 - 1) * 2);
  let outIdx = 0;
  for (let i = 0; i < sampleCount - 1; i++) {
    const a = pcm16leBuf.readInt16LE(i * 2);
    const b = pcm16leBuf.readInt16LE((i + 1) * 2);
    const mid = ((a + b) / 2) | 0;
    out.writeInt16LE(a, outIdx); outIdx += 2;
    out.writeInt16LE(mid, outIdx); outIdx += 2;
  }
  out.writeInt16LE(pcm16leBuf.readInt16LE((sampleCount - 1) * 2), outIdx);
  return out;
}

function pcm16leDownsample2x(pcm16leBuf) {
  const sampleCount = pcm16leBuf.length / 2;
  const outSamples = Math.floor(sampleCount / 2);
  const out = Buffer.allocUnsafe(outSamples * 2);
  let outIdx = 0;
  for (let i = 0; i < outSamples; i++) {
    const s = pcm16leBuf.readInt16LE(i * 4);
    out.writeInt16LE(s, outIdx);
    outIdx += 2;
  }
  return out;
}

function pcm16leRms(pcm16leBuf) {
  const n = pcm16leBuf.length / 2;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = pcm16leBuf.readInt16LE(i * 2);
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

function pcm16ToMulawByte(sample) {
  let s = Math.max(-32768, Math.min(32767, sample));
  let sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  s = s + 33;
  let exponent = 7;
  for (let expMask = 0x4000; (s & expMask) === 0 && exponent > 0; expMask >>= 1) exponent--;
  let mantissa = (s >> (exponent + 3)) & 0x0f;
  let mu = ~(sign | (exponent << 4) | mantissa);
  return mu & 0xff;
}

function pcm16leToMulaw(pcm16leBuf) {
  const n = pcm16leBuf.length / 2;
  const out = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) out[i] = pcm16ToMulawByte(pcm16leBuf.readInt16LE(i * 2));
  return out;
}

function getSessionLang(session) {
  return (session?.lang || session?.language || session?.locale_lang || "es");
}

function responseInstructions(session) {
  const lang = getSessionLang(session);
  return lang === "en" ? "Reply briefly in English." : "Responde breve en español.";
}

function detectIntent(text) {
  if (!text) return { intent: "OTHER", reason: "empty_text" };
  const t = text.toLowerCase().trim();

  // Precedence: NO -> OBJECTION -> QUESTION -> YES -> OTHER
  if (/\b(no|no gracias|no me interesa|ya vendí|ya lo vendí|no quiero|no puedo|no puedo ahora)\b/.test(t)) {
    return { intent: "NO", reason: "match_no_phrase" };
  }

  const objectionWord = (["pero", "aunque", "ahorita no", "después", "luego", "más tarde", "mas tarde", "ahora no", "no puedo ahora", "tal vez", "depende"].find((w) => t.includes(w))) || null;
  if (objectionWord) {
    return { intent: "OBJECTION", reason: `contains_objection:${objectionWord}` };
  }

  if (t.includes("?") || /(?:\b)(quién|quien|como|cómo|cuando|cuándo|por qué|porque|qué|que|para qué|para que|dónde|donde)(?:\b)/.test(t)) {
    return { intent: "QUESTION", reason: "question_marker" };
  }

  if (/\b(sí|si|claro|ok|dale|perfecto|me parece|está bien|esta bien|quiero)\b/.test(t)) {
    return { intent: "YES", reason: "yes_clean_candidate" };
  }

  return { intent: "OTHER", reason: "fallback" };
}

function sendResponse(session, text) {
  try {
    session.openai?.ws?.send(JSON.stringify({
      type: "response.create",
      response: { modalities: ["text"], instructions: text },
    }));
    session.openai_response_active = true;
    jlog({ event: "RESPONSE_CREATE_SENT", session_id: session.session_id, ts: new Date().toISOString() });
  } catch {}
}

function emitClarification(session, detail) {
  const lang = getSessionLang(session);
  const reason = (detail && typeof detail === "object") ? detail.reason : "";
  if (reason === "asr_sanity_reject") {
    const msg = lang === "en"
      ? "Sorry, it cut out—can you repeat that?"
      : "Perdón, se escuchó cortado. ¿Me lo repites?";
    sendResponse(session, msg);
    return;
  }
  const text = typeof detail === "string" ? detail : `
Entiendo.
Antes de seguir, te explico rápido:
solo queremos conectarte con una persona interesada en el carro.
¿Te parece bien que te cuente en 20 segundos?
`.trim();
  sendResponse(session, text);
}

function emitPoliteExit(session) {
  sendResponse(session, `
Perfecto, no hay problema.
Gracias por tu tiempo.
Que tengas buen día.
`.trim());
}

function emitNudge(session) {
  sendResponse(session, `
Para no quitarte tiempo:
¿el carro ya lo vendiste o todavía lo tienes?
`.trim());
}

function isLikelyGarbage(text) {
  if (!text) return true;
  if (text.length < 3) return true;
  if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text)) return true; // CJK
  const alnum = (text.match(/[a-z0-9áéíóúñü]/gi) || []).length;
  const ratio = alnum / Math.max(1, text.length);
  if (ratio < 0.25) return true;
  return false;
}

function downsamplePcm16leTo8k(pcm16leBuf, sampleRate) {
  // crude but ok for voice prompts: handle 16k/24k/48k -> 8k
  const sr = Number(sampleRate || 24000);
  if (sr === 8000) return pcm16leBuf;
  if (sr === 16000) return pcm16leDownsample2x(pcm16leBuf);
  if (sr === 24000) {
    // take every 3rd sample
    const inSamples = pcm16leBuf.length / 2;
    const outSamples = Math.floor(inSamples / 3);
    const out = Buffer.allocUnsafe(outSamples * 2);
    for (let i = 0; i < outSamples; i++) {
      const s = pcm16leBuf.readInt16LE(i * 6);
      out.writeInt16LE(s, i * 2);
    }
    return out;
  }
  if (sr === 48000) {
    // take every 6th sample
    const inSamples = pcm16leBuf.length / 2;
    const outSamples = Math.floor(inSamples / 6);
    const out = Buffer.allocUnsafe(outSamples * 2);
    for (let i = 0; i < outSamples; i++) {
      const s = pcm16leBuf.readInt16LE(i * 12);
      out.writeInt16LE(s, i * 2);
    }
    return out;
  }
  // fallback: nearest neighbor ratio
  const ratio = sr / 8000;
  const inSamples = pcm16leBuf.length / 2;
  const outSamples = Math.floor(inSamples / ratio);
  const out = Buffer.allocUnsafe(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const srcIdx = Math.floor(i * ratio);
    const s = pcm16leBuf.readInt16LE(srcIdx * 2);
    out.writeInt16LE(s, i * 2);
  }
  return out;
}

function resamplePcm16leTo16k(pcm16leBuf, sampleRate) {
  // Nearest-neighbor resample to 16k (good enough for VAD / turn-taking tests).
  const sr = Number(sampleRate || 16000);
  if (sr === 16000) return pcm16leBuf;
  if (sr === 8000) return pcm16leUpsample2x(pcm16leBuf);
  const inSamples = Math.floor(pcm16leBuf.length / 2);
  if (inSamples <= 1) return pcm16leBuf;
  const ratio = sr / 16000;
  const outSamples = Math.max(1, Math.floor(inSamples / ratio));
  const out = Buffer.allocUnsafe(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const srcIdx = Math.min(inSamples - 1, Math.floor(i * ratio));
    const s = pcm16leBuf.readInt16LE(srcIdx * 2);
    out.writeInt16LE(s, i * 2);
  }
  return out;
}

function wavToPcm16le(wavBytes) {
  // Minimal RIFF/WAVE PCM16 parser
  const b = Buffer.from(wavBytes);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") {
    return { ok: false, error: "not_wav", sampleRate: null, channels: null, pcm16le: null };
  }
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    off += 8;
    if (id === "fmt ") {
      const audioFormat = b.readUInt16LE(off);
      const channels = b.readUInt16LE(off + 2);
      const sampleRate = b.readUInt32LE(off + 4);
      const bitsPerSample = b.readUInt16LE(off + 14);
      fmt = { audioFormat, channels, sampleRate, bitsPerSample };
    } else if (id === "data") {
      data = b.slice(off, off + size);
      break;
    }
    off += size;
  }
  if (!fmt || !data) return { ok: false, error: "missing_chunks", sampleRate: null, channels: null, pcm16le: null };
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    return { ok: false, error: `unsupported_wav_fmt_${fmt.audioFormat}_${fmt.bitsPerSample}`, sampleRate: fmt.sampleRate, channels: fmt.channels, pcm16le: null };
  }
  // assume little endian PCM16
  return { ok: true, sampleRate: fmt.sampleRate, channels: fmt.channels, pcm16le: data };
}

const ttsCache = new Map(); // text -> { mulawFramesB64: string[] }

async function openaiTtsWav(text) {
  if (!OPENAI_API_KEY) return { ok: false, error: "missing_openai_api_key", wav: null };
  if (!OPENAI_TTS_MODEL) return { ok: false, error: "missing_openai_tts_model", wav: null };
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: OPENAI_TTS_VOICE,
      input: String(text || ""),
      // OpenAI expects response_format; if omitted it may default to mp3, which breaks our WAV parser.
      response_format: "wav",
      speed: TTS_SPEED,
    }),
  });
  const ct = String(res.headers.get("content-type") || "");
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, error: `tts_http_${res.status}:${ct}:${txt.slice(0, 200)}`, wav: null };
  }
  const wav = Buffer.from(await res.arrayBuffer());
  // Safety: verify RIFF header early to produce a useful error message
  if (wav.toString("ascii", 0, 4) !== "RIFF") {
    return { ok: false, error: `tts_not_wav:${ct}:magic=${wav.toString("ascii", 0, 4)}`, wav: null };
  }
  return { ok: true, wav };
}

async function getMulawFramesForText(text) {
  const key = String(text || "").trim();
  if (!key) return { ok: false, error: "empty_text", mulawFramesB64: [] };
  const cached = ttsCache.get(key);
  if (cached) return { ok: true, mulawFramesB64: cached.mulawFramesB64 };

  const tts = await openaiTtsWav(key);
  if (!tts.ok || !tts.wav) return { ok: false, error: tts.error || "tts_failed", mulawFramesB64: [] };

  const parsed = wavToPcm16le(tts.wav);
  if (!parsed.ok || !parsed.pcm16le) return { ok: false, error: parsed.error || "wav_parse_failed", mulawFramesB64: [] };

  // Downmix if stereo (take left channel)
  let pcm16le = parsed.pcm16le;
  if (parsed.channels && parsed.channels > 1) {
    const frames = pcm16le.length / 2 / parsed.channels;
    const mono = Buffer.allocUnsafe(frames * 2);
    for (let i = 0; i < frames; i++) {
      mono.writeInt16LE(pcm16le.readInt16LE(i * 2 * parsed.channels), i * 2);
    }
    pcm16le = mono;
  }

  const pcm8k = downsamplePcm16leTo8k(pcm16le, parsed.sampleRate);
  const mulaw = pcm16leToMulaw(pcm8k);

  // 20ms frames @ 8k = 160 samples = 160 bytes μ-law
  const frameBytes = 160;
  const frames = [];
  for (let i = 0; i < mulaw.length; i += frameBytes) {
    frames.push(mulaw.slice(i, i + frameBytes).toString("base64"));
  }
  const obj = { mulawFramesB64: frames };
  ttsCache.set(key, obj);
  return { ok: true, mulawFramesB64: frames };
}

function stopOutboundPlayback(session) {
  if (session._playbackTimer) {
    clearInterval(session._playbackTimer);
    session._playbackTimer = null;
  }
  session._playbackFrames = null;
  session._playbackIdx = 0;
}

async function telnyxHangup(callControlId) {
  const ccid = String(callControlId || "").trim();
  if (!ccid) return { ok: false, error: "missing_call_control_id" };
  if (!TELNYX_API_KEY) return { ok: false, error: "missing_telnyx_api_key" };
  try {
    const url = `https://api.telnyx.com/v2/calls/${encodeURIComponent(ccid)}/actions/hangup`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const txt = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body: txt.slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function playDeterministicLine(session, text) {
  // TEMPLATE-ONLY speech: before any TTS/outbound, enforce strict templates only.
  const source =
    (session?.source ? String(session.source) : null) ??
    (session?.client_state?.source ? String(session.client_state.source) : null) ??
    "encuentra24";
  const hotAlready = Boolean(session?.qual?.hot_announced);
  const safeText = templateEnforce(String(session?.stage || "available"), String(text || ""), source, hotAlready, session?.session_id ?? null);
  const framesRes = await getMulawFramesForText(safeText);
  if (!framesRes.ok) {
    jlog({ event: "TTS_FAIL", session_id: session.session_id, err: framesRes.error });
    return;
  }
  stopOutboundPlayback(session);
  session._playbackFrames = framesRes.mulawFramesB64;
  session._playbackIdx = 0;
  session.speaking = true;
  session.lastSpeakAt = nowMs();
  const startAt = nowMs();
  jlog({ event: "TTS_PLAY_START", session_id: session.session_id, stage: session.stage, text: safeText });
  session.tts_playing = true;

  // Send frames every 20ms
  session._playbackTimer = setInterval(() => {
    if (!session._playbackFrames) return;
    // If the human is speaking (OpenAI VAD), stop immediately (barge-in hard stop).
    if (session.humanSpeaking) {
      stopOutboundPlayback(session);
      session.speaking = false;
      jlog({ event: "TTS_PLAY_STOPPED_FOR_BARGE_IN", session_id: session.session_id });
      return;
    }
    if (session.dropAudioUntil && nowMs() < session.dropAudioUntil) return;
    const frame = session._playbackFrames[session._playbackIdx++];
    if (!frame) {
      stopOutboundPlayback(session);
      session.speaking = false;
      jlog({ event: "TTS_PLAY_END", session_id: session.session_id, ms: nowMs() - startAt });
      session.tts_playing = false;
      // If there is a queued template, play it next (used for greet->availability).
      if (Array.isArray(session._playbackQueue) && session._playbackQueue.length) {
        const nextText = session._playbackQueue.shift();
        if (nextText) {
          // Small pause between emits if needed (helps pacing on some carriers)
          setTimeout(() => {
            playDeterministicLine(session, String(nextText)).catch(() => {});
          }, 150);
        }
      }
      return;
    }
    try {
      sendCarrierMedia(session, frame);
    } catch {}
  }, 20);
}

function sendCarrierMedia(session, frameB64) {
  if (session?.twilio?.ws && session.twilio.streamSid) {
    session.twilio.ws.send(JSON.stringify({ event: "media", streamSid: session.twilio.streamSid, media: { payload: frameB64 } }), { compress: false });
    return;
  }
  if (session?.telnyx?.ws) {
    session.telnyx.ws.send(JSON.stringify({ event: "media", media: { payload: frameB64 } }), { compress: false });
  }
}

// ──────────────────────────────────────────────────────────────
// Session + state machine
// ──────────────────────────────────────────────────────────────
const sessions = new Map(); // stream_id -> session
const twilioSessions = new Map(); // streamSid -> session
const testSessions = new Map(); // session_id -> { session_id, stage, source, qual, testMock, emittedAvailability, busy }

function makeBaseSession() {
  return {
    session_id: crypto.randomUUID(),
    stream_id: null,
    call_control_id: null,
    client_state: null,

    telnyx: null,
    twilio: null,
    openai: null,
    has_active_response: false,

    // behavior state
    source: "encuentra24",
    stage: "greet",
    stageRepeats: 0,
    qual: { available: null, urgent: null },

    speaking: false,
    lastSpeakAt: 0,
    speaking_until: 0,
    inSpeech: false,
    speechStartAt: 0,
    lastVadAt: 0,
    _lastVadIgnoredAt: 0,
    dropAudioUntil: 0,
    lastUserTurnAt: 0,
    lastCancelAt: 0,
    lastBargeInAt: 0,
    rmsAboveSince: 0,

    textBuf: "",
    _lastUserText: "",
    _lastBotPrompt: "",
    _pendingSpeak: null,
    _pendingQueue: null,
    bytes_since_commit: 0,
    last_commit_empty_at: 0,
    last_transcript_at: 0,
    last_transcript_len: 0,
    tts_playing: false,
    last_audio_append_at: 0,
    last_inbound_rms: 0,
    openai_speaking: false,
    openai_response_active: false,
    last_intent: "OTHER",
    awaiting_yes_confirmation: false,
    yes_confirmed: false,
  };
}

function handleInboundAudioToOpenAi(sess, { payloadB64, isInbound, enc, sr, track }) {
  // aggressive barge-in on inbound track (normalized RMS + cooldown)
  const _enc = String(enc || "PCMU").toUpperCase();
  const _sr = Number(sr || 8000);

  let pcm16_src = null;
  let rms = 0;
  try {
    if (_enc === "L16") {
      const be = Buffer.from(String(payloadB64), "base64");
      const le = pcm16beToPcm16le(be);
      pcm16_src = _sr === 8000 ? pcm16leDownsample2x(le) : le;
      rms = pcm16leRms(pcm16_src);
    } else {
      const mulaw = Buffer.from(String(payloadB64), "base64");
      pcm16_src = mulawToPcm16LEBytes(mulaw);
      rms = pcm16leRms(pcm16_src);
    }
  } catch {}

  const rmsNorm = rms / 32768;
  const now = nowMs();
  const speakingRecently = sess.speaking && (now - sess.lastSpeakAt < SPEAKING_RECENT_MS);
  const sinceLastCancelMs = sess.lastCancelAt ? (now - sess.lastCancelAt) : null;
  const debounced = sess.lastBargeInAt && (now - sess.lastBargeInAt < BARGE_IN_DEBOUNCE_MS);

  // Sustain requirement: RMS must be above threshold for a short window to avoid micro-spikes.
  if (isInbound && speakingRecently && rmsNorm >= BARGE_IN_RMS) {
    if (!sess.rmsAboveSince) sess.rmsAboveSince = now;
  } else {
    sess.rmsAboveSince = 0;
  }

  const sustainedOk = sess.rmsAboveSince && (now - sess.rmsAboveSince >= BARGE_IN_SUSTAIN_MS);

  if (
    isInbound &&
    speakingRecently &&
    sustainedOk &&
    !debounced &&
    (!sinceLastCancelMs || sinceLastCancelMs >= MIN_CANCEL_INTERVAL_MS)
  ) {
    sess.lastBargeInAt = now;
    jlog({ event: "BARGE_IN_TRIGGER", reason: "rms", rms: rmsNorm, sinceLastCancelMs });
    try { sess.openai?.ws?.send(JSON.stringify({ type: "response.cancel" })); } catch {}
    sess.lastCancelAt = now;
    jlog({ event: "AI_CANCEL_SENT" });
    stopOutboundPlayback(sess);
    sess.speaking = false;
    sess.dropAudioUntil = now + DROP_AUDIO_MS;
    jlog({ event: "OUTBOUND_AUDIO_DROPPED", bufferFrames: 0, approxMs: DROP_AUDIO_MS });
    sess.rmsAboveSince = 0;
  }

  // Send audio to OpenAI
  if (sess.openai?.ws?.readyState === WebSocket.OPEN) {
    let pcm16le = null;
    if (pcm16_src) {
      pcm16le = _sr === 8000 ? pcm16leUpsample2x(pcm16_src) : pcm16_src;
    }
    if (!pcm16le) return;

    const frameCount = (sess._audioFrameCount || 0) + 1;
    sess._audioFrameCount = frameCount;
    const logAudio = frameCount % 20 === 0 || rmsNorm > 0.02;
    try { sess.bytes_since_commit = (sess.bytes_since_commit || 0) + pcm16le.length; } catch {}
    sess.last_audio_append_at = now;
    sess.last_inbound_rms = rmsNorm;

    if (sess.tts_playing && rmsNorm < TTS_ECHO_RMS_MIN) {
      if (logAudio) {
        jlog({
          event: "DROP_INBOUND_DURING_TTS",
          session_id: sess.session_id,
          rms: Number(rmsNorm.toFixed(4)),
          threshold: TTS_ECHO_RMS_MIN,
          tts_playing: true,
        });
      }
      return;
    }
    if (logAudio) {
      jlog({
        event: "TELNYX_AUDIO_IN",
        session_id: sess.session_id,
        bytes_pcmsrc: pcm16_src ? pcm16_src.length : 0,
        rms: Number(rmsNorm.toFixed(4)),
        track: track || (isInbound ? "inbound" : ""),
      });
    }

    sess.openai.ws.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: Buffer.from(pcm16le).toString("base64"),
    }));
    sess.openai.firstAudioSent = true;

    if (logAudio) {
      jlog({
        event: "OPENAI_AUDIO_APPEND",
        session_id: sess.session_id,
        bytes_pcm16_16k: pcm16le.length,
        bytes_since_commit: sess.bytes_since_commit || 0,
        tts_playing: Boolean(sess.tts_playing),
      });
    }
  }
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[áàä]/g, "a")
    .replace(/[éèë]/g, "e")
    .replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o")
    .replace(/[úùü]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractListingRef(session) {
  const listing = session?.client_state?.listing && typeof session.client_state.listing === "object" ? session.client_state.listing : null;
  const label = listing?.car_label ? String(listing.car_label) : null;
  const year = listing?.year ? String(listing.year) : null;
  const lead = label ? `${label}${year ? ` ${year}` : ""}` : "el carro";
  return lead;
}

function agentContextLine(session) {
  const src =
    (session?.source ? String(session.source) : null) ??
    (session?.client_state?.source ? String(session.client_state.source) : null) ??
    "encuentra24";
  if (VOICE_TEST_MODE) {
    // TEST MODE context (exact, no car details)
    return `Te llamo por el anuncio del carro que subiste en ${src}. Soy comprador y quiero comprar rápido. Solo confirmo si está disponible y coordinamos para verlo.`;
  }
  return `Te llamo por el anuncio del carro que subiste en ${src}. Soy comprador y quiero comprar rápido. Solo confirmo si está disponible y coordinamos para verlo.`;
}

function stagePrompt(stage, source, hot) {
  // TEMPLATE-ONLY: return EXACT strings only.
  const s = String(stage || "");
  const src = String(source || "internet");
  if (s === "greet") return `Hola, ¿qué tal? Te llamo por el anuncio del carro que publicaste en ${src}. ¿Eres el dueño?`;
  if (s === "availability") return "Perfecto. ¿Todavía lo tienes disponible?";
  if (s === "urgency") return "Buenísimo. ¿Lo estás vendiendo ya — hoy o mañana?";
  if (s === "schedule") return "Perfecto. ¿Podemos verlo hoy o mañana? ¿A qué hora te queda bien?";
  if (s === "done") return hot
    ? "Listo. Ya le paso tu número a Darmesh que está interesado. Gracias."
    : "Perfecto, gracias. Si decides venderlo pronto, me avisas.";
  return "Perfecto. ¿Todavía lo tienes disponible?";
}

function templateEnforce(stage, assistantText, source, hotAlready, session_id) {
  const s = String(stage || "availability");
  const src = String(source || "internet");
  const original = String(assistantText || "").trim();

  // Seller-only guardrail: block buyer/advice/comparison drift and return the stage question.
  const buyerIntent =
    /\b(buy|purchase|recommend|which car|should i buy|compare|comparison|versus|vs\.?|trim|model|engine|horsepower|mpg|0-60|jeep wrangler)\b/i;
  if (buyerIntent.test(original)) {
    jlog({ event: "TEMPLATE_BLOCK_BUYER_INTENT", stage: s, session_id: session_id ?? null, preview: original.slice(0, 120) });
    if (s === "greet") return stagePrompt("greet", src, false);
    if (s === "availability") return stagePrompt("availability", src, false);
    if (s === "urgency") return stagePrompt("urgency", src, false);
    if (s === "schedule") return stagePrompt("schedule", src, false);
    if (s === "done") return hotAlready ? stagePrompt("done", src, true) : stagePrompt("done", src, false);
    return stagePrompt("availability", src, false);
  }

  const greet = stagePrompt("greet", src, false);
  const qAvail = stagePrompt("availability", src, false);
  const qUrg = stagePrompt("urgency", src, false);
  const qSched = stagePrompt("schedule", src, false);
  const doneHot = stagePrompt("done", src, true);
  const doneNo = stagePrompt("done", src, false);

  const allowed = new Set([greet, qAvail, qUrg, qSched, doneHot, doneNo]);
  if (allowed.has(original)) return original;

  // If drift/off-template, fall back to the current stage question (or done line).
  if (s === "greet") return greet;
  if (s === "availability") return qAvail;
  if (s === "urgency") return qUrg;
  if (s === "schedule") return qSched;
  if (s === "done") return hotAlready ? doneHot : doneNo;
  return qAvail;
}

function lockedSystemInstructions(session) {
  // STRICTEST possible system message (non-negotiable)
  return [
    "Eres un operador/comprador. Llamas SOLO para confirmar que la persona está VENDIENDO el carro y coordinar una visita rápida.",
    "NO das consejos. NO recomiendas compras. NO comparas modelos. NO opinas sobre marcas. NO hablas de features, precio, year, trim, mods.",
    "Tu flujo es una máquina de estados. UNA pregunta por turno. Estados:",
    "1) availability: “¿El carro sigue disponible?”",
    "2) urgency: “¿Lo quieres vender hoy o mañana?”",
    "3) zone: “¿En qué zona estás?”",
    "4) time: “¿A qué hora te va bien hoy?”",
    "Normaliza respuestas a YES/NO cuando aplique.",
    "HOT = availability=YES y urgency=YES.",
    "Cuando HOT=TRUE, dices EXACTAMENTE: “Perfecto. Ya le paso tu número a Darmesh que está interesado en el carro.” Luego sigues stages.",
    "Si el usuario pregunta por consejos de compra o tema de carros, responde EXACTAMENTE: “No te puedo asesorar en compras. Solo confirmo disponibilidad y coordinamos para verlo rápido.” y vuelves al stage actual.",
    "Si detectas que NO está vendiendo / es comprador / no aplica: “Perfecto, gracias. Yo estoy contactando solo vendedores. Buen día.” y termina.",
    "No hagas multi-preguntas. Nunca más de una pregunta por turno.",
  ].join(" ");
}

function stageQuestion(stage, session) {
  const src = session?.client_state?.source ? String(session.client_state.source) : "internet";
  return stagePrompt(stage, src, false);
}

const LINES = {
  Q_AVAILABLE: stagePrompt("available", "internet", false),
  Q_URGENCY: stagePrompt("urgency", "internet", false),
  Q_ZONE: stagePrompt("zone", "internet", false),
  Q_TIME: stagePrompt("time", "internet", false),
  HOT_LINE: stagePrompt("hot_line", "internet", true),
  REFUSAL: stagePrompt("refuse_buy_advice", "internet", false),
  NOT_SELLER: stagePrompt("not_seller_end", "internet", false),
};

function guardAssistantText(stage, text, hotAlready, source) {
  const original = String(text || "").trim();
  const s = String(stage || "available");

  // Force one-question-per-turn: if multiple question marks, reduce to stage question.
  const questionCount = (original.match(/¿/g) || []).length;
  if (questionCount > 1) {
    return {
      ok: false,
      reason: "multi_question",
      text: stageQuestion(s, { client_state: { source } }),
    };
  }

  const blocklist = [
    { name: "purchase_advice", re: /(te recomiendo|recomiendo|compra|comprar|mejor compra|yo comprar[ií]a|vale la pena|opini[oó]n|review|reseña|comparar|versus|vs\.?)/i },
    { name: "car_talk", re: /(wrangler|toyota|honda|nissan|bmw|mercedes|jeep|ford|chevrolet|kia|hyundai|tesla|mazda|subaru|audi|lexus|volkswagen|volvo|porsche|ferrari|lamborghini)/i },
    { name: "features_trim", re: /(4x4|awd|fwd|rwd|cvt|turbo|hp|caballos|cilindra|cilindrada|motor|transmisi[oó]n|autom[aá]tica|manual|kil[oó]metros|millas|mileage|sunroof|cuero|pantalla|sensor|c[aá]mara)/i },
    { name: "pricing", re: /(precio|barato|caro|negociar|oferta|financiar|leasing|cr[eé]dito)/i },
  ];
  for (const b of blocklist) {
    if (b.re.test(original)) {
      return { ok: false, reason: "regex", text: LINES.REFUSAL };
    }
  }

  // Stage allowlist (hard)
  const allow = new Set();
  if (s === "available") { allow.add(LINES.Q_AVAILABLE); allow.add(LINES.REFUSAL); allow.add(LINES.NOT_SELLER); }
  if (s === "urgency") { allow.add(LINES.Q_URGENCY); allow.add(LINES.REFUSAL); allow.add(LINES.NOT_SELLER); }
  if (s === "zone") { allow.add(LINES.Q_ZONE); allow.add(LINES.REFUSAL); allow.add(LINES.NOT_SELLER); if (!hotAlready) {} }
  if (s === "time") { allow.add(LINES.Q_TIME); allow.add(LINES.REFUSAL); allow.add(LINES.NOT_SELLER); }
  if (s === "done") { allow.add(LINES.HOT_LINE); allow.add(LINES.REFUSAL); allow.add(LINES.NOT_SELLER); }

  if (original === LINES.HOT_LINE) {
    if (s !== "zone" || hotAlready) return { ok: false, reason: "allowlist", text: LINES.REFUSAL };
    return { ok: true, reason: null, text: original };
  }

  if (!allow.has(original)) {
    return { ok: false, reason: "allowlist", text: stageQuestion(s, { client_state: { source } }) };
  }

  return { ok: true, reason: null, text: original };
}

function isYes(text) {
  const t = normalizeText(text);
  return /\b(si|sii|claro|correcto|asi es|aj[aá]|dale|ok)\b/.test(t);
}

function isNo(text) {
  const t = normalizeText(text);
  return /\b(no|nopo|negativo|ya se vendio|vendido|no esta)\b/.test(t);
}

function isUrgentYes(text) {
  const t = normalizeText(text);
  // selling soon: today/tomorrow/ya/rápido/urgente
  return /\b(hoy|manana|ya|rapido|urgente|lo antes posible|esta semana)\b/.test(t) || isYes(t);
}

function isUrgentNo(text) {
  const t = normalizeText(text);
  return /\b(no hay apuro|sin apuro|tranquilo|cuando pueda|mas adelante|no se)\b/.test(t) || isNo(t);
}

function hotDecisionFromQual(qual) {
  const a = qual?.available;
  const u = qual?.urgent;
  const availableYes = a === true || a === "yes";
  const urgentYes = u === true || u === "yes";
  return { availableYes, urgentYes, hot: availableYes && urgentYes };
}

async function emitPromptForStage(session, stage) {
  const stg = String(stage || session?.stage || "availability");
  const src =
    (session?.source ? String(session.source) : null) ??
    (session?.client_state?.source ? String(session.client_state.source) : null) ??
    "encuentra24";

  const { hot } = hotDecisionFromQual(session?.qual);
  const hotAlready = Boolean(session?.qual?.hot_announced);
  const text = stagePrompt(stg, src, hot);
  const safe = templateEnforce(stg, text, src, hotAlready, session?.session_id ?? null);

  // TELNYX mode: actually speak via deterministic TTS frames
  if (session?.telnyx?.ws) {
    // Keep stage in sync for logs
    session.stage = stg;
    // Speaking lock: ignore VAD while bot is speaking to prevent false stage advances.
    session.speaking_until = nowMs() + estMsForText(safe, TTS_SPEED) + 250;
    jlog({ event: "TELNYX_TEMPLATE_EMIT", session_id: session.session_id, stage: stg, text: safe });
    // Queue if already playing (used for greet->availability on open)
    if (session._playbackTimer) {
      session._playbackQueue = Array.isArray(session._playbackQueue) ? session._playbackQueue : [];
      session._playbackQueue.push(safe);
      return;
    }
    await playDeterministicLine(session, safe);
    return;
  }

  // TEST mode: do NOT send audio anywhere; just validate template-only output is synthesizable.
  const framesRes = await getMulawFramesForText(safe);
  if (!framesRes.ok) {
    jlog({ event: "TEST_TEMPLATE_AUDIO_FAIL", session_id: session.session_id, stage: stg, err: framesRes.error });
    return;
  }
  // VOICE_TEST_MODE: disable template emits (we use AI text + guardrails + TTS instead).
  if (!VOICE_TEST_MODE) {
    jlog({ event: "TEST_TEMPLATE_EMIT", session_id: session.session_id, stage: stg, text: safe, frames: framesRes.mulawFramesB64.length });
  }
}

function updateTestChecklistFromUserText(session, userText) {
  session.qual = session.qual || {};
  const t = String(userText || "").trim();
  const tl = t.toLowerCase();

  // owner
  if (session.qual.owner == null) {
    // If we're in greet and the user gives a simple yes/no, treat it as owner confirmation.
    // (Test-mode prequal: greet asks "Are you the owner of the car?")
    if (String(session?.stage || "") === "greet") {
      if (isYes(t)) session.qual.owner = true;
      else if (isNo(t)) session.qual.owner = false;
    }
    if (/\b(i am the owner|i'm the owner|yes,? i'm the owner|yes i am|i own it)\b/i.test(t)) session.qual.owner = true;
    else if (/\b(not the owner|i'm not the owner|i am not the owner|no,? i'm not)\b/i.test(t)) session.qual.owner = false;
  }

  // available
  if (session.qual.available == null) {
    if (/\b(sold|already sold|not available|no longer available)\b/i.test(t)) session.qual.available = false;
    else if (/\b(still available|available|still have it|i still have it|it is available|it's available)\b/i.test(t)) session.qual.available = true;
  }

  // location
  if (!session.qual.location) {
    const m = t.match(/\b(?:in|located in|near|around)\s+([A-Za-z][A-Za-z\s]{1,40})\b/i);
    if (m && m[1]) session.qual.location = m[1].trim().slice(0, 60);
  }

  // when
  if (!session.qual.when) {
    if (/\b(today|tomorrow|tonight|this afternoon|this morning)\b/i.test(t)) session.qual.when = t.slice(0, 80);
    const tm = t.match(/\b(\d{1,2}(:\d{2})?\s?(am|pm))\b/i);
    if (!session.qual.when && tm) session.qual.when = tm[0];
  }

  // phone
  if (!session.qual.phone) {
    const digits = tl.replace(/[^\d]/g, "");
    if (digits.length >= 7 && digits.length <= 15) {
      session.qual.phone = digits;
    }
  }
}

function nextTestQuestion(session) {
  const q = session?.qual || {};
  if (q.owner == null) return "Are you the owner of the car?";
  if (q.available == null) return "Is it still available?";
  if (!q.when) return "Can you meet today or tomorrow?";
  return "Quick one: today or tomorrow works better?";
}

function validateAiTestReply(session, draft) {
  let t = String(draft || "").replace(/\s+/g, " ").trim();
  // Shorten phrasing
  t = t.replace(/\bfor sale\b/gi, "").replace(/\s+/g, " ").trim();
  t = t.replace(/\bIs the car still available\b/gi, "Is it still available");
  // Remove obvious buying advice / negotiation / pricing content
  const forbidden = /(recommend|you should buy|good deal|worth it|price|budget|financing|loan|interest rate|trade[- ]?in)/i;
  if (forbidden.test(t)) t = "";

  // Enforce English (simple heuristic: if it looks Spanish, fall back)
  const looksSpanish = /[áéíóúñ]|\\b(hola|gracias|carro|dueñ|anuncio|vender|mañana|hoy|zona|n[uú]mero|tel[eé]fono)\\b/i.test(t);
  const nonAscii = /[^\x00-\x7F]/.test(t);
  if (!t || looksSpanish || nonAscii) t = nextTestQuestion(session);

  // One sentence only
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  t = parts.slice(0, 1).join(" ").trim();

  // Must end with a question
  if (!t.endsWith("?")) {
    // If there's a question mark inside, keep up to last one.
    const lastQ = t.lastIndexOf("?");
    if (lastQ >= 0) t = t.slice(0, lastQ + 1).trim();
    else t = (t.replace(/[.!]+$/g, "").trim() + "?").trim();
  }

  // Hard length cap
  if (t.length > 220) {
    t = t.slice(0, 220).trim();
    if (!t.endsWith("?")) t = t.replace(/[.!]+$/g, "").trim() + "?";
  }
  return t;
}

async function aiReplyAndEmitTest(session, userText) {
  // VOICE_TEST_MODE only
  updateTestChecklistFromUserText(session, userText);

  const fallbackQ = nextTestQuestion(session);
  const system = [
    "You are a car-seller prequalification caller.",
    "Goal: confirm owner, still available, can meet today/tomorrow (time window).",
    "Hard rules: English only. One sentence only. End with a question. Ask only one question at a time.",
    "No filler. No thanks. Use 'meet' (not 'discuss').",
    "Do NOT give buying advice. Do NOT compare cars. Do NOT recommend models. Do NOT discuss trims/engine/specs. Do NOT discuss price negotiation, financing, budgets, or opinions about the car.",
    `If the user asks buying advice or what car to buy, ignore it and ask exactly this question: \"${fallbackQ}\"`,
    "Be short, polite, and practical.",
  ].join(" ");

  const user = `User said: ${String(userText || "").trim()}`;

  let draft = "";
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_TEXT_MODEL,
        input: [
          { role: "system", content: [{ type: "input_text", text: system }] },
          { role: "user", content: [{ type: "input_text", text: user }] },
        ],
        max_output_tokens: 90,
        temperature: 0.2,
      }),
    });
    const j = await res.json().catch(() => null);
    // Tolerant extractor
    draft =
      (j && typeof j.output_text === "string" ? j.output_text : "") ||
      (Array.isArray(j?.output) ? (
        (() => {
          for (const item of j.output) {
            const c = item?.content;
            if (Array.isArray(c)) {
              for (const part of c) {
                if (part?.type === "output_text" && typeof part?.text === "string") return part.text;
              }
            }
          }
          return "";
        })()
      ) : "") ||
      "";
  } catch (e) {
    draft = "";
    jlog({ event: "TEST_AI_ERR", session_id: session.session_id, err: String(e?.message || e) });
  }

  jlog({ event: "TEST_AI_DRAFT", session_id: session.session_id, text: String(draft || "").slice(0, 160) });

  const validated = validateAiTestReply(session, draft || nextTestQuestion(session));
  jlog({ event: "TEST_AI_VALIDATED", session_id: session.session_id, text: String(validated || "").slice(0, 160) });

  try {
    const framesRes = await getMulawFramesForText(validated);
    if (!framesRes.ok) {
      jlog({ event: "TEST_TTS_FAIL", session_id: session.session_id, err: framesRes.error });
      return;
    }
    session._playbackFrames = framesRes.mulawFramesB64;
    session._playbackIdx = 0;
    jlog({ event: "TEST_TTS_FRAMES", session_id: session.session_id, frames: framesRes.mulawFramesB64.length });
  } catch (e) {
    jlog({ event: "TEST_TTS_FAIL", session_id: session.session_id, err: String(e?.message || e) });
  }
}

async function decideHotAndEmitDone(session) {
  const { availableYes, urgentYes, hot } = hotDecisionFromQual(session?.qual);
  const session_id = session?.session_id;

  // Test-mode log (keep existing)
  if (!session?.telnyx?.ws) {
    jlog({
      event: "TEST_HOT_DECISION",
      session_id,
      available: session?.qual?.available ?? null,
      urgent: session?.qual?.urgent ?? null,
      hot,
    });
  }

  // Mark hot line as announced so templateEnforce prevents repetition
  if (hot) {
    session.qual = session.qual || {};
    session.qual.hot_announced = true;
  }

  // TELNYX: when done && hot => call voice-handoff once
  if (hot && session?.telnyx?.ws && !session._handoffSent) {
    session._handoffSent = true;
    const summary = shortSummary(session);
    if (SUPABASE_VOICE_HANDOFF_URL) doHandoff(session, summary, true).catch(() => {});
  }

  if (session?.telnyx?.ws) {
    jlog({
      event: "TELNYX_HOT_DECISION",
      session_id,
      available: session?.qual?.available ?? null,
      urgent: session?.qual?.urgent ?? null,
      hot,
    });
  }

  session.stage = "done";
  await emitPromptForStage(session, "done");

  // Auto-close
  if (session?.telnyx?.ws) {
    const r = await telnyxHangup(session.call_control_id);
    jlog({ event: "TELNYX_HANGUP", session_id, ok: Boolean(r?.ok), ...(r?.status ? { status: r.status } : {}), ...(r?.body ? { body: r.body } : {}), ...(r?.error ? { err: r.error } : {}) });
  } else {
    jlog({ event: "TEST_HANGUP", session_id });
  }
}

function nextStageName(stage) {
  const s = String(stage || "");
  if (s === "greet") return "availability";
  if (s === "availability") return "urgency";
  if (s === "urgency") return "schedule";
  if (s === "schedule") return "done";
  return "done";
}

async function advanceStageAndEmit(session, userText) {
  const tRaw = String(userText || "").trim();
  const t = normalizeText(tRaw);
  const stage = String(session?.stage || "availability");

  // Terminal state guard (shared): once done, ignore any further turns/emits.
  if (stage === "done") return;

  // SYSTEM TRUTH:
  // Stage advancement requires YES confirmed explicitly. No implicit YES, no model-side advancement.

  // Mock answers (TEST MODE)
  const mockAvail = session?.testMock?.available;
  const mockUrg = session?.testMock?.urgent;

  session.qual = session.qual || {};

  // Apply answer for current stage
  if (stage === "availability") {
    if (mockAvail === "yes" || mockAvail === "no") session.qual.available = mockAvail;
    else if (isYes(tRaw)) session.qual.available = "yes";
    else if (isNo(tRaw)) session.qual.available = "no";
  } else if (stage === "urgency") {
    if (mockUrg === "yes" || mockUrg === "no") session.qual.urgent = mockUrg;
    else if (isUrgentYes(tRaw)) session.qual.urgent = "yes";
    else if (isUrgentNo(tRaw)) session.qual.urgent = "no";
  } else if (stage === "schedule") {
    // accept anything; we just close quickly
  }

  session.yes_confirmed = false;
  session.awaiting_yes_confirmation = false;

  const next = nextStageName(stage);
  session.stage = next;

  if (!session?.telnyx?.ws) {
    jlog({ event: "TEST_STAGE_ADVANCE", session_id: session.session_id, stage: next });
  } else {
    jlog({ event: "TELNYX_STAGE_ADVANCE", session_id: session.session_id, stage: next });
  }

  if (next === "done") return decideHotAndEmitDone(session);
  return emitPromptForStage(session, next);
}

function shortSummary(session) {
  const lead = extractListingRef(session);
  const available = session.qual?.available;
  const urgent = session.qual?.urgent;
  const zone = session.qual?.zone || null;
  const time = session.qual?.time || null;

  const bits = [
    `${lead}`,
    `disponible:${available === true ? "si" : available === false ? "no" : "?"}`,
    `urgente:${urgent === true ? "si" : urgent === false ? "no" : "?"}`,
    zone ? `zona:${zone}` : null,
    time ? `hora:${time}` : null,
    `source:${session.client_state?.source ?? "internet"}`,
  ].filter(Boolean);

  return bits.join(" | ").slice(0, 900);
}

function pickNextStage(session) {
  // deterministic stage progression
  const s = session.stage;
  if (s === "available") return "urgency";
  if (s === "urgency") return "zone";
  if (s === "zone") return "time";
  if (s === "time") return "done";
  return "done";
}

function advanceStage(session) {
  session.stage = pickNextStage(session);
  session.stageRepeats = 0;
}

function bumpRepeat(session) {
  session.stageRepeats = (session.stageRepeats || 0) + 1;
}

function shouldForceMoveOn(session) {
  // If they’re vague twice, move on (keeps call short/fast).
  return (session.stageRepeats || 0) >= MAX_STAGE_REPEATS;
}

// ──────────────────────────────────────────────────────────────
// OpenAI Realtime bridge
// ──────────────────────────────────────────────────────────────
function openaiConnect(session) {
  const headers = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "OpenAI-Beta": "realtime=v1",
  };

  const ows = new WebSocket(OPENAI_REALTIME_URL, { headers });
  session.openai = {
    ws: ows,
    ready: false,
    t0: nowMs(),
    firstAudioSent: false,
  };

  jlog({ event: "OPENAI_CONNECT", session_id: session.session_id, stream_id: session.stream_id });

  ows.on("open", () => {
    const msg = {
      type: "session.update",
      session: {
        instructions: `${agentContextLine(session)} ${lockedSystemInstructions(session)}`,
        modalities: ["text", "audio"],
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
        // We control turns; no long monologues.
        turn_detection: { type: "server_vad", create_response: false },
        voice: VOICE_NAME,
        // OpenAI Realtime enforces a minimum temperature (>= 0.6). Lower values cause hard errors and can lead to silence.
        temperature: 0.6,
      },
    };
    ows.send(JSON.stringify(msg));
    jlog({
      event: "SESSION_UPDATE_SENT",
      session_id: session.session_id,
      transcription_enabled: Boolean(msg?.session?.input_audio_transcription),
    });
    session.openai.ready = true;
    session.openai.activeResponse = false;

    jlog({ event: "OPENAI_READY", session_id: session.session_id, stream_id: session.stream_id });

    // kick off with deterministic stages
    session.stage = "greet";
    session.stageRepeats = 0;
    session.qual = { available: null, urgent: null };
    session._playbackQueue = [];

    // INIT_GREETING_ONLY
    emitPromptForStage(session, "greet").catch(() => {});

    session.openai._noAudioTimer = setTimeout(() => {
      if (!session.openai?.firstAudioSent) {
        jlog({ event: "OPENAI_NO_AUDIO_TIMEOUT", session_id: session.session_id, stream_id: session.stream_id, ms: 1200 });
      }
    }, 1200);
  });

  function speakAudioExact(session, finalText, stage) {
    try {
      session.openai?.ws?.send(JSON.stringify({
        type: "response.create",
        response: {
          // Realtime API requires ['text'] or ['audio','text'] (audio-only is invalid).
          modalities: ["audio", "text"],
          max_output_tokens: MAX_TOKENS_PER_TURN,
          instructions: [
            agentContextLine(session),
            lockedSystemInstructions(session),
            "Di EXACTAMENTE este texto y nada más:",
            `"${finalText}"`,
          ].join(" "),
        },
      }));
      session.openai_response_active = true;
      jlog({ event: "RESPONSE_CREATE_SENT", session_id: session.session_id, ts: new Date().toISOString() });
      session._lastBotPrompt = finalText;
      session.speaking = true;
      session.lastSpeakAt = nowMs();
      jlog({ event: "BOT_AUDIO_REQ", session_id: session.session_id, stage, text: finalText });
    } catch (e) {
      jlog({ event: "BOT_AUDIO_ERR", session_id: session.session_id, err: String(e?.message || e) });
    }
  }

  function speakDeterministic(session, desiredText) {
    const source = session?.client_state?.source ?? "internet";
    const hotAlready = Boolean(session?.qual?.hot_announced);
    const finalText = templateEnforce(session.stage, desiredText, source, hotAlready, session?.session_id ?? null);
    // TEMPLATE-ONLY speech: no free-form output, ever.
    playDeterministicLine(session, finalText).catch(() => {});
  }

  function decideAndMaybeAdvance(session, userText) {
    const t = normalizeText(userText);

  // Buyer / not-selling detection (hard exit)
  if (/\b(comprador|busco|quiero comprar|estoy comprando|no vendo|no estoy vendiendo)\b/.test(t)) {
    session.stage = "done";
    return { say: LINES.NOT_SELLER, question: null, done: true, hot: false };
  }

  // Advice/car talk request: refuse and return to current stage
  if (/(recomiendo|recomiendas|vale la pena|opinion|review|reseña|comparar|versus|vs\.?|precio|barato|caro)/i.test(userText || "")) {
    return { say: LINES.REFUSAL, question: stageQuestion(session.stage, session), done: false, pending: [LINES.REFUSAL, stageQuestion(session.stage, session)] };
  }

    // stage: available
    if (session.stage === "available") {
      if (isNo(t)) {
        session.qual.available = false;
        session.stage = "done";
      return { say: LINES.NOT_SELLER, question: null, done: true, hot: false };
      }
      if (isYes(t)) {
        session.qual.available = true;
        advanceStage(session); // -> urgency
        return { say: "Perfecto.", question: stageQuestion(session.stage, session), done: false };
      }
      bumpRepeat(session);
      if (shouldForceMoveOn(session)) {
        // assume available unknown, but keep going to urgency to avoid stalling
        session.qual.available = null;
        advanceStage(session);
        return { say: "Ok.", question: stageQuestion(session.stage, session), done: false };
      }
      return { say: "Ok.", question: stageQuestion("available", session), done: false };
    }

    // stage: urgency
    if (session.stage === "urgency") {
      if (isUrgentNo(t)) session.qual.urgent = false;
      if (isUrgentYes(t)) session.qual.urgent = true;

      if (session.qual.urgent !== null) {
      const hotNow = session.qual.available === true && session.qual.urgent === true;
      advanceStage(session); // -> zone
      if (hotNow && !session.qual.hot_announced) {
        session.qual.hot_announced = true;
        // HOT line must be said exactly once, then continue to zone question next.
        return { say: LINES.HOT_LINE, question: null, done: false, pending: [LINES.HOT_LINE, stageQuestion(session.stage, session)] };
      }
      return { say: null, question: stageQuestion(session.stage, session), done: false };
      }

      bumpRepeat(session);
      if (shouldForceMoveOn(session)) {
        // default not urgent if vague
        session.qual.urgent = false;
        advanceStage(session);
        return { say: "Ok.", question: stageQuestion(session.stage, session), done: false };
      }
      return { say: "Dime rápido.", question: stageQuestion("urgency", session), done: false };
    }

    // stage: zone
    if (session.stage === "zone") {
      // accept anything short as zone
      const zone = userText.trim().slice(0, 80);
      if (zone.length >= 2) session.qual.zone = zone;
      if (session.qual.zone) {
        advanceStage(session); // -> time
        return { say: "Perfecto.", question: stageQuestion(session.stage, session), done: false };
      }
      bumpRepeat(session);
      if (shouldForceMoveOn(session)) {
        session.qual.zone = null;
        advanceStage(session);
        return { say: "Ok.", question: stageQuestion(session.stage, session), done: false };
      }
      return { say: "¿Qué zona?", question: stageQuestion("zone", session), done: false };
    }

    // stage: time
    if (session.stage === "time") {
      const when = userText.trim().slice(0, 120);
      if (when.length >= 2) session.qual.time = when;
      // finish even if time is vague; we just hand off with summary
      session.stage = "done";
      const hot = session.qual.available === true && session.qual.urgent === true;
    return { say: hot ? LINES.HOT_LINE : "Perfecto. Gracias.", question: null, done: true, hot };
    }

    // done
    const hot = session.qual.available === true && session.qual.urgent === true;
    return { say: "Gracias.", question: null, done: true, hot };
  }

  ows.on("message", (buf) => {
    const txt = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
    const m = safeJsonParse(txt);
    if (!m) return;

    // Log EVERY OpenAI WS event (required for debugging turn-taking).
    // Keep payload tiny to avoid log spam (never log raw audio).
    try {
      const t = m.type || "unknown";
      const base = { event: "OPENAI_EVT", session_id: session.session_id, type: t };
      if (t === "response.audio.delta") jlog({ ...base, delta_len: typeof m.delta === "string" ? m.delta.length : 0 });
      else if (t === "response.output_text.delta") jlog({ ...base, delta_len: typeof m.delta === "string" ? m.delta.length : 0 });
      else if (t === "conversation.item.input_audio_transcription.completed" || t === "input_audio_transcription.completed") {
        const tr = String(m.transcript || m?.item?.content?.[0]?.transcript || "");
        jlog({ ...base, transcript_len: tr.length, transcript: tr.slice(0, 120) });
      } else if (t === "error") {
        // error is handled below with richer logging; still emit the type marker
        jlog(base);
      } else {
        jlog(base);
      }
    } catch {}

    // capture OpenAI error details (not just type)
    if (m.type === "error") {
      const msg = m?.error?.message ?? m?.message ?? null;
      const code = m?.error?.code ?? null;
      jlog({ event: "OPENAI_ERR_DETAIL", session_id: session.session_id, code, message: msg ? String(msg).slice(0, 300) : null });
    if (String(code || "").includes("input_audio_buffer_commit_empty") || String(msg || "").includes("input_audio_buffer_commit_empty")) {
      session.last_commit_empty_at = nowMs();
      session.bytes_since_commit = 0;
      jlog({ event: "OPENAI_COMMIT_EMPTY", session_id: session.session_id, tts_playing: Boolean(session.tts_playing) });
    }
      return;
    }

    // Track active response lifecycle (used for cancel gating)
    if (m.type === "conversation.item.created") {
      session._lastConversationItemCreated = nowMs();
    }
    if (m.type === "response.created") {
      session.has_active_response = true;
      session.openai.activeResponse = true;
      session.openai_response_active = true;
      session._lastResponseCreatedAt = nowMs();
      jlog({ event: "RESPONSE_CREATED", session_id: session.session_id });
    }
    if (String(m.type || "").startsWith("response.audio.delta") || String(m.type || "").startsWith("response.output_audio.")) {
      session.openai_speaking = true;
    }
    if (m.type === "response.done" || m.type === "response.canceled" || m.type === "response.completed") {
      session.openai_speaking = false;
      session.openai_response_active = false;
    }
    if (m.type === "response.done" || m.type === "response.canceled" || m.type === "response.completed") {
      session.has_active_response = false;
      session.openai.activeResponse = false;
    }

    // Barge-in via OpenAI VAD
    if (m.type === "input_audio_buffer.speech_started") {
      const now = nowMs();
      const was_tts_playing = Boolean(session.tts_playing);
      const was_openai_speaking = Boolean(session.openai_speaking);
      const was_openai_response_active = Boolean(session.openai_response_active);
      const was_has_active_response = Boolean(session.has_active_response);
      const was_openai_activeResponse = Boolean(session?.openai?.activeResponse);
      // Speaking lock: ignore VAD while bot is speaking (prevents echo/noise advancing stages)
      if (session.speaking_until && now < session.speaking_until) {
        if (!session._lastVadIgnoredAt || now - session._lastVadIgnoredAt > 1000) {
          session._lastVadIgnoredAt = now;
          jlog({ event: "TELNYX_VAD_IGNORED", session_id: session.session_id, reason: "speaking_lock" });
        }
        return;
      }
      // Debounce: ignore rapid double-fired VAD events
      if (session.lastVadAt && now - session.lastVadAt < 300) return;
      session.lastVadAt = now;

      session.humanSpeaking = true;
      session.inSpeech = true;
      session.speechStartAt = now;
      // VAD barge-in trigger
      const sinceLastCancelMs = session.lastCancelAt ? (now - session.lastCancelAt) : null;
      jlog({ event: "BARGE_IN_TRIGGER", reason: "vad", rms: null, sinceLastCancelMs });
      if (was_tts_playing) {
        try { stopOutboundPlayback(session); } catch {}
        session.tts_playing = false;
      }
      const shouldCancel = Boolean(
        was_openai_response_active ||
        was_openai_speaking ||
        was_has_active_response ||
        was_openai_activeResponse
      );
      if (shouldCancel) {
        try { session.openai?.ws?.send(JSON.stringify({ type: "response.cancel" })); } catch {}
        try { session.openai?.ws?.send(JSON.stringify({ type: "input_audio_buffer.clear" })); } catch {}
        session.bytes_since_commit = 0;
        session.last_audio_append_at = 0;
        session.last_inbound_rms = 0;
        session.lastCancelAt = now;
        session.has_active_response = false;
        session.openai.activeResponse = false;
        session.openai_response_active = false;
        jlog({
          event: "BARGE_IN_CANCEL_SENT",
          session_id: session.session_id,
          tts_playing: was_tts_playing,
          openai_speaking: was_openai_speaking,
          openai_response_active: was_openai_response_active,
          has_active_response: was_has_active_response,
          openai_activeResponse: was_openai_activeResponse,
        });
      } else {
        jlog({
          event: "BARGE_IN_CANCEL_SKIPPED",
          session_id: session.session_id,
          tts_playing: was_tts_playing,
          openai_speaking: was_openai_speaking,
          openai_response_active: was_openai_response_active,
          has_active_response: was_has_active_response,
          openai_activeResponse: was_openai_activeResponse,
        });
      }
      // Hard-stop any outbound audio to Telnyx immediately.
      stopOutboundPlayback(session);
      session.speaking = false;
      session.dropAudioUntil = now + DROP_AUDIO_MS;
      jlog({ event: "OUTBOUND_AUDIO_DROPPED", bufferFrames: 0, approxMs: DROP_AUDIO_MS });
      return;
    }

    // When user stops speaking, we create next response deterministically
    if (m.type === "input_audio_buffer.speech_stopped") {
      const now = nowMs();
      // Speaking lock: ignore VAD while bot is speaking
      if (session.speaking_until && now < session.speaking_until) {
        if (!session._lastVadIgnoredAt || now - session._lastVadIgnoredAt > 1000) {
          session._lastVadIgnoredAt = now;
          jlog({ event: "TELNYX_VAD_IGNORED", session_id: session.session_id, reason: "speaking_lock" });
        }
        return;
      }
      // Debounce: ignore rapid double-fired VAD events
      if (session.lastVadAt && now - session.lastVadAt < 300) return;
      session.lastVadAt = now;

      session.humanSpeaking = false;
      // Require real user speech to advance
      if (!session.inSpeech) return;
      const dur = session.speechStartAt ? (now - session.speechStartAt) : 0;
      if (dur < 250) {
        session.inSpeech = false;
        session.speechStartAt = 0;
        return;
      }
      session.inSpeech = false;
      session.speechStartAt = 0;

      if (session.lastUserTurnAt && now - session.lastUserTurnAt < VAD_THROTTLE_MS) return;
      session.lastUserTurnAt = now;
      jlog({ event: "TURN_RESUME", stage: session.stage });

      if (session._pendingNoUserTimer) {
        clearTimeout(session._pendingNoUserTimer);
        session._pendingNoUserTimer = null;
      }

      session._lastResponseCreatedAt = null;
      if (session.bytes_since_commit === 0) {
        const dtSinceAppend = session.last_audio_append_at ? now - session.last_audio_append_at : null;
        jlog({
          event: "SKIP_COMMIT_ZERO_BYTES",
          session_id: session.session_id,
          tts_playing: Boolean(session.tts_playing),
          dt_ms: dtSinceAppend,
        });
        return;
      }
      if (session.bytes_since_commit < MIN_COMMIT_BYTES) {
        jlog({
          event: "SKIP_COMMIT_TOO_SMALL",
          session_id: session.session_id,
          bytes_since_commit: session.bytes_since_commit,
          min_bytes: MIN_COMMIT_BYTES,
          tts_playing: Boolean(session.tts_playing),
        });
        return;
      }
      const COMMIT_REQUIRE_RECENT_MS = 600;
      const dtSinceAppend = session.last_audio_append_at ? now - session.last_audio_append_at : Infinity;
      if (dtSinceAppend > COMMIT_REQUIRE_RECENT_MS) {
        jlog({
          event: "SKIP_COMMIT_NOT_RECENT",
          session_id: session.session_id,
          dt_ms: dtSinceAppend,
          bytes_since_commit: session.bytes_since_commit,
        });
        return;
      }
      // Commit the buffered audio to allow OpenAI to finalize transcription for this turn.
      try {
        session.openai?.ws?.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        jlog({
          event: "OPENAI_COMMIT_SENT",
          session_id: session.session_id,
          bytes_since_commit: session.bytes_since_commit,
          tts_playing: Boolean(session.tts_playing),
        });
        session.bytes_since_commit = 0;
        session.last_audio_append_at = 0;
      } catch {}

      // VOICE RULE: never block response.create due to transcript timing; ASR uncertainty is handled by the model asking to repeat.
      // Create the next response immediately (text modality is enough; audio stays disabled downstream).
      try {
        const nowTs = nowMs();
        if (nowTs - session.last_commit_empty_at < NO_COMMIT_BACKOFF_MS) {
          jlog({ event: "SKIP_RESPONSE_RECENT_COMMIT_EMPTY", session_id: session.session_id });
          return;
        }
        session.openai?.ws?.send(JSON.stringify({
          type: "response.create",
          response: { modalities: ["text"], instructions: responseInstructions(session) },
        }));
        session.has_active_response = true;
        session.openai.activeResponse = true;
        session.openai_response_active = true;
        jlog({ event: "RESPONSE_CREATE_POST_COMMIT", session_id: session.session_id, stage: session.stage });
        jlog({ event: "RESPONSE_CREATE_SENT", session_id: session.session_id, ts: new Date().toISOString() });
      } catch {}

      session._pendingNoUserTimer = setTimeout(() => {
        const userText = String(session._lastUserText || "").trim();
        if (userText) {
          const preIntent = detectIntent(userText || "");
          if (preIntent.intent === "OTHER" && isLikelyGarbage(userText)) {
            jlog({
              event: "ASR_SANITY_REJECT",
              session_id: session.session_id,
              stage: session.stage,
              preview: userText.slice(0, 80),
            });
            emitClarification(session, { intent: "OTHER", reason: "asr_sanity_reject" });
            return;
          }
          session._lastUserText = userText;
          const { intent, reason } = preIntent.intent === "OTHER" ? detectIntent(session._lastUserText) : preIntent;
          session.last_intent = intent;
          if (!session.lang) {
            const lower = session._lastUserText.toLowerCase();
            const enHits = (lower.match(/\b(yes|ok|sell|today|tomorrow)\b/g) || []).length;
            session.lang = enHits >= 1 ? "en" : "es";
          }
          jlog({
            event: "INTENT_DETECTED",
            session_id: session.session_id,
            stage: session.stage,
            intent,
            reason,
            user_text: session._lastUserText,
          });
          jlog({
            event: "TELNYX_USER_TEXT",
            session_id: session.session_id,
            stage: session.stage,
            user_text_len: userText.length,
            preview: userText.slice(0, 80),
          });

          if (session.awaiting_yes_confirmation) {
            if (intent === "YES") {
              session.yes_confirmed = true;
              session.awaiting_yes_confirmation = false;
              jlog({ event: "YES_CONFIRMED", session_id: session.session_id, stage: session.stage });
              advanceStageAndEmit(session, session._lastUserText).catch(() => {});
              return;
            }
            if (intent === "NO") {
              session.awaiting_yes_confirmation = false;
              session.yes_confirmed = false;
              emitPoliteExit(session);
              return;
            }
            if (intent === "OBJECTION") {
              session.awaiting_yes_confirmation = false;
              session.yes_confirmed = false;
              emitClarification(session, { intent, reason });
              return;
            }
          }

          if (intent === "YES" && session.yes_confirmed !== true) {
            const lang = getSessionLang(session);
            const msg = lang === "en"
              ? "Just to confirm: do you want to move forward now?"
              : "Solo para confirmar: ¿sí te interesa avanzar ahora?";
            sendResponse(session, msg);
            session.awaiting_yes_confirmation = true;
            session.yes_confirmed = false;
            jlog({ event: "YES_CONFIRMATION_REQUESTED", session_id: session.session_id, stage: session.stage });
            return;
          }

          switch (intent) {
            case "NO":
              emitPoliteExit(session);
              return;
            case "QUESTION":
            case "OBJECTION":
              emitClarification(session, { intent, reason });
              return;
            case "YES":
              if (session.yes_confirmed !== true) return;
              session.yes_confirmed = false;
              session.awaiting_yes_confirmation = false;
              advanceStageAndEmit(session, session._lastUserText).catch(() => {});
              return;
            default:
              emitNudge(session, { intent, reason });
              return;
          }
        }
        if (session._lastResponseCreatedAt) {
          jlog({ event: "TELNYX_NO_TRANSCRIPT_AFTER_RESPONSE", session_id: session.session_id, stage: session.stage });
          jlog({ event: "TELNYX_NO_USER_TEXT", session_id: session.session_id, stage: session.stage });
          return;
        }
        jlog({ event: "TELNYX_NO_RESPONSE_CREATED", session_id: session.session_id, stage: session.stage });
        jlog({ event: "TELNYX_NO_USER_TEXT", session_id: session.session_id, stage: session.stage });
      }, 1200);
      return;
    }

    // collect model text deltas (used only for guarded TTS phase)
    if (m.type === "response.output_text.delta" && typeof m.delta === "string") {
      session.textBuf = (session.textBuf || "") + m.delta;
    }

    // When text response completes, synthesize audio from the validated/guarded text.
    if (m.type === "response.completed") {
      session.openai.activeResponse = false;
      // TEMPLATE-ONLY speech: we do not speak model-generated text in any mode.
      // (We keep this handler for compatibility; no-op on completion.)
      return;
    }

    // also capture user transcription if provided by model events (tolerant)
    if (m.type === "conversation.item.input_audio_transcription.completed") {
      const tr = m.transcript || m?.item?.content?.[0]?.transcript || "";
      if (tr) {
        session._lastUserText = String(tr);
        session.last_transcript_at = nowMs();
        session.last_transcript_len = String(tr).trim().length;
      }
      return;
    }
    if (m.type === "input_audio_transcription.completed") {
      const tr = m.transcript || "";
      if (tr) session._lastUserText = String(tr);
      return;
    }

    // We intentionally ignore model-generated audio to prevent ANY drift/rambling.
    // All audible speech is produced by deterministic TTS in playDeterministicLine().
    if (m.type === "response.audio.delta" && m.delta) {
      return;
    }

    if (m.type === "response.completed") {
      const text = String(session.textBuf || "").trim();
      session.textBuf = "";
      const idx = text.indexOf("HANDOFF:");
      if (idx >= 0) {
        const jsonPart = text.slice(idx + "HANDOFF:".length).trim();
        const payload = safeJsonParse(jsonPart);
        if (payload && typeof payload.hot === "boolean") {
          doHandoff(session, payload.summary || shortSummary(session), Boolean(payload.hot)).catch(() => {});
        }
      }
      return;
    }
  });

  ows.on("close", (code, reason) => {
    jlog({ event: "OPENAI_CLOSE", session_id: session.session_id, code, reason: String(reason || "") });
  });
  ows.on("error", (err) => {
    jlog({ event: "OPENAI_ERR", session_id: session.session_id, err: String(err?.message || err) });
  });
}

async function doHandoff(session, summary, hot) {
  if (!SUPABASE_VOICE_HANDOFF_URL) {
    jlog({ event: "HANDOFF", session_id: session.session_id, ok: false, reason: "missing_handoff_url" });
    return;
  }
  const body = {
    touch_run_id: session.client_state?.touch_run_id ?? null,
    lead_id: session.client_state?.lead_id ?? null,
    call_control_id: session.call_control_id ?? null,
    summary: String(summary || "").slice(0, 1000),
    hot: Boolean(hot),
  };
  try {
    const res = await fetch(SUPABASE_VOICE_HANDOFF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SUPABASE_VOICE_HANDOFF_TOKEN ? { Authorization: `Bearer ${SUPABASE_VOICE_HANDOFF_TOKEN}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const txt = await res.text().catch(() => "");
    jlog({ event: "HANDOFF", session_id: session.session_id, ok: res.ok, status: res.status, body: txt.slice(0, 200), hot });
  } catch (e) {
    jlog({ event: "HANDOFF", session_id: session.session_id, ok: false, err: String(e?.message || e), hot });
  }
}

function closeWsPolicy(ws, reason) {
  try { ws.close(1008, reason); } catch {}
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  const j = safeJsonParse(raw);
  return j || null;
}

async function runOpenAiVoiceTest(args) {
  // VOICE_TEST_MODE: No Telnyx. We inject PCM16 16k mono (wav stripped) into input_audio_buffer.
  const requestedSessionId = args?.session_id ? String(args.session_id) : null;
  const session_id = requestedSessionId || crypto.randomUUID();
  const pcm16le_16k = args?.pcm16le_16k;
  if (!OPENAI_API_KEY) return { ok: false, error: "missing_openai_api_key", session_id };
  if (!Buffer.isBuffer(pcm16le_16k)) return { ok: false, error: "missing_pcm16le_16k", session_id };

  const existing = testSessions.get(session_id) || null;
  if (existing) {
    jlog({ event: "TEST_SESSION_REUSE", session_id });
  }
  const persisted = existing || {
    session_id,
    stage: "availability",
    source: "encuentra24",
    qual: { available: null, urgent: null },
    testMock: { available: null, urgent: null },
    emittedAvailability: false,
  };
  if (!existing) testSessions.set(session_id, persisted);

  const headers = { Authorization: `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" };
  const ows = new WebSocket(OPENAI_REALTIME_URL, { headers });

  const st = {
    session_id,
    humanSpeaking: false,
    openai: { ws: ows, activeResponse: false },
    has_active_response: false,
    awaiting_yes_confirmation: false,
    yes_confirmed: false,
    textBuf: "",
    stage: persisted.stage,
    source: persisted.source,
    inSpeech: false,
    emittedAvailability: false,
    emittedThisTurn: false,
    qual: { available: null, urgent: null },
    testMock: {
      available: args?.mock?.available ?? null, // "yes" | "no" | null
      urgent: args?.mock?.urgent ?? null, // "yes" | "no" | null
    },
    // outbound "playback" state (we don't send anywhere, but cancellation must stop it)
    _playbackTimer: null,
    _playbackFrames: null,
    _playbackIdx: 0,
  };
  // hydrate from persisted state
  try {
    st.emittedAvailability = Boolean(persisted.emittedAvailability);
    st.qual = persisted.qual && typeof persisted.qual === "object" ? persisted.qual : { available: null, urgent: null };
    st.testMock = {
      available: (args?.mock?.available ?? persisted?.testMock?.available ?? null),
      urgent: (args?.mock?.urgent ?? persisted?.testMock?.urgent ?? null),
      // Strict gating: stage advance in TEST MODE requires explicit mock userText per request
      userText: (typeof args?.mock?.userText === "string" ? args.mock.userText : null),
    };
    st.source = String(args?.source ?? persisted.source ?? "encuentra24");
    st.stage = String(persisted.stage || "availability");
  } catch {}

  // VOICE_TEST_MODE: allow text-only tests
  // If no audio was provided, we still execute the test pipeline using mock.userText (strict gating).
  if (!pcm16le_16k.length) {
    const mockUserText = typeof st?.testMock?.userText === "string" ? String(st.testMock.userText).trim() : "";
    if (!mockUserText) {
      jlog({ event: "TEST_NO_USER_TEXT", session_id, stage: st.stage });
      return { ok: true, session_id, mode: "text_only_blocked" };
    }
    jlog({
      event: "TEST_USER_TEXT",
      session_id,
      stage: st.stage,
      user_text_len: mockUserText.length,
      preview: mockUserText.slice(0, 80),
    });
    await aiReplyAndEmitTest(st, mockUserText);
    persisted.stage = st.stage;
    persisted.source = st.source;
    persisted.qual = st.qual;
    persisted.testMock = st.testMock;
    return { ok: true, session_id, mode: "text_only_ok" };
  }

  async function emitOnce(stage) {
    jlog({ event: "ILLEGAL_PROMPT_EMIT", session_id, stage: stage ?? st.stage });
  }

  const injectAudio = async () => {
    // Stream in 20ms chunks (16kHz => 320 samples => 640 bytes)
    const CHUNK_BYTES = 640;
    const injectedMs = ((pcm16le_16k.length / 2) / 16000) * 1000;
    for (let off = 0; off < pcm16le_16k.length; off += CHUNK_BYTES) {
      const chunk = pcm16le_16k.slice(off, off + CHUNK_BYTES);
      ows.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk.toString("base64") }));
      // keep it fast but not a single giant burst (helps VAD)
      if (off && (off / CHUNK_BYTES) % 10 === 0) await sleep(2);
    }
    // Append a short silence tail to ensure speech_stopped fires.
    const silenceMs = Number(args?.silence_ms ?? 500);
    const silenceSamples = Math.floor((16000 * silenceMs) / 1000);
    const silence = Buffer.allocUnsafe(silenceSamples * 2);
    silence.fill(0);
    for (let off = 0; off < silence.length; off += CHUNK_BYTES) {
      const chunk = silence.slice(off, off + CHUNK_BYTES);
          try { st.bytes_since_commit = (st.bytes_since_commit || 0) + chunk.length; } catch {}
      ows.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk.toString("base64") }));
    }
    // TEST MODE: never commit (avoid input_audio_buffer_commit_empty; append-only is enough for VAD tests)
    jlog({ event: "TEST_COMMIT_SKIPPED", session_id, injected_ms: injectedMs });
    jlog({ event: "TEST_AUDIO_INJECTED", session_id, bytes: pcm16le_16k.length, injected_ms: injectedMs, silence_ms: silenceMs });
  };

  return await new Promise((resolve) => {
    const done = (obj) => resolve(obj);
    const timeoutMs = Number(args?.timeout_ms ?? 15000);
    const t = setTimeout(() => {
      try { ows.close(); } catch {}
      done({ ok: true, session_id, note: "timeout" });
    }, timeoutMs);

    ows.on("open", async () => {
      // Configure session for turn-taking diagnostics (no auto-responses).
      const msg = {
        type: "session.update",
        session: {
          instructions: "MODO PRUEBA. Solo valida turn-taking. No hables si el humano habla. 1 respuesta por turno.",
          modalities: ["text"],
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          turn_detection: { type: "server_vad", create_response: false },
          temperature: 0.6,
        },
      };
      ows.send(JSON.stringify(msg));
      jlog({ event: "TEST_OPENAI_READY", session_id });
      // Kickoff: emit ONLY greet. Availability is emitted on first real VAD turn.
      if (!st.emittedAvailability) {
        st.emittedAvailability = true;
        st.stage = "greet";
        persisted.emittedAvailability = true;
        persisted.stage = st.stage;
        persisted.source = st.source;
        persisted.qual = st.qual;
        persisted.testMock = st.testMock;
        st.emittedThisTurn = false;
        await emitOnce("greet");
      }
      await injectAudio();
    });

    ows.on("message", (buf) => {
      const txt = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
      const m = safeJsonParse(txt);
      if (!m) return;

      // Minimal required logs: speech_started, speech_stopped, response.*
      const type = m.type || "unknown";
      if (type === "input_audio_buffer.speech_started" || type === "input_audio_buffer.speech_stopped" || String(type).startsWith("response.")) {
        jlog({ event: "OPENAI_EVT", session_id, type });
      }

      if (type === "response.created") {
        st.has_active_response = true;
        st.openai.activeResponse = true;
      }
      if (type === "response.done" || type === "response.canceled" || type === "response.completed") {
        st.has_active_response = false;
        st.openai.activeResponse = false;
      }

      if (type === "input_audio_buffer.speech_started") {
        st.humanSpeaking = true;
        st.inSpeech = true;
        st.emittedThisTurn = false; // reset emit guard at start of each speech cycle
        if (st.has_active_response === true) {
          try { ows.send(JSON.stringify({ type: "response.cancel" })); } catch {}
          jlog({ event: "TEST_CANCEL_ON_SPEECH_STARTED", session_id });
        } else {
          jlog({ event: "OPENAI_SKIP_CANCEL_NO_ACTIVE", session_id });
        }
        stopOutboundPlayback(st); // "stop outbound audio" even in test mode
        st.openai.activeResponse = false;
        st.has_active_response = false;
        return;
      }

      if (type === "input_audio_buffer.speech_stopped") {
        st.humanSpeaking = false;
        // One template per user turn: only advance/emit if we saw a speech_started for this turn.
        if (!st.inSpeech) return;
        st.inSpeech = false;

        if (st.emittedThisTurn) return;
        st.emittedThisTurn = true;
        const mockUserText = typeof st?.testMock?.userText === "string" ? String(st.testMock.userText).trim() : "";
        if (!mockUserText) {
          jlog({ event: "TEST_NO_USER_TEXT", session_id, stage: st.stage });
          return;
        }

        // Ensure a response is created after each user turn (test-mode: text only).
        try {
          ows.send(JSON.stringify({ type: "response.create", response: { modalities: ["text"], instructions: responseInstructions(st) } }));
          st.has_active_response = true;
          st.openai.activeResponse = true;
          jlog({ event: "OPENAI_RESPONSE_CREATE_SENT", session_id });
        } catch {}

        // Only advance when explicit userText exists (no VAD-only advancement).
        aiReplyAndEmitTest(st, mockUserText).then(() => {
          persisted.stage = st.stage;
          persisted.source = st.source;
          persisted.qual = st.qual;
          persisted.testMock = st.testMock;
        }).catch(() => {});
        return;
      }

      // TEST MODE: no model responses; VAD/turn-taking only.

      if (type === "error") {
        const msg = m?.error?.message ?? m?.message ?? null;
        const code = m?.error?.code ?? null;
        jlog({ event: "OPENAI_ERR_DETAIL", session_id, code, message: msg ? String(msg).slice(0, 300) : null });
      }
    });

    ows.on("close", () => {
      clearTimeout(t);
    });
    ows.on("error", (e) => {
      clearTimeout(t);
      done({ ok: false, session_id, error: String(e?.message || e) });
    });
  });
}

// ──────────────────────────────────────────────────────────────
// HTTP + WS server
// ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === "/go.swml" && (req.method === "GET" || req.method === "POST")) {
    const swml = {
      version: "1.0.0",
      sections: {
        main: [
          { say: { text: "Hello Pacho. The gateway is connected.", voice: "en-US" } },
          { pause: { length: 8 } },
        ],
      },
    };
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(swml));
    return;
  }

  if (req.url?.startsWith("/healthz")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }

  // When VOICE_TEST_MODE is disabled, do not expose /voice-test (avoid misleading 200 text/plain fallthrough).
  if (!VOICE_TEST_MODE && req.method === "POST" && req.url?.startsWith("/voice-test")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "voice_test_mode_disabled" }));
  }

  if (VOICE_TEST_MODE && req.url?.startsWith("/voice-test")) {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    }
    (async () => {
      let session_id = "unknown";
      let sess = null;
      try {
        const body = await readJsonBody(req);
        const wavB64 = body?.wav_b64 ?? body?.wavB64 ?? null;
        const pcmB64 = body?.pcm16_b64 ?? body?.pcm16B64 ?? null;
        const sampleRate = Number(body?.sample_rate ?? body?.sampleRate ?? 16000);
        const channels = Number(body?.channels ?? 1);
        const mock = body?.mock && typeof body.mock === "object" ? body.mock : null;
        const reqSessionId = body?.session_id ?? body?.sessionId ?? null;

        session_id = String(reqSessionId || crypto.randomUUID());

        let pcm16le;
        if (wavB64) {
          const wav = Buffer.from(String(wavB64), "base64");
          const parsed = wavToPcm16le(wav);
          if (!parsed.ok || !parsed.pcm16le) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: parsed.error || "wav_parse_failed" }));
          }
          pcm16le = Buffer.from(parsed.pcm16le);
          let ch = Number(parsed.channels || 1);
          if (ch > 1) {
            const frames = pcm16le.length / 2 / ch;
            const mono = Buffer.allocUnsafe(frames * 2);
            for (let i = 0; i < frames; i++) mono.writeInt16LE(pcm16le.readInt16LE(i * 2 * ch), i * 2);
            pcm16le = mono;
            ch = 1;
          }
          pcm16le = resamplePcm16leTo16k(pcm16le, Number(parsed.sampleRate || 16000));
        } else if (pcmB64) {
          pcm16le = Buffer.from(String(pcmB64), "base64");
          if (channels > 1) {
            // assume interleaved; take left channel
            const frames = pcm16le.length / 2 / channels;
            const mono = Buffer.allocUnsafe(frames * 2);
            for (let i = 0; i < frames; i++) mono.writeInt16LE(pcm16le.readInt16LE(i * 2 * channels), i * 2);
            pcm16le = mono;
          }
          pcm16le = resamplePcm16leTo16k(pcm16le, sampleRate);
        } else {
          pcm16le = Buffer.alloc(0);
        }

        // Per-session lock: prevent concurrent /voice-test runs for the same session_id
        sess = testSessions.get(session_id) || null;
        if (!sess) {
          sess = {
            session_id,
            stage: "availability",
            source: "encuentra24",
            qual: { available: null, urgent: null },
            testMock: { available: null, urgent: null },
            emittedAvailability: false,
            busy: false,
          };
          testSessions.set(session_id, sess);
        }

        // Terminal state guard: if already done, ignore and return immediately.
        if (String(sess.stage || "") === "done") {
          jlog({ event: "TEST_SESSION_DONE_IGNORED", session_id });
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, session_id, status: "done" }));
        }
        // Persist source across calls (prefer session.source)
        if (typeof body?.source === "string" && body.source.trim()) {
          sess.source = body.source.trim();
          jlog({ event: "TEST_SOURCE", session_id, source: sess.source });
        }

        // Instrumentation: request-level log (A)
        {
          const hasMock = Boolean(mock && typeof mock === "object");
          const mockKeys = hasMock ? Object.keys(mock).slice(0, 25) : [];
          const userText = typeof mock?.userText === "string" ? String(mock.userText) : "";
          const trimmed = userText.trim();
          jlog({
            event: "TEST_REQ_IN",
            session_id,
            has_mock: hasMock,
            mock_keys: mockKeys,
            has_userText: Boolean(trimmed),
            userText_preview_len: trimmed ? trimmed.slice(0, 80).length : 0,
          });
        }
        if (sess.busy === true) {
          jlog({ event: "TEST_SESSION_BUSY", session_id });
          res.writeHead(409, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, error: "session_busy", session_id }));
        }
        sess.busy = true;

        // run async; logs are the output
        jlog({ event: "TEST_CALL_RUN", session_id }); // (B)
        await runOpenAiVoiceTest({
          session_id,
          pcm16le_16k: pcm16le,
          silence_ms: body?.silence_ms ?? 500,
          timeout_ms: body?.timeout_ms ?? 15000,
          source: sess.source || body?.source || "encuentra24",
          mock: {
            available: mock?.available ?? null,
            urgent: mock?.urgent ?? null,
            userText: (typeof mock?.userText === "string" ? mock.userText : null),
          },
        });
        jlog({ event: "TEST_RUN_RETURN", session_id }); // (C)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, session_id }));
      } catch (e) {
        jlog({ event: "TEST_AI_ERR", session_id, err: String(e?.message || e) });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "test_failed", session_id }));
      } finally {
        // ALWAYS release the per-session lock, even if any awaited step throws.
        if (sess) sess.busy = false;
      }
    })().catch(() => {});
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("voice-rtp-gateway");
});

const wss = VOICE_TEST_MODE ? null : new WebSocketServer({ noServer: true, perMessageDeflate: false });
const wssTwilio = VOICE_TEST_MODE ? null : new WebSocketServer({ noServer: true, perMessageDeflate: false });

// Take control of HTTP upgrade routing to avoid extension/protocol negotiation conflicts.
server.on("upgrade", (req, socket, head) => {
  try {
    const url = String(req?.url || "");
    const h = req?.headers || {};
    const inExt = String(h["sec-websocket-extensions"] || "");
    const inProto = String(h["sec-websocket-protocol"] || "");
    const hasHost = Boolean(h["host"]);
    jlog({ event: "UPGRADE", url, has_host: hasHost, in_ws_ext: inExt });

    // Strip extensions/protocol to prevent permessage-deflate negotiation (client expects none).
    try { delete req.headers["sec-websocket-extensions"]; } catch {}
    try { delete req.headers["sec-websocket-protocol"]; } catch {}
    try { if (!req.headers["host"]) req.headers["host"] = "revenue-asi-voice-gateway.fly.dev"; } catch {}

    if (VOICE_TEST_MODE) {
      try { socket.destroy(); } catch {}
      return;
    }

    if (url.startsWith("/telnyx") && wss) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      return;
    }
    if (url.startsWith("/twilio") && wssTwilio) {
      wssTwilio.handleUpgrade(req, socket, head, (ws) => wssTwilio.emit("connection", ws, req));
      return;
    }

    try { socket.destroy(); } catch {}
    void inProto; // keep for debugging if needed (do not log by default)
  } catch {
    try { socket.destroy(); } catch {}
  }
});

wss?.on("connection", (ws, req) => {
  const u = new URL(req.url || "/telnyx", "http://localhost");
  const token = String(u.searchParams.get("token") || "");
  const isTelnyxPath = u.pathname.startsWith("/telnyx");
  if (isTelnyxPath) {
    if (!VOICE_GATEWAY_TOKEN || token !== VOICE_GATEWAY_TOKEN) {
      jlog({ event: "AUTH_BYPASS_TELNYX", path: u.pathname, has_token: Boolean(token) });
    }
  } else {
    if (!VOICE_GATEWAY_TOKEN || token !== VOICE_GATEWAY_TOKEN) {
      jlog({ event: "AUTH_FAIL", path: u.pathname, has_token: Boolean(token) });
      return closeWsPolicy(ws, "unauthorized");
    }
  }

  const session = makeBaseSession();
  session.telnyx = { ws, lastMediaAt: 0, media_format: { encoding: "PCMU", sample_rate: 8000, channels: 1 } };

  jlog({ event: "WS_CONNECT", session_id: session.session_id, path: u.pathname });

  // WS handshake metadata (no secrets) + negotiated extensions
  try {
    const h = req?.headers || {};
    jlog({
      event: "WS_HANDSHAKE",
      session_id: session.session_id,
      url: String(req?.url || ""),
      ua: String(h["user-agent"] || ""),
      in_ws_ext: String(h["sec-websocket-extensions"] || ""),
      in_ws_proto: String(h["sec-websocket-protocol"] || ""),
    });
  } catch {}
  try {
    jlog({
      event: "WS_NEGOTIATED",
      session_id: session.session_id,
      ws_ext: String(ws?.extensions || ""),
      ws_proto: String(ws?.protocol || ""),
    });
  } catch {}

  // Debug: log outbound socket writes to detect RSV1 frames (do NOT log payloads).
  try {
    const sock = ws?._socket;
    if (sock && typeof sock.write === "function" && !sock._writeWrappedForRsv1) {
      const origWrite = sock.write.bind(sock);
      sock._writeWrappedForRsv1 = true;
      sock.write = (chunk, ...args) => {
        try {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ""), "binary");
          const nbytes = buf.length;
          const b0 = nbytes > 0 ? buf[0] : 0;
          jlog({
            event: "SOCKET_WRITE",
            session_id: session.session_id,
            nbytes,
            first_byte_hex: "0x" + b0.toString(16).padStart(2, "0"),
            rsv1_set: (b0 & 0x40) !== 0,
            opcode: b0 & 0x0f,
          });
        } catch {}
        return origWrite(chunk, ...args);
      };
    }
  } catch {}

  // Debug: log inbound socket data first byte to detect RSV1/opcode (do NOT log payloads).
  try {
    const sock = ws?._socket;
    if (sock && typeof sock.on === "function" && !sock._dataWrappedForRsv1) {
      sock._dataWrappedForRsv1 = true;
      sock.on("data", (chunk) => {
        try {
          if (session._loggedFirstSocketData) return;
          session._loggedFirstSocketData = true;
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ""), "binary");
          const nbytes = buf.length;
          const b0 = nbytes > 0 ? buf[0] : 0;
          jlog({
            event: "SOCKET_DATA",
            session_id: session.session_id,
            nbytes,
            first_byte_hex: "0x" + b0.toString(16).padStart(2, "0"),
            rsv1_set: (b0 & 0x40) !== 0,
            opcode: b0 & 0x0f,
          });
        } catch {}
      });
    }
  } catch {}

  ws.on("message", (data) => {
    const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    const msg = safeJsonParse(raw);
    if (!msg || typeof msg !== "object") {
      jlog({ event: "TELNYX_UNKNOWN", session_id: session.session_id, raw_len: raw.length });
      return;
    }

    const ev = msg.event ?? msg.type ?? msg?.data?.event ?? null;
    if (!ev) {
      jlog({ event: "TELNYX_UNKNOWN", session_id: session.session_id, keys: Object.keys(msg).slice(0, 20) });
      return;
    }

    if (ev === "start" || ev === "call.start" || ev === "stream.start") {
      const streamId =
        msg.stream_id ??
        msg.streamId ??
        msg?.start?.stream_id ??
        msg?.data?.stream_id ??
        null;

      const callControlId =
        msg.call_control_id ??
        msg.callControlId ??
        msg?.start?.call_control_id ??
        msg?.data?.call_control_id ??
        null;

      const clientStateB64 =
        msg.client_state ??
        msg.clientState ??
        msg?.start?.client_state ??
        msg?.data?.client_state ??
        null;

      const mf =
        msg?.start?.media_format ??
        msg?.start?.mediaFormat ??
        msg?.media_format ??
        msg?.mediaFormat ??
        null;

      const mediaFormat = mf && typeof mf === "object"
        ? {
            encoding: mf.encoding ?? mf.codec ?? "PCMU",
            sample_rate: mf.sample_rate ?? mf.sampleRate ?? 8000,
            channels: mf.channels ?? 1,
          }
        : { encoding: "PCMU", sample_rate: 8000, channels: 1 };

      session.stream_id = String(streamId || "");
      session.call_control_id = String(callControlId || "");
      session.client_state = safeBase64Json(clientStateB64) || {};
      session.source = (session.client_state?.source ? String(session.client_state.source) : "") || "encuentra24";
      session.telnyx.media_format = mediaFormat;

      const encStart = String(mediaFormat?.encoding || "").toUpperCase();
      if (encStart !== "PCMU") {
        jlog({
          event: "ERROR_FATAL_CODEC",
          session_id: session.session_id,
          stream_id: session.stream_id,
          call_control_id: session.call_control_id,
          encoding: mediaFormat?.encoding ?? null,
          sample_rate: mediaFormat?.sample_rate ?? null,
          channels: mediaFormat?.channels ?? null,
        });
        try { ws.close(1011, "unsupported_codec"); } catch {}
        if (session.stream_id) sessions.delete(session.stream_id);
        return;
      }

      if (session.stream_id) sessions.set(session.stream_id, session);

      jlog({
        event: "TELNYX_START",
        session_id: session.session_id,
        stream_id: session.stream_id,
        call_control_id: session.call_control_id,
        touch_run_id: session.client_state?.touch_run_id ?? null,
        media_format: session.telnyx.media_format,
      });

      if (!OPENAI_API_KEY) {
        jlog({ event: "OPENAI_MISSING_KEY", session_id: session.session_id });
        return;
      }
      openaiConnect(session);
      return;
    }

    if (ev === "media" || ev === "stream.media") {
      const streamId = msg.stream_id ?? msg.streamId ?? msg?.media?.stream_id ?? null;
      const payloadB64 = msg?.media?.payload ?? msg?.payload ?? msg?.media_payload ?? null;
      if (!payloadB64) return;

      const sess = (streamId && sessions.get(String(streamId))) || session;
      sess.telnyx.lastMediaAt = nowMs();

      // first media template logging
      if (!sess._loggedFirstMedia) {
        sess._loggedFirstMedia = true;
        jlog({
          event: "TELNYX_MEDIA_FIRST",
          session_id: sess.session_id,
          stream_id: sess.stream_id,
          payload_b64_len: String(payloadB64).length,
          media_keys: Object.keys(msg?.media ?? {}).slice(0, 20),
          media_format: sess.telnyx.media_format,
        });
      }

      const track = String((msg?.media ?? {})?.track ?? "");
      // IMPORTANT: do NOT treat empty track as inbound. Telnyx sends inbound/outbound explicitly.
      // Treating "" as inbound causes false barge-in from non-user audio/noise.
      const isInbound = track === "inbound" || track === "in";

      const enc = String(sess.telnyx?.media_format?.encoding || "PCMU").toUpperCase();
      const sr = Number(sess.telnyx?.media_format?.sample_rate || 8000);

      handleInboundAudioToOpenAi(sess, { payloadB64, isInbound, enc, sr, track });
      return;
    }

    if (ev === "stop" || ev === "stream.stop" || ev === "call.end") {
      jlog({ event: "STOP", session_id: session.session_id, stream_id: session.stream_id });
      try { session.openai?.ws?.close(); } catch {}
      try { ws.close(); } catch {}
      if (session.stream_id) sessions.delete(session.stream_id);
      return;
    }

    jlog({ event: "TELNYX_EVT", session_id: session.session_id, telnyx_event: String(ev) });
  });

  ws.on("close", (code, reason) => {
    jlog({ event: "WS_CLOSE", session_id: session.session_id, code, reason: String(reason || "") });
    try { session.openai?.ws?.close(); } catch {}
    if (session.stream_id) sessions.delete(session.stream_id);
  });
});

wssTwilio?.on("connection", (ws) => {
  jlog({ event: "TWILIO_WS_CONNECT" });

  let lastStreamSid = null;
  let lastCallSid = null;

  const cleanup = (streamSid, reason) => {
    const sid = streamSid ? String(streamSid) : null;
    const sess = sid ? twilioSessions.get(sid) : null;
    if (!sess) return;
    jlog({ event: "TWILIO_CLEANUP", streamSid: sid, reason: String(reason || "") });
    stopOutboundPlayback(sess);
    try { sess.openai?.ws?.close(); } catch {}
    try { ws.close(); } catch {}
    twilioSessions.delete(sid);
  };

  ws.on("message", (data) => {
    const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    const msg = safeJsonParse(raw);
    if (!msg || typeof msg !== "object") {
      jlog({ event: "TWILIO_UNKNOWN", raw_len: raw.length });
      return;
    }

    const ev = msg.event ?? null;
    if (!ev) {
      jlog({ event: "TWILIO_UNKNOWN", keys: Object.keys(msg).slice(0, 20) });
      return;
    }

    if (ev === "start") {
      const streamSid = msg?.start?.streamSid ?? null;
      const callSid = msg?.start?.callSid ?? null;
      const mf = msg?.start?.mediaFormat ?? null;
      const mediaFormat = mf && typeof mf === "object"
        ? {
            encoding: "PCMU",
            sample_rate: mf.sampleRate ?? 8000,
            channels: mf.channels ?? 1,
          }
        : { encoding: "PCMU", sample_rate: 8000, channels: 1 };

      if (!streamSid) {
        jlog({ event: "TWILIO_START_MISSING_STREAMSID", callSid: callSid ?? null });
        return;
      }

      const session = makeBaseSession();
      session.stream_id = String(streamSid || "");
      session.call_control_id = callSid ? String(callSid) : null;
      session.twilio = { ws, streamSid: String(streamSid), callSid: callSid ? String(callSid) : null, lastMediaAt: 0, media_format: mediaFormat };

      lastStreamSid = String(streamSid);
      lastCallSid = callSid ? String(callSid) : null;

      twilioSessions.set(String(streamSid), session);

      jlog({
        event: "TWILIO_START",
        streamSid: String(streamSid),
        callSid: callSid ? String(callSid) : null,
        media_format: mediaFormat,
      });

      if (!OPENAI_API_KEY) {
        jlog({ event: "OPENAI_MISSING_KEY", session_id: session.session_id });
        return;
      }
      openaiConnect(session);
      return;
    }

    if (ev === "media") {
      const streamSid = msg.streamSid ?? lastStreamSid ?? null;
      const payloadB64 = msg?.media?.payload ?? null;
      if (!streamSid || !payloadB64) return;

      const sess = twilioSessions.get(String(streamSid));
      if (!sess) {
        jlog({ event: "TWILIO_MEDIA_NO_SESSION", streamSid: String(streamSid) });
        return;
      }

      sess.twilio.lastMediaAt = nowMs();

      if (!sess._loggedFirstMedia) {
        sess._loggedFirstMedia = true;
        jlog({
          event: "TWILIO_MEDIA_FIRST",
          session_id: sess.session_id,
          streamSid: String(streamSid),
          payload_b64_len: String(payloadB64).length,
          media_format: sess.twilio.media_format,
        });
      }

      // Twilio Media Streams inbound is PCMU 8k; do not transcode.
      handleInboundAudioToOpenAi(sess, { payloadB64, isInbound: true, enc: "PCMU", sr: 8000, track: "inbound" });
      return;
    }

    if (ev === "stop") {
      const streamSid = msg.streamSid ?? lastStreamSid ?? null;
      jlog({ event: "TWILIO_STOP", streamSid: streamSid ? String(streamSid) : null, callSid: lastCallSid });
      cleanup(streamSid, "stop");
      return;
    }

    jlog({ event: "TWILIO_EVT", twilio_event: String(ev) });
  });

  ws.on("close", (code, reason) => {
    jlog({ event: "TWILIO_WS_CLOSE", code, reason: String(reason || ""), streamSid: lastStreamSid, callSid: lastCallSid });
    cleanup(lastStreamSid, "ws_close");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  jlog({ event: "LISTENING", host: "0.0.0.0", port: PORT });
  jlog({
    event: "BOOT",
    port: PORT,
    openai_tts_model_present: Boolean(OPENAI_TTS_MODEL),
    openai_tts_model: OPENAI_TTS_MODEL,
    carrier_primary: VOICE_CARRIER_PRIMARY,
    paths: VOICE_TEST_MODE ? ["/voice-test"] : ["/twilio", "/telnyx"],
    has_token: Boolean(VOICE_GATEWAY_TOKEN),
    has_openai_key: Boolean(OPENAI_API_KEY),
    has_telnyx_api_key: Boolean(TELNYX_API_KEY),
    openai_tts_model_present: Boolean(OPENAI_TTS_MODEL),
    openai_tts_model: OPENAI_TTS_MODEL,
    voice_test_mode: VOICE_TEST_MODE,
    tuning: {
      BARGE_IN_RMS,
      SPEAKING_RECENT_MS,
      DROP_AUDIO_MS,
      VAD_THROTTLE_MS,
      MAX_TOKENS_PER_TURN,
      VOICE_NAME,
    },
  });
});
