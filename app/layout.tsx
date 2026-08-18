import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Ungasan, Before You Arrive — Private Presentation",
  description:
    "Two films made for one purpose — to make someone want to be here before they have decided to come.",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
  icons: {
    icon: "/favicon.svg?v=3",
    shortcut: "/favicon.svg?v=3",
  },
  openGraph: {
    type: "website",
    url: "https://vjone-ungasan-private.vercel.app",
    title: "The Ungasan, Before You Arrive",
    description:
      "Two films made for one purpose — to make someone want to be here before they have decided to come.",
    images: [
      {
        url: "https://vjone-ungasan-private.vercel.app/og.jpg",
        width: 1200,
        height: 630,
        alt: "The Ungasan, Before You Arrive",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  themeColor: "#0C0F0D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
