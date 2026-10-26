import { StreamableHTTPTransport } from "@hono/mcp";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { html } from "hono/html";

import { createMcpServer } from "@/mcp";
import { checkPaymentStatus } from "@/orders";

const app = new Hono();

app.get("/", (c) =>
  c.json({ mcp: "/mcp", mode: "paystack-test", service: "juicetrybe-orders" })
);

app.use("/mcp", async (c, next) => {
  if (!env.MCP_BEARER_TOKEN) {
    return c.json({ error: "MCP_BEARER_TOKEN is not configured" }, 500);
  }

  return await bearerAuth({ token: env.MCP_BEARER_TOKEN })(c, next);
});

// Stateless: a fresh server and transport per request, with plain JSON responses.
app.all("/mcp", async (c) => {
  const server = createMcpServer();

  const transport = new StreamableHTTPTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  return transport.handleRequest(c);
});

// Paystack redirects here after checkout (callback_url).
app.get("/payment/return", async (c) => {
  const reference = c.req.query("reference") ?? c.req.query("trxref");
  const result = reference ? await checkPaymentStatus(reference) : null;
  const paid = result?.ok && result.value.paid;

  const message = paid
    ? `Payment received for order ${reference}. Thank you!`
    : `We have not confirmed payment for order ${reference ?? "(missing reference)"} yet.`;

  return c.html(
    html`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>The Juice Trybe</title>
        </head>
        <body
          style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; text-align: center"
        >
          <h1>${paid ? "Thank you" : "Payment pending"}</h1>
          <p>${message}</p>
          <p>You can close this page and go back to WhatsApp.</p>
        </body>
      </html>`
  );
});

export default app;
