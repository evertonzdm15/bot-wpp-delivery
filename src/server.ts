import express from "express";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { processWebhook } from "./core/webhook";
import { startAlertJob } from "./jobs/alerts.job";
import { ensureWebhook } from "./services/webhook-setup.service";
import { ensureSuperAdmin } from "./services/user.service";
import { prisma } from "./lib/prisma";
import "./flows"; // registra todos os fluxos

const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post("/webhook", (req, res) => {
  // Token opcional de proteção
  if (env.WEBHOOK_TOKEN && req.query.token !== env.WEBHOOK_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  // Responde imediatamente; processa de forma assíncrona
  res.status(200).json({ received: true });
  processWebhook(req.body).catch((err) =>
    logger.error({ err }, "Erro não tratado ao processar webhook")
  );
});

async function bootstrap(): Promise<void> {
  await prisma.$connect();
  await ensureSuperAdmin(env.SUPER_ADMIN_PHONE, env.SUPER_ADMIN_CODE);
  startAlertJob();
  await ensureWebhook(process.env.PUBLIC_URL);

  app.listen(env.PORT, () => {
    logger.info(`🚀 Bot de delivery rodando na porta ${env.PORT} (${env.NODE_ENV})`);
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, "Falha ao iniciar o servidor");
  process.exit(1);
});

async function shutdown(): Promise<void> {
  logger.info("Encerrando...");
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
