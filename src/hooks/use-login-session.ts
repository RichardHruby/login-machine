"use client";

/**
 * useLoginSession — encapsulates all state management and API communication
 * for the login machine flow.
 *
 * Two fetch paths:
 *   1. submitForm()  — SSE stream for user-initiated actions (form fill, choice click)
 *   2. autoRetry()   — JSON for auto-handled screens (loading, blocked)
 *
 * Form lifecycle:  pending → submitting → submitted
 * Page lifecycle:  loading → classified → (user action) → loading → ...
 */

import { useState, useRef, useCallback } from "react";
import posthog from "posthog-js";
import type { LoginState } from "@/lib/ai-login/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Message content without the `id` field — used by addMsg/replaceLastLoading. */
export type ChatMessageContent =
  | { role: "assistant"; text: string }
  | { role: "user"; text: string }
  | {
      role: "assistant";
      type: "input_request";
      screen: LoginState;
      formId: string;
    }
  | { role: "assistant"; type: "loading"; text: string }
  | { role: "assistant"; type: "success"; text: string }
  | { role: "assistant"; type: "error"; text: string };

export type ChatMessage = ChatMessageContent & { id: string };

export type LogEntry = {
  ts: number;
  level: "info" | "action" | "error" | "thought";
  text: string;
};

export type FormStatus = "pending" | "submitting" | "submitted";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let msgCounter = 0;
const nextId = () => `msg-${++msgCounter}`;

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "What website do you want to log into?",
};

const MAX_LOADING_RETRIES = 12;

/** Parse an SSE stream into discrete events. */
async function readSSE(
  response: Response,
  onEvent: (event: string, data: unknown) => void,
) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const lines = chunk.split("\n");
      let eventType = "";
      let eventData = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) eventType = line.slice(7);
        if (line.startsWith("data: ")) eventData = line.slice(6);
      }
      if (eventType && eventData) {
        onEvent(eventType, JSON.parse(eventData));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLoginSession() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const [currentScreen, setCurrentScreen] = useState<LoginState | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [formStatuses, setFormStatuses] = useState<Record<string, FormStatus>>(
    {},
  );

  const currentFormId = useRef<string | null>(null);
  const loadingRetries = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const targetDomainRef = useRef<string | null>(null);

  // --- State helpers (stable via useCallback with no deps) ---

  const addMsg = useCallback((msg: ChatMessageContent): string => {
    const id = nextId();
    setMessages((prev) => [...prev, { ...msg, id } as ChatMessage]);
    return id;
  }, []);

  const log = useCallback((level: LogEntry["level"], text: string) => {
    setLogs((prev) => [...prev, { ts: Date.now(), level, text }]);
  }, []);

  const replaceLastLoading = useCallback((msg: ChatMessageContent) => {
    setMessages((prev) => {
      const idx = prev.findLastIndex(
        (m) => "type" in m && m.type === "loading",
      );
      if (idx === -1)
        return [...prev, Object.assign({ id: nextId() }, msg) as ChatMessage];
      const next = [...prev];
      next[idx] = Object.assign({ id: prev[idx].id }, msg) as ChatMessage;
      return next;
    });
  }, []);

  // --- Process a classified screen and show the right UI ---

  // We use refs to break the circular dep between processScreen and autoRetry.
  // Both are defined as plain functions that close over the latest ref values.
  const processScreenRef =
    useRef<(screen: LoginState, sid: string) => void>(null);
  const autoRetryRef = useRef<(sid: string, screen: LoginState) => void>(null);

  const processScreen = useCallback(
    (screen: LoginState, sid: string) => {
      posthog.capture("screen_detected", {
        session_id: sid,
        screen_type: screen.type,
        target_domain: targetDomainRef.current,
      });

      switch (screen.type) {
        case "credential_login_form":
        case "choice_screen":
        case "magic_login_link": {
          loadingRetries.current = 0;
          setCurrentScreen(screen);

          const formId = nextId();
          currentFormId.current = formId;

          // Log error messages from inputs (shown inline on the form itself)
          if (screen.type === "credential_login_form" && screen.inputs) {
            const errors = screen.inputs
              .filter((i) => i.errorMessage)
              .map((i) => i.errorMessage!);
            if (errors.length > 0) {
              log("error", `Login error: ${errors.join("; ")}`);
            }
          }

          replaceLastLoading({
            role: "assistant",
            type: "input_request",
            screen,
            formId,
          });
          setBusy(false);

          const desc =
            screen.type === "credential_login_form"
              ? `Detected login form — requesting: ${screen.inputs?.map((i) => i.name).join(", ")}`
              : screen.type === "choice_screen"
                ? `Detected choice screen — ${screen.options?.length} options`
                : "Detected magic link screen";
          log("info", desc);
          break;
        }

        case "blocked_screen":
          log("action", "Dismissing blocking popup...");
          replaceLastLoading({
            role: "assistant",
            type: "loading",
            text: "Dismissing popup...",
          });
          autoRetryRef.current?.(sid, screen);
          break;

        case "loading_screen": {
          loadingRetries.current += 1;
          if (loadingRetries.current >= MAX_LOADING_RETRIES) {
            replaceLastLoading({
              role: "assistant",
              type: "error",
              text: "Page failed to load after multiple retries.",
            });
            log("error", "Max loading retries exceeded");

            posthog.capture("login_failed", {
              session_id: sid,
              target_domain: targetDomainRef.current,
              error_type: "loading_timeout",
            });

            setBusy(false);
            loadingRetries.current = 0;
          } else {
            log(
              "thought",
              `Page loading — analyzing (${loadingRetries.current}/${MAX_LOADING_RETRIES})...`,
            );
            replaceLastLoading({
              role: "assistant",
              type: "loading",
              text: "Analyzing page...",
            });
            autoRetryRef.current?.(sid, screen);
          }
          break;
        }

        case "logged_in_screen":
          loadingRetries.current = 0;
          replaceLastLoading({
            role: "assistant",
            type: "success",
            text: "Successfully logged in!",
          });
          log("action", "Login complete");

          posthog.capture("login_succeeded", {
            session_id: sid,
            target_domain: targetDomainRef.current,
          });

          setCurrentScreen(null);
          setBusy(false);
          break;
      }
    },
    [log, replaceLastLoading],
  );

  // Auto-retry: JSON fetch for loading/blocked screens
  const autoRetry = useCallback(
    async (sid: string, screen: LoginState) => {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submit",
            sessionId: sid,
            screen,
            values: {},
          }),
          signal: abortRef.current?.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Retry failed");

        if (data.message?.type === "action") {
          log("action", data.message.action);
        }
        if (data.screen) {
          log("thought", `Screen classified: ${data.screen.type}`);
          processScreenRef.current?.(data.screen, sid);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : "Unknown error";
        replaceLastLoading({ role: "assistant", type: "error", text: msg });
        log("error", msg);
        setBusy(false);
      }
    },
    [log, replaceLastLoading],
  );

  // Keep refs in sync
  processScreenRef.current = processScreen;
  autoRetryRef.current = autoRetry;

  // --- Public actions ---

  const startSession = useCallback(
    async (url: string) => {
      let normalised = url.trim();
      if (!/^https?:\/\//i.test(normalised))
        normalised = `https://${normalised}`;

      // Light validation: must look like a real URL with a domain
      try {
        const parsed = new URL(normalised);
        if (!/\..+/.test(parsed.hostname)) throw new Error();
      } catch {
        addMsg({ role: "user", text: url.trim() });
        addMsg({
          role: "assistant",
          type: "error",
          text: "That doesn't look like a login URL. Try something like gusto.com/login.",
        });
        posthog.capture("session_start_failed", {
          url: url.trim(),
          error_type: "invalid_url",
        });
        return;
      }

      targetDomainRef.current = new URL(normalised).hostname;
      abortRef.current = new AbortController();

      addMsg({ role: "user", text: normalised });
      addMsg({
        role: "assistant",
        type: "loading",
        text: "Launching browser...",
      });
      setBusy(true);
      log("info", `Starting session for ${normalised}`);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", url: normalised }),
          signal: abortRef.current.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to start session");

        setSessionId(data.sessionId);
        setLiveViewUrl(data.liveViewUrl);
        log("action", "Browser launched — live view ready");

        posthog.capture("session_started", {
          url: normalised,
          session_id: data.sessionId,
          target_domain: targetDomainRef.current,
        });

        processScreen(data.screen, data.sessionId);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : "Unknown error";
        replaceLastLoading({ role: "assistant", type: "error", text: msg });
        log("error", msg);

        posthog.capture("session_start_failed", {
          url: normalised,
          error_type: "api_error",
          error_message: msg,
        });

        setBusy(false);
      }
    },
    [addMsg, log, replaceLastLoading, processScreen],
  );

  const submitForm = useCallback(
    async (values: Record<string, string>) => {
      if (!sessionId || !currentScreen) return;

      const formId = currentFormId.current;
      if (formId) {
        setFormStatuses((prev) => ({ ...prev, [formId]: "submitting" }));
      }

      setBusy(true);
      log("action", `User submitted: ${currentScreen.type}`);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submit",
            sessionId,
            screen: currentScreen,
            values,
          }),
          signal: abortRef.current?.signal,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Submit failed");
        }

        // Read SSE stream
        await readSSE(res, (event, data) => {
          const payload = data as Record<string, unknown>;

          switch (event) {
            case "action_complete":
              // Form lifecycle: submitting → submitted
              if (formId) {
                setFormStatuses((prev) => ({ ...prev, [formId]: "submitted" }));
              }
              log("action", (payload.action as string) || "Action completed");
              addMsg({
                role: "assistant",
                type: "loading",
                text: "Analyzing page...",
              });
              break;

            case "screen": {
              const resultScreen = payload.screen as LoginState;
              log("thought", `Screen classified: ${resultScreen.type}`);

              posthog.capture("user_input_submitted", {
                session_id: sessionId,
                screen_type: currentScreen.type,
                target_domain: targetDomainRef.current,
                success: true,
              });

              processScreen(resultScreen, sessionId);
              break;
            }

            case "error":
              throw new Error((payload.message as string) || "Unknown error");
          }
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : "Unknown error";
        replaceLastLoading({ role: "assistant", type: "error", text: msg });
        log("error", msg);

        posthog.capture("user_input_submitted", {
          session_id: sessionId,
          screen_type: currentScreen.type,
          target_domain: targetDomainRef.current,
          success: false,
          error_message: msg,
        });

        setBusy(false);
      }
    },
    [sessionId, currentScreen, addMsg, log, replaceLastLoading, processScreen],
  );

  const reset = useCallback(async () => {
    abortRef.current?.abort();

    if (sessionId) {
      posthog.capture("session_reset", {
        session_id: sessionId,
        target_domain: targetDomainRef.current,
      });

      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", sessionId }),
      }).catch(() => {});
    }

    setSessionId(null);
    setLiveViewUrl(null);
    setCurrentScreen(null);
    setBusy(false);
    setLogs([]);
    setFormStatuses({});
    currentFormId.current = null;
    targetDomainRef.current = null;
    loadingRetries.current = 0;
    msgCounter = 0;
    setMessages([WELCOME]);
  }, [sessionId]);

  return {
    messages,
    sessionId,
    liveViewUrl,
    busy,
    logs,
    formStatuses,
    activeFormId: currentFormId.current,
    startSession,
    submitForm,
    reset,
  };
}
