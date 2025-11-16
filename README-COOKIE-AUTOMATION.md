# Automated Cookie Pool System

## Overview
This system automatically generates and maintains a pool of fresh cookies by visiting random event URLs every few seconds. The cookies are stored in a database and can be retrieved through API endpoints.

## Features

### Automated Cookie Generation
- Visits random event URLs every 5 seconds
- Uses real browser automation with Playwright
- Generates realistic fingerprints and user agents
- Handles challenges and bot detection
- Stores cookies with metadata in MongoDB

### Cookie Pool Management
- Maintains 50-500 cookies in the pool
- Automatic cleanup of expired cookies
- Quality scoring based on success rates
- Usage tracking and statistics

### API Endpoints

#### Get TMPT Cookies (Main endpoint for downstream systems)
```
GET /api/v1/cookies/tmpt
```

Response format:
```json
{
  "success": true,
  "tmpt": "0:ec860f3709000000:1763277813678:0b73dbb8:657071f9e1b9bca3b6f5f4711c4ab32f:dc8ece475452e9c01b1a2b39d6e369c0fb5bce71dc94082a1c5ba3c2c0d68867",
  "expiry": 1763279613330,
  "total": 4335
}
```

#### Get Best Cookies
```
GET /api/v1/cookies/best?domain=ticketmaster.com&limit=1
```

#### Get All Cookies
```
GET /api/v1/cookies?status=active&limit=10
```

## Usage

### Start the Cookie Pool System
```bash
# Start the cookie generation system
npm run pool

# Start in development mode (with auto-restart)
npm run pool:dev

# Start the API server (separate terminal)
npm start
```

### Using the API
```javascript
// Get fresh cookies with tmpt values
const response = await fetch('http://localhost:3001/api/v1/cookies/tmpt');
const data = await response.json();

if (data.success) {
  const { tmpt, expiry, total } = data;
  console.log('TMPT Value:', tmpt);
  console.log('Expires at:', new Date(expiry));
  console.log('Total cookies in pool:', total);
}
```

## Configuration

The cookie pool can be configured in `start-cookie-pool.js`:

```javascript
const poolManager = new CookiePoolManager({
  minCookiePool: 50,        // Minimum cookies to maintain
  maxCookiePool: 500,       // Maximum cookies to store
  visitInterval: 5000,      // Visit every 5 seconds
  cleanupInterval: 300000,  // Cleanup every 5 minutes
  maxRetries: 2             // Max retries per event
});
```

## How It Works

1. **Event Selection**: The system randomly selects an active event from the database
2. **Browser Automation**: Opens a headless browser and visits the event URL
3. **Cookie Extraction**: Extracts all cookies set by the website
4. **Storage**: Stores cookies in MongoDB with metadata (quality, expiry, usage stats)
5. **API Access**: Provides formatted cookie data through REST endpoints
6. **Cleanup**: Automatically removes expired and low-quality cookies

## Monitoring

The system provides real-time statistics:
- Total visits performed
- Success rate percentage
- Number of cookies generated
- System uptime
- Current pool size

## Database Schema

### Cookies Collection
- `cookieId`: Unique identifier
- `cookies`: Array of cookie objects
- `source`: Event and generation info
- `metadata`: Domain, fingerprint, etc.
- `validity`: Expiry and usage tracking
- `quality`: Success rate and score
- `status`: active/inactive/expired

### Events Collection
- `eventId`: Unique event identifier
- `url`: Event URL to visit
- `title`: Event title
- `priority`: Visit priority (1-10)
- `metrics`: Visit statistics
- `status`: active/inactive

## Security Features

- Rotating user agents and fingerprints
- Proxy support (if configured)
- Challenge detection and handling
- Rate limiting and retry logic
- Secure cookie storage

## Performance

- Processes 1 event every 5 seconds
- Maintains 50-500 cookies in pool
- Automatic scaling based on demand
- Efficient database indexing
- Memory-optimized browser instances