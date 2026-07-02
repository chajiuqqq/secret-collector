"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ViewMode = "waterfall" | "short";

const ViewModeContext = createContext<{
  mode: ViewMode;
  setMode: (v: ViewMode) => void;
}>({ mode: "waterfall", setMode: () => {} });

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ViewMode>("waterfall");

  useEffect(() => {
    const saved = localStorage.getItem("view-mode");
    if (saved === "short" || saved === "waterfall") {
      setModeState(saved);
    }
  }, []);

  const setMode = (v: ViewMode) => {
    setModeState(v);
    localStorage.setItem("view-mode", v);
  };

  return (
    <ViewModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ViewModeContext.Provider>
  );
}

export function useViewMode() {
  return useContext(ViewModeContext);
}
