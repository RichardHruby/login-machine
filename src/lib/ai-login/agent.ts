/**
 * Agent — the brain of the Login Machine.
 *
 * Two main functions:
 *   analyzeLoginPage()  — Screenshot + HTML → LLM → structured screen type
 *   handleScreen()      — Act on the classified screen (fill, click, wait, etc.)
 *
 * Key design decisions:
 *   1. Observe, don't assume — every action is followed by a fresh analysis.
 *   2. Validate before acting — LLM locators are checked against the live DOM.
 *   3. Fail forward with context — errors are fed back for self-correction.
 *
 * User action screens (credential_login_form, choice_screen, magic_login_link)
 * return { nextScreen: null } — the API route handles page re-analysis
 * separately via SSE so the frontend can update form status in real time.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { LOGIN_SCREEN_SYSTEM_PROMPT } from "./prompts";
import { LoginStateSchema, type LoginState, type AgentMessage } from "./types";
import {
  type BrowserSession,
  getPageContext,
  fillAndSubmit,
  clickElement,
  waitForPageContent,
} from "./browser";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ANALYSIS_RETRIES = 3;

// ---------------------------------------------------------------------------
// Locator validation helpers
// ---------------------------------------------------------------------------

/** Pull every Playwright locator string out of a classified screen. */
function getScreenLocators(screen: LoginState): string[] {
  const locators: string[] = [];
  if (screen.inputs) {
    for (const input of screen.inputs) locators.push(input.playwrightLocator);
  }
  if (screen.submit) locators.push(screen.submit.playwrightLocator);
  if (screen.options) {
    for (const opt of screen.options)
      locators.push(opt.optionPlaywrightLocator);
  }
  if (screen.dismissPlaywrightLocator)
    locators.push(screen.dismissPlaywrightLocator);
  return locators;
}

/** Check whether a Playwright locator resolves to at least one element. */
async function validateLocator(
  session: BrowserSession,
  locator: string,
): Promise<boolean> {
  const page = session.page;

  try {
    if ((await page.locator(locator).first().count()) > 0) return true;
  } catch {
    // Fall through to iframes
  }

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      if ((await frame.locator(locator).first().count()) > 0) return true;
    } catch {
      // Next frame
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// analyzeLoginPage — the core observation step
// ---------------------------------------------------------------------------

/**
 * Screenshot the page, send it (with stripped HTML) to the LLM, and receive a
 * structured screen classification.
 *
 * Includes validation + self-correction loop:
 *   1. Zod schema parsing — output must match the expected shape.
 *   2. Element existence — every Playwright locator is checked against the DOM.
 *   3. Retry with context — if validation fails, errors are fed back to the LLM.
 */
export async function analyzeLoginPage(
  session: BrowserSession,
): Promise<{ screen: LoginState; screenshot: string }> {
  const { html, screenshot, url } = await getPageContext(session.page);

  const errorHistory: Array<{ error: string }> = [];

  for (let attempt = 0; attempt < MAX_ANALYSIS_RETRIES; attempt++) {
    const errorContext =
      errorHistory.length > 0
        ? `\n\n<error-history>\n${errorHistory.map((e, i) => `Attempt ${i + 1}: ${e.error}`).join("\n")}\n</error-history>`
        : "";

    const { output: object } = await generateText({
      model: anthropic("claude-sonnet-4-5-20250929"),
      output: Output.object({ schema: LoginStateSchema }),
      system: LOGIN_SCREEN_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Current URL: ${url}\n\nHTML:\n${html}${errorContext}`,
            },
            { type: "image", image: `data:image/jpeg;base64,${screenshot}` },
          ],
        },
      ],
    });

    if (!object) throw new Error("LLM returned no structured output");

    console.log(
      `[agent] analyzeLoginPage attempt ${attempt + 1}: ${object.type}`,
    );

    // Screens without locators don't need validation
    if (["loading_screen", "logged_in_screen"].includes(object.type)) {
      return { screen: object, screenshot };
    }

    // Validate every locator against the live DOM
    const locators = getScreenLocators(object);
    if (locators.length === 0) {
      return { screen: object, screenshot };
    }

    const results = await Promise.all(
      locators.map(async (loc) => ({
        locator: loc,
        exists: await validateLocator(session, loc),
      })),
    );

    const missing = results.filter((r) => !r.exists);
    if (missing.length === 0) {
      return { screen: object, screenshot };
    }

    const errorMsg = `Locators not found on page: ${missing.map((m) => m.locator).join(", ")}. Please generate alternative locators.`;
    console.warn(`[agent] Validation failed: ${errorMsg}`);
    errorHistory.push({ error: errorMsg });
  }

  // Exhausted retries — return best effort
  console.warn("[agent] Exhausted retries, returning unvalidated result");
  const { output: object } = await generateText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    output: Output.object({ schema: LoginStateSchema }),
    system: LOGIN_SCREEN_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `Current URL: ${url}\n\nHTML:\n${html}` },
          { type: "image", image: `data:image/jpeg;base64,${screenshot}` },
        ],
      },
    ],
  });
  if (!object) throw new Error("LLM returned no structured output");
  return { screen: object, screenshot };
}

// ---------------------------------------------------------------------------
// handleScreen — act on the classified screen
// ---------------------------------------------------------------------------

/**
 * Route to the right handler based on screen type.
 *
 * User action screens (credential_login_form, choice_screen, magic_login_link)
 * return nextScreen: null — page re-analysis is handled by the route via SSE.
 *
 * Auto-handled screens (loading_screen, blocked_screen) re-analyze internally
 * and return the next screen directly.
 */
export async function handleScreen(
  session: BrowserSession,
  screen: LoginState,
  userInput?: Record<string, string>,
): Promise<{ nextScreen: LoginState | null; message: AgentMessage }> {
  switch (screen.type) {
    // ------------------------------------------------------------------
    // credential_login_form — fill fields + click submit
    // ------------------------------------------------------------------
    case "credential_login_form": {
      const hasValues = userInput && Object.values(userInput).some((v) => v);
      if (!hasValues || !screen.inputs || !screen.submit) {
        return {
          nextScreen: null,
          message: { type: "input_request", screen },
        };
      }

      const inputs = screen.inputs
        .filter((input) => userInput[input.name])
        .map((input) => ({
          locator: input.playwrightLocator,
          value: userInput[input.name],
        }));

      await fillAndSubmit(
        session.page,
        inputs,
        screen.submit.playwrightLocator,
      );

      // Return null — route handler will analyze via SSE
      return {
        nextScreen: null,
        message: { type: "action", action: "Filled form and submitted" },
      };
    }

    // ------------------------------------------------------------------
    // choice_screen — click the selected option
    // ------------------------------------------------------------------
    case "choice_screen": {
      if (!userInput?.choice || !screen.options) {
        return {
          nextScreen: null,
          message: { type: "input_request", screen },
        };
      }

      const option = screen.options.find(
        (o) => o.optionText === userInput.choice,
      );
      if (!option) {
        return {
          nextScreen: screen,
          message: {
            type: "error",
            message: `Option not found: ${userInput.choice}`,
          },
        };
      }

      await clickElement(session.page, option.optionPlaywrightLocator);

      // If there's a separate submit button, click it after selecting
      if (screen.submit) {
        await clickElement(session.page, screen.submit.playwrightLocator);
      }

      // Return null — route handler will analyze via SSE
      return {
        nextScreen: null,
        message: { type: "action", action: `Selected: ${userInput.choice}` },
      };
    }

    // ------------------------------------------------------------------
    // magic_login_link — navigate to the link the user provides
    // ------------------------------------------------------------------
    case "magic_login_link": {
      if (!userInput?.url) {
        return {
          nextScreen: null,
          message: { type: "input_request", screen },
        };
      }

      await session.page.goto(userInput.url, { waitUntil: "domcontentloaded" });
      await session.page.waitForLoadState("load").catch(() => {});

      // Return null — route handler will analyze via SSE
      return {
        nextScreen: null,
        message: { type: "action", action: "Navigated to magic link" },
      };
    }

    // ------------------------------------------------------------------
    // blocked_screen — auto-dismiss and re-analyze
    // ------------------------------------------------------------------
    case "blocked_screen": {
      if (!screen.dismissPlaywrightLocator) {
        return {
          nextScreen: null,
          message: { type: "error", message: "No dismiss locator found" },
        };
      }
      await clickElement(session.page, screen.dismissPlaywrightLocator);
      const { screen: nextScreen } = await analyzeLoginPage(session);
      return {
        nextScreen,
        message: { type: "action", action: "Dismissed blocking popup" },
      };
    }

    // ------------------------------------------------------------------
    // loading_screen — wait and re-analyze
    // ------------------------------------------------------------------
    case "loading_screen": {
      await waitForPageContent(session.page);
      const { screen: nextScreen } = await analyzeLoginPage(session);
      return {
        nextScreen,
        message: { type: "thought", content: "Page was loading, waiting..." },
      };
    }

    // ------------------------------------------------------------------
    // logged_in_screen — terminal state
    // ------------------------------------------------------------------
    case "logged_in_screen": {
      return {
        nextScreen: null,
        message: {
          type: "complete",
          success: true,
          message: "Successfully logged in!",
        },
      };
    }

    default:
      return {
        nextScreen: null,
        message: { type: "error", message: "Unknown screen type" },
      };
  }
}
