# MongoDB Setup Guide for Cookie Service

## Problem
The application cannot connect to MongoDB because the MongoDB server is not running on your local machine.

## Solutions

### Option 1: Install and Start MongoDB Locally (Recommended)

#### 1. Install MongoDB Community Server
- Download from: https://www.mongodb.com/try/download/community
- Choose "Windows" and "MSI" package
- Run the installer and follow the setup wizard
- **Important**: During installation, make sure to install MongoDB as a Windows Service

#### 2. Start MongoDB Service
```powershell
# Check if MongoDB service is running
Get-Service -Name MongoDB

# Start MongoDB service if it's stopped
Start-Service -Name MongoDB

# Or use net command
net start MongoDB
```

#### 3. Verify MongoDB is Running
```powershell
# Test connection using MongoDB shell (if installed)
mongosh

# Or check if port 27017 is listening
netstat -an | findstr :27017
```

### Option 2: Use MongoDB Atlas (Cloud Database)

#### 1. Create MongoDB Atlas Account
- Go to https://cloud.mongodb.com/
- Create a free account
- Create a new cluster (free tier available)

#### 2. Get Connection String
- Click "Connect" on your cluster
- Choose "Connect your application"
- Copy the connection string

#### 3. Update Environment Variables
Create a `.env` file in your project root:
```env
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/cookies-service?retryWrites=true&w=majority
PORT=3001
NODE_ENV=development
```

### Option 3: Use Docker MongoDB

#### 1. Install Docker Desktop
- Download from: https://www.docker.com/products/docker-desktop

#### 2. Run MongoDB Container
```powershell
# Pull and run MongoDB container
docker run -d --name mongodb -p 27017:27017 mongo:latest

# Check if container is running
docker ps
```

## Quick Start Commands

### Check Current Status
```powershell
# Check if MongoDB service exists and is running
Get-Service -Name MongoDB -ErrorAction SilentlyContinue

# Check if port 27017 is in use
netstat -an | findstr :27017
```

### Start the Application
```powershell
# Once MongoDB is running, start the application
npm start

# Or start the cookie pool system
npm run pool
```

## Troubleshooting

### Error: MongoDB service not found
- MongoDB is not installed
- Install MongoDB Community Server following Option 1

### Error: Access denied starting service
- Run PowerShell as Administrator
- Try: `Start-Service -Name MongoDB`

### Error: Port 27017 already in use
- Another application is using the port
- Stop the conflicting service or use a different port

### Connection timeout
- Check Windows Firewall settings
- Make sure MongoDB is allowed through firewall

## Verification Script

Run this PowerShell script to check your MongoDB setup:

```powershell
# Check MongoDB installation and service status
Write-Host "Checking MongoDB setup..." -ForegroundColor Yellow

# Check if MongoDB service exists
$service = Get-Service -Name MongoDB -ErrorAction SilentlyContinue
if ($service) {
    Write-Host "✅ MongoDB service found: $($service.Status)" -ForegroundColor Green
    if ($service.Status -ne "Running") {
        Write-Host "⚠️ MongoDB service is not running. Starting..." -ForegroundColor Yellow
        Start-Service -Name MongoDB -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "❌ MongoDB service not found. Please install MongoDB Community Server." -ForegroundColor Red
}

# Check if port 27017 is listening
$port = netstat -an | findstr :27017
if ($port) {
    Write-Host "✅ Port 27017 is listening" -ForegroundColor Green
} else {
    Write-Host "❌ Port 27017 is not listening" -ForegroundColor Red
}

Write-Host "Setup check complete." -ForegroundColor Yellow
```