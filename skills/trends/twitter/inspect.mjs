import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
puppeteerExtra.use(StealthPlugin());

const browser = await puppeteerExtra.launch({
  headless: false,
  args: [
    "--no-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1500,900",
    "--user-data-dir=/tmp/x-twitter-profile",
  ],
});

const page = (await browser.pages())[0] || await browser.newPage();
await page.goto("https://x.com/i/flow/login", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise(r => setTimeout(r, 3000));

console.error("=== INPUTS ===");
const inputs = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input'));
  return inputs.map((el, i) => ({
    index: i,
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
    autocomplete: el.autocomplete,
  }));
});
console.error(JSON.stringify(inputs, null, 2));

console.error("\n=== BUTTONS (first 5) ===");
const buttons = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  return buttons.slice(0, 5).map((el, i) => ({
    index: i,
    text: el.textContent?.trim(),
    type: el.type,
  }));
});
console.error(JSON.stringify(buttons, null, 2));

console.error("\n Browser window open - close it to continue");
await new Promise(() => {});
