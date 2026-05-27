import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Tracking } from "@/components/tracking";

export const metadata: Metadata = {
  title: "Ari — Your AI Chief of Staff",
  description: "A private AI assistant that drafts client communications and never sends without your approval.",
  metadataBase: process.env.NEXTAUTH_URL
    ? new URL(process.env.NEXTAUTH_URL)
    : undefined,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B1220",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html lang="en">
      <body>
        {children}
        <Tracking />
      </body>
    </html>
  );
}
