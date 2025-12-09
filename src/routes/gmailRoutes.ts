import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import { listEmails, readEmail } from "../controllers/gmailController";

const router = Router();

// Protege todas as rotas
router.use(authenticateToken);

// LISTAR EMAILS: GET /gmail/list?query=
router.get("/list", listEmails);

// LER UM EMAIL: GET /gmail/read/:messageId
router.get("/read/:messageId", readEmail);

export default router;
