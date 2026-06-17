import { registerFlow } from "../core/engine";
import { Ctx } from "../core/types";
import { markPaid, pendingByMotoboy } from "../services/payment.service";
import { sendText } from "../services/evolution.service";
import { formatMoney, normalize } from "../utils/format";
import { showMainMenu } from "./menu";
import { NAV_FOOTER } from "./common";

function adminId(ctx: Ctx): string {
  return ctx.session.adminId!;
}

registerFlow("fechamento", {
  menu: {
    prompt: async (ctx) => {
      const pend = await pendingByMotoboy(adminId(ctx));
      ctx.session.data.payList = pend.map((p) => ({ id: p.motoboyId, name: p.name, phone: p.phone }));
      if (!pend.length) {
        return ctx.reply("💰 *FECHAMENTO*\n\n✅ Nada pendente de pagamento.\n\n" + NAV_FOOTER);
      }
      const lines = pend.map(
        (p, i) => `${i + 1}️⃣ 🛵 ${p.name} — ${p.count} entrega(s) = *${formatMoney(p.totalCents)}*`
      );
      const total = pend.reduce((s, p) => s + p.totalCents, 0);
      return ctx.reply(
        "💰 *FECHAMENTO — a pagar:*\n\n" +
          lines.join("\n") +
          `\n─────────────\nTotal: *${formatMoney(total)}*\n\n` +
          `Digite o *número* do motoboy para *marcar como pago*.\n${NAV_FOOTER}`
      );
    },
    handle: async (ctx, text) => {
      const sel = (ctx.session.data.payList ?? [])[Number(normalize(text)) - 1];
      if (!sel) return ctx.reply("Opção inválida. Digite o número de um motoboy da lista.");
      const { count, totalCents } = await markPaid(adminId(ctx), sel.id);
      await ctx.reply(
        `✅ Pagamento de 🛵 *${sel.name}* registrado: ${count} entrega(s) = *${formatMoney(totalCents)}*.`
      );
      if (sel.phone && sel.phone !== ctx.msg.phone) {
        await sendText(sel.phone, `💸 Seu pagamento de *${formatMoney(totalCents)}* (${count} entrega(s)) foi registrado.`);
      }
      return showMainMenu(ctx);
    },
  },
});
