"use client";

/**
 * ChatInput — the text bar at the bottom of the chat column.
 *
 * Used initially for the user to type a login URL. Once a session is active
 * the bar is disabled (all interaction happens through dynamic input forms).
 */

import { useState, useRef } from "react";
import { ArrowRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="flex-none px-4 py-3">
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.12] px-3 py-1.5 focus-within:border-white/25 transition">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !disabled && submit()}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[13px] text-white placeholder:text-white/40 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="text-white/50 hover:text-white/70"
          aria-label="Send"
        >
          <ArrowRight className="size-4" />
        </Button>
      </div>
      <p className="text-[10px] text-white/50 mt-1.5 text-center flex items-center justify-center gap-1">
        <Lock className="size-2.5" />
        Credentials never touch the AI — they flow directly to the browser
      </p>
    </div>
  );
}
