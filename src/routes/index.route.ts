import { Request, Response, Router } from "express";
import pdfRoutes from "./pdf.route.js";
import websitePageRoutes from "./websitePage.route.js";

const router = Router();

function health(_req: Request, res: Response): void {
  res.json({ status: "ok" });
}

router.get("/", health);
router.get("/health", health);
router.use(websitePageRoutes);
router.use(pdfRoutes);

export default router;
