import { goTo, registerFlow } from "../core/engine";
import { Ctx } from "../core/types";
import { normalize } from "../utils/format";
import { sendText } from "../services/evolution.service";
import { adminPhones, createRequest, RequestKind } from "../services/registration.service";
import { entry } from "./menu";

interface Invite {
  adminId: string;
  adminName: string;
}

function invite(ctx: Ctx): Invite {
  return ctx.session.data.invite;
}

function kindLabel(kind: RequestKind): string {
  return kind === "CLIENTE" ? "🏪 Loja/Cliente" : "🛵 Motoboy";
}

registerFlow("cadastro", {
  tipo: {
    prompt: (ctx) =>
      ctx.reply(
        `🤝 *Cadastro — ${invite(ctx).adminName}*\n\n` +
          "Você quer se cadastrar como:\n\n" +
          "1️⃣ 🏪 Loja / Cliente (faz pedidos)\n" +
          "2️⃣ 🛵 Motoboy (faz entregas)\n\n" +
          "Digite *1* ou *2*:"
      ),
    handle: async (ctx, text) => {
      const t = normalize(text);
      if (t === "1") ctx.session.data.regKind = "CLIENTE";
      else if (t === "2") ctx.session.data.regKind = "MOTOBOY";
      else return ctx.reply("Digite *1* (Loja/Cliente) ou *2* (Motoboy).");
      return goTo(ctx, "cadastro", "nome");
    },
  },

  nome: {
    prompt: (ctx) =>
      ctx.reply(
        ctx.session.data.regKind === "CLIENTE"
          ? "🏪 Qual o *nome da loja*?"
          : "👤 Qual o seu *nome completo*?"
      ),
    handle: async (ctx, text) => {
      if (!text.trim()) return ctx.reply("Digite um nome válido.");
      ctx.session.data.regName = text.trim();
      if (ctx.session.data.regKind === "CLIENTE") return goTo(ctx, "cadastro", "extra");
      return finalizar(ctx);
    },
  },

  extra: {
    // O passo roda antes da autenticação, onde o router não aplica o "9 pula";
    // por isso tratamos o "9" explicitamente aqui.
    prompt: (ctx) => ctx.reply("📍 *Endereço* da loja (ou digite *9* para pular):"),
    handle: async (ctx, text) => {
      const t = text.trim();
      ctx.session.data.regExtra = !t || t === "9" ? undefined : t;
      return finalizar(ctx);
    },
  },
});

/** Cria a solicitação, avisa o solicitante e notifica os admins do tenant. */
async function finalizar(ctx: Ctx): Promise<void> {
  const { adminId, adminName } = invite(ctx);
  const kind = ctx.session.data.regKind as RequestKind;
  const name = ctx.session.data.regName as string;
  const extra = ctx.session.data.regExtra as string | undefined;
  const phone = ctx.msg.phone;

  const { duplicate } = await createRequest({ adminId, kind, name, phone, extra });

  if (duplicate) {
    await ctx.reply(
      "ℹ️ Você já tem uma solicitação *pendente*. Aguarde a aprovação do administrador."
    );
  } else {
    await ctx.reply(
      "✅ *Solicitação enviada!*\n\n" +
        `Seu cadastro como *${kindLabel(kind)}* foi enviado para *${adminName}*.\n` +
        "Você receberá uma mensagem aqui assim que for aprovado. 🙌"
    );
    const aviso =
      "🔔 *Nova solicitação de cadastro*\n\n" +
      `${kindLabel(kind)}: *${name}*\n` +
      `📱 ${phone}` +
      (extra ? `\n📍 ${extra}` : "") +
      "\n\nAbra *Admin → Solicitações de cadastro* para aprovar ou recusar.";
    for (const p of await adminPhones(adminId)) await sendText(p, aviso);
  }

  // Encerra o cadastro e volta à tela de identificação.
  ctx.session.data = {};
  return entry(ctx);
}
