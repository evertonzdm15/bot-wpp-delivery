import { FinishReason } from "@prisma/client";
import { Ctx } from "./types";
import { prisma } from "../lib/prisma";
import { finishReasonLabel, formatMoney, normalize } from "../utils/format";
import { hasRole, upsertUser } from "../services/user.service";
import { notifyClient, taskInclude, TaskFull } from "../services/task.service";
import { lancarFinalizacao } from "../services/ledger.service";
import { motoboyReport, renderReport } from "../services/report.service";
import { sendText } from "../services/evolution.service";
import { goTo } from "./engine";

async function notifyCreator(creatorPhone: string, actorPhone: string, text: string): Promise<void> {
  if (!creatorPhone || creatorPhone === actorPhone) return;
  await sendText(creatorPhone, text);
}

/**
 * Aplica a ação do motoboy sobre um pedido já localizado (via citação):
 *  - "pegar"  -> atribui
 *  - "soltar" -> devolve à fila
 *  - outro    -> inicia finalização (pede motivo, fluxo interativo)
 */
export async function actOnTask(ctx: Ctx, task: TaskFull, action: string): Promise<void> {
  const a = normalize(action);
  const me = await upsertUser(ctx.msg.phone, ctx.msg.pushName);

  if (a === "pegar") {
    if (task.status === "FINALIZADA" || task.status === "CANCELADA") {
      await ctx.reply(`⚠️ O pedido *#${task.code}* já foi encerrado.`);
      return;
    }
    if (task.status === "ATRIBUIDA") {
      await ctx.reply(
        task.motoboyId === me.id
          ? `ℹ️ O pedido *#${task.code}* já é seu.`
          : `⚠️ O pedido *#${task.code}* já está com *${task.motoboy?.name ?? task.motoboy?.phone}*.`
      );
      return;
    }
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "ATRIBUIDA", motoboyId: me.id, assignedAt: new Date() },
    });
    await ctx.reply(`✅ Pedido *#${task.code}* é seu! Boa entrega. 🛵`);
    await notifyCreator(task.createdBy.phone, ctx.msg.phone,
      `🛵 Pedido *#${task.code}* foi assumido por *${me.name ?? me.phone}*.`);
    await notifyClient(task, "saiu");
    return;
  }

  if (a === "soltar") {
    if (task.status !== "ATRIBUIDA" || task.motoboyId !== me.id) {
      await ctx.reply(`⚠️ O pedido *#${task.code}* não está atribuído a você.`);
      return;
    }
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "PENDENTE", motoboyId: null, assignedAt: null },
    });
    await ctx.reply(`↩️ Pedido *#${task.code}* devolvido para a fila.`);
    await notifyCreator(task.createdBy.phone, ctx.msg.phone,
      `⚠️ Pedido *#${task.code}* foi liberado por *${me.name ?? me.phone}* e voltou para a fila.`);
    return;
  }

  // Finalização interativa (via citação) — pede motivo
  if (task.status === "FINALIZADA") return void (await ctx.reply(`ℹ️ O pedido *#${task.code}* já está finalizado.`));
  if (task.status === "CANCELADA") return void (await ctx.reply(`⚠️ O pedido *#${task.code}* foi cancelado.`));
  if (task.status === "PENDENTE") {
    return void (await ctx.reply(
      `⚠️ O pedido *#${task.code}* ainda não tem motoboy. Responda *pegar* antes de finalizar.`
    ));
  }
  if (task.motoboyId !== me.id) {
    return void (await ctx.reply(
      `⚠️ O pedido *#${task.code}* está com *${task.motoboy?.name ?? task.motoboy?.phone}* — só ele finaliza.`
    ));
  }

  ctx.session.data.finishTaskId = task.id;
  await goTo(ctx, "finalizar", "motivo");
}

/** Interpreta o texto extra de "finalizar N <texto>" em motivo + observação. */
export function parseFinishReason(rest: string): { reason: FinishReason; note: string | null } {
  const r = (rest ?? "").trim();
  const n = normalize(r);
  if (!n) return { reason: "ENTREGUE", note: null };
  if (n.startsWith("nao") || n.startsWith("n entregue") || n.includes("nao entregue")) {
    return { reason: "NAO_ENTREGUE", note: r || null };
  }
  if (n.startsWith("retorn")) return { reason: "RETORNO", note: r || null };
  return { reason: "ENTREGUE", note: r };
}

/** Finaliza um pedido diretamente (1 toque) e gera os lançamentos. */
export async function finalizeTaskNow(
  ctx: Ctx,
  taskId: string,
  reason: FinishReason,
  note: string | null
): Promise<void> {
  const me = await upsertUser(ctx.msg.phone, ctx.msg.pushName);
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: taskInclude });
  if (!task) return void (await ctx.reply("⚠️ Pedido não encontrado."));
  if (task.status === "FINALIZADA") return void (await ctx.reply(`ℹ️ O pedido *#${task.code}* já está finalizado.`));
  if (task.status === "PENDENTE") {
    return void (await ctx.reply(
      `⚠️ O pedido *#${task.code}* ainda não é seu. Envie *pegar ${task.code}* antes de finalizar.`
    ));
  }
  if (task.status === "CANCELADA" || task.motoboyId !== me.id) {
    return void (await ctx.reply(`⚠️ O pedido *#${task.code}* não está com você.`));
  }

  await prisma.task.update({
    where: { id: task.id },
    data: { status: "FINALIZADA", finishedAt: new Date(), finishReason: reason, finishNote: note },
  });
  const { count, totalCents } = await lancarFinalizacao(task, me.id, reason);
  await ctx.reply(
    `🏁 Pedido *#${task.code}* finalizado — ${finishReasonLabel(reason)}.\n` +
      `📒 Lançado: *${count}* unidade(s) = *${formatMoney(totalCents)}*` +
      `${task.trItems.length ? ` (1 principal + ${task.trItems.length} TR)` : ""}`
  );
  if (reason === "ENTREGUE") await notifyClient(task, "entregue");
  await notifyCreator(task.createdBy.phone, ctx.msg.phone,
    `✅ Pedido *#${task.code}* foi *finalizado* por *${me.name ?? me.phone}* — ${finishReasonLabel(reason)}.`);
}

/** Ação por texto: "pegar 5", "soltar 5", "finalizar 5 [motivo/obs]". */
export async function actOnTaskByCode(
  ctx: Ctx,
  action: string,
  codeStr?: string,
  rest?: string
): Promise<void> {
  if (!codeStr) {
    await ctx.reply(
      "🛵 Para agir num pedido:\n" +
        "• *cite* a mensagem do pedido com *pegar*/*soltar*/*finalizar*; ou\n" +
        "• envie *pegar 5* / *soltar 5* / *finalizar 5* (5 = código do pedido).\n\n" +
        "💡 *finalizar 5* já marca como *entregue*. Para outro resultado: " +
        "*finalizar 5 nao* · *finalizar 5 retorno* · *finalizar 5 <observação>*."
    );
    return;
  }
  const code = Number(codeStr);
  const task = await prisma.task.findFirst({
    where: { code, ...(ctx.session.adminId ? { adminId: ctx.session.adminId } : {}) },
    include: taskInclude,
  });
  if (!task) {
    await ctx.reply(`⚠️ Pedido *#${code}* não encontrado na sua operação.`);
    return;
  }
  if (normalize(action) === "finalizar") {
    const { reason, note } = parseFinishReason(rest ?? "");
    return finalizeTaskNow(ctx, task.id, reason, note);
  }
  return actOnTask(ctx, task, action);
}

const STATUS_CMD: Record<string, "DISPONIVEL" | "OCUPADO" | "OFFLINE"> = {
  disponivel: "DISPONIVEL",
  ocupado: "OCUPADO",
  offline: "OFFLINE",
};

/** Comandos rápidos do motoboy: status e ganhos. Retorna true se tratou. */
export async function handleMotoboyQuickCommand(ctx: Ctx, lower: string): Promise<boolean> {
  const isStatus = !!STATUS_CMD[lower];
  const isGanhos = lower === "ganhei" || lower === "ganhos";
  if (!isStatus && !isGanhos) return false; // não é comando — não consulta o banco

  const isMotoboy = ctx.session.role === "MOTOBOY" || (await hasRole(ctx.msg.phone, "MOTOBOY"));
  if (!isMotoboy) return false;

  const me = await upsertUser(ctx.msg.phone, ctx.msg.pushName);

  if (isStatus) {
    await prisma.user.update({ where: { id: me.id }, data: { status: STATUS_CMD[lower] } });
    const label = { DISPONIVEL: "🟢 Disponível", OCUPADO: "🟡 Ocupado", OFFLINE: "⚫ Offline" }[STATUS_CMD[lower]];
    await ctx.reply(`✅ Status atualizado: ${label}`);
    return true;
  }

  const r = await motoboyReport(me.id, "hoje");
  await ctx.reply(renderReport("💰 *MEUS GANHOS HOJE*", "hoje", r));
  return true;
}
