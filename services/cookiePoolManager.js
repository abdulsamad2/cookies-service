import EventService from './eventService.js';
import CookieService from './cookieService.js';
import { refreshCookies } from '../browser-cookies.js';
import { BrowserFingerprint } from '../browserFingerprint.js';
import crypto from 'crypto';

/**
 * Cookie Pool Manager - Coordinates event visiting and cookie generation
 * Maintains a massive pool of fresh cookies for downstream systems
 */
class CookiePoolManager {
  constructor(options = {}) {
    this.options = {
      minCookiePool: 500,        // Minimum cookies to maintain (500 for large pool)
      maxCookiePool: 700,        // Maximum cookies to store - never stops, just refreshes old ones
      batchSize: 10,             // How many events to process in parallel
      visitInterval: 2000,       // Base visit interval (2 seconds for continuous refresh)
      cleanupInterval: 300000,   // 5 minutes cleanup interval
      maxRetries: 3,             // Max retries per event
      maxConcurrentBrowsers: 3,  // Maximum concurrent browser instances
      ...options
    };
    
    this.isRunning = false;
    this.visitTimer = null;
    this.cleanupTimer = null;
    this.activeBrowsers = new Set();  // Track active browser sessions
    this.browserQueue = [];           // Queue for pending browser tasks
    this.stats = {
      totalVisits: 0,
      successfulVisits: 0,
      failedVisits: 0,
      cookiesGenerated: 0,
      eventsProcessed: 0,
      startTime: null
    };
  }

  /**
   * Start the cookie pool manager
   */
  async start() {
    if (this.isRunning) {
      console.log('Cookie Pool Manager is already running');
      return;
    }

    console.log('🚀 Starting Cookie Pool Manager...');
    this.isRunning = true;
    this.stats.startTime = new Date();

    // Start automatic cleanup of expired cookies
    this.cleanupTimer = setInterval(() => {
      this.performCleanup().catch(error => {
        console.error('Cleanup failed:', error);
      });
    }, this.options.cleanupInterval);

    // Start the main visiting loop with randomized timing
    const scheduleNextVisit = () => {
      const randomDelay = this.options.visitInterval + (Math.random() * 3000 - 1500); // ±1.5 seconds
      this.visitTimer = setTimeout(() => {
        this.processVisits().catch(error => {
          console.error('Visit processing failed:', error);
        }).finally(() => {
          if (this.isRunning) {
            scheduleNextVisit(); // Schedule next visit with new random delay
          }
        });
      }, Math.max(1000, randomDelay)); // Ensure minimum 1 second delay
    };
    
    scheduleNextVisit();

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(error => {
        console.error('Error in cleanup:', error);
      });
    }, this.options.cleanupInterval);

    // Initial run
    await this.processVisits();
    
    console.log('✅ Cookie Pool Manager started successfully');
  }

  /**
   * Perform automatic cleanup of expired cookies and mark old ones for refresh
   */
  async performCleanup() {
    try {
      console.log('🧹 Running automatic cookie cleanup...');
      const result = await CookieService.cleanupExpiredCookies();
      
      // Also check for cookies that are getting old (older than 2 hours) and mark some for refresh
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const oldCookies = await CookieService.getCookies({
        status: 'active',
        isValid: true,
        limit: 50,
        sortBy: 'createdAt',
        sortOrder: 1 // Oldest first
      });

      const veryOldCookies = oldCookies.filter(cookie => 
        new Date(cookie.createdAt) <= twoHoursAgo
      );

      if (result.deletedCount > 0) {
        console.log(`✅ Cleanup completed: ${result.deletedCount} expired cookies removed`);
      }
      
      if (veryOldCookies.length > 0) {
        console.log(`📊 Found ${veryOldCookies.length} cookies older than 2 hours - will refresh in rotation`);
      }
      
      return {
        ...result,
        oldCookiesFound: veryOldCookies.length
      };
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Stop the cookie pool manager
   */
  async stop() {
    if (!this.isRunning) {
      console.log('Cookie Pool Manager is not running');
      return;
    }

    console.log('🛑 Stopping Cookie Pool Manager...');
    this.isRunning = false;

    if (this.visitTimer) {
      clearTimeout(this.visitTimer);
      this.visitTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    console.log('✅ Cookie Pool Manager stopped');
  }

  /**
   * Main processing loop - visits events and generates cookies
   */
  async processVisits() {
    if (!this.isRunning) return;

    try {
      console.log('🔄 Processing cookie generation cycle...');
      
      // Check current cookie pool size
      const currentCookies = await CookieService.getCookies({
        status: 'active',
        isValid: true,
        limit: this.options.maxCookiePool
      });

      console.log(`Current cookie pool size: ${currentCookies.length}`);
      console.log(`Active browsers: ${this.activeBrowsers.size}/${this.options.maxConcurrentBrowsers}`);

      // Check for cookies that need refreshing (expiring soon)
      const expiringCookies = await this.getExpiringCookies();
      const needsRefresh = expiringCookies.length > 0;
      
      // Only start new browser if we have available slots
      if (this.activeBrowsers.size < this.options.maxConcurrentBrowsers) {
        let shouldStartBrowser = false;
        let reason = '';
        
        if (currentCookies.length < this.options.minCookiePool) {
          shouldStartBrowser = true;
          reason = 'Cookie pool needs replenishment';
        } else if (needsRefresh) {
          shouldStartBrowser = true;
          reason = `Found ${expiringCookies.length} cookies expiring soon, refreshing them`;
        } else if (currentCookies.length >= this.options.maxCookiePool) {
          shouldStartBrowser = true;
          reason = 'Pool at maximum, refreshing oldest cookies to maintain freshness';
        } else {
          shouldStartBrowser = true;
          reason = 'Maintaining pool freshness with regular refresh';
        }
        
        if (shouldStartBrowser) {
          console.log(`${reason}, starting new browser session`);
          await this.startNewBrowserSession();
        }
      } else {
        console.log('Maximum concurrent browsers reached, waiting for completion');
      }

    } catch (error) {
      console.error('Error in processVisits:', error);
      this.stats.failedVisits++;
    }
  }

  /**
   * Get cookies that are expiring soon (within next hour)
   */
  async getExpiringCookies() {
    try {
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      
      const expiringCookies = await CookieService.getCookies({
        status: 'active',
        isValid: true,
        limit: 100,
        sortBy: 'validity.expiresAt',
        sortOrder: 1 // Oldest expiry first
      });

      // Filter cookies expiring within the next hour
      const soonToExpire = expiringCookies.filter(cookie => {
        if (!cookie.validity || !cookie.validity.expiresAt) return false;
        return new Date(cookie.validity.expiresAt) <= oneHourFromNow;
      });

      return soonToExpire;
    } catch (error) {
      console.error('Error checking expiring cookies:', error);
      return [];
    }
  }

  /**
   * Start a new browser session for cookie generation
   */
  async startNewBrowserSession() {
    try {
      // Get a random event to visit
      const event = await EventService.getRandomEvent();
      
      if (!event) {
        console.log('No active events found to visit');
        return;
      }

      // Generate unique session ID
      const sessionId = crypto.randomUUID();
      this.activeBrowsers.add(sessionId);

      console.log(`🌐 Starting browser session ${sessionId.substring(0, 8)}... (${this.activeBrowsers.size}/${this.options.maxConcurrentBrowsers})`);

      // Process event in background (don't await here to allow concurrent processing)
      this.processSingleEvent(event, sessionId).finally(() => {
        // Remove from active browsers when done
        this.activeBrowsers.delete(sessionId);
        console.log(`🏁 Browser session ${sessionId.substring(0, 8)} completed (${this.activeBrowsers.size}/${this.options.maxConcurrentBrowsers})`);
      });

    } catch (error) {
      console.error('Error starting new browser session:', error);
    }
  }

  /**
   * Process a single event with sequential browser management
   * @param {object} event - The event to process
   * @param {string} sessionId - Unique session identifier
   */
  async processSingleEvent(event, sessionId) {
    const startTime = Date.now();
    let retries = 0;

    while (retries <= this.options.maxRetries) {
      try {
        console.log(`🎯 Session ${sessionId.substring(0, 8)}: Visiting event ${event.eventId} (attempt ${retries + 1})`);

        // Generate fresh cookies using the existing browser-cookies system with random proxy
        const result = await refreshCookies(event.url);
        
        if (!result || !result.cookies || result.cookies.length === 0) {
          throw new Error('No cookies generated');
        }

        // Store cookies in database with enhanced metadata
        const cookieRecord = await CookieService.storeCookies(result.cookies, {
          eventId: event.eventId,
          refreshId: crypto.randomUUID(),
          userAgent: result.fingerprint?.userAgent || 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
          domain: 'ticketmaster.com',
          tags: [...(event.tags || []), 'auto-generated', 'pool-managed'],
          metadata: {
            eventTitle: event.title,
            eventVenue: event.venue,
            visitTime: new Date(),
            fingerprint: result.fingerprint,
            generationMethod: 'automated-pool',
            sessionId: sessionId
          }
        });

        // Update event metrics
        await EventService.updateEventMetrics(event.eventId, {
          success: true,
          cookiesGenerated: result.cookies.length,
          responseTime: Date.now() - startTime
        });

        // Update stats
        this.stats.totalVisits++;
        this.stats.successfulVisits++;
        this.stats.eventsProcessed++;
        this.stats.cookiesGenerated += Array.isArray(result.cookies) ? result.cookies.length : 1;

        if (cookieRecord) {
          console.log(`✅ Session ${sessionId.substring(0, 8)}: Generated ${Array.isArray(result.cookies) ? result.cookies.length : 'unknown'} cookies for event ${event.eventId}`);
        } else {
          console.log(`⚠️ Session ${sessionId.substring(0, 8)}: Cookies generated but not stored (likely duplicate) for event ${event.eventId}`);
        }

        return {
          success: true,
          eventId: event.eventId,
          cookiesGenerated: Array.isArray(result.cookies) ? result.cookies.length : 1,
          cookieRecord: cookieRecord,
          sessionId: sessionId
        };

      } catch (error) {
        console.error(`❌ Session ${sessionId.substring(0, 8)}: Error processing event ${event.eventId} (attempt ${retries + 1}):`, error.message);
        
        retries++;
        this.stats.totalVisits++;
        
        if (retries > this.options.maxRetries) {
          // Update event metrics for failure
          await EventService.updateEventMetrics(event.eventId, {
            success: false,
            error: error.message,
            responseTime: Date.now() - startTime
          });
          
          this.stats.failedVisits++;
          console.log(`💥 Session ${sessionId.substring(0, 8)}: Failed to process event ${event.eventId} after ${this.options.maxRetries + 1} attempts`);
          
          return {
            success: false,
            eventId: event.eventId,
            error: error.message,
            sessionId: sessionId
          };
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000 * retries));
      }
    }
  }

  /**
   * Process a single event - visit URL and generate cookies
   * @param {object} event - Event to process
   * @returns {Promise<object>} Processing result
   */
  async processEvent(event) {
    const startTime = Date.now();
    let retries = 0;

    while (retries <= this.options.maxRetries) {
      try {
        console.log(`🎯 Visiting event: ${event.eventId} (attempt ${retries + 1})`);

        // Generate fresh cookies using the existing browser-cookies system with random proxy
        const result = await refreshCookies(event.url);
        
        if (!result || !result.cookies || result.cookies.length === 0) {
          throw new Error('No cookies generated');
        }

        // Store cookies in database with enhanced metadata
        const cookieRecord = await CookieService.storeCookies(result.cookies, {
          eventId: event.eventId,
          refreshId: crypto.randomUUID(),
          userAgent: result.fingerprint?.userAgent || 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
          domain: 'ticketmaster.com',
          tags: [...(event.tags || []), 'auto-generated', 'pool-managed'],
          metadata: {
            eventTitle: event.title,
            eventVenue: event.venue,
            visitTime: new Date(),
            fingerprint: result.fingerprint,
            generationMethod: 'automated-pool'
          }
        });

        // Update event metrics
        await EventService.updateEventMetrics(event.eventId, {
          success: true,
          cookiesGenerated: result.cookies.length,
          responseTime: Date.now() - startTime
        });

        // Only proceed if cookieRecord was created successfully
        if (cookieRecord) {
          console.log(`✅ Successfully generated ${Array.isArray(result.cookies) ? result.cookies.length : 'unknown'} cookies for event ${event.eventId}`);
          
          return {
            success: true,
            eventId: event.eventId,
            cookiesGenerated: Array.isArray(result.cookies) ? result.cookies.length : 1,
            cookieRecord: cookieRecord
          };
        } else {
          console.log(`⚠️ Cookies generated but not stored (likely duplicate) for event ${event.eventId}`);
          
          return {
            success: true,
            eventId: event.eventId,
            cookiesGenerated: 0,
            cookieRecord: null
          };
        }

      } catch (error) {
        console.error(`❌ Failed to process event ${event.eventId} (attempt ${retries + 1}):`, error.message);
        
        retries++;
        if (retries <= this.options.maxRetries) {
          console.log(`Retrying in 5 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }

    // Update event metrics for failure
    await EventService.updateEventMetrics(event.eventId, {
      success: false,
      cookiesGenerated: 0,
      responseTime: Date.now() - startTime,
      error: 'Max retries exceeded'
    });

    return {
      success: false,
      eventId: event.eventId,
      cookiesGenerated: 0,
      error: 'Max retries exceeded'
    };
  }

  /**
   * Cleanup expired cookies and inactive events
   */
  async cleanup() {
    if (!this.isRunning) return;

    try {
      console.log('🧹 Running cleanup...');
      
      // Cleanup expired cookies
      const cleanedCookies = await CookieService.cleanup();
      
      // Cleanup inactive events
      const cleanedEvents = await EventService.cleanup();
      
      console.log(`Cleanup completed: ${cleanedCookies} cookies, ${cleanedEvents} events removed`);
      
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  /**
   * Get current statistics
   * @returns {Promise<object>} Current statistics
   */
  async getStats() {
    try {
      const [cookieStats, eventStats] = await Promise.all([
        CookieService.getStats(),
        EventService.getStats()
      ]);

      const uptime = this.stats.startTime ? Date.now() - this.stats.startTime.getTime() : 0;

      return {
        isRunning: this.isRunning,
        uptime: Math.floor(uptime / 1000), // in seconds
        options: this.options,
        performance: {
          ...this.stats,
          successRate: this.stats.totalVisits > 0 
            ? Math.round((this.stats.successfulVisits / this.stats.totalVisits) * 100) 
            : 0,
          cookiesPerVisit: this.stats.successfulVisits > 0 
            ? Math.round(this.stats.cookiesGenerated / this.stats.successfulVisits) 
            : 0
        },
        cookies: cookieStats,
        events: eventStats
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      return { error: error.message };
    }
  }

  /**
   * Add new events to the system
   * @param {Array} eventsData - Array of event data
   * @returns {Promise<Array>} Created events
   */
  async addEvents(eventsData) {
    try {
      const events = await EventService.bulkCreateEvents(eventsData);
      console.log(`Added ${events.length} new events to the pool`);
      return events;
    } catch (error) {
      console.error('Error adding events:', error);
      throw error;
    }
  }

  /**
   * Get fresh cookies for downstream systems
   * @param {object} criteria - Selection criteria
   * @returns {Promise<object>} Fresh cookie set
   */
  async getFreshCookies(criteria = {}) {
    try {
      const cookies = await CookieService.getBestCookies({
        domain: 'ticketmaster.com',
        tags: ['auto-generated'],
        excludeUsedRecently: true,
        maxUsageCount: 5,
        ...criteria
      });

      if (cookies) {
        console.log(`Provided fresh cookies (ID: ${cookies.cookieId}) to downstream system`);
      }

      return cookies;
    } catch (error) {
      console.error('Error getting fresh cookies:', error);
      throw error;
    }
  }

  /**
   * Get current statistics
   * @returns {object} Current statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      uptime: this.stats.startTime ? Date.now() - this.stats.startTime.getTime() : 0
    };
  }

  /**
   * Update configuration
   * @param {object} newOptions - New configuration options
   */
  updateConfig(newOptions) {
    this.options = { ...this.options, ...newOptions };
    console.log('Configuration updated:', newOptions);
  }
}

export default CookiePoolManager;