import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Providers from "@/components/providers";
import ThemeToggle from "@/components/theme-toggle";
import SettingsPanel from "@/components/settings-panel";
import CaptureButton from "@/components/capture-button";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "私密收藏夹",
  description: "帖子捕获与展示",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>
          <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="max-w-screen-2xl mx-auto flex items-center justify-between px-4 h-14">
              <h1 className="font-semibold text-lg">私密收藏夹</h1>
              <div className="flex items-center gap-1">
                <CaptureButton />
                <SettingsPanel />
                <ThemeToggle />
              </div>
            </div>
          </header>
          <main className="flex-1 max-w-screen-2xl mx-auto w-full">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
