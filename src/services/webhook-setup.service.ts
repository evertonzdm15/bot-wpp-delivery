import axios from "axios";
import { env } from "../config/env";
import { logger } from "../lib/logger";

/**
 * Registra (idempotente) o webhook na Evolution API apontando para este serviço.
 * publicUrl ex.: https://bot.grupodm.site
 */
export async function ensureWebhook(publicUrl?: string): Promise<void> {
  if (!publicUrl) {
    logger.warn("PUBLIC_URL não definido — pulando auto-configuração do webhook.");
    return;
  }
  const url = `${publicUrl.replace(/\/$/, "")}/webhook${
    env.WEBHOOK_TOKEN ? `?token=${env.WEBHOOK_TOKEN}` : ""
  }`;
  try {
    await axios.post(
      `${env.EVOLUTION_API_URL}/webhook/set/${env.EVOLUTION_INSTANCE}`,
      {
        webhook: {
          enabled: true,
          url,
          webhookByEvents: false,
          webhookBase64: false,
          events: ["MESSAGES_UPSERT", "GROUPS_UPSERT", "GROUPS_UPDATE"],
        },
      },
      { headers: { apikey: env.EVOLUTION_API_KEY } }
    );
    logger.info({ url }, "Webhook configurado na Evolution API.");
  } catch (err: any) {
    logger.error(
      { err: err?.response?.data ?? err?.message },
      "Falha ao configurar webhook automaticamente (configure manualmente se necessário)."
    );
  }
}
