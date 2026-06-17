import axios from "axios";
import { env } from "../config/env";
import { logger } from "../lib/logger";

const api = axios.create({
  baseURL: env.EVOLUTION_API_URL,
  headers: { apikey: env.EVOLUTION_API_KEY },
  timeout: 30000,
});

/** Envia texto e retorna o id da mensagem no WhatsApp (usado p/ resposta citada) */
export async function sendText(number: string, text: string): Promise<string | undefined> {
  try {
    const { data } = await api.post(`/message/sendText/${env.EVOLUTION_INSTANCE}`, {
      number,
      text,
    });
    return data?.key?.id;
  } catch (err: any) {
    logger.error({ err: err?.response?.data ?? err?.message, number }, "Falha ao enviar texto");
    return undefined;
  }
}

/** Baixa a mídia de uma mensagem (ex.: XLSX enviado pelo usuário) como Buffer. */
export async function downloadMediaBase64(messageKey: {
  remoteJid: string;
  id: string;
  fromMe: boolean;
}): Promise<Buffer | undefined> {
  try {
    const { data } = await api.post(
      `/chat/getBase64FromMediaMessage/${env.EVOLUTION_INSTANCE}`,
      { message: { key: messageKey }, convertToMp4: false }
    );
    const b64: string | undefined = data?.base64 ?? data?.media ?? data;
    if (!b64 || typeof b64 !== "string") {
      logger.error({ data }, "Resposta sem base64 ao baixar mídia");
      return undefined;
    }
    return Buffer.from(b64.replace(/^data:.*;base64,/, ""), "base64");
  } catch (err: any) {
    logger.error({ err: err?.response?.data ?? err?.message }, "Falha ao baixar mídia");
    return undefined;
  }
}

export async function sendDocument(
  number: string,
  buffer: Buffer,
  fileName: string,
  mimetype: string,
  caption?: string
): Promise<void> {
  try {
    await api.post(`/message/sendMedia/${env.EVOLUTION_INSTANCE}`, {
      number,
      mediatype: "document",
      mimetype,
      fileName,
      media: buffer.toString("base64"),
      caption,
    });
  } catch (err: any) {
    logger.error({ err: err?.response?.data ?? err?.message, number }, "Falha ao enviar documento");
    throw err;
  }
}
