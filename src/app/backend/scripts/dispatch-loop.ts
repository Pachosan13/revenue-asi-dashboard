import "dotenv/config"
import { spawn } from "node:child_process"

const INTERVAL_MS = Number(process.env.DISPATCH_LOOP_MS ?? 5000)
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() === "true"

function runOnce(): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("npx", ["tsx", "-r", "dotenv/config", "scripts/dispatch-engine.ts"], {
      stdio: "inherit",
      env: process.env,
    })
    p.on("close", (code) => resolve(code ?? 0))
  })
}

async function main() {
  console.log("🔁 dispatch-loop start", { DRY_RUN, INTERVAL_MS })
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const code = await runOnce()
    if (code !== 0) console.log("⚠️ dispatch-engine exit code", code)
    await new Promise((r) => setTimeout(r, INTERVAL_MS))
  }
}

main().catch((e) => {
  console.error("❌ fatal loop", e)
  process.exit(1)
})
