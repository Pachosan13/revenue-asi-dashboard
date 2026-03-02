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

  let url = null;
  let host = "unknown";
  try {
    url = new URL(connectionString);
    host = url.hostname || "unknown";
  } catch {
    host = "unknown";
  }

  const supabaseHost = host.includes(".supabase.co");
  const localHost = isLocalHost(host);
  if (supabaseHost) {
    if (!url) throw new Error("Invalid DATABASE_URL");
    const port = Number(url.port || "5432");
    const database = decodeURIComponent(String(url.pathname || "").replace(/^\/+/, ""));
    const user = decodeURIComponent(url.username || "");
    const password = decodeURIComponent(url.password || "");
    return {
      host,
      port,
      database,
      user,
      password,
      ssl: { rejectUnauthorized: false },
      meta: {
        host,
        ssl: true,
        rejectUnauthorized: false,
      },
    };
  }

  // Localhost uses plain connectionString without SSL.
  if (localHost) {
    return {
      connectionString,
      meta: {
        host,
        ssl: false,
        rejectUnauthorized: false,
      },
    };
  }

  const sslEnabled = envBool("PG_SSL", true);
  const rejectUnauthorized = sslEnabled ? envBool("PG_SSL_REJECT_UNAUTHORIZED", false) : false;

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

export function logPgSslObject(ssl) {
  const sslType = typeof ssl;
  const keys = ssl && sslType === "object" ? Object.keys(ssl).join(",") : "";
  console.log(`pg_ssl_object: ${sslType} keys=${keys}`);
}
