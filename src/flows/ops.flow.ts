import { Prisma } from "@prisma/client";
import { goTo, registerFlow } from "../core/engine";
import { Ctx } from "../core/types";
import { prisma } from "../lib/prisma";
import { notifyClient, postToAuditGroup, sendTaskMessage, taskInclude } from "../services/task.service";
import { sendText } from "../services/evolution.service";
import { fmtDateTime, formatTaskMessage, normalize, statusLabel } from "../utils/format";
import { showMainMenu } from "./menu";
import { NAV_FOOTER } from "./common";

function scopeWhere(ctx: Ctx): Prisma.TaskWhereInput {
  switch (ctx.session.role) {
    case "FILIAL":
      return { branchId: ctx.session.branchId };
    case "ADMIN":
      return { adminId: ctx.session.adminId };
    default:
      return {};
  }
}
const canReassign = (ctx: Ctx) =>
  ctx.session.role === "ADMIN" || ctx.session.role === "SUPER_ADMIN";

async function findTask(ctx: Ctx, code: number) {
  return prisma.task.findFirst({ where: { code, ...scopeWhere(ctx) }, include: taskInclude });
}

registerFlow("gerenciarPedido", {
  codigo: {
    prompt: (ctx) => ctx.reply("🔧 Digite o *código do pedido* para gerenciar:"),
    handle: async (ctx, text) => {
      const code = Number(text.replace(/\D/g, ""));
      if (!code) return ctx.reply("Digite um código numérico.");
      const task = await findTask(ctx, code);
      if (!task) return ctx.reply(`⚠️ Pedido *#${code}* não encontrado no seu escopo.`);
      ctx.session.data.opTaskId = task.id;
      return goTo(ctx, "gerenciarPedido", "acao");
    },
  },

  acao: {
    prompt: async (ctx) => {
      const t = await prisma.task.findUnique({
        where: { id: ctx.session.data.opTaskId },
        include: taskInclude,
      });
      if (!t) return ctx.reply("Pedido não encontrado.");
      const head =
        `🔧 *PEDIDO #${t.code}* — ${t.typeName} ${t.priority ? "🔴 URGENTE" : ""}\n` +
        `${statusLabel(t.status)}${t.motoboy ? ` · 🛵 ${t.motoboy.name ?? t.motoboy.phone}` : ""}\n` +
        `🏪 ${t.branch.name}${t.clientName ? ` · 👤 ${t.clientName}` : ""}` +
        `${t.dueAt ? ` · ⏰ ${fmtDateTime(t.dueAt)}` : ""}`;
      const opts = [
        canReassign(ctx) ? "1️⃣ Reatribuir a outro motoboy" : "",
        "2️⃣ Cancelar pedido",
        `3️⃣ ${t.priority ? "Remover urgência" : "Marcar como URGENTE"}`,
      ].filter(Boolean);
      return ctx.reply(`${head}\n\n` + opts.join("\n") + `\n\n${NAV_FOOTER}`);
    },
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          if (!canReassign(ctx)) return ctx.reply("Opção indisponível para seu perfil.");
          return goTo(ctx, "gerenciarPedido", "reatribuir");
        case "2":
          return cancelar(ctx);
        case "3":
          return togglePriority(ctx);
        default:
          return ctx.reply("Opção inválida.");
      }
    },
  },

  reatribuir: {
    prompt: async (ctx) => {
      const t = await prisma.task.findUnique({ where: { id: ctx.session.data.opTaskId } });
      const motoboys = await prisma.user.findMany({
        where: { roles: { some: { role: "MOTOBOY", adminId: t!.adminId } } },
        orderBy: { createdAt: "asc" },
      });
      ctx.session.data.reassignList = motoboys.map((m) => ({ id: m.id, name: m.name ?? m.phone }));
      const lines = motoboys.map((m, i) => `${i + 1} - ${m.name ?? m.phone}`);
      return ctx.reply("🛵 Escolha o motoboy:\n\n" + (lines.join("\n") || "(nenhum)"));
    },
    handle: async (ctx, text) => {
      const sel = (ctx.session.data.reassignList ?? [])[Number(text.trim()) - 1];
      if (!sel) return ctx.reply("Opção inválida.");
      const t = await prisma.task.findUnique({
        where: { id: ctx.session.data.opTaskId },
        include: taskInclude,
      });
      if (!t || t.status === "FINALIZADA" || t.status === "CANCELADA") {
        await ctx.reply("⚠️ Pedido não pode ser reatribuído.");
        return showMainMenu(ctx);
      }
      const oldPhone = t.motoboy?.phone;
      await prisma.task.update({
        where: { id: t.id },
        data: { status: "ATRIBUIDA", motoboyId: sel.id, assignedAt: new Date() },
      });
      const updated = (await prisma.task.findUnique({ where: { id: t.id }, include: taskInclude }))!;
      await sendTaskMessage(updated.motoboy!.phone, updated, formatTaskMessage(updated));
      await postToAuditGroup(updated, "atribuido");
      if (oldPhone && oldPhone !== updated.motoboy!.phone) {
        await sendText(oldPhone, `🔄 O pedido *#${t.code}* foi *reatribuído* para outro motoboy.`);
      }
      await ctx.reply(`✅ Pedido *#${t.code}* reatribuído a 🛵 *${sel.name}*.`);
      return showMainMenu(ctx);
    },
  },
});

async function cancelar(ctx: Ctx): Promise<void> {
  const t = await prisma.task.findUnique({
    where: { id: ctx.session.data.opTaskId },
    include: taskInclude,
  });
  if (!t) return void (await ctx.reply("Pedido não encontrado."));
  if (t.status === "FINALIZADA" || t.status === "CANCELADA") {
    await ctx.reply(`⚠️ Pedido *#${t.code}* já está ${statusLabel(t.status)}.`);
    return showMainMenu(ctx);
  }
  await prisma.task.update({ where: { id: t.id }, data: { status: "CANCELADA" } });
  if (t.motoboy) await sendText(t.motoboy.phone, `🔴 O pedido *#${t.code}* foi *cancelado*.`);
  await ctx.reply(`🔴 Pedido *#${t.code}* cancelado.`);
  return showMainMenu(ctx);
}

async function togglePriority(ctx: Ctx): Promise<void> {
  const t = await prisma.task.findUnique({ where: { id: ctx.session.data.opTaskId } });
  if (!t) return void (await ctx.reply("Pedido não encontrado."));
  const up = await prisma.task.update({
    where: { id: t.id },
    data: { priority: !t.priority },
  });
  await ctx.reply(`✅ Pedido *#${t.code}* ${up.priority ? "marcado como 🔴 URGENTE" : "sem urgência"}.`);
  return showMainMenu(ctx);
}

// ---------------------------------------------------------------------------
// Busca por cliente / telefone / código
// ---------------------------------------------------------------------------
registerFlow("busca", {
  termo: {
    prompt: (ctx) => ctx.reply("🔎 Buscar pedido — digite *nome do cliente*, *telefone* ou *código*:"),
    handle: async (ctx, text) => {
      const term = text.trim();
      if (!term) return ctx.reply("Digite um termo de busca.");
      const code = Number(term.replace(/\D/g, ""));
      const where: Prisma.TaskWhereInput = {
        ...scopeWhere(ctx),
        OR: [
          { clientName: { contains: term, mode: "insensitive" } },
          { clientPhone: { contains: term.replace(/\D/g, "") } },
          ...(code ? [{ code }] : []),
        ],
      };
      const tasks = await prisma.task.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: taskInclude,
        take: 15,
      });
      if (!tasks.length) {
        await ctx.reply(`📭 Nada encontrado para "${term}".\n\n${NAV_FOOTER}`);
        return;
      }
      const lines = tasks.map(
        (t) =>
          `📦 *#${t.code}* ${t.typeName} — ${statusLabel(t.status)}\n` +
          `   🏪 ${t.branch.name}${t.clientName ? ` · 👤 ${t.clientName}` : ""}` +
          `${t.motoboy ? ` · 🛵 ${t.motoboy.name ?? t.motoboy.phone}` : ""}`
      );
      await ctx.reply(`🔎 *Resultados (${tasks.length}):*\n\n` + lines.join("\n\n") + `\n\n${NAV_FOOTER}`);
    },
  },
});
