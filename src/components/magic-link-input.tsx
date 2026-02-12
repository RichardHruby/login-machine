"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface MagicLinkInputProps {
  onSubmit: (url: string) => void;
  disabled: boolean;
}

export function MagicLinkInput({ onSubmit, disabled }: MagicLinkInputProps) {
  const [url, setUrl] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) onSubmit(url.trim());
      }}
      className="space-y-2.5"
    >
      <Input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://..."
        disabled={disabled}
        autoFocus
        className="bg-white/[0.06] border-white/[0.12] text-[13px] text-white placeholder:text-white/40 focus-visible:border-white/25 focus-visible:bg-white/[0.08] focus-visible:ring-0"
      />
      <Button
        type="submit"
        disabled={disabled || !url.trim()}
        className="w-full bg-white text-[#09090b] text-[13px] font-semibold hover:bg-white/90 active:bg-white/80"
      >
        Continue
      </Button>
    </form>
  );
}
