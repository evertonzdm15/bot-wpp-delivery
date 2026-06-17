import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

export const BACKUP_MIMETYPE = "application/json";

/** Exporta todos os dados em JSON (para recuperação posterior). */
export async function exportBackup(): Promise<{ buffer: Buffer; counts: Record<string, number> }> {
  const [admins, users, branches, deliveryTypes, userRoles, motoboyRates, tasks, taskItems, lancamentos, waGroups, registrationRequests] =
    await Promise.all([
      prisma.admin.findMany(),
      prisma.user.findMany(),
      prisma.branch.findMany(),
      prisma.deliveryType.findMany(),
      prisma.userRole.findMany(),
      prisma.motoboyRate.findMany(),
      prisma.task.findMany(),
      prisma.taskItem.findMany(),
      prisma.lancamento.findMany(),
      prisma.waGroup.findMany(),
      prisma.registrationRequest.findMany(),
    ]);

  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    admins, users, branches, deliveryTypes, userRoles, motoboyRates, tasks, taskItems, lancamentos, waGroups, registrationRequests,
  };
  const counts = {
    admins: admins.length,
    filiais: branches.length,
    usuarios: users.length,
    pedidos: tasks.length,
    lancamentos: lancamentos.length,
  };
  return { buffer: Buffer.from(JSON.stringify(data, null, 2), "utf8"), counts };
}

/** Restaura um backup (APAGA os dados atuais e recria a partir do arquivo). */
export async function importBackup(buffer: Buffer): Promise<{ ok: boolean; msg: string }> {
  let data: any;
  try {
    data = JSON.parse(buffer.toString("utf8"));
  } catch {
    return { ok: false, msg: "Arquivo não é um JSON válido." };
  }
  if (!data || !Array.isArray(data.admins) || !Array.isArray(data.users)) {
    return { ok: false, msg: "Arquivo de backup inválido (estrutura não reconhecida)." };
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        // Apaga em ordem de dependência
        await tx.lancamento.deleteMany({});
        await tx.taskItem.deleteMany({});
        await tx.taskMessage.deleteMany({});
        await tx.task.deleteMany({});
        await tx.motoboyRate.deleteMany({});
        await tx.userRole.deleteMany({});
        await tx.deliveryType.deleteMany({});
        await tx.registrationRequest.deleteMany({});
        await tx.branch.deleteMany({});
        await tx.waGroup.deleteMany({});
        await tx.admin.deleteMany({});
        await tx.user.deleteMany({});

        // Recria (pais antes dos filhos)
        const m = async (model: any, rows: any[]) => {
          if (rows?.length) await model.createMany({ data: rows });
        };
        await m(tx.admin, data.admins);
        await m(tx.user, data.users);
        await m(tx.waGroup, data.waGroups);
        await m(tx.branch, data.branches);
        await m(tx.registrationRequest, data.registrationRequests);
        await m(tx.deliveryType, data.deliveryTypes);
        await m(tx.userRole, data.userRoles);
        await m(tx.motoboyRate, data.motoboyRates);
        await m(tx.task, data.tasks);
        await m(tx.taskItem, data.taskItems);
        await m(tx.lancamento, data.lancamentos);
      },
      { timeout: 120000 }
    );

    // Reposiciona a sequência do código dos pedidos
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"Task"','code'), GREATEST((SELECT COALESCE(MAX(code),1) FROM "Task"),1))`
    );

    return {
      ok: true,
      msg: `Restaurado: ${data.admins.length} admin(s), ${data.branches?.length ?? 0} filial(is), ${data.tasks?.length ?? 0} pedido(s).`,
    };
  } catch (err: any) {
    logger.error({ err: err?.message }, "Falha ao restaurar backup");
    return { ok: false, msg: `Erro ao restaurar: ${err?.message ?? err}` };
  }
}
