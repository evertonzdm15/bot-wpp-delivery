import { Admin, RegistrationRequest } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { addRole, upsertUser } from "./user.service";

export type RequestKind = "CLIENTE" | "MOTOBOY";

// Alfabeto sem caracteres ambíguos (0/O, 1/I) para os códigos de convite.
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomFrom(alphabet: string, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/** Gera um código de convite único (6 caracteres, sem ambiguidade). */
export async function generateInviteCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = randomFrom(INVITE_ALPHABET, 6);
    const exists = await prisma.admin.findUnique({ where: { inviteCode: code } });
    if (!exists) return code;
  }
  throw new Error("Não foi possível gerar um código de convite único.");
}

/**
 * Gera um código de acesso numérico (4 dígitos) que não colide com nenhum
 * código de Admin ou Filial — assim o login do novo cadastro não é "roubado"
 * por outro perfil no fluxo de autenticação.
 */
export async function generateAccessCode(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const [a, b] = await Promise.all([
      prisma.admin.findUnique({ where: { accessCode: code } }),
      prisma.branch.findUnique({ where: { accessCode: code } }),
    ]);
    if (!a && !b) return code;
  }
  throw new Error("Não foi possível gerar um código de acesso único.");
}

/** Encontra o tenant (Admin ativo) dono de um código de convite. */
export async function findAdminByInviteCode(code: string): Promise<Admin | null> {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  return prisma.admin.findFirst({ where: { inviteCode: c, active: true } });
}

interface NewRequest {
  adminId: string;
  kind: RequestKind;
  name: string;
  phone: string;
  extra?: string;
}

/** Cria uma solicitação de cadastro, evitando duplicar pendentes do mesmo número/tipo. */
export async function createRequest(
  input: NewRequest
): Promise<{ request: RegistrationRequest; duplicate: boolean }> {
  const dup = await prisma.registrationRequest.findFirst({
    where: { adminId: input.adminId, phone: input.phone, kind: input.kind, status: "PENDENTE" },
  });
  if (dup) return { request: dup, duplicate: true };
  const request = await prisma.registrationRequest.create({
    data: { ...input, extra: input.extra ?? null },
  });
  return { request, duplicate: false };
}

/** Solicitações pendentes de um tenant, mais antigas primeiro. */
export function listPending(adminId: string): Promise<RegistrationRequest[]> {
  return prisma.registrationRequest.findMany({
    where: { adminId, status: "PENDENTE" },
    orderBy: { createdAt: "asc" },
  });
}

export interface AcceptResult {
  kind: RequestKind;
  name: string;
  phone: string;
  accessCode: string;
}

/**
 * Aprova a solicitação: cria a Filial (CLIENTE) ou o Motoboy (MOTOBOY) com um
 * código de acesso gerado, concede o perfil ao número e marca como ACEITO.
 * Retorna null se a solicitação não estiver mais pendente.
 */
export async function acceptRequest(id: string): Promise<AcceptResult | null> {
  const req = await prisma.registrationRequest.findUnique({ where: { id } });
  if (!req || req.status !== "PENDENTE") return null;

  const accessCode = await generateAccessCode();

  if (req.kind === "CLIENTE") {
    const branch = await prisma.branch.create({
      data: { adminId: req.adminId, name: req.name, accessCode },
    });
    await upsertUser(req.phone, req.name);
    await addRole(req.phone, "FILIAL", { adminId: req.adminId, branchId: branch.id });
  } else {
    const user = await upsertUser(req.phone, req.name);
    await prisma.user.update({ where: { id: user.id }, data: { name: req.name, accessCode } });
    await addRole(req.phone, "MOTOBOY", { adminId: req.adminId });
  }

  await prisma.registrationRequest.update({ where: { id }, data: { status: "ACEITO" } });
  return { kind: req.kind as RequestKind, name: req.name, phone: req.phone, accessCode };
}

/** Recusa a solicitação. Retorna a solicitação recusada, ou null se não estava pendente. */
export async function rejectRequest(id: string): Promise<RegistrationRequest | null> {
  const req = await prisma.registrationRequest.findUnique({ where: { id } });
  if (!req || req.status !== "PENDENTE") return null;
  return prisma.registrationRequest.update({ where: { id }, data: { status: "RECUSADO" } });
}

/** Quantidade de solicitações pendentes (para o "badge" no menu). */
export function countPending(adminId: string): Promise<number> {
  return prisma.registrationRequest.count({ where: { adminId, status: "PENDENTE" } });
}

/** Telefones com painel Admin deste tenant (para notificar novas solicitações). */
export async function adminPhones(adminId: string): Promise<string[]> {
  const roles = await prisma.userRole.findMany({
    where: { role: "ADMIN", adminId },
    include: { user: true },
  });
  return [...new Set(roles.map((r) => r.user.phone))];
}
