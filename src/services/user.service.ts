import { Role, User } from "@prisma/client";
import { prisma } from "../lib/prisma";

export async function upsertUser(phone: string, name?: string): Promise<User> {
  return prisma.user.upsert({
    where: { phone },
    update: name ? { name } : {},
    create: { phone, name },
  });
}

export async function hasRole(phone: string, role: Role): Promise<boolean> {
  const count = await prisma.userRole.count({ where: { role, user: { phone } } });
  return count > 0;
}

interface RoleScope {
  adminId?: string;
  branchId?: string;
}

/** Adiciona um perfil (menu) a um número, evitando duplicidade. */
export async function addRole(phone: string, role: Role, scope: RoleScope = {}): Promise<boolean> {
  const user = await upsertUser(phone);
  const existing = await prisma.userRole.findFirst({
    where: {
      userId: user.id,
      role,
      adminId: scope.adminId ?? null,
      branchId: scope.branchId ?? null,
    },
  });
  if (existing) return false;
  await prisma.userRole.create({
    data: { userId: user.id, role, adminId: scope.adminId, branchId: scope.branchId },
  });
  return true;
}

export async function setAccessCode(phone: string, code: string): Promise<void> {
  const user = await upsertUser(phone);
  await prisma.user.update({ where: { id: user.id }, data: { accessCode: code } });
}

/** Garante o Super Admin no boot (produção não roda o seed). Idempotente. */
export async function ensureSuperAdmin(phone: string, code: string): Promise<void> {
  if (!phone) return;
  const user = await prisma.user.upsert({
    where: { phone },
    update: code ? { accessCode: code } : {},
    create: { phone, name: "Super Admin", accessCode: code || null },
  });
  const exists = await prisma.userRole.findFirst({
    where: { userId: user.id, role: "SUPER_ADMIN" },
  });
  if (!exists) await prisma.userRole.create({ data: { userId: user.id, role: "SUPER_ADMIN" } });
}
