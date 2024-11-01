# Twitter Data Collection Pipeline

An advanced tool for collecting and analyzing Twitter data with customizable filters and detailed analytics.

## Features

- Complete or filtered tweet collection
- Interactive configuration
- Detailed analytics and engagement metrics
- Progress tracking and elegant logging
- Automatic rate limiting and error handling
- Data organization with exports

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a .env file:
   ```
   TWITTER_USERNAME=your_twitter_username
   TWITTER_PASSWORD=your_twitter_password
   ```

## Available Scripts

### Twitter Scraper
```bash
npm run twitter -- username
```
Example: `npm run twitter -- pmarca`

### Blog Scraper
```bash
npm run blog
```
Runs the blog scraping pipeline.

### Run All Scrapers
```bash
npm run scrape:all
```
Runs both Twitter and blog scrapers sequentially.

## Output

The pipeline creates a dated directory structure:
- /raw - Raw tweet data and URLs
- /processed - Processed data and history
- /analytics - Statistics and engagement metrics
- /exports - Human-readable summaries

## Examples

Collect tweets for a specific user:
```bash
npm run twitter -- pmarca
```

Generate a Character file for a specific user:
```bash
npm run generate:character -- pmarca
```

Show help:
```bash
node src/twitter/twitter-pipeline.js --help
```

## Directory Structure
```
/src
  /twitter
    - twitter-pipeline.js
  /blog
    - blogScrape.js
```