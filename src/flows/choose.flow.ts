import { registerFlow } from "../core/engine";
import { showMainMenu } from "./menu";
import { NAV_FOOTER } from "./common";

registerFlow("choose", {
  menu: {
    prompt: (ctx) => {
      const options = ctx.session.data.menuOptions ?? [];
      const lines = options.map((o: any, i: number) => `${i + 1}️⃣ ${o.label}`);
      return ctx.reply(
        `Olá${ctx.session.name ? `, ${ctx.session.name}` : ""}! Escolha o painel:\n\n` +
          lines.join("\n") +
          `\n\nDigite o número do painel.\n${NAV_FOOTER}`
      );
    },
    handle: async (ctx, text) => {
      const options = ctx.session.data.menuOptions ?? [];
      const choice = options[Number(text.trim()) - 1];
      if (!choice) return ctx.reply("Opção inválida. Digite o número de um dos painéis listados.");
      ctx.session.role = choice.role;
      ctx.session.adminId = choice.adminId ?? undefined;
      ctx.session.branchId = choice.branchId ?? undefined;
      return showMainMenu(ctx);
    },
  },
});
