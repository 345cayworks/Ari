import type { MetadataRoute } from "next";

/**
 * Keep crawlers off the admin and the webhooks.
 *
 * Neither is reachable without a session or a signature, so this is not a
 * security control and must not be mistaken for one — `robots.txt` is a
 * request, and the first thing an attacker reads. It is here because a
 * crawler that follows `/admin/login` wastes its budget on redirects and can
 * surface a login page in results for the brand's own name.
 *
 * `polling.cayworks.net` serves the same Worker, so both hosts answer this
 * file. The canonical tag in `layout.tsx` is what tells a search engine which
 * of the two is the original.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api"] }],
    sitemap: "https://polimeter.cayworks.net/sitemap.xml",
  };
}
