/**
 * Browser Lifecycle Manager
 *
 * Launches a headless Chromium instance for a single command invocation,
 * runs the provided function with a Page, and tears everything down.
 * One browser per CLI call — clean and leak-free.
 *
 * Injects X-Correlation-Id and X-Batch-Id headers on every request
 * the browser makes, so backend traces from a single GUI CLI command
 * share the same correlationId. This threads through withActionTrace()
 * on the server side.
 */

import { chromium, type Browser, type Page } from "playwright";

export interface BrowserOptions {
  headless?: boolean;
  correlationId?: string;
  batchId?: string;
}

/**
 * Launch a browser, create a page, run `fn`, and close the browser.
 * The browser context carries:
 * - Cookies set during authentication
 * - X-Correlation-Id header for backend trace linking
 * - X-Batch-Id header for story/batch grouping
 */
export async function withBrowser<T>(
  baseUrl: string,
  fn: (page: Page) => Promise<T>,
  options?: BrowserOptions,
): Promise<T> {
  const browser: Browser = await chromium.launch({
    headless: options?.headless ?? true,
  });

  // Build extra headers for trace correlation
  const extraHeaders: Record<string, string> = {};
  if (options?.correlationId) {
    extraHeaders["X-Correlation-Id"] = options.correlationId;
  }
  if (options?.batchId) {
    extraHeaders["X-Batch-Id"] = options.batchId;
  }

  const context = await browser.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: extraHeaders,
  });
  const page = await context.newPage();

  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}
