"use client";

import { useRef, useEffect, useState, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Desktop (≥640px): right-aligned dropdown below the trigger.
 * Mobile (<640px): full-width sheet centered in the visible viewport.
 * The sheet's position and height track `visualViewport`, so the
 * on-screen keyboard never covers it and it never overflows the screen.
 */
export default function BottomSheet({ open, onClose, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [vv, setVv] = useState<{ top: number; height: number }>({
    top: 0,
    height: 0,
  });

  // Detect mobile viewport once on mount; re-check on resize.
  useEffect(() => {
    const check = () =>
      setIsMobile(window.matchMedia("(max-width: 639px)").matches);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Track visualViewport for keyboard-aware positioning.
  useEffect(() => {
    if (!open || !isMobile) return;
    const visual = window.visualViewport;
    const update = () => {
      if (visual) {
        setVv({ top: visual.offsetTop, height: visual.height });
      } else {
        setVv({ top: 0, height: window.innerHeight });
      }
    };
    update();
    if (visual) {
      visual.addEventListener("resize", update);
      visual.addEventListener("scroll", update);
      return () => {
        visual.removeEventListener("resize", update);
        visual.removeEventListener("scroll", update);
      };
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, isMobile]);

  // Click outside / Escape to close.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Lock body scroll while open on mobile.
  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile]);

  if (!open) return null;

  if (isMobile) {
    // Leave a 16px margin top+bottom inside the visible viewport.
    const margin = 16;
    const maxHeight = Math.max(120, vv.height - margin * 2);

    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
        />
        <div
          ref={sheetRef}
          style={{
            position: "fixed",
            top: vv.top + margin,
            left: margin,
            right: margin,
            maxHeight,
          }}
          className="z-50 bg-card border rounded-2xl shadow-2xl p-4 overflow-y-auto animate-fade-in"
        >
          <button
            onClick={onClose}
            aria-label="关闭"
            className="absolute top-2 right-2 inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-accent text-muted-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          {children}
        </div>
      </>
    );
  }

  // Desktop dropdown — relies on a `position: relative` parent.
  return (
    <div
      ref={sheetRef}
      className="absolute right-0 top-full mt-2 w-96 bg-card border rounded-xl shadow-lg p-4 z-50"
    >
      <button
        onClick={onClose}
        aria-label="关闭"
        className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-full hover:bg-accent text-muted-foreground"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      {children}
    </div>
  );
}
