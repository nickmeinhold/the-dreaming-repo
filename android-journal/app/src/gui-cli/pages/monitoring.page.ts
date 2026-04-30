/**
 * Monitoring Page Object — /admin/monitoring
 *
 * Scrapes the admin monitoring summary dashboard for
 * audit log data (events, errors, active users, breakdown).
 */

import { BasePage } from "./base.page";

interface MonitoringSummary {
  totalEvents: number;
  errors: number;
  activeUsers: number;
  breakdown: { action: string; count: number }[];
}

interface RecentEvent {
  action: string;
  entity: string;
  timestamp: string;
  details: string;
}

export class MonitoringPage extends BasePage {
  path(): string {
    return "/admin/monitoring";
  }

  async getSummary(): Promise<MonitoringSummary> {
    await this.navigate();

    const totalText = await this.text("[data-testid='monitor-events']");
    const errorsText = await this.text("[data-testid='monitor-errors']");
    const usersText = await this.text("[data-testid='monitor-active-users']");

    const totalEvents = parseInt(totalText) || 0;
    const errors = parseInt(errorsText) || 0;
    const activeUsers = parseInt(usersText) || 0;

    // Breakdown
    const breakdownEls = await this.page.$$("[data-testid='monitor-breakdown'] [data-testid='breakdown-item']");
    const breakdown: { action: string; count: number }[] = [];
    for (const el of breakdownEls) {
      const action = ((await el.$eval("[data-testid='breakdown-action']", (e) => e.textContent)) ?? "").trim();
      const countText = ((await el.$eval("[data-testid='breakdown-count']", (e) => e.textContent)) ?? "0").trim();
      breakdown.push({ action, count: parseInt(countText) || 0 });
    }

    return { totalEvents, errors, activeUsers, breakdown };
  }

  async getRecent(): Promise<RecentEvent[]> {
    await this.navigate();

    const eventEls = await this.page.$$("[data-testid='monitor-recent'] [data-testid='recent-event']");
    const events: RecentEvent[] = [];

    for (const el of eventEls) {
      const action = ((await el.$eval("[data-testid='event-action']", (e) => e.textContent)) ?? "").trim();
      const entity = ((await el.$eval("[data-testid='event-entity']", (e) => e.textContent)) ?? "").trim();
      const timestamp = ((await el.$eval("[data-testid='event-timestamp']", (e) => e.textContent)) ?? "").trim();
      const details = ((await el.$eval("[data-testid='event-details']", (e) => e.textContent)) ?? "").trim();
      events.push({ action, entity, timestamp, details });
    }

    return events;
  }
}
