import { Request, Response, Router } from "express";
import websitePageRoutes from "./websitePage.route.js";

const router = Router();

function health(_req: Request, res: Response): void {
  res.json({ status: "ok" });
}

router.get("/", health);
router.get("/health", health);
router.use(websitePageRoutes);

export default router;
