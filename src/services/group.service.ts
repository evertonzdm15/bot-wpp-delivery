import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

/** Registra/atualiza um grupo de WhatsApp em que o bot está. */
export async function upsertGroupFromEvent(jid: string, name: string): Promise<void> {
  if (!jid || !jid.endsWith("@g.us")) return;
  await prisma.waGroup.upsert({
    where: { jid },
    update: { name: name || undefined },
    create: { jid, name: name || jid },
  });
  logger.info({ jid, name }, "Grupo capturado");
}

/** Processa um evento de grupos da Evolution (groups.upsert / groups.update). */
export async function handleGroupEvent(data: any): Promise<void> {
  const groups = Array.isArray(data) ? data : [data];
  for (const g of groups) {
    const jid = g?.id ?? g?.jid ?? g?.remoteJid;
    const name = g?.subject ?? g?.name ?? g?.subjectOwner ?? "";
    if (jid) await upsertGroupFromEvent(jid, name);
  }
}
