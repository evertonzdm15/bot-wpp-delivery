import ExcelJS from "exceljs";
import { TaskFull } from "./task.service";
import { fmtDateTime, finishReasonLabel, statusLabel } from "../utils/format";

export const XLSX_MIMETYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function exportTasksXlsx(tasks: TaskFull[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bot Delivery Grupo DM";
  const ws = wb.addWorksheet("Pedidos");

  ws.columns = [
    { header: "Código", key: "code", width: 10 },
    { header: "Tipo", key: "type", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Filial", key: "branch", width: 22 },
    { header: "Cliente", key: "client", width: 24 },
    { header: "Telefone", key: "phone", width: 16 },
    { header: "Endereço", key: "address", width: 40 },
    { header: "Itens", key: "items", width: 40 },
    { header: "TRs", key: "trs", width: 40 },
    { header: "Qtd TR", key: "trCount", width: 8 },
    { header: "Obs", key: "notes", width: 24 },
    { header: "Motoboy", key: "motoboy", width: 20 },
    { header: "Resultado", key: "result", width: 16 },
    { header: "Criado em", key: "createdAt", width: 14 },
    { header: "Limite", key: "dueAt", width: 14 },
    { header: "Atribuído em", key: "assignedAt", width: 14 },
    { header: "Finalizado em", key: "finishedAt", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const t of tasks) {
    ws.addRow({
      code: t.code,
      type: t.typeName,
      status: statusLabel(t.status).replace(/^\S+\s/, ""),
      branch: t.branch.name,
      client: t.clientName ?? "",
      phone: t.clientPhone ?? "",
      address: t.address ?? "",
      items: t.items.map((i) => i.description).join("; "),
      trs: t.trItems.join(" | "),
      trCount: t.trItems.length,
      notes: t.notes ?? "",
      motoboy: t.motoboy?.name ?? t.motoboy?.phone ?? "",
      result: t.finishReason ? finishReasonLabel(t.finishReason).replace(/^\S+\s/, "") : "",
      createdAt: fmtDateTime(t.createdAt),
      dueAt: fmtDateTime(t.dueAt),
      assignedAt: fmtDateTime(t.assignedAt),
      finishedAt: fmtDateTime(t.finishedAt),
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
