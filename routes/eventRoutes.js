import express from 'express';
import EventController from '../controllers/eventController.js';

const router = express.Router();

// Event Management Routes
router.post('/events', EventController.createEvent);
router.get('/events', EventController.getEvents);
router.post('/events/bulk', EventController.bulkCreateEvents);
router.get('/events/stats', EventController.getEventStats);

// Pool Management Routes
router.post('/pool/start', EventController.startPool);
router.post('/pool/stop', EventController.stopPool);
router.get('/pool/stats', EventController.getPoolStats);
router.put('/pool/config', EventController.updatePoolConfig);
router.post('/pool/cleanup', EventController.cleanup);

// Cookie Distribution Routes
router.get('/pool/cookies/fresh', EventController.getFreshCookies);

export default router;