import type { ReactNode } from "react";

import { limitRamp, percentLeft, type LimitRamp } from "@/lib/agentLimits";
import { cn } from "@/lib/utils";
import type { AgentLimitWindow } from "@/protocol";

const RING_TONE: Record<LimitRamp, string> = {
  neutral: "text-ok",
  warning: "text-amber-500",
  danger: "text-red-500",
};

const SIZE = 26;
const STROKE = 2;
const GAP = 1.5;

function Arc({
  window,
  radius,
  width,
}: {
  window: AgentLimitWindow;
  radius: number;
  width: number;
}) {
  const circumference = 2 * Math.PI * radius;
  const left = window.usedPercent >= 100 ? 0 : percentLeft(window.usedPercent);
  return (
    <>
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={radius}
        fill="none"
        strokeWidth={width}
        className="stroke-muted"
      />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={`${(left / 100) * circumference} ${circumference}`}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        className={RING_TONE[limitRamp(window.usedPercent)]}
        data-window={window.id}
      />
    </>
  );
}

/**
 * Quota left as concentric rings around the agent's logo: the session window
 * outside, the weekly one inside. Each ring fills by what is left.
 * @param windows the windows to draw, outermost first (at most two)
 * @param children the mark in the middle
 * @param className extra classes for the frame
 * @returns the ring
 */
export function UsageRing({
  windows,
  children,
  className,
}: {
  windows: AgentLimitWindow[];
  children: ReactNode;
  className?: string;
}) {
  const [outer, inner] = windows;
  return (
    <span className={cn("relative grid size-[26px] place-items-center", className)}>
      <svg aria-hidden width={SIZE} height={SIZE} className="absolute inset-0">
        {outer && <Arc window={outer} radius={SIZE / 2 - STROKE / 2} width={STROKE} />}
        {inner && <Arc window={inner} radius={SIZE / 2 - STROKE * 1.5 - GAP} width={STROKE} />}
      </svg>
      {children}
    </span>
  );
}
