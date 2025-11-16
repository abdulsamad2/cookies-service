import { Event } from '../models/index.js';
import crypto from 'crypto';

/**
 * Event Management Service for handling URL visiting and event tracking
 */
class EventService {
  /**
   * Create a new event
   * @param {object} eventData - The event data
   * @returns {Promise<object>} The created event record
   */
  static async createEvent(eventData) {
    try {
      const {
        eventId,
        url,
        title = null,
        venue = null,
        date = null,
        priority = 5,
        tags = [],
        config = {},
        metadata = {}
      } = eventData;

      if (!eventId || !url) {
        throw new Error('EventId and URL are required');
      }

      // Check if event already exists
      const existingEvent = await Event.findOne({ eventId });
      if (existingEvent) {
        throw new Error('Event already exists');
      }

      const defaultConfig = {
        visitFrequency: 30,
        maxCookiesPerVisit: 10,
        useProxy: true,
        browserType: 'random',
        deviceType: 'random',
        ...config
      };

      const event = await Event.create({
        eventId,
        url,
        title,
        venue,
        date,
        priority,
        tags,
        config: defaultConfig,
        metadata,
        status: 'active'
      });

      console.log(`Created new event: ${eventId}`);
      return event;
    } catch (error) {
      console.error('Error creating event:', error);
      throw error;
    }
  }

  /**
   * Get a random active event
   * @returns {Promise<object>} A random event record
   */
  static async getRandomEvent() {
    try {
      // Count events where Skip_Scraping is false (meaning we should scrape them)
      const count = await Event.countDocuments({ Skip_Scraping: false });
      if (count === 0) {
        console.log('No events available for scraping (Skip_Scraping: false)');
        return null;
      }
      const random = Math.floor(Math.random() * count);
      const event = await Event.findOne({ Skip_Scraping: false }).skip(random);
      
      // Return in format expected by cookie pool manager
      return {
        eventId: event.Event_ID,
        url: event.URL,
        title: event.Event_Name,
        venue: event.Venue,
        date: event.Event_DateTime,
        tags: ['ticketmaster', 'auto-scraping'],
        _id: event._id
      };
    } catch (error) {
      console.error('Error getting random event:', error);
      throw error;
    }
  }

  /**
   * Update event metrics after a visit
   * @param {string} eventId - The ID of the event to update
   * @param {object} metrics - The metrics to update
   */
  static async updateEventMetrics(eventId, { success, cookiesGenerated = 0, responseTime = 0, error = null }) {
    try {
      const update = {
        $set: {
          Last_Updated: new Date(),
          'metadata.lastUpdate': new Date().toISOString(),
          'metadata.scrapeEndTime': new Date(),
        }
      };

      if (success) {
        update.$inc = {
          'metadata.ticketStats.totalTickets': cookiesGenerated
        };
      }

      await Event.updateOne({ Event_ID: eventId }, update);
      console.log(`Updated metrics for event ${eventId}: ${success ? 'success' : 'failed'}`);
    } catch (error) {
      console.error(`Error updating metrics for event ${eventId}:`, error);
      throw error;
    }
  }

  /**
   * Get events based on criteria
   * @param {object} options - Query options
   * @returns {Promise<Array>} Array of events
   */
  static async getEvents(options = {}) {
    try {
      const {
        status = 'active',
        limit = 50,
        sortBy = 'priority',
        sortOrder = -1,
        tags = null,
        minPriority = null,
        readyForVisit = false
      } = options;

      // Build query
      const query = {};
      if (status) query.status = status;
      if (tags && tags.length > 0) query.tags = { $in: tags };
      if (minPriority !== null) query.priority = { $gte: minPriority };

      if (readyForVisit) {
        const now = new Date();
        const cutoffTime = new Date(now.getTime() - (30 * 60 * 1000)); // 30 minutes ago
        
        query.$or = [
          { 'metrics.lastVisited': { $exists: false } },
          { 'metrics.lastVisited': { $lt: cutoffTime } }
        ];
      }

      const events = await Event.find(query)
        .sort({ [sortBy]: sortOrder })
        .limit(limit);

      return events;
    } catch (error) {
      console.error('Error getting events:', error);
      throw error;
    }
  }

  /**
   * Get next event to visit based on priority and schedule
   * @returns {Promise<object>} Next event to visit
   */
  static async getNextEventToVisit() {
    try {
      const now = new Date();
      
      // Find events that are ready for visiting
      const events = await Event.find({
        status: 'active',
        $or: [
          { 'metrics.lastVisited': { $exists: false } },
          {
            'metrics.lastVisited': {
              $lt: new Date(now.getTime() - (30 * 60 * 1000)) // 30 minutes ago
            }
          }
        ]
      })
      .sort({ 
        priority: -1, 
        'quality.score': -1, 
        'metrics.lastVisited': 1 
      })
      .limit(1);

      return events[0] || null;
    } catch (error) {
      console.error('Error getting next event to visit:', error);
      throw error;
    }
  }

  /**
   * Get event statistics
   * @returns {Promise<object>} Event statistics
   */
  static async getStats() {
    try {
      const total = await Event.countDocuments();
      const active = await Event.countDocuments({ status: 'active' });
      const inactive = await Event.countDocuments({ status: 'inactive' });
      
      const qualityStats = await Event.aggregate([
        { $match: { status: 'active' } },
        {
          $group: {
            _id: null,
            avgQuality: { $avg: '$quality.score' },
            maxQuality: { $max: '$quality.score' },
            minQuality: { $min: '$quality.score' },
            totalCookies: { $sum: '$metrics.cookiesGenerated' },
            totalVisits: { $sum: '$metrics.totalVisits' },
            totalSuccessful: { $sum: '$metrics.successfulVisits' }
          }
        }
      ]);

      const stats = qualityStats[0] || {
        avgQuality: 0,
        maxQuality: 0,
        minQuality: 0,
        totalCookies: 0,
        totalVisits: 0,
        totalSuccessful: 0
      };

      return {
        total,
        active,
        inactive,
        pending: total - active - inactive,
        ...stats,
        successRate: stats.totalVisits > 0 ? Math.round((stats.totalSuccessful / stats.totalVisits) * 100) : 0
      };
    } catch (error) {
      console.error('Error getting event stats:', error);
      throw error;
    }
  }

  /**
   * Clean up inactive or expired events
   * @returns {Promise<number>} Number of events cleaned up
   */
  static async cleanup() {
    try {
      const result = await Event.deleteMany({
        $or: [
          { status: 'expired' },
          { 'quality.score': { $lt: 10 } },
          { 
            'metrics.failedVisits': { $gte: 10 },
            'quality.successRate': { $lt: 20 }
          }
        ]
      });

      console.log(`Cleaned up ${result.deletedCount} events`);
      return result.deletedCount;
    } catch (error) {
      console.error('Error cleaning up events:', error);
      throw error;
    }
  }

  /**
   * Bulk create events from an array
   * @param {Array} eventsData - Array of event data objects
   * @returns {Promise<Array>} Created events
   */
  static async bulkCreateEvents(eventsData) {
    try {
      const validEvents = [];
      
      for (const eventData of eventsData) {
        if (eventData.eventId && eventData.url) {
          // Check if event already exists
          const exists = await Event.findOne({ eventId: eventData.eventId });
          if (!exists) {
            validEvents.push({
              eventId: eventData.eventId,
              url: eventData.url,
              title: eventData.title || null,
              venue: eventData.venue || null,
              date: eventData.date || null,
              priority: eventData.priority || 5,
              tags: eventData.tags || [],
              config: {
                visitFrequency: 30,
                maxCookiesPerVisit: 10,
                useProxy: true,
                browserType: 'random',
                deviceType: 'random',
                ...eventData.config
              },
              metadata: eventData.metadata || {},
              status: 'active'
            });
          }
        }
      }

      if (validEvents.length === 0) {
        return [];
      }

      const createdEvents = await Event.insertMany(validEvents);
      console.log(`Bulk created ${createdEvents.length} events`);
      return createdEvents;
    } catch (error) {
      console.error('Error bulk creating events:', error);
      throw error;
    }
  }
}

export default EventService;