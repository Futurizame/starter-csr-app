/**
 * The app's view of its own configuration.
 *
 * Everything comes from `app/lib/site.ts`, which `scripts/setup.ts` writes and
 * commits — typed, greppable and reviewable in a diff, unlike an env var, which
 * vanishes silently in CI and takes the metadata with it.
 *
 * Nothing here reads `import.meta.env` any more, but this stays the only module
 * allowed to: ESLint forbids it everywhere else, so a value that genuinely has to
 * come from the environment lands here and nowhere else. Give any such value an
 * empty-string default — an unset key in a `.env` parses as "" rather than
 * undefined, so a meaningful default would sit unreachable behind `??`.
 */
import { site } from "./site";

type Config = {
  appName: string;
  /** Absolute origin, no trailing slash. Empty when there is no custom domain. */
  siteUrl: string;
};

export const config: Config = {
  appName: site.name,
  siteUrl: site.siteUrl,
};
