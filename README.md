# Twitter Data Collection Pipeline

Collect and analyze Twitter data with customizable filters and analytics.

## Features

- Tweet collection with filters
- Interactive configuration
- Analytics and engagement metrics
- Progress tracking
- Rate limiting and error handling
- Organized data exports

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```
TWITTER_USERNAME=your_twitter_username
TWITTER_PASSWORD=your_twitter_password
```

## Usage

### Twitter Scraper
```bash
npm run twitter -- username
```
Example: `npm run twitter -- pmarca`

### Blog Scraper
```bash
npm run blog
```

### Generate Character
```bash
npm run generate:character -- username
```
Example: `npm run generate:character -- pmarca`

## Output Directory

- `/raw` - Raw tweet data
- `/processed` - Processed data
- `/analytics` - Statistics and metrics
- `/exports` - Summary reports