# Field notes

Problems we hit with Chord itself while building and testing this agent, most important first. Times are UTC.

## 1. The teammate forgets its own tool results between messages

This was the biggest problem. On the message after the teammate created an order, it acted as if it had never created it. It called the order reference it had just sent "not real", created duplicate orders, and apologised for messages the customer never saw. It happened in Chord's in-app chat, in the WhatsApp Simulator on a laptop, and on a phone.

### What happened

| When | Where | What the customer saw |
| --- | --- | --- |
| 2026-10-26 18:19 | In-app chat | After "Yes please, send the link": "The prices I quoted earlier happen to match the menu, but the reference I gave (JT-37DN8S) was not real." It then created a second order, JT-J56D6T. |
| 2026-10-26 19:06 | Simulator | After "yes please": "The reference I gave you earlier (JT-7R48KS) was wrong because the order hadn't been created yet." Both orders exist in our database, 30 seconds apart. |
| 2026-10-27 11:18 to 11:37 | Simulator, laptop | After "yes please share me a link": "I need to correct my last message. I said the order wasn't saved, but it was." No such message was ever sent. After "i have paid": "The reference and link I gave you earlier weren't real", with a new reference, JT-7BPHRD. The customer had already paid JT-8R9KYW. Seventeen minutes later it reversed itself again: "I need to correct my last two messages." |
| 2026-10-27 11:31 | Simulator, phone | After "Yes please": "I need to correct my last message. Order JT-KEJDQX was valid all along, and I was wrong to say otherwise." Again, it never said otherwise. |

![Laptop chat: the teammate calls its own reference and link "not real" and issues a new reference](docs/field-notes/turn-memory-taqib-1.png)

![Same chat: the teammate reverses itself a second time](docs/field-notes/turn-memory-taqib-2.png)

![Phone chat: an apology for a message the customer never received](docs/field-notes/turn-memory-musa-phone.png)

### How we found the cause

- **Our database.** The orders table had both orders each time, with identical items and seconds apart. The first reference the teammate called "not real" was real every time.
- **Chord's thread records.** `GET /v1/threads/{id}/turns` lists the tools each reply used (`metadata.tools_used`). In the Musa chat, the reply that showed the order summary called `create_order`. The very next reply, after "Yes please", called `create_order` again before `create_payment_link`. The tool had already run once, and the model ran it again.
- **Not the simulator.** Each browser gets its own Chord thread (`channel_session_id: partner_…`), so different customers never share a conversation. The same pattern appeared on a laptop, on a phone, and in Chord's own in-app chat.
- **Conclusion (inferred).** Earlier tool calls and their results don't seem to reach the model on later messages. The model sees its own earlier message quoting a reference, finds no tool call behind it, and decides it made the reference up. The apologies for unsent messages suggest the model also keeps draft text from within a turn that the customer never receives. We couldn't confirm either point, because Chord doesn't show the model's context. `tools_used` only records each tool's name and `ok`.

### What we tried

1. **Skill text.** Skill v3 added "An order reference you gave earlier in this chat is real." It reduced the problem but didn't stop it (19:06 above).
2. **Server-side guard.** `create_order` returned an identical unpaid order from the last 30 minutes instead of saving a new one. That stopped duplicate rows in the Musa chat, but not the apologies. It also missed the laptop case: the original order was already paid, and the guard only matched unpaid orders.

### What fixed it

We changed the tools so no step depends on the model remembering an earlier tool result:

- **`quote_order` prices without saving.** It creates no reference, so calling it again does no harm.
- **`create_order` places the order and creates the Paystack link in one call.** The customer sees the reference for the first time in the same message as the payment link.
- **Repeat calls are safe.** A second `create_order` for the same order returns the same reference and link. If that order is already paid, the result says so.
- **The skill says it plainly.** Skill v4 tells the model: "You can't see the results of tools you called in earlier messages. A reference, link or total you sent earlier came from a tool and is real."

Afterwards we ran three fresh simulator chats, with 12 customer messages in total. Every chat used `quote_order` while pricing, `create_order` exactly once on "yes", and `check_payment_status` on "I have paid". Each confirmation produced one row in our database, and no reply apologised for anything.

### What we'd change in Chord

- **Keep tool results.** Keep earlier tool calls and their results in the model's context on later messages, at least for recent turns.
- **Or document it.** If dropping them is intentional, say so in "Build a teammate" and "MCP connections", for example: "Tool results are not carried into later messages. Make write tools safe to repeat, and return everything the customer needs in one call." We would have designed the tools this way from day one.
- **Keep unsent drafts out.** Don't keep draft text the customer never received in the model's context.
- **Show arguments and results.** Show tool arguments and results in the thread turns API and the "How I did this" trace for channel conversations. `tools_used` only gives the tool name and `ok`, which made this slow to diagnose.

## 2. The simulator never showed the handoff message

- **What happened.** In the WhatsApp Simulator (2026-10-26 18:58), a customer asked for 40 bottles for an office party and asked to speak to the owner. The teammate correctly called `handover_to_human` with the reason "Customer Tunde Test wants 40 bottles of zobo 50cl for an office party in Wuse on Friday (bulk/event order) and asked to speak to the owner. No order created yet." Chord moved the thread to `human_active` and stored a reply, "One moment — connecting you with a teammate." The simulator only ever showed "No reply yet. If someone has taken over in Chord, their reply will appear here."
- **How we found it.** `GET /v1/threads/{id}/turns` shows the outbound turn with `metadata.system_event: "handover_acknowledgement"`. The simulator never displayed it.
- **Fix.** None possible on our side. The handoff itself works and appears under Escalated in Chord. The customer just never sees the acknowledgement.
- **What we'd change in Chord.** Deliver handover acknowledgements to external-chat apps, or document that partner apps must fetch system turns themselves.

## 3. Zipping the skill folder broke the reference path

- **What happened.** Uploading `zip -r skill.zip skill` stored the files as `skill/SKILL.md` and `skill/references/menu.md`. SKILL.md tells the model to read `references/menu.md`, and the docs say "the path in the instructions must match the uploaded file".
- **How we found it.** The "Review your source material" dialog lists the stored paths.
- **Fix.** We zipped from inside the folder instead (`cd skill && zip -r ../skill.zip SKILL.md references`).
- **What we'd change in Chord.** Strip a single shared top-level folder from ZIP uploads, or warn when a file path named in the instructions isn't in the package.

## 4. Smaller issues

- **The skill was named "Untitled skill".** Creating the teammate from files ignored `name: juicetrybe-orders` in the frontmatter, both in the UI and in `GET /v1/teammates/{id}/skills`. We renamed it through the Skills API. **Change:** default to the frontmatter `name`.
- **The escalation email setting was hard to find.** It sits under teammate settings (gear icon), in the collapsed Behavior section, under Escalation. `GET /v1/teammates/{id}/escalation-notifications` returned `"notify_to": null`, so handoffs would have reached nobody. **Change:** warn when a teammate can hand off but has no notification inbox.
- **"New conversation" in the in-app chat kept the old history.** A new conversation mentioned "your Jabi order" and "your Lekki office request" from earlier tests. `GET /v1/threads` shows one `direct_line` thread per operator holding every in-app message, and the teammate's learned memory was empty. **Change:** make "New conversation" start a fresh thread, or label it as a continuation.
- **The handoff tool isn't offered in the in-app chat.** `handover_to_human` is only offered "on thread-bound turns", so escalation can't be tested before connecting a channel or the simulator. **Change:** offer a simulated takeover in the in-app chat.
- **The MCP guide doesn't name the Accept header Chord sends.** The official MCP SDK transport returns `406 Not Acceptable: Client must accept both application/json and text/event-stream` unless both are present. We logged real requests: Chord sends `Accept: application/json, text/event-stream` with `User-Agent: Java-http-client/23.0.2`, so either transport works. **Change:** list the exact request headers in the MCP guide.
