import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MENU, priceOrder } from "@/catalog";

import { renderMenu } from "../scripts/gen-menu";

test("prices a valid order, merging repeated items and matching names loosely", () => {
  const result = priceOrder({
    customer_name: "  Amaka Test ",
    delivery_area: "gwarinpa",
    items: [
      { item_id: "zobo-50cl", quantity: 2 },
      { item_id: "Puff puff (10 pieces)", quantity: 1 },
      { item_id: "ZOBO 50CL", quantity: 1 },
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      customer_name: "Amaka Test",
      delivery_area: "Gwarinpa",
      delivery_fee_ngn: 2500,
      lines: [
        {
          item_id: "puff-puff-10",
          line_total_ngn: 1500,
          name: "Puff puff (10 pieces)",
          quantity: 1,
          unit_price_ngn: 1500,
        },
        {
          item_id: "zobo-50cl",
          line_total_ngn: 5400,
          name: "Zobo (50cl)",
          quantity: 3,
          unit_price_ngn: 1800,
        },
      ],
      subtotal_ngn: 6900,
      total_ngn: 9400,
    },
  });
});

test("rejects an empty order", () => {
  const result = priceOrder({
    customer_name: "Tunde Test",
    delivery_area: "Wuse",
    items: [],
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "EMPTY_ORDER");
});

test("rejects an unknown item and lists what is available", () => {
  const result = priceOrder({
    customer_name: "Tunde Test",
    delivery_area: "Wuse",
    items: [{ item_id: "chapman", quantity: 1 }],
  });

  assert.equal(result.ok, false);

  if (result.ok) {
    return;
  }

  assert.equal(result.error.code, "UNKNOWN_ITEM");
  assert.deepEqual(result.error.details, {
    available_item_ids: MENU.map((m) => m.id),
    unknown_items: ["chapman"],
  });
});

test("rejects fractional quantities and hands bulk orders to the owner", () => {
  const fractional = priceOrder({
    customer_name: "T",
    delivery_area: "Wuse",
    items: [{ item_id: "kunu-35cl", quantity: 1.5 }],
  });

  assert.deepEqual(
    !fractional.ok && [
      fractional.error.code,
      fractional.error.handoff_to_owner,
    ],
    ["INVALID_QUANTITY", false]
  );

  const bulk = priceOrder({
    customer_name: "T",
    delivery_area: "Wuse",
    items: [
      { item_id: "kunu-35cl", quantity: 20 },
      { item_id: "kunu-35cl", quantity: 20 },
    ],
  });

  assert.deepEqual(!bulk.ok && [bulk.error.code, bulk.error.handoff_to_owner], [
    "INVALID_QUANTITY",
    true,
  ]);
});

test("rejects a delivery area outside the list", () => {
  const result = priceOrder({
    customer_name: "T",
    delivery_area: "Lagos",
    items: [{ item_id: "zobo-35cl", quantity: 1 }],
  });

  assert.deepEqual(!result.ok && result.error.code, "UNKNOWN_DELIVERY_AREA");
});

test("skill menu.md matches the catalog", () => {
  assert.equal(
    readFileSync(
      new URL("../skill/references/menu.md", import.meta.url),
      "utf-8"
    ),
    renderMenu()
  );
});
