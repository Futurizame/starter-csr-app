# Instructions

## Boundaries — do not work around these

- Do not import `react-router` outside `app/routes/`. Components receive data
  and callbacks as props. ESLint enforces it; fix the design, not the rule.
- Do not read `import.meta.env` outside `app/lib/config.ts`.
- Do not call `fetch` from a component. Data access goes in `app/lib/api/`.

## Routes

- Export `loader`, not `clientLoader`, unless the data is user-specific or must
  be live. `loader` runs in Node at build time, so the route prerenders with its
  markup; `clientLoader` routes ship an empty shell.
- Never touch `window`, `document` or `app/lib/storage.ts` from a `loader` —
  none of them exist during the build.
- Add every new dynamic route to `paths()` in `react-router.config.ts`, or it
  gets no HTML file and CloudFront serves the 404 page. This fails silently.
- Return `seo()` from `app/lib/seo.ts` in every `meta`. Do not hand-write meta
  descriptors — canonical, Open Graph and Twitter tags drift immediately.
- Never commit `robots.txt` or `sitemap.xml`; they are generated at build.

## Conventions

- Run `npm run format` before finishing.
- `@/*` resolves to `app/*`.
