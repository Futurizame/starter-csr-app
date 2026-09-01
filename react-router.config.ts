import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "@react-router/dev/config";

// Plain data with no browser dependencies, so it imports here in Node as readily as
// it does in the bundle. `site.test.ts` keeps its origin honest against infra/cdk.json.
import { site } from "./app/lib/site";

/**
 * Every path the site publishes. Static ones are listed literally; dynamic ones
 * have to be enumerated, which means asking the data source for them here.
 *
 * Read this before pointing `listItems` at a real API: this function then runs
 * against that API on every build. A route that does not exist at build time
 * has no HTML file, the build fails if the API is down, and published content
 * is only as fresh as the last deploy. That is the right trade for a catalogue
 * that changes on deploy, and the wrong one for anything that changes on its
 * own — use a clientLoader for those and let them render after hydration.
 */
async function paths(): Promise<string[]> {
  const { listItems } = await import("./app/lib/api/items");
  const items = await listItems();

  return ["/", "/404", ...items.map((item) => `/items/${item.id}`)];
}

/** Paths worth indexing: everything published except the 404 page. */
function indexable(all: string[]): string[] {
  return all.filter((path) => path !== "/404");
}

export default {
  // Client-side rendered app deployed to S3 + CloudFront: no runtime server.
  ssr: false,

  // Every route is rendered to a real HTML file at build time, then hydrates
  // into a SPA. Routes using clientLoader instead of loader ship an empty
  // shell and paint after hydration; see CLAUDE.md.
  prerender: paths,

  // robots.txt and sitemap.xml are generated rather than committed so they can
  // never drift from the routes that actually exist.
  async buildEnd({ reactRouterConfig }) {
    const outDir = join(reactRouterConfig.buildDirectory, "client");
    const origin = site.siteUrl;
    const urls = indexable(await paths());

    // A sitemap needs absolute URLs, and without a custom domain the only origin is the
    // distribution's own name, which the build cannot know. Emit robots.txt without a
    // Sitemap line rather than one pointing at "https:///sitemap.xml".
    if (!origin) {
      writeFileSync(join(outDir, "robots.txt"), `User-agent: *\nAllow: /\n`);
      console.log(`Generated robots.txt (no domain configured, so no sitemap)`);
      return;
    }

    writeFileSync(
      join(outDir, "robots.txt"),
      `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`,
    );

    const entries = urls
      .map((path) => `  <url><loc>${origin}${path === "/" ? "/" : path}</loc></url>`)
      .join("\n");

    writeFileSync(
      join(outDir, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`,
    );

    console.log(`Generated robots.txt and sitemap.xml (${urls.length} urls) for ${origin}`);
  },
} satisfies Config;
