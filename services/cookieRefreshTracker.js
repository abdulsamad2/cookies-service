import { CookieRefresh } from '../models/index.js';
import crypto from 'crypto';

/**
 * Input validation helper
 */
const validateInput = (refreshId, eventId = null, proxy = null) => {
  const errors = [];
  
  if (refreshId && typeof refreshId !== 'string') {
    errors.push('refreshId must be a string');
  }
  
  if (eventId && typeof eventId !== 'string') {
    errors.push('eventId must be a string');
  }
  
  if (proxy && typeof proxy !== 'string' && typeof proxy !== 'object') {
    errors.push('proxy must be a string or object');
  }
  
  return errors;
};

/**
 * Calculate exponential backoff delay for failed refreshes
 * @param {number} consecutiveFailures - Number of consecutive failures
 * @returns {number} Delay in milliseconds
 */
const calculateBackoffDelay = (consecutiveFailures) => {
  const baseDelay = 5 * 60 * 1000; // 5 minutes base
  const maxDelay = 60 * 60 * 1000; // 1 hour max
  const exponentialDelay = baseDelay * Math.pow(2, Math.min(consecutiveFailures - 1, 4));
  return Math.min(exponentialDelay, maxDelay);
};

/**
 * Enhanced Cookie Refresh Tracker with improved error handling and monitoring
 */
class CookieRefreshTracker {
  /**
   * Start tracking a new cookie refresh operation
   * @param {string} eventId - The event ID used for this refresh operation
   * @param {object} proxy - The proxy object used for this refresh
   * @param {object} metadata - Additional metadata for the refresh
   * @returns {Promise<object>} The created refresh tracking record
   */
  static async startRefresh(eventId = null, proxy = null, metadata = {}) {
    try {
      // Validate inputs
      const validationErrors = validateInput(null, eventId, proxy);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      const refreshId = crypto.randomUUID();
      const proxyString = proxy?.proxy || proxy || 'no_proxy';
      
      // Override proxy if disabled via environment variable
      if (process.env.DISABLE_PROXIES === 'true') {
        proxyString = 'no_proxy';
      }
      
      const refreshRecord = await CookieRefresh.create({
        refreshId,
        status: 'in_progress',
        eventId,
        startTime: new Date(),
        proxy: proxyString,
        metadata: {
          ...metadata,
          userAgent: metadata.userAgent || 'cookies-service/1.0',
          source: 'api'
        }
      });
      
      console.log(`Started tracking cookie refresh operation: ${refreshId}${eventId ? ` for event ${eventId}` : ''}`);
      return refreshRecord;
    } catch (error) {
      console.error('Error starting refresh tracking:', error);
      throw error;
    }
  }
  
  /**
   * Mark a refresh operation as successful
   * @param {string} refreshId - The ID of the refresh operation
   * @param {number} cookieCount - Number of cookies retrieved
   * @param {number} retryCount - Number of retries performed
   * @param {object} metadata - Additional metadata
   * @returns {Promise<object>} The updated refresh tracking record
   */
  static async markSuccess(refreshId, cookieCount = 0, retryCount = 0, metadata = {}) {
    try {
      // Validate inputs
      const validationErrors = validateInput(refreshId);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      const completionTime = new Date();
      const nextScheduledRefresh = new Date(
        completionTime.getTime() + (30 * 60 * 1000) // Default 30 minutes
      );
      
      // Use atomic update to prevent race conditions
      const refreshRecord = await CookieRefresh.findOneAndUpdate(
        { 
          refreshId,
          status: 'in_progress' // Only update if still in progress
        },
        {
          status: 'success',
          completionTime,
          nextScheduledRefresh,
          cookieCount: Math.max(0, parseInt(cookieCount) || 0),
          retryCount: Math.max(0, parseInt(retryCount) || 0),
          duration: { $subtract: [completionTime, '$startTime'] },
          metadata: { $mergeObjects: ['$metadata', metadata] },
          $setOnInsert: { consecutiveFailures: 0 }
        },
        { new: true }
      );
      
      if (!refreshRecord) {
        throw new Error('Refresh record not found or already completed');
      }
      
      console.log(`Cookie refresh completed successfully: ${refreshId} with ${cookieCount} cookies`);
      return refreshRecord;
    } catch (error) {
      console.error('Error marking refresh as successful:', error);
      throw error;
    }
  }
  
  /**
   * Mark a refresh operation as failed
   * @param {string} refreshId - The ID of the refresh operation
   * @param {string} errorMessage - Error message describing the failure
   * @param {number} retryCount - Number of retries performed
   * @param {object} metadata - Additional metadata
   * @returns {Promise<object>} The updated refresh tracking record
   */
  static async markFailed(refreshId, errorMessage, retryCount = 0, metadata = {}) {
    try {
      // Validate inputs
      const validationErrors = validateInput(refreshId);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      if (!errorMessage || typeof errorMessage !== 'string') {
        throw new Error('errorMessage must be a non-empty string');
      }

      const completionTime = new Date();
      
      // Get current record to check consecutive failures
      const currentRecord = await CookieRefresh.findOne({ refreshId });
      if (!currentRecord) {
        throw new Error('Refresh record not found');
      }
      
      const consecutiveFailures = (currentRecord.consecutiveFailures || 0) + 1;
      const backoffDelay = calculateBackoffDelay(consecutiveFailures);
      const nextScheduledRefresh = new Date(
        completionTime.getTime() + backoffDelay
      );
      
      // Use atomic update to prevent race conditions
      const refreshRecord = await CookieRefresh.findOneAndUpdate(
        { 
          refreshId,
          status: 'in_progress' // Only update if still in progress
        },
        {
          status: 'failed',
          completionTime,
          nextScheduledRefresh,
          errorMessage: errorMessage.substring(0, 500), // Limit error message length
          retryCount: Math.max(0, parseInt(retryCount) || 0),
          duration: { $subtract: [completionTime, '$startTime'] },
          metadata: { $mergeObjects: ['$metadata', metadata] },
          consecutiveFailures
        },
        { new: true }
      );
      
      if (!refreshRecord) {
        throw new Error('Refresh record not found or already completed');
      }
      
      console.log(`Cookie refresh failed: ${refreshId}, consecutive failures: ${consecutiveFailures}, next attempt: ${nextScheduledRefresh.toISOString()}`);
      return refreshRecord;
    } catch (error) {
      console.error('Error marking refresh as failed:', error);
      throw error;
    }
  }
  
  /**
   * Get statistics about cookie refresh operations
   * @param {number} limit - Number of recent operations to analyze
   * @returns {Promise<object>} Statistics about cookie refresh operations
   */
  static async getStats(limit = 100) {
    try {
      const recentRefreshes = await CookieRefresh.find()
        .sort({ startTime: -1 })
        .limit(limit);
      
      const successCount = recentRefreshes.filter(r => r.status === 'success').length;
      const failedCount = recentRefreshes.filter(r => r.status === 'failed').length;
      const inProgressCount = recentRefreshes.filter(r => r.status === 'in_progress').length;
      
      const totalCookies = recentRefreshes.reduce((sum, r) => sum + (r.cookieCount || 0), 0);
      const averageCookies = successCount > 0 ? totalCookies / successCount : 0;
      
      const completedRefreshes = recentRefreshes.filter(r => r.duration);
      const averageDuration = completedRefreshes.length > 0
        ? completedRefreshes.reduce((sum, r) => sum + r.duration, 0) / completedRefreshes.length
        : 0;
      
      const nextRefresh = await CookieRefresh.findOne({ status: 'success' })
        .sort({ nextScheduledRefresh: 1 });
      
      return {
        total: recentRefreshes.length,
        successCount,
        failedCount,
        inProgressCount,
        successRate: recentRefreshes.length > 0 
          ? (successCount / recentRefreshes.length * 100).toFixed(1) + '%' 
          : 'N/A',
        averageCookies: averageCookies.toFixed(1),
        averageDuration: averageDuration ? `${(averageDuration / 1000).toFixed(1)}s` : 'N/A',
        nextScheduledRefresh: nextRefresh?.nextScheduledRefresh || 'None scheduled',
        latestRefresh: recentRefreshes[0] || null,
        summary: {
          totalCookiesCollected: totalCookies,
          avgDurationMs: averageDuration,
          failureRate: recentRefreshes.length > 0 
            ? (failedCount / recentRefreshes.length * 100).toFixed(1) + '%' 
            : 'N/A'
        },
        health: {
          status: successCount > failedCount ? 'healthy' : 'degraded',
          lastHourSuccess: recentRefreshes.filter(r => 
            r.status === 'success' && 
            r.completionTime && 
            (Date.now() - r.completionTime.getTime()) < 60 * 60 * 1000
          ).length,
          stuckOperations: recentRefreshes.filter(r => 
            r.status === 'in_progress' && 
            (Date.now() - r.startTime.getTime()) > 30 * 60 * 1000
          ).length
        }
      };
    } catch (error) {
      console.error('Error getting refresh stats:', error);
      throw error;
    }
  }
  
  /**
   * Get refresh history with pagination
   * @param {object} options - Query options
   * @returns {Promise<object>} Paginated refresh history
   */
  static async getHistory(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        status = null,
        eventId = null,
        startDate = null,
        endDate = null
      } = options;

      const skip = (page - 1) * limit;
      
      // Build query
      const query = {};
      if (status) query.status = status;
      if (eventId) query.eventId = eventId;
      if (startDate || endDate) {
        query.startTime = {};
        if (startDate) query.startTime.$gte = new Date(startDate);
        if (endDate) query.startTime.$lte = new Date(endDate);
      }
      
      // Get total count
      const total = await CookieRefresh.countDocuments(query);
      
      // Get refreshes
      const refreshes = await CookieRefresh.find(query)
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limit);
      
      return {
        refreshes,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      };
    } catch (error) {
      console.error('Error getting refresh history:', error);
      throw error;
    }
  }

  /**
   * Clean up old refresh records
   * @param {number} maxAge - Maximum age in milliseconds
   * @returns {Promise<number>} Number of records deleted
   */
  static async cleanup(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 days default
    try {
      const cutoffDate = new Date(Date.now() - maxAge);
      const result = await CookieRefresh.deleteMany({
        startTime: { $lt: cutoffDate },
        status: { $in: ['success', 'failed'] } // Don't delete in-progress operations
      });
      
      console.log(`Cleaned up ${result.deletedCount} old refresh records`);
      return result.deletedCount;
    } catch (error) {
      console.error('Error cleaning up refresh records:', error);
      throw error;
    }
  }

  /**
   * Get stuck operations (in progress for too long)
   * @param {number} maxDurationMs - Maximum duration before considering stuck
   * @returns {Promise<Array>} Array of stuck operations
   */
  static async getStuckOperations(maxDurationMs = 30 * 60 * 1000) { // 30 minutes default
    try {
      const cutoffTime = new Date(Date.now() - maxDurationMs);
      const stuckOps = await CookieRefresh.find({
        status: 'in_progress',
        startTime: { $lt: cutoffTime }
      }).sort({ startTime: 1 });
      
      return stuckOps;
    } catch (error) {
      console.error('Error getting stuck operations:', error);
      throw error;
    }
  }

  /**
   * Reset stuck operations to failed status
   * @param {number} maxDurationMs - Maximum duration before considering stuck
   * @returns {Promise<number>} Number of operations reset
   */
  static async resetStuckOperations(maxDurationMs = 30 * 60 * 1000) {
    try {
      const cutoffTime = new Date(Date.now() - maxDurationMs);
      const result = await CookieRefresh.updateMany(
        {
          status: 'in_progress',
          startTime: { $lt: cutoffTime }
        },
        {
          status: 'failed',
          completionTime: new Date(),
          errorMessage: 'Operation timed out and was reset automatically',
          nextScheduledRefresh: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
        }
      );
      
      console.log(`Reset ${result.modifiedCount} stuck operations`);
      return result.modifiedCount;
    } catch (error) {
      console.error('Error resetting stuck operations:', error);
      throw error;
    }
  }

  /**
   * Get health status of the refresh service
   * @returns {Promise<object>} Health status information
   */
  static async getHealthStatus() {
    try {
      const now = new Date();
      const lastHour = new Date(now.getTime() - 60 * 60 * 1000);
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const [lastHourStats, last24HourStats, stuckOps, nextRefresh] = await Promise.all([
        CookieRefresh.countDocuments({ completionTime: { $gte: lastHour }, status: 'success' }),
        CookieRefresh.countDocuments({ completionTime: { $gte: last24Hours }, status: 'success' }),
        this.getStuckOperations(),
        CookieRefresh.findOne({ status: 'success' }).sort({ nextScheduledRefresh: 1 })
      ]);
      
      const isHealthy = stuckOps.length === 0 && lastHourStats > 0;
      const status = isHealthy ? 'healthy' : (stuckOps.length > 0 ? 'critical' : 'degraded');
      
      return {
        status,
        uptime: process.uptime(),
        lastHourSuccessCount: lastHourStats,
        last24HourSuccessCount: last24HourStats,
        stuckOperationsCount: stuckOps.length,
        nextScheduledRefresh: nextRefresh?.nextScheduledRefresh || null,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting health status:', error);
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export default CookieRefreshTracker;