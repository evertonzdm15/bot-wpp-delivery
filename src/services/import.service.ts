import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";
import { createAndDispatch } from "./task.service";
import { normalize, parseDateTime } from "../utils/format";
import { XLSX_MIMETYPE } from "./export.service";

export { XLSX_MIMETYPE };

const HEADERS = ["Tipo", "Cliente", "Telefone", "Endereço", "Itens", "Horário", "TRs"];

/** Gera um arquivo-modelo de importação com cabeçalho + exemplo. */
export async function generateTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Pedidos");
  ws.columns = HEADERS.map((h) => ({ header: h, key: h, width: 26 }));
  ws.getRow(1).font = { bold: true };
  ws.addRow([
    "Rápida R6",
    "Maria Souza",
    "41999998888",
    "Rua das Flores, 120 - Centro",
    "Dipirona 1g; Soro fisiológico",
    "",
    "Buscar receita na Filial Centro; Levar troco",
  ]);
  ws.addRow([
    "Programada",
    "João Pereira",
    "",
    "Av. Brasil, 900",
    "Amoxicilina 500mg",
    "25/12 09:00",
    "",
  ]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export interface ImportResult {
  created: number;
  codes: number[];
  errors: string[];
}

function cellStr(v: any): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.text) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.richText) return v.richText.map((r: any) => r.text).join("");
  }
  return String(v).trim();
}

function splitList(s: string): string[] {
  return s
    .split(/[;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Lê o XLSX e cria os pedidos para a filial. Retorna resumo. */
export async function importTasks(
  buffer: Buffer,
  opts: { adminId: string; branchId: string; createdByPhone: string; createdByName?: string }
): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  if (!ws) return { created: 0, codes: [], errors: ["Planilha vazia."] };

  // Mapeia cabeçalhos -> coluna
  const col: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, c) => {
    col[normalize(cellStr(cell.value))] = c;
  });
  const get = (row: ExcelJS.Row, names: string[]): string => {
    for (const n of names) if (col[n]) return cellStr(row.getCell(col[n]).value);
    return "";
  };

  const types = await prisma.deliveryType.findMany({
    where: { branchId: opts.branchId, active: true },
  });
  const typeByName = new Map(types.map((t) => [normalize(t.name), t]));

  const result: ImportResult = { created: 0, codes: [], errors: [] };

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const tipo = get(row, ["tipo"]);
    const cliente = get(row, ["cliente"]);
    const endereco = get(row, ["endereco", "endereço"]);
    if (!tipo && !cliente && !endereco) continue; // linha vazia

    const type = typeByName.get(normalize(tipo));
    if (!type) {
      result.errors.push(`Linha ${r}: tipo "${tipo}" não encontrado.`);
      continue;
    }
    if (!cliente) {
      result.errors.push(`Linha ${r}: cliente vazio.`);
      continue;
    }
    if (!endereco) {
      result.errors.push(`Linha ${r}: endereço vazio.`);
      continue;
    }
    const itens = splitList(get(row, ["itens", "items"]));
    if (!itens.length) {
      result.errors.push(`Linha ${r}: sem itens.`);
      continue;
    }
    const trItems = splitList(get(row, ["trs", "tr", "transferencias"]));

    let scheduledAt: Date | undefined;
    if (type.scheduled) {
      const h = get(row, ["horario", "horário"]);
      const d = parseDateTime(h);
      if (!d) {
        result.errors.push(`Linha ${r}: horário inválido p/ tipo programado ("${h}").`);
        continue;
      }
      scheduledAt = d;
    }

    try {
      const { task } = await createAndDispatch({
        adminId: opts.adminId,
        branchId: opts.branchId,
        createdByPhone: opts.createdByPhone,
        createdByName: opts.createdByName,
        deliveryTypeId: type.id,
        typeName: type.name,
        slaMin: type.slaMin,
        scheduled: type.scheduled,
        scheduledAt,
        clientName: cliente,
        clientPhone: get(row, ["telefone", "fone"]) || undefined,
        address: endereco,
        items: itens,
        trItems,
      });
      result.created++;
      result.codes.push(task.code);
    } catch (e: any) {
      result.errors.push(`Linha ${r}: erro ao criar (${e?.message ?? e}).`);
    }
  }

  return result;
}
