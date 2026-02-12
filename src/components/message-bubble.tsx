"use client";

/**
 * MessageBubble — renders a single chat message.
 *
 * Message types:
 *   - User text (right-aligned)
 *   - Assistant text, loading, success, error (left-aligned bubbles)
 *   - Input request (credential form, choice buttons, magic link input)
 *     with three states: pending → submitting → submitted
 */

import { Loader2, Check, LockOpen } from "lucide-react";
import type { ChatMessage, FormStatus } from "@/hooks/use-login-session";
import type { LoginState } from "@/lib/ai-login/types";
import { CredentialForm } from "./credential-form";
import { ChoiceButtons } from "./choice-buttons";
import { MagicLinkInput } from "./magic-link-input";

interface MessageBubbleProps {
  msg: ChatMessage;
  onFormSubmit: (values: Record<string, string>) => void;
  busy: boolean;
  activeFormId: string | null;
  formStatuses: Record<string, FormStatus>;
  showLabel?: boolean;
}

export function MessageBubble({
  msg,
  onFormSubmit,
  busy,
  activeFormId,
  formStatuses,
  showLabel,
}: MessageBubbleProps) {
  // User message
  if (msg.role === "user") {
    return (
      <div>
        {showLabel && (
          <p className="text-[10px] text-white/40 mb-1 text-right">You</p>
        )}
        <div className="flex justify-end">
          <div className="bg-white/[0.06] border border-white/[0.12] rounded-2xl rounded-br-sm px-3.5 py-2 max-w-[80%] text-[13px] text-white/90">
            {msg.text}
          </div>
        </div>
      </div>
    );
  }

  const assistantLabel = showLabel ? (
    <p className="text-[10px] text-white/40 mb-1">Login Machine</p>
  ) : null;

  // Assistant text message (no type field)
  if (!("type" in msg)) {
    return (
      <div>
        {assistantLabel}
        <div className="flex justify-start">
          <div className="bg-white/[0.06] border border-white/[0.12] rounded-2xl rounded-bl-sm px-3.5 py-2 max-w-[80%] text-[13px] text-white/90">
            {msg.text}
          </div>
        </div>
      </div>
    );
  }

  // Loading
  if (msg.type === "loading") {
    return (
      <div>
        {assistantLabel}
        <div className="flex justify-start">
          <div className="bg-white/[0.06] border border-white/[0.12] rounded-2xl rounded-bl-sm px-3.5 py-2 max-w-[80%] text-[13px] text-white/70 flex items-center gap-2">
            <Loader2 className="size-3 animate-spin" />
            {msg.text}
          </div>
        </div>
      </div>
    );
  }

  // Success
  if (msg.type === "success") {
    return (
      <div>
        {assistantLabel}
        <div className="flex justify-start">
          <div className="bg-white/[0.06] border border-white/[0.12] rounded-2xl rounded-bl-sm px-3.5 py-2 max-w-[80%] text-[13px] text-white/90 flex items-center gap-2">
            <LockOpen className="size-3.5 text-emerald-400" />
            {msg.text}
          </div>
        </div>
      </div>
    );
  }

  // Error
  if (msg.type === "error") {
    return (
      <div>
        {assistantLabel}
        <div className="flex justify-start">
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl rounded-bl-sm px-3.5 py-2 max-w-[80%] text-[13px] text-red-400">
            {msg.text}
          </div>
        </div>
      </div>
    );
  }

  // Input request — dynamic form / choice / magic link
  if (msg.type === "input_request") {
    const { screen, formId } = msg;
    const explicitStatus = formStatuses[formId];
    const isStale = formId !== activeFormId;
    const status: FormStatus =
      explicitStatus || (isStale ? "submitted" : "pending");

    // Collapsed state (submitting or submitted)
    if (status === "submitting" || status === "submitted") {
      return (
        <div>
          {assistantLabel}
          <CollapsedForm screen={screen} status={status} />
        </div>
      );
    }

    // Pending — render the appropriate interactive component
    return (
      <div>
        {assistantLabel}
        <div className="flex justify-start w-full">
          <div className="w-full max-w-[95%]">
            {screen.type === "credential_login_form" && screen.inputs && (
              <CredentialForm
                inputs={screen.inputs}
                submitLabel={screen.submit?.label || "Continue"}
                onSubmit={onFormSubmit}
                disabled={busy}
              />
            )}

            {screen.type === "choice_screen" && screen.options && (
              <div className="rounded-xl border border-white/[0.12] bg-white/[0.04] overflow-hidden">
                <div className="px-4 pt-3 pb-2">
                  <p className="text-[11px] text-white/70">
                    {screen.label || screen.name || "Select an option"}
                  </p>
                </div>
                <div className="px-4 pb-4">
                  <ChoiceButtons
                    options={screen.options}
                    onSelect={(choice) => onFormSubmit({ choice })}
                    disabled={busy}
                  />
                </div>
              </div>
            )}

            {screen.type === "magic_login_link" && (
              <div className="rounded-xl border border-white/[0.12] bg-white/[0.04] overflow-hidden">
                <div className="px-4 pt-3 pb-2">
                  <p className="text-[11px] text-white/70">
                    {screen.instructionText ||
                      "Check your email for a magic login link and paste it below."}
                  </p>
                </div>
                <div className="px-4 pb-4">
                  <MagicLinkInput
                    onSubmit={(url) => onFormSubmit({ url })}
                    disabled={busy}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// CollapsedForm — shown when a form is submitting or submitted
// ---------------------------------------------------------------------------

function CollapsedForm({
  screen,
  status,
}: {
  screen: LoginState;
  status: "submitting" | "submitted";
}) {
  const label =
    screen.type === "credential_login_form" && screen.inputs
      ? screen.inputs.map((i) => i.label || i.name).join(", ")
      : screen.type === "choice_screen"
        ? "Selection"
        : "Link";

  return (
    <div className="flex justify-start w-full">
      <div className="w-full max-w-[95%]">
        <div className="rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 py-3 flex items-center gap-3">
          {status === "submitting" ? (
            <Loader2 className="size-4 text-white/50 animate-spin flex-none" />
          ) : (
            <div className="size-5 rounded-full bg-emerald-500/15 flex items-center justify-center flex-none">
              <Check className="size-3 text-emerald-400" />
            </div>
          )}
          <span className="text-[12px] text-white/70">
            {status === "submitting"
              ? `Submitting ${label.toLowerCase()}...`
              : `${label} submitted`}
          </span>
        </div>
      </div>
    </div>
  );
}
