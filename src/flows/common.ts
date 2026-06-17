import { Role } from "@prisma/client";
import { Ctx } from "../core/types";

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "⭐ Super Admin",
  ADMIN: "👑 Admin",
  FILIAL: "🏪 Filial",
  MOTOBOY: "🛵 Motoboy",
};

/** Rodapé fixo de navegação exibido nos menus principais */
export const NAV_FOOTER = "_0/VOLTAR ⬅️ · MENU 🏠 · SAIR 🔄 · INICIO ♻️_";

/** Resposta padrão para itens ainda não implementados (esqueleto) */
export function emBreve(ctx: Ctx, label: string): Promise<unknown> {
  return ctx.reply(`🚧 *${label}* — em breve.\n\n${NAV_FOOTER}`);
}
