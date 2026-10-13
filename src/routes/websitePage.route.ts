import { Router } from "express";
import { findPage } from "../controllers/websitePage.controller.js";

const router = Router();

router.post("/api/website/page", findPage);

export default router;
