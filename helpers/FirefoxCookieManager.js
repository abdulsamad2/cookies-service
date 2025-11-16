import { chromium } from 'playwright';
import { BrowserFingerprint } from '../browserFingerprint.js';

/**
 * Firefox Cookie Manager for handling cookie refresh operations
 */
class FirefoxCookieManager {
  constructor() {
    this.browser = null;
    this.context = null;
  }

  /**
   * Initialize Firefox browser
   */
  async initBrowser(proxy = null) {
    try {
      const launchOptions = {
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-web-security',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-infobars',
          '--disable-notifications'
        ]
      };

      // Add proxy configuration if provided
      if (proxy && proxy.proxy) {
        try {
          const proxyString = proxy.proxy;
          if (typeof proxyString === 'string' && proxyString.includes(':')) {
            const [hostname, portStr] = proxyString.split(':');
            const port = parseInt(portStr) || 80;

            launchOptions.proxy = {
              server: `http://${hostname}:${port}`,
              username: proxy.username,
              password: proxy.password
            };
          }
        } catch (error) {
          console.warn('Invalid proxy configuration:', error.message);
        }
      }

      this.browser = await chromium.launch(launchOptions);
      
      // Create context with realistic settings
      const fingerprint = BrowserFingerprint.generate('desktop');
      
      this.context = await this.browser.newContext({
        userAgent: BrowserFingerprint.generateUserAgent(fingerprint),
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        permissions: ['geolocation'],
        colorScheme: 'light',
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        }
      });

      return { browser: this.browser, context: this.context };
    } catch (error) {
      console.error('Error initializing Firefox browser:', error);
      throw error;
    }
  }

  /**
   * Refresh cookies by visiting a URL
   */
  async refreshCookies(url, options = {}) {
    let page = null;
    
    try {
      console.log(`Refreshing cookies from: ${url}`);
      
      // Initialize browser if not already done
      if (!this.browser || !this.context) {
        await this.initBrowser(options.proxy);
      }

      page = await this.context.newPage();

      // Navigate to URL
      await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: 45000 
      });

      // Wait a bit for any dynamic content
      await page.waitForTimeout(3000);

      // Simulate some user behavior
      await this.simulateUserBehavior(page);

      // Get cookies
      const cookies = await this.context.cookies();
      
      if (!cookies || cookies.length === 0) {
        throw new Error('No cookies found');
      }

      // Filter and process cookies
      const processedCookies = this.processCookies(cookies);
      
      console.log(`Successfully collected ${processedCookies.length} cookies`);
      return processedCookies;

    } catch (error) {
      console.error('Error refreshing cookies:', error);
      throw error;
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Simulate realistic user behavior on the page
   */
  async simulateUserBehavior(page) {
    try {
      // Random scroll
      await page.evaluate(() => {
        window.scrollTo(0, Math.random() * 500);
      });
      
      await page.waitForTimeout(1000 + Math.random() * 2000);

      // Random mouse movement
      const viewport = page.viewportSize();
      if (viewport) {
        await page.mouse.move(
          Math.random() * viewport.width,
          Math.random() * viewport.height
        );
      }

      await page.waitForTimeout(500 + Math.random() * 1000);

      // Scroll down
      await page.evaluate(() => {
        window.scrollBy(0, 300 + Math.random() * 200);
      });

      await page.waitForTimeout(1000 + Math.random() * 1500);

    } catch (error) {
      console.warn('Error during user behavior simulation:', error.message);
    }
  }

  /**
   * Process and filter cookies
   */
  processCookies(cookies) {
    return cookies
      .filter(cookie => {
        // Filter out unwanted cookies
        return !cookie.name.includes('_grecaptcha') &&
               !cookie.domain.includes('google.com') &&
               !cookie.domain.includes('doubleclick.net');
      })
      .map(cookie => ({
        ...cookie,
        // Extend expiration time
        expires: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
        expiry: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
      }));
  }

  /**
   * Close the browser
   */
  async closeBrowser() {
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    } catch (error) {
      console.warn('Error closing browser:', error.message);
    }
  }

  /**
   * Check if browser is running
   */
  isRunning() {
    return this.browser && this.browser.isConnected();
  }
}

export default FirefoxCookieManager;