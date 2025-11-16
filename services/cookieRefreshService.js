import { CookieRefresh } from '../models/index.js';
import crypto from 'crypto';

/**
 * Cookie Refresh Tracker - Enhanced for standalone service
 */
class CookieRefreshTracker {
  /**
   * Start tracking a new cookie refresh operation
   * @param {string} eventId - The event ID used for this refresh operation
   * @param {object} proxy - The proxy object used for this refresh
   * @param {object} metadata - Additional metadata
   * @returns {Promise<object>} The created refresh tracking record
   */
  static async startRefresh(eventId, proxy, metadata = {}) {
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
    
    console.log(`Started tracking cookie refresh operation: ${refreshId} for event ${eventId}`);
    return refreshRecord;
  }
  
  /**
   * Mark a refresh operation as successful
   * @param {string} refreshId - The ID of the refresh operation
   * @param {number} cookieCount - Number of cookies retrieved
   * @param {number} retryCount - Number of retries performed
   * @param {object} metadata - Additional metadata
   * @returns {Promise<object>} The updated refresh tracking record
   */
  static async markSuccess(refreshId, cookieCount, retryCount, metadata = {}) {
    const completionTime = new Date();
    const refreshRecord = await CookieRefresh.findOne({ refreshId });
    
    if (!refreshRecord) {
      throw new Error('Refresh record not found');
    }
    
    const duration = completionTime - refreshRecord.startTime;
    const nextScheduledRefresh = new Date(
      completionTime.getTime() + (30 * 60 * 1000) // Default 30 minutes
    );
    
    const updatedRecord = await CookieRefresh.findOneAndUpdate(
      { refreshId },
      {
        status: 'success',
        completionTime,
        nextScheduledRefresh,
        cookieCount,
        retryCount,
        duration,
        metadata: { ...refreshRecord.metadata, ...metadata }
      },
      { new: true }
    );
    
    console.log(`Cookie refresh completed successfully: ${refreshId} with ${cookieCount} cookies`);
    return updatedRecord;
  }
  
  /**
   * Mark a refresh operation as failed
   * @param {string} refreshId - The ID of the refresh operation
   * @param {string} errorMessage - Error message describing the failure
   * @param {number} retryCount - Number of retries performed
   * @param {object} metadata - Additional metadata
   * @returns {Promise<object>} The updated refresh tracking record
   */
  static async markFailed(refreshId, errorMessage, retryCount, metadata = {}) {
    const completionTime = new Date();
    const refreshRecord = await CookieRefresh.findOne({ refreshId });
    
    if (!refreshRecord) {
      throw new Error('Refresh record not found');
    }
    
    const duration = completionTime - refreshRecord.startTime;
    // Schedule next attempt sooner if it failed
    const nextScheduledRefresh = new Date(
      completionTime.getTime() + (5 * 60 * 1000) // 5 minutes for failures
    );
    
    const updatedRecord = await CookieRefresh.findOneAndUpdate(
      { refreshId },
      {
        status: 'failed',
        completionTime,
        nextScheduledRefresh,
        errorMessage,
        retryCount,
        duration,
        metadata: { ...refreshRecord.metadata, ...metadata }
      },
      { new: true }
    );
    
    console.log(`Cookie refresh failed: ${refreshId}, next attempt: ${nextScheduledRefresh.toISOString()}`);
    return updatedRecord;
  }
  
  /**
   * Get statistics about cookie refresh operations
   * @param {number} limit - Number of recent operations to analyze
   * @returns {Promise<object>} Statistics about cookie refresh operations
   */
  static async getStats(limit = 100) {
    const recentRefreshes = await CookieRefresh.find()
      .sort({ startTime: -1 })
      .limit(limit);
    
    const successCount = recentRefreshes.filter(r => r.status === 'success').length;
    const failedCount = recentRefreshes.filter(r => r.status === 'failed').length;
    const inProgressCount = recentRefreshes.filter(r => r.status === 'in_progress').length;
    
    const totalCookies = recentRefreshes.reduce((sum, r) => sum + (r.cookieCount || 0), 0);
    const averageCookies = successCount > 0 
      ? totalCookies / successCount 
      : 0;
    
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
      latestRefresh: recentRefreshes[0] || null
    };
  }

  /**
   * Get refresh history with pagination and filtering
   * @param {object} options - Query options
   * @returns {Promise<object>} Paginated refresh history
   */
  static async getHistory(options = {}) {
    const {
      page = 1,
      limit = 20,
      status,
      eventId,
      startDate,
      endDate
    } = options;

    const skip = (page - 1) * limit;
    const query = {};

    if (status) query.status = status;
    if (eventId) query.eventId = eventId;
    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    const total = await CookieRefresh.countDocuments(query);
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
        pages: Math.ceil(total / limit)
      }
    };
  }
  
  /**
   * Check if a refresh is due
   * @returns {Promise<boolean>} Whether a refresh is due
   */
  static async isRefreshDue() {
    const now = new Date();
    const lastSuccessful = await CookieRefresh.findOne({ status: 'success' })
      .sort({ completionTime: -1 });
    
    if (!lastSuccessful) {
      return true; // No successful refresh yet, should refresh
    }
    
    return lastSuccessful.nextScheduledRefresh <= now;
  }

  /**
   * Clean up old refresh records
   * @param {number} maxAgeMs - Maximum age in milliseconds (default: 30 days)
   * @returns {Promise<number>} Number of records deleted
   */
  static async cleanup(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
    const cutoffDate = new Date(Date.now() - maxAgeMs);
    const result = await CookieRefresh.deleteMany({
      startTime: { $lt: cutoffDate },
      status: { $in: ['success', 'failed'] } // Don't delete in-progress operations
    });

    console.log(`Cleaned up ${result.deletedCount} old refresh records`);
    return result.deletedCount;
  }
}

export default CookieRefreshTracker;