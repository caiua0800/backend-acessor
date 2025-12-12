import { Router } from "express";
import { handleRiscEvent } from "../controllers/riscController";

const router = Router();

// Endpoint que o Google vai chamar
// POST /auth/risc
router.post("/events", handleRiscEvent);

export default router;
