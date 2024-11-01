import inquirer from "inquirer";
import chalk from "chalk";
import Logger from "./Logger.js";
import DataOrganizer from "./DataOrganizer.js";
import TweetFilter from "./TweetFilter.js";
import { Scraper, SearchMode } from "agent-twitter-client";
import { format } from "date-fns";
import path from "path";
import fs from "fs/promises";

class TwitterPipeline {
  constructor(username) {
    this.username = username;
    this.dataOrganizer = new DataOrganizer("pipeline", username);
    this.paths = this.dataOrganizer.getPaths();
    this.tweetFilter = new TweetFilter();
    this.config = {
      twitter: {
        maxTweets: parseInt(process.env.MAX_TWEETS) || 50000,
        maxRetries: parseInt(process.env.MAX_RETRIES) || 5,
        retryDelay: parseInt(process.env.RETRY_DELAY) || 5000,
        minDelayBetweenRequests: parseInt(process.env.MIN_DELAY) || 1000,
        maxDelayBetweenRequests: parseInt(process.env.MAX_DELAY) || 3000,
      },
    };
    this.scraper = new Scraper();
    this.stats = {
      requestCount: 0,
      rateLimitHits: 0,
      retriesCount: 0,
      uniqueTweets: 0,
      startTime: Date.now(),
      oldestTweetDate: null,
      newestTweetDate: null,
    };
  }

  /**
   * Save progress for resume capability
   */
  async saveProgress(queryIndex, modeIndex, tweetCount, extraData = {}) {
    const progressPath = path.join(
      this.dataOrganizer.baseDir,
      "meta",
      "progress.json"
    );
    const progress = {
      queryIndex,
      modeIndex,
      tweetCount,
      stats: this.stats,
      timestamp: new Date().toISOString(),
      ...extraData,
    };
    await fs.writeFile(progressPath, JSON.stringify(progress, null, 2));
  }

  /**
   * Load previous progress
   */
  async loadProgress() {
    try {
      const progressPath = path.join(
        this.dataOrganizer.baseDir,
        "meta",
        "progress.json"
      );
      const data = await fs.readFile(progressPath, "utf-8");
      const progress = JSON.parse(data);

      // Validate the loaded data
      if (progress.stats && progress.timestamp) {
        // Check if progress is too old (>24 hours)
        const progressDate = new Date(progress.timestamp);
        const isRecent =
          Date.now() - progressDate.getTime() < 24 * 60 * 60 * 1000;

        if (!isRecent) {
          Logger.warn(
            "⚠️  Found progress data but it's more than 24 hours old"
          );
          return null;
        }

        return progress;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Validates environment variables
   */
  async validateEnvironment() {
    Logger.startSpinner("Validating environment");
    const required = ["TWITTER_USERNAME", "TWITTER_PASSWORD"];
    const missing = required.filter((var_) => !process.env[var_]);

    if (missing.length > 0) {
      Logger.stopSpinner(false);
      Logger.error("Missing required environment variables:");
      missing.forEach((var_) => Logger.error(`- ${var_}`));
      console.log("\n📝 Create a .env file with your Twitter credentials:");
      console.log(`TWITTER_USERNAME=your_username`);
      console.log(`TWITTER_PASSWORD=your_password`);
      process.exit(1);
    }
    Logger.stopSpinner();
  }

  /**
   * Initialize scraper and handle authentication
   */
  async initializeScraper() {
    Logger.startSpinner("Initializing Twitter scraper");
    let retryCount = 0;

    while (retryCount < this.config.twitter.maxRetries) {
      try {
        const username = process.env.TWITTER_USERNAME;
        const password = process.env.TWITTER_PASSWORD;
        const email = process.env.TWITTER_EMAIL;
        const twoFactorSecret = process.env.TWITTER_TWO_FACTOR_SECRET;

        if (!username || !password) {
          throw new Error("Twitter credentials not found");
        }

        await this.scraper.login(username, password, email, twoFactorSecret);

        if (await this.scraper.isLoggedIn()) {
          Logger.success("✅ Successfully authenticated with Twitter");
          Logger.stopSpinner();
          return;
        } else {
          throw new Error("Authentication failed");
        }
      } catch (error) {
        retryCount++;
        Logger.warn(
          `⚠️  Authentication attempt ${retryCount} failed: ${error.message}`
        );

        if (retryCount >= this.config.twitter.maxRetries) {
          Logger.stopSpinner(false);
          throw new Error(
            `Failed to authenticate after ${retryCount} attempts`
          );
        }

        const delay = this.config.twitter.retryDelay * retryCount;
        Logger.info(
          `⏳ Retrying in ${delay / 1000} seconds... (${retryCount}/${
            this.config.twitter.maxRetries
          })`
        );
        await this.randomDelay(delay, delay * 2);
      }
    }
  }

  /**
   * Random delay between requests
   */
  async randomDelay(min = null, max = null) {
    const minDelay = min || this.config.twitter.minDelayBetweenRequests;
    const maxDelay = max || this.config.twitter.maxDelayBetweenRequests;
    const delay = Math.floor(Math.random() * (maxDelay - minDelay) + minDelay);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Process a single tweet
   */
  processTweetData(tweet) {
    try {
      if (!tweet || !tweet.id) {
        return null;
      }

      // Process timestamp
      let timestamp = tweet.timestamp;
      if (!timestamp) {
        timestamp = tweet.timeParsed?.getTime();
      }

      if (!timestamp) {
        return null;
      }

      // Convert to milliseconds if needed
      if (timestamp < 1e12) {
        timestamp *= 1000;
      }

      // Validate timestamp
      if (isNaN(timestamp) || timestamp <= 0) {
        Logger.warn(`⚠️  Invalid timestamp for tweet ${tweet.id}`);
        return null;
      }

      // Update date range in stats
      const tweetDate = new Date(timestamp);
      if (
        !this.stats.oldestTweetDate ||
        tweetDate < this.stats.oldestTweetDate
      ) {
        this.stats.oldestTweetDate = tweetDate;
      }
      if (
        !this.stats.newestTweetDate ||
        tweetDate > this.stats.newestTweetDate
      ) {
        this.stats.newestTweetDate = tweetDate;
      }

      return {
        id: tweet.id,
        text: tweet.text,
        username: tweet.username || this.username,
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        isReply: Boolean(tweet.isReply),
        isRetweet: Boolean(tweet.isRetweet),
        likes: tweet.likes || 0,
        retweetCount: tweet.retweets || 0,
        replies: tweet.replies || 0,
        photos: tweet.photos || [],
        videos: tweet.videos || [],
        urls: tweet.urls || [],
        permanentUrl: tweet.permanentUrl,
        quotedStatusId: tweet.quotedStatusId,
        inReplyToStatusId: tweet.inReplyToStatusId,
        hashtags: tweet.hashtags || [],
      };
    } catch (error) {
      Logger.warn(`⚠️  Error processing tweet ${tweet?.id}: ${error.message}`);
      return null;
    }
  }

  /**
   * Handle rate limiting
   */
  async handleRateLimit(retryCount = 1) {
    this.stats.rateLimitHits++;
    const baseDelay = 60000; // 1 minute
    const delay = Math.min(
      baseDelay * Math.pow(2, retryCount - 1),
      15 * 60 * 1000
    ); // Max 15 minutes

    Logger.warn(
      `⚠️  Rate limit hit - waiting ${
        delay / 1000
      } seconds (attempt ${retryCount})`
    );
    await new Promise((r) => setTimeout(r, delay));
  }

  /**
   * Main tweet collection logic using search
   */
  /**
   * Main tweet collection logic using streamlined search
   */
  async collectTweets(scraper) {
    try {
      const profile = await scraper.getProfile(this.username);
      const totalExpectedTweets = profile.tweetsCount;

      Logger.info(
        `📊 Found ${chalk.bold(
          totalExpectedTweets.toLocaleString()
        )} total tweets for @${this.username}`
      );

      // Initialize collection
      const allTweets = new Map();
      let previousCount = 0;
      let stagnantBatches = 0;
      const MAX_STAGNANT_BATCHES = 2; // Stop much sooner if we're not finding new tweets

      // Single aggressive collection strategy
      const searchResults = scraper.searchTweets(
        `from:${this.username}`,
        this.config.twitter.maxTweets,
        SearchMode.Latest
      );

      try {
        for await (const tweet of searchResults) {
          if (tweet && !allTweets.has(tweet.id)) {
            const processedTweet = this.processTweetData(tweet);
            if (processedTweet) {
              allTweets.set(tweet.id, processedTweet);

              // Log progress periodically
              if (allTweets.size % 100 === 0) {
                const completion = (
                  (allTweets.size / totalExpectedTweets) *
                  100
                ).toFixed(1);
                Logger.info(
                  `📊 Progress: ${allTweets.size.toLocaleString()} unique tweets (${completion}%)`
                );

                // Check if we're still finding new tweets
                if (allTweets.size === previousCount) {
                  stagnantBatches++;
                  if (stagnantBatches >= MAX_STAGNANT_BATCHES) {
                    Logger.info(
                      "📝 Collection rate has stagnated, ending collection"
                    );
                    break;
                  }
                } else {
                  stagnantBatches = 0;
                }
                previousCount = allTweets.size;

                // Display stats
                const runtime = (Date.now() - this.stats.startTime) / 1000 / 60;
                const tweetsPerMinute = (allTweets.size / runtime).toFixed(1);
                Logger.info("\nCollection Progress:");
                console.log(
                  chalk.cyan(
                    `• Total Tweets: ${allTweets.size.toLocaleString()} of ${totalExpectedTweets.toLocaleString()}`
                  )
                );
                console.log(
                  chalk.cyan(
                    `• Collection Rate: ${tweetsPerMinute} tweets/minute`
                  )
                );
                console.log(
                  chalk.cyan(`• Runtime: ${Math.floor(runtime)} minutes`)
                );
              }
            }
          }
        }
      } catch (error) {
        if (error.message.includes("rate limit")) {
          await this.handleRateLimit(this.stats.rateLimitHits + 1);
        }
        Logger.warn(`⚠️  Search error: ${error.message}`);
      }

      // Only try replies collection if we haven't found enough tweets
      if (allTweets.size < totalExpectedTweets * 0.8) {
        Logger.info("\n🔍 Collecting replies to find additional tweets...");

        try {
          const replyResults = scraper.searchTweets(
            `from:${this.username} filter:replies`,
            this.config.twitter.maxTweets,
            SearchMode.Latest
          );

          for await (const tweet of replyResults) {
            if (tweet && !allTweets.has(tweet.id)) {
              const processedTweet = this.processTweetData(tweet);
              if (processedTweet) {
                allTweets.set(tweet.id, processedTweet);

                if (allTweets.size % 100 === 0) {
                  const completion = (
                    (allTweets.size / totalExpectedTweets) *
                    100
                  ).toFixed(1);
                  Logger.info(
                    `📊 Progress: ${allTweets.size.toLocaleString()} unique tweets (${completion}%)`
                  );
                }
              }
            }
          }
        } catch (error) {
          // Just log and continue if replies collection fails
          Logger.warn(`⚠️  Replies collection error: ${error.message}`);
        }
      }

      Logger.success(
        `\n🎉 Collection complete! ${allTweets.size.toLocaleString()} unique tweets collected`
      );
      return Array.from(allTweets.values());
    } catch (error) {
      Logger.error(`Failed to collect tweets: ${error.message}`);
      throw error;
    }
  }

  /**
   * Display sample tweets
   */
  async showSampleTweets(tweets) {
    const { showSample } = await inquirer.prompt([
      {
        type: "confirm",
        name: "showSample",
        message: "Would you like to see a sample of collected tweets?",
        default: true,
      },
    ]);

    if (showSample) {
      Logger.info("\n🌟 Sample Tweets (Most Engaging):");

      const sortedTweets = tweets
        .filter((tweet) => !tweet.isRetweet)
        .sort((a, b) => b.likes + b.retweetCount - (a.likes + a.retweetCount))
        .slice(0, 5);

      sortedTweets.forEach((tweet, i) => {
        console.log(
          chalk.cyan(
            `\n${i + 1}. [${format(new Date(tweet.timestamp), "yyyy-MM-dd")}]`
          )
        );
        console.log(chalk.white(tweet.text));
        console.log(
          chalk.gray(
            `❤️ ${tweet.likes.toLocaleString()} | 🔄 ${tweet.retweetCount.toLocaleString()} | 💬 ${tweet.replies.toLocaleString()}`
          )
        );
        console.log(chalk.gray(`🔗 ${tweet.permanentUrl}`));
      });
    }
  }

  /**
   * Main pipeline execution
   */
  async run() {
    const startTime = Date.now();

    console.log("\n" + chalk.bold.blue("🐦 Twitter Data Collection Pipeline"));
    console.log(
      chalk.bold(`Target Account: ${chalk.cyan("@" + this.username)}\n`)
    );

    try {
      await this.validateEnvironment();
      await this.initializeScraper();

      // Start collection
      Logger.startSpinner(`Collecting tweets from @${this.username}`);
      const allTweets = await this.collectTweets(this.scraper);
      Logger.stopSpinner();

      if (allTweets.length === 0) {
        Logger.warn("⚠️  No tweets collected");
        return;
      }

      // Save collected data
      Logger.startSpinner("Processing and saving data");
      const analytics = await this.dataOrganizer.saveTweets(allTweets);
      Logger.stopSpinner();

      // Calculate final statistics
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const tweetsPerMinute = (allTweets.length / (duration / 60)).toFixed(1);
      const successRate = (
        (allTweets.length / this.stats.requestCount) *
        100
      ).toFixed(1);

      // Display final results
      Logger.stats("📈 Collection Results", {
        "Total Tweets": allTweets.length.toLocaleString(),
        "Original Tweets": analytics.directTweets.toLocaleString(),
        Replies: analytics.replies.toLocaleString(),
        Retweets: analytics.retweets.toLocaleString(),
        "Date Range": `${analytics.timeRange.start} to ${analytics.timeRange.end}`,
        Runtime: `${duration} seconds`,
        "Collection Rate": `${tweetsPerMinute} tweets/minute`,
        "Success Rate": `${successRate}%`,
        "API Requests": this.stats.requestCount.toLocaleString(),
        "Rate Limit Hits": this.stats.rateLimitHits.toLocaleString(),
        "Storage Location": chalk.gray(this.dataOrganizer.baseDir),
      });

      // Content type breakdown
      Logger.info("\n📊 Content Type Breakdown:");
      console.log(
        chalk.cyan(
          `• Text Only: ${analytics.contentTypes.textOnly.toLocaleString()}`
        )
      );
      console.log(
        chalk.cyan(
          `• With Images: ${analytics.contentTypes.withImages.toLocaleString()}`
        )
      );
      console.log(
        chalk.cyan(
          `• With Videos: ${analytics.contentTypes.withVideos.toLocaleString()}`
        )
      );
      console.log(
        chalk.cyan(
          `• With Links: ${analytics.contentTypes.withLinks.toLocaleString()}`
        )
      );

      // Engagement statistics
      Logger.info("\n💫 Engagement Statistics:");
      console.log(
        chalk.cyan(
          `• Total Likes: ${analytics.engagement.totalLikes.toLocaleString()}`
        )
      );
      console.log(
        chalk.cyan(
          `• Total Retweets: ${analytics.engagement.totalRetweetCount.toLocaleString()}`
        )
      );
      console.log(
        chalk.cyan(
          `• Total Replies: ${analytics.engagement.totalReplies.toLocaleString()}`
        )
      );
      console.log(
        chalk.cyan(`• Average Likes: ${analytics.engagement.averageLikes}`)
      );

      // Show sample tweets
      await this.showSampleTweets(allTweets);

      // Cleanup
      await this.cleanup();

      return analytics;
    } catch (error) {
      Logger.error(`Pipeline failed: ${error.message}`);
      // Log error details
      await this.logError(error, {
        stage: "pipeline_execution",
        runtime: (Date.now() - startTime) / 1000,
        stats: this.stats,
      });
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Log error details
   */
  async logError(error, context = {}) {
    const errorLog = {
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        stack: error.stack,
      },
      context,
      stats: this.stats,
    };

    const errorLogPath = path.join(
      this.dataOrganizer.baseDir,
      "meta",
      "error_log.json"
    );

    try {
      let existingLogs = [];
      try {
        const existing = await fs.readFile(errorLogPath, "utf-8");
        existingLogs = JSON.parse(existing);
      } catch {
        // File doesn't exist yet, start with empty array
      }

      existingLogs.push(errorLog);
      await fs.writeFile(errorLogPath, JSON.stringify(existingLogs, null, 2));
    } catch (logError) {
      Logger.error(`Failed to save error log: ${logError.message}`);
    }
  }

  /**
   * Cleanup method
   */
  async cleanup() {
    try {
      if (this.scraper) {
        await this.scraper.logout();
        Logger.success("🔒 Logged out successfully");
      }
    } catch (error) {
      Logger.warn(`⚠️  Cleanup error: ${error.message}`);
    } finally {
      // Save final progress even if logout fails
      await this.saveProgress(null, null, this.stats.uniqueTweets, {
        completed: true,
        endTime: new Date().toISOString(),
      });
    }
  }
}

export default TwitterPipeline;
