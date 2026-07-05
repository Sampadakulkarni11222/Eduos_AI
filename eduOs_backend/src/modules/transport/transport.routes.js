import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import * as controller from './transport.controller.js';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Transport
 *   description: Transport management (routes, stops, bus enrollment)
 */

router.get('/routes', controller.listRoutes);
router.post('/routes', controller.createRoute);

router.get('/routes/:routeId/stops', controller.listStops);
router.post('/stops', controller.createStop);

router.get('/my-bus', controller.myBus);
router.post('/enroll', controller.enrollStudent);

export default router;
