# Degen Scraper

Pipeline for generating AI character files and training datasets by scraping public figures' online presence across Twitter and blogs.

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

### Twitter Collection
```bash
npm run twitter -- username
```
Example: `npm run twitter -- pmarca`

### Blog Collection
```bash
npm run blog
```

### Generate Character
```bash
npm run generate:character -- username
```
Example: `npm run generate:character -- pmarca`

## Output

- `/datasets` - Training datasets
- `/characters` - Generated character files
- `/raw` - Source data
- `/processed` - Cleaned data