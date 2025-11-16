import { CookieRefresh } from '../models/index.js';
import crypto from 'crypto';

/**
 * Enhanced Cookie Refresh Tracker for standalone service
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
      const refreshId = crypto.randomUUID();
      const proxyString = proxy?.proxy || proxy || 'no_proxy';
      
      const refreshRecord = await CookieRefresh.create({
        refreshId,
        status: 'in_progress',
        eventId,
        startTime: new Date(),
        proxy: proxyString,
        metadata
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
      const completionTime = new Date();
      const nextScheduledRefresh = new Date(
        completionTime.getTime() + (30 * 60 * 1000) // Default 30 minutes
      );
      
      const startRecord = await CookieRefresh.findOne({ refreshId });
      const duration = startRecord ? completionTime - startRecord.startTime : null;
      
      const refreshRecord = await CookieRefresh.findOneAndUpdate(
        { refreshId },
        {
          status: 'success',
          completionTime,
          nextScheduledRefresh,
          cookieCount,
          retryCount,
          duration,
          metadata: { ...startRecord?.metadata, ...metadata }
        },
        { new: true }
      );
      
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
      const completionTime = new Date();
      // Schedule next attempt sooner if it failed
      const nextScheduledRefresh = new Date(
        completionTime.getTime() + (5 * 60 * 1000) // 5 minutes for failures
      );
      
      const startRecord = await CookieRefresh.findOne({ refreshId });
      const duration = startRecord ? completionTime - startRecord.startTime : null;
      
      const refreshRecord = await CookieRefresh.findOneAndUpdate(
        { refreshId },
        {
          status: 'failed',
          completionTime,
          nextScheduledRefresh,
          errorMessage,
          retryCount,
          duration,
          metadata: { ...startRecord?.metadata, ...metadata }
        },
        { new: true }
      );
      
      console.log(`Cookie refresh failed: ${refreshId}, next attempt: ${nextScheduledRefresh.toISOString()}`);
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
          avgDurationMs: averageDuration
        }
      };
    } catch (error) {
      console.error('Error getting refresh stats:', error);
      throw error;
    }
  }
  
  /**
   * Check if a refresh is due
   * @returns {Promise<boolean>} Whether a refresh is due
   */
  static async isRefreshDue() {
    try {
      const now = new Date();
      const lastSuccessful = await CookieRefresh.findOne({ status: 'success' })
        .sort({ completionTime: -1 });
      
      if (!lastSuccessful) {
        return true; // No successful refresh yet, should refresh
      }
      
      return lastSuccessful.nextScheduledRefresh <= now;
    } catch (error) {
      console.error('Error checking if refresh is due:', error);
      return true; // Default to refresh on error
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
        startTime: { $lt: cutoffDate }
      });
      
      console.log(`Cleaned up ${result.deletedCount} old refresh records`);
      return result.deletedCount;
    } catch (error) {
      console.error('Error cleaning up refresh records:', error);
      throw error;
    }
  }
}

export default CookieRefreshTracker;