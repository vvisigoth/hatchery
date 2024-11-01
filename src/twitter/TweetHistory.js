// // TweetHistory.js
// import fs from 'fs';
// import Logger from './Logger.js';

// class TweetHistory {
//   constructor(historyPath) {
//     this.historyPath = historyPath;
//     this.knownTweets = new Set();
//     this.loadHistory();
//   }

//   loadHistory() {
//     try {
//       if (fs.existsSync(this.historyPath)) {
//         const history = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
//         this.knownTweets = new Set(history.tweetIds);
//         Logger.info(
//           `📚 Loaded history of ${this.knownTweets.size} known tweets`
//         );
//       }
//     } catch (error) {
//       Logger.warn(`⚠️ Error loading tweet history: ${error.message}`);
//       this.knownTweets = new Set();
//     }
//   }

//   saveHistory() {
//     try {
//       const history = {
//         tweetIds: Array.from(this.knownTweets),
//         lastUpdated: new Date().toISOString(),
//       };
//       fs.writeFileSync(this.historyPath, JSON.stringify(history, null, 2));
//       Logger.success(`Saved tweet history to ${this.historyPath}`);
//     } catch (error) {
//       Logger.error(`❌ Error saving tweet history: ${error.message}`);
//     }
//   }

//   isKnown(tweetId) {
//     return this.knownTweets.has(tweetId);
//   }

//   addTweet(tweetId) {
//     this.knownTweets.add(tweetId);
//   }

//   get size() {
//     return this.knownTweets.size;
//   }
// }

// export default TweetHistory;
