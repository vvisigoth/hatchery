// blogScrape.js

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import ProgressBar from "progress";

// Initialize environment variables
dotenv.config();

// Required environment variables for Blog scraping
const requiredEnvVars = [
  "BLOG_URLS_FILE",
];

// Validate environment variables
function validateEnv() {
  const missingVars = requiredEnvVars.filter(
    (varName) => !process.env[varName]
  );
  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(", ")}`
    );
  }

  // Validate that input file exists
  const inputFiles = [process.env.BLOG_URLS_FILE];
  const missingFiles = inputFiles.filter((file) => !fs.existsSync(file));
  if (missingFiles.length > 0) {
    throw new Error(`Missing required input files: ${missingFiles.join(", ")}`);
  }
}

// Helper function to load URLs from a file
function loadUrls(filePath) {
  try {
    const absolutePath = path.resolve(filePath);
    const data = fs.readFileSync(absolutePath, "utf-8");
    const urls = data
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return urls;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return [];
  }
}

// Function to scrape blogs with improved error handling
async function scrapeBlogs() {
  console.log("\n=== Starting Blog Scraping ===");
  const BLOGS_FILE = "blogs.json";
  const blogUrls = loadUrls(process.env.BLOG_URLS_FILE);
  console.log(`Found ${blogUrls.length} blog URLs to scrape.`);

  let fetchedBlogs = [];
  let errorLog = {
    notFound: [],
    loginRequired: [],
    networkErrors: [],
    emptyContent: [],
    otherErrors: []
  };

  // Load existing blogs if the file exists
  if (fs.existsSync(BLOGS_FILE)) {
    const existingData = fs.readFileSync(BLOGS_FILE, "utf-8");
    fetchedBlogs = JSON.parse(existingData);
  }

  // Initialize progress bar
  const bar = new ProgressBar("Scraping Blogs [:bar] :current/:total", {
    total: blogUrls.length,
    width: 40,
  });

  for (const url of blogUrls) {
    try {
      const response = await axios.get(url, {
        validateStatus: function (status) {
          return status < 500; // Resolve only if status is less than 500
        },
      });

      // Handle different HTTP status codes
      if (response.status === 404) {
        errorLog.notFound.push(url);
        console.warn(`\n404 Not Found: ${url}`);
        continue;
      }

      if (response.status === 403 || response.status === 401) {
        errorLog.loginRequired.push(url);
        console.warn(`\nLogin Required: ${url}`);
        continue;
      }

      if (response.status !== 200) {
        errorLog.otherErrors.push({ url, status: response.status });
        console.warn(`\nUnexpected status ${response.status}: ${url}`);
        continue;
      }

      const $ = cheerio.load(response.data);

      // Check for common login-wall indicators
      const loginIndicators = [
        'form[action*="login"]',
        'form[action*="signin"]',
        'div[class*="login"]',
        'div[class*="signin"]',
        'input[name="password"]'
      ];

      const hasLoginWall = loginIndicators.some(selector => $(selector).length > 0);
      if (hasLoginWall) {
        errorLog.loginRequired.push(url);
        console.warn(`\nLogin wall detected: ${url}`);
        continue;
      }

      // Adjust selectors based on the blog's HTML structure
      const content = $("div.post-body, div.entry-content").text().trim();

      if (!content || content.length < 50) { // Minimum content length threshold
        errorLog.emptyContent.push(url);
        console.warn(`\nNo content or too short content found for blog: ${url}`);
        continue;
      }

      fetchedBlogs.push({ text: content });

    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          errorLog.networkErrors.push({ url, error: error.code });
          console.warn(`\nNetwork Error (${error.code}): ${url}`);
        } else {
          errorLog.otherErrors.push({ url, error: error.message });
          console.warn(`\nAxios Error: ${url} - ${error.message}`);
        }
      } else {
        errorLog.otherErrors.push({ url, error: error.message });
        console.warn(`\nUnexpected Error: ${url} - ${error.message}`);
      }
    } finally {
      bar.tick();
    }
  }

  // Save the fetched blogs to the JSON file
  fs.writeFileSync(BLOGS_FILE, JSON.stringify(fetchedBlogs, null, 2));
  
  // Save error log to a separate file
  fs.writeFileSync('blog_scraping_errors.json', JSON.stringify(errorLog, null, 2));

  // Print summary
  console.log("\n=== Scraping Summary ===");
  console.log(`Successfully scraped: ${fetchedBlogs.length} blogs`);
  console.log(`404 Not Found: ${errorLog.notFound.length}`);
  console.log(`Login Required: ${errorLog.loginRequired.length}`);
  console.log(`Network Errors: ${errorLog.networkErrors.length}`);
  console.log(`Empty Content: ${errorLog.emptyContent.length}`);
  console.log(`Other Errors: ${errorLog.otherErrors.length}`);
  console.log("Error details saved to blog_scraping_errors.json");
}

// Main function
async function main() {
  try {
    console.log("=== Blog Scraping Process Started ===");

    // Validate environment variables
    validateEnv();

    // Execute Blog scraping
    await scrapeBlogs();

    console.log("\n=== Blog Scraping Completed Successfully ===");
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main();
