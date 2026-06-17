import { Role } from "@prisma/client";
import { Ctx } from "../core/types";
import { goTo } from "../core/engine";
import { prisma } from "../lib/prisma";
import { ROLE_LABEL } from "./common";

interface MenuOption {
  role: Role;
  adminId?: string;
  branchId?: string;
  label: string;
}

const ROLE_ORDER: Role[] = ["SUPER_ADMIN", "ADMIN", "MOTOBOY", "FILIAL"];

/** Entrada de uma sessão sem perfil ativo: pede o código de acesso. */
export async function entry(ctx: Ctx): Promise<void> {
  return goTo(ctx, "auth", "codigo", false);
}

/** Carrega os perfis (menus) disponíveis para o número, ordenados. */
async function loadOptions(phone: string): Promise<MenuOption[]> {
  const user = await prisma.user.findUnique({
    where: { phone },
    include: { roles: { include: { branch: true, admin: true } } },
  });
  const roles = (user?.roles ?? []).filter(
    (r) =>
      (r.role !== "FILIAL" || (r.branch && r.branch.active)) &&
      (!r.admin || r.admin.active)
  );
  const options: MenuOption[] = roles.map((r) => {
    let label = ROLE_LABEL[r.role];
    if (r.branch) label += ` — ${r.branch.name}`;
    else if (r.admin && (r.role === "ADMIN" || r.role === "MOTOBOY")) label += ` — ${r.admin.name}`;
    return { role: r.role, adminId: r.adminId ?? undefined, branchId: r.branchId ?? undefined, label };
  });
  return options.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

function applyChoice(ctx: Ctx, o: MenuOption): void {
  ctx.session.role = o.role;
  ctx.session.adminId = o.adminId;
  ctx.session.branchId = o.branchId;
}

/** Após autenticar: 1 perfil entra direto; vários mostram o menu de escolha. */
export async function afterAuth(ctx: Ctx): Promise<void> {
  const options = await loadOptions(ctx.msg.phone);
  if (options.length === 0) return entry(ctx);
  if (options.length === 1) {
    applyChoice(ctx, options[0]);
    return showMainMenu(ctx);
  }
  ctx.session.data.menuOptions = options;
  return goTo(ctx, "choose", "menu", false);
}

/** Menu de escolha de perfil (destino do comando SAIR). */
export async function showProfileChooser(ctx: Ctx): Promise<void> {
  const options = await loadOptions(ctx.msg.phone);
  if (options.length === 0) return entry(ctx);
  if (options.length === 1) {
    applyChoice(ctx, options[0]);
    return showMainMenu(ctx);
  }
  ctx.session.role = undefined;
  ctx.session.adminId = undefined;
  ctx.session.branchId = undefined;
  ctx.session.data.menuOptions = options;
  return goTo(ctx, "choose", "menu", false);
}

/** Menu principal do perfil ativo (zera fluxo/etapas). */
export async function showMainMenu(ctx: Ctx): Promise<void> {
  const s = ctx.session;
  s.stack = [];
  s.data = {};
  switch (s.role) {
    case "SUPER_ADMIN":
      return goTo(ctx, "superadmin", "menu", false);
    case "ADMIN":
      return goTo(ctx, "admin", "menu", false);
    case "MOTOBOY":
      return goTo(ctx, "motoboy", "menu", false);
    case "FILIAL":
      return goTo(ctx, "filial", "menu", false);
    default:
      return entry(ctx);
  }
}
