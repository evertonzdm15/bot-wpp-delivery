import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/** Linha-resumo (pendentes · em rota · vencidos) para o cabeçalho dos menus. */
export async function resumoLinha(scope: Prisma.TaskWhereInput): Promise<string> {
  const now = new Date();
  const [pend, rota, venc] = await Promise.all([
    prisma.task.count({ where: { ...scope, status: "PENDENTE" } }),
    prisma.task.count({ where: { ...scope, status: "ATRIBUIDA" } }),
    prisma.task.count({
      where: { ...scope, status: { in: ["PENDENTE", "ATRIBUIDA"] }, dueAt: { lt: now } },
    }),
  ]);
  return `📊 ${pend} pendente(s) · ${rota} em rota · ${venc} vencido(s)`;
}
