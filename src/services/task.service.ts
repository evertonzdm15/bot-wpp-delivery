import { Prisma, User } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { sendText } from "./evolution.service";
import { upsertUser } from "./user.service";
import { formatAuditMessage, formatTaskMessage } from "../utils/format";
import { canonicalBrazil, isValidPhone } from "../utils/phone";
import { logger } from "../lib/logger";

export const taskInclude = {
  items: true,
  branch: true,
  motoboy: true,
  createdBy: true,
  deliveryType: true,
} satisfies Prisma.TaskInclude;

export type TaskFull = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export interface NovaTarefaInput {
  adminId: string;
  branchId: string;
  createdByPhone: string;
  createdByName?: string;
  deliveryTypeId: string;
  typeName: string;
  slaMin?: number | null;
  scheduled: boolean;
  /** Obrigatório quando scheduled = true */
  scheduledAt?: Date;
  clientName: string;
  clientPhone?: string;
  /** Endereço de coleta/retirada. Vazio = retira na filial. */
  pickupAddress?: string;
  address: string;
  notes?: string;
  items: string[];
  /** Coletas adicionais (TR): texto livre, uma por item */
  trItems: string[];
}

export function computeDueAt(
  scheduled: boolean,
  slaMin?: number | null,
  scheduledAt?: Date
): Date | null {
  if (scheduled) return scheduledAt ?? null;
  if (slaMin && slaMin > 0) return new Date(Date.now() + slaMin * 60_000);
  return null;
}

export async function createTask(input: NovaTarefaInput): Promise<TaskFull> {
  const creator = await upsertUser(input.createdByPhone, input.createdByName);
  return prisma.task.create({
    data: {
      adminId: input.adminId,
      branchId: input.branchId,
      deliveryTypeId: input.deliveryTypeId,
      typeName: input.typeName,
      createdById: creator.id,
      clientName: input.clientName,
      clientPhone: input.clientPhone || null,
      pickupAddress: input.pickupAddress || null,
      address: input.address,
      notes: input.notes || null,
      scheduledAt: input.scheduled ? input.scheduledAt ?? null : null,
      dueAt: computeDueAt(input.scheduled, input.slaMin, input.scheduledAt),
      trItems: input.trItems,
      items: { create: input.items.map((description) => ({ description })) },
    },
    include: taskInclude,
  });
}

/** Envia a mensagem do pedido para um número e registra o id p/ resposta citada */
export async function sendTaskMessage(phone: string, task: TaskFull, text: string): Promise<void> {
  const waId = await sendText(phone, text);
  if (!waId) return;
  try {
    await prisma.taskMessage.create({
      data: { taskId: task.id, waMessageId: waId, toPhone: phone },
    });
  } catch (err) {
    logger.warn({ err, taskId: task.id }, "Não foi possível registrar TaskMessage");
  }
}

/** Motoboys do tenant (admin) do pedido */
export async function motoboysDoAdmin(adminId: string) {
  return prisma.user.findMany({
    where: { roles: { some: { role: "MOTOBOY", adminId } } },
  });
}

/** Notifica os motoboys do tenant sobre um novo pedido */
export async function notifyMotoboys(task: TaskFull, text: string): Promise<number> {
  const motoboys = await motoboysDoAdmin(task.adminId);
  for (const m of motoboys) await sendTaskMessage(m.phone, task, text);
  return motoboys.length;
}

/** Encaminha o pedido ao grupo de auditoria configurado para a filial (se houver). */
export async function postToAuditGroup(
  task: TaskFull,
  kind: "criado" | "atribuido"
): Promise<void> {
  const jid = task.branch.auditGroupJid;
  if (!jid) return;
  await sendText(jid, formatAuditMessage(task, kind));
}

/** Notifica o cliente (se houver telefone) sobre o andamento da entrega. */
export async function notifyClient(task: TaskFull, kind: "saiu" | "entregue"): Promise<void> {
  if (!task.clientPhone) return;
  const phone = canonicalBrazil(task.clientPhone);
  if (!isValidPhone(phone)) return;
  const msg =
    kind === "saiu"
      ? `🛵 Olá! Seu pedido *#${task.code}* (${task.branch.name}) *saiu para entrega*. Em breve chega aí! 📦`
      : `✅ Seu pedido *#${task.code}* foi *entregue*. Obrigado pela preferência! 💊`;
  await sendText(phone, msg);
}

/** Motoboy elegível para auto-atribuição com menos pedidos ativos (balanceamento). */
async function pickAutoMotoboy(adminId: string): Promise<User | null> {
  const roles = await prisma.userRole.findMany({
    where: { role: "MOTOBOY", adminId, autoAssign: true, user: { status: "DISPONIVEL" } },
    include: { user: true },
  });
  if (!roles.length) return null;
  let best: User | null = null;
  let bestCount = Infinity;
  for (const r of roles) {
    const count = await prisma.task.count({ where: { motoboyId: r.userId, status: "ATRIBUIDA" } });
    if (count < bestCount) {
      bestCount = count;
      best = r.user;
    }
  }
  return best;
}

/**
 * Cria o pedido e despacha: se houver motoboy elegível à auto-atribuição,
 * atribui automaticamente; senão, notifica todos os motoboys do tenant.
 */
export async function createAndDispatch(
  input: NovaTarefaInput
): Promise<{ task: TaskFull; assignedTo: User | null; notified: number }> {
  let task = await createTask(input);
  await postToAuditGroup(task, "criado");
  const auto = await pickAutoMotoboy(task.adminId);

  if (auto) {
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "ATRIBUIDA", motoboyId: auto.id, assignedAt: new Date() },
    });
    task = (await prisma.task.findUnique({ where: { id: task.id }, include: taskInclude }))!;
    await sendTaskMessage(auto.phone, task, formatTaskMessage(task));
    await notifyClient(task, "saiu");
    await postToAuditGroup(task, "atribuido");
    return { task, assignedTo: auto, notified: 0 };
  }

  const notified = await notifyMotoboys(task, formatTaskMessage(task));
  return { task, assignedTo: null, notified };
}
