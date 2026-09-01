import { Link } from "react-router";

import type { Route } from "./+types/item";
import { Button } from "@/components/ui/Button";
import { getItem } from "@/lib/api/items";
import { seo } from "@/lib/seo";

export function meta({ loaderData, params }: Route.MetaArgs) {
  const item = loaderData?.item;

  return seo({
    title: item?.name ?? "Not found",
    description: item?.description ?? "That item does not exist.",
    path: `/items/${params.id}`,
    noIndex: !item,
  });
}

export async function loader({ params }: Route.LoaderArgs) {
  const item = await getItem(params.id);
  if (!item) {
    throw new Response("Item not found", { status: 404, statusText: "Item not found" });
  }
  return { item };
}

export default function ItemRoute({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">{loaderData.item.name}</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">{loaderData.item.description}</p>
      <div className="mt-6">
        <Link to="/">
          <Button variant="secondary">Back</Button>
        </Link>
      </div>
    </main>
  );
}
