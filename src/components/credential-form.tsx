"use client";

/**
 * CredentialForm — dynamically rendered from the LLM's screen classification.
 *
 * The Login Machine tells us *what* fields the page needs (email, password,
 * OTP, etc.) via structured output. This component renders the matching
 * input fields. Credential values are collected here and sent to the backend
 * which writes them directly to the DOM — the LLM never sees them.
 */

import { useState } from "react";
import { Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { InputElementType } from "@/lib/ai-login/types";
import { cn } from "@/lib/utils";

interface CredentialFormProps {
  inputs: InputElementType[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => void;
  disabled?: boolean;
}

/** Map Login Machine input types to HTML input types. */
function htmlInputType(t: string): string {
  switch (t) {
    case "password":
      return "password";
    case "email":
      return "email";
    case "tel":
      return "tel";
    default:
      return "text";
  }
}

/** Map input types to autoComplete values. */
function autoCompleteFor(t: string): string {
  switch (t) {
    case "password":
      return "current-password";
    case "email":
      return "email";
    case "otp":
      return "one-time-code";
    default:
      return "off";
  }
}

export function CredentialForm({
  inputs,
  submitLabel,
  onSubmit,
  disabled,
}: CredentialFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-white/[0.12] bg-white/[0.04] overflow-hidden"
    >
      {/* Privacy notice */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-1.5 text-[11px] text-white/50">
          <Lock className="size-2.5" />
          Values go directly to the browser — never to the AI
        </div>
      </div>

      {/* Fields */}
      <div className="px-4 pb-3 space-y-2.5">
        {inputs.map((input, idx) => (
          <div key={input.name}>
            <Label
              htmlFor={input.name}
              className="block text-[11px] font-medium text-white/70 mb-1"
            >
              {input.label || input.name}
            </Label>
            <Input
              id={input.name}
              type={htmlInputType(input.type)}
              placeholder={input.label || input.name}
              value={values[input.name] || ""}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [input.name]: e.target.value }))
              }
              disabled={disabled}
              autoFocus={idx === 0}
              autoComplete={autoCompleteFor(input.type)}
              className={cn(
                "bg-white/[0.06] border-white/[0.12] text-[13px] text-white placeholder:text-white/40 focus-visible:border-white/25 focus-visible:bg-white/[0.08] focus-visible:ring-0",
                input.errorMessage && "border-red-500/40",
              )}
            />
            {input.errorMessage && (
              <p className="text-[11px] text-red-400 mt-1">
                {input.errorMessage}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Submit button */}
      <div className="px-4 pb-4">
        <Button
          type="submit"
          disabled={disabled}
          className="w-full bg-white text-[#09090b] text-[13px] font-semibold hover:bg-white/90 active:bg-white/80"
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
