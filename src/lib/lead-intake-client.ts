import { supabaseBrowser } from "@/lib/supabase"

type ImportCsvParams = {
  file: File
  campaign_id?: string
  campaign_name?: string
}

export async function importLeadsCsv({
  file,
  campaign_id,
  campaign_name,
}: ImportCsvParams) {
  const formData = new FormData()
  formData.append("file", file)
  if (campaign_id) formData.append("campaign_id", campaign_id)
  if (campaign_name) formData.append("campaign_name", campaign_name)

  const res = await fetch("/api/intake/csv", {
    method: "POST",
    body: formData,
  })

  if (!res.ok) {
    throw new Error("CSV import failed")
  }

  return res.json()
}

export async function addSingleLead(payload: {
  name?: string
  email?: string
  phone?: string
  campaign_id?: string
  campaign_name?: string
}) {
  const res = await fetch("/api/intake/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    throw new Error("Manual lead insert failed")
  }

  return res.json()
}

export function getWebhookUrl() {
  return `${window.location.origin}/api/intake/webhook`
}
