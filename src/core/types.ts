import { Role } from "@prisma/client";

export interface SessionState {
  phone: string;
  name?: string;
  /** Menu/perfil ativo na sessão */
  role?: Role;
  /** Tenant (Admin) ativo — para perfis ADMIN, FILIAL e MOTOBOY */
  adminId?: string;
  /** Filial vinculada (perfil FILIAL ou acesso via código) */
  branchId?: string;
  flow?: string;
  step?: string;
  /** Dados temporários do fluxo atual */
  data: Record<string, any>;
  /** Histórico de etapas para o comando "0" (voltar) */
  stack: Array<{ flow: string; step: string }>;
}

export interface IncomingDocument {
  fileName: string;
  mimetype: string;
  /** Chave da mensagem, para baixar a mídia na Evolution */
  messageKey: { remoteJid: string; id: string; fromMe: boolean };
}

export interface IncomingMessage {
  /** Telefone somente dígitos (ex: 5511999998888) */
  phone: string;
  pushName?: string;
  text: string;
  /** id (stanzaId) da mensagem citada, quando for uma resposta */
  quotedId?: string;
  messageId: string;
  /** Documento anexado (ex.: XLSX para importação) */
  document?: IncomingDocument;
}

export interface Ctx {
  msg: IncomingMessage;
  session: SessionState;
  reply(text: string): Promise<string | undefined>;
  save(): Promise<void>;
}
