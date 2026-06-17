import { registerFlow } from "../core/engine";
import { prisma } from "../lib/prisma";
import { addRole, upsertUser } from "../services/user.service";
import { env } from "../config/env";
import { afterAuth } from "./menu";

/** Atalho de teste: libera os 4 perfis (usando o tenant/filial de demonstração). */
async function grantAllProfiles(phone: string): Promise<void> {
  const user = await upsertUser(phone);
  // Valor padrão p/ o motoboy de teste, para a finalização exibir R$
  if (user.defaultRateCents == null) {
    await prisma.user.update({ where: { id: user.id }, data: { defaultRateCents: 700 } });
  }
  let admin = await prisma.admin.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
  if (!admin) admin = await prisma.admin.create({ data: { name: "Operação Demo", accessCode: "2000" } });
  let branch = await prisma.branch.findFirst({
    where: { adminId: admin.id, active: true },
    orderBy: { createdAt: "asc" },
  });
  if (!branch) {
    branch = await prisma.branch.create({
      data: { adminId: admin.id, name: "Matriz", accessCode: "1010" },
    });
  }
  await addRole(phone, "SUPER_ADMIN");
  await addRole(phone, "ADMIN", { adminId: admin.id });
  await addRole(phone, "MOTOBOY", { adminId: admin.id });
  await addRole(phone, "FILIAL", { adminId: admin.id, branchId: branch.id });
}

registerFlow("auth", {
  codigo: {
    prompt: (ctx) =>
      ctx.reply(
        "👋 Olá! Este é o *Bot de Entregas — Grupo DM*.\n\n" +
          "🔐 Digite seu *código de acesso* para continuar:"
      ),
    handle: async (ctx, text) => {
      const code = text.trim();
      if (!code) return ctx.reply("Digite seu código de acesso.");
      const phone = ctx.msg.phone;

      // 1) Atalho de teste — libera os 4 perfis (desligado se BOT_TEST_CODE vazio)
      if (env.BOT_TEST_CODE && code === env.BOT_TEST_CODE) {
        await grantAllProfiles(phone);
        await ctx.reply("✅ Acesso de teste liberado (4 perfis).");
        return afterAuth(ctx);
      }

      // 2) Código de Admin (tenant) — concede o painel Admin
      const admin = await prisma.admin.findFirst({
        where: { accessCode: { equals: code, mode: "insensitive" }, active: true },
      });
      if (admin) {
        await upsertUser(phone, ctx.msg.pushName);
        await addRole(phone, "ADMIN", { adminId: admin.id });
        await ctx.reply(`✅ Acesso liberado: 👑 Admin *${admin.name}*`);
        return afterAuth(ctx);
      }

      // 3) Código de Filial (compartilhável) — concede o menu da filial
      const branch = await prisma.branch.findFirst({
        where: { accessCode: { equals: code, mode: "insensitive" }, active: true },
      });
      if (branch) {
        await upsertUser(phone, ctx.msg.pushName);
        await addRole(phone, "FILIAL", { adminId: branch.adminId, branchId: branch.id });
        await ctx.reply(`✅ Acesso liberado: 🏪 *${branch.name}*`);
        return afterAuth(ctx);
      }

      // 4) Senha pessoal (número = login, código = senha) — carrega os perfis do número
      const user = await prisma.user.findUnique({ where: { phone } });
      if (user?.accessCode && user.accessCode === code) {
        return afterAuth(ctx);
      }

      return ctx.reply("❌ Código inválido. Verifique com o administrador e tente novamente.");
    },
  },
});
