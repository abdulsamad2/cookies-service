import CookieRefreshTracker from '../services/cookieRefreshService.js';
import { CookieRefresh } from '../models/index.js';

/**
 * Get statistics about cookie refresh operations
 */
export const getCookieRefreshStats = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const stats = await CookieRefreshTracker.getStats(limit);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting cookie refresh stats:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Get recent cookie refresh operations with pagination
 */
export const getRecentRefreshes = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      eventId,
      startDate,
      endDate
    } = req.query;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      status,
      eventId,
      startDate,
      endDate
    };

    const result = await CookieRefreshTracker.getHistory(options);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting recent refreshes:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Start a new cookie refresh operation
 */
export const startRefresh = async (req, res) => {
  try {
    const {
      eventId,
      proxy,
      metadata = {}
    } = req.body;

    const refreshRecord = await CookieRefreshTracker.startRefresh(eventId, proxy, metadata);
    
    res.status(201).json({
      success: true,
      message: 'Cookie refresh started',
      data: {
        refreshId: refreshRecord.refreshId,
        status: refreshRecord.status,
        startTime: refreshRecord.startTime
      }
    });
  } catch (error) {
    console.error('Error starting cookie refresh:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Mark a refresh operation as completed (success or failure)
 */
export const completeRefresh = async (req, res) => {
  try {
    const { refreshId } = req.params;
    const {
      success,
      cookieCount = 0,
      retryCount = 0,
      errorMessage,
      metadata = {}
    } = req.body;

    let refreshRecord;

    if (success) {
      refreshRecord = await CookieRefreshTracker.markSuccess(
        refreshId,
        cookieCount,
        retryCount,
        metadata
      );
    } else {
      refreshRecord = await CookieRefreshTracker.markFailed(
        refreshId,
        errorMessage || 'Unknown error',
        retryCount,
        metadata
      );
    }
    
    res.json({
      success: true,
      message: `Cookie refresh marked as ${success ? 'successful' : 'failed'}`,
      data: {
        refreshId: refreshRecord.refreshId,
        status: refreshRecord.status,
        completionTime: refreshRecord.completionTime,
        duration: refreshRecord.duration,
        cookieCount: refreshRecord.cookieCount
      }
    });
  } catch (error) {
    console.error('Error completing cookie refresh:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Get details of a specific cookie refresh
 */
export const getRefreshDetails = async (req, res) => {
  try {
    const { refreshId } = req.params;
    
    const refresh = await CookieRefresh.findOne({ refreshId });
    
    if (!refresh) {
      return res.status(404).json({
        success: false,
        message: 'Cookie refresh record not found'
      });
    }

    res.json({
      success: true,
      data: refresh
    });
  } catch (error) {
    console.error('Error getting refresh details:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Check if a cookie refresh is due
 */
export const checkRefreshStatus = async (req, res) => {
  try {
    const isRefreshDue = await CookieRefreshTracker.isRefreshDue();
    
    res.json({
      success: true,
      data: {
        isRefreshDue,
        message: isRefreshDue ? 'Cookie refresh is due' : 'Cookie refresh not needed yet'
      }
    });
  } catch (error) {
    console.error('Error checking refresh status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Clean up old refresh records
 */
export const cleanupRefreshHistory = async (req, res) => {
  try {
    const { maxAge } = req.query;
    const maxAgeMs = maxAge ? parseInt(maxAge) * 24 * 60 * 60 * 1000 : undefined;
    
    const deletedCount = await CookieRefreshTracker.cleanup(maxAgeMs);
    
    res.json({
      success: true,
      message: `Cleaned up ${deletedCount} refresh records`,
      data: {
        deletedCount
      }
    });
  } catch (error) {
    console.error('Error cleaning up refresh history:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};