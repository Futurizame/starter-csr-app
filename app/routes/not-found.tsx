import { Link } from "react-router";

import { Button } from "@/components/ui/Button";
import { seo } from "@/lib/seo";

export function meta() {
  return seo({
    title: "Not found",
    description: "That page does not exist.",
    path: "/404",
    noIndex: true,
  });
}

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">That page does not exist.</p>
      <div className="mt-6">
        <Link to="/">
          <Button variant="secondary">Go home</Button>
        </Link>
      </div>
    </main>
  );
}
