import type { MetadataRoute } from "next";

/**
 * The public surface, which is one page.
 *
 * `/admin` is deliberately absent rather than listed and disallowed: a sitemap
 * is a list of pages worth indexing, and every admin route redirects to a
 * login. Listing them would invite crawlers to discover the surface and would
 * put the shape of the platform in a file designed to be read by anyone.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://polimeter.cayworks.net",
      lastModified: new Date("2026-11-03"),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
