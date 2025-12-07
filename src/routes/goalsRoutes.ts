import { Router } from "express";
import * as controller from "../controllers/goalsController";

const router = Router();

router.post("/create", controller.create);
router.post("/update-progress", controller.updateProgress); // Adiciona progresso
router.put("/:goalId", controller.updateDetails); // Atualiza detalhes/nome
router.post("/list", controller.list);
router.delete("/:goalId", controller.remove);

export default router;
