export type OpenAiEnvMeta = { exists: boolean; len: number; prefix: string }

function meta(v: string | undefined): OpenAiEnvMeta {
  const s = String(v ?? "").trim()
  return { exists: Boolean(s), len: s ? s.length : 0, prefix: s ? s.slice(0, 10) : "" }
}

function normalizeOpenAiKey(raw: string | undefined | null) {
  const k = String(raw ?? "").trim()
  if (!k) return null
  if (!k.startsWith("sk-")) return null
  // Must not contain whitespace.
  if (/\s/.test(k)) return null
  if (k.length < 20) return null
  return k
}

/**
 * Normalize env names into a single internal key:
 * - prefer OPENAI_API_KEY
 * - fallback OPEN_AI_KEY
 * - legacy fallback OPEN_API_KEY (exists in some supabase env files)
 *
 * Never overwrites an existing OPENAI_API_KEY.
 */
export function ensureOpenAiApiKeyEnv(): { key: string | null; source: "OPENAI_API_KEY" | "OPEN_AI_KEY" | "OPEN_API_KEY" | null } {
  const primary = normalizeOpenAiKey(process.env.OPENAI_API_KEY)
  if (primary) return { key: primary, source: "OPENAI_API_KEY" }

  const fallback = normalizeOpenAiKey(process.env.OPEN_AI_KEY)
  if (fallback) {
    process.env.OPENAI_API_KEY = fallback
    return { key: fallback, source: "OPEN_AI_KEY" }
  }

  const legacy = normalizeOpenAiKey(process.env.OPEN_API_KEY)
  if (legacy) {
    process.env.OPENAI_API_KEY = legacy
    return { key: legacy, source: "OPEN_API_KEY" }
  }

  return { key: null, source: null }
}

export function getOpenAiKey(): { key: string | null; source: "OPENAI_API_KEY" | "OPEN_AI_KEY" | "OPEN_API_KEY" | null } {
  return ensureOpenAiApiKeyEnv()
}

export function getOpenAiEnvDebug() {
  // ensure OPENAI_API_KEY is populated when legacy names exist
  ensureOpenAiApiKeyEnv()
  return {
    OPENAI_API_KEY: meta(process.env.OPENAI_API_KEY),
    OPEN_AI_KEY: meta(process.env.OPEN_AI_KEY),
    OPEN_API_KEY: meta(process.env.OPEN_API_KEY),
  }
}


