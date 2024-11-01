import fs from "fs/promises";
import path from "path";
import readline from "readline";
import { createReadStream } from "fs";

class TweetProcessor {
  constructor(username) {
    this.username = username.toLowerCase();
    this.baseDir = path.join(
      "pipeline",
      username,
      new Date().toISOString().split("T")[0]
    );
    this.characterFile = path.join("characters", `${username}.character.json`);
  }

  /**
   * Utility function to ensure directory exists
   */
  async ensureDirectoryExists(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      console.error(`Error creating directory ${dirPath}: ${error.message}`);
    }
  }

  /**
   * Get default character data
   */
  getDefaultCharacterData() {
    return {
      name: this.username,
      clients: ["discord", "direct", "telegram"],
      settings: {
        model: "gpt-4-mini",
        embeddingModel: "text-embedding-3-small",
        secrets: {},
        voice: {
          model: "en_US-male-medium",
        },
      },
      bio: [""],
      lore: [""],
      knowledge: [""],
      messageExamples: [
        [
          {
            user: "{{user1}}",
            content: {
              text: "question",
            },
          },
          {
            user: this.username,
            content: {
              text: "answer",
            },
          },
        ],
      ],
      postExamples: [],
      topics: [""],
      style: {
        all: [""],
        chat: [""],
        post: [""],
      },
      adjectives: [""],
    };
  }

  /**
   * Load character data or create a new one if not found
   */
  async loadCharacterData() {
    try {
      const existingData = await fs.readFile(this.characterFile, "utf-8");
      return JSON.parse(existingData);
    } catch (error) {
      console.log(
        `Character file not found, creating new for ${this.username}`
      );
      await this.ensureDirectoryExists(path.dirname(this.characterFile));
      return this.getDefaultCharacterData();
    }
  }

  /**
   * Read JSONL file line by line
   */
  async readJsonlFile(filePath) {
    const tweets = [];
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let lineNumber = 0;
    fileStream.on("error", (error) => {
      console.error(`Error reading file: ${error.message}`);
    });

    for await (const line of rl) {
      lineNumber++;
      if (line.trim()) {
        try {
          tweets.push(JSON.parse(line));
        } catch (error) {
          console.warn(
            `Warning: Could not parse line ${lineNumber}: ${line}. Error: ${error.message}`
          );
        }
      } else {
        console.log(`Skipping empty or whitespace line ${lineNumber}`);
      }
    }

    console.log(`Total tweets read: ${tweets.length}`);
    return tweets;
  }

  /**
   * Process tweets and update character file
   */
  async processTweets() {
    try {
      console.log(`Processing tweets for ${this.username}`);

      // Read tweets from JSONL
      const tweetsPath = path.join(
        this.baseDir,
        "processed",
        "finetuning.jsonl"
      );
      console.log(`Tweets file path: ${tweetsPath}`);
      const tweets = await this.readJsonlFile(tweetsPath);

      console.log(`Read ${tweets.length} tweets from JSONL file`);

      // Load or create character data
      let characterData = await this.loadCharacterData();

      // Process tweets
      const filteredTweets = tweets.filter((tweet) => {
        if (!tweet.text) {
          console.log(
            `Filtered out tweet with no text: ${JSON.stringify(tweet)}`
          );
          return false;
        }
        return true;
      });

      console.log(
        `Filtered tweets count after text check: ${filteredTweets.length}`
      );

      const retweetFilteredTweets = filteredTweets.filter((tweet) => {
        if (tweet.text.startsWith("RT @")) {
          console.log(`Filtered out retweet: ${tweet.text}`);
          return false;
        }
        return true;
      });

      console.log(
        `Filtered tweets count after retweet check: ${retweetFilteredTweets.length}`
      );

      // Remove all @usernames from the tweet text
      const mentionFilteredTweets = retweetFilteredTweets.map((tweet) => {
        return {
          ...tweet,
          text: tweet.text.replace(/@\S+/g, "").trim(),
        };
      });

      console.log(
        `Filtered tweets count after mention removal: ${mentionFilteredTweets.length}`
      );

      const processedTweets = mentionFilteredTweets
        .map((tweet) => {
          return {
            text: tweet.text,
            length: tweet.text.length,
            words: tweet.text.split(" ").length,
          };
        })
        .filter(
          (tweet) => tweet.text.length > 0 // Ensure meaningful content
        );

      console.log(`Processed tweets count: ${processedTweets.length}`);

      // Update postExamples with meaningful tweets
      const uniqueTweets = Array.from(
        new Set(processedTweets.map((tweet) => tweet.text))
      );
      characterData.postExamples = uniqueTweets
        .filter(
          (text) =>
            text.length >= 20 && // Reduced minimum length requirement
            text.length <= 280
        )
        .slice(0, 10000); // Keep top 10000 examples

      // Extract potential topics from tweets
      const topics = new Set();
      const commonWords = processedTweets
        .map((tweet) => tweet.text.toLowerCase())
        .join(" ")
        .split(" ")
        .filter(
          (word) =>
            word.length > 4 &&
            ![
              "https",
              "would",
              "could",
              "should",
              "their",
              "there",
              "about",
            ].includes(word)
        );

      const wordFrequency = {};
      commonWords.forEach((word) => {
        wordFrequency[word] = (wordFrequency[word] || 0) + 1;
      });

      // Get top topics
      Object.entries(wordFrequency)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
        .forEach(([word]) => topics.add(word));

      // Update topics
      characterData.topics = Array.from(topics);

      // Save updated character file
      await fs.writeFile(
        this.characterFile,
        JSON.stringify(characterData, null, 2),
        "utf-8"
      );

      // Print results
      console.log(`✅ Successfully processed tweets for ${this.username}`);
      console.log(
        `📝 Added ${characterData.postExamples.length} post examples`
      );
      console.log(`📝 Extracted ${characterData.topics.length} topics`);
    } catch (error) {
      console.error(`Failed to process tweets: ${error.message}`);
      throw error;
    }
  }
}

// Usage
const run = async () => {
  const args = process.argv.slice(2);
  const username = args[0];

  if (!username) {
    console.error("Please provide a username");
    process.exit(1);
  }

  const processor = new TweetProcessor(username);
  await processor.processTweets();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
