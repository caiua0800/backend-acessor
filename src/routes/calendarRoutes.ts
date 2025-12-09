import { Router } from 'express';
import { createCalendarEvent, checkCalendarAvailability, listCalendarEvents, deleteCalendarEvent } from '../controllers/calendarController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.post('/create', createCalendarEvent);
router.post('/check', checkCalendarAvailability);
router.post('/list', listCalendarEvents);
router.post('/delete', deleteCalendarEvent);
export default router;