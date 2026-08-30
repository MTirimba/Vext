import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@/styles/globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VextUp",
  description: "Book services and pay easily",
  icons: {
    icon: "/vextup-icon.png", // points at /public/vextup-icon.png
  },
};

// 🔒 FIX: without viewport-fit=cover, iOS/Android browsers never extend the
// layout viewport under the notch/home-indicator/gesture-bar, which means
// every `env(safe-area-inset-*)` value used throughout VideoFeed.tsx (top
// controls, the like/comment/share rail, the booking button) silently
// resolves to 0px regardless of the actual device. That's why those
// elements end up floating in the wrong place or getting covered by phone
// chrome — the safe-area CSS was already correct, it just had nothing to
// read from. This is the one setting that turns it on.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 text-gray-900`}
      >
        {children}
      </body>
    </html>
  );
}