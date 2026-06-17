import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { dayjs, formatMoney } from "../utils/format";
import { env } from "../config/env";

export type Period = "hoje" | "7d" | "30d" | "tudo";

export function periodRange(period: Period): Date | undefined {
  const now = dayjs().tz(env.TZ);
  switch (period) {
    case "hoje":
      return now.startOf("day").toDate();
    case "7d":
      return now.subtract(7, "day").toDate();
    case "30d":
      return now.subtract(30, "day").toDate();
    case "tudo":
      return undefined;
  }
}

export const PERIOD_LABEL: Record<Period, string> = {
  hoje: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  tudo: "Tudo",
};

export interface ReportRow {
  kind: string;
  count: number;
  sumCents: number;
}

export interface Report {
  rows: ReportRow[];
  totalCount: number;
  totalCents: number;
}

async function ledgerReport(where: Prisma.LancamentoWhereInput): Promise<Report> {
  const grouped = await prisma.lancamento.groupBy({
    by: ["kind"],
    where,
    _count: { _all: true },
    _sum: { valueCents: true },
  });
  const rows: ReportRow[] = grouped
    .map((g) => ({ kind: g.kind, count: g._count._all, sumCents: g._sum.valueCents ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  const totalCents = rows.reduce((s, r) => s + r.sumCents, 0);
  return { rows, totalCount, totalCents };
}

export function motoboyReport(motoboyId: string, period: Period): Promise<Report> {
  const gte = periodRange(period);
  return ledgerReport({ motoboyId, ...(gte ? { createdAt: { gte } } : {}) });
}

export function adminReport(adminId: string, period: Period): Promise<Report> {
  const gte = periodRange(period);
  return ledgerReport({ adminId, ...(gte ? { createdAt: { gte } } : {}) });
}

export function globalReport(period: Period): Promise<Report> {
  const gte = periodRange(period);
  return ledgerReport(gte ? { createdAt: { gte } } : {});
}

/** Texto pronto de um relatório */
export function renderReport(title: string, period: Period, r: Report): string {
  if (!r.totalCount) return `${title}\n📅 ${PERIOD_LABEL[period]}\n\n📭 Sem entregas no período.`;
  const lines = r.rows.map(
    (row) => `• ${row.kind}: ${row.count} × = ${formatMoney(row.sumCents)}`
  );
  return (
    `${title}\n📅 ${PERIOD_LABEL[period]}\n\n` +
    lines.join("\n") +
    `\n─────────────\nTotal: ${r.totalCount} entrega(s) = *${formatMoney(r.totalCents)}*`
  );
}

/** Entregas finalizadas nos últimos 30 dias (proxy de "média/mês") */
export async function finalizadas30d(where: Prisma.TaskWhereInput): Promise<number> {
  const gte = dayjs().tz(env.TZ).subtract(30, "day").toDate();
  return prisma.task.count({ where: { ...where, status: "FINALIZADA", finishedAt: { gte } } });
}

/** Receita da plataforma (taxa % por admin sobre o valor das entregas). */
export async function renderPlatformRevenue(period: Period): Promise<string> {
  const gte = periodRange(period);
  const admins = await prisma.admin.findMany({ orderBy: { name: "asc" } });
  const lines: string[] = [];
  let total = 0;
  for (const a of admins) {
    const agg = await prisma.lancamento.aggregate({
      where: { adminId: a.id, ...(gte ? { createdAt: { gte } } : {}) },
      _sum: { valueCents: true },
    });
    const base = agg._sum.valueCents ?? 0;
    if (base === 0 && a.platformFeePercent === 0) continue;
    const rev = Math.round((base * a.platformFeePercent) / 100);
    total += rev;
    lines.push(
      `• ${a.name}: base ${formatMoney(base)} × ${a.platformFeePercent}% = ${formatMoney(rev)}`
    );
  }
  if (!lines.length) return `💼 *RECEITA DA PLATAFORMA*\n📅 ${PERIOD_LABEL[period]}\n\nSem dados.`;
  return (
    `💼 *RECEITA DA PLATAFORMA*\n📅 ${PERIOD_LABEL[period]}\n\n` +
    lines.join("\n") +
    `\n─────────────\nTotal: *${formatMoney(total)}*`
  );
}
