import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { AudioLines, Camera, Film, Trash2 } from "lucide-react";
import { useState } from "react";

import { IndicatorList, LevelBadge, levelText } from "@/components/deepguard/threat";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { clearHistory, removeHistory, useHistory, type ScanType } from "@/lib/history";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Scan History — DeepGuard" },
      { name: "description", content: "Review your recent live, video and audio deepfake scans." },
      { property: "og:title", content: "Scan History — DeepGuard" },
      { property: "og:description", content: "Your recent deepfake and voice-clone scan results." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HistoryPage,
});

const TYPE_ICON = { live: Camera, video: Film, audio: AudioLines } as const;
const TYPE_LABEL = { live: "Live", video: "Video", audio: "Audio" } as const;

function HistoryPage() {
  const history = useHistory();
  const [filter, setFilter] = useState<"all" | ScanType>("all");
  const [open, setOpen] = useState<string | null>(null);
  const items = filter === "all" ? history : history.filter((h) => h.type === filter);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label-caps text-primary">Activity</div>
          <h1 className="mt-1 text-3xl font-bold">Recent scans</h1>
          <p className="mt-1 text-sm text-muted-foreground">Saved on this device. Up to 60 recent scans are kept.</p>
        </div>
        <div className="flex items-center gap-3">
          <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => v && setFilter(v as typeof filter)}>
            <ToggleGroupItem value="all" className="px-3">All</ToggleGroupItem>
            <ToggleGroupItem value="live" className="px-3">Live</ToggleGroupItem>
            <ToggleGroupItem value="video" className="px-3">Video</ToggleGroupItem>
            <ToggleGroupItem value="audio" className="px-3">Audio</ToggleGroupItem>
          </ToggleGroup>
          {history.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (window.confirm("Clear all scan history?")) clearHistory();
              }}
            >
              <Trash2 /> Clear all
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card/60 p-12 text-center">
          <p className="text-muted-foreground">No scans yet.</p>
          <Link to="/" className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
            Run your first scan
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((h) => {
            const Icon = TYPE_ICON[h.type];
            const expanded = open === h.id;
            return (
              <li key={h.id} className="rounded-lg border bg-card shadow-panel">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : h.id)}
                  className="flex w-full items-center gap-4 p-4 text-left"
                >
                  <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md bg-panel">
                    {h.thumbnail ? (
                      <img src={h.thumbnail} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Icon className="size-6 text-panel-muted" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{h.title}</span>
                      <span className="label-caps text-muted-foreground">{TYPE_LABEL[h.type]}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{h.summary}</p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {formatDistanceToNow(h.createdAt, { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={cn("font-display text-2xl font-semibold", levelText(h.level))}>{Math.round(h.score)}</span>
                    <LevelBadge level={h.level} />
                  </div>
                </button>
                {expanded && (
                  <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
                    <div>
                      <p className="mb-3 text-sm">{h.summary}</p>
                      <IndicatorList indicators={h.indicators} />
                    </div>
                    <div>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">Confidence</dt>
                        <dd className="font-mono">{Math.round(h.confidence)}%</dd>
                        {Object.entries(h.meta).map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="text-muted-foreground">{k}</dt>
                            <dd className="font-mono break-words">{v}</dd>
                          </div>
                        ))}
                      </dl>
                      <Button variant="ghost" size="sm" className="mt-3" onClick={() => removeHistory(h.id)}>
                        <Trash2 /> Delete
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
