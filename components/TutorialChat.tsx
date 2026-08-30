// /workspaces/Vext/components/TutorialChat.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { TutorialStep } from "@/lib/tutorialSteps";

interface TutorialChatProps {
  steps: TutorialStep[];
  open: boolean;
  onFinish: () => void; // called on Skip AND on completing the last step
  resetKey?: number; // bump this to restart from step 0 (used by "replay")
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const BUBBLE_MAX_WIDTH = 280;
const GAP = 14; // spacing between the spotlight ring and the chat bubble

export default function TutorialChat({
  steps,
  open,
  onFinish,
  resetKey,
}: TutorialChatProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);

  // Restart whenever the tutorial is (re)opened, or a replay is requested.
  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open, resetKey]);

  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  // Recompute the spotlighted element's position for the current step.
  useEffect(() => {
    if (!open || !step?.targetSelector) {
      setRect(null);
      return;
    }

    const measure = () => {
      const el = document.querySelector(step.targetSelector!);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    measure();
    // Elements here are mostly fixed-position, but re-measure on resize
    // (device rotation, browser toolbar show/hide changing the viewport)
    // so the ring/bubble don't drift out of place.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, step]);

  const bubbleStyle = useMemo((): React.CSSProperties => {
    if (!rect) {
      // No target for this step — center it.
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const placement = step.placement || "bottom";
    const viewportW = typeof window !== "undefined" ? window.innerWidth : 375;
    const viewportH = typeof window !== "undefined" ? window.innerHeight : 812;

    let top = rect.top + rect.height / 2;
    let left = rect.left + rect.width / 2;
    let transform = "translate(-50%, -50%)";

    if (placement === "top") {
      top = rect.top - GAP;
      transform = "translate(-50%, -100%)";
    } else if (placement === "bottom") {
      top = rect.top + rect.height + GAP;
      transform = "translate(-50%, 0)";
    } else if (placement === "left") {
      left = rect.left - GAP;
      transform = "translate(-100%, -50%)";
    } else if (placement === "right") {
      left = rect.left + rect.width + GAP;
      transform = "translate(0, -50%)";
    }

    // Clamp so the bubble never renders off-screen on small devices.
    const halfWidth = BUBBLE_MAX_WIDTH / 2;
    left = Math.min(Math.max(left, halfWidth + 8), viewportW - halfWidth - 8);
    top = Math.min(Math.max(top, 60), viewportH - 100);

    return { top, left, transform };
  }, [rect, step]);

  if (!open || !step) return null;

  const handleNext = () => {
    if (isLastStep) {
      onFinish();
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  const handleBack = () => setStepIndex((i) => Math.max(0, i - 1));

  return (
    <div className="fixed inset-0 z-[999] pointer-events-auto">
      {/* Dim backdrop */}
      <div className="absolute inset-0 bg-black/60 transition-opacity" />

      {/* Spotlight ring around the real element being explained */}
      {rect && (
        <div
          className="absolute rounded-lg ring-4 ring-[#0F7A5F] shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] transition-all duration-300 pointer-events-none"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}

      {/* Chat bubble */}
      <div
        className="absolute w-[280px] max-w-[85vw] bg-white text-gray-900 rounded-2xl shadow-xl p-4"
        style={bubbleStyle}
      >
        <div className="flex items-start gap-2">
          <div className="h-8 w-8 shrink-0 rounded-full bg-[#0F7A5F] text-white flex items-center justify-center text-sm font-bold">
            V
          </div>
          <p className="text-sm leading-snug">{step.message}</p>
        </div>

        <div className="flex items-center justify-between mt-3">
          <div className="flex gap-1">
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 w-1.5 rounded-full ${
                  i === stepIndex ? "bg-[#0F7A5F]" : "bg-gray-300"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onFinish}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Skip
            </button>
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="text-xs font-medium text-gray-600 hover:text-gray-900"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              className="text-xs font-medium bg-[#0F7A5F] text-white px-3 py-1.5 rounded-full hover:opacity-90"
            >
              {isLastStep ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}