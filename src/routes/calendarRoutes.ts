import { Router } from 'express';
import { createCalendarEvent, checkCalendarAvailability, listCalendarEvents, deleteCalendarEvent, search } from '../controllers/calendarController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.post('/create', createCalendarEvent);
router.post('/check', checkCalendarAvailability);
router.post('/list', listCalendarEvents);
router.post('/delete', deleteCalendarEvent);
router.get('/search', search);

export default router;