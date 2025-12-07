import { Router } from "express";
import * as controller from "../controllers/ideaController";

const router = Router();

router.post("/create", controller.create);
router.post("/list", controller.list); // Usando POST para enviar wa_id no corpo
router.put("/:ideaId", controller.update);
router.delete("/clear", controller.clear);
router.delete("/:ideaId", controller.remove);

export default router;
