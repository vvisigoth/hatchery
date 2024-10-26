// scrapeAndFormat.js
import { Scraper } from "agent-twitter-client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import ProgressBar from "progress";

// Initialize environment variables
dotenv.config();

// Required environment variables based on actual usage
const requiredEnvVars = [
  "TWITTER_USERNAME",
  "TWITTER_PASSWORD",
  "BLOG_URLS_FILE",
  "TWEET_URLS_FILE",
];

// Validate environment variables
function validateEnv() {
  const missingVars = requiredEnvVars.filter(
    (varName) => !process.env[varName]
  );
  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(", ")}`
    );
  }

  // Validate that input files exist
  const inputFiles = [process.env.BLOG_URLS_FILE, process.env.TWEET_URLS_FILE];
  const missingFiles = inputFiles.filter((file) => !fs.existsSync(file));
  if (missingFiles.length > 0) {
    throw new Error(`Missing required input files: ${missingFiles.join(", ")}`);
  }
}

// Constants
const TWEETS_FILE = "tweets.json";
const BLOG_URLS_FILE = process.env.BLOG_URLS_FILE;
const TWEET_URLS_FILE = process.env.TWEET_URLS_FILE;
const BLOGS_FILE = "blogs.json";
const OUTPUT_FILE = "together_ai_finetuning_data.jsonl";
const MAX_DATA_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB

// Adjustable parameters
const DESIRED_TWEETS_COUNT = 60000; // Set to desired number of tweets
const FETCH_BATCH_SIZE = 200; // Number of tweets to fetch per batch
const RETRY_LIMIT = 5; // Number of retries on failure
const DELAY_BETWEEN_BATCHES_MS = 2000; // Delay between batches to handle rate limits

// Helper function to load URLs from a file
function loadUrls(filePath) {
  try {
    const absolutePath = path.resolve(filePath);
    const data = fs.readFileSync(absolutePath, "utf-8");
    const urls = data
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return urls;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return [];
  }
}

// Helper function to shuffle an array (Fisher-Yates Shuffle)
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Function to scrape tweets
async function scrapeTweets() {
  console.log("Starting Twitter Scraping...");
  const scraper = new Scraper();

  try {
    await scraper.login(
      process.env.TWITTER_USERNAME,
      process.env.TWITTER_PASSWORD
    );

    if (await scraper.isLoggedIn()) {
      console.log("Logged in to Twitter successfully!");

      // Initialize fetchedTweets with existing data if available
      let fetchedTweets = [];
      if (fs.existsSync(TWEETS_FILE)) {
        const existingData = fs.readFileSync(TWEETS_FILE, "utf-8");
        fetchedTweets = JSON.parse(existingData);
        console.log(`Loaded ${fetchedTweets.length} existing tweets.`);
      }

      // Calculate remaining tweets to fetch
      const remainingTweets = DESIRED_TWEETS_COUNT - fetchedTweets.length;
      if (remainingTweets <= 0) {
        console.log(
          `Desired tweet count of ${DESIRED_TWEETS_COUNT} already reached.`
        );
        return;
      }

      console.log(`Attempting to fetch ${remainingTweets} more tweets.`);

      // Initialize progress bar
      const bar = new ProgressBar("Fetching Tweets [:bar] :current/:total", {
        total: remainingTweets,
        width: 40,
      });

      let count = 0;
      let retries = 0;

      while (count < remainingTweets && retries < RETRY_LIMIT) {
        try {
          const tweetsStream = scraper.getTweets("degenspartan", FETCH_BATCH_SIZE);

          for await (const tweet of tweetsStream) {
            // Check if desired count is reached
            if (count >= remainingTweets) break;

            // Structure the tweet data
            fetchedTweets.push({
              text: tweet.text,
              created_at: tweet.createdAt,
              retweet_count: tweet.retweetCount,
              like_count: tweet.likeCount,
              id: tweet.id,
            });

            count++;
            bar.tick();

            // Check for maximum data size
            const currentSize = Buffer.byteLength(
              JSON.stringify(fetchedTweets)
            );
            if (currentSize > MAX_DATA_SIZE_BYTES) {
              console.warn(
                "Reached maximum data size limit. Stopping tweet scraping."
              );
              break;
            }
          }

          // Reset retries after a successful batch
          retries = 0;

          // Optional: Delay between batches to handle rate limits
          await new Promise((resolve) =>
            setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS)
          );
        } catch (error) {
          retries++;
          console.error(
            `Error fetching tweets (Attempt ${retries}/${RETRY_LIMIT}):`,
            error.message
          );
          if (retries >= RETRY_LIMIT) {
            throw new Error(
              "Maximum retry attempts reached. Aborting tweet scraping."
            );
          } else {
            // Optional: Exponential backoff
            const backoffTime = DELAY_BETWEEN_BATCHES_MS * retries;
            console.log(`Retrying in ${backoffTime / 1000} seconds...`);
            await new Promise((resolve) => setTimeout(resolve, backoffTime));
          }
        }
      }

      // Save the fetched tweets to the JSON file
      fs.writeFileSync(TWEETS_FILE, JSON.stringify(fetchedTweets, null, 2));
      console.log(`\nFetched ${count} tweets and saved to ${TWEETS_FILE}`);

      await scraper.logout();
      console.log("Logged out from Twitter successfully!");
    } else {
      console.log("Twitter login failed. Please check your credentials.");
    }
  } catch (error) {
    console.error("An error occurred during Twitter scraping:", error);
    throw error;
  }
}

/*
    // Function to scrape blogs with improved error handling
    async function scrapeBlogs() {
      console.log("\nStarting Blog Scraping...");
      const blogUrls = loadUrls(BLOG_URLS_FILE);
      console.log(`Found ${blogUrls.length} blog URLs to scrape.`);
    
      let fetchedBlogs = [];
      let errorLog = {
        notFound: [],
        loginRequired: [],
        networkErrors: [],
        emptyContent: [],
        otherErrors: []
      };
    
      // Load existing blogs if the file exists
      if (fs.existsSync(BLOGS_FILE)) {
        const existingData = fs.readFileSync(BLOGS_FILE, "utf-8");
        fetchedBlogs = JSON.parse(existingData);
      }
    
      // Initialize progress bar
      const bar = new ProgressBar("Scraping Blogs [:bar] :current/:total", {
        total: blogUrls.length,
        width: 40,
      });
    
      for (const url of blogUrls) {
        try {
          const response = await axios.get(url, {
            validateStatus: function (status) {
              return status < 500; // Resolve only if status is less than 500
            },
          });
    
          // Handle different HTTP status codes
          if (response.status === 404) {
            errorLog.notFound.push(url);
            console.warn(`\n404 Not Found: ${url}`);
            continue;
          }
    
          if (response.status === 403 || response.status === 401) {
            errorLog.loginRequired.push(url);
            console.warn(`\nLogin Required: ${url}`);
            continue;
          }
    
          if (response.status !== 200) {
            errorLog.otherErrors.push({ url, status: response.status });
            console.warn(`\nUnexpected status ${response.status}: ${url}`);
            continue;
          }
    
          const $ = cheerio.load(response.data);
    
          // Check for common login-wall indicators
          const loginIndicators = [
            'form[action*="login"]',
            'form[action*="signin"]',
            'div[class*="login"]',
            'div[class*="signin"]',
            'input[name="password"]'
          ];
    
          const hasLoginWall = loginIndicators.some(selector => $(selector).length > 0);
          if (hasLoginWall) {
            errorLog.loginRequired.push(url);
            console.warn(`\nLogin wall detected: ${url}`);
            continue;
          }
    
          // Adjust selectors based on the blog's HTML structure
          const content = $("div.post-body, div.entry-content").text().trim();
    
          if (!content || content.length < 50) { // Minimum content length threshold
            errorLog.emptyContent.push(url);
            console.warn(`\nNo content or too short content found for blog: ${url}`);
            continue;
          }
    
          fetchedBlogs.push({ text: content });
    
        } catch (error) {
          if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
              errorLog.networkErrors.push({ url, error: error.code });
              console.warn(`\nNetwork Error (${error.code}): ${url}`);
            } else {
              errorLog.otherErrors.push({ url, error: error.message });
              console.warn(`\nAxios Error: ${url} - ${error.message}`);
            }
          } else {
            errorLog.otherErrors.push({ url, error: error.message });
            console.warn(`\nUnexpected Error: ${url} - ${error.message}`);
          }
        } finally {
          bar.tick();
        }
      }
    
      // Save the fetched blogs to the JSON file
      fs.writeFileSync(BLOGS_FILE, JSON.stringify(fetchedBlogs, null, 2));
      
      // Save error log to a separate file
      fs.writeFileSync('blog_scraping_errors.json', JSON.stringify(errorLog, null, 2));
    
      // Print summary
      console.log("\n=== Scraping Summary ===");
      console.log(`Successfully scraped: ${fetchedBlogs.length} blogs`);
      console.log(`404 Not Found: ${errorLog.notFound.length}`);
      console.log(`Login Required: ${errorLog.loginRequired.length}`);
      console.log(`Network Errors: ${errorLog.networkErrors.length}`);
      console.log(`Empty Content: ${errorLog.emptyContent.length}`);
      console.log(`Other Errors: ${errorLog.otherErrors.length}`);
      console.log(`Error details saved to blog_scraping_errors.json`);
    }
*/

// Function to format data into JSONL
function formatData() {
  console.log("\nStarting Data Formatting...");
  let combinedData = [];

  // Load tweets
  if (fs.existsSync(TWEETS_FILE)) {
    const tweets = JSON.parse(fs.readFileSync(TWEETS_FILE, "utf-8"));
    const formattedTweets = tweets.map((tweet) => ({ text: tweet.text }));
    combinedData = combinedData.concat(formattedTweets);
    console.log(`Loaded ${formattedTweets.length} tweets.`);
  } else {
    console.warn(`${TWEETS_FILE} not found.`);
  }

  // Load blogs
  if (fs.existsSync(BLOGS_FILE)) {
    const blogs = JSON.parse(fs.readFileSync(BLOGS_FILE, "utf-8"));
    combinedData = combinedData.concat(blogs);
    console.log(`Loaded ${blogs.length} blogs.`);
  } else {
    console.warn(`${BLOGS_FILE} not found.`);
  }

  // Shuffle data to mix tweets and blogs
  combinedData = shuffleArray(combinedData);
  console.log("Shuffled combined data.");

  // Check total size
  const totalSize = combinedData.reduce(
    (acc, entry) => acc + Buffer.byteLength(JSON.stringify(entry)) + 1,
    0
  ); // +1 for newline
  console.log(`Total data size: ${(totalSize / 1024 ** 3).toFixed(2)} GB`);

  if (totalSize > MAX_DATA_SIZE_BYTES) {
    console.error(
      "Data exceeds 5GB. Please reduce the number of tweets/blogs or implement splitting."
    );
    return;
  }

  // Write to JSONL
  const writeStream = fs.createWriteStream(path.resolve(OUTPUT_FILE), {
    flags: "w",
  });

  combinedData.forEach((entry) => {
    writeStream.write(`${JSON.stringify(entry, null, 0)}\n`);
  });

  writeStream.end();
  console.log(`\nData formatted and saved to ${OUTPUT_FILE}`);
}

// Main function with improved error handling
async function main() {
  try {
    console.log("=== Data Scraping and Formatting Started ===");

    // Validate environment variables and input files before proceeding
    validateEnv();

    // Execute the scraping and formatting pipeline
    await scrapeTweets();
    // await scrapeBlogs(); // Blog scraping is commented out
    formatData();

    console.log("\n=== Process Completed Successfully ===");
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main();
