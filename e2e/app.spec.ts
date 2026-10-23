import { expect, test, type Page } from "@playwright/test";
import { buildEpub } from "./epub";

// One shared library for the whole file: the first test adds a fic and the rest use it.
test.describe.configure({ mode: "serial" });

let bookUrl = "";

async function bookId(page: Page): Promise<string> {
  return bookUrl.split("/book/")[1].split("/")[0];
}

test("settings: lists every narrator provider and remembers the speed", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("per million characters")).toHaveCount(3);
  // No Kokoro or ElevenLabs key is set in the test server, so those groups say so.
  await expect(page.getByText("Add DEEPINFRA_API_KEY in Vercel")).toBeVisible();
  await expect(page.getByText("Add ELEVENLABS_API_KEY in Vercel")).toBeVisible();

  await page.getByRole("radio", { name: "1.3×" }).click();
  await expect(page.getByRole("radio", { name: "1.3×" })).toBeChecked();
  await page.reload();
  await expect(page.getByRole("radio", { name: "1.3×" })).toBeChecked();
  await page.getByRole("radio", { name: "1×" }).click();
});

test("add a fic: upload an EPUB and land on its narrating page", async ({ page }) => {
  await page.goto("/add");
  await expect(page.getByRole("heading", { name: "Add a fic" })).toBeVisible();
  // The narrator list is filled from the server; an unavailable provider is disabled and says so.
  const narrator = page.locator("#voice");
  await expect(narrator.locator("option").first()).toBeAttached();
  await expect(narrator.locator("option", { hasText: "(needs a key)" }).first()).toBeDisabled();

  await page.getByLabel("Choose an EPUB file").setInputFiles({
    name: "e2e-fic.epub",
    mimeType: "application/epub+zip",
    buffer: await buildEpub("E2E Fic"),
  });
  await page.waitForURL(/\/book\/[a-f0-9]{16}\/narrating/);
  bookUrl = page.url();
  await expect(page.getByRole("heading", { name: "E2E Fic" })).toBeVisible();
});

test("shelf: the new fic is listed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("E2E Fic")).toBeVisible();
});

test("narrating: change the narrator and see the chapter range", async ({ page }) => {
  await page.goto(`/book/${await bookId(page)}/narrating`);
  const narrator = page.locator('select[aria-label="Narrator"]');
  await expect(narrator).toBeVisible();
  await narrator.selectOption("nova");
  await expect(narrator).toHaveValue("nova");
  // It sticks on the server.
  await page.reload();
  await expect(page.locator('select[aria-label="Narrator"]')).toHaveValue("nova");
  // The per-batch voice list leaves out the fic's own voice.
  const batch = page.locator("#batch-voice");
  await expect(batch.locator('option[value="nova"]')).toHaveCount(0);
  await expect(batch.locator('option[value="ballad"]')).toHaveCount(1);
  await page.locator('select[aria-label="Narrator"]').selectOption("ballad");
});

test("queue: opens with nothing running", async ({ page }) => {
  await page.goto("/queue");
  await expect(page.getByRole("heading", { name: "Queue" })).toBeVisible();
  await expect(page.locator(".error")).toHaveCount(0);
});

test("pronunciation lists: add a list and keep it after a reload", async ({ page }) => {
  await page.goto("/pronunciations");
  await expect(page.getByLabel("Voice for the Hear buttons")).toBeVisible();
  await page.getByRole("button", { name: /new list/i }).click();
  await page.getByLabel("List name").first().fill("E2E names");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Saved/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("List name").first()).toHaveValue("E2E names");
});

test("book pronunciation: the page loads", async ({ page }) => {
  await page.goto(`/book/${await bookId(page)}/pronunciation`);
  await expect(page.locator(".error")).toHaveCount(0);
  await expect(page.getByRole("heading").first()).toBeVisible();
});

test("player: play an unnarrated chapter through the queue, then hear it", async ({ page }) => {
  await page.goto(`/book/${await bookId(page)}`);
  await page.getByRole("button", { name: /^Play Chapter 1/ }).click();
  // Narrating costs money, so it asks first.
  await expect(page.getByRole("dialog", { name: "Read this chapter aloud?" })).toBeVisible();
  await page.getByRole("button", { name: "Read it aloud" }).click();
  // The fake narrator answers at once; the player then loads the audio.
  await expect(page.getByRole("button", { name: "Pause" }).first()).toBeVisible({ timeout: 60_000 });
  const audio = page.locator("audio");
  await expect(audio).toHaveAttribute("src", /\/api\/audio\/[a-f0-9]{16}\/0$/);
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime), { timeout: 20_000 }).toBeGreaterThan(0);

  // Pause and resume from the main button.
  await page.getByRole("button", { name: "Pause" }).first().click();
  await expect(page.getByRole("button", { name: "Play", exact: true }).first()).toBeVisible();
  // The finished chapter is now listed as narrated, and can be downloaded.
  await expect(page.getByRole("link", { name: /Download Chapter 1/ })).toBeVisible();
});

test("player: the sleep timer cycles and the speed changes", async ({ page }) => {
  await page.goto(`/book/${await bookId(page)}`);
  const sleep = page.getByRole("button", { name: "Sleep timer, tap to change" });
  await sleep.click();
  await expect(sleep).toContainText("15");
  await sleep.click();
  await expect(sleep).toContainText("30");
  await page.getByRole("button", { name: /^Speed/ }).click();
  await expect(page.getByRole("button", { name: /^Speed 1\.15×/ })).toBeVisible();
});

test("player: the mini player and tabs show on other screens", async ({ page }) => {
  await page.goto(`/book/${await bookId(page)}`);
  await page.getByRole("link", { name: "Back to shelf" }).first().click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});
