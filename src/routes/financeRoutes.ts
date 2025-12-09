import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import {
  updateSettings,
  add,
  report,
  listTransactions,
  getInvestments,
} from "../controllers/financeController";

const router = Router();

// Protege tudo com Login
router.use(authenticateToken);

router.post("/settings", updateSettings);
router.post("/transaction", add); // ou só "/" se preferir
router.get("/report", report);
router.get("/transactions", listTransactions); // GET /finance/transactions
router.get("/investments", getInvestments); // GET /finance/investments

export default router;
