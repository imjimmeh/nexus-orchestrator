import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser, Page } from 'playwright';
import type {
  BrowserAutomationDriver,
  BrowserAutomationPage,
  BrowserAutomationSession,
} from './web-automation.types';

@Injectable()
export class WebAutomationPlaywrightDriverService
  implements BrowserAutomationDriver, OnModuleDestroy
{
  private readonly logger = new Logger(
    WebAutomationPlaywrightDriverService.name,
  );

  private browserPromise: Promise<Browser> | null = null;

  async createSession(sessionId: string): Promise<BrowserAutomationSession> {
    const browser = await this.getBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();

    return {
      id: sessionId,
      page: this.createPageAdapter(page),
      close: async (): Promise<void> => {
        await context.close();
      },
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browserPromise === null) {
      return;
    }

    try {
      const browser = await this.browserPromise;
      await browser.close();
    } catch (error) {
      this.logger.warn(
        `Failed to close Playwright browser cleanly: ${(error as Error).message}`,
      );
    } finally {
      this.browserPromise = null;
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browserPromise === null) {
      this.browserPromise = this.launchBrowser();
    }

    return this.browserPromise;
  }

  private async launchBrowser(): Promise<Browser> {
    const playwright = await import('playwright');

    this.logger.log(
      'Launching Playwright Chromium browser for workflow automation',
    );
    return playwright.chromium.launch({
      headless: true,
    });
  }

  private createPageAdapter(page: Page): BrowserAutomationPage {
    return {
      goto: async (url, options) => {
        await page.goto(url, {
          timeout: options.timeout,
          waitUntil: options.waitUntil,
        });
      },
      click: async (selector, options) => {
        await page.click(selector, {
          timeout: options.timeout,
        });
      },
      fill: async (selector, text, options) => {
        await page.fill(selector, text, {
          timeout: options.timeout,
        });
      },
      waitForSelector: async (selector, options) => {
        await page.waitForSelector(selector, {
          timeout: options.timeout,
          state: options.state,
        });
      },
      waitForLoadState: async (state, options) => {
        await page.waitForLoadState(state, {
          timeout: options.timeout,
        });
      },
      waitForTimeout: async (durationMs) => {
        await page.waitForTimeout(durationMs);
      },
      content: async () => page.content(),
      title: async () => page.title(),
      url: () => page.url(),
      screenshot: async (options) =>
        page.screenshot({
          fullPage: options.fullPage,
          type: options.type,
        }),
    };
  }
}
