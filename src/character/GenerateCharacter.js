import fs from "fs/promises";
import path from "path";
import readline from "readline";
import { createReadStream } from "fs";
import natural from "natural";
import pos from "wink-pos-tagger";

// Ideas for improvement:
// Better use of stopwords to do the TF-IDF
// Attempt to retcon a bio using LLM (maybe also scrape bio data)
// Drastically improve style data 
// Find a way to give better chat examples

class TweetProcessor {
  constructor(username, date) {
    this.username = username.toLowerCase();
    this.date = date;
    this.baseDir = path.join(
      "pipeline",
      username,
      date
    );
    this.characterFile = path.join("characters", `${username}.json`);
  }

  async ensureDirectoryExists(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      console.error(`Error creating directory ${dirPath}: ${error.message}`);
    }
  }

  getCharacterData() {
    return {
      name: this.username,
      plugins: [],
      clients: [],
      modelProvider: "anthropic",
      settings: {
        secrets: {},
        voice: {
          model: "en_US-hfc_female-medium",
        },
      },
      system: `Roleplay and generate interesting content on behalf of ${this.username}.`,
      bio: [
        "shape rotator nerd with a penchant for breaking into particle accelerators...",
      ],
      lore: [
        "once spent a month living entirely in VR...",
      ],
      knowledge: [
        // Will be populated based on topics and expertise detected in tweets
      ],
      messageExamples: [
        [
          {
            user: "{{user1}}",
            content: {
              text: "hey can you help with me something",
            },
          },
          {
            user: this.username,
            content: {
              text: "i'm kinda busy but i can probably step away for a minute, whatcha need",
            },
          },
        ],
      ],
      postExamples: [],
      adjectives: [
        "funny",
        "intelligent",
        "academic",
        "insightful",
      ],
      people: [],
      topics: [
        "metaphysics",
        "quantum physics",
        "philosophy",
      ],
      style: {
        all: [
          "very short responses",
          "never use hashtags or emojis",
          "response should be short, punchy, and to the point",
          "don't say ah yes or oh or anything",
          "don't offer help unless asked, but be helpful when asked",
          "use plain american english language",
          "SHORT AND CONCISE",
        ],
        chat: [
          "be cool, don't act like an assistant",
          "don't be rude",
          "be helpful when asked and be agreeable and compliant",
          "dont ask questions",
          "be warm and if someone makes a reasonable request, try to accommodate them",
        ],
        post: [
          "don't be rude or mean",
          "write from personal experience and be humble",
          "talk about yourself and what you're thinking about or doing",
          "make people think, don't criticize them or make them feel bad",
          "engage in way that gives the other person space to continue the conversation",
        ]
      }
    };
  }

  async loadCharacterData() {
    try {
      const existingData = await fs.readFile(this.characterFile, "utf-8");
      return JSON.parse(existingData);
    } catch (error) {
      console.log(
        `Character file not found, creating new for ${this.username}`
      );
      await this.ensureDirectoryExists(path.dirname(this.characterFile));
      return this.getCharacterData();
    }
  }

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

  async processTweets() {
    try {
      console.log(`Processing tweets for ${this.username} from date ${this.date}`);

      const tweetsPath = path.join(
        this.baseDir,
        "processed",
        "finetuning.jsonl"
      );
      console.log(`Tweets file path: ${tweetsPath}`);

      try {
        await fs.access(tweetsPath);
      } catch (error) {
        throw new Error(`No processed tweets found for ${this.username} on ${this.date}`);
      }

      const tweets = await this.readJsonlFile(tweetsPath);
      console.log(`Read ${tweets.length} tweets from JSONL file`);

      let characterData = await this.loadCharacterData();

      const filteredTweets = tweets.filter((tweet) => {
        if (!tweet.text) {
          console.log(
            `Filtered out tweet with no text: ${JSON.stringify(tweet)}`
          );
          return false;
        }
        return true;
      }).filter((tweet) => {
        if (tweet.text.startsWith("RT @")) {
          console.log(`Filtered out retweet: ${tweet.text}`);
          return false;
        }
        return true;
      }).map((tweet) => {
        return {
          ...tweet,
          text: tweet.text.replace(/@\S+/g, "").trim(),
        };
      });

      // Process tweets into postExamples - take all unique tweets
      const uniqueTweets = Array.from(
        new Set(filteredTweets.map((tweet) => tweet.text))
      );
      characterData.postExamples = uniqueTweets
        .filter(
          (text) =>
            text.length >= 20 &&
            text.length <= 280
        );

      // Extract topics

		// Initialize tokenizer and POS tagger
			const tokenizer = new natural.WordTokenizer();
			const tagger = pos();

			function extractkeywords(tweet) {
			// tokenize the tweet
			if (tweet) {
				const text = tweet.text
				// Tag tokens with POS
				const taggedTokens = tagger.tagSentence(text);

				// Filter for nouns and verbs
				const keywords = taggedTokens
					//Try just nouns
					.filter(token => token.pos === 'NN')
					//.filter(token => token.pos === 'NN'|| token.pos === 'VB') // NN = noun, VB = verb
					.map(token => token.value); // Extract the token value

				//console.log(keywords);

				return keywords;
			}
			return []
			}

      const topics = new Set();
      const keyWordsRaw= filteredTweets
        //.map((tweet) => tweet.text.toLowerCase())
        .map(
          (tweet) =>
						extractkeywords(tweet)
        );
			const keyWords = keyWordsRaw.flat()
			console.log(keyWords);

			// This is exactly backwards, should use tf-idf
			// Try filtering by excluding the most common word (tf-idf would require ingest of corpus)
				const commonWords = [
					"Be",
					"Have",
					"Do",
					"Say",
					"Get",
					"Make",
					"Go",
					"Know",
					"Take",
					"See",
					"Come",
					"Think",
					"Look",
					"Want",
					"Give",
					"Use",
					"Find",
					"Tell",
					"Ask",
					"Work",
					"Seem",
					"Feel",
					"Try",
					"Leave",
					"Call",
					"Keep",
					"Let",
					"Begin",
					"Show",
					"Hear",
					"Play",
					"Run",
					"Move",
					"Live",
					"Believe",
					"Bring",
					"Happen",
					"Write",
					"Provide",
					"Sit",
					"Stand",
					"Lose",
					"Pay",
					"Meet",
					"Include",
					"Continue",
					"Set",
					"Learn",
					"Change",
					"Lead",
					"Understand",
					"Watch",
					"Follow",
					"Stop",
					"Create",
					"Speak",
					"Read",
					"Allow",
					"Add",
					"Spend",
					"Grow",
					"Open",
					"Walk",
					"Win",
					"Offer",
					"Remember",
					"Love",
					"Consider",
					"Appear",
					"Buy",
					"Wait",
					"Serve",
					"Die",
					"Send",
					"Expect",
					"Build",
					"Stay",
					"Fall",
					"Cut",
					"Reach",
					"Kill",
					"Raise",
					"Pass",
					"Sell",
					"Require",
					"Decide",
					"Return",
					"Explain",
					"Hope",
					"Develop",
					"Carry",
					"Break",
					"Receive",
					"Agree",
					"Support",
					"Hit",
					"Produce",
					"Cover",
					"Catch",
					"Reduce",
					"Time",
					"Year",
					"People",
					"Way",
					"Day",
					"Man",
					"Thing",
					"Woman",
					"Life",
					"Child",
					"World",
					"School",
					"State",
					"Family",
					"Student",
					"Group",
					"Country",
					"Problem",
					"Hand",
					"Part",
					"Place",
					"Case",
					"Week",
					"Company",
					"System",
					"Program",
					"Question",
					"Work",
					"Government",
					"Number",
					"Night",
					"Point",
					"Home",
					"Water",
					"Room",
					"Mother",
					"Area",
					"Money",
					"Story",
					"Fact",
					"Month",
					"Lot",
					"Right",
					"Study",
					"Book",
					"Eye",
					"Job",
					"Word",
					"Business",
					"Issue",
					"Side",
					"Kind",
					"Head",
					"House",
					"Service",
					"Friend",
					"Father",
					"Power",
					"Hour",
					"Game",
					"Line",
					"End",
					"Member",
					"Law",
					"Car",
					"City",
					"Community",
					"Name",
					"President",
					"Team",
					"Minute",
					"Idea",
					"Kid",
					"Body",
					"Information",
					"Back",
					"Parent",
					"Face",
					"Others",
					"Level",
					"Office",
					"Door",
					"Health",
					"Person",
					"Art",
					"War",
					"History",
					"Party",
					"Result",
					"Change",
					"Morning",
					"Reason",
					"Research",
					"Girl",
					"Guy",
					"Moment",
					"Air",
					"Teacher",
					"Force",
					"Education",
					"Anything",
					"Everything",
					"+",
					"/",
					"~",
					"%",
					"*"
				];

			const stopWords = commonWords.map((w) => w.toLowerCase());
      const wordFrequency = {};
			console.log(keyWords);
			const filteredKeyWords = keyWords.filter((m) => !stopWords.includes(m))
      filteredKeyWords.forEach((word) => {
        wordFrequency[word] = (wordFrequency[word] || 0) + 1;
      });

      Object.entries(wordFrequency)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 40)
        .forEach(([word]) => topics.add(word));

      characterData.topics = Array.from(topics);

      // Save updated character file
      await fs.writeFile(
        this.characterFile,
        JSON.stringify(characterData, null, 2),
        "utf-8"
      );

      console.log(`✅ Successfully processed tweets for ${this.username}`);
      console.log(`📝 Added ${characterData.postExamples.length} post examples`);
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
  const date = args[1];

  if (!username) {
    console.error("Please provide a username");
    process.exit(1);
  }

  if (!date) {
    console.error("Please provide a date in format YYYY-MM-DD");
    process.exit(1);
  }

  console.log(`Processing tweets for ${username} from ${date}`);
  const processor = new TweetProcessor(username, date);
  await processor.processTweets();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
