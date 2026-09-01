import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import type { ReactNode } from "react";

import type { Route } from "./+types/root";
import { site } from "@/lib/site";
import "./app.css";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang={site.locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content={site.themeColor} />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isResponse = isRouteErrorResponse(error);
  const title = isResponse ? String(error.status) : "Error";
  const detail = isResponse ? error.statusText : "An unexpected error occurred.";

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">{detail}</p>
    </main>
  );
}
