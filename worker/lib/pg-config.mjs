function envBool(name, def = false) {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return def;
  if (["1", "true", "yes", "y", "si", "sí", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return def;
}

function isLocalHost(host) {
  const h = String(host || "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export function getPgConfig() {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) throw new Error("Missing DATABASE_URL");

  let host = "unknown";
  try {
    host = new URL(connectionString).hostname || "unknown";
  } catch {
    host = "unknown";
  }

  const supabaseHost = host.includes(".supabase.co");
  const localHost = isLocalHost(host);
  const supabaseSslHint = envBool("SUPABASE_DB_SSL", false);

  // Default behavior:
  // - Supabase/prod hint: SSL on, rejectUnauthorized off (unless overridden)
  // - Localhost: SSL off
  const defaultSsl = localHost ? false : (supabaseHost || supabaseSslHint);
  const sslEnabled = localHost ? false : envBool("PG_SSL", defaultSsl);
  const rejectUnauthorized = sslEnabled
    ? envBool("PG_SSL_REJECT_UNAUTHORIZED", false)
    : false;

  return {
    connectionString,
    ssl: sslEnabled ? { rejectUnauthorized } : false,
    meta: {
      host,
      ssl: sslEnabled,
      rejectUnauthorized,
    },
  };
}

export function logPgConnect(meta) {
  const host = String(meta?.host || "unknown");
  const ssl = Boolean(meta?.ssl);
  const rejectUnauthorized = Boolean(meta?.rejectUnauthorized);
  console.log(`pg_connect: host=${host} ssl=${ssl} rejectUnauthorized=${rejectUnauthorized}`);
}
