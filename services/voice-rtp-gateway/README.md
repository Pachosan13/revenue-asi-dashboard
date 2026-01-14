# revenue-asi-voice-gateway (Fly.io)

WS gateway bridging **Twilio Media Streams** (primary) / **Telnyx Call Control Streaming** (fallback) ↔ **OpenAI Realtime**.

## Endpoints

- `GET /healthz` → `200 ok`
- `WS /twilio`
  - No token required.
- `WS /telnyx?token=VOICE_GATEWAY_TOKEN`
  - If token missing/wrong: closes with code **1008**.

## Env vars

- `VOICE_GATEWAY_TOKEN` (required for `/telnyx`): shared token required in `?token=...`.
- `VOICE_CARRIER_PRIMARY` (optional): `"twilio" | "telnyx"` (default: `"twilio"`).
- `OPENAI_API_KEY` (**required**): OpenAI key for Realtime WS.
- `OPENAI_REALTIME_URL` (optional): override OpenAI realtime WS URL.
- `OPENAI_REALTIME_MODEL` (optional): model used when `OPENAI_REALTIME_URL` not set.
- `SUPABASE_VOICE_HANDOFF_URL` (optional): Edge endpoint URL to receive HOT handoff.
- `SUPABASE_VOICE_HANDOFF_TOKEN` (optional): bearer token for the handoff endpoint (if required).

## Twilio

### WS endpoint

- `WS /twilio` (no token)

### TwiML example

```xml
<Response>
  <Connect>
    <Stream url="wss://revenue-asi-voice-gateway.fly.dev/twilio"/>
  </Connect>
</Response>
```

## Run locally

```bash
cd services/voice-rtp-gateway
export VOICE_GATEWAY_TOKEN="devtoken"
export VOICE_CARRIER_PRIMARY="twilio"
export OPENAI_API_KEY="..."
npm install
npm run dev
```

## Test locally with wscat (mock Telnyx events)

Install wscat:

```bash
npm i -g wscat
```

Connect:

```bash
wscat -c "ws://127.0.0.1:8080/telnyx?token=devtoken"
```

Send a tolerant “start” event:

```json
{"event":"start","stream_id":"s1","call_control_id":"cc1","client_state":"eyJ0b3VjaF9ydW5faWQiOiJ0cjEiLCJsZWFkX2lkIjoibDEiLCJhY2NvdW50X2lkIjoiYTEiLCJzb3VyY2UiOiJlbmN1ZW50cmEyNCJ9"}
```

Send a “media” event (payload base64 is mocked / not real μ-law):

```json
{"event":"media","stream_id":"s1","media":{"payload":"AA=="}}
```

Expected logs include:
- `TELNYX_START`
- `OPENAI_CONNECT`
- `OPENAI_READY`
- `FIRST_AUDIO_SENT` (when OpenAI emits audio deltas)

## Deploy (Fly.io)

```
cd services/voice-rtp-gateway
fly deploy -a revenue-asi-voice-gateway
fly logs -a revenue-asi-voice-gateway
```

Notes:
- Uses Fly remote builder with Dockerfile (no local Docker Desktop required).
- PORT is set to 8080 via fly.toml.


