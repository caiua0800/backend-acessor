import { Router } from 'express';
import { verifyWebhook, processWebhook, processWebhookDev } from '../controllers/whatsappController';

const router = Router();

// VOLTE PARA '/' AQUI
router.get('/', verifyWebhook); 
router.post('/', processWebhook);
router.post('/dev', processWebhookDev);

export default router;