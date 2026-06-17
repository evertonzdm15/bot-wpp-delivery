import { Prisma } from "@prisma/client";
import { goTo, registerFlow } from "../core/engine";
import { Ctx } from "../core/types";
import { prisma } from "../lib/prisma";
import { motoboysEmRota, tarefasAtribuidas } from "../services/monitor.service";
import { sendTaskMessage, taskInclude } from "../services/task.service";
import { sendDocument, sendText } from "../services/evolution.service";
import { exportTasksXlsx, XLSX_MIMETYPE } from "../services/export.service";
import { dayjs, fmtDateTime, formatTaskMessage, normalize } from "../utils/format";
import { env } from "../config/env";
import { NAV_FOOTER } from "./common";

/** Escopo de tarefas conforme o perfil ativo */
function scope(ctx: Ctx): Prisma.TaskWhereInput {
  switch (ctx.session.role) {
    case "FILIAL":
      return { branchId: ctx.session.branchId };
    case "ADMIN":
      return { adminId: ctx.session.adminId };
    default:
      return {}; // SUPER_ADMIN
  }
}

registerFlow("monitor", {
  menu: {
    prompt: async (ctx) => {
      const overdue = !!ctx.session.data.monitorOverdue;
      const buckets = await motoboysEmRota(scope(ctx), overdue);
      ctx.session.data.monitorList = buckets.map((b) => ({ id: b.motoboyId, name: b.name }));
      const header = `🛰️ *MOTOBOYS EM ROTA*${overdue ? " — ⏰ só vencidos" : ""}`;
      if (!buckets.length) {
        return ctx.reply(
          `${header}\n\n📭 Nenhum motoboy com pedidos atribuídos${overdue ? " vencidos" : ""}.\n\n` +
            "🔁 *V* alterna só vencidos · " +
            NAV_FOOTER
        );
      }
      const blocks = buckets.map((b, i) => {
        const orders = b.tasks
          .map((t) => `#${t.code} ${t.typeName}${t.dueAt ? ` ⏰${fmtDateTime(t.dueAt)}` : ""}`)
          .join(", ");
        return `${i + 1}️⃣ 🛵 *${b.name}* — ${b.tasks.length} pedido(s)\n     ${orders}`;
      });
      return ctx.reply(
        `${header}\n\n` +
          blocks.join("\n\n") +
          "\n\n👉 Digite o *número* do motoboy para *cobrar finalização*.\n" +
          "🔁 *V* só vencidos · 📊 *E* exportar XLSX · " +
          NAV_FOOTER
      );
    },
    handle: async (ctx, text) => {
      const t = normalize(text);
      if (t === "v") {
        ctx.session.data.monitorOverdue = !ctx.session.data.monitorOverdue;
        return goTo(ctx, "monitor", "menu", false);
      }
      if (t === "e") return exportRota(ctx);
      const sel = (ctx.session.data.monitorList ?? [])[Number(t) - 1];
      if (!sel) return ctx.reply("Opção inválida. Digite o número de um motoboy, *V* ou *E*.");
      return cobrar(ctx, sel.id, sel.name);
    },
  },
});

async function cobrar(ctx: Ctx, motoboyId: string, name: string): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { ...scope(ctx), status: "ATRIBUIDA", motoboyId },
    orderBy: { dueAt: "asc" },
    include: taskInclude,
  });
  if (!tasks.length) {
    return void (await ctx.reply(`⚠️ *${name}* não tem mais pedidos atribuídos.`));
  }
  const phone = tasks[0].motoboy?.phone;
  if (phone) {
    await sendText(
      phone,
      `⏰ *Cobrança de finalização*\nVocê tem *${tasks.length}* pedido(s) em aberto. ` +
        "Por favor finalize abaixo (cite a mensagem ou envie *finalizar <código>*):"
    );
    for (const t of tasks) await sendTaskMessage(phone, t, formatTaskMessage(t));
  }
  await ctx.reply(`📨 Cobrança enviada a 🛵 *${name}* (${tasks.length} pedido(s)).\n\n${NAV_FOOTER}`);
}

async function exportRota(ctx: Ctx): Promise<void> {
  const overdue = !!ctx.session.data.monitorOverdue;
  const tasks = await tarefasAtribuidas(scope(ctx), overdue);
  if (!tasks.length) return void (await ctx.reply("📭 Nada para exportar."));
  await ctx.reply(`⏳ Gerando planilha com ${tasks.length} pedido(s) em rota...`);
  const buffer = await exportTasksXlsx(tasks);
  const stamp = dayjs().tz(env.TZ).format("YYYYMMDD_HHmm");
  await sendDocument(
    ctx.msg.phone,
    buffer,
    `motoboys_em_rota_${stamp}.xlsx`,
    XLSX_MIMETYPE,
    "📊 Motoboys em rota"
  );
  await ctx.reply("✅ Planilha enviada!");
}
