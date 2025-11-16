import EventService from '../services/eventService.js';
import CookiePoolManager from '../services/cookiePoolManager.js';

// Global cookie pool manager instance
let poolManager = null;

/**
 * Event Controller for managing events and cookie generation
 */
class EventController {
  /**
   * Create a new event
   */
  static async createEvent(req, res) {
    try {
      const event = await EventService.createEvent(req.body);
      res.status(201).json({
        success: true,
        data: event,
        message: 'Event created successfully'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get all events
   */
  static async getEvents(req, res) {
    try {
      const { 
        status, 
        limit = 50, 
        sortBy = 'priority', 
        sortOrder = -1,
        tags,
        minPriority,
        readyForVisit
      } = req.query;

      const options = {
        status,
        limit: parseInt(limit),
        sortBy,
        sortOrder: parseInt(sortOrder),
        minPriority: minPriority ? parseInt(minPriority) : null,
        readyForVisit: readyForVisit === 'true'
      };

      if (tags) {
        options.tags = Array.isArray(tags) ? tags : [tags];
      }

      const events = await EventService.getEvents(options);
      res.json({
        success: true,
        data: events,
        count: events.length
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get event statistics
   */
  static async getEventStats(req, res) {
    try {
      const stats = await EventService.getStats();
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Bulk create events
   */
  static async bulkCreateEvents(req, res) {
    try {
      const { events } = req.body;
      
      if (!Array.isArray(events)) {
        return res.status(400).json({
          success: false,
          error: 'Events must be an array'
        });
      }

      const createdEvents = await EventService.bulkCreateEvents(events);
      res.status(201).json({
        success: true,
        data: createdEvents,
        message: `Successfully created ${createdEvents.length} events`
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Start the cookie pool manager
   */
  static async startPool(req, res) {
    try {
      if (!poolManager) {
        poolManager = new CookiePoolManager(req.body);
      }

      await poolManager.start();
      res.json({
        success: true,
        message: 'Cookie pool manager started successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Stop the cookie pool manager
   */
  static async stopPool(req, res) {
    try {
      if (poolManager) {
        await poolManager.stop();
      }
      res.json({
        success: true,
        message: 'Cookie pool manager stopped'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get pool manager statistics
   */
  static async getPoolStats(req, res) {
    try {
      if (!poolManager) {
        return res.json({
          success: true,
          data: {
            isRunning: false,
            message: 'Pool manager not initialized'
          }
        });
      }

      const stats = await poolManager.getStats();
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get fresh cookies for downstream systems
   */
  static async getFreshCookies(req, res) {
    try {
      if (!poolManager) {
        return res.status(503).json({
          success: false,
          error: 'Pool manager not running'
        });
      }

      const criteria = {
        domain: req.query.domain || 'ticketmaster.com',
        tags: req.query.tags ? (Array.isArray(req.query.tags) ? req.query.tags : [req.query.tags]) : undefined,
        excludeUsedRecently: req.query.excludeUsedRecently !== 'false',
        maxUsageCount: req.query.maxUsageCount ? parseInt(req.query.maxUsageCount) : 5
      };

      const cookies = await poolManager.getFreshCookies(criteria);
      
      if (!cookies) {
        return res.status(404).json({
          success: false,
          error: 'No fresh cookies available'
        });
      }

      res.json({
        success: true,
        data: {
          cookieId: cookies.cookieId,
          cookies: cookies.cookies,
          quality: cookies.quality,
          metadata: cookies.metadata,
          createdAt: cookies.createdAt
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Update pool manager configuration
   */
  static async updatePoolConfig(req, res) {
    try {
      if (!poolManager) {
        return res.status(404).json({
          success: false,
          error: 'Pool manager not initialized'
        });
      }

      poolManager.updateConfig(req.body);
      res.json({
        success: true,
        message: 'Configuration updated successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Manual cleanup
   */
  static async cleanup(req, res) {
    try {
      if (poolManager) {
        await poolManager.cleanup();
      }

      res.json({
        success: true,
        message: 'Cleanup completed'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

export default EventController;