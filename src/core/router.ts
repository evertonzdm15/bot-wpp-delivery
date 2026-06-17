import { Ctx, IncomingMessage } from "./types";
import { deleteSession, getSession, newSession, saveSession } from "../services/session.service";
import { sendText } from "../services/evolution.service";
import { clearFlow, getStep, goBack } from "./engine";
import { entry, showMainMenu, showProfileChooser } from "../flows/menu";
import { handleQuotedReply } from "./quoted";
import { actOnTaskByCode, handleMotoboyQuickCommand } from "./motoboyActions";
import { processImportDocument } from "../flows/import.flow";
import { processBackupDocument } from "../flows/backup.flow";
import { sendEmAndamento, sendPedidos } from "../flows/motoboy.flow";
import { hasRole } from "../services/user.service";
import { normalize } from "../utils/format";
import { logger } from "../lib/logger";

export async function handleMessage(msg: IncomingMessage): Promise<void> {
  const session = (await getSession(msg.phone)) ?? newSession(msg.phone);
  if (msg.pushName && !session.name) session.name = msg.pushName;

  const ctx: Ctx = {
    msg,
    session,
    reply: (text) => sendText(msg.phone, text),
    save: () => saveSession(session),
  };

  try {
    const lower = normalize(msg.text);

    // Resposta citada a uma mensagem de pedido (pegar / soltar / finalizar)
    if (msg.quotedId) {
      const handled = await handleQuotedReply(ctx);
      if (handled) {
        await ctx.save();
        return;
      }
    }

    // "inicio" zera a navegação (mantém os acessos vinculados ao número)
    if (lower === "inicio") {
      await deleteSession(msg.phone);
      session.role = undefined;
      session.branchId = undefined;
      clearFlow(session);
      await entry(ctx);
      await ctx.save();
      return;
    }

    // "sair" volta ao menu de escolha de perfil
    if (lower === "sair") {
      clearFlow(session);
      await showProfileChooser(ctx);
      await ctx.save();
      return;
    }

    // Documento recebido (XLSX de importação ou JSON de backup)
    if (msg.document) {
      if (session.flow === "import" && session.step === "aguardando") {
        await processImportDocument(ctx);
      } else if (session.flow === "backup" && session.step === "aguardando") {
        await processBackupDocument(ctx);
      } else {
        await ctx.reply(
          "📎 Recebi um arquivo. Para importar pedidos: *Filial → Importar pedidos (XLSX)*. " +
            "Para restaurar backup: *Super Admin → Backup*."
        );
      }
      await ctx.save();
      return;
    }

    // Sem perfil ativo: fluxo de identificação (código de acesso / escolha de menu)
    if (!session.role) {
      const step = getStep(session.flow, session.step);
      if (step) await step.handle(ctx, msg.text);
      else await entry(ctx);
      await ctx.save();
      return;
    }

    // "menu" volta ao menu principal do perfil ativo
    if (lower === "menu") {
      clearFlow(session);
      await showMainMenu(ctx);
      await ctx.save();
      return;
    }

    // Comandos rápidos do motoboy: ocupado / disponivel / offline / ganhei
    if (await handleMotoboyQuickCommand(ctx, lower)) {
      await ctx.save();
      return;
    }

    // Ação do motoboy por texto: "pegar 5", "soltar 5", "finalizar 5 [motivo/obs]"
    const act = msg.text.trim().match(/^(pegar|soltar|finalizar)\b\s*#?(\d+)?\s*([\s\S]*)$/i);
    if (act) {
      const isMotoboy = session.role === "MOTOBOY" || (await hasRole(msg.phone, "MOTOBOY"));
      if (isMotoboy) {
        await actOnTaskByCode(ctx, act[1].toLowerCase(), act[2], act[3]);
        await ctx.save();
        return;
      }
    }

    // Comandos do motoboy: /pedidos (disponíveis) e /entregas (em andamento)
    if (lower === "/pedidos" || lower === "/entregas") {
      const motoboy = session.role === "MOTOBOY" || (await hasRole(msg.phone, "MOTOBOY"));
      if (!motoboy) {
        await ctx.reply("⚠️ Comando disponível apenas para motoboys.");
      } else if (lower === "/pedidos") {
        await sendPedidos(ctx);
      } else {
        await sendEmAndamento(ctx);
      }
      await ctx.save();
      return;
    }

    // "0" / "voltar" volta uma etapa
    if (lower === "0" || lower === "voltar") {
      const ok = await goBack(ctx);
      if (!ok) await showMainMenu(ctx);
      await ctx.save();
      return;
    }

    const step = getStep(session.flow, session.step);
    if (!step) {
      await showMainMenu(ctx);
      await ctx.save();
      return;
    }

    // "9" pula campo opcional
    if (lower === "9" && step.optional) await step.handle(ctx, "");
    else await step.handle(ctx, msg.text);

    await ctx.save();
  } catch (err) {
    logger.error({ err, phone: msg.phone }, "Erro ao processar mensagem");
    await sendText(msg.phone, "❌ Ocorreu um erro inesperado. Digite *menu* para recomeçar.");
  }
}
