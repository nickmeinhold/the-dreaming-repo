/**
 * Base Page Object
 *
 * All page objects extend this. Provides navigation, wait-for-load,
 * and common data extraction helpers.
 */

import type { Page } from "playwright";

export abstract class BasePage {
  constructor(
    protected page: Page,
    protected baseUrl: string,
  ) {}

  /** The URL path this page lives at (e.g. "/papers"). */
  abstract path(): string;

  /** Navigate to this page and wait for it to be ready. */
  async navigate(): Promise<void> {
    const response = await this.page.goto(`${this.baseUrl}${this.path()}`);
    this._lastStatus = response?.status() ?? 0;
    await this.waitForLoad();
  }

  /** HTTP status from the last navigation. */
  protected _lastStatus: number = 0;

  /** Throw if the last navigation returned a 404. */
  protected check404(entity: string): void {
    if (this._lastStatus === 404) {
      throw new Error(`${entity} not found`);
    }
  }

  /** Wait for the page-specific load indicator. Override for custom waits. */
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState("domcontentloaded");
  }

  /** Get text content from an element, trimmed. Returns empty string if not found. */
  protected async text(selector: string): Promise<string> {
    const el = await this.page.$(selector);
    if (!el) return "";
    return ((await el.textContent()) ?? "").trim();
  }

  /** Get text content from multiple elements. */
  protected async texts(selector: string): Promise<string[]> {
    const elements = await this.page.$$(selector);
    const results: string[] = [];
    for (const el of elements) {
      results.push(((await el.textContent()) ?? "").trim());
    }
    return results;
  }

  /** Get an attribute value from an element. */
  protected async attr(selector: string, attribute: string): Promise<string | null> {
    const el = await this.page.$(selector);
    if (!el) return null;
    return el.getAttribute(attribute);
  }

  /** Check if an element exists on the page. */
  protected async exists(selector: string): Promise<boolean> {
    const el = await this.page.$(selector);
    return el !== null;
  }

  /** Count elements matching a selector. */
  protected async count(selector: string): Promise<number> {
    const elements = await this.page.$$(selector);
    return elements.length;
  }
}
