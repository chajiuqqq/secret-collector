"use client";

import { createContext, useContext, useEffect, useState } from "react";

const NSFWContext = createContext<{
  nsfw: boolean;
  setNsfw: (v: boolean) => void;
}>({ nsfw: false, setNsfw: () => {} });

export function NSFWProvider({ children }: { children: React.ReactNode }) {
  const [nsfw, setNsfwState] = useState(false);

  useEffect(() => {
    setNsfwState(localStorage.getItem("nsfw-mode") === "1");
  }, []);

  const setNsfw = (v: boolean) => {
    setNsfwState(v);
    localStorage.setItem("nsfw-mode", v ? "1" : "0");
  };

  return (
    <NSFWContext.Provider value={{ nsfw, setNsfw }}>
      {children}
    </NSFWContext.Provider>
  );
}

export function useNSFW() {
  return useContext(NSFWContext);
}
