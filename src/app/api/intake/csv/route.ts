import { NextResponse } from "next/server"

// TODO: aquí conectas a tu intake engine real
// Por ahora devuelve OK para probar UI.
export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

    // campaign optional
    const campaign_id = form.get("campaign_id")?.toString() ?? null
    const campaign_name = form.get("campaign_name")?.toString() ?? null

    // ✅ Placeholder: reemplazar con tu engine
    return NextResponse.json({
      ok: true,
      source: "csv",
      inserted: 1,
      duplicates: 0,
      campaign_id,
      campaign_name,
      filename: file.name,
    })
  } catch (e) {
    return NextResponse.json({ error: "CSV intake failed" }, { status: 500 })
  }
}
