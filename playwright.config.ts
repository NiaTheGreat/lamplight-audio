import { defineConfig, devices } from "@playwright/test";

const APP_PORT = 3100;
const FAKE_PORT = 4010;
const PASSWORD = "e2e-password";

// Browser tests: a built copy of the app on its own port, narrating through a fake OpenAI server,
// with its own empty cache folder. No real keys or paid services are used.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "./.e2e-results",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    storageState: "./.e2e-results/auth.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      command: "node e2e/fake-openai.mjs",
      url: `http://127.0.0.1:${FAKE_PORT}/health`,
      ignoreHTTPSErrors: true,
      // The fake answers 404 on /health, which is still "up".
      reuseExistingServer: !process.env.CI,
      env: { FAKE_OPENAI_PORT: String(FAKE_PORT) },
      stdout: "ignore",
    },
    {
      command: `rm -rf .e2e-cache && npx next build && npx next start -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/login`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        APP_PASSWORD: PASSWORD,
        OPENAI_API_KEY: "e2e-key",
        OPENAI_BASE_URL: `http://127.0.0.1:${FAKE_PORT}/v1`,
        CACHE_DIR: ".e2e-cache",
        DEEPINFRA_API_KEY: "",
        ELEVENLABS_API_KEY: "",
        R2_ACCOUNT_ID: "",
        R2_BUCKET: "",
      },
    },
  ],
});
