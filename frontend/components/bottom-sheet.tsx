"use client";

import { useRef, useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Desktop: right-aligned dropdown below the trigger button.
 * Mobile (<640px): full-width bottom sheet that slides up from the bottom.
 */
export default function BottomSheet({ open, onClose, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("mousedown", handler);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop — only visible on mobile */}
      <div
        className="fixed inset-0 z-40 bg-black/30 sm:hidden"
        onClick={onClose}
      />

      {/* Desktop dropdown (absolute, right-aligned) */}
      <div className="hidden sm:block absolute right-0 top-full mt-2 w-96 bg-card border rounded-xl shadow-lg p-4 z-50">
        {children}
      </div>

      {/* Mobile bottom sheet (fixed, slides up from bottom) */}
      <div
        ref={sheetRef}
        className="sm:hidden fixed inset-x-0 bottom-0 z-50 bg-card border-t rounded-t-2xl shadow-2xl p-4 pb-safe max-h-[90vh] overflow-y-auto animate-slide-up"
      >
        {/* Drag handle */}
        <div className="flex justify-center -mt-1 mb-3">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>
        {children}
      </div>
    </>
  );
}
