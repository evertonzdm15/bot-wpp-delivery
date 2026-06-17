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

export function mapsLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Card enxuto do pedido enviado ao motoboy (só o essencial para a entrega). */
export function formatTaskMessage(t: TaskFull, withInstructions = true): string {
  const coleta = t.pickupAddress || `Filial ${t.branch.name}`;
  const lines: string[] = [];
  lines.push(`📦 *PEDIDO #${t.code}*${t.priority ? " 🔴 URGENTE" : ""}`);
  lines.push(`🚚 Tipo: ${t.typeName}`);
  if (t.clientName) lines.push(`👤 Cliente: ${t.clientName}`);
  lines.push(`📤 Coleta: ${coleta}`);
  if (t.pickupAddress) lines.push(`   🗺️ ${mapsLink(t.pickupAddress)}`);
  if (t.trItems.length) {
    lines.push(`🔁 Transferências (${t.trItems.length}):`);
    t.trItems.forEach((tr, idx) => lines.push(`   ${idx + 1}. ${tr}`));
  }
  if (t.address) {
    lines.push(`📥 Entrega: ${t.address}`);
    lines.push(`   🗺️ ${mapsLink(t.address)}`);
  }
  lines.push(`⏰ Prazo: ${fmtDateTime(t.dueAt)}`);

  if (withInstructions) {
    lines.push("");
    lines.push(`↩️ *pegar ${t.code}* · *finalizar ${t.code}*  (ou cite esta mensagem)`);
  }
  return lines.join("\n");
}

/** Mensagem completa para o grupo de auditoria (registro da solicitação). */
export function formatAuditMessage(t: TaskFull, kind: "criado" | "atribuido"): string {
  const coleta = t.pickupAddress || `Filial ${t.branch.name}`;
  const lines: string[] = [];
  lines.push(
    kind === "criado"
      ? `🧾 *NOVO PEDIDO #${t.code}* — ${t.typeName}`
      : `🛵 *PEDIDO #${t.code} ATRIBUÍDO* — ${t.typeName}`
  );
  lines.push(`🏪 Filial: ${t.branch.name}`);
  lines.push(`🙋 Solicitado por: ${t.createdBy.name ?? t.createdBy.phone}`);
  if (t.clientName) lines.push(`👤 Cliente: ${t.clientName}${t.clientPhone ? ` (${t.clientPhone})` : ""}`);
  lines.push(`📤 Coleta: ${coleta}`);
  if (t.address) lines.push(`📥 Entrega: ${t.address}`);
  if (t.items.length) lines.push(`🧾 Itens: ${t.items.map((i) => i.description).join(", ")}`);
  if (t.trItems.length) lines.push(`🔁 TRs: ${t.trItems.join(" | ")}`);
  if (t.notes) lines.push(`📝 Obs: ${t.notes}`);
  if (t.dueAt) lines.push(`⏰ Prazo: ${fmtDateTime(t.dueAt)}`);
  if (kind === "atribuido" && t.motoboy) {
    lines.push(`🛵 Motoboy: ${t.motoboy.name ?? t.motoboy.phone}`);
  } else {
    lines.push(`🟡 Status: aguardando motoboy`);
  }
  return lines.join("\n");
}
