import { Scraper, SearchMode } from "agent-twitter-client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import ProgressBar from "progress";

dotenv.config();

function getConfigForUser(username) {
  const sanitizedUsername = username.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return {
    targetAccount: username,
    paths: {
      tweetUrls: `pipeline/${sanitizedUsername}-urls.txt`,
      tweets: `pipeline/${sanitizedUsername}-tweets.json`,
      finetuning: `pipeline/${sanitizedUsername}-finetuning.jsonl`,
      history: `pipeline/${sanitizedUsername}-history.json`,
      outputDir: "pipeline",
      cookies: "pipeline/twitter-cookies.json",
    },
    twitter: {
      batchSize: 2000,
      delayBetweenBatches: 1000,
      searchBatchSize: 100,
      maxRetries: 3,
      retryDelay: 5000,
      rateLimitDelay: 1000,
      searchSearchDelay: 2000,
    },
  };
}

function setupDirectories() {
  if (!fs.existsSync("pipeline")) {
    fs.mkdirSync("pipeline", { recursive: true });
    console.log(`Created output directory: pipeline`);
  }
}

function validateEnvironment() {
  const required = ["TWITTER_USERNAME", "TWITTER_PASSWORD"];
  const missing = required.filter((var_) => !process.env[var_]);

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach((var_) => console.error(`   - ${var_}`));
    console.log("\n📝 Create a .env file with YOUR Twitter credentials:");
    console.log(
      `TWITTER_USERNAME=your_username\nTWITTER_PASSWORD=your_password`
    );
    process.exit(1);
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
        console.log(
          `📚 Loaded history of ${this.knownTweets.size} known tweets`
        );
      }
    } catch (error) {
      console.warn("⚠️ Error loading tweet history:", error.message);
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
    } catch (error) {
      console.error("❌ Error saving tweet history:", error.message);
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

async function loadCookies() {
  try {
    if (fs.existsSync("pipeline/twitter-cookies.json")) {
      const cookiesData = fs.readFileSync(
        "pipeline/twitter-cookies.json",
        "utf8"
      );
      return JSON.parse(cookiesData);
    }
  } catch (error) {
    console.warn("⚠️ Error loading cookies:", error.message);
  }
  return null;
}

async function saveCookies(cookies) {
  try {
    fs.writeFileSync(
      "pipeline/twitter-cookies.json",
      JSON.stringify(cookies, null, 2)
    );
    console.log("✅ Cookies saved successfully");
  } catch (error) {
    console.error("❌ Error saving cookies:", error.message);
  }
}

async function initializeScraper() {
  const scraper = new Scraper();
  let retryCount = 0;

  while (retryCount < 3) {
    try {
      const cookies = await loadCookies();

      if (cookies) {
        console.log("🍪 Found existing cookies, attempting to use them...");
        try {
          const cookieStrings = cookies.map(
            (cookie) =>
              `${cookie.name}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}`
          );
          await scraper.setCookies(cookieStrings);
          if (await scraper.isLoggedIn()) {
            console.log("✅ Successfully authenticated using saved cookies");
            return scraper;
          }
          console.log("⚠️ Saved cookies are invalid or expired");
        } catch (error) {
          console.warn("⚠️ Error using saved cookies:", error.message);
        }
      }

      console.log("🔑 Logging in with credentials...");
      await scraper.login(
        process.env.TWITTER_USERNAME,
        process.env.TWITTER_PASSWORD
      );

      if (await scraper.isLoggedIn()) {
        console.log("✅ Successfully logged into Twitter");
        const newCookies = await scraper.getCookies();
        await saveCookies(newCookies);
        return scraper;
      }

      throw new Error("Login attempt failed");
    } catch (error) {
      retryCount++;
      if (retryCount >= 3) {
        throw new Error(
          `Failed to authenticate after ${retryCount} attempts: ${error.message}`
        );
      }
      console.warn(`\n⚠️ Login attempt ${retryCount} failed: ${error.message}`);
      console.log(`Retrying in 5 seconds...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

function parseTweetDate(dateStr) {
  try {
    if (!dateStr) return null;
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) {
      console.warn(`⚠️ Invalid date found: ${dateStr}`);
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn(`⚠️ Error parsing date: ${dateStr}`);
    return null;
  }
}

function processTweetData(tweet) {
  try {
    const core = tweet.core?.user_results?.result?.legacy || {};
    const legacy = tweet.legacy || {};
    const entities = legacy.entities || {};
    const quoted = tweet.quoted_status_result?.result || {};
    const quotedLegacy = quoted?.legacy || {};

    const createdAt = parseTweetDate(tweet.createdAt || legacy.created_at);
    const quotedCreatedAt = parseTweetDate(
      quoted.created_at || quotedLegacy.created_at
    );

    return {
      id: tweet.rest_id || tweet.id,
      name: tweet.name || core.name,
      username: tweet.username || core.screen_name,
      text: tweet.text || legacy.full_text,
      inReplyToStatusId:
        tweet.inReplyToStatusId || legacy.in_reply_to_status_id_str,
      inReplyToUserId: tweet.inReplyToUserId || legacy.in_reply_to_user_id_str,
      inReplyToUsername:
        tweet.inReplyToUsername || legacy.in_reply_to_screen_name,
      createdAt: createdAt ? createdAt.toISOString() : null,
      timestamp: createdAt ? createdAt.getTime() : null,
      userId: tweet.userId || legacy.user_id_str,
      conversationId: tweet.conversationId || legacy.conversation_id_str,
      hashtags: tweet.hashtags || entities.hashtags || [],
      mentions: tweet.mentions || entities.user_mentions || [],
      photos:
        tweet.photos ||
        (entities.media || []).filter((media) => media.type === "photo") ||
        [],
      urls: tweet.urls || entities.urls || [],
      videos:
        tweet.videos ||
        (entities.media || []).filter((media) => media.type === "video") ||
        [],
      likes: parseInt(tweet.like_count || legacy.favorite_count) || 0,
      retweets: parseInt(tweet.retweet_count || legacy.retweet_count) || 0,
      replies: parseInt(tweet.reply_count || legacy.reply_count) || 0,
      quotes: parseInt(tweet.quote_count || legacy.quote_count) || 0,
      permanentUrl: `https://twitter.com/${
        tweet.username || core.screen_name
      }/status/${tweet.rest_id || tweet.id}`,
      isRetweet: !!(tweet.text?.startsWith("RT @") || legacy.retweeted_status),
      isReply: !!(tweet.inReplyToStatusId || legacy.in_reply_to_status_id_str),
      quotedTweet: quoted
        ? {
            id: quoted.rest_id || quoted.id,
            text: quoted.text || quotedLegacy.full_text,
            username: quoted.core?.user_results?.result?.legacy?.screen_name,
            createdAt: quotedCreatedAt ? quotedCreatedAt.toISOString() : null,
          }
        : null,
      quotedTweetId: tweet.quoted_status_id_str || legacy.quoted_status_id_str,
      lang: tweet.lang || legacy.lang,
      source: tweet.source || legacy.source,
    };
  } catch (error) {
    console.error(`Error processing tweet: ${error.message}`);
    return {
      id: tweet.rest_id || tweet.id || "unknown",
      text: tweet.text || "Error processing tweet",
      createdAt: null,
      timestamp: null,
      error: error.message,
    };
  }
}

function processTweetForFinetuning(tweet, allTweets) {
  if (tweet.isRetweet || !tweet.text) {
    return null;
  }

  // Clean the text while preserving important formatting
  let cleanText = tweet.text
    .replace(/https?:\/\/\S+/g, "") // Remove URLs
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();

  if (!cleanText) {
    return null;
  }

  // For replies, format with context
  if (tweet.isReply && tweet.inReplyToStatusId) {
    const parentTweet = allTweets.find((t) => t.id === tweet.inReplyToStatusId);
    if (parentTweet) {
      const parentText = parentTweet.text
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .trim();

      return {
        text: `<human>: ${parentText}\nDegenSpartan: ${cleanText}`,
        metadata: {
          id: tweet.id,
          type: "reply",
          created_at: tweet.createdAt,
          engagement: {
            likes: tweet.likes,
            retweets: tweet.retweets,
            replies: tweet.replies,
            quotes: tweet.quotes,
          },
          in_reply_to: {
            tweet_id: tweet.inReplyToStatusId,
          },
          url: tweet.permanentUrl,
        },
      };
    }
  }

  // For standalone tweets
  return {
    text: `DegenSpartan: ${cleanText}`,
    metadata: {
      id: tweet.id,
      type: "tweet",
      created_at: tweet.createdAt,
      engagement: {
        likes: tweet.likes,
        retweets: tweet.retweets,
        replies: tweet.replies,
        quotes: tweet.quotes,
      },
      url: tweet.permanentUrl,
    },
  };
}

async function generateFinetuningData(tweets, config) {
  console.log("\n📚 Generating fine-tuning dataset...");

  const finetuningData = tweets
    .map((tweet) => processTweetForFinetuning(tweet, tweets))
    .filter((entry) => entry !== null);

  // Sort by engagement score (weighted)
  finetuningData.sort((a, b) => {
    const scoreA =
      a.metadata.engagement.likes * 2 + a.metadata.engagement.retweets;
    const scoreB =
      b.metadata.engagement.likes * 2 + b.metadata.engagement.retweets;
    return scoreB - scoreA;
  });

  const jsonlContent = finetuningData
    .map((entry) => JSON.stringify(entry))
    .join("\n");

  fs.writeFileSync(config.paths.finetuning, jsonlContent);

  console.log(`✅ Generated ${finetuningData.length} fine-tuning examples`);
  console.log(`📊 Dataset statistics:`);
  console.log(
    `   - Standalone tweets: ${
      finetuningData.filter((d) => d.metadata.type === "tweet").length
    }`
  );
  console.log(
    `   - Conversations: ${
      finetuningData.filter((d) => d.metadata.type === "reply").length
    }`
  );

  // Show sample of high-engagement content
  console.log("\n🌟 Sample entries:");
  finetuningData.slice(0, 3).forEach((entry, i) => {
    const engagement = entry.metadata.engagement;
    console.log(
      `\n${i + 1}. [${entry.metadata.type}] (❤️ ${engagement.likes} 🔄 ${
        engagement.retweets
      })`
    );
    console.log(`   ${entry.text}`);
  });

  return finetuningData;
}

async function getAllUserTweets(scraper, config, history) {
  console.log(
    `\n📱 Collecting tweets and replies from @${config.targetAccount}...`
  );
  const tweets = new Set();
  let cursor = null;
  let retryCount = 0;
  const rateLimiter = new RateLimiter(config.twitter.rateLimitDelay);
  const searchLimiter = new RateLimiter(config.twitter.searchSearchDelay);
  let foundNewTweets = false;

  try {
    const profile = await scraper.getProfile(config.targetAccount);
    const totalTweets = profile.tweetsCount;
    console.log(
      `\nFound ${totalTweets} total tweets/replies for @${config.targetAccount}`
    );
    console.log(`Previously collected: ${history.size} tweets`);

    const bar = new ProgressBar("[:bar] :current/:total items (:percent)", {
      total: totalTweets,
      width: 30,
      complete: "=",
      incomplete: " ",
    });

    // Timeline collection loop
    while (true) {
      try {
        await rateLimiter.wait();

        const tweetsStream = scraper.getTweets(
          config.targetAccount,
          config.twitter.batchSize,
          cursor
        );

        let batchCount = 0;
        let newInBatch = 0;
        let lastId = null;
        let consecutiveKnown = 0;

        for await (const tweet of tweetsStream) {
          const tweetObj = processTweetData(tweet);
          lastId = tweetObj.id;

          if (tweetObj.isRetweet) continue;

          if (!history.isKnown(tweetObj.id)) {
            if (!Array.from(tweets).some((t) => t.id === tweetObj.id)) {
              tweets.add(tweetObj);
              history.addTweet(tweetObj.id);
              newInBatch++;
              foundNewTweets = true;
            }
          } else {
            consecutiveKnown++;
          }

          batchCount++;
          bar.tick();

          // If we've seen too many known tweets in a row, we can assume we've caught up
          if (consecutiveKnown > 50) {
            console.log(
              "\n📊 Found sequence of known tweets, assuming caught up!"
            );
            break;
          }
        }

        if (batchCount === 0 || consecutiveKnown > 50) {
          console.log("\n📊 Reached end of new tweets!");
          break;
        }

        cursor = lastId;
        retryCount = 0;
        if (newInBatch > 0) {
          console.log(`\nCollected ${tweets.size} new items so far...`);
        }

        await new Promise((r) =>
          setTimeout(r, config.twitter.delayBetweenBatches)
        );
      } catch (error) {
        console.warn(`\n⚠️ Error: ${error.message}`);
        retryCount++;

        if (retryCount >= config.twitter.maxRetries) {
          if (tweets.size > 0) {
            console.log(
              "Max retries reached. Continuing with collected items..."
            );
            break;
          }
          throw error;
        }

        console.log(
          `Retrying in ${
            config.twitter.retryDelay / 1000
          } seconds... (${retryCount}/${config.twitter.maxRetries})`
        );
        await new Promise((r) => setTimeout(r, config.twitter.retryDelay));
      }
    }

    // Additional search for replies
    if (foundNewTweets) {
      console.log("\n🔍 Searching for additional replies...");
      let searchCursor;
      retryCount = 0;

      while (true) {
        try {
          await searchLimiter.wait();

          const searchResults = await scraper.fetchSearchTweets(
            `from:${config.targetAccount} filter:replies`,
            config.twitter.searchBatchSize,
            SearchMode.Latest,
            searchCursor
          );

          if (!searchResults?.tweets?.length) {
            console.log("\n📊 No more replies found!");
            break;
          }

          let newCount = 0;
          let consecutiveKnown = 0;

          for (const tweet of searchResults.tweets) {
            const tweetObj = processTweetData(tweet);

            if (tweetObj.isRetweet) continue;

            if (!history.isKnown(tweetObj.id)) {
              if (!Array.from(tweets).some((t) => t.id === tweetObj.id)) {
                tweets.add(tweetObj);
                history.addTweet(tweetObj.id);
                newCount++;
              }
            } else {
              consecutiveKnown++;
            }

            bar.tick();

            if (consecutiveKnown > 50) {
              console.log(
                "\n📊 Found sequence of known replies, assuming caught up!"
              );
              break;
            }
          }

          if (newCount === 0 && !searchResults.next_cursor) {
            console.log("\n📊 No new replies found!");
            break;
          }

          searchCursor = searchResults.next_cursor;
          if (newCount > 0) {
            console.log(`\nFound ${newCount} new replies...`);
          }

          await new Promise((r) =>
            setTimeout(r, config.twitter.delayBetweenBatches)
          );
          retryCount = 0;
        } catch (error) {
          console.warn(`\n⚠️ Error in reply search: ${error.message}`);
          retryCount++;

          if (retryCount >= config.twitter.maxRetries) {
            console.log("Max retries reached for reply search. Moving on...");
            break;
          }

          await new Promise((r) => setTimeout(r, config.twitter.retryDelay));
        }
      }
    }
  } catch (error) {
    console.error("\n❌ Failed to collect tweets:", error.message);
    if (tweets.size === 0) {
      throw error;
    } else {
      console.log("Continuing with partially collected data...");
    }
  }

  // Save the updated history
  history.saveHistory();

  // If we found new tweets, merge them with existing ones
  if (foundNewTweets && fs.existsSync(config.paths.tweets)) {
    try {
      const existingTweets = JSON.parse(
        fs.readFileSync(config.paths.tweets, "utf8")
      );
      const allTweets = new Set([...existingTweets, ...tweets]);
      return Array.from(allTweets);
    } catch (error) {
      console.warn("⚠️ Error merging with existing tweets:", error.message);
    }
  }

  return Array.from(tweets);
}

async function saveData(tweets, config) {
  try {
    if (tweets.length === 0) {
      console.log("\nℹ️ No new data to save");
      return;
    }

    // Save raw tweets
    fs.writeFileSync(config.paths.tweets, JSON.stringify(tweets, null, 2));
    console.log(
      `\n✅ Saved ${tweets.length} total items to ${config.paths.tweets}`
    );

    // Save URLs
    const urls = tweets.map((tweet) => tweet.permanentUrl);
    fs.writeFileSync(config.paths.tweetUrls, urls.join("\n"));
    console.log(`✅ Saved URLs to ${config.paths.tweetUrls}`);

    // Generate fine-tuning data
    await generateFinetuningData(tweets, config);

    // Print collection statistics
    const directTweets = tweets.filter((t) => !t.isReply);
    const replies = tweets.filter((t) => t.isReply);

    console.log("\n📊 Collection Statistics:");
    console.log(`   - Total items collected: ${tweets.length}`);
    console.log(`   - Direct tweets: ${directTweets.length}`);
    console.log(`   - Replies to others: ${replies.length}`);

    const validDates = tweets
      .map((t) => t.timestamp)
      .filter((timestamp) => timestamp !== null);

    if (validDates.length > 0) {
      const dateRange = {
        earliest: new Date(Math.min(...validDates)),
        latest: new Date(Math.max(...validDates)),
      };
      console.log(
        `   - Date range: ${
          dateRange.earliest.toISOString().split("T")[0]
        } to ${dateRange.latest.toISOString().split("T")[0]}`
      );

      const totalLikes = tweets.reduce((sum, t) => sum + (t.likes || 0), 0);
      const totalRetweets = tweets.reduce(
        (sum, t) => sum + (t.retweets || 0),
        0
      );
      const totalReplies = tweets.reduce((sum, t) => sum + (t.replies || 0), 0);
      console.log(`   - Total engagement:`);
      console.log(`     • Likes: ${totalLikes.toLocaleString()}`);
      console.log(`     • Retweets: ${totalRetweets.toLocaleString()}`);
      console.log(`     • Replies: ${totalReplies.toLocaleString()}`);
    }
  } catch (error) {
    console.error("\n❌ Error saving data:", error.message);
    throw error;
  }
}

async function runPipeline(username) {
  const config = getConfigForUser(username);
  console.log(`🚀 Starting Twitter Pipeline for @${config.targetAccount}\n`);
  let scraper = null;
  const startTime = Date.now();

  try {
    setupDirectories();
    validateEnvironment();

    const history = new TweetHistory(config.paths.history);

    console.log("1️⃣ Initializing Twitter scraper...");
    scraper = await initializeScraper();

    console.log("2️⃣ Collecting tweets and replies...");
    const allContent = await getAllUserTweets(scraper, config, history);

    console.log("3️⃣ Saving collected data...");
    await saveData(allContent, config);

    await scraper?.logout();
    const duration = (Date.now() - startTime) / 1000;
    console.log(
      `\n🎉 Pipeline completed successfully in ${duration.toFixed(1)} seconds!`
    );
  } catch (error) {
    console.error("\n❌ Pipeline failed:", error.message);
    try {
      await scraper?.logout();
    } catch (logoutError) {
      console.error("Error during logout:", logoutError.message);
    }
    process.exit(1);
  }
}

// Error handling for unhandled rejections
process.on("unhandledRejection", (error) => {
  console.error("\n💥 Unhandled promise rejection:", error);
  process.exit(1);
});

// Error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("\n💥 Uncaught exception:", error);
  process.exit(1);
});

// Handle cleanup on script termination
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Received termination signal. Cleaning up...");
  try {
    const scraper = new Scraper();
    await scraper.logout();
  } catch (error) {
    console.error("Error during cleanup:", error.message);
  }
  process.exit(0);
});

// Handle cleanup on termination
process.on("SIGTERM", async () => {
  console.log("\n\n🛑 Received termination signal. Cleaning up...");
  try {
    const scraper = new Scraper();
    await scraper.logout();
  } catch (error) {
    console.error("Error during cleanup:", error.message);
  }
  process.exit(0);
});

// Get username from command line or use default
const username = process.argv[2] || "degenspartan";

// Start the pipeline with the specified username
runPipeline(username);
