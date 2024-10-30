import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TWEETS_FILE = path.join(__dirname, 'output-files/tweets.json');
const CLEANED_TWEETS_FILE = path.join(__dirname, 'output-files/tweets_cleaned.json');

function removeDuplicates() {
  try {
    // Read the JSON file
    const rawData = fs.readFileSync(TWEETS_FILE, 'utf-8');
    const tweets = JSON.parse(rawData);

    // Track seen tweet text content
    const seenContent = new Set();
    const uniqueTweets = [];

    // Keep only tweets with unique text content
    for (const tweet of tweets) {
      // Normalize text by trimming whitespace and converting to lowercase
      const normalizedText = tweet.text?.trim().toLowerCase();
      
      if (normalizedText && !seenContent.has(normalizedText)) {
        seenContent.add(normalizedText);
        uniqueTweets.push(tweet);
      }
    }

    console.log(`Total tweets processed: ${tweets.length}`);
    console.log(`Unique tweets found: ${uniqueTweets.length}`);
    console.log(`Duplicates removed: ${tweets.length - uniqueTweets.length}`);

    // Save unique tweets
    fs.writeFileSync(CLEANED_TWEETS_FILE, JSON.stringify(uniqueTweets, null, 2));
    console.log(`Cleaned tweets saved to ${CLEANED_TWEETS_FILE}`);

    // Show sample of duplicates found (if any)
    if (tweets.length !== uniqueTweets.length) {
      console.log('\nExample duplicates found:');
      const textCount = new Map();
      tweets.forEach(tweet => {
        const text = tweet.text?.trim().toLowerCase();
        if (text) {
          textCount.set(text, (textCount.get(text) || 0) + 1);
        }
      });

      // Show a few examples of duplicated content
      let duplicatesShown = 0;
      for (const [text, count] of textCount) {
        if (count > 1 && duplicatesShown < 3) {
          console.log(`\nFound ${count} copies of tweet:`);
          console.log(text.substring(0, 100) + (text.length > 100 ? '...' : ''));
          duplicatesShown++;
        }
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

removeDuplicates();