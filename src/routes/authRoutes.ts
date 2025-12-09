import { Router } from "express";
import { connect, callback, login, refreshToken, logout } from "../controllers/authController";

const router = Router();
router.get("/connect", connect);
router.get("/callback", callback);
router.post("/login", login);
router.post("/refresh", refreshToken);
router.post("/logout", logout);
export default router;
