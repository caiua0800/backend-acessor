import { Router } from 'express';
import { verifyWebhook, processWebhook } from '../controllers/whatsappController';

const router = Router();

// VOLTE PARA '/' AQUI
router.get('/', verifyWebhook); 
router.post('/', processWebhook);

export default router;