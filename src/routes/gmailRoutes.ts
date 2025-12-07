import { Router } from "express";
import { list, read } from "../controllers/gmailController";

const router = Router();
router.post("/list", list);
router.post("/read", read);
export default router;
