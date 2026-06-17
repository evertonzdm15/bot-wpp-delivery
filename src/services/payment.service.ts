import { prisma } from "../lib/prisma";

export interface MotoboyPay {
  motoboyId: string;
  name: string;
  phone: string;
  count: number;
  totalCents: number;
}

/** Lançamentos NÃO pagos agrupados por motoboy, no tenant. */
export async function pendingByMotoboy(adminId: string): Promise<MotoboyPay[]> {
  const grouped = await prisma.lancamento.groupBy({
    by: ["motoboyId"],
    where: { adminId, paid: false },
    _count: { _all: true },
    _sum: { valueCents: true },
  });
  const out: MotoboyPay[] = [];
  for (const g of grouped) {
    const u = await prisma.user.findUnique({ where: { id: g.motoboyId } });
    out.push({
      motoboyId: g.motoboyId,
      name: u?.name ?? u?.phone ?? "?",
      phone: u?.phone ?? "",
      count: g._count._all,
      totalCents: g._sum.valueCents ?? 0,
    });
  }
  return out.sort((a, b) => b.totalCents - a.totalCents);
}

/** Marca como pagos os lançamentos pendentes de um motoboy. */
export async function markPaid(
  adminId: string,
  motoboyId: string
): Promise<{ count: number; totalCents: number }> {
  const pend = await prisma.lancamento.findMany({ where: { adminId, motoboyId, paid: false } });
  const totalCents = pend.reduce((s, l) => s + l.valueCents, 0);
  await prisma.lancamento.updateMany({
    where: { adminId, motoboyId, paid: false },
    data: { paid: true, paidAt: new Date() },
  });
  return { count: pend.length, totalCents };
}
