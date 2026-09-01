import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("items/:id", "routes/item.tsx"),
  // "404" is prerendered to a real file for CloudFront to serve on a miss; the
  // splat handles the same case during client-side navigation.
  route("404", "routes/not-found.tsx", { id: "not-found-page" }),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
