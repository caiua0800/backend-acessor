import { Router } from "express";
import * as controller from "../controllers/docsController";
const router = Router();
router.post("/create", controller.create);
router.post("/read", controller.read);
router.post("/append", controller.append);
export default router;
