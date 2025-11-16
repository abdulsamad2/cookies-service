import express from 'express';
import { getCookies } from '../controllers/cookieController.js';

const router = express.Router();

/**
 * @route GET /api/v1/cookies
 * @desc Single endpoint for downstream systems to get cookies
 * @query {string} domain - Filter by domain (default: ticketmaster.com)
 * @query {number} limit - Number of cookies to return (default: 1)
 * @returns {object} { success, tmpt, expiry, total, cookieId, quality }
 */
router.get('/', getCookies);

export default router;