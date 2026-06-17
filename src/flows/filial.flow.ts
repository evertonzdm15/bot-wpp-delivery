import { goTo, registerFlow } from "../core/engine";
import { Ctx } from "../core/types";
import { prisma } from "../lib/prisma";
import { createAndDispatch, taskInclude } from "../services/task.service";
import { fmtDateTime, normalize, parseDateTime, statusLabel } from "../utils/format";
import { resumoLinha } from "../services/dashboard.service";
import { showMainMenu } from "./menu";
import { NAV_FOOTER } from "./common";

async function getBranchName(branchId?: string): Promise<string> {
  if (!branchId) return "Filial";
  const b = await prisma.branch.findUnique({ where: { id: branchId } });
  return b?.name ?? "Filial";
}

registerFlow("filial", {
  menu: {
    prompt: async (ctx) => {
      const name = await getBranchName(ctx.session.branchId);
      const resumo = await resumoLinha({ branchId: ctx.session.branchId });
      return ctx.reply(
        `🏪 *${name}* — MENU FILIAL\n${resumo}\n\n` +
          "1️⃣ Nova tarefa\n" +
          "2️⃣ Tarefas em aberto\n" +
          "3️⃣ Histórico de pedidos\n" +
          "4️⃣ Dados do pedido\n" +
          "5️⃣ Histórico / Exportar XLSX\n" +
          "6️⃣ Motoboys em rota\n" +
          "7️⃣ Importar pedidos (XLSX)\n" +
          "8️⃣ Gerenciar pedido (cancelar/urgência)\n" +
          "9️⃣ Buscar pedido\n\n" +
          `Digite o número da opção.\n${NAV_FOOTER}`
      );
    },
    handle: async (ctx, text) => {
      const t = normalize(text);
      const mCancel = t.match(/^c(\d+)$/);
      if (mCancel) return cancelTask(ctx, Number(mCancel[1]));
      switch (t) {
        case "1":
          ctx.session.data.task = { items: [], trItems: [] };
          return goTo(ctx, "novaTarefa", "tipo");
        case "2":
          return listOpenTasks(ctx);
        case "3":
          return goTo(ctx, "historico", "menu");
        case "4":
          return goTo(ctx, "filialDados", "codigo");
        case "5":
          return goTo(ctx, "historico", "menu");
        case "6":
          return goTo(ctx, "monitor", "menu");
        case "7":
          return goTo(ctx, "import", "aguardando");
        case "8":
          return goTo(ctx, "gerenciarPedido", "codigo");
        case "9":
          return goTo(ctx, "busca", "termo");
        default:
          return ctx.reply("Opção inválida. Digite de *1* a *9*.");
      }
    },
  },
});

async function listOpenTasks(ctx: Ctx): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { branchId: ctx.session.branchId, status: { in: ["PENDENTE", "ATRIBUIDA"] } },
    orderBy: { dueAt: "asc" },
    include: taskInclude,
    take: 20,
  });
  if (!tasks.length) {
    await ctx.reply("📭 Nenhuma tarefa em aberto na sua filial.\n\n" + NAV_FOOTER);
    return;
  }
  const lines = tasks.map(
    (t) =>
      `📦 *#${t.code}* ${t.typeName} — ${statusLabel(t.status)}` +
      `${t.motoboy ? ` (🛵 ${t.motoboy.name ?? t.motoboy.phone})` : ""}` +
      `${t.dueAt ? ` ⏰ ${fmtDateTime(t.dueAt)}` : ""}`
  );
  await ctx.reply(
    `📋 *Tarefas em aberto (${tasks.length}):*\n\n` +
      lines.join("\n") +
      "\n\n💡 Para cancelar (apenas pendentes), envie *C* + código (ex: *C12*).\n" +
      NAV_FOOTER
  );
}

async function cancelTask(ctx: Ctx, code: number): Promise<void> {
  const task = await prisma.task.findFirst({
    where: { code, branchId: ctx.session.branchId },
    include: taskInclude,
  });
  if (!task) return void (await ctx.reply(`⚠️ Pedido *#${code}* não encontrado nesta filial.`));
  if (task.status === "FINALIZADA" || task.status === "CANCELADA") {
    return void (await ctx.reply(`⚠️ O pedido *#${code}* já está ${statusLabel(task.status)}.`));
  }
  if (task.status === "ATRIBUIDA") {
    return void (await ctx.reply(
      `⚠️ O pedido *#${code}* já foi *atribuído* a ${task.motoboy?.name ?? task.motoboy?.phone}. ` +
        "Não é possível cancelar — entre em contato com o motoboy."
    ));
  }
  await prisma.task.update({ where: { id: task.id }, data: { status: "CANCELADA" } });
  await ctx.reply(`🔴 Pedido *#${code}* cancelado.`);
}

async function dadosPedido(ctx: Ctx, code: number): Promise<void> {
  const t = await prisma.task.findFirst({
    where: { code, branchId: ctx.session.branchId },
    include: taskInclude,
  });
  if (!t) {
    await ctx.reply(`⚠️ Pedido *#${code}* não encontrado nesta filial.\n\n${NAV_FOOTER}`);
    return;
  }
  const lines = [
    `📦 *PEDIDO #${t.code}* — ${t.typeName}`,
    `Status: ${statusLabel(t.status)}`,
    t.clientName ? `Cliente: ${t.clientName}` : "",
    `🕒 Criado: ${fmtDateTime(t.createdAt)}`,
    `🛵 Atribuído: ${fmtDateTime(t.assignedAt)}${t.motoboy ? ` (${t.motoboy.name ?? t.motoboy.phone})` : ""}`,
    `🏁 Finalizado: ${fmtDateTime(t.finishedAt)}`,
    `📝 Observação: ${t.finishNote ?? t.notes ?? "-"}`,
  ].filter(Boolean);
  await ctx.reply(lines.join("\n") + "\n\n" + NAV_FOOTER);
}

registerFlow("filialDados", {
  codigo: {
    prompt: (ctx) => ctx.reply("🔎 Digite o *código do pedido* (ex: 12):"),
    handle: async (ctx, text) => {
      const code = Number(text.replace(/\D/g, ""));
      if (!code) return ctx.reply("Digite um código numérico válido.");
      return dadosPedido(ctx, code);
    },
  },
});

// ---------------------------------------------------------------------------
// Nova tarefa
// ---------------------------------------------------------------------------
function buildSummary(task: any): string {
  const lines: string[] = ["📋 *RESUMO DA TAREFA*", ""];
  lines.push(`Tipo: ${task.typeName}`);
  if (task.scheduledAt) lines.push(`Horário: ${fmtDateTime(new Date(task.scheduledAt))}`);
  lines.push(`Cliente: ${task.clientName}`);
  if (task.clientPhone) lines.push(`Telefone: ${task.clientPhone}`);
  lines.push(`Coleta: ${task.pickupAddress || "na própria filial"}`);
  lines.push(`Entrega: ${task.address}`);
  lines.push("Itens:");
  for (const i of task.items) lines.push(`  • ${i}`);
  if (task.trItems.length) {
    lines.push(`Coletas adicionais (TR) — ${task.trItems.length}:`);
    task.trItems.forEach((tr: string, idx: number) => lines.push(`  ${idx + 1}. ${tr}`));
  }
  if (task.notes) lines.push(`Obs: ${task.notes}`);
  lines.push("");
  lines.push("1️⃣ Confirmar e enviar aos motoboys\n2️⃣ Cancelar\n3️⃣ ✏️ Editar um campo");
  return lines.join("\n");
}

registerFlow("novaTarefa", {
  tipo: {
    prompt: async (ctx) => {
      const types = await prisma.deliveryType.findMany({
        where: { branchId: ctx.session.branchId, active: true },
        orderBy: { createdAt: "asc" },
      });
      if (!types.length) {
        await ctx.reply(
          "⚠️ Esta filial ainda não tem *tipos de entrega* cadastrados.\n" +
            "Peça ao Admin para cadastrar em Admin → Filiais → Tipos de entrega.\n\n" +
            NAV_FOOTER
        );
        return showMainMenu(ctx);
      }
      ctx.session.data.typeList = types.map((t) => ({
        id: t.id,
        name: t.name,
        slaMin: t.slaMin,
        scheduled: t.scheduled,
      }));
      const lines = types.map(
        (t, i) =>
          `${i + 1}️⃣ ${t.name}` +
          (t.scheduled ? " 🗓️ (horário)" : t.slaMin ? ` ⏱️ ${t.slaMin}min` : "")
      );
      return ctx.reply(
        "🆕 *NOVA TAREFA* — tipo da coleta principal:\n\n" +
          lines.join("\n") +
          "\n\n_(0 volta | menu cancela)_"
      );
    },
    handle: async (ctx, text) => {
      const list = ctx.session.data.typeList ?? [];
      const choice = list[Number(text.trim()) - 1];
      if (!choice) return ctx.reply("Opção inválida. Digite o número de um tipo da lista.");
      Object.assign(ctx.session.data.task, {
        deliveryTypeId: choice.id,
        typeName: choice.name,
        slaMin: choice.slaMin,
        scheduled: choice.scheduled,
      });
      if (choice.scheduled) return goTo(ctx, "novaTarefa", "horario");
      return goTo(ctx, "novaTarefa", "cliente");
    },
  },

  horario: {
    prompt: (ctx) =>
      ctx.reply(
        "🗓️ Qual o *horário programado*?\n\n" +
          "Formatos: *HH:mm* (hoje) ou *dd/mm HH:mm*\nEx: 15:30 ou 25/12 09:00"
      ),
    handle: async (ctx, text) => {
      const date = parseDateTime(text);
      if (!date) return ctx.reply("⚠️ Horário inválido. Use *HH:mm* ou *dd/mm HH:mm*.");
      if (date.getTime() < Date.now()) return ctx.reply("⚠️ O horário precisa ser no futuro.");
      ctx.session.data.task.scheduledAt = date.toISOString();
      return goTo(ctx, "novaTarefa", "cliente");
    },
  },

  cliente: {
    prompt: (ctx) => ctx.reply("👤 Nome do *cliente*:"),
    handle: async (ctx, text) => {
      const name = text.trim();
      if (!name) return ctx.reply("Digite o nome do cliente.");
      ctx.session.data.task.clientName = name;
      return goTo(ctx, "novaTarefa", "telefone");
    },
  },

  telefone: {
    optional: true,
    prompt: (ctx) => ctx.reply("📞 Telefone do cliente _(9 para pular)_:"),
    handle: async (ctx, text) => {
      const phone = text.trim();
      ctx.session.data.task.clientPhone = phone || undefined;
      // Memória de cliente: busca a última entrega para este telefone
      if (phone) {
        const digits = phone.replace(/\D/g, "");
        if (digits.length >= 8) {
          const last = await prisma.task.findFirst({
            where: {
              branchId: ctx.session.branchId,
              clientPhone: { contains: digits },
              address: { not: null },
            },
            orderBy: { createdAt: "desc" },
          });
          if (last) {
            ctx.session.data.task.lastName = last.clientName;
            ctx.session.data.task.lastAddress = last.address;
            return goTo(ctx, "novaTarefa", "clienteRecente");
          }
        }
      }
      return goTo(ctx, "novaTarefa", "endereco");
    },
  },

  clienteRecente: {
    prompt: (ctx) => {
      const d = ctx.session.data.task;
      return ctx.reply(
        "🔁 *Cliente recorrente!* Última entrega:\n" +
          `👤 ${d.lastName ?? "-"}\n📍 ${d.lastAddress}\n\n` +
          "Usar este *endereço*?\n1️⃣ Sim\n2️⃣ Não, digitar outro"
      );
    },
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          ctx.session.data.task.address = ctx.session.data.task.lastAddress;
          return goTo(ctx, "novaTarefa", "coleta");
        case "2":
          return goTo(ctx, "novaTarefa", "endereco");
        default:
          return ctx.reply("Digite *1* (usar) ou *2* (digitar outro).");
      }
    },
  },

  endereco: {
    prompt: (ctx) => ctx.reply("📍 *Endereço de entrega* (rua, número, bairro, referência):"),
    handle: async (ctx, text) => {
      const address = text.trim();
      if (!address) return ctx.reply("Digite o endereço de entrega.");
      ctx.session.data.task.address = address;
      return goTo(ctx, "novaTarefa", "coleta");
    },
  },

  coleta: {
    optional: true,
    prompt: (ctx) =>
      ctx.reply("📤 *Endereço de coleta* (retirada)?\n_(9 = retirar na própria filial)_"),
    handle: async (ctx, text) => {
      ctx.session.data.task.pickupAddress = text.trim() || undefined;
      return goTo(ctx, "novaTarefa", "itens");
    },
  },

  itens: {
    prompt: (ctx) =>
      ctx.reply(
        "🧾 Envie os *itens* da coleta.\n" +
          "Pode mandar *vários de uma vez* separando por *vírgula* (ou um por mensagem).\n" +
          "Quando terminar, envie *ok*."
      ),
    handle: async (ctx, text) => {
      const t = text.trim();
      if (normalize(t) === "ok") {
        if (!ctx.session.data.task.items.length) {
          return ctx.reply("⚠️ Adicione pelo menos um item antes de enviar *ok*.");
        }
        return goTo(ctx, "novaTarefa", "obs");
      }
      const parts = t.split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean);
      if (!parts.length) return ctx.reply("Envie um item ou *ok* para concluir.");
      ctx.session.data.task.items.push(...parts);
      const total = ctx.session.data.task.items.length;
      return ctx.reply(
        `✔️ ${parts.length > 1 ? `${parts.length} itens adicionados` : "Item adicionado"} (total: ${total}). ` +
          "Envie outro ou *ok*."
      );
    },
  },

  obs: {
    optional: true,
    prompt: (ctx) => ctx.reply("📝 Alguma *observação*? _(9 para pular)_"),
    handle: async (ctx, text) => {
      ctx.session.data.task.notes = text.trim() || undefined;
      return goTo(ctx, "novaTarefa", "trPergunta");
    },
  },

  // ---- Coletas adicionais TR: texto livre, uma por mensagem ----
  trPergunta: {
    prompt: (ctx) => {
      const n = ctx.session.data.task.trItems.length;
      return ctx.reply(
        (n ? `🔁 ${n} TR adicionada(s).\n\n` : "") +
          "Adicionar *coleta adicional (TR)*?\n\n1️⃣ Sim\n2️⃣ Não, revisar e finalizar"
      );
    },
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          return goTo(ctx, "novaTarefa", "trTexto");
        case "2":
          return goTo(ctx, "novaTarefa", "confirmar");
        default:
          return ctx.reply("Digite *1* (sim) ou *2* (não).");
      }
    },
  },

  trTexto: {
    prompt: (ctx) =>
      ctx.reply(
        "🔁 Envie cada *TR* — uma por mensagem (texto livre).\n" +
          "Cada mensagem conta como *1 TR*.\nQuando terminar, envie *ok*."
      ),
    handle: async (ctx, text) => {
      const t = text.trim();
      if (normalize(t) === "ok") return goTo(ctx, "novaTarefa", "confirmar");
      if (!t) return ctx.reply("Envie uma TR ou *ok* para concluir.");
      ctx.session.data.task.trItems.push(t);
      return ctx.reply(
        `✔️ TR ${ctx.session.data.task.trItems.length} adicionada. Envie outra ou *ok*.`
      );
    },
  },

  confirmar: {
    prompt: (ctx) => ctx.reply(buildSummary(ctx.session.data.task)),
    handle: async (ctx, text) => {
      const t = normalize(text);
      if (t === "2") {
        await ctx.reply("🗑️ Tarefa descartada.");
        return showMainMenu(ctx);
      }
      if (t === "3") return goTo(ctx, "novaTarefa", "editMenu");
      if (t !== "1") return ctx.reply("Digite *1* (confirmar), *2* (cancelar) ou *3* (editar).");

      const d = ctx.session.data.task;
      const { task, assignedTo, notified } = await createAndDispatch({
        adminId: ctx.session.adminId!,
        branchId: ctx.session.branchId!,
        createdByPhone: ctx.msg.phone,
        createdByName: ctx.msg.pushName,
        deliveryTypeId: d.deliveryTypeId,
        typeName: d.typeName,
        slaMin: d.slaMin,
        scheduled: !!d.scheduled,
        scheduledAt: d.scheduledAt ? new Date(d.scheduledAt) : undefined,
        clientName: d.clientName,
        clientPhone: d.clientPhone,
        pickupAddress: d.pickupAddress,
        address: d.address,
        notes: d.notes,
        items: d.items,
        trItems: d.trItems,
      });
      await ctx.reply(
        `✅ Tarefa *#${task.code}* criada!` +
          (assignedTo
            ? ` 🤖 Atribuída automaticamente a 🛵 *${assignedTo.name ?? assignedTo.phone}*.`
            : notified
            ? ` 🛵 ${notified} motoboy(s) notificado(s).`
            : " ⚠️ Nenhum motoboy cadastrado nesta operação.")
      );
      return showMainMenu(ctx);
    },
  },

  // ---- Edição de campo a partir do resumo ----
  editMenu: {
    prompt: (ctx) =>
      ctx.reply(
        "✏️ *O que deseja editar?*\n\n" +
          "1️⃣ Cliente\n2️⃣ Telefone\n3️⃣ Endereço\n4️⃣ Itens\n5️⃣ Observação\n0️⃣ Voltar ao resumo"
      ),
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          return goTo(ctx, "novaTarefa", "editCliente");
        case "2":
          return goTo(ctx, "novaTarefa", "editTelefone");
        case "3":
          return goTo(ctx, "novaTarefa", "editEndereco");
        case "4":
          ctx.session.data.task.items = [];
          return goTo(ctx, "novaTarefa", "editItens");
        case "5":
          return goTo(ctx, "novaTarefa", "editObs");
        case "0":
          return goTo(ctx, "novaTarefa", "confirmar");
        default:
          return ctx.reply("Digite de *0* a *5*.");
      }
    },
  },

  editCliente: {
    prompt: (ctx) => ctx.reply("👤 Novo nome do cliente:"),
    handle: async (ctx, text) => {
      const v = text.trim();
      if (!v) return ctx.reply("Digite um nome.");
      ctx.session.data.task.clientName = v;
      return goTo(ctx, "novaTarefa", "confirmar");
    },
  },

  editTelefone: {
    optional: true,
    prompt: (ctx) => ctx.reply("📞 Novo telefone _(9 para limpar)_:"),
    handle: async (ctx, text) => {
      ctx.session.data.task.clientPhone = text.trim() || undefined;
      return goTo(ctx, "novaTarefa", "confirmar");
    },
  },

  editEndereco: {
    prompt: (ctx) => ctx.reply("📍 Novo endereço:"),
    handle: async (ctx, text) => {
      const v = text.trim();
      if (!v) return ctx.reply("Digite o endereço.");
      ctx.session.data.task.address = v;
      return goTo(ctx, "novaTarefa", "confirmar");
    },
  },

  editObs: {
    optional: true,
    prompt: (ctx) => ctx.reply("📝 Nova observação _(9 para limpar)_:"),
    handle: async (ctx, text) => {
      ctx.session.data.task.notes = text.trim() || undefined;
      return goTo(ctx, "novaTarefa", "confirmar");
    },
  },

  editItens: {
    prompt: (ctx) =>
      ctx.reply("🧾 Redigite os *itens* (vírgula separa vários). Envie *ok* ao terminar."),
    handle: async (ctx, text) => {
      const t = text.trim();
      if (normalize(t) === "ok") {
        if (!ctx.session.data.task.items.length) return ctx.reply("⚠️ Adicione ao menos um item.");
        return goTo(ctx, "novaTarefa", "confirmar");
      }
      const parts = t.split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean);
      if (!parts.length) return ctx.reply("Envie itens ou *ok*.");
      ctx.session.data.task.items.push(...parts);
      return ctx.reply(`✔️ ${ctx.session.data.task.items.length} item(ns). Envie outro ou *ok*.`);
    },
  },
});
