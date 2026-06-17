import { FinishReason } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { TaskFull } from "./task.service";

/** Valor (centavos) de um tipo de entrega para o motoboy, com fallback no valor padrão. */
async function rateForType(
  motoboyId: string,
  deliveryTypeId: string | null,
  defaultCents: number | null | undefined
): Promise<number> {
  if (deliveryTypeId) {
    const r = await prisma.motoboyRate.findFirst({
      where: { motoboyId, deliveryTypeId, isTR: false },
    });
    if (r) return r.valueCents;
  }
  return defaultCents ?? 0;
}

async function rateForTR(
  motoboyId: string,
  defaultCents: number | null | undefined
): Promise<number> {
  const r = await prisma.motoboyRate.findFirst({ where: { motoboyId, isTR: true } });
  return r ? r.valueCents : defaultCents ?? 0;
}

/**
 * Gera o livro de lançamentos de um pedido finalizado:
 * 1 linha do tipo principal + N linhas de TR, com valores congelados.
 */
export async function lancarFinalizacao(
  task: TaskFull,
  motoboyId: string,
  reason: FinishReason
): Promise<{ count: number; totalCents: number }> {
  const motoboy = await prisma.user.findUnique({ where: { id: motoboyId } });
  const def = motoboy?.defaultRateCents;

  const mainValue = await rateForType(motoboyId, task.deliveryTypeId, def);
  const trValue = task.trItems.length ? await rateForTR(motoboyId, def) : 0;

  const rows = [
    { kind: task.typeName, isTR: false, valueCents: mainValue },
    ...task.trItems.map(() => ({ kind: "TR", isTR: true, valueCents: trValue })),
  ];

  await prisma.lancamento.createMany({
    data: rows.map((r) => ({
      taskId: task.id,
      motoboyId,
      adminId: task.adminId,
      kind: r.kind,
      isTR: r.isTR,
      valueCents: r.valueCents,
      reason,
    })),
  });

  const totalCents = rows.reduce((s, r) => s + r.valueCents, 0);
  return { count: rows.length, totalCents };
}
