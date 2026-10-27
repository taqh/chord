# Juice Trybe orders

A small Chord teammate that takes drink and snack orders over chat for a seller in Abuja. It confirms each order and sends a Paystack payment link. Chord runs the agent. This repo holds the agent's skill and the MCP server it calls.

Everything runs in Paystack **test mode**. The menu prices and all customer data are made up.

```
customer ──chat──▶ Chord teammate ──MCP (Streamable HTTP, bearer)──▶ chord.taqib.dev/mcp
                   (skill/)                                          (Hono on Cloudflare Workers)
                                                                       ├─ D1: orders
                                                                       └─ Paystack test API
```

## Repository layout

| Path | Contents |
| --- | --- |
| `src/index.ts` | Hono app: bearer auth, the `/mcp` endpoint, and the Paystack return page |
| `src/mcp.ts` | The four MCP tools and their schemas |
| `src/orders.ts` | Order service: D1 storage, payment links, payment checks |
| `src/paystack.ts` | Paystack initialize and verify calls, with every failure mapped to an error code |
| `src/catalog.ts` | Placeholder menu, delivery areas, and order pricing (pure, unit-tested) |
| `migrations/` | D1 schema |
| `skill/` | Chord skill: `SKILL.md` and `references/menu.md` |
| `scripts/gen-menu.ts` | Generates `skill/references/menu.md` from `src/catalog.ts` |
| `scripts/smoke.ts` | End-to-end MCP test against a local or deployed server |
| `cloudflare.config.ts` | Typed Worker config (Cloudflare `cf` CLI and Vite plugin, no Wrangler file) |

## Tools

| Tool | What it does |
| --- | --- |
| `quote_order(items, delivery_area)` | Checks each `item_id` against the menu and the area against the delivery list, and returns the line items, delivery fee and total in naira. Saves nothing and creates no reference. |
| `create_order(items, customer_name, delivery_area, customer_email?)` | Used once the customer confirms. Saves the order, calls Paystack `POST /transaction/initialize` in test mode, and returns the reference (such as `JT-7K3QF2`) together with the checkout URL. Calling it again with the same name, area and items within 30 minutes returns the same order and link, or says the order is already paid. |
| `create_payment_link(order_reference, customer_email?)` | Resends the checkout URL for an existing order. Always returns the same link for an unpaid order. |
| `check_payment_status(order_reference)` | Calls Paystack `GET /transaction/verify/{reference}`. Marks the order paid only on `success` with a matching amount and currency. |

The tools are split this way because Chord doesn't carry tool results into later messages. See section 1 of `FIELD_NOTES.md`.

Every result is JSON with `ok`. Failures carry `error.code`, a `message` that tells the agent what to say, and `retryable` and `handoff_to_owner` flags. The codes are `EMPTY_ORDER`, `UNKNOWN_ITEM`, `INVALID_QUANTITY`, `UNKNOWN_DELIVERY_AREA`, `ORDER_NOT_FOUND`, `ORDER_ALREADY_PAID`, `PAYMENT_LINK_NOT_CREATED`, `PAYMENT_PROVIDER_UNAVAILABLE` (network error, timeout or 5xx), `PAYMENT_PROVIDER_EMPTY_RESPONSE`, `PAYMENT_PROVIDER_REJECTED`, `PAYMENT_AMOUNT_MISMATCH`, `PAYMENTS_MISCONFIGURED` and `INTERNAL_ERROR`. An unpaid order is not an error. `check_payment_status` returns `paid: false` with a `payment_status` of `not_paid_yet`, `in_progress`, `failed` or `reversed`.

The server only accepts Paystack keys that start with `sk_test_`. Any other key returns `PAYMENTS_MISCONFIGURED`.

## Prerequisites

- Node.js 22.18 or later, and pnpm
- The Cloudflare CLI: `pnpm add -g cf`, then `cf auth login`
- A Paystack account with a **test** secret key (Settings → API Keys & Webhooks)

## Run locally

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Create `.dev.vars` from the example. The file is gitignored.

   ```sh
   cp .dev.vars.example .dev.vars
   ```

   Set `MCP_BEARER_TOKEN` to the output of `openssl rand -hex 32`. Set `PAYSTACK_SECRET_KEY` to your `sk_test_…` key.

3. Create the local orders table:

   ```sh
   pnpm db:migrate:local
   ```

4. Start the dev server at `http://localhost:5173`:

   ```sh
   pnpm dev
   ```

5. In a second terminal, run the end-to-end test:

   ```sh
   pnpm smoke
   ```

   It checks auth, lists the tools, triggers the validation errors, quotes an order, creates it with a real Paystack test link, confirms that a repeat `create_order` returns the same order, and checks the payment. `pnpm smoke call <tool> '<json>'` calls any single tool. To test a paid order, open the printed link, choose **Success** on Paystack's test checkout, then run `pnpm smoke status JT-XXXXXX`.

Unit tests, the type check, and Ultracite (oxlint and oxfmt):

```sh
pnpm test
pnpm typecheck
pnpm check   # lint and format check
pnpm fix     # apply fixes and format
```

Imports inside `src/` use the `@/` alias (`@/catalog` resolves to `src/catalog.ts`), set once in `tsconfig.json` `paths`. Vite reads it through `resolve.tsconfigPaths`, and `tsx` reads it for `scripts/` and `test/`.

## Deploy

The Worker is published at `https://chord.taqib.dev`, a custom domain declared in `cloudflare.config.ts`.

1. Create the D1 database once. Put its ID in `cloudflare.config.ts` and in the `db:migrate:*` scripts.

   ```sh
   cf d1 create --name juicetrybe-orders
   ```

2. Apply migrations to the remote database:

   ```sh
   pnpm db:migrate:remote
   ```

3. Deploy and upload the secrets from `.dev.vars`:

   ```sh
   cf deploy --secrets-file .dev.vars
   ```

   Later deploys keep the secrets, so `pnpm deploy` is enough. To rotate one secret, run `npx wrangler secret put PAYSTACK_SECRET_KEY --name juicetrybe-orders`.

4. Check production:

   ```sh
   MCP_URL=https://chord.taqib.dev/mcp pnpm smoke
   ```

## Connect to Chord

1. **Register the MCP server.** In Chord, go to Admin → Channels & Tools → Tools → Custom tools (MCP) → Add server. Set the URL to `https://chord.taqib.dev/mcp`, the auth type to `bearer`, the auth token to your `MCP_BEARER_TOKEN`, and the transport to `streamable_http`. With the API, use `POST /v1/workspaces/{workspace_id}/mcp-servers`.
2. **Check it.** `POST .../mcp-servers/{id}/health` should return `"status": "ok"`. `POST .../mcp-servers/{id}/tools` should list the four tools.
3. **Create the teammate.** Go to Team → Create a teammate and upload a ZIP of the **contents** of `skill/`:

   ```sh
   cd skill && zip -r ../juicetrybe-skill.zip SKILL.md references
   ```

   Zipping the `skill` folder itself prefixes every path with `skill/`, and then `references/menu.md` no longer matches. Set autonomy to **Act independently** so the teammate replies to customers itself.

4. **Limit the teammate's tools.** Restrict the teammate to this server with `PUT /v1/teammates/{id}` and the body `{"set_mcp_server_ids": ["mcp-…"]}`.
5. **Set the escalation email.** Open the teammate's settings (gear icon) → Behavior → Escalation → "Notify this inbox on escalation", then save. With the API, use `PUT /v1/teammates/{id}/escalation-notifications` with `{"notify_to": "owner@example.com", "workspace_id": "ws-…"}`.
6. **Test.** Open the WhatsApp Simulator chat link (chat.tsglabs.dev). Each browser gets its own conversation. Ask for "2 zobo 50cl and 1 small chops pack to Jabi", confirm, pay the link with Paystack's **Success** test option, then say you've paid. The in-app chat in Chord works too, but it keeps one shared history for you.

## Change the menu

Edit `MENU` and `DELIVERY_AREAS` in `src/catalog.ts`. Then run `pnpm menu:gen` to regenerate `skill/references/menu.md`, deploy the Worker, and republish the skill in Chord. `pnpm test` fails if the skill's menu no longer matches the catalog.

## How AI tools were used

This project was built in pair-programming sessions with Claude Code (Claude Opus). Claude read the Chord docs (build a teammate, skill files, MCP connections, escalation) and Paystack's official OpenAPI spec before writing code. It scaffolded the project with `cf init` and wrote the Worker, tools, tests and skill. It deployed with the `cf` CLI, and registered the MCP server and created the teammate in the Chord app through the in-app browser. Then it tested the full flow in Chord's test chat with Paystack test payments.

I chose the business, the stack and the scope. Claude found several bugs by running the real flow, not by reading the code: a wrong argument name, an inaccurate unpaid message, and duplicate orders caused by Chord dropping tool results between messages. The Chord problems are in `FIELD_NOTES.md`. Claude also drafted this documentation.
