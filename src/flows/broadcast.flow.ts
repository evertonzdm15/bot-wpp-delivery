import { registerFlow } from "../core/engine";
import { Ctx } from "../core/types";
import { prisma } from "../lib/prisma";
import { sendText } from "../services/evolution.service";
import { showMainMenu } from "./menu";
import { NAV_FOOTER } from "./common";

async function recipients(ctx: Ctx): Promise<string[]> {
  const where =
    ctx.session.role === "SUPER_ADMIN"
      ? { role: { in: ["MOTOBOY", "FILIAL", "ADMIN"] as any } }
      : { adminId: ctx.session.adminId, role: { in: ["MOTOBOY", "FILIAL"] as any } };
  const roles = await prisma.userRole.findMany({ where, include: { user: true } });
  return [...new Set(roles.map((r) => r.user.phone))];
}

registerFlow("broadcast", {
  texto: {
    prompt: async (ctx) => {
      const phones = await recipients(ctx);
      ctx.session.data.bcCount = phones.length;
      return ctx.reply(
        `📢 *AVISO / BROADCAST*\n\nSerá enviado para *${phones.length}* número(s) ` +
          `${ctx.session.role === "SUPER_ADMIN" ? "(todos)" : "(motoboys + filiais da sua operação)"}.\n\n` +
          `Digite a *mensagem* a enviar:\n${NAV_FOOTER}`
      );
    },
    handle: async (ctx, text) => {
      const msg = text.trim();
      if (!msg) return ctx.reply("Digite a mensagem do aviso.");
      const phones = await recipients(ctx);
      const me = ctx.msg.phone;
      let sent = 0;
      for (const p of phones) {
        if (p === me) continue;
        await sendText(p, `📢 *AVISO*\n\n${msg}`);
        sent++;
      }
      await ctx.reply(`✅ Aviso enviado a *${sent}* número(s).`);
      return showMainMenu(ctx);
    },
  },
});
