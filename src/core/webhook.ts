import { redis } from "../lib/redis";
import { logger } from "../lib/logger";
import { handleMessage } from "./router";
import { handleGroupEvent } from "../services/group.service";
import { jidToPhone } from "../utils/phone";

/** Desembrulha mensagens efêmeras/view-once */
function unwrap(message: any): any {
  if (!message) return {};
  return (
    message.ephemeralMessage?.message ??
    message.viewOnceMessage?.message ??
    message.viewOnceMessageV2?.message ??
    message
  );
}

function extractText(message: any): string {
  const m = unwrap(message);
  return (
    m?.conversation ??
    m?.extendedTextMessage?.text ??
    m?.buttonsResponseMessage?.selectedDisplayText ??
    m?.listResponseMessage?.title ??
    m?.imageMessage?.caption ??
    m?.documentMessage?.caption ??
    ""
  );
}

/** Extrai um documentMessage (inclui o caso documentWithCaption). */
function extractDocument(message: any): { fileName: string; mimetype: string } | undefined {
  const m = unwrap(message);
  const doc =
    m?.documentMessage ??
    m?.documentWithCaptionMessage?.message?.documentMessage ??
    undefined;
  if (!doc) return undefined;
  return { fileName: doc.fileName ?? "arquivo", mimetype: doc.mimetype ?? "" };
}

/** Procura recursivamente o primeiro contextInfo.stanzaId em qualquer profundidade. */
function deepStanzaId(obj: any, depth = 0): string | undefined {
  if (!obj || typeof obj !== "object" || depth > 6) return undefined;
  if (obj.contextInfo?.stanzaId) return obj.contextInfo.stanzaId;
  if (obj.stanzaId && typeof obj.stanzaId === "string") return obj.stanzaId;
  for (const k of Object.keys(obj)) {
    const found = deepStanzaId(obj[k], depth + 1);
    if (found) return found;
  }
  return undefined;
}

function extractQuotedId(data: any): string | undefined {
  const m = unwrap(data?.message);
  return (
    m?.extendedTextMessage?.contextInfo?.stanzaId ??
    m?.contextInfo?.stanzaId ??
    data?.contextInfo?.stanzaId ??
    deepStanzaId(data?.message) ??
    undefined
  );
}

export async function processWebhook(body: any): Promise<void> {
  const event = String(body?.event ?? "")
    .toLowerCase()
    .replace(/_/g, ".");

  // Captura de grupos (quando o bot é adicionado / o grupo é atualizado)
  if (event === "groups.upsert" || event === "groups.update") {
    await handleGroupEvent(body?.data).catch((err) =>
      logger.error({ err }, "Erro ao processar evento de grupo")
    );
    return;
  }

  if (event !== "messages.upsert") return;

  const items = Array.isArray(body?.data) ? body.data : [body?.data];
  for (const data of items) {
    try {
      await processOne(data);
    } catch (err) {
      logger.error({ err }, "Erro ao processar evento do webhook");
    }
  }
}

async function processOne(data: any): Promise<void> {
  const key = data?.key;
  if (!key || key.fromMe) return;

  const jid: string = key.remoteJid ?? "";
  // Ignora grupos, broadcast e newsletters — só conversa individual
  if (!jid.endsWith("@s.whatsapp.net")) return;

  const text = extractText(data.message).trim();
  const doc = extractDocument(data.message);
  if (!text && !doc) return;

  const messageId: string = key.id ?? "";
  if (messageId) {
    const fresh = await redis.set(`dedup:${messageId}`, "1", "EX", 120, "NX");
    if (!fresh) return; // mensagem duplicada
  }

  const quotedId = extractQuotedId(data);

  await handleMessage({
    phone: jidToPhone(jid),
    pushName: data.pushName ?? undefined,
    text,
    quotedId,
    messageId,
    document: doc
      ? {
          ...doc,
          messageKey: { remoteJid: jid, id: messageId, fromMe: !!key.fromMe },
        }
      : undefined,
  });
}
