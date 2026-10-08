import { Request, Response } from "express";
import PDFDocument from "pdfkit";
import { prisma } from "../../lib/prisma";
import { scope } from "../../middleware/storeScope";

/**
 * KNOWN LIMITATION: pdfkit has no Arabic text-shaping/bidi engine built in
 * — Arabic glyphs won't join correctly (letters render disconnected) and
 * right-to-left ordering isn't handled automatically. This works fine for
 * the numeric/Latin content (invoice #, amounts, dates), but Arabic
 * product/customer names will look broken in the generated PDF as-is.
 *
 * The proper fix is either (a) embed a shaped-text library
 * (`arabic-reshaper` + `bidi-js`) and pre-process every Arabic string
 * before drawing it, or (b) switch this endpoint to render an HTML
 * template through a headless browser (Puppeteer/Playwright), which
 * handles Arabic shaping natively via the browser's text engine — heavier
 * dependency, but correct with zero manual reshaping. Flagging this now
 * rather than shipping PDFs that silently mis-render Arabic.
 */
export async function getSalePdf(req: Request, res: Response) {
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, ...scope(req) }, include: { items: true } });
  if (!sale) return res.status(404).json({ error: "Sale not found" });

  const store = await prisma.store.findFirst({
    where: { id: req.auth?.storeId ?? "", tenantId: req.auth?.tenantId ?? undefined },
  });
  const productIds = sale.items.map((i) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const nameById = new Map(products.map((p) => [p.id, p.name]));

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="invoice-${sale.invoiceNumber}.pdf"`);

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);

  doc.fontSize(18).text(store?.name || "Cashiri", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Invoice #${sale.invoiceNumber}`, { align: "center" });
  doc.fontSize(9).fillColor("#555").text(sale.createdAt.toISOString(), { align: "center" });
  doc.moveDown(1);
  doc.fillColor("#000");

  doc.fontSize(10);
  sale.items.forEach((item) => {
    const name = nameById.get(item.productId) || item.productId;
    doc.text(`${name}   x${item.quantity.toString()}   @ ${item.unitPrice.toString()}   = ${item.total.toString()} SDG`);
  });

  doc.moveDown(1);
  doc.fontSize(10).text(`Subtotal: ${sale.subtotal.toString()} SDG`);
  doc.text(`Discount: ${sale.discount.toString()} SDG`);
  doc.text(`Tax: ${sale.taxAmount.toString()} SDG`);
  doc.fontSize(13).text(`Total: ${sale.total.toString()} SDG`, { underline: true });

  doc.end();
}
