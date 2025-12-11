import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import {
  updateSettings,
  add,
  report,
  listTransactions,
  getInvestments,
  addRecurring,
  searchTransactions,
  listRecurring,
} from "../controllers/financeController";

const router = Router();

router.use(authenticateToken);

router.post("/settings", updateSettings);
router.post("/transaction", add); 
router.post("/recurring", addRecurring);
router.get("/search", searchTransactions); 
router.get("/report", report);
router.get("/transactions", listTransactions);
router.get("/investments", getInvestments);
router.get("/recurring", listRecurring);

export default router;