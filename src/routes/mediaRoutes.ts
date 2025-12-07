import { Router } from "express";
import multer from "multer";
import { convertVoiceNote } from "../controllers/mediaController";

const router = Router();
const upload = multer({ dest: "uploads/" });

router.post("/convert-voice-note", upload.single("file"), convertVoiceNote);

export default router;
