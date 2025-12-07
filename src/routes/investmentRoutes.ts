import { Router } from 'express';
import { add, list } from '../controllers/investmentController';

const router = Router();

router.post('/add', add);
router.post('/list', list); 

export default router;