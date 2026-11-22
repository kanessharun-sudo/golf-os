import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Newsreader, Plus_Jakarta_Sans } from "next/font/google";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import "./globals.css";

const display = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const sans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Golf OS", template: "%s · Golf OS" },
  description: "Tee times, live scoring, caddies and handicaps for India's finest courses.",
  appleWebApp: { capable: true, title: "Golf OS", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#F5F1E8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
