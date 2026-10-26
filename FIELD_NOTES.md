# Field notes

Problems we hit with Chord while building and testing this agent, in order. Times are UTC on 2026-10-26.

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
- **Fix.** The skill now says an earlier reference is real and must be reused with `create_payment_link` or `check_payment_status`. After republishing (skill v3), the next turn reused `JT-J56D6T` correctly. The skill text was not enough on its own (see 19:06).
- **For Chord.** Document whether tool calls and results persist across turns. If they don't, keep a compact summary of earlier tool results in history.

## 18:22 `handover_to_human` can't be tested in the in-app chat

- **What happened.** A message asking for an out-of-area office order got the right reply ("I'm passing you to the owner"), but the trace shows no handoff tool call.
- **How we found it.** The escalation guide says `handover_to_human` is offered "only on thread-bound turns, meaning conversations that arrived on a channel". The in-app direct line is not one.
- **Fix.** The skill tells the teammate to send the handoff message even when the tool is missing. Verified later through the WhatsApp Simulator (see 18:58).
- **For Chord.** Offer the handoff tool in the in-app test chat, perhaps as a simulated takeover, so builders can test escalation before connecting WhatsApp.

## 18:24 MCP guide doesn't say which Accept header Chord sends

- **What happened.** The guide says Chord "sends JSON POST requests and accepts JSON or SSE responses" but doesn't name the `Accept` header. The official MCP SDK transport returns `406 Not Acceptable: Client must accept both application/json and text/event-stream` unless both types are present, so we couldn't tell whether it would work.
- **How we found it.** We used `@hono/mcp`, which accepts either, then logged real requests. Chord sends `POST` with `Accept: application/json, text/event-stream` and `User-Agent: Java-http-client/23.0.2`.
- **Fix.** No change needed. Either transport works.
- **For Chord.** Put the exact request headers in the MCP guide.

## 18:50 New in-app conversation still knew the test customer

- **What happened.** A "New conversation" in the teammate's in-app chat answered "What can you help me with?" by mentioning "your Jabi order" and "your Lekki office request". Both came from earlier tests where we played a made-up customer, Amaka.
- **How we found it.** `GET /v1/threads` shows one `direct_line` thread per operator (`channel_session_id` is the teammate ID). It was created at 18:15 and holds every in-app test message. "Learned memory" for the teammate is empty, so this is thread history, not long-term memory.
- **Fix.** None in our code. Test as different customers through the WhatsApp Simulator, where each tester gets their own thread.
- **For Chord.** Make "New conversation" in the in-app chat start a fresh thread, or label it as continuing the same history.

## 18:55 Escalation email setting was hard to find

- **What happened.** We couldn't find where to set the email that receives handoffs.
- **How we found it.** It's in the teammate's settings (gear icon) → Behavior (collapsed) → Escalation → "Notify this inbox on escalation". The API is `PUT /v1/teammates/{id}/escalation-notifications` with `notify_to`. `GET` returned `"notify_to": null`, so no email was set.
- **Fix.** Documented the path in README. The owner sets their own address.
- **For Chord.** Show escalation alerts at the top of the teammate settings, and warn when a teammate can hand off but has no notification inbox.

## 18:58 Handoff worked, but the simulator never showed the acknowledgement

- **What happened.** Through the WhatsApp Simulator (chat.tsglabs.dev), a customer asked for 40 bottles for an office party and to speak to the owner. The teammate called `handover_to_human` with the reason "Customer Tunde Test wants 40 bottles of zobo 50cl for an office party in Wuse on Friday (bulk/event order) and asked to speak to the owner. No order created yet." Chord moved the thread to `human_active` and stored a system turn, "One moment — connecting you with a teammate." The simulator still showed "No reply yet. If someone has taken over in Chord, their reply will appear here."
- **How we found it.** `GET /v1/threads/{id}/turns` shows the outbound turn with `metadata.system_event: "handover_acknowledgement"`. The simulator page never rendered it.
- **Fix.** None on our side. Handoff is verified end to end in Chord. The customer-facing acknowledgement is not.
- **For Chord.** Deliver handover acknowledgement turns to external-chat clients, or document that partner apps must poll for system turns.

## 19:06 Duplicate order came back in the simulator

- **What happened.** In a simulator chat, the teammate quoted `JT-7R48KS`. When the customer replied "yes please", it said "The reference I gave you earlier (JT-7R48KS) was wrong because the order hadn't been created yet" and quoted a new reference.
- **How we found it.** D1 showed both orders, identical (Taqib, Kubwa, ₦12,900), created at 19:06:15 and 19:06:45. The first reference was real. The skill rule from 18:19 did not stop the second `create_order` call.
- **Fix.** Moved the guard into the server. `create_order` now returns an identical unpaid order (same name, area and items) from the last 30 minutes instead of creating a new one, with `reused_existing_order: true` and a `next_step` telling the model to keep the original reference. The smoke test checks it. A fresh simulator chat afterwards produced one order (`JT-H2SN5H`) and one link.
- **For Chord.** Same as 18:19: keep earlier tool results visible to the model across turns, or document that they are dropped so tool builders make writes idempotent from the start.
