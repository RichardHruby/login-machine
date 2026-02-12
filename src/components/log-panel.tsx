"use client";

/**
 * LogPanel — terminal-style log viewer below the browser preview.
 *
 * Styled to resemble an embedded VS Code terminal with a title bar,
 * traffic-light dots, and monospace output.
 */

import { useRef, useEffect } from "react";
import { SquareTerminal } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/hooks/use-login-session";

const LEVEL_STYLE: Record<LogEntry["level"], string> = {
  info: "bg-white/5 text-white/50 hover:bg-white/5",
  thought: "bg-blue-500/10 text-blue-400/80 hover:bg-blue-500/10",
  action: "bg-emerald-500/10 text-emerald-400/80 hover:bg-emerald-500/10",
  error: "bg-red-500/10 text-red-400/80 hover:bg-red-500/10",
};

const LEVEL_LABELS: Record<LogEntry["level"], string> = {
  info: "info",
  thought: "think",
  action: "act",
  error: "err",
};

interface LogPanelProps {
  logs: LogEntry[];
}

export function LogPanel({ logs }: LogPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="h-[45%] border-t border-white/[0.1] bg-[#0e0e10] flex flex-col min-h-0 overflow-hidden">
      {/* Terminal title bar */}
      <div className="flex-none flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a1e] border-b border-white/[0.06]">
        <SquareTerminal className="size-3.5 text-white/40" />
        <span className="text-white/40 text-[11px] font-mono">logs</span>
      </div>

      {/* Terminal output */}
      <ScrollArea className="flex-1 min-h-0 px-3 py-2">
        <div className="font-mono text-[11px] leading-[1.7] space-y-0.5">
          {logs.length === 0 && (
            <div className="text-white/30 text-[11px]">
              <span className="text-emerald-500/60">$</span> waiting for
              session...
            </div>
          )}
          {logs.map((entry, i) => {
            const time = new Date(entry.ts).toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            return (
              <div
                key={`${entry.ts}-${i}`}
                className="flex items-start gap-2 hover:bg-white/[0.02] -mx-1.5 px-1.5 rounded"
              >
                <span className="text-white/30 flex-none tabular-nums select-none">
                  {time}
                </span>
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[9px] px-1.5 py-0 h-4 rounded font-mono flex-none",
                    LEVEL_STYLE[entry.level],
                  )}
                >
                  {LEVEL_LABELS[entry.level]}
                </Badge>
                <span className="text-white/60">{entry.text}</span>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
