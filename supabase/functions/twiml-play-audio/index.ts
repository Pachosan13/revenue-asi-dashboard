import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const audioUrl = url.searchParams.get("audio_url")

  if (!audioUrl) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, no audio was provided.</Say>
  <Hangup/>
</Response>`

    return new Response(twiml, {
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    })
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Hangup/>
</Response>`

  return new Response(twiml, {
    headers: { ...corsHeaders, "Content-Type": "text/xml" },
  })
})
