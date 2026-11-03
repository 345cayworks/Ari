import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Tracking } from "@/components/tracking";

/**
 * The canonical host, and why it is a constant rather than only an env var.
 *
 * `NEXTAUTH_URL` is also the base the Retell and Telegram webhooks are
 * registered against, so it cannot be repointed casually. Canonical URLs and
 * Open Graph tags need the *public* address, which may differ from whichever
 * custom domain a request arrived on — both `polimeter.cayworks.net` and
 * `polling.cayworks.net` reach this Worker, and search engines must be told
 * which one is the original or they will treat the two as duplicates.
 */
const SITE = "https://polimeter.cayworks.net";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  // Pages set their own title; this is the suffix that identifies the product.
  title: {
    default: "Polimeter — public opinion polling in the Cayman Islands",
    template: "%s · Polimeter",
  },
  description:
    "Independent telephone polling across all nineteen Cayman Islands districts. Answers recorded live, results weighted to population targets, margin of error from the effective sample — and a plain warning when a figure is not fit to publish.",
  applicationName: "Polimeter",
  authors: [{ name: "Cayworks" }],
  creator: "Cayworks",
  publisher: "Cayworks",
  category: "Market and opinion research",
  keywords: [
    "Cayman Islands polling",
    "Cayman Islands public opinion",
    "political polling Cayman",
    "survey research Cayman Islands",
    "opinion poll Grand Cayman",
    "constituency polling Cayman",
    "market research Cayman Islands",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Polimeter",
    locale: "en_KY",
    url: SITE,
    title: "Polimeter — public opinion polling in the Cayman Islands",
    description:
      "Telephone polling across all nineteen districts. Weighted, with the margin of error shown — and a plain warning when a figure is not fit to publish.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Polimeter — public opinion polling in the Cayman Islands",
    description:
      "Telephone polling across all nineteen districts. Weighted, with the margin of error shown.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B1220",
};

/**
 * Structured data, as a plain script tag rather than a library.
 *
 * Describes the product and the service it performs so a search engine can
 * render a richer result and answer "who polls the Cayman Islands" without a
 * click. Kept factual: everything asserted here is also stated on the page,
 * which is both an SEO requirement and the honest position.
 */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE}/#organization`,
      name: "Cayworks",
      url: "https://cayworks.net",
      email: "info@cayworks.com",
      areaServed: { "@type": "Country", name: "Cayman Islands" },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      url: SITE,
      name: "Polimeter",
      publisher: { "@id": `${SITE}/#organization` },
      inLanguage: "en-KY",
    },
    {
      "@type": "Service",
      "@id": `${SITE}/#service`,
      name: "Polimeter public opinion polling",
      serviceType: "Public opinion and survey research",
      provider: { "@id": `${SITE}/#organization` },
      areaServed: { "@type": "Country", name: "Cayman Islands" },
      description:
        "Automated telephone interviewing across all nineteen Cayman Islands districts, with answers recorded during the call, results raked to population targets, margin of error computed from the effective sample, and a publication gate that marks a figure unfit to quote when its base or weighting will not support it.",
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html lang="en-KY">
      <head>
        <script
          type="application/ld+json"
          // Serialised from a constant defined above, never from user input.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
      </head>
      <body>
        {children}
        <Tracking />
      </body>
    </html>
  );
}
