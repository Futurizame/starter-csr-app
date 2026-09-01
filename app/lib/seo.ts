/**
 * Builds the per-route metadata that crawlers and link unfurlers read.
 *
 * Plain data in, plain descriptors out: no router import, so route modules stay
 * the only framework-aware files and this survives a move to another framework
 * untouched.
 *
 * `siteUrl` is empty in local development, where absolute URLs would be wrong.
 * The URL-dependent tags are simply omitted in that case rather than emitted
 * pointing at localhost.
 */
export type SeoInput = {
  title: string;
  /** Falls back to the site description. */
  description?: string;
  /** Route path, leading slash, no origin. */
  path: string;
  /** Defaults come from app/lib/site.ts and app/lib/config.ts. */
  siteName?: string;
  siteUrl?: string;
  /** Absolute or site-root-relative image for link previews. */
  image?: string;
  twitter?: string;
  noIndex?: boolean;
};

import { config } from "./config";
import { site } from "./site";

export type MetaDescriptor = Record<string, string> | { title: string };

function absolute(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export function seo(input: SeoInput): MetaDescriptor[] {
  const {
    title,
    path,
    description = site.description,
    siteName = site.name,
    siteUrl = config.siteUrl,
    image = site.ogImage,
    twitter = site.twitter,
    noIndex,
  } = input;

  const tags: MetaDescriptor[] = [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:site_name", content: siteName },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];

  if (twitter) tags.push({ name: "twitter:site", content: twitter });
  if (noIndex) tags.push({ name: "robots", content: "noindex, nofollow" });

  if (siteUrl) {
    const url = absolute(siteUrl, path);
    tags.push({ tagName: "link", rel: "canonical", href: url });
    tags.push({ property: "og:url", content: url });
    if (image) {
      const src = image.startsWith("http") ? image : absolute(siteUrl, image);
      tags.push({ property: "og:image", content: src });
      tags.push({ name: "twitter:image", content: src });
    }
  }

  return tags;
}
