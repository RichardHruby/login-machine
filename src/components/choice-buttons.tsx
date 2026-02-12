"use client";

/**
 * ChoiceButtons — rendered when the LLM classifies a page as `choice_screen`.
 *
 * Common examples: account pickers, workspace selectors, MFA method screens.
 * Each option maps 1-to-1 with a Playwright locator the backend will click.
 */

import { Button } from "@/components/ui/button";
import type { ChoiceOptionType } from "@/lib/ai-login/types";

interface ChoiceButtonsProps {
  options: ChoiceOptionType[];
  onSelect: (choice: string) => void;
  disabled?: boolean;
}

export function ChoiceButtons({
  options,
  onSelect,
  disabled,
}: ChoiceButtonsProps) {
  return (
    <div className="space-y-1.5">
      {options.map((opt) => (
        <Button
          key={opt.optionText}
          variant="outline"
          onClick={() => onSelect(opt.optionText)}
          disabled={disabled}
          className="w-full justify-start bg-white/[0.04] border-white/[0.1] text-[13px] text-white/80 hover:bg-white/[0.08] hover:border-white/[0.15] hover:text-white h-auto px-3.5 py-2.5"
        >
          {opt.optionText}
        </Button>
      ))}
    </div>
  );
}
