## Encuentra24 reveal worker (teléfono real) — modo “Chrome real” + perfil persistente

El resolver vive en `worker/providers/phone-resolver/encuentra24_whatsapp_resolver.mjs` y lo ejecuta el worker `worker/run-enc24-reveal-worker.mjs`.

### Recomendado (más “real”): conectar a un Chrome ya abierto via CDP

Esto evita que Playwright “lance” el browser con flags típicos de automation. Tú abres **Chrome real** con un perfil persistente y Playwright solo se conecta.

1) Inicia Chrome con remote debugging:

```bash
# macOS (Google Chrome)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.enc24-chrome-profile" \
  --profile-directory="Default"
```

2) Corre el worker conectándose al CDP:

```bash
ENC24_CDP=1 \
ENC24_CDP_URL="http://127.0.0.1:9222" \
HEADLESS=0 \
SAVE_SHOTS=1 \
node worker/run-enc24-reveal-worker.mjs
```

### Alternativa: Playwright lanza **Chrome real** pero con perfil persistente

Si no quieres CDP, puedes pedirle a Playwright que use un `userDataDir` (perfil persistente) y el canal `chrome`.

```bash
ENC24_USER_DATA_DIR="$HOME/.enc24-pw-profile" \
ENC24_CHROME_CHANNEL="chrome" \
HEADLESS=0 \
SAVE_SHOTS=1 \
node worker/run-enc24-reveal-worker.mjs
```

Opcional (experimental): quitar `--enable-automation` del launch (puede ayudar o empeorar según el sitio):

```bash
ENC24_IGNORE_ENABLE_AUTOMATION=1 \
ENC24_USER_DATA_DIR="$HOME/.enc24-pw-profile" \
ENC24_CHROME_CHANNEL="chrome" \
HEADLESS=0 \
node worker/run-enc24-reveal-worker.mjs
```

### Señal de soft-block (“click inerte / no reveal”) + backoff

Si el resolver detecta “click en Llamar” sin cambios en el panel y sin `tel:`/texto revelado, devuelve:

- `reason = "soft_block_inert_reveal"`

El worker puede parar y enfriar si esto ocurre consecutivamente:

```bash
ENC24_STOP_ON_SOFT_BLOCK=1 \
ENC24_SOFT_BLOCK_STOP_THRESHOLD=2 \
ENC24_SOFT_BLOCK_COOLDOWN_MS=600000 \
node worker/run-enc24-reveal-worker.mjs
```

### Evitar polling infinito cuando estás corriéndolo “a mano”

Si quieres que el worker procese lo que haya y **se apague** cuando la cola esté vacía:

```bash
EXIT_ON_EMPTY=1 \
EMPTY_POLLS_TO_EXIT=2 \
EMPTY_SLEEP_MS=15000 \
node worker/run-enc24-reveal-worker.mjs
```

### Run “production-style” (worker + CDP + DB remota)

```bash
DATABASE_URL="postgresql://..." \
WORKER_ID="enc24-reveal-prod-1" \
LIMIT="10" \
LOOP="1" \
HEADLESS="0" \
ENC24_CDP=1 \
ENC24_CDP_URL="http://127.0.0.1:9222" \
ENC24_STOP_ON_SOFT_BLOCK=1 \
ENC24_SOFT_BLOCK_STOP_THRESHOLD=2 \
ENC24_SOFT_BLOCK_COOLDOWN_MS=600000 \
node worker/run-enc24-reveal-worker.mjs
```


