import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// next/font self-hosts these files at build time: no runtime font hotlinks.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin", "cyrillic"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "COR Studio",
  description: "Explainable 3D cardiac visualization of structured observations. Synthetic demo data; not a medical device.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0d10" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
