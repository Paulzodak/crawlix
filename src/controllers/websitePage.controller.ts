import { Request, Response } from "express";
import { parseWebsitePageBody } from "../parsers/websitePage.js";
import { findWebsitePage } from "../services/website/orchestrator.service.js";
import { statusForErrorCode, toApiFailure } from "../services/website/types.js";

export async function findPage(req: Request, res: Response): Promise<void> {
  try {
    const parsed = parseWebsitePageBody(req.body);
    if (!parsed.ok) {
      res.status(parsed.status).json(parsed.body);
      return;
    }

    const result = await findWebsitePage(parsed.data);
    if (!result.success) {
      res.status(statusForErrorCode(result.error.code)).json(result);
      return;
    }

    res.json(result);
  } catch (error) {
    console.error("Failed to resolve website page:", error);
    res
      .status(500)
      .json(toApiFailure("INTERNAL_ERROR", "Could not resolve the requested page"));
  }
}
