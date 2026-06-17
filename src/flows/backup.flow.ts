import { registerFlow } from "../core/engine";
import { Ctx } from "../core/types";
import { downloadMediaBase64, sendDocument } from "../services/evolution.service";
import { BACKUP_MIMETYPE, exportBackup, importBackup } from "../services/backup.service";
import { dayjs, normalize } from "../utils/format";
import { env } from "../config/env";
import { showMainMenu } from "./menu";
import { NAV_FOOTER } from "./common";

registerFlow("backup", {
  menu: {
    prompt: (ctx) =>
      ctx.reply(
        "💾 *BACKUP*\n\n" +
          "1️⃣ Exportar (baixar arquivo de backup)\n" +
          "2️⃣ Restaurar (enviar um arquivo de backup)\n\n" +
          `Digite a opção.\n${NAV_FOOTER}`
      ),
    handle: async (ctx, text) => {
      switch (normalize(text)) {
        case "1":
          return exportar(ctx);
        case "2":
          return goToAguardando(ctx);
        default:
          return ctx.reply("Digite *1* (exportar) ou *2* (restaurar).");
      }
    },
  },

  aguardando: {
    prompt: (ctx) =>
      ctx.reply(
        "📥 *RESTAURAR BACKUP*\n\n" +
          "⚠️ Isto vai *APAGAR os dados atuais* e recriar a partir do arquivo.\n\n" +
          "Envie o *arquivo .json* de backup aqui, ou *0* para cancelar."
      ),
    handle: (ctx, text) => {
      if (normalize(text) === "0") return showMainMenu(ctx);
      return ctx.reply("📎 Envie o *arquivo .json* de backup, ou *0* para cancelar.");
    },
  },
});

async function goToAguardando(ctx: Ctx): Promise<void> {
  ctx.session.flow = "backup";
  ctx.session.step = "aguardando";
  await ctx.save();
  const { getStep } = await import("../core/engine");
  await getStep("backup", "aguardando")!.prompt(ctx);
}

async function exportar(ctx: Ctx): Promise<void> {
  await ctx.reply("⏳ Gerando backup...");
  const { buffer, counts } = await exportBackup();
  const stamp = dayjs().tz(env.TZ).format("YYYYMMDD_HHmm");
  await sendDocument(ctx.msg.phone, buffer, `backup_${stamp}.json`, BACKUP_MIMETYPE, "💾 Backup do sistema");
  await ctx.reply(
    `✅ Backup enviado.\n📊 ${counts.admins} admin(s) · ${counts.filiais} filial(is) · ` +
      `${counts.usuarios} usuário(s) · ${counts.pedidos} pedido(s).\n\nGuarde esse arquivo em local seguro.`
  );
  return showMainMenu(ctx);
}

/** Processa um documento .json recebido para restaurar o backup. */
export async function processBackupDocument(ctx: Ctx): Promise<void> {
  const doc = ctx.msg.document!;
  const isJson = /\.json$/i.test(doc.fileName) || /json/i.test(doc.mimetype);
  if (!isJson) {
    await ctx.reply("⚠️ Envie o arquivo *.json* de backup (o mesmo que foi exportado).");
    return;
  }
  await ctx.reply("⏳ Restaurando backup... (pode levar um tempo)");
  const buffer = await downloadMediaBase64(doc.messageKey);
  if (!buffer) {
    await ctx.reply("❌ Não consegui baixar o arquivo. Tente reenviar.");
    return;
  }
  const res = await importBackup(buffer);
  await ctx.reply(res.ok ? `✅ ${res.msg}` : `❌ ${res.msg}`);
  return showMainMenu(ctx);
}
