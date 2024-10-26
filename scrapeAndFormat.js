// scrapeAndFormat.js
import { Scraper } from 'agent-twitter-client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio'; // Updated import
import ProgressBar from 'progress';

// Initialize environment variables
dotenv.config();

// Constants
const TWEETS_FILE = 'tweets.json';
const BLOG_URLS_FILE = 'degenspartanblogurls.txt';
const TWEET_URLS_FILE = 'degenspartan_tweet_urls.txt';
const BLOGS_FILE = 'blogs.json';
const OUTPUT_FILE = 'together_ai_finetuning_data.jsonl';
const MAX_DATA_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB

// Helper function to load URLs from a file
function loadUrls(filePath) {
  try {
    const absolutePath = path.resolve(filePath);
    const data = fs.readFileSync(absolutePath, 'utf-8');
    const urls = data
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
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
  console.log('Starting Twitter Scraping...');
  const scraper = new Scraper();

  try {
    await scraper.login(process.env.TWITTER_USERNAME, process.env.TWITTER_PASSWORD);

    if (await scraper.isLoggedIn()) {
      console.log('Logged in to Twitter successfully!');

      // Fetch all tweets for the user "@degenspartan"
      const tweetsStream = scraper.getTweets('degenspartan', 2000); // Adjust the number as needed

      let fetchedTweets = [];

      // Load existing tweets if the file exists
      if (fs.existsSync(TWEETS_FILE)) {
        const existingData = fs.readFileSync(TWEETS_FILE, 'utf-8');
        fetchedTweets = JSON.parse(existingData);
      }

      // Initialize counters
      let count = 0;
      const maxTweets = 1000; // Fetch up to 1000 new tweets. Adjust as needed.

      // Initialize progress bar
      const bar = new ProgressBar('Fetching Tweets [:bar] :current/:total', {
        total: maxTweets,
        width: 40,
      });

      for await (const tweet of tweetsStream) {
        if (count >= maxTweets) break;

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
      }

      // Save the fetched tweets to the JSON file
      fs.writeFileSync(TWEETS_FILE, JSON.stringify(fetchedTweets, null, 2));
      console.log(`\nFetched ${count} tweets and saved to ${TWEETS_FILE}`);

      await scraper.logout();
      console.log('Logged out from Twitter successfully!');
    } else {
      console.log('Twitter login failed. Please check your credentials.');
    }
  } catch (error) {
    console.error('An error occurred during Twitter scraping:', error);
  }
}

// Function to scrape blogs
async function scrapeBlogs() {
  console.log('\nStarting Blog Scraping...');
  const blogUrls = loadUrls(BLOG_URLS_FILE);
  console.log(`Found ${blogUrls.length} blog URLs to scrape.`);

  let fetchedBlogs = [];

  // Load existing blogs if the file exists
  if (fs.existsSync(BLOGS_FILE)) {
    const existingData = fs.readFileSync(BLOGS_FILE, 'utf-8');
    fetchedBlogs = JSON.parse(existingData);
  }

  // Initialize progress bar
  const bar = new ProgressBar('Scraping Blogs [:bar] :current/:total', {
    total: blogUrls.length,
    width: 40,
  });

  for (const url of blogUrls) {
    try {
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);

      // Adjust selectors based on the blog's HTML structure
      const content = $('div.post-body, div.entry-content').text().trim();

      if (content) {
        fetchedBlogs.push({ text: content });
      } else {
        console.warn(`No content found for blog: ${url}`);
      }
    } catch (error) {
      console.error(`Error scraping blog ${url}:`, error.message);
    }
    bar.tick();
  }

  // Save the fetched blogs to the JSON file
  fs.writeFileSync(BLOGS_FILE, JSON.stringify(fetchedBlogs, null, 2));
  console.log(`\nScraped ${fetchedBlogs.length} blogs and saved to ${BLOGS_FILE}`);
}

// Function to format data into JSONL
function formatData() {
  console.log('\nStarting Data Formatting...');
  let combinedData = [];

  // Load tweets
  if (fs.existsSync(TWEETS_FILE)) {
    const tweets = JSON.parse(fs.readFileSync(TWEETS_FILE, 'utf-8'));
    const formattedTweets = tweets.map(tweet => ({ text: tweet.text }));
    combinedData = combinedData.concat(formattedTweets);
    console.log(`Loaded ${formattedTweets.length} tweets.`);
  } else {
    console.warn(`${TWEETS_FILE} not found.`);
  }

  // Load blogs
  if (fs.existsSync(BLOGS_FILE)) {
    const blogs = JSON.parse(fs.readFileSync(BLOGS_FILE, 'utf-8'));
    combinedData = combinedData.concat(blogs);
    console.log(`Loaded ${blogs.length} blogs.`);
  } else {
    console.warn(`${BLOGS_FILE} not found.`);
  }

  // Shuffle data to mix tweets and blogs
  combinedData = shuffleArray(combinedData);
  console.log('Shuffled combined data.');

  // Check total size
  const totalSize = combinedData.reduce((acc, entry) => acc + Buffer.byteLength(JSON.stringify(entry)) + 1, 0); // +1 for newline
  console.log(`Total data size: ${(totalSize / (1024 ** 3)).toFixed(2)} GB`);

  if (totalSize > MAX_DATA_SIZE_BYTES) {
    console.error('Data exceeds 5GB. Please reduce the number of tweets/blogs or implement splitting.');
    return;
  }

  // Write to JSONL
  const writeStream = fs.createWriteStream(path.resolve(OUTPUT_FILE), { flags: 'w' });

  combinedData.forEach(entry => {
    writeStream.write(`${JSON.stringify(entry, null, 0)}\n`);
  });

  writeStream.end();
  console.log(`\nData formatted and saved to ${OUTPUT_FILE}`);
}

// Main function to orchestrate scraping and formatting
async function main() {
  console.log('=== Data Scraping and Formatting Started ===');

  // Step 1: Scrape Tweets
  await scrapeTweets();

  // Step 2: Scrape Blogs
  await scrapeBlogs();

  // Step 3: Format Data into JSONL
  formatData();

  console.log('\n=== Process Completed Successfully ===');
}

main();
