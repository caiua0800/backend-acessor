import { Router } from "express";
import * as controller from "../controllers/driveController";
const router = Router();
router.post("/delete", controller.deleteDriveFile);
router.post("/list", controller.listDriveFiles);
export default router;