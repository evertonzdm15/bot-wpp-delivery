import { goTo, registerFlow } from "../core/engine";
import { Ctx } from "../core/types";
import { prisma } from "../lib/prisma";
import { upsertUser } from "../services/user.service";
import { sendTaskMessage, taskInclude } from "../services/task.service";
import { motoboyReport, renderReport, Period } from "../services/report.service";
import { fmtDateTime, formatTaskMessage, normalize } from "../utils/format";
import { NAV_FOOTER } from "./common";
import { showMainMenu } from "./menu";

const PERIODS: Record<string, Period> = { "1": "hoje", "2": "7d", "3": "30d", "4": "tudo" };

const STATUS_LABEL: Record<string, string> = {
  DISPONIVEL: "🟢 Disponível",
  OCUPADO: "🟡 Ocupado",
  OFFLINE: "⚫ Offline",
};

registerFlow("motoboy", {
  menu: {
    prompt: async (ctx) => {
      const me = await upsertUser(ctx.msg.phone, ctx.msg.pushName);
      return ctx.reply(
        `🛵 *MOTOBOY* — ${STATUS_LABEL[me.status]}\n\n` +
          "1️⃣ Pedidos disponíveis\n" +
          "2️⃣ Em andamento\n" +
          "3️⃣ Minhas entregas (finalizadas)\n" +
          "4️⃣ Relatório\n" +
          "5️⃣ Histórico / Exportar XLSX\n" +
          "6️⃣ Status (disponível/ocupado/offline)\n\n" +
          "ℹ️ Agir num pedido: *pegar 5* · *finalizar 5* (= entregue)\n" +
          "   outros: *finalizar 5 retorno* · *finalizar 5 nao* · ou cite a mensagem\n" +
          "⚡ Atalhos: *ocupado* · *disponivel* · *ganhei*\n" +
          `${NAV_FOOTER}`
      );
    },
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          return sendPedidos(ctx);
        case "2":
          return sendEmAndamento(ctx);
        case "3":
          return sendFinalizadas(ctx);
        case "4":
          return goTo(ctx, "motoboyRel", "periodo");
        case "5":
          return goTo(ctx, "historico", "menu");
        case "6":
          return goTo(ctx, "motoboyStatus", "set");
        default:
          return ctx.reply("Opção inválida. Digite de *1* a *6*.");
      }
    },
  },
});

registerFlow("motoboyStatus", {
  set: {
    prompt: (ctx) =>
      ctx.reply(
        "🔧 Defina seu status:\n\n1️⃣ 🟢 Disponível\n2️⃣ 🟡 Ocupado\n3️⃣ ⚫ Offline\n\n" +
          "_(Disponível = recebe atribuição automática)_"
      ),
    handle: async (ctx, text) => {
      const map: Record<string, "DISPONIVEL" | "OCUPADO" | "OFFLINE"> = {
        "1": "DISPONIVEL",
        "2": "OCUPADO",
        "3": "OFFLINE",
      };
      const status = map[normalize(text)];
      if (!status) return ctx.reply("Digite *1*, *2* ou *3*.");
      const me = await upsertUser(ctx.msg.phone, ctx.msg.pushName);
      await prisma.user.update({ where: { id: me.id }, data: { status } });
      await ctx.reply(`✅ Status atualizado: ${STATUS_LABEL[status]}`);
      return showMainMenu(ctx);
    },
  },
});

/** 1 / /pedidos — pedidos PENDENTES do tenant, 1 msg por pedido, menor prazo primeiro */
export async function sendPedidos(ctx: Ctx): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { status: "PENDENTE", ...(ctx.session.adminId ? { adminId: ctx.session.adminId } : {}) },
    orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
    include: taskInclude,
    take: 30,
  });
  if (!tasks.length) {
    await ctx.reply("📭 Nenhum pedido disponível na fila no momento.\n\n" + NAV_FOOTER);
    return;
  }
  await ctx.reply(`📦 *${tasks.length} pedido(s) na fila.* Responda *pegar* na mensagem do pedido.`);
  for (const t of tasks) await sendTaskMessage(ctx.msg.phone, t, formatTaskMessage(t));
}

/** 2 / /entregas — pedidos ATRIBUÍDOS ao motoboy (em andamento) */
export async function sendEmAndamento(ctx: Ctx): Promise<void> {
  const me = await upsertUser(ctx.msg.phone, ctx.msg.pushName);
  const tasks = await prisma.task.findMany({
    where: { status: "ATRIBUIDA", motoboyId: me.id },
    orderBy: { dueAt: "asc" },
    include: taskInclude,
    take: 30,
  });
  if (!tasks.length) {
    await ctx.reply("📭 Você não tem entregas em andamento.\n\n" + NAV_FOOTER);
    return;
  }
  await ctx.reply(
    `🛵 *${tasks.length} entrega(s) em andamento.* Responda na mensagem do pedido para *finalizar*.`
  );
  for (const t of tasks) await sendTaskMessage(ctx.msg.phone, t, formatTaskMessage(t));
}

/** 3 — entregas FINALIZADAS pelo motoboy (lista resumida) */
export async function sendFinalizadas(ctx: Ctx): Promise<void> {
  const me = await upsertUser(ctx.msg.phone, ctx.msg.pushName);
  const tasks = await prisma.task.findMany({
    where: { status: "FINALIZADA", motoboyId: me.id },
    orderBy: { finishedAt: "desc" },
    include: taskInclude,
    take: 30,
  });
  if (!tasks.length) {
    await ctx.reply("📭 Você ainda não tem entregas finalizadas.\n\n" + NAV_FOOTER);
    return;
  }
  const lines = tasks.map(
    (t) =>
      `✅ *#${t.code}* ${t.typeName} — ${t.branch.name}` +
      `${t.finishedAt ? ` · 🏁 ${fmtDateTime(t.finishedAt)}` : ""}` +
      `${t.trItems.length ? ` · 🔁 ${t.trItems.length} TR` : ""}`
  );
  await ctx.reply(
    `🏁 *Entregas finalizadas (${tasks.length}):*\n\n` + lines.join("\n") + "\n\n" + NAV_FOOTER
  );
}

registerFlow("motoboyRel", {
  periodo: {
    prompt: (ctx) =>
      ctx.reply(
        "📊 *MEU RELATÓRIO* — período:\n\n1️⃣ Hoje\n2️⃣ 7 dias\n3️⃣ 30 dias\n4️⃣ Tudo\n\n" + NAV_FOOTER
      ),
    handle: async (ctx, text) => {
      const period = PERIODS[normalize(text)];
      if (!period) return ctx.reply("Digite de *1* a *4*.");
      const me = await upsertUser(ctx.msg.phone, ctx.msg.pushName);
      const r = await motoboyReport(me.id, period);
      await ctx.reply(renderReport("📊 *MEU RELATÓRIO*", period, r) + "\n\n" + NAV_FOOTER);
      return showMainMenu(ctx);
    },
  },
});
