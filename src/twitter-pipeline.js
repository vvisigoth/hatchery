// twitter-pipeline.js

import { Scraper, SearchMode } from "agent-twitter-client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import ProgressBar from "progress";
import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import { format, parseISO, isValid } from "date-fns";
import inquirer from "inquirer";

dotenv.config();

class Logger {
  static spinner = null;

  static startSpinner(text) {
    this.spinner = ora(text).start();
  }

  static stopSpinner(success = true) {
    if (this.spinner) {
      success ? this.spinner.succeed() : this.spinner.fail();
      this.spinner = null;
    }
  }

  static info(msg) {
    console.log(chalk.blue(`ℹ️  ${msg}`));
  }

  static success(msg) {
    console.log(chalk.green(`✅ ${msg}`));
  }

  static warn(msg) {
    console.log(chalk.yellow(`⚠️  ${msg}`));
  }

  static error(msg) {
    console.log(chalk.red(`❌ ${msg}`));
  }

  static stats(title, data) {
    console.log(chalk.cyan(`\n📊 ${title}:`));
    const table = new Table({
      head: [chalk.white("Parameter"), chalk.white("Value")],
      colWidths: [25, 60],
    });
    Object.entries(data).forEach(([key, value]) => {
      table.push([chalk.white(key), value]);
    });
    console.log(table.toString());
  }
}

class DataOrganizer {
  constructor(baseDir, username) {
    this.baseDir = path.join(
      baseDir,
      format(new Date(), "yyyy-MM-dd"),
      username.toLowerCase()
    );
    this.createDirectories();
  }

  createDirectories() {
    const dirs = ["raw", "processed", "analytics", "exports"];
    dirs.forEach((dir) => {
      const fullPath = path.join(this.baseDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        Logger.info(`Created directory: ${path.join(this.baseDir, dir)}`);
      }
    });
  }

  getPaths() {
    return {
      raw: {
        tweets: path.join(this.baseDir, "raw", "tweets.json"),
        urls: path.join(this.baseDir, "raw", "urls.txt"),
        cookies: path.join(this.baseDir, "raw", "cookies.json"),
      },
      processed: {
        finetuning: path.join(this.baseDir, "processed", "finetuning.jsonl"),
        history: path.join(this.baseDir, "processed", "history.json"),
      },
      analytics: {
        stats: path.join(this.baseDir, "analytics", "stats.json"),
        engagement: path.join(this.baseDir, "analytics", "engagement.json"),
      },
      exports: {
        summary: path.join(this.baseDir, "exports", "summary.md"),
      },
    };
  }

  async saveTweets(tweets) {
    const paths = this.getPaths();

    try {
      await fs.promises.writeFile(
        paths.raw.tweets,
        JSON.stringify(tweets, null, 2)
      );
      Logger.success(`Saved tweets to ${paths.raw.tweets}`);

      const urls = tweets.map((t) => t.permanentUrl);
      await fs.promises.writeFile(paths.raw.urls, urls.join("\n"));
      Logger.success(`Saved tweet URLs to ${paths.raw.urls}`);

      const analytics = this.generateAnalytics(tweets);
      await fs.promises.writeFile(
        paths.analytics.stats,
        JSON.stringify(analytics, null, 2)
      );
      Logger.success(`Saved analytics to ${paths.analytics.stats}`);

      const finetuningData = this.generateFinetuningData(tweets);
      Logger.info(
        `Generating fine-tuning data with ${finetuningData.length} entries`
      );

      if (finetuningData.length > 0) {
        await fs.promises.writeFile(
          paths.processed.finetuning,
          finetuningData.map((d) => JSON.stringify(d)).join("\n")
        );
        Logger.success(
          `Saved fine-tuning data to ${paths.processed.finetuning}`
        );
      } else {
        Logger.warn("⚠️ No fine-tuning data to save.");
      }

      const summary = this.generateSummary(tweets, analytics);
      await fs.promises.writeFile(paths.exports.summary, summary);
      Logger.success(`Saved summary to ${paths.exports.summary}`);

      return analytics;
    } catch (error) {
      Logger.error(`❌ Error saving data: ${error.message}`);
      throw error;
    }
  }

  generateAnalytics(tweets) {
    if (tweets.length === 0) {
      Logger.warn("No tweets to analyze.");
      return {
        totalTweets: 0,
        directTweets: 0,
        replies: 0,
        retweets: 0,
        engagement: {
          totalLikes: 0,
          totalRetweetCount: 0,
          totalReplies: 0,
          averageLikes: "0.00",
          topTweets: [],
        },
        timeRange: {
          start: "N/A",
          end: "N/A",
        },
        contentTypes: {
          withImages: 0,
          withVideos: 0,
          withLinks: 0,
          textOnly: 0,
        },
      };
    }

    const validTweets = tweets.filter((t) => t.timestamp !== null);
    const invalidTweets = tweets.filter((t) => t.timestamp === null);

    if (invalidTweets.length > 0) {
      Logger.warn(
        `Found ${invalidTweets.length} tweets with invalid or missing dates. They will be excluded from analytics.`
      );
    }

    const validDates = validTweets
      .map((t) => t.timestamp)
      .sort((a, b) => a - b);

    // Filter out retweets for engagement calculations
    const tweetsForEngagement = tweets.filter((t) => !t.isRetweet);

    return {
      totalTweets: tweets.length,
      directTweets: tweets.filter((t) => !t.isReply && !t.isRetweet).length,
      replies: tweets.filter((t) => t.isReply).length,
      retweets: tweets.filter((t) => t.isRetweet).length, // Number of retweeted tweets
      engagement: {
        totalLikes: tweetsForEngagement.reduce(
          (sum, t) => sum + (t.likes || 0),
          0
        ),
        totalRetweetCount: tweetsForEngagement.reduce(
          (sum, t) => sum + (t.retweetCount || 0),
          0
        ),
        totalReplies: tweetsForEngagement.reduce(
          (sum, t) => sum + (t.replies || 0),
          0
        ),
        averageLikes: (
          tweetsForEngagement.reduce((sum, t) => sum + (t.likes || 0), 0) /
          tweetsForEngagement.length
        ).toFixed(2),
        topTweets: tweetsForEngagement
          .sort((a, b) => (b.likes || 0) - (a.likes || 0))
          .slice(0, 5)
          .map((t) => ({
            id: t.id,
            text: t.text.slice(0, 100),
            likes: t.likes,
            retweetCount: t.retweetCount,
            url: t.permanentUrl,
          })),
      },
      timeRange: {
        start: validDates.length
          ? format(new Date(validDates[0]), "yyyy-MM-dd")
          : "N/A",
        end: validDates.length
          ? format(new Date(validDates[validDates.length - 1]), "yyyy-MM-dd")
          : "N/A",
      },
      contentTypes: {
        withImages: tweets.filter((t) => t.photos?.length > 0).length,
        withVideos: tweets.filter((t) => t.videos?.length > 0).length,
        withLinks: tweets.filter((t) => t.urls?.length > 0).length,
        textOnly: tweets.filter(
          (t) => !t.photos?.length && !t.videos?.length && !t.urls?.length
        ).length,
      },
    };
  }

  generateFinetuningData(tweets) {
    return tweets
      .filter(
        (tweet) =>
          !tweet.isRetweet && tweet.text && tweet.timestamp !== null
      )
      .map((tweet) => {
        let cleanText = tweet.text
          .replace(/(?:https?:\/\/|www\.)[^\s]+/g, "") // Remove URLs
          .replace(/#[^\s#]+/g, "") // Remove Hashtags
          .replace(/\s+/g, " ")
          .trim();

        if (!cleanText) return null;

        // Return only the clean text, without usernames or metadata
        return {
          text: cleanText,
        };
      })
      .filter((entry) => {
        if (!entry) return false;
        return typeof entry.text === "string" && entry.text.length > 0;
      });
  }

  generateSummary(tweets, analytics) {
    return `# Twitter Data Collection Summary

## Overview
- **Collection Date:** ${format(new Date(), "yyyy-MM-dd HH:mm:ss")}
- **Total Tweets:** ${analytics.totalTweets}
- **Date Range:** ${analytics.timeRange.start} to ${analytics.timeRange.end}

## Tweet Distribution
- **Direct Tweets:** ${analytics.directTweets}
- **Replies:** ${analytics.replies}
- **Retweets (retweeted tweets):** ${analytics.retweets}

## Content Types
- **With Images:** ${analytics.contentTypes.withImages}
- **With Videos:** ${analytics.contentTypes.withVideos}
- **With Links:** ${analytics.contentTypes.withLinks}
- **Text Only:** ${analytics.contentTypes.textOnly}

## Engagement Statistics (Original Tweets and Replies)
- **Total Likes:** ${analytics.engagement.totalLikes.toLocaleString()}
- **Total Retweet Count:** ${analytics.engagement.totalRetweetCount.toLocaleString()}
- **Total Replies:** ${analytics.engagement.totalReplies.toLocaleString()}
- **Average Likes per Tweet:** ${analytics.engagement.averageLikes}

## Top Tweets
${analytics.engagement.topTweets
  .map(
    (t) => `- [${t.likes} likes] ${t.text}...\n  • ${t.url}`
  )
  .join("\n\n")}

## Storage Details
Raw data, analytics, and exports can be found in:
**${this.baseDir}**
`;
  }
}

class TweetFilter {
  constructor() {
    this.options = {};
  }

  async promptCollectionMode() {
    const { mode } = await inquirer.prompt([
      {
        type: "list",
        name: "mode",
        message: "How would you like to collect tweets?",
        choices: [
          {
            name: "📥 Get all tweets (fastest, includes everything)",
            value: "all",
          },
          {
            name: "🎯 Custom collection (filter by type, date, engagement, etc)",
            value: "custom",
          },
        ],
      },
    ]);

    if (mode === "all") {
      this.options = {
        tweetTypes: ["original", "replies", "quotes", "retweets"],
        contentTypes: ["text", "images", "videos", "links"],
        filterByEngagement: false,
        filterByDate: false,
        excludeKeywords: false,
      };

      Logger.info("\nCollection Configuration:");
      const configTable = new Table({
        head: [chalk.white("Parameter"), chalk.white("Value")],
        colWidths: [25, 60],
      });
      configTable.push(
        ["Mode", chalk.green("Complete Collection")],
        [
          "Includes",
          [
            "✓ Original tweets",
            "✓ Replies to others",
            "✓ Quote tweets",
            "✓ Retweets",
            "✓ Text-only tweets",
            "✓ Tweets with media (images/videos)",
            "✓ Tweets with links",
          ].join("\n"),
        ],
        ["Filtering", chalk.blue("None - collecting everything")]
      );
      console.log(configTable.toString());

      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: "Would you like to proceed with collecting everything?",
          default: true,
        },
      ]);

      if (!confirm) {
        return this.promptCollectionMode();
      }

      Logger.info(
        `Selected Tweet Types: ${this.options.tweetTypes.join(", ")}`
      );
      Logger.info(
        `Selected Content Types: ${this.options.contentTypes.join(", ")}`
      );

      return this.options;
    }

    return this.promptCustomOptions();
  }

  async promptCustomOptions() {
    Logger.info("Configure Custom Tweet Collection");

    const answers = await inquirer.prompt([
      {
        type: "checkbox",
        name: "tweetTypes",
        message: "What types of tweets would you like to collect?",
        choices: [
          { name: "Original tweets", value: "original", checked: true },
          { name: "Replies to others", value: "replies", checked: true },
          { name: "Quote tweets", value: "quotes", checked: true },
          { name: "Retweets", value: "retweets", checked: true },
        ],
        validate: (input) =>
          input.length > 0 || "Please select at least one tweet type.",
      },
      {
        type: "checkbox",
        name: "contentTypes",
        message: "What content types would you like to include?",
        choices: [
          { name: "Text-only tweets", value: "text", checked: true },
          { name: "Tweets with images", value: "images", checked: true },
          { name: "Tweets with videos", value: "videos", checked: true },
          { name: "Tweets with links", value: "links", checked: true },
        ],
        validate: (input) =>
          input.length > 0 || "Please select at least one content type.",
      },
      {
        type: "confirm",
        name: "filterByEngagement",
        message: "Would you like to filter by minimum engagement?",
        default: false,
      },
      {
        type: "number",
        name: "minLikes",
        message: "Minimum number of likes:",
        default: 0,
        when: (answers) => answers.filterByEngagement,
        validate: (value) =>
          value >= 0 ? true : "Please enter a positive number",
      },
      {
        type: "number",
        name: "minRetweets",
        message: "Minimum number of retweets:",
        default: 0,
        when: (answers) => answers.filterByEngagement,
        validate: (value) =>
          value >= 0 ? true : "Please enter a positive number",
      },
      {
        type: "confirm",
        name: "filterByDate",
        message: "Would you like to filter by date range?",
        default: false,
      },
      {
        type: "input",
        name: "startDate",
        message: "Start date (YYYY-MM-DD):",
        when: (answers) => answers.filterByDate,
        validate: (value) => {
          const date = parseISO(value);
          return isValid(date) ? true : "Please enter a valid date";
        },
      },
      {
        type: "input",
        name: "endDate",
        message: "End date (YYYY-MM-DD):",
        when: (answers) => answers.filterByDate,
        validate: (value) => {
          const date = parseISO(value);
          return isValid(date) ? true : "Please enter a valid date";
        },
      },
      {
        type: "confirm",
        name: "excludeKeywords",
        message:
          "Would you like to exclude tweets containing specific keywords?",
        default: false,
      },
      {
        type: "input",
        name: "keywordsToExclude",
        message: "Enter keywords to exclude (comma-separated):",
        when: (answers) => answers.excludeKeywords,
        filter: (input) =>
          input
            .split(",")
            .map((k) => k.trim())
            .filter((k) => k),
      },
    ]);

    this.options = answers;

    Logger.info(`Selected Tweet Types: ${this.options.tweetTypes.join(", ")}`);
    Logger.info(
      `Selected Content Types: ${this.options.contentTypes.join(", ")}`
    );

    Logger.info("\nCollection Configuration:");
    const configTable = new Table({
      head: [chalk.white("Parameter"), chalk.white("Value")],
      colWidths: [25, 60],
    });

    configTable.push(
      ["Tweet Types", answers.tweetTypes.join(", ")],
      ["Content Types", answers.contentTypes.join(", ")]
    );

    if (answers.filterByEngagement) {
      configTable.push(
        ["Min. Likes", answers.minLikes],
        ["Min. Retweets", answers.minRetweets]
      );
    }

    if (answers.filterByDate) {
      configTable.push([
        "Date Range",
        `${answers.startDate} to ${answers.endDate}`,
      ]);
    }

    if (answers.excludeKeywords) {
      configTable.push([
        "Excluded Keywords",
        answers.keywordsToExclude.join(", "),
      ]);
    }

    console.log(configTable.toString());

    const { confirmed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmed",
        message: "Would you like to proceed with this configuration?",
        default: true,
      },
    ]);

    if (!confirmed) {
      Logger.info("Restarting configuration...");
      return this.promptCustomOptions();
    }

    return this.options;
  }

  shouldIncludeTweet(tweet) {
    if (
      this.options.tweetTypes?.length === 4 &&
      this.options.contentTypes?.length === 4 &&
      !this.options.filterByEngagement &&
      !this.options.filterByDate &&
      !this.options.excludeKeywords
    ) {
      return true;
    }

    // Exclude retweets if not selected
    if (!this.options.tweetTypes.includes("retweets") && tweet.isRetweet) {
      return false;
    }

    if (!this.options.tweetTypes.includes("replies") && tweet.isReply) {
      return false;
    }
    if (!this.options.tweetTypes.includes("quotes") && tweet.quotedTweet) {
      return false;
    }
    if (
      !this.options.tweetTypes.includes("original") &&
      !tweet.isReply &&
      !tweet.quotedTweet &&
      !tweet.isRetweet
    ) {
      return false;
    }

    const hasImage = tweet.photos && tweet.photos.length > 0;
    const hasVideo = tweet.videos && tweet.videos.length > 0;
    const hasLinks = tweet.urls && tweet.urls.length > 0;

    if (!this.options.contentTypes.includes("images") && hasImage) return false;
    if (!this.options.contentTypes.includes("videos") && hasVideo) return false;
    if (!this.options.contentTypes.includes("links") && hasLinks) return false;
    if (
      !this.options.contentTypes.includes("text") &&
      !hasImage &&
      !hasVideo &&
      !hasLinks
    )
      return false;

    if (this.options.filterByEngagement) {
      if (tweet.likes < this.options.minLikes) return false;
      if (tweet.retweetCount < this.options.minRetweets) return false;
    }

    if (this.options.filterByDate) {
      const tweetDate = new Date(tweet.timestamp);
      const startDate = new Date(this.options.startDate);
      const endDate = new Date(this.options.endDate);
      if (tweetDate < startDate || tweetDate > endDate) return false;
    }

    if (
      this.options.excludeKeywords &&
      this.options.keywordsToExclude.some((keyword) =>
        tweet.text.toLowerCase().includes(keyword.toLowerCase())
      )
    ) {
      return false;
    }

    return true;
  }
}

class RateLimiter {
  constructor(minDelay) {
    this.minDelay = minDelay;
    this.lastCall = 0;
  }

  async wait() {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;
    const delayNeeded = Math.max(0, this.minDelay - timeSinceLastCall);

    if (delayNeeded > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayNeeded));
    }

    this.lastCall = Date.now();
  }
}

class TweetHistory {
  constructor(historyPath) {
    this.historyPath = historyPath;
    this.knownTweets = new Set();
    this.loadHistory();
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.historyPath)) {
        const history = JSON.parse(fs.readFileSync(this.historyPath, "utf8"));
        this.knownTweets = new Set(history.tweetIds);
        Logger.info(
          `📚 Loaded history of ${this.knownTweets.size} known tweets`
        );
      }
    } catch (error) {
      Logger.warn(`⚠️ Error loading tweet history: ${error.message}`);
      this.knownTweets = new Set();
    }
  }

  saveHistory() {
    try {
      const history = {
        tweetIds: Array.from(this.knownTweets),
        lastUpdated: new Date().toISOString(),
      };
      fs.writeFileSync(this.historyPath, JSON.stringify(history, null, 2));
      Logger.success(`Saved tweet history to ${this.historyPath}`);
    } catch (error) {
      Logger.error(`❌ Error saving tweet history: ${error.message}`);
    }
  }

  isKnown(tweetId) {
    return this.knownTweets.has(tweetId);
  }

  addTweet(tweetId) {
    this.knownTweets.add(tweetId);
  }

  get size() {
    return this.knownTweets.size;
  }
}

async function loadCookies(cookiesPath) {
  try {
    if (fs.existsSync(cookiesPath)) {
      const cookiesData = fs.readFileSync(cookiesPath, "utf8");
      return JSON.parse(cookiesData);
    }
  } catch (error) {
    Logger.warn(`⚠️ Error loading cookies: ${error.message}`);
  }
  return null;
}

async function saveCookies(cookiesPath, cookies) {
  try {
    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
    Logger.success("✅ Cookies saved successfully");
  } catch (error) {
    Logger.error(`❌ Error saving cookies: ${error.message}`);
  }
}

class TwitterPipeline {
  constructor(username) {
    this.username = username;
    this.dataOrganizer = new DataOrganizer("pipeline", username);
    this.paths = this.dataOrganizer.getPaths();
    this.tweetFilter = new TweetFilter();
    this.config = {
      twitter: {
        batchSize: 2000,
        delayBetweenBatches: 1000,
        searchBatchSize: 100,
        maxRetries: 3,
        retryDelay: 5000,
        rateLimitDelay: 1000,
        searchDelay: 2000,
      },
    };
    this.scraper = null;
    this.history = new TweetHistory(this.paths.processed.history);
  }

  async validateEnvironment() {
    Logger.startSpinner("Validating environment");
    const required = ["TWITTER_USERNAME", "TWITTER_PASSWORD"];
    const missing = required.filter((var_) => !process.env[var_]);

    if (missing.length > 0) {
      Logger.stopSpinner(false);
      Logger.error("Missing required environment variables:");
      missing.forEach((var_) => Logger.error(`- ${var_}`));
      console.log("\n📝 Create a .env file with your Twitter credentials:");
      console.log(
        `TWITTER_USERNAME=your_username\nTWITTER_PASSWORD=your_password`
      );
      process.exit(1);
    }
    Logger.stopSpinner();
  }

  async initializeScraper() {
    Logger.startSpinner("Initializing Twitter scraper");
    const scraper = new Scraper();
    let retryCount = 0;

    while (retryCount < this.config.twitter.maxRetries) {
      try {
        Logger.info(`🔍 Scraper Initialization Attempt ${retryCount + 1}`);
        const cookies = await loadCookies(this.paths.raw.cookies);

        if (cookies) {
          Logger.info("🍪 Found existing cookies, attempting to use them...");
          try {
            const cookieStrings = cookies.map(
              (cookie) =>
                `${cookie.name}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}`
            );
            await scraper.setCookies(cookieStrings);
            if (await scraper.isLoggedIn()) {
              Logger.success(
                "✅ Successfully authenticated using saved cookies"
              );
              this.scraper = scraper;
              Logger.stopSpinner();
              return scraper;
            } else {
              Logger.warn("⚠️ Saved cookies are invalid or expired.");
            }
          } catch (error) {
            Logger.warn(`⚠️ Error using saved cookies: ${error.message}`);
          }
        }

        Logger.info("🔑 Logging in with credentials...");
        await scraper.login(
          process.env.TWITTER_USERNAME,
          process.env.TWITTER_PASSWORD
        );

        if (await scraper.isLoggedIn()) {
          Logger.success("✅ Successfully logged into Twitter");
          const newCookies = await scraper.getCookies();
          await saveCookies(this.paths.raw.cookies, newCookies);
          this.scraper = scraper;
          Logger.stopSpinner();
          return scraper;
        } else {
          throw new Error(
            "Login attempt failed: Unable to verify login status."
          );
        }
      } catch (error) {
        retryCount++;
        Logger.warn(`⚠️ Login attempt ${retryCount} failed: ${error.message}`);
        if (retryCount >= this.config.twitter.maxRetries) {
          Logger.stopSpinner(false);
          throw new Error(
            `❌ Failed to authenticate after ${retryCount} attempts: ${error.message}`
          );
        }
        Logger.info(
          `⏳ Retrying in 5 seconds... (${retryCount}/${this.config.twitter.maxRetries})`
        );
        await new Promise((r) => setTimeout(r, this.config.twitter.retryDelay));
      }
    }

    Logger.stopSpinner(false);
    throw new Error("❌ Failed to initialize scraper after maximum retries");
  }

  processTweetData(tweet) {
    try {
      Logger.info(`Processing Tweet ID: ${tweet.id}`);
      Logger.info(`Raw Tweet Data: ${JSON.stringify(tweet, null, 2)}`);

      const createdAt = this.parseTweetDate(tweet.createdAt, tweet.timestamp);

      if (!createdAt) {
        Logger.warn(`⚠️ Tweet ID ${tweet.id} has an invalid or missing date.`);
        Logger.info(`📄 Tweet Data: ${JSON.stringify(tweet, null, 2)}`);
      }

      const likes =
        typeof tweet.likes === "number"
          ? tweet.likes
          : parseInt(tweet.likes) || 0;
      const retweetCount =
        typeof tweet.retweets === "number"
          ? tweet.retweets
          : parseInt(tweet.retweets) || 0;
      const replies =
        typeof tweet.replies === "number"
          ? tweet.replies
          : parseInt(tweet.replies) || 0;

      const isRetweet = tweet.text.startsWith("RT @");

      Logger.info(
        `Tweet ID: ${tweet.id} | Likes: ${likes} | Retweets: ${retweetCount} | Replies: ${replies} | Quotes: ${tweet.quotes}`
      );

      // Remove URLs and Hashtags from text
      let cleanText = tweet.text
        .replace(/(?:https?:\/\/|www\.)[^\s]+/g, "") // Remove URLs
        .replace(/#[^\s#]+/g, "") // Remove Hashtags
        .replace(/\s+/g, " ")
        .trim();

      return {
        id: tweet.id,
        text: cleanText, // Exclude username
        username: tweet.username || "unknown",
        createdAt: createdAt ? createdAt.toISOString() : null,
        timestamp: createdAt ? createdAt.getTime() : null,
        isReply: !!tweet.isReply,
        inReplyToStatusId: tweet.inReplyToStatusId || null,
        inReplyToUsername: tweet.inReplyToUsername || "unknown",
        photos: (tweet.photos || []).filter((media) => media.type === "photo"),
        videos: (tweet.videos || []).filter((media) => media.type === "video"),
        // Exclude the 'urls' field by setting it to an empty array
        urls: [],
        likes: likes,
        retweetCount: retweetCount,
        replies: replies,
        quotes:
          typeof tweet.quotes === "number"
            ? tweet.quotes
            : parseInt(tweet.quotes) || 0,
        permanentUrl:
          tweet.permanentUrl ||
          `https://twitter.com/${tweet.username}/status/${tweet.id}`,
        quotedTweet: tweet.quotedTweet || null,
        isRetweet: isRetweet,
      };
    } catch (error) {
      Logger.warn(`⚠️ Error processing tweet ID ${tweet.id}: ${error.message}`);
      return {
        id: tweet.id || "unknown",
        text: tweet.text || "Error processing tweet",
        timestamp: null,
        error: error.message,
      };
    }
  }

  parseTweetDate(dateStr, timestampSec = null) {
    try {
      if (!dateStr && !timestampSec) {
        Logger.warn(`⚠️ Missing date string and timestamp.`);
        return null;
      }

      let parsed;

      if (dateStr) {
        if (typeof dateStr === "string") {
          parsed = new Date(dateStr);
        } else if (typeof dateStr === "number") {
          parsed = new Date(dateStr);
        }
      }

      if (timestampSec && !parsed) {
        parsed = new Date(timestampSec * 1000);
      }

      if (!isValid(parsed)) {
        Logger.warn(`⚠️ Invalid date found: ${dateStr || timestampSec}`);
        return null;
      }

      return parsed;
    } catch (error) {
      Logger.warn(
        `⚠️ Error parsing date: ${dateStr || timestampSec} - ${error.message}`
      );
      return null;
    }
  }

  async collectTweets(scraper) {
    const tweets = [];
    const rateLimiter = new RateLimiter(this.config.twitter.rateLimitDelay);
    const searchLimiter = new RateLimiter(this.config.twitter.searchDelay);

    try {
      const profile = await scraper.getProfile(this.username);
      const totalTweets = profile.tweetsCount;

      Logger.info(
        `📊 Found ${chalk.bold(
          totalTweets.toLocaleString()
        )} total tweets/replies for @${this.username}`
      );

      const bar = new ProgressBar("[:bar] :current/:total tweets (:percent)", {
        total: totalTweets,
        width: 30,
        complete: "=",
        incomplete: " ",
      });

      let cursor = null;
      let consecutiveKnown = 0;

      while (true) {
        await rateLimiter.wait();

        try {
          const tweetsStream = scraper.getTweets(
            this.username,
            this.config.twitter.batchSize,
            cursor
          );

          let batchCount = 0;
          let lastId = null;

          for await (const tweet of tweetsStream) {
            const tweetObj = this.processTweetData(tweet);
            lastId = tweetObj.id;

            if (!this.history.isKnown(tweetObj.id)) {
              tweets.push(tweetObj);
              this.history.addTweet(tweetObj.id);
              bar.tick();
              consecutiveKnown = 0;
            } else {
              consecutiveKnown++;
            }

            batchCount++;

            if (consecutiveKnown > 50) {
              Logger.info(
                "\n📈 Reached a sequence of known tweets, assuming caught up."
              );
              break;
            }
          }

          if (batchCount === 0 || consecutiveKnown > 50) {
            break;
          }

          cursor = lastId;
          await new Promise((r) =>
            setTimeout(r, this.config.twitter.delayBetweenBatches)
          );
        } catch (error) {
          Logger.warn(`⚠️ Error collecting tweets: ${error.message}`);
          await new Promise((r) =>
            setTimeout(r, this.config.twitter.retryDelay)
          );
        }
      }

      if (this.tweetFilter.options.tweetTypes?.includes("replies")) {
        Logger.info("\n🔍 Searching for additional replies...");
        let searchCursor = null;

        while (true) {
          await searchLimiter.wait();

          try {
            const searchResults = await scraper.fetchSearchTweets(
              `from:${this.username} filter:replies`,
              this.config.twitter.searchBatchSize,
              SearchMode.Latest,
              searchCursor
            );

            if (!searchResults?.tweets?.length) {
              Logger.info("\n📊 No more replies found!");
              break;
            }

            let newCount = 0;
            let consecutiveKnownReplies = 0;

            for (const tweet of searchResults.tweets) {
              const tweetObj = this.processTweetData(tweet);

              if (!this.history.isKnown(tweetObj.id)) {
                tweets.push(tweetObj);
                this.history.addTweet(tweetObj.id);
                bar.tick();
                newCount++;
                consecutiveKnownReplies = 0;
              } else {
                consecutiveKnownReplies++;
              }

              if (consecutiveKnownReplies > 50) {
                Logger.info(
                  "\n📈 Reached a sequence of known replies, assuming caught up."
                );
                break;
              }
            }

            if (newCount === 0 && !searchResults.next_cursor) {
              Logger.info("\n📊 No new replies found!");
              break;
            }

            searchCursor = searchResults.next_cursor;
            await new Promise((r) =>
              setTimeout(r, this.config.twitter.delayBetweenBatches)
            );
          } catch (error) {
            Logger.warn(`⚠️ Error searching replies: ${error.message}`);
            await new Promise((r) =>
              setTimeout(r, this.config.twitter.retryDelay)
            );
          }
        }
      }

      this.history.saveHistory();
    } catch (error) {
      Logger.error(`❌ Failed to collect tweets: ${error.message}`);
      if (tweets.length === 0) {
        throw error;
      } else {
        Logger.warn("⚠️ Continuing with partially collected data...");
      }
    }

    return tweets;
  }

  async run() {
    const startTime = Date.now();

    console.log("\n" + chalk.bold.blue("🐦 Twitter Data Collection Pipeline"));
    console.log(
      chalk.bold(`Target Account: ${chalk.cyan("@" + this.username)}\n`)
    );

    try {
      await this.tweetFilter.promptCollectionMode();

      await this.validateEnvironment();
      Logger.info("✅ Environment validated.");

      Logger.info("🔍 Initializing scraper...");
      this.scraper = await this.initializeScraper();

      Logger.startSpinner("Fetching account information");
      const profile = await this.scraper.getProfile(this.username);
      Logger.stopSpinner();

      Logger.info(
        `📊 Found ${chalk.bold(
          profile.tweetsCount.toLocaleString()
        )} tweets for @${this.username}`
      );

      Logger.startSpinner(`Collecting tweets from @${this.username}`);
      const allTweets = await this.collectTweets(this.scraper);
      Logger.stopSpinner();

      Logger.info(`✅ Total tweets collected: ${allTweets.length}`);

      let filteredTweets = allTweets;
      if (
        this.tweetFilter.options.tweetTypes?.length !== 4 ||
        this.tweetFilter.options.filterByEngagement ||
        this.tweetFilter.options.filterByDate ||
        this.tweetFilter.options.excludeKeywords
      ) {
        Logger.startSpinner("Applying filters");
        filteredTweets = allTweets.filter((tweet) =>
          this.tweetFilter.shouldIncludeTweet(tweet)
        );
        Logger.stopSpinner();

        Logger.info(
          `⚙️ Filtered out ${chalk.yellow(
            allTweets.length - filteredTweets.length
          )} tweets based on criteria`
        );
      }

      if (filteredTweets.length === 0) {
        Logger.warn("⚠️ No tweets matched the specified criteria.");
        Logger.success("🎉 Pipeline completed with no tweets saved.");
        await this.scraper.logout();
        Logger.success("🔒 Logged out successfully.");
        return;
      }

      Logger.startSpinner("Processing and saving data");
      const analytics = await this.dataOrganizer.saveTweets(filteredTweets);
      Logger.stopSpinner();

      Logger.stats("📈 Collection Results", {
        "Total Tweets Found": allTweets.length,
        "Tweets Saved": filteredTweets.length,
        "Direct Tweets": analytics.directTweets,
        Replies: analytics.replies,
        "Retweets (retweeted tweets)": analytics.retweets,
        "Total Likes": analytics.engagement.totalLikes.toLocaleString(),
        "Total Retweet Count": analytics.engagement.totalRetweetCount.toLocaleString(),
        "Total Replies": analytics.engagement.totalReplies.toLocaleString(),
        "Date Range": `${analytics.timeRange.start} to ${analytics.timeRange.end}`,
        "Storage Location": chalk.gray(this.dataOrganizer.baseDir),
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      Logger.success(`⏰ Pipeline completed in ${duration} seconds`);

      await this.showSampleTweets(filteredTweets);

      await this.scraper.logout();
      Logger.success("🔒 Logged out successfully.");
      return analytics;
    } catch (error) {
      Logger.error(`❌ Pipeline failed: ${error.message}`);
      try {
        if (this.scraper) {
          await this.scraper.logout();
          Logger.success("🔒 Logged out successfully.");
        }
      } catch (logoutError) {
        Logger.error(`❌ Error during logout: ${logoutError.message}`);
      }
      throw error;
    }
  }

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
      Logger.info("\n🌟 Sample Tweets:");

      // Exclude retweets and replies
      const originalTweets = tweets.filter(
        (tweet) => !tweet.isRetweet && !tweet.isReply
      );

      if (originalTweets.length === 0) {
        Logger.warn("No original tweets available to display.");
        return;
      }

      // Sort by date descending (newest first)
      const sortedTweets = originalTweets.sort(
        (a, b) => b.timestamp - a.timestamp
      );

      const sampleTweets = sortedTweets.slice(0, 5);

      sampleTweets.forEach((tweet, i) => {
        console.log(
          chalk.cyan(
            `\n${i + 1}. [${format(new Date(tweet.timestamp), "yyyy-MM-dd")}]`
          )
        );
        console.log(chalk.white(tweet.text));
        console.log(
          chalk.gray(
            `❤️ Likes: ${tweet.likes.toLocaleString()} | 🔄 Retweets: ${tweet.retweetCount.toLocaleString()}`
          )
        );
      });
    }
  }
}

process.on("unhandledRejection", (error) => {
  Logger.error(`❌ Unhandled promise rejection: ${error.message}`);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  Logger.error(`❌ Uncaught exception: ${error.message}`);
  process.exit(1);
});

const cleanup = async () => {
  Logger.warn("\n🛑 Received termination signal. Cleaning up...");
  try {
    if (pipeline.scraper) {
      await pipeline.scraper.logout();
      Logger.success("🔒 Logged out successfully.");
    }
  } catch (error) {
    Logger.error(`❌ Error during cleanup: ${error.message}`);
  }
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

const args = process.argv.slice(2);
const username = args[0] || "degenspartan";

const pipeline = new TwitterPipeline(username);

pipeline.run().catch(() => process.exit(1));
