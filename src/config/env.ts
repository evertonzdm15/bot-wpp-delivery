import "dotenv/config";
import { canonicalBrazil } from "../utils/phone";

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return v;
}

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  NODE_ENV: process.env.NODE_ENV ?? "development",
  DATABASE_URL: req("DATABASE_URL"),
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  EVOLUTION_API_URL: req("EVOLUTION_API_URL", "https://api.grupodm.site"),
  EVOLUTION_INSTANCE: req("EVOLUTION_INSTANCE", "GRUPODM"),
  EVOLUTION_API_KEY: req("EVOLUTION_API_KEY"),
  WEBHOOK_TOKEN: process.env.WEBHOOK_TOKEN ?? "",
  // Atalho de teste: código que libera os 4 perfis. VAZIO = desligado (use em produção).
  BOT_TEST_CODE: process.env.BOT_TEST_CODE ?? "1234",
  // Código (senha) pessoal do Super Admin, criado no boot se SUPER_ADMIN_PHONE estiver definido
  SUPER_ADMIN_CODE: process.env.SUPER_ADMIN_CODE ?? "9000",
  SUPER_ADMIN_PHONE: canonicalBrazil(process.env.SUPER_ADMIN_PHONE ?? ""),
  SLA_RAPIDA_R6_MIN: Number(process.env.SLA_RAPIDA_R6_MIN ?? 40),
  SLA_RAPIDA_MIN: Number(process.env.SLA_RAPIDA_MIN ?? 90),
  ALERTA_ANTECEDENCIA_MIN: Number(process.env.ALERTA_ANTECEDENCIA_MIN ?? 15),
  TZ: process.env.TZ ?? "America/Sao_Paulo",
};
