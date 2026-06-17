import { goTo, registerFlow } from "../core/engine";
import { Ctx } from "../core/types";
import { prisma } from "../lib/prisma";
import { addRole, setAccessCode, upsertUser } from "../services/user.service";
import { adminReport, renderReport, Period } from "../services/report.service";
import { resumoLinha } from "../services/dashboard.service";
import { taskInclude } from "../services/task.service";
import { fmtDateTime, formatMoney, normalize, parseMoneyToCents, statusLabel } from "../utils/format";
import { canonicalBrazil, isValidPhone } from "../utils/phone";
import { showMainMenu } from "./menu";
import { NAV_FOOTER } from "./common";

const PERIODS: Record<string, Period> = { "1": "hoje", "2": "7d", "3": "30d", "4": "tudo" };

function adminId(ctx: Ctx): string {
  return ctx.session.adminId!;
}

registerFlow("admin", {
  menu: {
    prompt: async (ctx) => {
      const admin = await prisma.admin.findUnique({ where: { id: adminId(ctx) } });
      const resumo = await resumoLinha({ adminId: adminId(ctx) });
      return ctx.reply(
        `👑 *ADMIN — ${admin?.name ?? "Operação"}*\n${resumo}\n\n` +
          "1️⃣ Filiais\n" +
          "2️⃣ Motoboys\n" +
          "3️⃣ Pedidos / Entregas\n" +
          "4️⃣ Relatório financeiro\n" +
          "5️⃣ Histórico / Exportar\n" +
          "6️⃣ Motoboys em rota\n" +
          "7️⃣ Avisos (broadcast)\n" +
          "8️⃣ Fechamento (pagamentos)\n\n" +
          `Digite o número da opção.\n${NAV_FOOTER}`
      );
    },
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          return goTo(ctx, "adminFilial", "menu");
        case "2":
          return goTo(ctx, "adminMotoboy", "menu");
        case "3":
          return goTo(ctx, "adminPedidos", "menu");
        case "4":
          return goTo(ctx, "adminRelatorio", "periodo");
        case "5":
          return goTo(ctx, "historico", "menu");
        case "6":
          return goTo(ctx, "monitor", "menu");
        case "7":
          return goTo(ctx, "broadcast", "texto");
        case "8":
          return goTo(ctx, "fechamento", "menu");
        default:
          return ctx.reply("Opção inválida. Digite de *1* a *8*.");
      }
    },
  },
});

// ---------------------------------------------------------------------------
// Filiais + Tipos de entrega
// ---------------------------------------------------------------------------
async function listBranchSel(ctx: Ctx, title: string): Promise<void> {
  const branches = await prisma.branch.findMany({
    where: { adminId: adminId(ctx) },
    orderBy: { name: "asc" },
  });
  ctx.session.data.branchSel = branches.map((b) => ({ id: b.id, name: b.name, active: b.active }));
  const lines = branches.map((b, i) => `${i + 1} - ${b.name}${b.active ? "" : " (inativa)"}`);
  await ctx.reply(`${title}\n\n` + (lines.join("\n") || "(nenhuma)"));
}
const pickBranch = (ctx: Ctx, text: string) =>
  (ctx.session.data.branchSel ?? [])[Number(text.trim()) - 1];

registerFlow("adminFilial", {
  menu: {
    prompt: async (ctx) => {
      const branches = await prisma.branch.findMany({
        where: { adminId: adminId(ctx) },
        orderBy: { name: "asc" },
      });
      const lines = branches.map(
        (b) => `• ${b.name} — código: *${b.accessCode}*${b.active ? "" : " (inativa)"}`
      );
      return ctx.reply(
        "🏪 *FILIAIS:*\n\n" +
          (lines.join("\n") || "(nenhuma)") +
          "\n\n1️⃣ Nova filial\n2️⃣ Alterar código\n3️⃣ Ativar/Desativar\n4️⃣ Tipos de entrega + prazos\n5️⃣ Grupo de auditoria\n\n" +
          NAV_FOOTER
      );
    },
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          ctx.session.data.newBranch = {};
          return goTo(ctx, "adminFilial", "novoNome");
        case "2":
          return goTo(ctx, "adminFilial", "selCodigo");
        case "3":
          return goTo(ctx, "adminFilial", "selToggle");
        case "4":
          return goTo(ctx, "adminTipos", "selBranch");
        case "5":
          return goTo(ctx, "adminFilial", "selGrupoBranch");
        default:
          return ctx.reply("Digite de *1* a *5*.");
      }
    },
  },

  selGrupoBranch: {
    prompt: (ctx) => listBranchSel(ctx, "🏪 Grupo de auditoria — escolha a filial:"),
    handle: async (ctx, text) => {
      const b = pickBranch(ctx, text);
      if (!b) return ctx.reply("Opção inválida.");
      ctx.session.data.auditBranchId = b.id;
      return goTo(ctx, "adminFilial", "selGrupo");
    },
  },

  selGrupo: {
    prompt: async (ctx) => {
      const groups = await prisma.waGroup.findMany({ orderBy: { name: "asc" } });
      if (!groups.length) {
        await ctx.reply(
          "⚠️ Nenhum grupo capturado ainda.\n" +
            "Adicione o *número do bot* a um grupo do WhatsApp — ele aparece aqui automaticamente.\n\n" +
            NAV_FOOTER
        );
        return showMainMenu(ctx);
      }
      ctx.session.data.groupSel = groups.map((g) => ({ jid: g.jid, name: g.name }));
      const lines = groups.map((g, i) => `${i + 1} - ${g.name}`);
      return ctx.reply(
        "📢 Para qual *grupo* encaminhar os pedidos desta filial?\n\n" +
          lines.join("\n") +
          "\n0 - ❌ Não encaminhar (remover)\n\nDigite o número:"
      );
    },
    handle: async (ctx, text) => {
      const t = text.trim();
      const branchId = ctx.session.data.auditBranchId;
      if (t === "0") {
        await prisma.branch.update({ where: { id: branchId }, data: { auditGroupJid: null } });
        await ctx.reply("✅ Encaminhamento de auditoria *removido* desta filial.");
        return showMainMenu(ctx);
      }
      const sel = (ctx.session.data.groupSel ?? [])[Number(t) - 1];
      if (!sel) return ctx.reply("Opção inválida. Digite o número de um grupo ou *0*.");
      await prisma.branch.update({ where: { id: branchId }, data: { auditGroupJid: sel.jid } });
      await ctx.reply(`✅ Pedidos desta filial serão encaminhados para *${sel.name}*.`);
      return showMainMenu(ctx);
    },
  },

  novoNome: {
    prompt: (ctx) => ctx.reply("🏪 Nome da nova filial:"),
    handle: async (ctx, text) => {
      if (!text.trim()) return ctx.reply("Digite um nome válido.");
      ctx.session.data.newBranch.name = text.trim();
      return goTo(ctx, "adminFilial", "novoCodigo");
    },
  },

  novoCodigo: {
    prompt: (ctx) => ctx.reply("🔐 Código de acesso desta filial (ex: 1010):"),
    handle: async (ctx, text) => {
      const code = text.trim();
      if (!code) return ctx.reply("Digite um código válido.");
      if (await codeInUse(code)) return ctx.reply("⚠️ Código já em uso. Escolha outro.");
      const b = await prisma.branch.create({
        data: { adminId: adminId(ctx), name: ctx.session.data.newBranch.name, accessCode: code },
      });
      await ctx.reply(`✅ Filial *${b.name}* criada com código *${b.accessCode}*.`);
      return showMainMenu(ctx);
    },
  },

  selCodigo: {
    prompt: (ctx) => listBranchSel(ctx, "Selecione a filial p/ alterar o código:"),
    handle: async (ctx, text) => {
      const b = pickBranch(ctx, text);
      if (!b) return ctx.reply("Opção inválida.");
      ctx.session.data.targetBranchId = b.id;
      return goTo(ctx, "adminFilial", "novoCodigoEdit");
    },
  },

  novoCodigoEdit: {
    prompt: (ctx) => ctx.reply("🔐 Novo código de acesso:"),
    handle: async (ctx, text) => {
      const code = text.trim();
      if (!code) return ctx.reply("Digite um código válido.");
      if (await codeInUse(code, ctx.session.data.targetBranchId))
        return ctx.reply("⚠️ Código já em uso. Escolha outro.");
      const b = await prisma.branch.update({
        where: { id: ctx.session.data.targetBranchId },
        data: { accessCode: code },
      });
      await ctx.reply(`✅ Código de *${b.name}* atualizado para *${b.accessCode}*.`);
      return showMainMenu(ctx);
    },
  },

  selToggle: {
    prompt: (ctx) => listBranchSel(ctx, "Selecione a filial p/ ativar/desativar:"),
    handle: async (ctx, text) => {
      const b = pickBranch(ctx, text);
      if (!b) return ctx.reply("Opção inválida.");
      const updated = await prisma.branch.update({
        where: { id: b.id },
        data: { active: !b.active },
      });
      await ctx.reply(`✅ *${updated.name}* agora está ${updated.active ? "ativa" : "inativa"}.`);
      return showMainMenu(ctx);
    },
  },
});

async function codeInUse(code: string, exceptBranchId?: string): Promise<boolean> {
  const b = await prisma.branch.findUnique({ where: { accessCode: code } });
  const a = await prisma.admin.findUnique({ where: { accessCode: code } });
  if (a) return true;
  if (b && b.id !== exceptBranchId) return true;
  return false;
}

// ---- Tipos de entrega ----
registerFlow("adminTipos", {
  selBranch: {
    prompt: (ctx) => listBranchSel(ctx, "🏪 Tipos de entrega — escolha a filial:"),
    handle: async (ctx, text) => {
      const b = pickBranch(ctx, text);
      if (!b) return ctx.reply("Opção inválida.");
      ctx.session.data.typesBranchId = b.id;
      return goTo(ctx, "adminTipos", "menu");
    },
  },

  menu: {
    prompt: async (ctx) => {
      const types = await prisma.deliveryType.findMany({
        where: { branchId: ctx.session.data.typesBranchId },
        orderBy: { createdAt: "asc" },
      });
      const lines = types.map(
        (t) =>
          `• ${t.name} — ${t.scheduled ? "🗓️ horário" : t.slaMin ? `⏱️ ${t.slaMin}min` : "sem prazo"}` +
          `${t.active ? "" : " (inativo)"}`
      );
      return ctx.reply(
        "🚚 *TIPOS DE ENTREGA:*\n\n" +
          (lines.join("\n") || "(nenhum)") +
          "\n\n1️⃣ Novo tipo\n2️⃣ Ativar/Desativar\n\n" +
          NAV_FOOTER
      );
    },
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          ctx.session.data.newType = {};
          return goTo(ctx, "adminTipos", "novoNome");
        case "2":
          return goTo(ctx, "adminTipos", "selToggle");
        default:
          return ctx.reply("Digite *1* ou *2*.");
      }
    },
  },

  novoNome: {
    prompt: (ctx) => ctx.reply("🚚 Nome do tipo (ex: Rápida R6, Programada):"),
    handle: async (ctx, text) => {
      if (!text.trim()) return ctx.reply("Digite um nome válido.");
      ctx.session.data.newType.name = text.trim();
      return goTo(ctx, "adminTipos", "prazo");
    },
  },

  prazo: {
    prompt: (ctx) =>
      ctx.reply(
        "⏱️ Prazo em *minutos* (ex: 40) ou digite *programada* para usar horário escolhido na criação:"
      ),
    handle: async (ctx, text) => {
      const t = normalize(text);
      const branchId = ctx.session.data.typesBranchId;
      let scheduled = false;
      let slaMin: number | null = null;
      if (t === "programada") scheduled = true;
      else {
        const n = Number(t.replace(/\D/g, ""));
        if (!n) return ctx.reply("Digite os minutos (ex: 40) ou *programada*.");
        slaMin = n;
      }
      const ty = await prisma.deliveryType.create({
        data: { branchId, adminId: adminId(ctx), name: ctx.session.data.newType.name, slaMin, scheduled },
      });
      await ctx.reply(
        `✅ Tipo *${ty.name}* criado (${scheduled ? "🗓️ horário" : `⏱️ ${slaMin}min`}).`
      );
      return showMainMenu(ctx);
    },
  },

  selToggle: {
    prompt: async (ctx) => {
      const types = await prisma.deliveryType.findMany({
        where: { branchId: ctx.session.data.typesBranchId },
        orderBy: { createdAt: "asc" },
      });
      ctx.session.data.typeSel = types.map((t) => ({ id: t.id, name: t.name, active: t.active }));
      const lines = types.map((t, i) => `${i + 1} - ${t.name}${t.active ? "" : " (inativo)"}`);
      return ctx.reply("Selecione o tipo p/ ativar/desativar:\n\n" + (lines.join("\n") || "(nenhum)"));
    },
    handle: async (ctx, text) => {
      const sel = (ctx.session.data.typeSel ?? [])[Number(text.trim()) - 1];
      if (!sel) return ctx.reply("Opção inválida.");
      const t = await prisma.deliveryType.update({
        where: { id: sel.id },
        data: { active: !sel.active },
      });
      await ctx.reply(`✅ Tipo *${t.name}* agora está ${t.active ? "ativo" : "inativo"}.`);
      return showMainMenu(ctx);
    },
  },
});

// ---------------------------------------------------------------------------
// Motoboys + Valores
// ---------------------------------------------------------------------------
async function listMotoboys(ctx: Ctx) {
  return prisma.user.findMany({
    where: { roles: { some: { role: "MOTOBOY", adminId: adminId(ctx) } } },
    orderBy: { createdAt: "asc" },
  });
}

registerFlow("adminMotoboy", {
  menu: {
    prompt: async (ctx) => {
      const ms = await listMotoboys(ctx);
      const lines = ms.map(
        (m) => `• ${m.name ?? m.phone} (${m.phone}) — padrão: ${formatMoney(m.defaultRateCents)}`
      );
      return ctx.reply(
        "🛵 *MOTOBOYS:*\n\n" +
          (lines.join("\n") || "(nenhum)") +
          "\n\n1️⃣ Novo motoboy\n2️⃣ Valores por tipo\n3️⃣ Atribuição automática (on/off)\n4️⃣ Remover\n\n" +
          NAV_FOOTER
      );
    },
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          ctx.session.data.newMb = {};
          return goTo(ctx, "adminMotoboy", "novoTelefone");
        case "2":
          return goTo(ctx, "adminMotoboy", "selValores");
        case "3":
          return goTo(ctx, "adminMotoboy", "selAuto");
        case "4":
          return goTo(ctx, "adminMotoboy", "selRemover");
        default:
          return ctx.reply("Digite *1*, *2*, *3* ou *4*.");
      }
    },
  },

  selAuto: {
    prompt: async (ctx) => {
      const roles = await prisma.userRole.findMany({
        where: { role: "MOTOBOY", adminId: adminId(ctx) },
        include: { user: true },
        orderBy: { id: "asc" },
      });
      ctx.session.data.autoSel = roles.map((r) => ({ roleId: r.id, name: r.user.name ?? r.user.phone, on: r.autoAssign }));
      const lines = roles.map(
        (r, i) => `${i + 1} - ${r.user.name ?? r.user.phone} — ${r.autoAssign ? "🤖 ON" : "⚪ off"}`
      );
      return ctx.reply(
        "🤖 *Atribuição automática* — digite o número para alternar:\n\n" +
          (lines.join("\n") || "(nenhum)")
      );
    },
    handle: async (ctx, text) => {
      const sel = (ctx.session.data.autoSel ?? [])[Number(text.trim()) - 1];
      if (!sel) return ctx.reply("Opção inválida.");
      const r = await prisma.userRole.update({
        where: { id: sel.roleId },
        data: { autoAssign: !sel.on },
      });
      await ctx.reply(
        `✅ *${sel.name}*: atribuição automática ${r.autoAssign ? "ATIVADA 🤖" : "desativada ⚪"}.`
      );
      return showMainMenu(ctx);
    },
  },

  novoTelefone: {
    prompt: (ctx) => ctx.reply("📱 Telefone do motoboy (com DDD):"),
    handle: async (ctx, text) => {
      if (!isValidPhone(text)) return ctx.reply("⚠️ Número inválido.");
      ctx.session.data.newMb.phone = canonicalBrazil(text);
      return goTo(ctx, "adminMotoboy", "novoNome");
    },
  },

  novoNome: {
    prompt: (ctx) => ctx.reply("👤 Nome do motoboy:"),
    handle: async (ctx, text) => {
      if (!text.trim()) return ctx.reply("Digite um nome válido.");
      ctx.session.data.newMb.name = text.trim();
      return goTo(ctx, "adminMotoboy", "novaSenha");
    },
  },

  novaSenha: {
    prompt: (ctx) => ctx.reply("🔐 Código de acesso (senha) do motoboy:"),
    handle: async (ctx, text) => {
      if (!text.trim()) return ctx.reply("Digite um código válido.");
      ctx.session.data.newMb.code = text.trim();
      return goTo(ctx, "adminMotoboy", "novoValor");
    },
  },

  novoValor: {
    prompt: (ctx) => ctx.reply("💰 Valor *padrão* por entrega (ex: 8,00):"),
    handle: async (ctx, text) => {
      const cents = parseMoneyToCents(text);
      if (cents == null) return ctx.reply("⚠️ Valor inválido. Ex: 8,00");
      const mb = ctx.session.data.newMb;
      const user = await upsertUser(mb.phone, mb.name);
      await prisma.user.update({
        where: { id: user.id },
        data: { name: mb.name, accessCode: mb.code, defaultRateCents: cents },
      });
      await addRole(mb.phone, "MOTOBOY", { adminId: adminId(ctx) });
      await ctx.reply(
        `✅ Motoboy *${mb.name}* cadastrado.\n📱 ${mb.phone} · 💰 padrão ${formatMoney(cents)}`
      );
      return showMainMenu(ctx);
    },
  },

  selValores: {
    prompt: async (ctx) => {
      const ms = await listMotoboys(ctx);
      ctx.session.data.mbSel = ms.map((m) => ({ id: m.id, name: m.name ?? m.phone }));
      const lines = ms.map((m, i) => `${i + 1} - ${m.name ?? m.phone}`);
      return ctx.reply("Selecione o motoboy:\n\n" + (lines.join("\n") || "(nenhum)"));
    },
    handle: async (ctx, text) => {
      const sel = (ctx.session.data.mbSel ?? [])[Number(text.trim()) - 1];
      if (!sel) return ctx.reply("Opção inválida.");
      ctx.session.data.rateMotoboyId = sel.id;
      return goTo(ctx, "adminMotoboy", "selTipoValor");
    },
  },

  selTipoValor: {
    prompt: async (ctx) => {
      const types = await prisma.deliveryType.findMany({
        where: { adminId: adminId(ctx), active: true },
        orderBy: { name: "asc" },
      });
      ctx.session.data.rateTypes = types.map((t) => ({ id: t.id, name: t.name }));
      const lines = types.map((t, i) => `${i + 1} - ${t.name}`);
      return ctx.reply(
        "Para qual tipo definir o valor?\n\n" +
          lines.join("\n") +
          `\n${types.length + 1} - 🔁 TR (transferência)\n\nDigite o número:`
      );
    },
    handle: async (ctx, text) => {
      const types = ctx.session.data.rateTypes ?? [];
      const idx = Number(text.trim()) - 1;
      if (idx === types.length) {
        ctx.session.data.rateTarget = { isTR: true };
      } else if (types[idx]) {
        ctx.session.data.rateTarget = { deliveryTypeId: types[idx].id, name: types[idx].name };
      } else {
        return ctx.reply("Opção inválida.");
      }
      return goTo(ctx, "adminMotoboy", "valorTipo");
    },
  },

  valorTipo: {
    prompt: (ctx) =>
      ctx.reply(
        `💰 Valor para *${ctx.session.data.rateTarget.isTR ? "TR" : ctx.session.data.rateTarget.name}* (ex: 3,00):`
      ),
    handle: async (ctx, text) => {
      const cents = parseMoneyToCents(text);
      if (cents == null) return ctx.reply("⚠️ Valor inválido. Ex: 3,00");
      const { rateMotoboyId, rateTarget } = ctx.session.data;
      const existing = await prisma.motoboyRate.findFirst({
        where: {
          motoboyId: rateMotoboyId,
          isTR: !!rateTarget.isTR,
          deliveryTypeId: rateTarget.deliveryTypeId ?? null,
        },
      });
      if (existing) {
        await prisma.motoboyRate.update({ where: { id: existing.id }, data: { valueCents: cents } });
      } else {
        await prisma.motoboyRate.create({
          data: {
            motoboyId: rateMotoboyId,
            isTR: !!rateTarget.isTR,
            deliveryTypeId: rateTarget.deliveryTypeId ?? null,
            valueCents: cents,
          },
        });
      }
      await ctx.reply(
        `✅ Valor de *${rateTarget.isTR ? "TR" : rateTarget.name}* definido em ${formatMoney(cents)}.`
      );
      return showMainMenu(ctx);
    },
  },

  selRemover: {
    prompt: async (ctx) => {
      const ms = await listMotoboys(ctx);
      ctx.session.data.mbSel = ms.map((m) => ({ id: m.id, name: m.name ?? m.phone }));
      const lines = ms.map((m, i) => `${i + 1} - ${m.name ?? m.phone}`);
      return ctx.reply("Selecione o motoboy a remover:\n\n" + (lines.join("\n") || "(nenhum)"));
    },
    handle: async (ctx, text) => {
      const sel = (ctx.session.data.mbSel ?? [])[Number(text.trim()) - 1];
      if (!sel) return ctx.reply("Opção inválida.");
      await prisma.userRole.deleteMany({
        where: { userId: sel.id, role: "MOTOBOY", adminId: adminId(ctx) },
      });
      await ctx.reply(`✅ Motoboy *${sel.name}* removido desta operação.`);
      return showMainMenu(ctx);
    },
  },
});

// ---------------------------------------------------------------------------
// Pedidos / Entregas (acompanhar)
// ---------------------------------------------------------------------------
async function listTasks(ctx: Ctx, statuses: any[], title: string): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { adminId: adminId(ctx), status: { in: statuses } },
    orderBy: { dueAt: "asc" },
    include: taskInclude,
    take: 30,
  });
  if (!tasks.length) {
    await ctx.reply(`📭 ${title}: nenhum pedido.\n\n${NAV_FOOTER}`);
    return;
  }
  const lines = tasks.map(
    (t) =>
      `📦 *#${t.code}* ${t.typeName} — ${statusLabel(t.status)} — 🏪 ${t.branch.name}` +
      `${t.motoboy ? ` 🛵 ${t.motoboy.name ?? t.motoboy.phone}` : ""}` +
      `${t.dueAt ? ` ⏰ ${fmtDateTime(t.dueAt)}` : ""}`
  );
  await ctx.reply(`📋 *${title} (${tasks.length}):*\n\n` + lines.join("\n") + "\n\n" + NAV_FOOTER);
}

registerFlow("adminPedidos", {
  menu: {
    prompt: (ctx) =>
      ctx.reply(
        "📦 *PEDIDOS / ENTREGAS*\n\n" +
          "1️⃣ Em aberto\n2️⃣ Em andamento\n3️⃣ Finalizados\n" +
          "4️⃣ Gerenciar pedido (reatribuir/cancelar/urgência)\n5️⃣ Buscar\n\n" +
          `Digite o número da opção.\n${NAV_FOOTER}`
      ),
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          return listTasks(ctx, ["PENDENTE"], "Em aberto");
        case "2":
          return listTasks(ctx, ["ATRIBUIDA"], "Em andamento");
        case "3":
          return listTasks(ctx, ["FINALIZADA"], "Finalizados");
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

// ---------------------------------------------------------------------------
// Relatório financeiro do tenant
// ---------------------------------------------------------------------------
registerFlow("adminRelatorio", {
  periodo: {
    prompt: (ctx) =>
      ctx.reply(
        "📊 *RELATÓRIO* — período:\n\n1️⃣ Hoje\n2️⃣ 7 dias\n3️⃣ 30 dias\n4️⃣ Tudo\n\n" + NAV_FOOTER
      ),
    handle: async (ctx, text) => {
      const period = PERIODS[normalize(text)];
      if (!period) return ctx.reply("Digite de *1* a *4*.");
      const r = await adminReport(adminId(ctx), period);
      await ctx.reply(renderReport("📊 *RELATÓRIO DA OPERAÇÃO*", period, r) + "\n\n" + NAV_FOOTER);
      return showMainMenu(ctx);
    },
  },
});
