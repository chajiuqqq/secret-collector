"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { LayoutGrid, Smartphone } from "lucide-react";
import { useViewMode, type ViewMode } from "./view-mode-context";

const modes: { value: ViewMode; label: string; icon: typeof LayoutGrid }[] = [
  { value: "waterfall", label: "瀑布流", icon: LayoutGrid },
  { value: "short", label: "短视频", icon: Smartphone },
];

export default function ViewModeToggle() {
  const { mode, setMode } = useViewMode();
  const { theme, setTheme } = useTheme();
  // Theme saved before forcing dark for short-video mode, so we can restore it.
  const savedTheme = useRef<string | null>(null);

  useEffect(() => {
    if (mode === "short") {
      if (theme && theme !== "dark") {
        savedTheme.current = theme;
        setTheme("dark");
      }
    } else {
      if (savedTheme.current) {
        setTheme(savedTheme.current);
        savedTheme.current = null;
      }
    }
  }, [mode, theme, setTheme]);

  return (
    <div className="flex items-center rounded-full bg-muted p-0.5 h-9">
      {modes.map(({ value, label, icon: Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            onClick={() => setMode(value)}
            aria-label={label}
            aria-pressed={active}
            className={`flex items-center gap-1 rounded-full px-2 h-8 text-xs font-medium transition-colors ${
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
