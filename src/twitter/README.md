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

3. Run the pipeline:
   ```bash
   npm start username
   ```

## Output

The pipeline creates a dated directory structure:
- /raw - Raw tweet data and URLs
- /processed - Processed data and history
- /analytics - Statistics and engagement metrics
- /exports - Human-readable summaries

## Examples

Collect all tweets:
```bash
node script.js elonmusk
```

Show help:
```bash
node script.js --help
```
