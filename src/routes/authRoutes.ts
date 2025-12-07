import { Router } from "express";
import { connect, callback } from "../controllers/authController";

const router = Router();
router.get("/connect", connect);
router.get("/callback", callback);
export default router;
