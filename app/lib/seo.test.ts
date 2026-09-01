import { describe, expect, it } from "vitest";

import { seo } from "./seo";

const base = {
  title: "First item",
  description: "A thing.",
  path: "/items/1",
  siteName: "Example Site",
  siteUrl: "https://example.com",
};

function find(tags: ReturnType<typeof seo>, key: string, value: string) {
  return tags.find((tag) => (tag as Record<string, string>)[key] === value);
}

describe("seo", () => {
  it("emits a canonical url built from the site origin", () => {
    expect(find(seo(base), "rel", "canonical")).toMatchObject({
      href: "https://example.com/items/1",
    });
  });

  it("omits url-dependent tags when the site url is unknown", () => {
    const tags = seo({ ...base, siteUrl: "" });

    expect(find(tags, "rel", "canonical")).toBeUndefined();
    expect(find(tags, "property", "og:url")).toBeUndefined();
    expect(find(tags, "property", "og:title")).toBeDefined();
  });

  it("does not double the slash when the site url has a trailing one", () => {
    expect(
      find(seo({ ...base, siteUrl: "https://example.com/" }), "rel", "canonical"),
    ).toMatchObject({ href: "https://example.com/items/1" });
  });

  it("resolves a root-relative image against the origin", () => {
    const tags = seo({ ...base, image: "/og.png" });

    expect(find(tags, "property", "og:image")).toMatchObject({
      content: "https://example.com/og.png",
    });
    expect(find(tags, "name", "twitter:card")).toMatchObject({ content: "summary_large_image" });
  });

  it("leaves an absolute image url alone", () => {
    expect(
      find(seo({ ...base, image: "https://cdn.test/a.png" }), "property", "og:image"),
    ).toMatchObject({ content: "https://cdn.test/a.png" });
  });

  it("marks a page noindex on request", () => {
    expect(find(seo({ ...base, noIndex: true }), "name", "robots")).toMatchObject({
      content: "noindex, nofollow",
    });
  });
});
