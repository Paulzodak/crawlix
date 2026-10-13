import puppeteer from "puppeteer";

/**
 * Shared Puppeteer launch options for local and container runs.
 * - `PUPPETEER_EXECUTABLE_PATH` overrides the browser binary when set.
 * - `--disable-dev-shm-usage` avoids Chromium crashes when /dev/shm is tiny.
 */
export function getPuppeteerLaunchOptions(): NonNullable<Parameters<typeof puppeteer.launch>[0]> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  return {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  };
}
