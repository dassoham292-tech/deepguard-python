import { Link } from "@tanstack/react-router";
import { History, LayoutDashboard, Moon, ScanFace, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useHistory } from "@/lib/history";

export const THEME_KEY = "deepguard.theme";

/** Inline script run before paint so the saved theme applies without a flash. Defaults to dark. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'){document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}})();`;

function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

export function AppHeader() {
  const history = useHistory();
  const navClass =
    "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground shadow-glow">
            <ScanFace className="size-5" />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-lg font-bold tracking-wide">DEEPGUARD</span>
            <span className="label-caps hidden text-muted-foreground sm:block">
              Real-time media forensics
            </span>
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          <Link
            to="/"
            className={navClass}
            activeOptions={{ exact: true, includeSearch: false }}
            activeProps={{ className: "bg-accent text-accent-foreground" }}
          >
            <LayoutDashboard className="size-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <Link
            to="/history"
            className={navClass}
            activeProps={{ className: "bg-accent text-accent-foreground" }}
          >
            <History className="size-4" />
            <span className="hidden sm:inline">History</span>
            {history.length > 0 && (
              <span className="rounded-sm bg-primary/15 px-1.5 font-mono text-[11px] text-primary">
                {history.length}
              </span>
            )}
          </Link>
          <div className="ml-2">
            <ThemeToggle />
          </div>
        </nav>
      </div>
    </header>
  );
}
