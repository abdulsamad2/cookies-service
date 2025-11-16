import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Server Configuration
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  
  // Database Configuration
  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/cookies-service',
    options: {}
  },
  
  // Cookie Service Configuration
  cookies: {
    refreshInterval: process.env.COOKIE_REFRESH_INTERVAL || 30 * 60 * 1000, // 30 minutes
    maxCookieAge: process.env.MAX_COOKIE_AGE || 7 * 24 * 60 * 60 * 1000, // 7 days
    maxStoredCookies: process.env.MAX_STORED_COOKIES || 1000,
    cleanupInterval: process.env.CLEANUP_INTERVAL || 60 * 60 * 1000, // 1 hour
  },
  
  // API Configuration
  api: {
    prefix: '/api/v1',
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100 // limit each IP to 100 requests per windowMs
    }
  },
  
  // Security Configuration
  security: {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true
    },
    helmet: {
      contentSecurityPolicy: false
    }
  }
};

export default config;