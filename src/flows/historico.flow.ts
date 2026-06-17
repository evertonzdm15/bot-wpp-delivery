import { Prisma } from "@prisma/client";
import { goTo, registerFlow } from "../core/engine";
import { Ctx } from "../core/types";
import { prisma } from "../lib/prisma";
import { dayjs, fmtDateTime, normalize, statusLabel } from "../utils/format";
import { taskInclude } from "../services/task.service";
import { exportTasksXlsx, XLSX_MIMETYPE } from "../services/export.service";
import { sendDocument } from "../services/evolution.service";
import { periodRange, Period, PERIOD_LABEL } from "../services/report.service";
import { env } from "../config/env";
import { NAV_FOOTER } from "./common";
import { showMainMenu } from "./menu";

const PERIODS: Record<string, Period> = { "1": "hoje", "2": "7d", "3": "30d", "4": "tudo" };

/** Escopo por perfil ativo */
function scopeWhere(ctx: Ctx): Prisma.TaskWhereInput {
  switch (ctx.session.role) {
    case "FILIAL":
      return { branchId: ctx.session.branchId };
    case "ADMIN":
    case "MOTOBOY":
      return { adminId: ctx.session.adminId };
    default:
      return {}; // SUPER_ADMIN
  }
}

function periodWhere(period: Period): Prisma.TaskWhereInput {
  const gte = periodRange(period);
  return gte ? { createdAt: { gte } } : {};
}

registerFlow("historico", {
  menu: {
    prompt: (ctx) =>
      ctx.reply(
        "📚 *HISTÓRICO* — escolha o período:\n\n" +
          "1️⃣ Hoje\n2️⃣ Últimos 7 dias\n3️⃣ Últimos 30 dias\n4️⃣ Tudo\n\n" +
          NAV_FOOTER
      ),
    handle: async (ctx, text) => {
      const period = PERIODS[normalize(text)];
      if (!period) return ctx.reply("Opção inválida. Digite *1*, *2*, *3* ou *4*.");
      ctx.session.data.period = period;
      return goTo(ctx, "historico", "acao");
    },
  },

  acao: {
    prompt: async (ctx) => {
      const where = { ...scopeWhere(ctx), ...periodWhere(ctx.session.data.period) };
      const tasks = await prisma.task.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: taskInclude,
        take: 15,
      });
      const total = await prisma.task.count({ where });
      if (!tasks.length) {
        await ctx.reply("📭 Nenhum pedido no período selecionado.");
        return ctx.reply("1️⃣ Escolher outro período\n2️⃣ Voltar ao menu\n" + NAV_FOOTER);
      }
      const lines = tasks.map(
        (t) =>
          `📦 *#${t.code}* ${t.typeName} — ${statusLabel(t.status)}\n` +
          `   🏪 ${t.branch.name}${t.motoboy ? ` | 🛵 ${t.motoboy.name ?? t.motoboy.phone}` : ""}\n` +
          `   🕒 ${fmtDateTime(t.createdAt)}${t.finishedAt ? ` → 🏁 ${fmtDateTime(t.finishedAt)}` : ""}`
      );
      await ctx.reply(`📚 *Histórico* (${tasks.length} de ${total}):\n\n` + lines.join("\n\n"));
      return ctx.reply(
        "1️⃣ 📊 Exportar XLSX (todos do período)\n2️⃣ 🔄 Outro período\n3️⃣ ↩️ Menu\n" + NAV_FOOTER
      );
    },
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          return exportPeriod(ctx);
        case "2":
          return goTo(ctx, "historico", "menu");
        case "3":
          return showMainMenu(ctx);
        default:
          return ctx.reply("Digite *1*, *2* ou *3*.");
      }
    },
  },
});

async function exportPeriod(ctx: Ctx): Promise<void> {
  const where = { ...scopeWhere(ctx), ...periodWhere(ctx.session.data.period) };
  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: taskInclude,
  });
  if (!tasks.length) {
    await ctx.reply("📭 Nada para exportar nesse período.");
    return;
  }
  await ctx.reply(`⏳ Gerando planilha com ${tasks.length} pedido(s)...`);
  const buffer = await exportTasksXlsx(tasks);
  const stamp = dayjs().tz(env.TZ).format("YYYYMMDD_HHmm");
  const period = ctx.session.data.period as Period;
  const fileName = `historico_${period}_${stamp}.xlsx`;
  await sendDocument(
    ctx.msg.phone,
    buffer,
    fileName,
    XLSX_MIMETYPE,
    `📊 Histórico — ${PERIOD_LABEL[period]}`
  );
  await ctx.reply("✅ Planilha enviada!");
}
