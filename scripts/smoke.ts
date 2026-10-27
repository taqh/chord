// End-to-end check of the MCP server over Streamable HTTP, the way Chord calls it.
// Usage: pnpm smoke                  full run
//        pnpm smoke status JT-XXXXXX  check one order's payment
//        pnpm smoke call <tool> '<json>' call one tool with JSON arguments
// MCP_URL defaults to http://localhost:5173/mcp. The token comes from MCP_BEARER_TOKEN or .dev.vars.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

import type { JsonValue } from "@/catalog";

const TOKEN_LINE = /^MCP_BEARER_TOKEN=["']?(?<token>[^"'\n]+)/mu;
const PAYSTACK_CHECKOUT = /^https:\/\/checkout\.paystack\.com\//u;
const textContentSchema = z.array(z.object({ text: z.string() })).min(1);

const url = process.env.MCP_URL ?? "http://localhost:5173/mcp";

const devVars = existsSync(".dev.vars")
  ? readFileSync(".dev.vars", "utf-8")
  : "";

const token =
  process.env.MCP_BEARER_TOKEN ?? devVars.match(TOKEN_LINE)?.groups?.token;

assert.ok(token, "set MCP_BEARER_TOKEN or add it to .dev.vars");

const connect = async () => {
  const client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );

  const call = async (name: string, args: Record<string, JsonValue>) => {
    const result = await client.callTool({ arguments: args, name });
    const [content] = textContentSchema.parse(result.content);
    const payload = JSON.parse(content.text);

    return { isError: result.isError === true, payload };
  };

  return { call, client };
};

if (process.argv[2] === "status") {
  const { client, call } = await connect();

  const result = await call("check_payment_status", {
    order_reference: process.argv[3] ?? "",
  });

  console.log(result.payload);
  await client.close();
  process.exit(0);
}

if (process.argv[2] === "call") {
  const { client, call } = await connect();

  const result = await call(
    process.argv[3] ?? "",
    JSON.parse(process.argv[4] ?? "{}")
  );

  console.log(JSON.stringify(result.payload, null, 2));
  await client.close();
  process.exit(0);
}

const customerName = `Smoke Test ${Date.now().toString(36)}`;

const listTools = (headers: Record<string, string>) =>
  fetch(url, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    },
    method: "POST",
  });

const unauthorized = await listTools({});

assert.equal(unauthorized.status, 401, "request without a token is rejected");

const wrongToken = await listTools({ Authorization: "Bearer wrong" });

assert.equal(wrongToken.status, 401, "request with a wrong token is rejected");

const jsonOnly = await listTools({ Authorization: `Bearer ${token}` });

assert.equal(
  jsonOnly.status,
  200,
  "plain JSON POST with Accept: application/json works"
);

console.log("✓ auth and JSON-only Accept header");

const { client, call } = await connect();

const { tools } = await client.listTools();

assert.deepEqual(tools.map((t) => t.name).toSorted(), [
  "check_payment_status",
  "create_order",
  "create_payment_link",
  "quote_order",
]);

console.log("✓ tools/list:", tools.map((t) => t.name).join(", "));

const unknown = await call("quote_order", {
  delivery_area: "Wuse",
  items: [{ item_id: "chapman", quantity: 1 }],
});

assert.equal(unknown.isError, true);

assert.equal(unknown.payload.error.code, "UNKNOWN_ITEM");

console.log("✓ unknown item ->", unknown.payload.error.code);

const badArea = await call("quote_order", {
  delivery_area: "Lekki",
  items: [{ item_id: "zobo-50cl", quantity: 1 }],
});

assert.equal(badArea.payload.error.code, "UNKNOWN_DELIVERY_AREA");

console.log("✓ unknown area ->", badArea.payload.error.code);

const items = [
  { item_id: "zobo-50cl", quantity: 2 },
  { item_id: "small-chops-pack", quantity: 1 },
];

const expectedTotal = 2 * 1800 + 4500 + 1500;

const quote = await call("quote_order", { delivery_area: "Jabi", items });

assert.equal(quote.isError, false);

assert.equal(quote.payload.total_ngn, expectedTotal);

assert.equal(quote.payload.reference, undefined, "a quote has no reference");

console.log("✓ quote_order ->", `₦${quote.payload.total_ngn}`, "no reference");

const order = await call("create_order", {
  customer_name: customerName,
  delivery_area: "Jabi",
  items,
});

if (order.isError) {
  console.log("✗ create_order failed:", order.payload.error);
  process.exit(1);
}

assert.equal(order.payload.total_ngn, expectedTotal);

assert.equal(order.payload.reused_existing_order, false);

assert.match(order.payload.payment_url, PAYSTACK_CHECKOUT);

const reference: string = order.payload.reference;

console.log("✓ create_order ->", reference, order.payload.payment_url);

const repeat = await call("create_order", {
  customer_name: customerName.toLowerCase(),
  delivery_area: "jabi",
  items: items.toReversed(),
});

assert.equal(repeat.payload.reference, reference, "same order, same reference");

assert.equal(repeat.payload.payment_url, order.payload.payment_url);

assert.equal(repeat.payload.reused_existing_order, true);

console.log("✓ repeated create_order returns", repeat.payload.reference);

const missing = await call("create_payment_link", {
  order_reference: "JT-NOPE00",
});

assert.equal(missing.payload.error.code, "ORDER_NOT_FOUND");

console.log("✓ unknown reference ->", missing.payload.error.code);

const resend = await call("create_payment_link", {
  order_reference: reference,
});

assert.equal(resend.payload.payment_url, order.payload.payment_url);

console.log("✓ create_payment_link resends the same link");

const status = await call("check_payment_status", {
  order_reference: reference,
});

assert.equal(status.isError, false);

assert.equal(status.payload.paid, false);

console.log(
  "✓ check_payment_status ->",
  status.payload.payment_status,
  `(${status.payload.paystack_status})`
);

await client.close();

console.log(
  `\nAll checks passed. Pay with a Paystack test card at the link above, then: pnpm smoke status ${reference}`
);
