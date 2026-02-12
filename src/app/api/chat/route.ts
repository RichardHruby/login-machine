/**
 * /api/chat — The single API endpoint that drives the chat-based login flow.
 *
 * Actions:
 *   start  → Creates a BrowserBase session, returns liveViewUrl immediately.
 *   submit → Acts on the current screen. User actions (form fill, choice click)
 *            return an SSE stream with two events: action_complete + screen.
 *            Auto-retries (loading, blocked) return plain JSON.
 *   close  → Tears down the browser session.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSession,
  getSession,
  closeSession,
  getPageContext,
  waitForPageContent,
} from "@/lib/ai-login/browser";
import { analyzeLoginPage, handleScreen } from "@/lib/ai-login/agent";
import { LoginStateSchema } from "@/lib/ai-login/types";

// ---------------------------------------------------------------------------
// Request validation schemas
// ---------------------------------------------------------------------------

const StartBody = z.object({
  action: z.literal("start"),
  url: z.string().url().or(z.string().min(1)),
});

const SubmitBody = z.object({
  action: z.literal("submit"),
  sessionId: z.string().min(1),
  screen: LoginStateSchema,
  values: z.record(z.string(), z.string()).default({}),
});

const CloseBody = z.object({
  action: z.literal("close"),
  sessionId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function ok(body: Record<string, unknown>) {
  return NextResponse.json(body);
}

function err(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

/** Create an SSE response that streams events to the frontend. */
function sseResponse(
  handler: (send: (event: string, data: unknown) => void) => Promise<void>,
  extraHeaders?: Record<string, string>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        await handler(send);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Internal server error";
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...extraHeaders,
    },
  });
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("Invalid JSON", 400);
  }

  const { action } = body as { action?: string };
  // Build CORS headers for raw Response objects (SSE).
  const origin = request.headers.get("origin") ?? "";
  const corsHeaders: Record<string, string> = origin
    ? { "Access-Control-Allow-Origin": origin }
    : {};

  try {
    // ----------------------------------------------------------------
    // ACTION: start — launch browser and return live view immediately
    // ----------------------------------------------------------------
    if (action === "start") {
      const parsed = StartBody.safeParse(body);
      if (!parsed.success) return err(parsed.error.issues[0].message, 400);

      const session = await createSession();

      // Kick off navigation in the background
      session.page
        .goto(parsed.data.url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        })
        .catch(() => {});

      return ok({
        sessionId: session.sessionId,
        liveViewUrl: session.liveViewUrl,
        screen: { type: "loading_screen" },
        screenshot: null,
      });
    }

    // ----------------------------------------------------------------
    // ACTION: submit — act on the current screen
    // ----------------------------------------------------------------
    if (action === "submit") {
      const parsed = SubmitBody.safeParse(body);
      if (!parsed.success) return err(parsed.error.issues[0].message, 400);

      const { sessionId, screen, values } = parsed.data;
      const session = await getSession(sessionId);

      // Determine if this is a user-initiated action (has actual values)
      const hasUserInput = Object.values(values).some((v) => v);
      const isUserAction =
        hasUserInput &&
        ["credential_login_form", "choice_screen", "magic_login_link"].includes(
          screen.type,
        );

      if (isUserAction) {
        // SSE: stream action_complete, then analyze and stream screen
        return sseResponse(async (send) => {
          const { message } = await handleScreen(session, screen, values);

          // 1. Signal that the action is done (form fill complete)
          send("action_complete", {
            action: message.type === "action" ? message.action : "Done",
          });

          // 2. Wait for page content to settle, then analyze
          await waitForPageContent(session.page);
          const { screen: analyzed, screenshot } =
            await analyzeLoginPage(session);

          send("screen", { screen: analyzed, screenshot });
        }, corsHeaders);
      }

      // JSON: auto-retry (loading_screen, blocked_screen) or input_request
      const { nextScreen, message } = await handleScreen(
        session,
        screen,
        values,
      );
      const { screenshot } = await getPageContext(session.page);
      return ok({ screen: nextScreen, screenshot, message });
    }

    // ----------------------------------------------------------------
    // ACTION: close — tear down browser session
    // ----------------------------------------------------------------
    if (action === "close") {
      const parsed = CloseBody.safeParse(body);
      if (!parsed.success) return err(parsed.error.issues[0].message, 400);

      await closeSession(parsed.data.sessionId);
      return ok({ success: true });
    }

    return err("Unknown action", 400);
  } catch (error) {
    console.error("[/api/chat]", error);
    return err(
      error instanceof Error ? error.message : "Internal server error",
    );
  }
}
