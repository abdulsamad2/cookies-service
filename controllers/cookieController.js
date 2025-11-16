import CookieService from '../services/cookieService.js';

/**
 * Single endpoint for downstream systems to get cookies
 * Returns cookies in a clean, consistent format
 */
export const getCookies = async (req, res) => {
  try {
    // Clean up expired cookies first
    await CookieService.cleanupExpiredCookies();
    
    const {
      limit = 1,
      domain = 'ticketmaster.com'
    } = req.query;

    const options = {
      status: 'active',
      isValid: true,
      limit: parseInt(limit) || 1,
      sortBy: 'quality.score',
      sortOrder: -1,
      domain,
      minQualityScore: 60
    };

    const cookies = await CookieService.getCookies(options);
    const totalCount = await CookieService.getCookieCount();

    if (cookies.length === 0) {
      return res.json({
        success: false,
        message: 'No cookies available',
        total: totalCount,
        tmpt: null,
        expiry: null
      });
    }

    // Get the best cookie
    const bestCookie = cookies[0];
    
    // Find tmpt value (look for tmpt, token, session cookies)
    let tmptValue = null;
    let expiryTime = Date.now() + (24 * 60 * 60 * 1000); // Default 24 hours from now

    if (bestCookie.cookies && Array.isArray(bestCookie.cookies)) {
      const tmptCookie = bestCookie.cookies.find(c => 
        c.name && (
          c.name.toLowerCase().includes('tmpt') || 
          c.name.toLowerCase().includes('token') ||
          c.name.toLowerCase().includes('session') ||
          c.name.toLowerCase().includes('auth')
        )
      );

      if (tmptCookie) {
        tmptValue = tmptCookie.value;
        if (tmptCookie.expires && tmptCookie.expires > 0) {
          expiryTime = tmptCookie.expires * 1000; // Convert to milliseconds
        }
      }
    }

    // Update usage statistics
    if (bestCookie.cookieId) {
      await CookieService.updateCookieUsage(bestCookie.cookieId);
    }

    // Return full cookie data along with tmpt value
    res.json({
      success: true,
      tmpt: tmptValue,
      expiry: expiryTime,
      total: totalCount,
      cookieId: bestCookie.cookieId,
      quality: bestCookie.quality?.score || 0,
      cookies: bestCookie.cookies || [],
      metadata: {
        eventId: bestCookie.metadata?.eventId || null,
        eventTitle: bestCookie.metadata?.eventTitle || null,
        visitTime: bestCookie.metadata?.visitTime || null,
        domain: bestCookie.metadata?.domain || 'ticketmaster.com'
      }
    });

  } catch (error) {
    console.error('Error getting cookies:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      tmpt: null,
      expiry: null,
      total: 0,
      error: error.message
    });
  }
};