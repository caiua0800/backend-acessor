import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import {
  updateSettings,
  add,
  report,
  listTransactions,
  getInvestments,
  addRecurring, // NOVO: Importa o novo controller
} from "../controllers/financeController";

const router = Router();

// Protege tudo com Login
router.use(authenticateToken);

router.post("/settings", updateSettings);
router.post("/transaction", add); // Transação pontual
router.post("/recurring", addRecurring); // NOVO: Transação recorrente/fixa

router.get("/report", report);
router.get("/transactions", listTransactions); // GET /finance/transactions
router.get("/investments", getInvestments); // GET /finance/investments

export default router;