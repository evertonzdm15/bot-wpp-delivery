import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { sendText } from "../services/evolution.service";
import { motoboysDoAdmin, taskInclude } from "../services/task.service";
import { fmtDateTime } from "../utils/format";
import { logger } from "../lib/logger";

/**
 * A cada minuto: encontra pedidos que vencem dentro da janela de antecedência
 * e ainda não venceram, sem alerta enviado, e dispara o aviso.
 */
async function checkDueSoon(): Promise<void> {
  const now = new Date();
  const limit = new Date(now.getTime() + env.ALERTA_ANTECEDENCIA_MIN * 60_000);

  const tasks = await prisma.task.findMany({
    where: {
      status: { in: ["PENDENTE", "ATRIBUIDA"] },
      alertSent: false,
      dueAt: { not: null, gte: now, lte: limit },
    },
    include: taskInclude,
  });

  for (const t of tasks) {
    const header =
      `⚠️ *ALERTA DE VENCIMENTO*\n` +
      `Pedido *#${t.code}* (${t.typeName}) vence às *${fmtDateTime(t.dueAt)}*.`;

    const targets = new Set<string>();
    if (t.motoboy) targets.add(t.motoboy.phone);
    targets.add(t.createdBy.phone);
    // Se ainda está na fila, avisa os motoboys do tenant
    if (t.status === "PENDENTE") {
      const motoboys = await motoboysDoAdmin(t.adminId);
      motoboys.forEach((m) => targets.add(m.phone));
    }

    for (const phone of targets) {
      await sendText(
        phone,
        `${header}${t.status === "PENDENTE" ? "\n🛵 Ainda *sem motoboy* — responda *pegar*!" : ""}`
      );
    }

    await prisma.task.update({ where: { id: t.id }, data: { alertSent: true } });
    logger.info({ code: t.code }, "Alerta de vencimento enviado");
  }
}

export function startAlertJob(): void {
  cron.schedule("* * * * *", () => {
    checkDueSoon().catch((err) => logger.error({ err }, "Erro no job de alertas"));
  });
  logger.info("Job de alertas iniciado (verificação a cada minuto).");
}
