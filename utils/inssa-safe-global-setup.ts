import { chromium } from "@playwright/test";
import { prepareInssaSafeSession } from "./inssa-safe-session";

export default async function setup() {
  const browser = await chromium.launch();
  try {
    await prepareInssaSafeSession(browser, process.env.INSSA_SAFE_AUTH_STATE_PATH!, process.env.INSSA_SAFE_AUTH_PREFLIGHT_PATH!);
    console.log("Safe session preparation: PASS (fresh session). Safe tests starting.");
  } finally { await browser.close(); }
}
