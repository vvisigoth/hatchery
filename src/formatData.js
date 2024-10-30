// formatData.js

import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Initialize environment variables
dotenv.config();

// Constants
const TWEETS_FILE = "output-file/tweets.json";
const BLOGS_FILE = "output-file/blogs.json";
const OUTPUT_FILE = "output-file/together_ai_finetuning_data.jsonl";
const MAX_DATA_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB

// Helper function to shuffle an array (Fisher-Yates Shuffle)
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Function to format data into JSONL
function formatData() {
  console.log("\n=== Starting Data Formatting ===");
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
    writeStream.write(`${JSON.stringify(entry)}\n`);
  });

  writeStream.end();
  console.log(`\nData formatted and saved to ${OUTPUT_FILE}`);
}

// Main function
function main() {
  try {
    console.log("=== Data Formatting Started ===");
    formatData();
    console.log("\n=== Data Formatting Completed Successfully ===");
  } catch (error) {
    console.error("Fatal error during data formatting:", error);
    process.exit(1);
  }
}

main();
