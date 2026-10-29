# Juice Trybe orders

A small Chord teammate that takes drink and snack orders over chat for a seller in Abuja. It confirms each order and sends a Paystack payment link. Chord runs the agent. This repo holds the agent's skill and the MCP server it calls.

Everything runs in Paystack **test mode**. The menu prices and all customer data are made up.

![Architecture: the customer chats with the Chord teammate, which calls four tools on the MCP server at chord.taqib.dev/mcp. The server stores orders in Cloudflare D1 and creates and verifies Paystack test payments, and the teammate hands off to the owner by email when it can't help. Below, an order flows through quote_order, create_order, Paystack checkout and check_payment_status, with create_payment_link resending the link on request.](docs/architecture.png)

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
| `quote_order` | Checks each `item_id` against the menu and the area against the delivery list, and returns the line items, delivery fee and total in naira. Saves nothing and creates no reference. |
| `create_order` | Used once the customer confirms. Saves the order, calls Paystack `POST /transaction/initialize` in test mode, and returns the reference (such as `JT-7K3QF2`) together with the checkout URL. Calling it again with the same name, area and items within 30 minutes returns the same order and link, or says the order is already paid. |
| `create_payment_link` | Resends the checkout URL for an existing order. Always returns the same link for an unpaid order. |
| `check_payment_status` | Calls Paystack `GET /transaction/verify/{reference}`. Marks the order paid only on `success` with a matching amount and currency. |

The tools are split this way because Chord doesn't carry tool results into later messages. See section 1 of `FIELD_NOTES.md`.

Failures return an `error.code`, a `message` that tells the agent what to say, and `retryable` and `handoff_to_owner` flags. An unpaid order isn't an error: `check_payment_status` returns `paid: false` with a reason.

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

   It runs the full order flow against a real Paystack test link. To test a paid order, open the printed link, choose **Success** on Paystack's test checkout, then run `pnpm smoke status JT-XXXXXX`.

Unit tests, the type check, and Ultracite (oxlint and oxfmt):

```sh
pnpm test
pnpm typecheck
pnpm check   # lint and format check
pnpm fix     # apply fixes and format
```

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

1. **Register the MCP server.** In Chord, go to Admin → Channels & Tools → Tools → Custom tools (MCP) → Add server. Set the URL to `https://chord.taqib.dev/mcp`, the auth type to `bearer`, the auth token to your `MCP_BEARER_TOKEN`, and the transport to `streamable_http`.
2. **Create the teammate.** Go to Team → Create a teammate and upload a ZIP of the **contents** of `skill/`:

   ```sh
   cd skill && zip -r ../juicetrybe-skill.zip SKILL.md references
   ```

   Zipping the `skill` folder itself prefixes every path with `skill/`, and then `references/menu.md` no longer matches. Set autonomy to **Act independently** so the teammate replies to customers itself.

3. **Set the escalation email.** Enter the owner's inbox under Behavior → Escalation in the teammate's Settings panel. It's hard to find, so see section 4 of `FIELD_NOTES.md` for where it is.
4. **Test.** Open the WhatsApp Simulator chat link (chat.tsglabs.dev). Each browser gets its own conversation. Ask for "2 zobo 50cl and 1 small chops pack to Jabi", confirm, pay the link with Paystack's **Success** test option, then say you've paid. The in-app chat in Chord works too, but it keeps one shared history for you.

## Change the menu

Edit `MENU` and `DELIVERY_AREAS` in `src/catalog.ts`. Then run `pnpm menu:gen` to regenerate `skill/references/menu.md`, deploy the Worker, and republish the skill in Chord. `pnpm test` fails if the skill's menu no longer matches the catalog.

## What I'd build next

- **Payment webhooks.** Payments are only checked when the customer says they've paid or Paystack redirects them back, so a customer who pays and closes the tab stays unpaid in our records. A Paystack webhook would fix that, and once Chord can send messages the customer didn't prompt, the teammate could say "payment received" without being asked.
- **Stock.** Nothing stops an order for something that has sold out, so a customer could pay for a drink that isn't there. The owner could tell the teammate "we're out of tigernut today" (or a bigger business could connect its inventory system), and `quote_order` would refuse sold-out items before a payment link exists.
- **Delivery by address.** Areas are a fixed list, with the other names people use for them. Looking up the customer's address or WhatsApp location pin and pricing delivery by distance would cover the whole city.

## How AI tools were used

This project was built in pair-programming sessions with Claude Code (Opus 5.5). Claude read the Chord and Paystack docs, wrote the Worker, tools, tests and skill, deployed it to Cloudflare Workers with the `cf` CLI, and set up the teammate in Chord.

I chose the business, the stack and the scope, and gave Claude the business details the skill is built on: the Instagram page, and the local names people use for delivery areas, like Central Area for Central Business District. Claude found several bugs by running the real flow, and I verified the fixes by running chats in several simulator tabs. I caught one myself: the agent apologised for a "wrong" order reference and created a duplicate order. The Chord problems are listed in `FIELD_NOTES.md`.
