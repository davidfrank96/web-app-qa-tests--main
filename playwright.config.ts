import * as dotenv from "dotenv";
import path from "path";
import { defineConfig, devices } from "@playwright/test";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
  quiet: true
});

console.log("Loaded INSSA_URL:", process.env.INSSA_URL);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  reporter: [["html"], ["list"]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
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
