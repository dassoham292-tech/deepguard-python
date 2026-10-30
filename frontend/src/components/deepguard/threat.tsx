import { AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { LEVEL_LABEL, threatLevel, type FaceBox, type Indicator, type ThreatLevel } from "@/lib/forensics-types";
import { cn } from "@/lib/utils";

const LEVEL_TEXT: Record<ThreatLevel, string> = {
  authentic: "text-safe",
  suspicious: "text-warn",
  manipulated: "text-danger",
};

const LEVEL_BG: Record<ThreatLevel, string> = {
  authentic: "bg-safe",
  suspicious: "bg-warn",
  manipulated: "bg-danger",
};

const LEVEL_BORDER: Record<ThreatLevel, string> = {
  authentic: "border-safe",
  suspicious: "border-warn",
  manipulated: "border-danger",
};

export const levelText = (l: ThreatLevel) => LEVEL_TEXT[l];
export const levelBg = (l: ThreatLevel) => LEVEL_BG[l];
export const levelBorder = (l: ThreatLevel) => LEVEL_BORDER[l];

export function LevelIcon({ level, className }: { level: ThreatLevel; className?: string }) {
  const Icon =
    level === "authentic" ? ShieldCheck : level === "suspicious" ? AlertTriangle : ShieldAlert;
  return <Icon className={cn(LEVEL_TEXT[level], className)} />;
}

export function LevelBadge({ level }: { level: ThreatLevel }) {
  return <Badge variant={level}>{LEVEL_LABEL[level]}</Badge>;
}

/** Horizontal threat meter with gradient track and a needle. */
export function ThreatMeter({
  score,
  active = true,
  label = "Threat level",
  size = "lg",
}: {
  score: number | null;
  active?: boolean;
  label?: string;
  size?: "lg" | "sm";
}) {
  const s = score ?? 0;
  const level = threatLevel(s);
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="label-caps text-muted-foreground">{label}</div>
          <div
            className={cn(
              "font-display font-semibold leading-none tabular-nums",
              size === "lg" ? "text-5xl" : "text-3xl",
              score === null ? "text-muted-foreground" : LEVEL_TEXT[level],
            )}
          >
            {score === null ? "--" : Math.round(s)}
            <span className="ml-1 text-base text-muted-foreground">/100</span>
          </div>
        </div>
        {score !== null && <LevelBadge level={level} />}
      </div>
      <div className="relative h-3 rounded-full bg-muted">
        <div
          className={cn(
            "absolute inset-0 rounded-full bg-meter transition-opacity",
            active && score !== null ? "opacity-100" : "opacity-30",
          )}
        />
        {/* masks the unfilled part */}
        <div
          className="absolute inset-y-0 right-0 rounded-r-full bg-muted/85 transition-all duration-700 ease-out"
          style={{ width: `${100 - s}%` }}
        />
        <div
          className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded-full bg-foreground shadow transition-all duration-700 ease-out"
          style={{ left: `${s}%` }}
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>AUTHENTIC</span>
        <span>35</span>
        <span>65</span>
        <span>MANIPULATED</span>
      </div>
    </div>
  );
}

/** Bounding boxes over an image/video; boxes are [ymin,xmin,ymax,xmax] in 0-1000. */
export function FaceOverlay({ faces, showLabels = true }: { faces: FaceBox[]; showLabels?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[4]">
      {faces.map((f, i) => {
        const [ymin, xmin, ymax, xmax] = f.box;
        const level = threatLevel(f.score);
        return (
          <div
            key={i}
            className={cn("absolute rounded-sm border-2 transition-all duration-500", LEVEL_BORDER[level])}
            style={{
              top: `${ymin / 10}%`,
              left: `${xmin / 10}%`,
              height: `${(ymax - ymin) / 10}%`,
              width: `${(xmax - xmin) / 10}%`,
            }}
          >
            {showLabels && (
              <span
                className={cn(
                  "absolute -top-6 left-[-2px] whitespace-nowrap rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase",
                  LEVEL_BG[level],
                  level === "suspicious" ? "text-warn-foreground" : level === "authentic" ? "text-safe-foreground" : "text-danger-foreground",
                )}
              >
                {LEVEL_LABEL[level]} · {Math.round(f.score)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function IndicatorList({ indicators }: { indicators: Indicator[] }) {
  if (!indicators.length) return null;
  const sevClass = { low: "bg-safe", medium: "bg-warn", high: "bg-danger" } as const;
  return (
    <ul className="space-y-2">
      {indicators.map((ind, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", sevClass[ind.severity])} />
          <span className="text-foreground/90">{ind.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Tiny SVG line chart of scores (0-100). */
export function Sparkline({ values, height = 56 }: { values: number[]; height?: number }) {
  const w = 300;
  const h = height;
  if (values.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed font-mono text-xs text-muted-foreground"
        style={{ height }}
      >
        awaiting signal
      </div>
    );
  }
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? w : (i / (values.length - 1)) * w;
    const y = h - (v / 100) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <line x1="0" x2={w} y1={h - 0.35 * (h - 4) - 2} y2={h - 0.35 * (h - 4) - 2} className="stroke-warn/40" strokeDasharray="4 4" />
      <line x1="0" x2={w} y1={h - 0.65 * (h - 4) - 2} y2={h - 0.65 * (h - 4) - 2} className="stroke-danger/40" strokeDasharray="4 4" />
      <polyline points={pts.join(" ")} fill="none" className="stroke-primary" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-md border bg-background/60 px-3 py-2.5">
      <div className="label-caps text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
