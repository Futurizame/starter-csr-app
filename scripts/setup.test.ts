import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

/**
 * The curl command in README.md names the template repository, and so does the TEMPLATE
 * constant in setup.ts. Nothing can interpolate one into the other: README.md is
 * markdown, and setup.ts only ever rewrites the clone it creates — where it deletes that
 * section outright — so it never touches the template's own README.
 *
 * Left unguarded, renaming the repository would leave a documented command that 404s,
 * which is the first thing anyone runs. This test reads setup.ts as text rather than
 * importing it: the module runs `main()` on import.
 *
 * Scaffold-only, and setup.ts deletes it alongside itself.
 */
it("the README's setup command points at the TEMPLATE repository", () => {
  const setup = readFileSync("scripts/setup.ts", "utf8");
  const readme = readFileSync("README.md", "utf8");

  const template = /^const TEMPLATE = "([^"]+)";$/m.exec(setup)?.[1];

  expect(template, "TEMPLATE constant not found in scripts/setup.ts").toBeDefined();
  expect(readme).toContain(`https://raw.githubusercontent.com/${template}/main/scripts/setup.ts`);
});
