import { registerFlow } from "../core/engine";
import { Ctx } from "../core/types";
import { downloadMediaBase64, sendDocument } from "../services/evolution.service";
import { generateTemplate, importTasks, XLSX_MIMETYPE } from "../services/import.service";
import { normalize } from "../utils/format";
import { showMainMenu } from "./menu";
import { NAV_FOOTER } from "./common";

registerFlow("import", {
  aguardando: {
    prompt: async (ctx) => {
      const tpl = await generateTemplate();
      await sendDocument(ctx.msg.phone, tpl, "modelo_importacao.xlsx", XLSX_MIMETYPE, "📄 Modelo de importação");
      return ctx.reply(
        "📥 *IMPORTAR PEDIDOS (XLSX)*\n\n" +
          "1) Preencha o modelo acima (uma linha por pedido).\n" +
          "2) Colunas: *Tipo, Cliente, Telefone, Endereço, Itens, Horário, TRs*.\n" +
          "   • Itens e TRs: separe por *;*\n" +
          "   • Horário: só para tipos *programados* (ex: 25/12 09:00)\n" +
          "3) *Envie o arquivo .xlsx aqui* nesta conversa.\n\n" +
          "_(0 cancela)_"
      );
    },
    handle: (ctx, text) => {
      if (normalize(text) === "0") return showMainMenu(ctx);
      return ctx.reply("📎 Envie o *arquivo .xlsx* preenchido aqui, ou *0* para cancelar.");
    },
  },
});

/** Processa um documento recebido enquanto a sessão aguarda importação. */
export async function processImportDocument(ctx: Ctx): Promise<void> {
  const doc = ctx.msg.document!;
  const isXlsx =
    /\.xlsx$/i.test(doc.fileName) || /spreadsheet|excel|officedocument/i.test(doc.mimetype);
  if (!isXlsx) {
    await ctx.reply("⚠️ Envie um arquivo *.xlsx* (use o modelo enviado).");
    return;
  }
  await ctx.reply("⏳ Lendo a planilha e criando os pedidos...");
  const buffer = await downloadMediaBase64(doc.messageKey);
  if (!buffer) {
    await ctx.reply("❌ Não consegui baixar o arquivo. Tente reenviar.");
    return;
  }
  const res = await importTasks(buffer, {
    adminId: ctx.session.adminId!,
    branchId: ctx.session.branchId!,
    createdByPhone: ctx.msg.phone,
    createdByName: ctx.msg.pushName,
  });

  const lines = [`✅ *${res.created}* pedido(s) criado(s).`];
  if (res.codes.length) lines.push(`Códigos: ${res.codes.map((c) => `#${c}`).join(", ")}`);
  if (res.errors.length) {
    lines.push(`\n⚠️ ${res.errors.length} linha(s) com problema:`);
    lines.push(res.errors.slice(0, 15).join("\n"));
  }
  await ctx.reply(lines.join("\n"));
  return showMainMenu(ctx);
}
