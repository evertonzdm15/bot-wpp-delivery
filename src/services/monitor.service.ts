import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { taskInclude, TaskFull } from "./task.service";

export interface MotoboyBucket {
  motoboyId: string;
  name: string;
  phone: string;
  tasks: TaskFull[];
}

/** Tarefas ATRIBUÍDAS (não finalizadas) agrupadas por motoboy, no escopo informado. */
export async function motoboysEmRota(
  scope: Prisma.TaskWhereInput,
  onlyOverdue = false
): Promise<MotoboyBucket[]> {
  const where: Prisma.TaskWhereInput = {
    ...scope,
    status: "ATRIBUIDA",
    motoboyId: { not: null },
  };
  if (onlyOverdue) where.dueAt = { lt: new Date() };

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { dueAt: "asc" },
    include: taskInclude,
  });

  const map = new Map<string, MotoboyBucket>();
  for (const t of tasks) {
    if (!t.motoboy) continue;
    let b = map.get(t.motoboy.id);
    if (!b) {
      b = { motoboyId: t.motoboy.id, name: t.motoboy.name ?? t.motoboy.phone, phone: t.motoboy.phone, tasks: [] };
      map.set(t.motoboy.id, b);
    }
    b.tasks.push(t);
  }
  return [...map.values()].sort((a, b) => b.tasks.length - a.tasks.length);
}

/** Todas as tarefas ATRIBUÍDAS do escopo (para exportação). */
export async function tarefasAtribuidas(
  scope: Prisma.TaskWhereInput,
  onlyOverdue = false
): Promise<TaskFull[]> {
  const where: Prisma.TaskWhereInput = { ...scope, status: "ATRIBUIDA" };
  if (onlyOverdue) where.dueAt = { lt: new Date() };
  return prisma.task.findMany({ where, orderBy: { dueAt: "asc" }, include: taskInclude });
}
