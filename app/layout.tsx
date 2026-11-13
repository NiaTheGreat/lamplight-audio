import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Fraunces, Hanken_Grotesk, Literata } from "next/font/google";
import type { ReactNode } from "react";
import { DialogProvider } from "@/components/Dialog";
import { AppChrome } from "@/components/AppChrome";
import { PlayerProvider } from "@/components/PlayerProvider";
import "./globals.css";

const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  axes: ["opsz"],
  style: ["normal", "italic"],
  display: "swap",
});
// Reading fonts for the book reader. Not preloaded: the browser fetches one only when it is used.
const literata = Literata({
  subsets: ["latin"],
  variable: "--font-literata",
  style: ["normal", "italic"],
  display: "swap",
  preload: false,
});
const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-atkinson",
  style: ["normal", "italic"],
  display: "swap",
  preload: false,
});
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Lamplight",
  description: "Turn EPUBs into audiobooks you can listen to in bed.",
  appleWebApp: { capable: true, title: "Lamplight", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#14100D",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${literata.variable} ${atkinson.variable}`}
    >
      <body suppressHydrationWarning>
        <PlayerProvider>
          <DialogProvider>
            {children}
            <AppChrome />
          </DialogProvider>
        </PlayerProvider>
      </body>
    </html>
  );
}
