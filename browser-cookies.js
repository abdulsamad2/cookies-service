import {devices } from "playwright";
import fs from "fs/promises";
import path from "path";
import { chromium } from 'playwright-extra'

import { BrowserFingerprint } from "./browserFingerprint.js";
import stealth from 'puppeteer-extra-plugin-stealth'
import proxyHelper from './helpers/proxy.js'
stealth()
// Device settings
const iphone13 = devices["iPhone 13"];

// Constants
const COOKIES_FILE = "cookies.json";
const CONFIG = {
  COOKIE_REFRESH_INTERVAL: 45 * 60 * 1000, // 20 minutes (standardized timing)
  PAGE_TIMEOUT: 45000,
  MAX_RETRIES: 5,
  RETRY_DELAY: 10000,
  CHALLENGE_TIMEOUT: 10000,
  COOKIE_REFRESH_TIMEOUT: 2 * 60 * 1000, // 2 minutes timeout for cookie refresh
  MAX_REFRESH_RETRIES: 3, // Maximum retries for cookie refresh with new proxy/event
};

let browser = null;
let failedProxies = new Set(); // Track failed proxies
let proxyHealthMap = new Map(); // Track proxy success rates

/**
 * Gets a random location for browser fingerprinting
 */
function getRandomLocation() {
  const locations = [
    // US Major Cities
    { locale: 'en-US', timezone: 'America/Los_Angeles', latitude: 34.052235, longitude: -118.243683 },
    { locale: 'en-US', timezone: 'America/New_York', latitude: 40.712776, longitude: -74.005974 },
    { locale: 'en-US', timezone: 'America/Chicago', latitude: 41.878113, longitude: -87.629799 },
    { locale: 'en-US', timezone: 'America/Denver', latitude: 39.739235, longitude: -104.990250 },
    { locale: 'en-US', timezone: 'America/Phoenix', latitude: 33.448143, longitude: -112.096962 },
    { locale: 'en-US', timezone: 'America/Detroit', latitude: 42.331429, longitude: -83.045753 },
    { locale: 'en-US', timezone: 'America/Anchorage', latitude: 61.217381, longitude: -149.863129 },
    
    // Canada
    { locale: 'en-CA', timezone: 'America/Toronto', latitude: 43.651070, longitude: -79.347015 },
    { locale: 'en-CA', timezone: 'America/Vancouver', latitude: 49.246292, longitude: -123.116226 },
    { locale: 'fr-CA', timezone: 'America/Montreal', latitude: 45.508888, longitude: -73.561668 },
    
    // UK & Ireland
    { locale: 'en-GB', timezone: 'Europe/London', latitude: 51.507351, longitude: -0.127758 },
    { locale: 'en-GB', timezone: 'Europe/Dublin', latitude: 53.349804, longitude: -6.260310 },
    
    // Australia
    { locale: 'en-AU', timezone: 'Australia/Sydney', latitude: -33.865143, longitude: 151.209900 },
    { locale: 'en-AU', timezone: 'Australia/Melbourne', latitude: -37.840935, longitude: 144.946457 },
  ];
  
  return locations[Math.floor(Math.random() * locations.length)];
}

/**
 * Generate a realistic iPhone user agent with more variety
 */
function getRealisticIphoneUserAgent() {
  const iOSVersions = [
    '15_0', '15_1', '15_2', '15_3', '15_4', '15_5', '15_6', '15_7',
    '16_0', '16_1', '16_2', '16_3', '16_4', '16_5', '16_6', '16_7',
    '17_0', '17_1', '17_2', '17_3', '17_4', '17_5'
  ];
  
  const devices = [
    'iPhone; CPU iPhone OS',
    'iPad; CPU OS'
  ];
  
  const webKitVersions = ['605.1.15', '606.1.17', '607.1.18', '608.1.20'];
  const safariVersions = ['604.1', '605.1', '606.1', '607.1'];
  
  const version = iOSVersions[Math.floor(Math.random() * iOSVersions.length)];
  const device = devices[Math.floor(Math.random() * devices.length)];
  const webkit = webKitVersions[Math.floor(Math.random() * webKitVersions.length)];
  const safari = safariVersions[Math.floor(Math.random() * safariVersions.length)];
  
  return `Mozilla/5.0 (${device} ${version} like Mac OS X) AppleWebKit/${webkit} (KHTML, like Gecko) Version/${version.split('_')[0]}.0 Mobile/15E148 Safari/${safari}`;
}

/**
 * Get a random proxy from the proxy list, avoiding recently failed ones
 */
function getRandomProxy(avoidFailedProxies = true) {
  const proxies = proxyHelper.proxies;
  if (!proxies || proxies.length === 0) {
    console.warn('No proxies available in proxy helper');
    return null;
  }
  
  let availableProxies = proxies;
  
  // Filter out recently failed proxies if requested
  if (avoidFailedProxies && failedProxies.size > 0) {
    availableProxies = proxies.filter(proxy => !failedProxies.has(proxy.proxy));
    
    // If all proxies have failed recently, clear the failed list and use all proxies
    if (availableProxies.length === 0) {
      console.log('All proxies marked as failed, clearing failed proxy list');
      failedProxies.clear();
      availableProxies = proxies;
    }
  }
  
  const randomIndex = Math.floor(Math.random() * availableProxies.length);
  const selectedProxy = availableProxies[randomIndex];
  
  console.log(`Selected proxy: ${selectedProxy.proxy} (${availableProxies.length}/${proxies.length} available)`);
  return selectedProxy;
}

/**
 * Mark a proxy as failed
 */
function markProxyAsFailed(proxyString) {
  if (proxyString) {
    failedProxies.add(proxyString);
    console.log(`Marked proxy as failed: ${proxyString}`);
    
    // Clear failed proxies after some time to allow retry
    setTimeout(() => {
      failedProxies.delete(proxyString);
      console.log(`Removed proxy from failed list: ${proxyString}`);
    }, 10 * 60 * 1000); // 10 minutes
  }
}

/**
 * Get a fresh proxy that's different from the current one
 */
function getFreshProxy(currentProxy) {
  const proxies = proxyHelper.proxies;
  if (!proxies || proxies.length <= 1) {
    return getRandomProxy();
  }
  
  let attempts = 0;
  let freshProxy = null;
  
  while (attempts < 10) {
    freshProxy = getRandomProxy(true);
    
    // If no current proxy or found a different one, return it
    if (!currentProxy || !currentProxy.proxy || freshProxy.proxy !== currentProxy.proxy) {
      console.log(`Selected fresh proxy: ${freshProxy.proxy}`);
      return freshProxy;
    }
    
    attempts++;
  }
  
  // Fallback: return any random proxy
  return getRandomProxy(false);
}

/**
 * Enhance fingerprint with more browser properties
 */
function enhancedFingerprint() {
  const baseFingerprint = BrowserFingerprint.generate();
  
  // Add additional properties to make fingerprint more realistic
  return {
    ...baseFingerprint,
    webgl: {
      vendor: "Apple Inc.",
      renderer: "Apple GPU",
    },
    fonts: [
      "Arial",
      "Courier New",
      "Georgia",
      "Times New Roman",
      "Trebuchet MS",
      "Verdana"
    ],
    plugins: [
      "PDF Viewer",
      "Chrome PDF Viewer",
      "Chromium PDF Viewer",
      "Microsoft Edge PDF Viewer",
      "WebKit built-in PDF"
    ],
    screen: {
      width: 390,
      height: 844,
      availWidth: 390,
      availHeight: 844,
      colorDepth: 24,
      pixelDepth: 24
    },
    timezone: {
      offset: new Date().getTimezoneOffset()
    }
  };
}

/**
 * Simulate various mobile interactions to appear more human-like
 */
async function simulateMobileInteractions(page) {
  try {
    // Get viewport size
    const viewportSize = page.viewportSize();
    if (!viewportSize) return;
    
    // Random scroll amounts
    const scrollOptions = [
      { direction: 'down', amount: 200 },
      { direction: 'down', amount: 500 },
      { direction: 'down', amount: 800 },
      { direction: 'up', amount: 200 },
      { direction: 'up', amount: 400 }
    ];
    
    // Pick 2-3 random scroll actions
    const scrollCount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < scrollCount; i++) {
      const option = scrollOptions[Math.floor(Math.random() * scrollOptions.length)];
      
      // Scroll with a dynamic speed
      const scrollY = option.direction === 'down' ? option.amount : -option.amount;
      await page.evaluate((y) => {
        window.scrollBy({
          top: y,
          behavior: 'smooth'
        });
      }, scrollY);
      
      // More realistic pause between scrolls (1000-3500ms)
      await page.waitForTimeout(1000 + Math.floor(Math.random() * 2500));
    }
    
    // Simulate random taps/clicks (1-2 times)
    const tapCount = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < tapCount; i++) {
      // Random position within viewport
      const x = 50 + Math.floor(Math.random() * (viewportSize.width - 100));
      const y = 150 + Math.floor(Math.random() * (viewportSize.height - 300));
      
      await page.mouse.click(x, y);
      await page.waitForTimeout(800 + Math.floor(Math.random() * 1800));
    }
  } catch (error) {
    console.warn("Error during mobile interaction simulation:", error.message);
  }
}

/**
 * Initialize the browser with enhanced fingerprinting
 */

async function initBrowser(proxy) {
  let context = null;
  
  try {
    // If no proxy is provided, get a random one
    if (!proxy) {
      proxy = getRandomProxy();
    }
    
    // Get randomized human-like properties
    const location = getRandomLocation();
    
    // For persisting browser sessions, use same browser if possible
    if (!browser || !browser.isConnected()) {
      // Launch options - headed mode for visibility
      const launchOptions = {
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ],
        timeout: 60000,
      };

      if (proxy && typeof proxy === 'object' && proxy.proxy) {
        try {
          // Extract hostname and port from proxy string
          const proxyString = proxy.proxy;
          
          // Ensure proxyString is a string before using string methods
          if (typeof proxyString !== 'string') {
            throw new Error('Invalid proxy format: proxy.proxy must be a string, got ' + typeof proxyString);
          }
          
          // Check if proxy string is in correct format (host:port)
          if (!proxyString.includes(':')) {
            throw new Error('Invalid proxy format: ' + proxyString);
          }
          
          const [hostname, portStr] = proxyString.split(':');
          const port = parseInt(portStr) || 80;
          
          launchOptions.proxy = {
            server: `http://${hostname}:${port}`,
            username: proxy.username,
            password: proxy.password,
          };
          
          console.log(`Configuring browser with proxy: ${hostname}:${port}`);
        } catch (error) {
          console.warn('Invalid proxy configuration, launching without proxy:', error);
        }
      }

      // Launch browser
      chromium.use(stealth)
      browser = await chromium.launch(launchOptions);
    }
    
    // Create new context with enhanced fingerprinting
    const deviceOptions = {
      ...iphone13,
      userAgent: getRealisticIphoneUserAgent(),
      locale: location.locale,
      colorScheme: ["dark", "light", "no-preference"][Math.floor(Math.random() * 3)],
      timezoneId: location.timezone,
      geolocation: {
        latitude: location.latitude + (Math.random() - 0.5) * 0.01, // Small random offset
        longitude: location.longitude + (Math.random() - 0.5) * 0.01,
        accuracy: 50 + Math.random() * 100,
      },
      permissions: [
        "geolocation",
        "notifications",
        ...(Math.random() > 0.3 ? ["microphone"] : []),
        ...(Math.random() > 0.4 ? ["camera"] : []),
        ...(Math.random() > 0.7 ? ["midi"] : []),
      ],
      deviceScaleFactor: 2 + Math.random() * 1.0,
      hasTouch: true,
      isMobile: Math.random() > 0.1, // Occasionally false to mix things up
      javaScriptEnabled: true,
      acceptDownloads: Math.random() > 0.2,
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      reducedMotion: Math.random() > 0.8 ? 'reduce' : 'no-preference',
      forcedColors: Math.random() > 0.95 ? 'active' : 'none',
      extraHTTPHeaders: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
        "Accept-Language": `${location.locale},en;q=0.9${Math.random() > 0.7 ? ',*;q=0.5' : ''}`,
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": Math.random() > 0.5 ? "no-cache" : "max-age=0",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "DNT": Math.random() > 0.6 ? "1" : "0",
        "Upgrade-Insecure-Requests": "1",
        "Pragma": Math.random() > 0.3 ? "no-cache" : undefined,
        "Sec-CH-UA": `"Not_A Brand";v="8", "Chromium";v="${120 + Math.floor(Math.random() * 10)}", "Safari";v="${16 + Math.floor(Math.random() * 2)}"`,
        "Sec-CH-UA-Mobile": "?1",
        "Sec-CH-UA-Platform": "\"iOS\"",
        ...(Math.random() > 0.8 ? { "X-Requested-With": "XMLHttpRequest" } : {})
      },
      viewport: {
        width: [375, 390, 414][Math.floor(Math.random() * 3)],
        height: [667, 736, 812, 844][Math.floor(Math.random() * 4)]
      }
    };
    
    context = await browser.newContext(deviceOptions);
    
    // Create a new page and simulate human behavior
    const page = await context.newPage();
    await page.waitForTimeout(2000 + Math.random() * 3000); // Longer initial delay
    await simulateMobileInteractions(page);
    
    return { context, fingerprint: enhancedFingerprint(), page, browser };
  } catch (error) {
    console.error("Error initializing browser:", error.message);
    
    // Cleanup on error
    if (context) await context.close().catch(() => {});
    
    throw error;
  }
}

/**
 * Handle Ticketmaster challenge pages (CAPTCHA, etc.)
 */
async function handleTicketmasterChallenge(page) {
  const startTime = Date.now();

  try {
    // Enhanced challenge detection
    const challengePresent = await page.evaluate(() => {
      const bodyText = document.body.textContent || '';
      const title = document.title || '';
      
      // Check for various challenge indicators
      return bodyText.includes("Your Browsing Activity Has Been Paused") ||
             bodyText.includes("Access Denied") ||
             bodyText.includes("Blocked") ||
             bodyText.includes("Security Check") ||
             bodyText.includes("Please verify") ||
             bodyText.includes("Bot detection") ||
             title.includes("Access Denied") ||
             title.includes("Blocked") ||
             document.querySelector('.challenge-page') !== null ||
             document.querySelector('[data-testid="challenge"]') !== null ||
             document.querySelector('.captcha') !== null;
    }).catch(() => false); // Catch any navigation errors

    if (challengePresent) {
      console.log("Detected Ticketmaster challenge, attempting resolution...");
      await page.waitForTimeout(1000 + Math.random() * 1000);

      // More realistic human-like behavior during challenge
      try {
        const viewportSize = page.viewportSize();
        if (viewportSize) {
          // Multiple random mouse movements
          for (let i = 0; i < 3; i++) {
            await page.mouse.move(
              Math.floor(Math.random() * viewportSize.width),
              Math.floor(Math.random() * viewportSize.height),
              { steps: 10 + Math.floor(Math.random() * 10) }
            );
            await page.waitForTimeout(800 + Math.random() * 1500);
          }
          
          // Simulate scrolling behavior
          await page.evaluate(() => {
            window.scrollBy(0, 100 + Math.random() * 200);
          });
          await page.waitForTimeout(1000 + Math.random() * 2000);
        }
      } catch (moveError) {
        console.warn("Mouse movement error in challenge, continuing:", moveError.message);
      }

      // Look for various types of challenge buttons and elements
      const selectors = [
        'button',
        'input[type="submit"]',
        'input[type="button"]',
        '[role="button"]',
        '.btn',
        '.button',
        'a[href*="continue"]',
        '[data-testid*="continue"]',
        '[data-testid*="verify"]'
      ];
      
      let buttonClicked = false;
      
      for (const selector of selectors) {
        if (Date.now() - startTime > CONFIG.CHALLENGE_TIMEOUT) {
          console.warn("Challenge timeout, continuing without resolution");
          return false;
        }
        
        try {
          const elements = await page.$$(selector).catch(() => []);
          
          for (const element of elements) {
            try {
              const text = await element.textContent();
              const isVisible = await element.isVisible().catch(() => false);
              
              if (isVisible && text && (
                text.toLowerCase().includes("continue") ||
                text.toLowerCase().includes("verify") ||
                text.toLowerCase().includes("proceed") ||
                text.toLowerCase().includes("next") ||
                text.toLowerCase().includes("submit") ||
                text.toLowerCase().includes("confirm")
              )) {
                await page.waitForTimeout(1000 + Math.random() * 2000); // Human-like delay
                await element.click();
                buttonClicked = true;
                console.log(`Clicked challenge button with text: "${text}"`);
                break;
              }
            } catch (buttonError) {
              console.warn("Button interaction error, continuing:", buttonError.message);
              continue;
            }
          }
          
          if (buttonClicked) break;
        } catch (selectorError) {
          continue;
        }
      }

      if (!buttonClicked) {
        console.warn("Could not find challenge button, trying alternative methods...");
        
        // Try pressing common keys that might bypass challenges
        try {
          await page.keyboard.press('Tab');
          await page.waitForTimeout(500);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1000);
          console.log("Attempted keyboard navigation for challenge");
        } catch (keyError) {
          console.warn("Keyboard challenge resolution failed:", keyError.message);
        }
        
        // Try clicking in the center of the page
        try {
          const viewport = page.viewportSize();
          if (viewport) {
            await page.click(viewport.width / 2, viewport.height / 2);
            await page.waitForTimeout(1000);
            console.log("Attempted center click for challenge");
          }
        } catch (clickError) {
          console.warn("Center click challenge resolution failed:", clickError.message);
        }
      }

      await page.waitForTimeout(3000 + Math.random() * 2000); // Longer wait
      const stillChallenged = await page.evaluate(() => {
        return document.body.textContent.includes(
          "Your Browsing Activity Has Been Paused"
        );
      }).catch(() => false);

      if (stillChallenged) {
        console.warn("Challenge not resolved, continuing without resolution");
        return false;
      }
    }
    return true;
  } catch (error) {
    console.warn("Challenge handling failed, continuing:", error.message);
    return false;
  }
}

/**
 * Check for Ticketmaster challenge page
 */
async function checkForTicketmasterChallenge(page) {
  try {
    // Check for CAPTCHA or other blocking mechanisms
    const challengeSelector = "#challenge-running"; // Example selector for CAPTCHA
    const isChallengePresent = (await page.$(challengeSelector)) !== null;

    if (isChallengePresent) {
      console.warn("Ticketmaster challenge detected");
      return true;
    }

    // Also check via text content
    const challengePresent = await page.evaluate(() => {
      return document.body.textContent.includes(
        "Your Browsing Activity Has Been Paused"
      );
    }).catch(() => false);

    return challengePresent;
  } catch (error) {
    console.error("Error checking for Ticketmaster challenge:", error);
    return false;
  }
}

/**
 * Capture cookies from the browser
 */
async function captureCookies(page, fingerprint) {
  let retryCount = 0;
  const MAX_RETRIES = 5;
  
  while (retryCount < MAX_RETRIES) {
    try {
      const challengePresent = await page.evaluate(() => {
        return document.body.textContent.includes(
          "Your Browsing Activity Has Been Paused"
        );
      }).catch(() => false);

      if (challengePresent) {
        console.log(
          `Attempt ${retryCount + 1}: Challenge detected during cookie capture`
        );

        const challengeResolved = await handleTicketmasterChallenge(page);
        if (!challengeResolved) {
          if (retryCount === MAX_RETRIES - 1) {
            console.log("Max retries reached during challenge resolution");
            return { cookies: null, fingerprint };
          }
          await page.waitForTimeout(CONFIG.RETRY_DELAY);
          retryCount++;
          continue;
        }
      }

      // Get context from page's browser context
      const context = page.context();
      if (!context) {
        throw new Error("Cannot access browser context from page");
      }

      let cookies = await context.cookies().catch(() => []);

      if (!cookies?.length) {
        console.log(`Attempt ${retryCount + 1}: No cookies captured`);
        if (retryCount === MAX_RETRIES - 1) {
          return { cookies: null, fingerprint };
        }
        await page.waitForTimeout(CONFIG.RETRY_DELAY);
        retryCount++;
        continue;
      }

      // Filter out reCAPTCHA Google cookies
      cookies = cookies.filter(cookie => !cookie.name.includes('_grecaptcha') && 
                                      !cookie.domain.includes('google.com'));

      // Check if we have enough cookies from ticketmaster.com
      const ticketmasterCookies = cookies.filter(cookie => 
        cookie.domain.includes('ticketmaster.com') || 
        cookie.domain.includes('.ticketmaster.com')
      );

      if (ticketmasterCookies.length < 3) {
        console.log(`Attempt ${retryCount + 1}: Not enough Ticketmaster cookies`);
        if (retryCount === MAX_RETRIES - 1) {
          return { cookies: null, fingerprint };
        }
        await page.waitForTimeout(CONFIG.RETRY_DELAY);
        retryCount++;
        continue;
      }

      // Check JSON size
      const cookiesJson = JSON.stringify(cookies, null, 2);
      const lineCount = cookiesJson.split('\n').length;
      
      if (lineCount < 200) {
        console.log(`Attempt ${retryCount + 1}: Cookie JSON too small (${lineCount} lines)`);
        if (retryCount === MAX_RETRIES - 1) {
          return { cookies: null, fingerprint };
        }
        await page.waitForTimeout(CONFIG.RETRY_DELAY);
        retryCount++;
        continue;
      }

      // Keep original cookie expiration times

      // Add cookies one at a time with error handling
      for (const cookie of cookies) {
        try {
          await context.addCookies([cookie]);
        } catch (error) {
          console.warn(`Error adding cookie ${cookie.name}:`, error.message);
        }
      }

      console.log(`Successfully captured ${cookies.length} fresh cookies on attempt ${retryCount + 1}`);
      return { cookies, fingerprint };
    } catch (error) {
      console.error(`Error capturing cookies on attempt ${retryCount + 1}:`, error);
      if (retryCount === MAX_RETRIES - 1) {
        return { cookies: null, fingerprint };
      }
      await page.waitForTimeout(CONFIG.RETRY_DELAY);
      retryCount++;
    }
  }

  return { cookies: null, fingerprint };
}

// Removed saveCookiesToFile - cookies are only stored in database

// Removed loadCookiesFromFile - always generate fresh cookies

/**
 * Load existing cookies from database to seed browser session
 */
async function loadExistingCookiesFromDB() {
  try {
    // This would typically import CookieService, but to avoid circular dependency
    // we'll implement a simple database query here
    const { Cookie } = await import('./models/index.js');
    
    const existingCookie = await Cookie.findOne({
      status: 'active',
      'validity.isValid': true,
      'validity.expiresAt': { $gt: new Date() }
    }).sort({ 'quality.score': -1 });
    
    if (existingCookie && existingCookie.cookies) {
      console.log(`🍪 Found existing cookies to seed browser session (${existingCookie.cookies.length} cookies)`);
      return existingCookie.cookies.filter(cookie => 
        cookie.domain && cookie.domain.includes('ticketmaster')
      );
    }
    
    return null;
  } catch (error) {
    console.warn('Could not load existing cookies from database:', error.message);
    return null;
  }
}

/**
 * Seed browser context with existing cookies for more natural behavior
 */
async function seedBrowserWithCookies(context, existingCookies) {
  if (!existingCookies || !Array.isArray(existingCookies)) {
    return false;
  }
  
  try {
    // Add cookies to the browser context
    const validCookies = existingCookies.filter(cookie => {
      return cookie.name && cookie.value && cookie.domain;
    });
    
    if (validCookies.length > 0) {
      await context.addCookies(validCookies);
      console.log(`✅ Seeded browser with ${validCookies.length} existing cookies`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.warn('Failed to seed browser with cookies:', error.message);
    return false;
  }
}

/**
 * Get fresh cookies by opening a browser and navigating to any URL
 */
async function refreshCookies(url, proxy = null) {
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount <= CONFIG.MAX_REFRESH_RETRIES) {
    let localContext = null;
    let page = null;
    let browserInstance = null;
    let timeoutId = null;
    
    try {
      console.log(`Refreshing cookies from URL ${url} (attempt ${retryCount + 1}/${CONFIG.MAX_REFRESH_RETRIES + 1})`);

      // Use a completely fresh proxy for each retry attempt
      let currentProxy;
      if (proxy) {
        currentProxy = proxy; // Use specified proxy
      } else if (retryCount === 0) {
        currentProxy = getRandomProxy(); // First attempt: random proxy
      } else {
        currentProxy = getFreshProxy(currentProxy); // Retry: force different proxy
      }
      
      if (currentProxy) {
        console.log(`Using proxy for attempt ${retryCount + 1}: ${currentProxy.proxy}`);
      }

      // Load existing cookies to seed browser session (avoid bot detection)
      const existingCookies = await loadExistingCookiesFromDB();
      
      // Create a promise that will be resolved/rejected based on timeout
      const refreshPromise = new Promise(async (resolve, reject) => {
        // Set up timeout
        timeoutId = setTimeout(() => {
          reject(new Error(`Cookie refresh timeout after ${CONFIG.COOKIE_REFRESH_TIMEOUT / 1000} seconds`));
        }, CONFIG.COOKIE_REFRESH_TIMEOUT);
        
        try {

          // Initialize browser with improved error handling
          let initAttempts = 0;
          let initSuccess = false;
          let initError = null;
          
          while (initAttempts < 3 && !initSuccess) {
            try {
              const result = await initBrowser(currentProxy);
              if (!result || !result.context || !result.fingerprint) {
                throw new Error("Failed to initialize browser or generate fingerprint");
              }
              
              browserInstance = result.browser;
              localContext = result.context;
              page = result.page;
              
              initSuccess = true;
            } catch (error) {
              initAttempts++;
              initError = error;
              console.error(`Browser init attempt ${initAttempts} failed:`, error.message);
              
              // Mark proxy as failed if it's a proxy-related error
              if (currentProxy && (error.message.includes('proxy') || error.message.includes('ECONNREFUSED') || error.message.includes('timeout'))) {
                markProxyAsFailed(currentProxy.proxy);
              }
              
              await new Promise(resolve => setTimeout(resolve, 1000 * initAttempts));
            }
          }
          
          if (!initSuccess) {
            console.error("All browser initialization attempts failed");
            throw initError || new Error("Failed to initialize browser");
          }

          // Seed browser with existing cookies for more natural behavior
          if (existingCookies) {
            await seedBrowserWithCookies(localContext, existingCookies);
          }

          // Navigate to the provided URL
          console.log(`Navigating to ${url}`);
          
          // Add pre-navigation delay to seem more human
          await page.waitForTimeout(1500 + Math.random() * 2000);
          
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: CONFIG.PAGE_TIMEOUT
          });
          
          // Check if the page loaded properly
          const currentUrl = page.url();
          console.log(`Successfully loaded page: ${currentUrl}`);
          
          // Wait for page to fully settle (more human-like)
          await page.waitForTimeout(3000 + Math.random() * 4000);
          
          // Check for Ticketmaster challenge
          const isChallengePresent = await checkForTicketmasterChallenge(page);
          if (isChallengePresent) {
            console.warn("Detected Ticketmaster challenge page, attempting to resolve...");
            await handleTicketmasterChallenge(page);
          }
          
          // Wait for page to fully load with existing cookies
          await page.waitForTimeout(1000 + Math.random() * 2000);
          
          // Simulate human behavior
          await simulateMobileInteractions(page);
          
          // Additional natural browsing - scroll and wait
          await page.evaluate(() => {
            window.scrollTo(0, Math.floor(document.body.scrollHeight * 0.3));
          });
          await page.waitForTimeout(1000 + Math.random() * 1500);
          
          // Scroll to bottom to trigger any lazy loading
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await page.waitForTimeout(1500 + Math.random() * 1000);
          
          // Wait for cookies to be updated/set
          await page.waitForTimeout(2000);
          
          // Capture cookies
          const fingerprint = BrowserFingerprint.generate();
          const { cookies } = await captureCookies(page, fingerprint);
          
          if (!cookies || cookies.length === 0) {
            throw new Error("Failed to capture cookies");
          }
          
          // Clear timeout and resolve with success
          clearTimeout(timeoutId);
          resolve({
            cookies,
            fingerprint,
            lastRefresh: Date.now()
          });
        } catch (error) {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      
      // Wait for the refresh promise to complete
      const result = await refreshPromise;
      return result;
    } catch (error) {
      lastError = error;
      console.error(`Cookie refresh attempt ${retryCount + 1} failed: ${error.message}`);
      
      // Check if this was a timeout error
      const isTimeout = error.message.includes('timeout');
      
      if (isTimeout && retryCount < CONFIG.MAX_REFRESH_RETRIES) {
        console.log(`Cookie refresh timed out, will retry...`);
        
        // Get a new proxy for retry
        if (proxy) {
          const newProxy = await getAlternativeProxy(proxy);
          if (newProxy) {
            console.log(`Using alternative proxy for retry: ${newProxy.host}:${newProxy.port}`);
            proxy = newProxy;
          }
        }
      }
      
      retryCount++;
      
      // If we've exhausted all retries, throw the last error
      if (retryCount > CONFIG.MAX_REFRESH_RETRIES) {
        console.error(`All cookie refresh attempts failed after ${CONFIG.MAX_REFRESH_RETRIES + 1} tries`);
        throw lastError;
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * retryCount));
      
    } finally {
      // Close page and context but keep browser open for reuse
      if (page) {
        try {
          await page.close().catch(e => console.error("Error closing page:", e));
        } catch (e) {
          console.error("Error closing page in finally block:", e);
        }
      }
      
      if (localContext) {
        try {
          await localContext.close().catch(e => console.error("Error closing context:", e));
        } catch (e) {
          console.error("Error closing context in finally block:", e);
        }
      }
    }
  }
  
  // This should never be reached, but just in case
  throw lastError || new Error('Cookie refresh failed after all retries');
}

/**
 * Generate an alternative event ID for retry attempts
 * This function attempts to find a similar event or generates a fallback
 */
async function generateAlternativeEventId(originalEventId) {
  try {
    // For now, we'll generate a simple variation of the original event ID
    // In a production environment, this could query a database for similar events
    const timestamp = Date.now().toString().slice(-6);
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    
    // Create a variation that's likely to be a valid event ID format
    const alternativeId = originalEventId.replace(/\d+$/, timestamp + randomSuffix);
    
    console.log(`Generated alternative event ID: ${alternativeId} from original: ${originalEventId}`);
    return alternativeId;
  } catch (error) {
    console.warn(`Failed to generate alternative event ID: ${error.message}`);
    return originalEventId; // Fallback to original
  }
}

/**
 * Get an alternative proxy for retry attempts
 * This function returns a different proxy from the pool
 */
async function getAlternativeProxy(currentProxy) {
  try {
    const proxies = proxyHelper.proxies;
    if (!proxies || proxies.length === 0) {
      console.warn('No proxies available for alternative selection');
      return null;
    }
    
    // If we have only one proxy, return it
    if (proxies.length === 1) {
      return proxies[0];
    }
    
    // Try to find a different proxy than the current one
    let attempts = 0;
    let alternativeProxy = null;
    
    while (attempts < 5) {
      alternativeProxy = getRandomProxy();
      
      // If no current proxy or found a different one, return it
      if (!currentProxy || !currentProxy.proxy || alternativeProxy.proxy !== currentProxy.proxy) {
        console.log(`Selected alternative proxy: ${alternativeProxy.proxy}`);
        return alternativeProxy;
      }
      
      attempts++;
    }
    
    // If we couldn't find a different proxy after 5 attempts, return a random one anyway
    console.log(`Could not find different proxy after 5 attempts, using random proxy: ${alternativeProxy.proxy}`);
    return alternativeProxy;
  } catch (error) {
    console.warn(`Failed to get alternative proxy: ${error.message}`);
    return getRandomProxy(); // Fallback to random proxy
  }
}

/**
 * Clean up browser resources
 */
async function cleanup() {
  if (browser) {
    try {
      await browser.close();
      browser = null;
    } catch (error) {
      console.warn("Error closing browser:", error.message);
    }
  }
}

export {
  initBrowser,
  captureCookies,
  refreshCookies,
  loadExistingCookiesFromDB,
  seedBrowserWithCookies,
  cleanup,
  handleTicketmasterChallenge,
  checkForTicketmasterChallenge,
  enhancedFingerprint,
  getRandomLocation,
  getRealisticIphoneUserAgent,
  getRandomProxy,
  getFreshProxy,
  markProxyAsFailed,
  generateAlternativeEventId,
  getAlternativeProxy,
  simulateMobileInteractions
};