# Field notes

Real problems hit while building and deploying this agent, in order. Times are UTC on 2026-10-26. Times marked `~` are approximate.

## ~17:50 Paystack docs block scripted reads

- **What happened.** Fetching `https://paystack.com/docs/api/transaction/` returned `HTTP 403 Forbidden`, both through the agent's web fetch and through `curl` with a browser user agent.
- **How we found it.** The 403 came back on the first request.
- **Fix.** Read Paystack's official OpenAPI spec instead (`PaystackOSS/openapi`, `dist/paystack.yaml`). It covers `POST /transaction/initialize` (`email` and `amount` in kobo are required) and `GET /transaction/verify/{reference}`.
- **For Chord.** Nothing in Chord. A note in Chord's MCP guide on where to find machine-readable docs for common Nigerian APIs would save a step.

## ~17:55 `cf init worker` rejected the directory name

- **What happened.** `cf init worker` failed with `Did you mean workers?`. The global `cf` was `1.0.0-beta.1`, and on that version `cf init` failed with `Did you mean intel?`.
- **How we found it.** The help text says "Use ./workers to initialize a directory named workers". `./worker` still failed. `cf init workers ./worker` worked.
- **Fix.** Upgraded the global CLI to `cf@1.0.0-beta.23`, then initialised in the repo root.
- **For Chord.** Not Chord. Cloudflare's `cf` beta treats a directory name as a typo of a subcommand.

## 18:06 Local D1 had no tables after a successful migration

- **What happened.** `cf d1 migrations apply <id> --local` reported `0001_orders.sql ✅`, but the dev server failed with `D1_ERROR: no such table: orders: SQLITE_ERROR`.
- **How we found it.** The tool error in the dev log, then `find` for `.sqlite` files. `cf dev` (Vite plugin) stores state in `./.cloudflare/state`, while `cf d1 ... --local` defaults to `~/.config/cloudflare/state`.
- **Fix.** `pnpm db:migrate:local` passes `--persist-to .cloudflare/state`.
- **For Chord.** Not Chord. Related: `cf d1 migrations apply` takes only a database ID, and `cf deploy` auto-provisions D1 without writing the ID back. We created the database first and pinned its ID in `cloudflare.config.ts`.

## 18:07 Deploy output lists secrets as "Environment Variable"

- **What happened.** `cf deploy --secrets-file .dev.vars` printed `env.PAYSTACK_SECRET_KEY ("(hidden)")  Environment Variable`.
- **How we found it.** `cf workers secrets list --worker juicetrybe-orders` shows both as `secret_text`, so they are stored as secrets.
- **Fix.** None needed.
- **For Chord.** Not Chord.

## ~18:08 New custom domain did not resolve locally

- **What happened.** Right after deploy, `node` failed with `getaddrinfo ENOTFOUND chord.taqib.dev`. `dig @1.1.1.1` already returned Cloudflare IPs.
- **How we found it.** We had probed the hostname before the record existed, so the Mac's resolver cached the negative answer. `dscacheutil -flushcache` did not clear it.
- **Fix.** Ran the production smoke test with a DNS-pinning preload (`node --import pin-dns.mjs`). Chord was not affected.
- **For Chord.** Not Chord. Registration correctly says it does not check reachability. The health probe is the right first check.

## 18:12 ZIP upload kept the folder prefix, which breaks reference paths

- **What happened.** Uploading `zip -r x.zip skill` showed the files as `skill/SKILL.md` and `skill/references/menu.md`. SKILL.md tells the model to read `references/menu.md`, and the docs say "the path in the instructions must match the uploaded file".
- **How we found it.** The "Review your source material" dialog lists the stored paths.
- **Fix.** Zip from inside the folder (`cd skill && zip -r ../x.zip SKILL.md references`). The paths became `SKILL.md` and `references/menu.md`.
- **For Chord.** Strip a single shared top-level folder from ZIPs, or warn when a path named in the instructions does not exist in the package.

## 18:13 Skill created as "Untitled skill" despite frontmatter `name`

- **What happened.** The review page and the Skills panel named the skill "Untitled skill", although SKILL.md has `name: juicetrybe-orders` in its frontmatter.
- **How we found it.** Visible in the UI, and `GET /v1/teammates/{id}/skills` returned `"name": "Untitled skill"`.
- **Fix.** Saved a draft through the Skills API with `"name": "juicetrybe-orders"` and published it.
- **For Chord.** Default the skill name to the frontmatter `name` when the create-from-files flow sets none.

## 18:15 First tool call failed on an argument name

- **What happened.** Chord's "How I did this" trace showed `MCP error -32602: Input validation error: Invalid arguments for tool create_order: Invalid input: expected string, received undefined at items[0].item`. The model retried and succeeded.
- **How we found it.** The per-reply trace in the Chord test chat. This was our bug. The schema asked for `item`, and the model sent some other key. The trace doesn't show the arguments, but `item_id` is the likely guess, since the menu's column is "Item id".
- **Fix.** Renamed the field to `item_id` in the tool schema, the skill and the menu text.
- **For Chord.** The trace made this a one-minute fix. Showing the failed tool call's arguments next to the error would make it faster still.

## 18:19 Second turn re-created the order

- **What happened.** After the customer said "Yes please, send the link", the teammate replied "the reference I gave (JT-37DN8S) was not real" and called `create_order` again (new reference `JT-J56D6T`). That would have left a duplicate order.
- **How we found it.** The reply text and the trace (`create_order` instead of `create_payment_link`).
- **Cause (inferred).** Tool results from earlier turns don't seem to reach the model's history in the in-app chat, so it could not see its own earlier `create_order` result. We could not confirm this from stored data.
- **Fix.** The skill now says an earlier reference is real and must be reused with `create_payment_link` or `check_payment_status`. After republishing (skill v3), the next turn reused `JT-J56D6T` correctly.
- **For Chord.** Document whether tool calls and results persist across turns. If they don't, keep a compact summary of earlier tool results in history.

## 18:22 `handover_to_human` can't be tested in the in-app chat

- **What happened.** A message asking for an out-of-area office order got the right reply ("I'm passing you to the owner"), but the trace shows no handoff tool call.
- **How we found it.** The escalation guide says `handover_to_human` is offered "only on thread-bound turns, meaning conversations that arrived on a channel". The in-app direct line is not one.
- **Fix.** The skill tells the teammate to send the handoff message even when the tool is missing. A real handoff is still unverified until a channel is connected.
- **For Chord.** Offer the handoff tool in the in-app test chat, perhaps as a simulated takeover, so builders can test escalation before connecting WhatsApp.

## 18:24 MCP guide doesn't say which Accept header Chord sends

- **What happened.** The guide says Chord "sends JSON POST requests and accepts JSON or SSE responses" but doesn't name the `Accept` header. The official MCP SDK transport returns `406 Not Acceptable: Client must accept both application/json and text/event-stream` unless both types are present, so we couldn't tell whether it would work.
- **How we found it.** We used `@hono/mcp`, which accepts either, then logged real requests. Chord sends `POST` with `Accept: application/json, text/event-stream` and `User-Agent: Java-http-client/23.0.2`.
- **Fix.** No change needed. Either transport works.
- **For Chord.** Put the exact request headers in the MCP guide.
