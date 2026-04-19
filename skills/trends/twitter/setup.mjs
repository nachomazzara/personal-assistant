#!/usr/bin/env node
/**
 * Twitter 2FA Setup
 *
 * Run this ONCE to manually authenticate with 2FA.
 * The session will be cached and reused by search.mjs
 *
 * Usage: node skills/trends/twitter/setup.mjs
 */

import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
puppeteerExtra.use(StealthPlugin());

const PROFILE_DIR = "/tmp/x-twitter-profile";
const USER = process.env.TWITTER_USER;
const PASS = process.env.TWITTER_PASS;

if (!USER || !PASS) {
  console.error("❌ Error: TWITTER_USER and TWITTER_PASS not set in .env");
  process.exit(1);
}

console.log("🔐 Twitter Authentication Setup");
console.log("================================");
console.log(`User: ${USER}`);
console.log("");
console.log("📝 Instructions:");
console.log("1. A browser window will open");
console.log("2. Log in with your credentials (complete 2FA if prompted)");
console.log("3. Wait for the page to fully load");
console.log("4. Press ENTER in this terminal when done");
console.log("");

const browser = await puppeteerExtra.launch({
  headless: false,
  args: [
    "--no-sandbox",
    "--disable-blink-features=AutomationControlled",
    `--user-data-dir=${PROFILE_DIR}`,
  ],
});

const page = (await browser.pages())[0] || await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });

console.log("🌐 Opening X/Twitter...");
await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60000 });

console.log("✅ Browser opened. Complete 2FA login manually.");
console.log("⏳ Waiting for your input...\n");

// Wait for user to press ENTER
await new Promise(resolve => {
  process.stdin.once('data', resolve);
});

// Check if logged in
const isLoggedIn = await page.evaluate(() => {
  const url = window.location.href;
  return !url.includes("/login") && !url.includes("/i/flow");
});

if (isLoggedIn) {
  console.log("\n✅ Authentication successful!");
  console.log("📦 Session cached to: " + PROFILE_DIR);
  console.log("\nYou can now use: node skills/trends/twitter/search.mjs");
} else {
  console.log("\n⚠️ Still on login page. Please log in and try again.");
}

await browser.close();
