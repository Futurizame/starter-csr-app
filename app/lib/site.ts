/**
 * Everything about *this* project that is not code: the values that end up in
 * page titles, link previews and the manifest.
 *
 * Written once by `npx tsx scripts/setup.ts` and committed, so it is typed,
 * greppable and reviewable in a diff — unlike an env var, which vanishes
 * silently in CI and takes the metadata with it.
 *
 * The origin is here too, even though infra/cdk.json also carries the domain the
 * stacks build a hosted zone for. Two files hold it because two runtimes need it
 * and neither can read the other's source at the right moment; `scripts/setup.ts`
 * writes both from one answer, and `site.test.ts` fails the build if they ever
 * disagree.
 */
export type Site = {
  /** Display name, used in titles and og:site_name. */
  name: string;
  /** Default meta description, and the fallback for pages without their own. */
  description: string;
  /** BCP 47 tag for <html lang>. */
  locale: string;
  /** Browser UI colour on mobile. */
  themeColor: string;
  /** Site-root-relative or absolute image for link previews. "" to omit. */
  ogImage: string;
  /** Twitter/X handle including the @, for attribution in cards. "" to omit. */
  twitter: string;
  /**
   * Absolute origin, no trailing slash — "https://example.com".
   *
   * "" when the project has no custom domain, which is a supported mode: the site is
   * then served from the CloudFront distribution's own name, a stack output that no
   * build can know. Everything downstream treats empty as "omit rather than guess" —
   * `seo.ts` drops canonical, og:url and image tags, and `react-router.config.ts`
   * writes robots.txt with no Sitemap line and no sitemap.xml at all.
   */
  siteUrl: string;
};

export const site: Site = {
  name: "Starter CSR App",
  description: "CSR scaffold: Vite + React Router + AWS.",
  locale: "en",
  themeColor: "#18181b",
  ogImage: "",
  twitter: "",
  siteUrl: "https://example.com",
};
