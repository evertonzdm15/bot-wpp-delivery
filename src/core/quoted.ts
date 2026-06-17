import { Ctx } from "./types";
import { prisma } from "../lib/prisma";
import { taskInclude } from "../services/task.service";
import { actOnTask } from "./motoboyActions";
import { logger } from "../lib/logger";

/**
 * Trata respostas citadas a mensagens de pedido (pegar / soltar / finalizar).
 * Retorna false se a mensagem citada não corresponde a um pedido conhecido.
 */
export async function handleQuotedReply(ctx: Ctx): Promise<boolean> {
  const tm = await prisma.taskMessage.findUnique({
    where: { waMessageId: ctx.msg.quotedId! },
    include: { task: { include: taskInclude } },
  });
  if (!tm) {
    logger.info(
      { quotedId: ctx.msg.quotedId, phone: ctx.msg.phone },
      "Citação recebida mas sem TaskMessage correspondente"
    );
    return false;
  }
  await actOnTask(ctx, tm.task, ctx.msg.text);
  return true;
}
