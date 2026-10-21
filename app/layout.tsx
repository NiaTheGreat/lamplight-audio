import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
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
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body suppressHydrationWarning>
        <PlayerProvider>
          {children}
          <AppChrome />
        </PlayerProvider>
      </body>
    </html>
  );
}
