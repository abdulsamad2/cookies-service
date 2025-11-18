import express from 'express';
import {
  getCookieRefreshStats,
  getRecentRefreshes,
  startRefresh,
  completeRefresh,
  getRefreshDetails,
  checkRefreshStatus,
  getHealthStatus,
  getStuckOperations,
  resetStuckOperations,
  cleanupRefreshHistory
} from '../controllers/cookieRefreshController.js';

const router = express.Router();

/**
 * @route GET /api/v1/refresh/stats
 * @desc Get statistics about cookie refresh operations
 * @query {number} limit - Number of recent operations to analyze
 */
router.get('/stats', getCookieRefreshStats);

/**
 * @route GET /api/v1/refresh/history
 * @desc Get refresh history with pagination and filtering
 * @query {number} page - Page number
 * @query {number} limit - Items per page
 * @query {string} status - Filter by status
 * @query {string} eventId - Filter by event ID
 * @query {string} startDate - Filter from start date
 * @query {string} endDate - Filter to end date
 */
router.get('/history', getRecentRefreshes);

/**
 * @route GET /api/v1/refresh/status
 * @desc Check if a cookie refresh is due
 */
router.get('/status', checkRefreshStatus);

/**
 * @route POST /api/v1/refresh/start
 * @desc Start a new cookie refresh operation
 * @body {string} eventId - Event ID for the refresh
 * @body {string} proxy - Proxy used for refresh
 * @body {object} metadata - Additional metadata
 */
router.post('/start', startRefresh);

/**
 * @route PUT /api/v1/refresh/:refreshId/complete
 * @desc Mark a refresh operation as completed
 * @param {string} refreshId - Refresh operation ID
 * @body {boolean} success - Whether the refresh was successful
 * @body {number} cookieCount - Number of cookies retrieved
 * @body {number} retryCount - Number of retries performed
 * @body {string} errorMessage - Error message if failed
 * @body {object} metadata - Additional metadata
 */
router.put('/:refreshId/complete', completeRefresh);

/**
 * @route GET /api/v1/refresh/:refreshId
 * @desc Get details of a specific refresh operation
 * @param {string} refreshId - Refresh operation ID
 */
router.get('/:refreshId', getRefreshDetails);

/**
 * @route GET /api/v1/refresh/health
 * @desc Get health status of the cookie refresh service
 */
router.get('/health', getHealthStatus);

/**
 * @route GET /api/v1/refresh/stuck
 * @desc Get stuck operations
 * @query {number} maxDuration - Maximum duration in minutes
 */
router.get('/stuck', getStuckOperations);

/**
 * @route POST /api/v1/refresh/reset-stuck
 * @desc Reset stuck operations
 * @query {number} maxDuration - Maximum duration in minutes
 */
router.post('/reset-stuck', resetStuckOperations);

/**
 * @route POST /api/v1/refresh/cleanup
 * @desc Clean up old refresh records
 * @query {number} maxAge - Maximum age in days
 */
router.post('/cleanup', cleanupRefreshHistory);

export default router;