"use client";

import { useRef, useEffect, useState, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Desktop: right-aligned dropdown below the trigger button.
 * Mobile (<640px): full-width bottom sheet that slides up. The sheet's
 * bottom is bound to `visualViewport.height`, so it stays visible above
 * the on-screen keyboard on iOS/Android instead of being covered by it.
 */
export default function BottomSheet({ open, onClose, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  // Detect mobile viewport once on mount; re-check on resize.
  useEffect(() => {
    const check = () => setIsMobile(window.matchMedia("(max-width: 639px)").matches);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Track on-screen keyboard via visualViewport; push the sheet up by the
  // hidden-by-keyboard amount so its content stays above the keyboard.
  useEffect(() => {
    if (!open || !isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardOffset(Math.max(0, offset));
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
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

  // Lock body scroll while open (mobile sheet only — keep page interactive
  // behind a desktop dropdown).
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
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
        />
        <div
          ref={sheetRef}
          style={{
            bottom: keyboardOffset,
            // Cap height to the visible viewport (above keyboard) minus a
            // small gap so the user sees the top of the sheet.
            maxHeight: `calc(100dvh - ${keyboardOffset}px - 24px)`,
          }}
          className="fixed inset-x-0 z-50 bg-card border-t rounded-t-2xl shadow-2xl p-4 pb-6 overflow-y-auto animate-slide-up transition-[bottom] duration-150"
        >
          <div className="flex justify-center -mt-1 mb-3">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
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
      {children}
    </div>
  );
}
