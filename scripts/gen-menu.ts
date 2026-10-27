// Writes skill/references/menu.md from src/catalog.ts so the agent's menu and
// the server's validation never disagree. `--check` fails if the file is stale.
import { readFileSync, writeFileSync } from "node:fs";

import { DELIVERY_AREAS, MAX_QUANTITY_PER_ITEM, MENU } from "@/catalog";

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

export const renderMenu = (): string => {
  const sections = (["Drinks", "Snacks"] as const).map((category) =>
    [
      `## ${category}`,
      "",
      "| Item id | Name | Description | Price |",
      "| --- | --- | --- | --- |",
      ...MENU.filter((m) => m.category === category).map(
        (m) =>
          `| \`${m.id}\` | ${m.name} | ${m.description} | ${naira(m.priceNgn)} |`
      ),
    ].join("\n")
  );

  return [
    "# Menu and delivery (PLACEHOLDER PRICES)",
    "",
    "Generated from `src/catalog.ts` by `pnpm menu:gen`. Do not edit by hand.",
    "These prices are placeholders until the owner confirms the real menu.",
    "",
    "Pass the `Item id` column as `item_id` to `quote_order` and `create_order`. Quote prices exactly as listed, in naira.",
    "",
    ...sections.flatMap((s) => [s, ""]),
    "## Delivery areas (Abuja)",
    "",
    'Pass the `Area` name as `delivery_area`. A street, estate or landmark inside an area counts as that area: for "Softlife Apartments, Jahi" pass `Jahi`. If you\'re not sure which area a place is in, ask the customer for the area.',
    "",
    "| Area | Also called | Delivery fee |",
    "| --- | --- | --- |",
    ...DELIVERY_AREAS.map(
      (a) =>
        `| ${a.name} | ${(a.alsoCalled ?? []).join(", ")} | ${naira(a.feeNgn)} |`
    ),
    "",
    "Any other area: tell the customer we don't deliver there yet and offer to pass them to the owner.",
    "",
    `Orders of more than ${MAX_QUANTITY_PER_ITEM} of one item are bulk or event orders. Hand them to the owner.`,
    "",
  ].join("\n");
};

const target = new URL("../skill/references/menu.md", import.meta.url);

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf-8") !== renderMenu()) {
      console.error(
        "skill/references/menu.md is out of date. Run `pnpm menu:gen`."
      );
      process.exit(1);
    }
  } else {
    writeFileSync(target, renderMenu());
    console.log(`wrote ${target.pathname}`);
  }
}
