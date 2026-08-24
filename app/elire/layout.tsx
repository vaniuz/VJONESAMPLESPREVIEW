import type { Metadata, Viewport } from "next";
import "../globals.css";
import "./elire.css";

export const metadata: Metadata = {
  title: "ELIRE in Motion — Private Presentation",
  description:
    "ELIRE is built on light, shadow and form. This is what that does in motion.",
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
    url: "https://vjone-elire-sample.vercel.app/elire",
    title: "ELIRE in Motion — Private Presentation",
    description:
      "ELIRE is built on light, shadow and form. This is what that does in motion.",
    images: [
      {
        url: "https://vjone-elire-sample.vercel.app/og.jpg",
        width: 1200,
        height: 630,
        alt: "ELIRE in Motion",
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

export default function ElireLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div style={{ cursor: "auto" }}>
      {children}
    </div>
  );
}