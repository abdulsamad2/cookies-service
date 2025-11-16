import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import config from './config/index.js';
import Database from './config/database.js';
import { cookieRoutes, refreshRoutes, eventRoutes } from './routes/index.js';
import { errorHandler, notFound, requestLogger } from './middleware/index.js';
import CookiePoolManager from './services/cookiePoolManager.js';
import CookieService from './services/cookieService.js';

const app = express();

// Initialize database
const database = new Database();

// Middleware
app.use(helmet(config.security.helmet));
app.use(cors(config.security.cors));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Cookies Service is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.env
  });
});

// Initialize Cookie Pool Manager
let poolManager = null;

// Random Cookie endpoint - returns one random cookie set
app.get(`${config.api.prefix}/cookies/random`, async (req, res) => {
  try {
    // Clean up expired cookies first
    await CookieService.cleanupExpiredCookies();
    
    const cookies = await CookieService.getCookies({
      status: 'active',
      isValid: true,
      limit: 1,
      sortBy: 'createdAt',
      sortOrder: -1, // Get newest first
      minQualityScore: 50
    });

    const totalCount = await CookieService.getCookieCount();

    if (cookies.length === 0) {
      return res.json({
        success: false,
        message: 'No cookies available',
        total: totalCount,
        cookies: []
      });
    }

    const randomCookie = cookies[0];
    
    // Update usage statistics
    if (randomCookie.cookieId) {
      await CookieService.updateCookieUsage(randomCookie.cookieId);
    }

    res.json({
      success: true,
      total: totalCount,
      cookieId: randomCookie.cookieId,
      quality: randomCookie.quality?.score || 0,
      cookies: randomCookie.cookies || [],
      metadata: {
        eventId: randomCookie.metadata?.eventId || null,
        eventTitle: randomCookie.metadata?.eventTitle || null,
        visitTime: randomCookie.metadata?.visitTime || null,
        domain: randomCookie.metadata?.domain || 'ticketmaster.com',
        generatedAt: randomCookie.createdAt
      },
      usage: {
        usageCount: randomCookie.validity?.usageCount || 0,
        lastUsed: randomCookie.validity?.lastUsed || null
      }
    });

  } catch (error) {
    console.error('Error getting random cookies:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      total: 0,
      cookies: [],
      error: error.message
    });
  }
});

// Pool Management endpoints
app.get(`${config.api.prefix}/pool/status`, async (req, res) => {
  try {
    const stats = await CookieService.getStats();
    const activeCount = await CookieService.getCookieCount();
    
    res.json({
      success: true,
      status: poolManager?.isRunning ? 'running' : 'stopped',
      activeCookies: activeCount,
      poolStats: poolManager?.getStats() || null,
      stats: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error getting pool status',
      error: error.message
    });
  }
});

app.post(`${config.api.prefix}/pool/start`, async (req, res) => {
  try {
    if (!poolManager) {
      poolManager = new CookiePoolManager({
        minCookiePool: 500,        // Keep at least 500 cookies
        maxCookiePool: 700,        // Maximum 700 cookies (target ~600)
        visitInterval: 2000,       // Check every 2 seconds for faster generation
        cleanupInterval: 300000,   // Cleanup every 5 minutes
        maxRetries: 2,
        maxConcurrentBrowsers: 3
      });
    }
    
    if (!poolManager.isRunning) {
      await poolManager.start();
      res.json({
        success: true,
        message: 'Cookie pool started successfully'
      });
    } else {
      res.json({
        success: true,
        message: 'Cookie pool is already running'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error starting pool',
      error: error.message
    });
  }
});

app.post(`${config.api.prefix}/pool/stop`, async (req, res) => {
  try {
    if (poolManager && poolManager.isRunning) {
      await poolManager.stop();
      res.json({
        success: true,
        message: 'Cookie pool stopped successfully'
      });
    } else {
      res.json({
        success: true,
        message: 'Cookie pool is not running'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error stopping pool',
      error: error.message
    });
  }
});

app.post(`${config.api.prefix}/pool/cleanup`, async (req, res) => {
  try {
    const result = await CookieService.cleanupExpiredCookies();
    res.json({
      success: true,
      message: `Cleaned up ${result.deletedCount} expired cookies`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error during cleanup',
      error: error.message
    });
  }
});

// API routes
app.use(`${config.api.prefix}/cookies`, cookieRoutes);
app.use(`${config.api.prefix}/refresh`, refreshRoutes);
app.use(`${config.api.prefix}/events`, eventRoutes);

// Root endpoint with API documentation
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Cookies Management Service API',
    version: '1.0.0',
    endpoints: {
      cookies: {
        'GET /api/v1/cookies': '🍪 Get fresh cookies with tmpt value (main endpoint)',
        'GET /api/v1/cookies/random': '🎲 Get one random cookie set with full data'
      },
      pool: {
        'GET /api/v1/pool/status': '📊 Check cookie pool status and stats',
        'POST /api/v1/pool/start': '▶️ Start cookie pool generator',
        'POST /api/v1/pool/stop': '⏹️ Stop cookie pool generator',
        'POST /api/v1/pool/cleanup': '🧹 Manually cleanup expired cookies'
      },
      events: {
        'GET /api/v1/events': 'Get events list',
        'POST /api/v1/events': 'Add new events'
      },
      health: {
        'GET /health': '💚 Service health check'
      }
    },
    documentation: 'https://github.com/your-repo/cookies-service#api-documentation'
  });
});

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await database.connect();
    
    // Start listening
    app.listen(config.port, () => {
      console.log(`🚀 Cookies Service running on port ${config.port}`);
      console.log(`📊 Environment: ${config.env}`);
      console.log(`🔗 API Base URL: http://localhost:${config.port}${config.api.prefix}`);
      console.log(`💾 Database: ${config.database.uri}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  try {
    await database.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully...');
  try {
    await database.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

// Auto-start cookie pool when app starts
async function initializeApp() {
  try {
    await startServer();
    
    // Auto-start cookie pool
    console.log('🤖 Auto-starting cookie pool...');
    if (!poolManager) {
      poolManager = new CookiePoolManager({
        minCookiePool: 500,        // Keep at least 500 cookies
        maxCookiePool: 700,        // Maximum 700 cookies (target ~600)
        visitInterval: 2000,       // Check every 2 seconds for faster generation
        cleanupInterval: 300000,   // Cleanup every 5 minutes
        maxRetries: 2,
        maxConcurrentBrowsers: 3
      });
    }
    
    await poolManager.start();
    console.log('✅ Cookie pool started automatically');
    
  } catch (error) {
    console.error('❌ Failed to initialize app:', error);
  }
}

// Start the server and cookie pool
initializeApp();

export default app;