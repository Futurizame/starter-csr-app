import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import { site } from "./site";

/**
 * The domain has to exist in two places: `infra/cdk.json` for the stacks, which build a
 * hosted zone, certificate and CloudFront aliases from it, and `app/lib/site.ts` for the
 * pages, which need an absolute origin for canonical tags and the sitemap. Neither
 * runtime can read the other's source at the moment it needs the value.
 *
 * `scripts/setup.ts` writes both from a single answer, so they start in agreement. This
 * is what keeps them there: docs/SCAFFOLD.md documents adopting a domain later by
 * setting it in `infra/cdk.json` and redeploying, and without this test that edit would
 * half-work — the stack would serve the domain while every page kept omitting its
 * canonical tag and the build kept emitting no sitemap. Silent, and only noticed weeks
 * later. Both workflows run this, so it fails before anything ships.
 */
it("site.siteUrl agrees with the domain in infra/cdk.json", () => {
  // Repo-root-relative, like vite.config.ts and react-router.config.ts: `import.meta.url`
  // is not a file: URL under Vitest, and ESLint bans `import.meta` anywhere in app/.
  const cdkJson = JSON.parse(readFileSync("infra/cdk.json", "utf8")) as {
    context: { domain?: string };
  };

  const domain = cdkJson.context.domain;

  expect(site.siteUrl).toBe(domain ? `https://${domain}` : "");
});
