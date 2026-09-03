import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env["VENUEMIND_PUBLIC_ORIGIN"] ?? "https://venue-mind-jet.vercel.app"),
  title: { default: "VenueMind", template: "%s · VenueMind" },
  description: "Versioned venue planning for human-supervised agents and operations teams.",
  applicationName: "VenueMind",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#faf9f6",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
