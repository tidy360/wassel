import { Response } from "express";
import ExcelJS from "exceljs";

/**
 * Streams a flat array of objects as an .xlsx download. Column headers are
 * taken from the keys of the first row — pass pre-shaped, flat rows (no
 * nested objects/arrays), e.g. `sales.map(s => ({ "رقم الفاتورة": s.invoiceNumber, ... }))`.
 */
export async function sendAsExcel(res: Response, fileName: string, rows: Record<string, unknown>[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Report", { views: [{ rightToLeft: true }] });

  if (rows.length > 0) {
    sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key, width: 20 }));
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}
