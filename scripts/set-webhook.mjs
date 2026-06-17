// Alterna o webhook da Evolution API.
// Uso:
//   node scripts/set-webhook.mjs tunnel https://xxx.trycloudflare.com
//   node scripts/set-webhook.mjs prod          (volta para https://bot.grupodm.site)
//   node scripts/set-webhook.mjs show           (mostra o webhook atual)
import "dotenv/config";

const API = process.env.EVOLUTION_API_URL ?? "https://api.grupodm.site";
const INSTANCE = process.env.EVOLUTION_INSTANCE ?? "GRUPODM";
const KEY = process.env.EVOLUTION_API_KEY;
const TOKEN = process.env.WEBHOOK_TOKEN ?? "";

const PROD_URL = "https://bot.grupodm.site";

const mode = process.argv[2];
const arg = process.argv[3];

function withWebhookPath(base) {
  return `${base.replace(/\/$/, "")}/webhook${TOKEN ? `?token=${TOKEN}` : ""}`;
}

async function show() {
  const r = await fetch(`${API}/webhook/find/${INSTANCE}`, { headers: { apikey: KEY } });
  console.log(JSON.stringify(await r.json(), null, 2));
}

async function set(url) {
  const r = await fetch(`${API}/webhook/set/${INSTANCE}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url,
        webhookByEvents: false,
        webhookBase64: false,
        events: ["MESSAGES_UPSERT"],
      },
    }),
  });
  console.log(`Webhook -> ${url}`);
  console.log(JSON.stringify(await r.json(), null, 2));
}

if (!KEY) {
  console.error("EVOLUTION_API_KEY ausente no .env");
  process.exit(1);
}

if (mode === "show") await show();
else if (mode === "prod") await set(withWebhookPath(PROD_URL));
else if (mode === "tunnel") {
  if (!arg) {
    console.error("Informe a URL do túnel: node scripts/set-webhook.mjs tunnel https://xxx.trycloudflare.com");
    process.exit(1);
  }
  await set(withWebhookPath(arg));
} else {
  console.log("Uso: node scripts/set-webhook.mjs [show|prod|tunnel <url>]");
}
