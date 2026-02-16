"use client";

/**
 * Chat — the main UI shell.
 *
 * Layout:
 *   Left column  → browser iframe (55%) + log panel (45%)
 *   Right column → messenger-style chat with dynamic input components
 *
 * All state management and API communication lives in useLoginSession.
 * This component is purely presentational.
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { Loader2, Globe, Monitor } from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLoginSession } from "@/hooks/use-login-session";
import { ChatInput } from "./chat-input";
import { LogPanel } from "./log-panel";
import { MessageBubble } from "./message-bubble";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONVERSATION_STARTERS = [
  "gusto.com/login",
  "app.rippling.com/login",
  "navan.com/signin",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Chat() {
  const {
    messages,
    sessionId,
    liveViewUrl,
    busy,
    logs,
    formStatuses,
    activeFormId,
    startSession,
    submitForm,
    reset,
  } = useLoginSession();

  // GitHub star count
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    fetch("https://api.github.com/repos/RichardHruby/login-machine")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setStars(data?.stargazers_count ?? 0))
      .catch(() => setStars(0));
  }, []);

  // Auto-scroll
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(
    (text: string) => {
      if (!sessionId) startSession(text);
    },
    [sessionId, startSession],
  );

  return (
    <div className="h-screen flex flex-col bg-[#09090b] text-white overflow-clip">
      {/* Header */}
      <header className="flex-none h-16 border-b border-white/[0.1] px-5 flex items-center justify-between bg-[#09090b]">
        <div className="flex items-center gap-3">
          <a href="https://anon.com" target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/anon-logo.svg" alt="Anon" className="h-5" />
          </a>
          <span className="text-white/50 text-[14px]">/</span>
          <span className="text-white/70 text-[14px] font-medium">
            login-machine
          </span>
          <div className="flex items-center gap-1.5 ml-1">
            <a
              href="https://github.com/RichardHruby/login-machine"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center rounded-md border border-white/[0.12] bg-white/[0.04] text-[11px] text-white/60 hover:text-white/80 hover:border-white/25 transition overflow-hidden"
            >
              <span className="flex items-center gap-1 px-2 py-0.5 border-r border-white/[0.12]">
                <svg
                  className="size-3.5"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                <span>Star</span>
              </span>
              <span className="px-2 py-0.5 tabular-nums">{stars ?? 0}</span>
            </a>
            <a
              href="https://x.com/HrubyOnRails/status/2022039848048361807"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-md border border-white/[0.12] bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/60 hover:text-white/80 hover:border-white/25 transition"
            >
              <svg className="size-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Article
            </a>
            <a
              href="https://hrubyonrails.substack.com/p/i-replaced-100-login-scripts-with"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-md border border-white/[0.12] bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/60 hover:text-white/80 hover:border-white/25 transition"
            >
              Substack
            </a>
          </div>
        </div>
        {sessionId && (
          <Button
            variant="outline"
            size="xs"
            onClick={reset}
            className="text-[11px] text-white/70 hover:text-white/90 border-white/[0.12] hover:border-white/25 bg-transparent hover:bg-white/[0.06]"
          >
            Reset
          </Button>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Left column — Browser + Logs */}
        <div className="w-[55%] flex flex-col border-r border-white/[0.1]">
          <BrowserPreview liveViewUrl={liveViewUrl} busy={busy} />
          <LogPanel logs={logs} />
        </div>

        {/* Right column — Chat */}
        <div className="w-[45%] flex flex-col min-h-0 bg-[#09090b]">
          {/* Messages */}
          <ScrollArea className="flex-1">
            <div className="px-5 py-5 space-y-3">
              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  onFormSubmit={submitForm}
                  busy={busy}
                  activeFormId={activeFormId}
                  formStatuses={formStatuses}
                  showLabel={i === 0 || messages[i - 1].role !== msg.role}
                />
              ))}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>

          {/* Conversation starters + Chat input */}
          <div className="flex-none border-t border-white/[0.1]">
            {!sessionId && !busy && (
              <div className="flex flex-wrap gap-2 px-4 pt-3">
                {CONVERSATION_STARTERS.map((url) => (
                  <Button
                    key={url}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      posthog.capture("conversation_starter_clicked", {
                        url,
                      });
                      startSession(url);
                    }}
                    className="text-[12px] text-white/70 border-white/[0.12] rounded-full hover:text-white/90 hover:border-white/25 bg-transparent hover:bg-white/[0.06] gap-1.5"
                  >
                    <Globe className="size-3 text-white/50" />
                    {url}
                  </Button>
                ))}
              </div>
            )}
            <ChatInput
              onSend={handleSend}
              disabled={busy || !!sessionId}
              placeholder={
                sessionId
                  ? "Use the form above to continue..."
                  : "Paste a login URL (e.g. gusto.com/login)"
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BrowserPreview — shows the live BrowserBase iframe or a placeholder
// ---------------------------------------------------------------------------

function BrowserPreview({
  liveViewUrl,
  busy,
}: {
  liveViewUrl: string | null;
  busy: boolean;
}) {
  if (liveViewUrl) {
    return (
      <div className="h-[55%] min-h-0 bg-black/40 relative">
        <iframe
          src={liveViewUrl}
          title="Browser"
          className="absolute inset-0 w-full h-full border-0 pointer-events-none"
        />
      </div>
    );
  }

  return (
    <div className="h-[55%] min-h-0 bg-black/40 flex flex-col items-center justify-center gap-3">
      {busy ? (
        <>
          <Loader2 className="size-5 text-white/50 animate-spin" />
          <span className="text-white/50 text-xs">
            Connecting to browser...
          </span>
        </>
      ) : (
        <>
          <Monitor className="size-5 text-white/50" />
          <span className="text-white/50 text-xs">
            Browser will appear here
          </span>
        </>
      )}
    </div>
  );
}
