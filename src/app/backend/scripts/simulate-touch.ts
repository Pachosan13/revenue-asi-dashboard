import { handleCommandOsIntent } from "../src/command-os/router"

function envBool(name: string, def = false) {
  const v = process.env[name]
  if (v == null) return def
  return ["1", "true", "yes", "y"].includes(v.toLowerCase())
}

async function run() {
  const DRY_RUN = envBool("DRY_RUN", true)
  const LIMIT = Number(process.env.LIMIT ?? 5)

  console.log("🚀 Running touch.simulate", { DRY_RUN, LIMIT })

  const result = await handleCommandOsIntent({
    version: "v1",
    intent: "touch.simulate",
    args: {
      dry_run: DRY_RUN,
      limit: LIMIT,
    },
    explanation: "Local script: simulate touch runs via Command OS router.",
    confidence: 0.9,
  })

  console.log("✅ Simulation result:")
  console.dir(result, { depth: null })
}

run().catch((err) => {
  console.error("❌ Simulation failed", err)
  process.exit(1)
})
