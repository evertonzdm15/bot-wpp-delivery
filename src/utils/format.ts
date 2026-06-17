import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { FinishReason, TaskStatus } from "@prisma/client";
import { env } from "../config/env";
import { TaskFull } from "../services/task.service";

dayjs.extend(utc);
dayjs.extend(timezone);

export { dayjs };

/** minúsculas, sem acentos, sem espaços nas pontas */
export function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "PENDENTE":
      return "🟡 Pendente";
    case "ATRIBUIDA":
      return "🔵 Atribuída";
    case "FINALIZADA":
      return "🟢 Finalizada";
    case "CANCELADA":
      return "🔴 Cancelada";
  }
}

export function finishReasonLabel(reason: FinishReason): string {
  switch (reason) {
    case "ENTREGUE":
      return "✅ Entregue";
    case "NAO_ENTREGUE":
      return "❌ Não entregue";
    case "RETORNO":
      return "↩️ Retorno à loja";
  }
}

/** centavos -> "R$ 12,34" */
export function formatMoney(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100;
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

/** "12,50" | "12.5" | "1250" (com "centavos"?) -> centavos. Retorna null se inválido. */
export function parseMoneyToCents(text: string): number | null {
  const t = text.trim().replace(/r\$/i, "").replace(/\s/g, "");
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return null;
  const norm = t.replace(",", ".");
  return Math.round(parseFloat(norm) * 100);
}

export function fmtDateTime(d?: Date | null): string {
  if (!d) return "-";
  return dayjs(d).tz(env.TZ).format("DD/MM HH:mm");
}

/**
 * Aceita "HH:mm" (hoje; se já passou, amanhã) ou "dd/mm HH:mm" ou "dd/mm/aaaa HH:mm".
 */
export function parseDateTime(text: string): Date | null {
  const t = text.trim();
  const now = dayjs().tz(env.TZ);
  const pad = (n: string) => n.padStart(2, "0");

  let m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2})$/);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.year();
    const d = dayjs.tz(`${year}-${pad(m[2])}-${pad(m[1])} ${pad(m[4])}:${m[5]}`, env.TZ);
    return d.isValid() ? d.toDate() : null;
  }

  m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    let d = now.hour(Number(m[1])).minute(Number(m[2])).second(0).millisecond(0);
    if (!d.isValid()) return null;
    if (d.isBefore(now)) d = d.add(1, "day");
    return d.toDate();
  }

  return null;
}

/** Mensagem padrão de um pedido (enviada uma por pedido aos motoboys) */
export function formatTaskMessage(t: TaskFull, withInstructions = true): string {
  const lines: string[] = [];
  lines.push(`📦 *PEDIDO #${t.code}*${t.priority ? " 🔴 URGENTE" : ""} — ${t.typeName}`);
  lines.push(`🏪 Filial: ${t.branch.name}`);
  if (t.clientName) lines.push(`👤 Cliente: ${t.clientName}`);
  if (t.clientPhone) lines.push(`📞 Telefone: ${t.clientPhone}`);
  if (t.address) {
    lines.push(`📍 Endereço: ${t.address}`);
    lines.push(`🗺️ Abrir no mapa: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.address)}`);
  }
  if (t.items.length) {
    lines.push("🧾 Itens:");
    for (const i of t.items) lines.push(`   • ${i.description}`);
  }
  if (t.trItems.length) {
    lines.push(`🔁 Coletas adicionais (TR) — ${t.trItems.length}:`);
    t.trItems.forEach((tr, idx) => lines.push(`   ${idx + 1}. ${tr}`));
  }
  if (t.notes) lines.push(`📝 Obs: ${t.notes}`);
  if (t.dueAt) lines.push(`⏰ Limite: ${fmtDateTime(t.dueAt)}`);
  lines.push(
    `👀 Status: ${statusLabel(t.status)}${
      t.motoboy ? ` | 🛵 ${t.motoboy.name ?? t.motoboy.phone}` : ""
    }`
  );

  if (withInstructions) {
    lines.push("");
    lines.push("↩️ *Responda (cite) esta mensagem* com:");
    lines.push("• *pegar* — assumir o pedido");
    lines.push("• *soltar* — liberar o pedido");
    lines.push("• *finalizar* — concluir (vou pedir o resultado)");
    lines.push(`_(ou envie *pegar ${t.code}* / *finalizar ${t.code}*)_`);
  }
  return lines.join("\n");
}
