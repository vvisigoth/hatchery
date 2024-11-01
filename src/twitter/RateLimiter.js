// RateLimiter.js
import Logger from './Logger.js';

class RateLimiter {
  constructor(minDelay, maxRequests, windowDuration) {
    this.minDelay = minDelay; // in milliseconds
    this.maxRequests = maxRequests;
    this.windowDuration = windowDuration; // in milliseconds
    this.lastCall = 0;
    this.requestCount = 0;
    this.windowStart = Date.now();
    this.resetTime = null;
  }

  async wait() {
    const now = Date.now();

    // Handle rate limit window
    if (now - this.windowStart >= this.windowDuration) {
      this.requestCount = 0;
      this.windowStart = now;
    }

    // Check if we're near rate limit
    if (this.requestCount >= this.maxRequests) { // Conservative limit
      const waitTime = (this.windowDuration) - (now - this.windowStart) + 1000; // Adding 1 second buffer
      if (waitTime > 0) {
        Logger.warn(`⏳ Rate limit reached. Waiting for ${Math.round(waitTime / 1000)} seconds.`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.requestCount = 0;
        this.windowStart = Date.now();
      }
    }

    // Apply minimum delay between requests
    const timeSinceLastCall = now - this.lastCall;
    const delayNeeded = Math.max(0, this.minDelay - timeSinceLastCall);

    if (delayNeeded > 0) {
      await new Promise(resolve => setTimeout(resolve, delayNeeded));
    }

    this.lastCall = Date.now();
    this.requestCount++;
  }

  async handleRateLimit() {
    const waitTime = this.windowDuration; // 15 minutes
    Logger.warn(`🚫 Hit rate limit. Waiting for ${Math.round(waitTime / 60000)} minutes.`);
    this.resetTime = Date.now() + waitTime;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    this.requestCount = 0;
    this.windowStart = Date.now();
    this.resetTime = null;
  }

  isRateLimited() {
    return this.requestCount >= this.maxRequests;
  }
}

class TimelineTracker {
  constructor() {
    this.oldestTweetTime = null;
    this.newestTweetTime = null;
    this.seenTweets = new Set();
    this.cursors = new Set();
    this.lastProgressTime = Date.now();
    this.stuckCount = 0;
  }

  trackTweet(tweet) {
    if (!tweet.timestamp) return false;

    if (!this.seenTweets.has(tweet.id)) {
      this.seenTweets.add(tweet.id);

      if (!this.oldestTweetTime || tweet.timestamp < this.oldestTweetTime) {
        this.oldestTweetTime = tweet.timestamp;
      }

      if (!this.newestTweetTime || tweet.timestamp > this.newestTweetTime) {
        this.newestTweetTime = tweet.timestamp;
      }

      this.lastProgressTime = Date.now();
      this.stuckCount = 0;
      return true;
    }

    return false;
  }

  trackCursor(cursor) {
    if (!cursor) return false;

    if (this.cursors.has(cursor)) {
      this.stuckCount++;
      return true;
    }

    this.cursors.add(cursor);
    return false;
  }

  isStuck() {
    return this.stuckCount > 3 ||
           (Date.now() - this.lastProgressTime > 5 * 60 * 1000);
  }

  reset() {
    this.stuckCount = 0;
    this.cursors.clear();
    this.lastProgressTime = Date.now();
  }

  getProgress() {
    return {
      oldestTweet: this.oldestTweetTime ? new Date(this.oldestTweetTime) : null,
      newestTweet: this.newestTweetTime ? new Date(this.newestTweetTime) : null,
      uniqueTweets: this.seenTweets.size
    };
  }
}

export { RateLimiter, TimelineTracker };
