import { Request, Response } from "express";
import { parseRenderBody } from "../parsers/pdf.js";
import { renderHtmlDocument } from "../services/pdf/render.service.js";

export async function renderPdfOrImage(req: Request, res: Response): Promise<void> {
  const parsed = parseRenderBody(req.body);
  if (!parsed.ok) {
    res.status(parsed.status).json(parsed.body);
    return;
  }

  try {
    const rendered = await renderHtmlDocument(parsed.data);
    res.setHeader("Content-Type", rendered.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${rendered.filename.replace(/"/g, "%22")}"`,
    );
    res.send(rendered.body);
  } catch (error) {
    console.error("PDF/image render error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to render",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}
