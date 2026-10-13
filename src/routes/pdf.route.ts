import { Router } from "express";
import { renderPdfOrImage } from "../controllers/pdf.controller.js";

const router = Router();

router.post("/api/pdf/render", renderPdfOrImage);

export default router;
