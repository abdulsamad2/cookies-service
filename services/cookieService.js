import { Cookie } from '../models/index.js';
import crypto from 'crypto';

/**
 * Cookie Management Service for storing and retrieving cookies
 */
class CookieService {
  /**
   * Store new cookies in the database
   * @param {object} cookiesData - The cookie data to store
   * @param {object} options - Storage options
   * @returns {Promise<object>} The stored cookie record
   */
  static async storeCookies(cookiesData, options = {}) {
    try {
      const {
        eventId = null,
        refreshId = null,
        proxy = null,
        userAgent = null,
        domain = null,
        tags = [],
        metadata = {}
      } = options;

      const cookieId = crypto.randomUUID();
      
      // Handle the cookie data structure properly
      let processedCookies = cookiesData;
      
      // If cookiesData is an object with cookies array, extract it
      if (cookiesData && typeof cookiesData === 'object' && cookiesData.cookies) {
        processedCookies = cookiesData.cookies;
      }
      
      // If it's an array of cookies, use as is
      if (Array.isArray(cookiesData)) {
        processedCookies = cookiesData;
      }
      
      // Find the earliest expiry time from the cookies
      let earliestExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // Default 24 hours
      if (Array.isArray(processedCookies)) {
        processedCookies.forEach(cookie => {
          if (cookie.expires && cookie.expires > 0) {
            const cookieExpiry = new Date(cookie.expires * 1000);
            if (cookieExpiry < earliestExpiry && cookieExpiry > new Date()) {
              earliestExpiry = cookieExpiry;
            }
          }
        });
      }
      
      const cookieRecord = await Cookie.create({
        cookieId,
        cookies: processedCookies,
        source: {
          eventId,
          refreshId,
          proxy,
          userAgent
        },
        metadata: {
          domain: domain || 'ticketmaster.com',
          ...metadata,
          timestamp: Date.now(),
          originalFormat: cookiesData.lastUpdated ? 'external' : 'internal'
        },
        tags,
        validity: {
          isValid: true,
          expiresAt: earliestExpiry,
          lastUsed: new Date(),
          usageCount: 0
        },
        quality: {
          score: 100,
          successRate: 100,
          lastSuccessful: new Date()
        },
        status: 'active'
      });

      console.log(`✅ Stored new cookies with ID: ${cookieId} (${Array.isArray(processedCookies) ? processedCookies.length : 'unknown'} cookies)`);
      return cookieRecord;
    } catch (error) {
      console.error('Error storing cookies:', error);
      
      // If it's a duplicate key error, try to update existing instead of failing
      if (error.code === 11000) {
        console.log('🔄 Duplicate key detected, skipping this cookie batch...');
        return null;
      }
      
      throw error;
    }
  }

  /**
   * Get cookies by various criteria
   * @param {object} options - Query options
   * @returns {Promise<Array>} Array of cookie records
   */
  static async getCookies(options = {}) {
    try {
      const {
        status = 'active',
        isValid = true,
        limit = 10,
        sortBy = 'quality.score',
        sortOrder = -1,
        tags = null,
        eventId = null,
        domain = null,
        minQualityScore = 0
      } = options;

      // Build query
      const query = {};
      if (status) query.status = status;
      if (isValid !== null) query['validity.isValid'] = isValid;
      if (tags && tags.length > 0) query.tags = { $in: tags };
      if (eventId) query['source.eventId'] = eventId;
      if (domain) query['metadata.domain'] = domain;
      if (minQualityScore > 0) query['quality.score'] = { $gte: minQualityScore };

      // Add expiry check
      query['validity.expiresAt'] = { $gt: new Date() };

      const cookies = await Cookie.find(query)
        .sort({ [sortBy]: sortOrder })
        .limit(limit);

      return cookies;
    } catch (error) {
      console.error('Error getting cookies:', error);
      throw error;
    }
  }

  /**
   * Get the total count of cookies in the database
   * @returns {Promise<number>} The total number of cookies
   */
  static async getCookieCount() {
    try {
      const count = await Cookie.countDocuments({ status: 'active' });
      return count;
    } catch (error) {
      console.error('Error getting cookie count:', error);
      throw error;
    }
  }

  /**
   * Clean up expired cookies from the database
   * @returns {Promise<object>} Cleanup results
   */
  static async cleanupExpiredCookies() {
    try {
      const now = new Date();
      
      // Find cookies that have expired
      const expiredResult = await Cookie.deleteMany({
        'validity.expiresAt': { $lt: now }
      });

      // Also clean up cookies marked as invalid
      const invalidResult = await Cookie.deleteMany({
        'validity.isValid': false,
        updatedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Older than 24 hours
      });

      const totalDeleted = expiredResult.deletedCount + invalidResult.deletedCount;
      
      if (totalDeleted > 0) {
        console.log(`Cleaned up ${totalDeleted} expired/invalid cookies (${expiredResult.deletedCount} expired, ${invalidResult.deletedCount} invalid)`);
      }

      return {
        success: true,
        deletedCount: totalDeleted,
        expired: expiredResult.deletedCount,
        invalid: invalidResult.deletedCount
      };
    } catch (error) {
      console.error('Error cleaning up expired cookies:', error);
      throw error;
    }
  }

  /**
   * Update cookie usage statistics
   * @param {string} cookieId - The ID of the cookie to update
   * @returns {Promise<object>} Updated cookie record
   */
  static async updateCookieUsage(cookieId) {
    try {
      const updated = await Cookie.findOneAndUpdate(
        { cookieId },
        {
          $inc: { 'validity.usageCount': 1 },
          $set: { 'validity.lastUsed': new Date() }
        },
        { new: true }
      );
      return updated;
    } catch (error) {
      console.error('Error updating cookie usage:', error);
      throw error;
    }
  }

  /**
   * Get the best available cookies for a client, considering usage and quality
   * @param {object} criteria - Selection criteria
   * @returns {Promise<object>} Best cookie set
   */
  static async getBestCookies(criteria = {}) {
    try {
      const {
        domain = null,
        tags = [],
        excludeUsedRecently = true,
        maxUsageCount = 10
      } = criteria;

      const query = {
        status: 'active',
        'validity.isValid': true,
        'validity.expiresAt': { $gt: new Date() },
        'quality.score': { $gte: 50 } // Minimum quality threshold
      };

      if (domain) query['metadata.domain'] = domain;
      if (tags.length > 0) query.tags = { $in: tags };
      if (excludeUsedRecently) {
        query['validity.lastUsed'] = { 
          $lt: new Date(Date.now() - 5 * 60 * 1000) // Not used in last 5 minutes
        };
      }
      if (maxUsageCount > 0) {
        query['validity.usageCount'] = { $lt: maxUsageCount };
      }

      const cookie = await Cookie.findOne(query)
        .sort({ 'quality.score': -1, 'validity.usageCount': 1 });

      if (cookie) {
        // Update usage tracking
        await Cookie.findByIdAndUpdate(cookie._id, {
          $inc: { 'validity.usageCount': 1 },
          $set: { 'validity.lastUsed': new Date() }
        });
      }

      return cookie;
    } catch (error) {
      console.error('Error getting best cookies:', error);
      throw error;
    }
  }

  /**
   * Update cookie quality based on usage feedback
   * @param {string} cookieId - Cookie ID
   * @param {boolean} success - Whether the usage was successful
   * @returns {Promise<object>} Updated cookie record
   */
  static async updateCookieQuality(cookieId, success) {
    try {
      const cookie = await Cookie.findOne({ cookieId });
      if (!cookie) {
        throw new Error('Cookie not found');
      }

      const update = {};
      
      if (success) {
        update['quality.lastSuccessful'] = new Date();
        // Increase score slightly for successful usage
        update['quality.score'] = Math.min(100, cookie.quality.score + 1);
      } else {
        // Decrease score for failed usage
        const newScore = Math.max(0, cookie.quality.score - 5);
        update['quality.score'] = newScore;
        
        // Mark as inactive if quality is too low
        if (newScore < 20) {
          update.status = 'failed';
          update['validity.isValid'] = false;
        }
      }

      const updatedCookie = await Cookie.findByIdAndUpdate(
        cookie._id,
        { $set: update },
        { new: true }
      );

      return updatedCookie;
    } catch (error) {
      console.error('Error updating cookie quality:', error);
      throw error;
    }
  }

  /**
   * Get cookie statistics
   * @returns {Promise<object>} Cookie statistics
   */
  static async getStats() {
    try {
      const total = await Cookie.countDocuments();
      const active = await Cookie.countDocuments({ status: 'active' });
      const valid = await Cookie.countDocuments({ 'validity.isValid': true });
      const expired = await Cookie.countDocuments({ 
        'validity.expiresAt': { $lt: new Date() } 
      });

      const qualityStats = await Cookie.aggregate([
        { $match: { status: 'active' } },
        {
          $group: {
            _id: null,
            avgQuality: { $avg: '$quality.score' },
            maxQuality: { $max: '$quality.score' },
            minQuality: { $min: '$quality.score' }
          }
        }
      ]);

      const recentCookies = await Cookie.find({ status: 'active' })
        .sort({ createdAt: -1 })
        .limit(5);

      return {
        total,
        active,
        valid,
        expired,
        inactive: total - active,
        invalid: total - valid,
        quality: qualityStats[0] || { avgQuality: 0, maxQuality: 0, minQuality: 0 },
        recentCookies: recentCookies.length
      };
    } catch (error) {
      console.error('Error getting cookie stats:', error);
      throw error;
    }
  }

  /**
   * Clean up expired and invalid cookies
   * @returns {Promise<number>} Number of cookies cleaned up
   */
  static async cleanup() {
    try {
      const result = await Cookie.deleteMany({
        $or: [
          { 'validity.expiresAt': { $lt: new Date() } },
          { status: 'failed' },
          { 'quality.score': { $lt: 10 } }
        ]
      });

      console.log(`Cleaned up ${result.deletedCount} cookies`);
      return result.deletedCount;
    } catch (error) {
      console.error('Error cleaning up cookies:', error);
      throw error;
    }
  }
}

export default CookieService;