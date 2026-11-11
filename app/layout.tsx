import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider, themeInitScript } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { Diagnostics } from "@/components/diagnostics";
import { AppShell } from "@/components/app-shell";
import { MotionProvider } from "@/components/motion-provider";
import { SplashScreenLinks } from "@/components/splash-screen-links";
import { safeBottomInitScript } from "@/lib/safe-bottom-init";

export const metadata: Metadata = {
  title: "Datebook",
  description: "A personal calendar and assignment tracker.",
  manifest: "/manifest.json",
  applicationName: "Datebook",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Datebook" },
  formatDetection: { telephone: false, date: false, address: false, email: false },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" },
      { url: "/icon-152.png", sizes: "152x152" },
      { url: "/icon-167.png", sizes: "167x167" },
    ],
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  interactiveWidget: "overlays-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1c1e" },
  ],
};

// The rounded face for small caps labels on platforms without SF Rounded
// (`--font-label` in globals.css tries `ui-rounded` first). Self-hosted by
// next/font, so it works offline once cached and never calls Google at runtime.
const nunito = Nunito({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-nunito",
  display: "swap",
});

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <SplashScreenLinks />
      </head>
      <body className="min-h-full">
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        <Script id="safe-bottom-init" strategy="beforeInteractive">
          {safeBottomInitScript}
        </Script>
        <Diagnostics />
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
