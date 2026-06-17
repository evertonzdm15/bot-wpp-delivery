import { goTo, registerFlow } from "../core/engine";
import { Ctx } from "../core/types";
import { prisma } from "../lib/prisma";
import { normalize, fmtDateTime, statusLabel } from "../utils/format";
import {
  finalizadas30d,
  globalReport,
  renderPlatformRevenue,
  renderReport,
  Period,
} from "../services/report.service";
import { taskInclude } from "../services/task.service";
import { resumoLinha } from "../services/dashboard.service";
import { addRole, upsertUser } from "../services/user.service";
import { canonicalBrazil, isValidPhone } from "../utils/phone";
import { showMainMenu } from "./menu";
import { NAV_FOOTER } from "./common";

const PERIODS: Record<string, Period> = { "1": "hoje", "2": "7d", "3": "30d", "4": "tudo" };

registerFlow("superadmin", {
  menu: {
    prompt: async (ctx) => {
      const resumo = await resumoLinha({});
      return ctx.reply(
        `⭐ *SUPER ADMIN*\n${resumo}\n\n` +
          "1️⃣ Admins (cadastro)\n" +
          "2️⃣ Filiais\n" +
          "3️⃣ Motoboys\n" +
          "4️⃣ Pedidos (todos)\n" +
          "5️⃣ Histórico / Exportar\n" +
          "6️⃣ Relatório global\n" +
          "7️⃣ Motoboys em rota\n" +
          "8️⃣ Avisos (broadcast)\n\n" +
          `Digite o número da opção.\n${NAV_FOOTER}`
      );
    },
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          return goTo(ctx, "saAdmins", "menu");
        case "2":
          return listFiliais(ctx);
        case "3":
          return listMotoboys(ctx);
        case "4":
          return goTo(ctx, "saPedidos", "menu");
        case "5":
          return goTo(ctx, "historico", "menu");
        case "6":
          return goTo(ctx, "saRelatorio", "periodo");
        case "7":
          return goTo(ctx, "monitor", "menu");
        case "8":
          return goTo(ctx, "broadcast", "texto");
        default:
          return ctx.reply("Opção inválida. Digite de *1* a *8*.");
      }
    },
  },
});

async function listFiliais(ctx: Ctx): Promise<void> {
  const branches = await prisma.branch.findMany({
    include: { admin: true },
    orderBy: { name: "asc" },
  });
  if (!branches.length) return void (await ctx.reply("Nenhuma filial cadastrada.\n\n" + NAV_FOOTER));
  const lines: string[] = [];
  for (const b of branches) {
    const media = await finalizadas30d({ branchId: b.id });
    lines.push(`• ${b.name} (${b.admin.name})${b.active ? "" : " (inativa)"} — 📊 ${media}/30d`);
  }
  await ctx.reply("🏪 *FILIAIS:*\n\n" + lines.join("\n") + "\n\n" + NAV_FOOTER);
}

async function listMotoboys(ctx: Ctx): Promise<void> {
  const motoboys = await prisma.user.findMany({
    where: { roles: { some: { role: "MOTOBOY" } } },
    orderBy: { createdAt: "asc" },
  });
  if (!motoboys.length) return void (await ctx.reply("Nenhum motoboy cadastrado.\n\n" + NAV_FOOTER));
  const lines: string[] = [];
  for (const m of motoboys) {
    const media = await finalizadas30d({ motoboyId: m.id });
    lines.push(`• ${m.name ?? m.phone} — 📊 ${media}/30d`);
  }
  await ctx.reply("🛵 *MOTOBOYS:*\n\n" + lines.join("\n") + "\n\n" + NAV_FOOTER);
}

// ---------------------------------------------------------------------------
// Admins (cadastro)
// ---------------------------------------------------------------------------
async function listAdminSel(ctx: Ctx, title: string): Promise<void> {
  const admins = await prisma.admin.findMany({ orderBy: { name: "asc" } });
  ctx.session.data.adminSel = admins.map((a) => ({
    id: a.id,
    name: a.name,
    active: a.active,
    accessCode: a.accessCode,
  }));
  const lines = admins.map((a, i) => `${i + 1} - ${a.name}${a.active ? "" : " (inativo)"}`);
  await ctx.reply(`${title}\n\n` + (lines.join("\n") || "(nenhum)"));
}
const pickAdmin = (ctx: Ctx, text: string) =>
  (ctx.session.data.adminSel ?? [])[Number(text.trim()) - 1];

registerFlow("saAdmins", {
  menu: {
    prompt: async (ctx) => {
      const admins = await prisma.admin.findMany({ orderBy: { name: "asc" } });
      const lines = admins.map(
        (a) => `• ${a.name} — código: *${a.accessCode}*${a.active ? "" : " (inativo)"}`
      );
      return ctx.reply(
        "👑 *ADMINS:*\n\n" +
          (lines.join("\n") || "(nenhum)") +
          "\n\n1️⃣ Criar admin\n2️⃣ Alterar código\n3️⃣ Ativar/Desativar\n4️⃣ Vincular número\n5️⃣ Remover\n6️⃣ Taxa da plataforma (%)\n\n" +
          NAV_FOOTER
      );
    },
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          ctx.session.data.newAdmin = {};
          return goTo(ctx, "saAdmins", "novoNome");
        case "2":
          return goTo(ctx, "saAdmins", "selCodigo");
        case "3":
          return goTo(ctx, "saAdmins", "selToggle");
        case "4":
          return goTo(ctx, "saAdmins", "selVincular");
        case "5":
          return goTo(ctx, "saAdmins", "selRemover");
        case "6":
          return goTo(ctx, "saAdmins", "selFee");
        default:
          return ctx.reply("Digite de *1* a *6*.");
      }
    },
  },

  selFee: {
    prompt: (ctx) => listAdminSel(ctx, "Definir taxa da plataforma de qual admin?"),
    handle: async (ctx, text) => {
      const a = pickAdmin(ctx, text);
      if (!a) return ctx.reply("Opção inválida.");
      ctx.session.data.feeAdminId = a.id;
      return goTo(ctx, "saAdmins", "setFee");
    },
  },

  setFee: {
    prompt: (ctx) => ctx.reply("💼 Taxa da plataforma em *%* (ex: 10):"),
    handle: async (ctx, text) => {
      const pct = Number(text.replace(/\D/g, ""));
      if (Number.isNaN(pct) || pct < 0 || pct > 100) return ctx.reply("Digite um número de 0 a 100.");
      const a = await prisma.admin.update({
        where: { id: ctx.session.data.feeAdminId },
        data: { platformFeePercent: pct },
      });
      await ctx.reply(`✅ Taxa de *${a.name}* definida em *${pct}%*.`);
      return showMainMenu(ctx);
    },
  },

  novoNome: {
    prompt: (ctx) => ctx.reply("👑 Nome da operação (Admin):"),
    handle: async (ctx, text) => {
      if (!text.trim()) return ctx.reply("Digite um nome válido.");
      ctx.session.data.newAdmin.name = text.trim();
      return goTo(ctx, "saAdmins", "novoCodigo");
    },
  },

  novoCodigo: {
    prompt: (ctx) => ctx.reply("🔐 Código de acesso do Admin (ex: 2000):"),
    handle: async (ctx, text) => {
      const code = text.trim();
      if (!code) return ctx.reply("Digite um código válido.");
      if (await adminCodeInUse(code)) return ctx.reply("⚠️ Código já em uso. Escolha outro.");
      const a = await prisma.admin.create({
        data: { name: ctx.session.data.newAdmin.name, accessCode: code },
      });
      await ctx.reply(`✅ Admin *${a.name}* criado com código *${a.accessCode}*.`);
      return showMainMenu(ctx);
    },
  },

  selCodigo: {
    prompt: (ctx) => listAdminSel(ctx, "Selecione o admin p/ alterar o código:"),
    handle: async (ctx, text) => {
      const a = pickAdmin(ctx, text);
      if (!a) return ctx.reply("Opção inválida.");
      ctx.session.data.targetAdminId = a.id;
      return goTo(ctx, "saAdmins", "novoCodigoEdit");
    },
  },

  novoCodigoEdit: {
    prompt: (ctx) => ctx.reply("🔐 Novo código de acesso do Admin:"),
    handle: async (ctx, text) => {
      const code = text.trim();
      if (!code) return ctx.reply("Digite um código válido.");
      if (await adminCodeInUse(code, ctx.session.data.targetAdminId))
        return ctx.reply("⚠️ Código já em uso. Escolha outro.");
      const a = await prisma.admin.update({
        where: { id: ctx.session.data.targetAdminId },
        data: { accessCode: code },
      });
      await ctx.reply(`✅ Código de *${a.name}* atualizado para *${a.accessCode}*.`);
      return showMainMenu(ctx);
    },
  },

  selToggle: {
    prompt: (ctx) => listAdminSel(ctx, "Selecione o admin p/ ativar/desativar:"),
    handle: async (ctx, text) => {
      const a = pickAdmin(ctx, text);
      if (!a) return ctx.reply("Opção inválida.");
      const up = await prisma.admin.update({ where: { id: a.id }, data: { active: !a.active } });
      await ctx.reply(`✅ *${up.name}* agora está ${up.active ? "ativo" : "inativo"}.`);
      return showMainMenu(ctx);
    },
  },

  selVincular: {
    prompt: (ctx) => listAdminSel(ctx, "Vincular número a qual admin?"),
    handle: async (ctx, text) => {
      const a = pickAdmin(ctx, text);
      if (!a) return ctx.reply("Opção inválida.");
      ctx.session.data.vincAdminId = a.id;
      return goTo(ctx, "saAdmins", "vincularTelefone");
    },
  },

  vincularTelefone: {
    prompt: (ctx) => ctx.reply("📱 Número que terá o painel Admin (com DDD):"),
    handle: async (ctx, text) => {
      if (!isValidPhone(text)) return ctx.reply("⚠️ Número inválido.");
      const phone = canonicalBrazil(text);
      await upsertUser(phone);
      const added = await addRole(phone, "ADMIN", { adminId: ctx.session.data.vincAdminId });
      await ctx.reply(
        added ? `✅ Painel Admin vinculado a *${phone}*.` : `ℹ️ *${phone}* já tinha esse acesso.`
      );
      return showMainMenu(ctx);
    },
  },

  selRemover: {
    prompt: (ctx) => listAdminSel(ctx, "Selecione o admin a REMOVER (apaga filiais/dados):"),
    handle: async (ctx, text) => {
      const a = pickAdmin(ctx, text);
      if (!a) return ctx.reply("Opção inválida.");
      await prisma.admin.delete({ where: { id: a.id } });
      await ctx.reply(`🔴 Admin *${a.name}* removido.`);
      return showMainMenu(ctx);
    },
  },
});

async function adminCodeInUse(code: string, exceptId?: string): Promise<boolean> {
  const a = await prisma.admin.findUnique({ where: { accessCode: code } });
  const b = await prisma.branch.findUnique({ where: { accessCode: code } });
  if (b) return true;
  if (a && a.id !== exceptId) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Pedidos (todos) + Relatório global
// ---------------------------------------------------------------------------
async function listAllTasks(ctx: Ctx, statuses: any[], title: string): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { status: { in: statuses } },
    orderBy: { dueAt: "asc" },
    include: taskInclude,
    take: 30,
  });
  if (!tasks.length) return void (await ctx.reply(`📭 ${title}: nenhum pedido.\n\n${NAV_FOOTER}`));
  const lines = tasks.map(
    (t) =>
      `📦 *#${t.code}* ${t.typeName} — ${statusLabel(t.status)} — 🏪 ${t.branch.name}` +
      `${t.motoboy ? ` 🛵 ${t.motoboy.name ?? t.motoboy.phone}` : ""}` +
      `${t.dueAt ? ` ⏰ ${fmtDateTime(t.dueAt)}` : ""}`
  );
  await ctx.reply(`📋 *${title} (${tasks.length}):*\n\n` + lines.join("\n") + "\n\n" + NAV_FOOTER);
}

registerFlow("saPedidos", {
  menu: {
    prompt: (ctx) =>
      ctx.reply(
        "📦 *PEDIDOS (TODOS)*\n\n1️⃣ Em aberto\n2️⃣ Em andamento\n3️⃣ Finalizados\n" +
          "4️⃣ Gerenciar pedido\n5️⃣ Buscar\n\n" +
          NAV_FOOTER
      ),
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          return listAllTasks(ctx, ["PENDENTE"], "Em aberto");
        case "2":
          return listAllTasks(ctx, ["ATRIBUIDA"], "Em andamento");
        case "3":
          return listAllTasks(ctx, ["FINALIZADA"], "Finalizados");
        case "4":
          return goTo(ctx, "gerenciarPedido", "codigo");
        case "5":
          return goTo(ctx, "busca", "termo");
        default:
          return ctx.reply("Digite de *1* a *5*.");
      }
    },
  },
});

registerFlow("saRelatorio", {
  periodo: {
    prompt: (ctx) =>
      ctx.reply(
        "📊 *RELATÓRIO GLOBAL* — período:\n\n1️⃣ Hoje\n2️⃣ 7 dias\n3️⃣ 30 dias\n4️⃣ Tudo\n\n" + NAV_FOOTER
      ),
    handle: async (ctx, text) => {
      const period = PERIODS[normalize(text)];
      if (!period) return ctx.reply("Digite de *1* a *4*.");
      const r = await globalReport(period);
      await ctx.reply(renderReport("📊 *RELATÓRIO GLOBAL*", period, r));
      await ctx.reply((await renderPlatformRevenue(period)) + "\n\n" + NAV_FOOTER);
      return showMainMenu(ctx);
    },
  },
});
