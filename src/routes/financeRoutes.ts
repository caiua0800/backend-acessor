import { Router } from "express";
import { updateSettings, add, report } from "../controllers/financeController";
const router = Router();
router.post("/settings", updateSettings);
router.post("/add", add);
router.post("/report", report);
export default router;
