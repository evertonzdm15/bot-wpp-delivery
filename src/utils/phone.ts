export function onlyDigits(text: string): string {
  return text.replace(/\D/g, "");
}

/**
 * Normaliza números brasileiros para o formato canônico de 13 dígitos
 * (55 + DDD + 9 + 8 dígitos), inserindo o "nono dígito" quando ausente.
 *
 * A Evolution API frequentemente entrega JIDs de celular sem o 9
 * (ex.: 554196789580). Sem isso, o número do remetente não bateria com o
 * cadastro (5541996789580). Números não-brasileiros ou landlines ficam intactos.
 */
export function canonicalBrazil(input: string): string {
  const d = onlyDigits(input);

  // 55 + DDD(2) + 8 dígitos (celular legado sem o 9) -> insere o 9
  if (d.length === 12 && d.startsWith("55")) {
    const subscriber = d.slice(4);
    if (/^[6-9]/.test(subscriber)) {
      return `${d.slice(0, 4)}9${subscriber}`;
    }
  }

  // DDD(2) + 8 dígitos (sem DDI, celular legado) -> 55 + DDD + 9 + 8
  if (d.length === 10 && /^[1-9]/.test(d) && /^[6-9]/.test(d.slice(2))) {
    return `55${d.slice(0, 2)}9${d.slice(2)}`;
  }

  // DDD(2) + 9 dígitos (sem DDI) -> acrescenta DDI
  if (d.length === 11 && /^[1-9]/.test(d)) {
    return `55${d}`;
  }

  return d;
}

/** "5511999998888@s.whatsapp.net" -> "5511999998888" (normalizado) */
export function jidToPhone(jid: string): string {
  return canonicalBrazil(jid.split("@")[0] ?? "");
}

export function isValidPhone(text: string): boolean {
  const d = onlyDigits(text);
  return d.length >= 10 && d.length <= 15;
}
