// End-to-end check of the MCP server over Streamable HTTP, the way Chord calls it.
// Usage: pnpm smoke                  full run
//        pnpm smoke status JT-XXXXXX  check one order's payment
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
]);

console.log("✓ tools/list:", tools.map((t) => t.name).join(", "));

const unknown = await call("create_order", {
  customer_name: "Smoke Test",
  delivery_area: "Wuse",
  items: [{ item_id: "chapman", quantity: 1 }],
});

assert.equal(unknown.isError, true);

assert.equal(unknown.payload.error.code, "UNKNOWN_ITEM");

console.log("✓ unknown item ->", unknown.payload.error.code);

const badArea = await call("create_order", {
  customer_name: "Smoke Test",
  delivery_area: "Lekki",
  items: [{ item_id: "zobo-50cl", quantity: 1 }],
});

assert.equal(badArea.payload.error.code, "UNKNOWN_DELIVERY_AREA");

console.log("✓ unknown area ->", badArea.payload.error.code);

const order = await call("create_order", {
  customer_name: "Smoke Test",
  delivery_area: "Jabi",
  items: [
    { item_id: "zobo-50cl", quantity: 2 },
    { item_id: "small-chops-pack", quantity: 1 },
  ],
});

assert.equal(order.isError, false);

assert.equal(order.payload.total_ngn, 2 * 1800 + 4500 + 1500);

const reference: string = order.payload.reference;

console.log("✓ create_order ->", reference, `₦${order.payload.total_ngn}`);

const early = await call("check_payment_status", {
  order_reference: reference,
});

assert.equal(early.payload.error.code, "PAYMENT_LINK_NOT_CREATED");

console.log("✓ status before link ->", early.payload.error.code);

const missing = await call("create_payment_link", {
  order_reference: "JT-NOPE00",
});

assert.equal(missing.payload.error.code, "ORDER_NOT_FOUND");

console.log("✓ unknown reference ->", missing.payload.error.code);

const link = await call("create_payment_link", { order_reference: reference });

if (link.isError) {
  console.log("✗ create_payment_link failed:", link.payload.error);
  process.exit(1);
}

assert.match(link.payload.payment_url, PAYSTACK_CHECKOUT);

console.log("✓ create_payment_link ->", link.payload.payment_url);

const again = await call("create_payment_link", { order_reference: reference });

assert.equal(
  again.payload.payment_url,
  link.payload.payment_url,
  "second call returns the same link"
);

console.log("✓ create_payment_link is idempotent");

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
