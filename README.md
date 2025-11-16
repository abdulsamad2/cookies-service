# Cookies Management Service

A standalone service for managing cookies with database storage and RESTful API endpoints.

## Quick Start

### Prerequisites
- Node.js 16+ 
- MongoDB
- npm or yarn

### Installation

```bash
# Navigate to the service directory
cd cookies-service

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Configure your MongoDB URI in .env (edit the .env file)
# MONGODB_URI=mongodb://localhost:27017/cookies-service

# Start the service
npm start

# For development with auto-reload
npm run dev
```

The service will start on `http://localhost:3001` by default.

## API Endpoints

### Main Client Endpoints

#### Get Best Cookies (Primary endpoint for client apps)
```http
GET /api/v1/cookies/best?domain=example.com&tags=session,auth
```
Returns the highest quality available cookies matching criteria.

**Response:**
```json
{
  "success": true,
  "data": {
    "cookieId": "uuid-here",
    "cookies": {
      "sessionId": "abc123",
      "authToken": "xyz789"
    },
    "metadata": {
      "domain": "example.com"
    },
    "quality": {
      "score": 95,
      "successRate": 98.5
    },
    "usageInfo": {
      "usageCount": 5,
      "lastUsed": "2025-11-15T10:30:00Z"
    }
  }
}
```

#### Store New Cookies
```http
POST /api/v1/cookies
Content-Type: application/json

{
  "cookies": {
    "sessionId": "abc123",
    "authToken": "xyz789"
  },
  "options": {
    "eventId": "event-123",
    "domain": "example.com",
    "tags": ["session", "auth"],
    "proxy": "proxy.example.com:8080"
  }
}
```

#### Update Cookie Quality (Feedback)
```http
PUT /api/v1/cookies/{cookieId}/quality
Content-Type: application/json

{
  "success": true
}
```

### Client Integration Example

```javascript
// Get cookies for your application
async function getCookiesForDomain(domain) {
  try {
    const response = await fetch(`http://localhost:3001/api/v1/cookies/best?domain=${domain}`);
    const result = await response.json();
    
    if (result.success && result.data) {
      return {
        cookies: result.data.cookies,
        cookieId: result.data.cookieId
      };
    }
    return null;
  } catch (error) {
    console.error('Failed to get cookies:', error);
    return null;
  }
}

// Provide feedback after using cookies
async function reportCookieUsage(cookieId, wasSuccessful) {
  try {
    await fetch(`http://localhost:3001/api/v1/cookies/${cookieId}/quality`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: wasSuccessful })
    });
  } catch (error) {
    console.error('Failed to report cookie usage:', error);
  }
}

// Usage in your scraper
const cookieData = await getCookiesForDomain('example.com');
if (cookieData) {
  // Use the cookies in your requests
  const success = await makeRequestWithCookies(cookieData.cookies);
  
  // Report back the result
  await reportCookieUsage(cookieData.cookieId, success);
}
```

## Other Available Endpoints

### Cookie Management
- `GET /api/v1/cookies` - Get cookies with filtering
- `GET /api/v1/cookies/stats` - Get cookie statistics
- `POST /api/v1/cookies/cleanup` - Clean up expired cookies

### Refresh Management
- `GET /api/v1/refresh/stats` - Get refresh statistics
- `POST /api/v1/refresh/start` - Start refresh operation
- `PUT /api/v1/refresh/:id/complete` - Complete refresh operation

### Health Check
- `GET /health` - Service health check

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
PORT=3001
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/cookies-service
CORS_ORIGIN=*
```

## Running with Docker (Optional)

```bash
# Build and run with docker-compose
docker-compose up -d
```

This will start both the cookies service and MongoDB.

## Development

```bash
# Install dependencies
npm install

# Start development server with auto-reload
npm run dev
```

## License

ISC License