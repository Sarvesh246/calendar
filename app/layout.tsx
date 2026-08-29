import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider, themeInitScript } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { AppShell } from "@/components/app-shell";
import { MotionProvider } from "@/components/motion-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Datebook",
  description: "A personal calendar and assignment tracker.",
  manifest: "/manifest.json",
  applicationName: "Datebook",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Datebook" },
  formatDetection: { telephone: false, date: false, address: false, email: false },
  // Next 16's `appleWebApp.capable` only emits the standard
  // `mobile-web-app-capable` tag now, not the Apple-prefixed one. iOS ties
  // `apple-mobile-web-app-status-bar-style` (translucent status bar, safe-area
  // insets) to `apple-mobile-web-app-capable` being present, so without this
  // the home-screen app renders with the OS reserving its own status-bar
  // strip instead of the page drawing edge-to-edge under it.
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  // `cover` lets the app draw into the iOS safe areas so `env(safe-area-inset-*)`
  // resolves to real values — the bottom nav uses it to clear the home indicator.
  viewportFit: "cover",
  // Let the on-screen keyboard overlay the page rather than reflowing the whole
  // layout (which would resize the calendar grids on every focus). Bottom-anchored
  // UI that must clear the keyboard — the AI drawer, the command palette — reads
  // `--keyboard-inset` from `useKeyboardInset()` instead, which works the same on
  // iOS Safari (where the layout viewport never resizes for the keyboard anyway).
  interactiveWidget: "overlays-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0d" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        <ThemeProvider>
          <MotionProvider>
            <AuthProvider>
              <AppShell>{children}</AppShell>
            </AuthProvider>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
