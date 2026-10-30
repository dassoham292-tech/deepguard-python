import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AudioLines, Camera, Film } from "lucide-react";

import { AudioDetection } from "@/components/deepguard/AudioDetection";
import { LiveDetection } from "@/components/deepguard/LiveDetection";
import { StatTile } from "@/components/deepguard/threat";
import { VideoDetection } from "@/components/deepguard/VideoDetection";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHistory } from "@/lib/history";

type Tab = "live" | "video" | "audio";
const TABS: Tab[] = ["live", "video", "audio"];

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => {
    const t = search["tab"];
    return TABS.includes(t as Tab) ? { tab: t as Tab } : {};
  },
  head: () => ({
    meta: [
      { title: "DeepGuard Dashboard — Live Deepfake & Voice-Clone Detection" },
      {
        name: "description",
        content: "Scan your webcam, a shared screen, video files and audio clips for deepfakes and cloned voices in real time.",
      },
      { property: "og:title", content: "DeepGuard Dashboard — Live Deepfake Detection" },
      {
        property: "og:description",
        content: "Real-time forensics for webcam, screen share, video and audio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { tab = "live" } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const history = useHistory();
  const flagged = history.filter((h) => h.level !== "authentic").length;
  const last = history[0];

  const trigger =
    "gap-2 px-4 py-2 font-display uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-primary-foreground";

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="label-caps text-primary">Forensics console</div>
          <h1 className="mt-1 text-3xl font-bold sm:text-4xl">Detect deepfakes as they happen</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Scan live faces and voices, or check a video or audio file for signs of AI manipulation.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Scans" value={history.length} />
          <StatTile label="Flagged" value={flagged} />
          <StatTile label="Last" value={last ? `${Math.round(last.score)}` : "--"} hint={last?.type} />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v as Tab } })}>
        <TabsList className="mb-6 h-auto flex-wrap border bg-card p-1">
          <TabsTrigger value="live" className={trigger}>
            <Camera className="size-4" /> Live webcam
          </TabsTrigger>
          <TabsTrigger value="video" className={trigger}>
            <Film className="size-4" /> Video detection
          </TabsTrigger>
          <TabsTrigger value="audio" className={trigger}>
            <AudioLines className="size-4" /> Audio detection
          </TabsTrigger>
        </TabsList>
        <TabsContent value="live">
          <LiveDetection />
        </TabsContent>
        <TabsContent value="video">
          <VideoDetection />
        </TabsContent>
        <TabsContent value="audio">
          <AudioDetection />
        </TabsContent>
      </Tabs>
    </main>
  );
}
