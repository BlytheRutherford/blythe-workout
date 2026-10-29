import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { RegisterSW } from "@/components/register-sw";

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const shoulders = Big_Shoulders({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-shoulders",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Blythe Workout",
  description: "Five workouts a week. Same program, your weights.",
  applicationName: "Blythe Workout",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Blythe Workout",
    statusBarStyle: "black",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#070709",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${instrument.variable} ${shoulders.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-ink text-bone">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
