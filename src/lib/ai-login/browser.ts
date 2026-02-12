/**
 * Browser automation layer — BrowserBase only.
 *
 * Creates cloud browser sessions via the BrowserBase API, connects over CDP
 * with Playwright, and exposes helpers for page context extraction and form
 * interaction. Credentials never pass through this module's logs; values are
 * written directly to the DOM.
 */

import {
  chromium,
  type Browser,
  type Page,
  type BrowserContext,
} from "playwright";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserSession {
  id: string;
  browserbaseSessionId: string;
  page: Page;
  browser: Browser;
  context: BrowserContext;
  liveViewUrl: string;
  createdAt: number;
  close: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Session store (survives Next.js hot-reloads in dev)
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

const g = globalThis as unknown as { __sessions?: Map<string, BrowserSession> };
const sessions = (g.__sessions ??= new Map<string, BrowserSession>());

/** Remove sessions that have exceeded the TTL. */
function reapStaleSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      console.warn(`[browser] Reaping stale session ${id}`);
      session.close().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/** Spin up a new BrowserBase cloud browser and connect via CDP. */
export async function createSession(): Promise<BrowserSession> {
  reapStaleSessions();

  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    throw new Error(
      "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set",
    );
  }

  // 1. Create a session through the BrowserBase REST API
  const res = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bb-api-key": apiKey },
    body: JSON.stringify({
      projectId,
      browserSettings: { viewport: { width: 1280, height: 800 } },
    }),
  });

  if (!res.ok) {
    throw new Error(`BrowserBase session creation failed: ${res.statusText}`);
  }

  const data = await res.json();
  const bbSessionId: string = data.id;

  // 2. Connect Playwright over Chrome DevTools Protocol
  const wsEndpoint: string =
    data.connectUrl ||
    `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${bbSessionId}`;
  const browser = await chromium.connectOverCDP(wsEndpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());

  // Set default timeout once — not per-call
  page.setDefaultTimeout(15000);

  // 3. Fetch the embeddable live-view URL
  const debugRes = await fetch(
    `https://api.browserbase.com/v1/sessions/${bbSessionId}/debug`,
    { headers: { "x-bb-api-key": apiKey } },
  );
  let liveViewUrl = `https://www.browserbase.com/sessions/${bbSessionId}`;
  if (debugRes.ok) {
    const debugData = await debugRes.json();
    liveViewUrl = debugData.debuggerFullscreenUrl || liveViewUrl;
  }

  const id = crypto.randomUUID();

  const session: BrowserSession = {
    id,
    browserbaseSessionId: bbSessionId,
    page,
    browser,
    context,
    liveViewUrl,
    createdAt: Date.now(),
    close: async () => {
      await browser.close().catch(() => {});
      sessions.delete(id);
    },
  };

  sessions.set(id, session);
  return session;
}

export function getSession(id: string): BrowserSession | undefined {
  return sessions.get(id);
}

export async function closeSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (s) await s.close();
}

// ---------------------------------------------------------------------------
// Page context extraction
// ---------------------------------------------------------------------------

/**
 * Build the minimal context the LLM needs: stripped HTML + a JPEG screenshot.
 *
 * The HTML extractor walks the DOM recursively and keeps only attributes
 * useful for locator generation. Shadow DOM boundaries are traversed so
 * enterprise SSO widgets aren't missed.
 */
export async function getPageContext(
  page: Page,
  attempt = 0,
): Promise<{ html: string; screenshot: string; url: string }> {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
  } catch {
    // Page might still be usable even if the full load times out
  }

  try {
    const extractBodyHTML = () => {
      function extractHTML(node: Node): string {
        if (node.nodeType === 3) return node.textContent?.trim() || "";
        if (node.nodeType !== 1) return "";

        const el = node as Element;
        const styles = window.getComputedStyle(el);
        if (styles.display === "none" || styles.visibility === "hidden")
          return "";

        const exclude = ["SCRIPT", "STYLE", "svg", "IMG", "NOSCRIPT", "LINK"];
        if (exclude.includes(el.tagName)) return "";

        const root = el.shadowRoot || el;
        let html = `<${el.tagName.toLowerCase()}`;

        for (const attr of el.attributes) {
          if (
            [
              "id",
              "class",
              "type",
              "name",
              "placeholder",
              "role",
              "aria-label",
            ].includes(attr.name)
          ) {
            html += ` ${attr.name}="${attr.value}"`;
          }
        }
        html += ">";

        for (const child of root.childNodes) {
          if (child instanceof HTMLSlotElement) {
            const assigned = child.assignedNodes()[0];
            html += assigned ? extractHTML(assigned) : child.innerHTML;
          } else {
            html += extractHTML(child);
          }
        }

        html += `</${el.tagName.toLowerCase()}>`;
        return html;
      }
      return extractHTML(document.body);
    };

    let bodyHtml = await page.evaluate(extractBodyHTML);

    // Extract iframe content separately
    for (const frame of page.frames()) {
      if (frame !== page.mainFrame()) {
        try {
          const iframeHtml = await frame.evaluate(extractBodyHTML);
          bodyHtml += `<iframe-content>${iframeHtml}</iframe-content>`;
        } catch {
          // Cross-origin frames can't be read
        }
      }
    }

    const buf = await page.screenshot({
      type: "jpeg",
      quality: 80,
      fullPage: false,
      timeout: 30000,
      animations: "disabled",
    });

    return {
      html: bodyHtml.substring(0, 100_000),
      screenshot: buf.toString("base64"),
      url: page.url(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("Execution context was destroyed") && attempt < 2) {
      console.warn(
        `[browser] Navigation detected, retrying (attempt ${attempt + 1})...`,
      );
      await page.waitForTimeout(2000);
      return getPageContext(page, attempt + 1);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Wait for meaningful page content (used after form submissions)
// ---------------------------------------------------------------------------

/**
 * Wait for the SPA to render meaningful content. Many login pages use
 * client-side rendering where the initial HTML is just an empty shell.
 */
export async function waitForPageContent(page: Page): Promise<void> {
  await page.waitForLoadState("load").catch(() => {});

  try {
    await page.waitForFunction(
      () => {
        const body = document.body;
        if (!body) return false;
        return (
          body.querySelectorAll("input, button, a[href]").length >= 2 ||
          (body.innerText || "").trim().length > 100
        );
      },
      { timeout: 15000 },
    );
  } catch {
    // Timeout is fine — re-analyze with whatever we have
  }

  await page.waitForTimeout(2000);
}

// ---------------------------------------------------------------------------
// Form interaction helpers
// ---------------------------------------------------------------------------

/**
 * Fill every field and click submit. Credential values are written directly
 * to the DOM — they never appear in logs or LLM context.
 */
export async function fillAndSubmit(
  page: Page,
  inputs: Array<{ locator: string; value: string }>,
  submitLocator: string,
): Promise<void> {
  for (const { locator, value } of inputs) {
    const filled = await fillInPageOrFrame(page, locator, value);
    if (!filled) {
      console.warn(`[browser] Could not find element for locator: ${locator}`);
    }
  }

  await clickInPageOrFrame(page, submitLocator);

  // Wait for navigation / redirects
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(3000);

  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
  } catch {
    // Page may already be stable
  }
}

/** Click an element, searching across frames if needed. */
export async function clickElement(page: Page, locator: string): Promise<void> {
  await clickInPageOrFrame(page, locator);
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(1500);
}

// ---------------------------------------------------------------------------
// Frame-aware helpers
// ---------------------------------------------------------------------------

async function fillInPageOrFrame(
  page: Page,
  locator: string,
  value: string,
): Promise<boolean> {
  try {
    const el = page.locator(locator).first();
    if ((await el.count()) > 0) {
      await el.waitFor({ state: "attached", timeout: 5000 });
      await el.focus();
      await el.clear();
      await el.fill(value);
      return true;
    }
  } catch (e) {
    console.warn(`[browser] Main frame fill failed for ${locator}:`, e);
  }

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const el = frame.locator(locator).first();
      if ((await el.count()) > 0) {
        await el.focus();
        await el.clear();
        await el.fill(value);
        return true;
      }
    } catch {
      // Try next frame
    }
  }
  return false;
}

async function clickInPageOrFrame(
  page: Page,
  locator: string,
): Promise<boolean> {
  try {
    const el = page.locator(locator).first();
    if ((await el.count()) > 0) {
      await el.click();
      return true;
    }
  } catch (e) {
    console.warn(`[browser] Main frame click failed for ${locator}:`, e);
  }

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const el = frame.locator(locator).first();
      if ((await el.count()) > 0) {
        await el.click();
        return true;
      }
    } catch {
      // Try next frame
    }
  }
  return false;
}
