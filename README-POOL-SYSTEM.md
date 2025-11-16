# Cookie Pool Management System

A comprehensive system for automatically managing a massive pool of fresh cookies by retrieving event IDs from the database, visiting URLs, and maintaining cookies for downstream systems.

## Features

- **🎯 Event Management**: Track and manage events with URLs for cookie generation
- **🤖 Automated Cookie Generation**: Continuously visit URLs and generate fresh cookies
- **📊 Pool Management**: Maintain a large pool of active, high-quality cookies
- **🔄 Intelligent Refresh**: Smart scheduling based on priority and success rates
- **📈 Quality Tracking**: Monitor cookie quality and success rates
- **🚀 Scalable Architecture**: Handle hundreds of events and thousands of cookies
- **🛡️ Error Handling**: Robust retry mechanisms and error recovery
- **📱 RESTful API**: Complete API for managing events and retrieving cookies

## Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Setup Environment**
   ```bash
   # Copy and configure environment variables
   cp .env.example .env
   # Edit .env with your MongoDB connection string
   ```

3. **Start the Service**
   ```bash
   npm run dev
   ```

4. **Run the Demo**
   ```bash
   # In a separate terminal
   npm run demo
   ```

## System Architecture

### Core Components

1. **Event Service** - Manages events (URLs to visit)
2. **Cookie Service** - Handles cookie storage and retrieval
3. **Cookie Pool Manager** - Orchestrates the entire process
4. **Browser Integration** - Uses existing browser automation

### Data Models

- **Events**: Store event information, URLs, priorities, and metrics
- **Cookies**: Store generated cookies with quality and usage tracking
- **Cookie Refresh**: Track refresh operations and history

## API Endpoints

### Event Management

```http
# Create a new event
POST /api/v1/events
{
  "eventId": "G5v0Z94RBJkL8",
  "url": "https://www.ticketmaster.com/event/G5v0Z94RBJkL8",
  "title": "Taylor Swift Concert",
  "priority": 10,
  "tags": ["concert", "high-demand"]
}

# Get events
GET /api/v1/events?status=active&limit=50

# Bulk create events
POST /api/v1/events/bulk
{
  "events": [
    { "eventId": "...", "url": "...", "title": "..." },
    { "eventId": "...", "url": "...", "title": "..." }
  ]
}

# Get event statistics
GET /api/v1/events/stats
```

### Pool Management

```http
# Start the cookie pool manager
POST /api/v1/events/pool/start
{
  "minCookiePool": 100,
  "maxCookiePool": 1000,
  "batchSize": 10,
  "visitInterval": 30000
}

# Stop the pool manager
POST /api/v1/events/pool/stop

# Get pool statistics
GET /api/v1/events/pool/stats

# Update configuration
PUT /api/v1/events/pool/config
{
  "minCookiePool": 200,
  "batchSize": 15
}
```

### Cookie Distribution

```http
# Get fresh cookies for downstream systems
GET /api/v1/events/pool/cookies/fresh?domain=ticketmaster.com

# Response:
{
  "success": true,
  "data": {
    "cookieId": "uuid-here",
    "cookies": [ /* cookie array */ ],
    "quality": { "score": 95, "successRate": 98 },
    "metadata": { /* additional info */ }
  }
}
```

## Configuration

The system is highly configurable through the Cookie Pool Manager:

```javascript
{
  minCookiePool: 100,        // Minimum cookies to maintain
  maxCookiePool: 1000,       // Maximum cookies to store
  batchSize: 10,             // Events processed in parallel
  visitInterval: 30000,      // 30 seconds between cycles
  cleanupInterval: 300000,   // 5 minutes cleanup interval
  maxRetries: 3              // Max retries per event
}
```

## Usage Examples

### Basic Setup

```javascript
import CookiePoolManager from './services/cookiePoolManager.js';

// Initialize the pool manager
const poolManager = new CookiePoolManager({
  minCookiePool: 50,
  maxCookiePool: 500,
  batchSize: 5,
  visitInterval: 60000
});

// Start the system
await poolManager.start();
```

### Adding Events

```javascript
import EventService from './services/eventService.js';

// Add single event
await EventService.createEvent({
  eventId: 'G5v0Z94RBJkL8',
  url: 'https://www.ticketmaster.com/event/G5v0Z94RBJkL8',
  title: 'Concert Event',
  priority: 8,
  tags: ['concert', 'popular']
});

// Bulk add events
await EventService.bulkCreateEvents([
  { eventId: '1', url: 'https://...', title: 'Event 1' },
  { eventId: '2', url: 'https://...', title: 'Event 2' }
]);
```

### Getting Fresh Cookies

```javascript
import CookieService from './services/cookieService.js';

// Get the best available cookies
const cookies = await CookieService.getBestCookies({
  domain: 'ticketmaster.com',
  tags: ['auto-generated'],
  excludeUsedRecently: true,
  maxUsageCount: 5
});

// Use the cookies in your downstream system
if (cookies) {
  console.log('Fresh cookies available:', cookies.cookieId);
  // Apply cookies to your HTTP client
}
```

## Monitoring & Statistics

### Real-time Statistics

```http
GET /api/v1/events/pool/stats
```

Returns comprehensive statistics:

```json
{
  "isRunning": true,
  "uptime": 3600,
  "performance": {
    "totalVisits": 150,
    "successfulVisits": 142,
    "failedVisits": 8,
    "successRate": 95,
    "cookiesGenerated": 1420,
    "cookiesPerVisit": 10
  },
  "cookies": {
    "total": 1200,
    "active": 1150,
    "valid": 1100,
    "avgQuality": 87
  },
  "events": {
    "total": 25,
    "active": 23,
    "successRate": 92
  }
}
```

### Quality Metrics

The system tracks:
- **Cookie Quality Score** (0-100)
- **Success Rate** per event
- **Usage Count** per cookie set
- **Response Times** for URL visits
- **Reliability Scores** for events

## Production Deployment

### Environment Variables

```env
# Database
MONGODB_URI=mongodb://localhost:27017/cookies-service

# Pool Configuration
COOKIE_REFRESH_INTERVAL=1800000  # 30 minutes
MAX_COOKIE_AGE=86400000          # 24 hours
MAX_STORED_COOKIES=2000          # Maximum pool size
CLEANUP_INTERVAL=3600000         # 1 hour cleanup

# Performance
MIN_COOKIE_POOL=200              # Minimum pool size
BATCH_SIZE=15                    # Concurrent processing
VISIT_INTERVAL=30000             # 30 seconds between cycles
```

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

### Scaling Considerations

1. **Database Indexing**: Ensure proper indexes on frequently queried fields
2. **Connection Pooling**: Configure MongoDB connection pooling
3. **Load Balancing**: Use multiple instances behind a load balancer
4. **Memory Management**: Monitor memory usage for large cookie pools
5. **Rate Limiting**: Implement rate limiting to prevent abuse

## Maintenance

### Cleanup Operations

```javascript
// Manual cleanup
await poolManager.cleanup();

// Scheduled cleanup (automatic)
// Runs every 5 minutes by default
```

### Health Monitoring

```http
# Service health check
GET /health

# Detailed pool health
GET /api/v1/events/pool/stats
```

### Troubleshooting

1. **Low Cookie Generation**
   - Check event priorities and URLs
   - Verify browser automation is working
   - Review error logs for failed visits

2. **High Memory Usage**
   - Reduce `maxCookiePool` setting
   - Increase cleanup frequency
   - Monitor cookie expiration times

3. **Poor Cookie Quality**
   - Review event selection criteria
   - Check proxy configurations
   - Verify fingerprinting effectiveness

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the ISC License.