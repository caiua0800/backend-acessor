import { Router } from "express";
import { sendTestTemplate } from "../controllers/testController";

const router = Router();

// POST http://localhost:3000/test/send-utility
router.post("/send-utility", sendTestTemplate);

export default router;
