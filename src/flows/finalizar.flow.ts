import { FinishReason } from "@prisma/client";
import { goTo, registerFlow } from "../core/engine";
import { finalizeTaskNow } from "../core/motoboyActions";
import { normalize } from "../utils/format";
import { showMainMenu } from "./menu";

const REASONS: Record<string, FinishReason> = {
  "1": "ENTREGUE",
  "2": "NAO_ENTREGUE",
  "3": "RETORNO",
};

registerFlow("finalizar", {
  motivo: {
    prompt: (ctx) =>
      ctx.reply(
        "🏁 *Como terminou o pedido?*\n\n" +
          "1️⃣ ✅ Entregue\n" +
          "2️⃣ ❌ Não entregue\n" +
          "3️⃣ ↩️ Retorno à loja"
      ),
    handle: async (ctx, text) => {
      const reason = REASONS[normalize(text)];
      if (!reason) return ctx.reply("Digite *1*, *2* ou *3*.");
      ctx.session.data.finishReason = reason;
      return goTo(ctx, "finalizar", "nota");
    },
  },

  nota: {
    optional: true,
    prompt: (ctx) => ctx.reply("📝 Observação da finalização? _(9 para pular)_"),
    handle: async (ctx, text) => {
      const note = text.trim() || null;
      const reason = ctx.session.data.finishReason as FinishReason;
      const taskId = ctx.session.data.finishTaskId as string;
      await finalizeTaskNow(ctx, taskId, reason, note);
      return showMainMenu(ctx);
    },
  },
});
