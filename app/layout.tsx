import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Tracking } from "@/components/tracking";

export const metadata: Metadata = {
  title: "Cayworks Polling — public opinion research in the Cayman Islands",
  description:
    "Automated telephone interviewers across the nineteen districts. Answers recorded live, results weighted to population targets, and a plain warning when a figure is not fit to publish.",
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
