import * as dotenv from "dotenv";
import path from "path";
import { defineConfig, devices } from "@playwright/test";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
  quiet: true
});

console.log("Loaded INSSA_URL:", process.env.INSSA_URL);

const productionAuth = process.env.AUTH_MONITOR_ENVIRONMENT === "production";
const mutationRecording = process.env.INSSA_MUTATION_RECORDING === "1";

export default defineConfig({
  testDir: "./tests",
  globalSetup: process.env.INSSA_SAFE_AUTH_STATE_PATH ? "./utils/inssa-safe-global-setup.ts" : undefined,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR,
  reporter: productionAuth ? [["./scripts/inssa/production-auth-reporter.ts"]] : [
    ["html", process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ? { outputFolder: process.env.PLAYWRIGHT_HTML_OUTPUT_DIR } : {}], ["list"],
    ...(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ? [["json", { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE }] as [string, { outputFile: string }]] : [])
  ],
  use: {
    // Service workers can bypass context routing; production writes must always meet the guard.
    serviceWorkers: productionAuth ? "block" : "allow",
    trace: productionAuth ? "off" : "retain-on-failure",
    screenshot: productionAuth ? "off" : mutationRecording ? "on" : "only-on-failure",
    video: productionAuth ? "off" : mutationRecording ? "on" : "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000
  },
  projects: [
    {
      name: "localman-chrome",
      testMatch: /localman\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.LOCALMAN_URL || "http://localhost:3000"
      }
    },
    {
      name: "kbean-chrome",
      testMatch: /kbean\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.KBEAN_URL || "https://your-kbean-staging-url.com"
      }
    },
    {
      name: "inssa-chrome",
      testMatch: /inssa\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.INSSA_URL
      }
    },
    {
      name: "mobile-chrome",
      testMatch: /shared\/.*\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        baseURL: process.env.LOCALMAN_URL || "http://localhost:3000"
      }
    }
  ]
});
