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

## 2. Handoffs reach neither the customer nor the owner

When the teammate hands a chat to a human, the customer sees nothing and the owner isn't told. The owner of The Juice Trybe hit this in her first test. Her words: "it ignored her".

### What happened

| When | Where | What happened |
| --- | --- | --- |
| 2026-10-26 18:58 | Simulator | A customer asked for 40 bottles for an office party and asked for the owner. The teammate called `handover_to_human` with the reason "Customer Tunde Test wants 40 bottles of zobo 50cl for an office party in Wuse on Friday (bulk/event order) and asked to speak to the owner. No order created yet." The simulator only ever showed "No reply yet. If someone has taken over in Chord, their reply will appear here." No escalation email was set up at that point. |
| 2026-10-27 17:08 | Simulator, the business owner | She asked for delivery to an area we didn't cover yet, then wrote "I still want delivery". The teammate handed off with the reason "Customer Huraira wants drinks delivered to Softlife Apartments, Jahi, which is outside the listed delivery areas…". The simulator showed her no reply, so she wrote "Hello" 17 seconds later. No escalation email arrived at the inbox set the day before, so nobody knew the chat was waiting. |
| 2026-10-27 19:58 | Simulator, our repeat test | To confirm, we asked the teammate "can I speak to the owner please? I want to ask about a birthday party order for Saturday". It handed off within 2 seconds with a correct reason. The simulator again showed only "No reply yet", and Chord again stored only the system acknowledgement. Again, no escalation email arrived. |

![Chord's view of the owner's chat: the AI is paused and the handoff message only appears here, not in the simulator](docs/field-notes/handover-owner-test.png)

The repeat test from both sides. On the left, the customer's screen after asking for the owner shows only "No reply yet". On the right, Chord shows the same chat paused, with the acknowledgement the customer never received.

<p>
  <img src="docs/field-notes/handover-simulator-no-reply.png" alt="Simulator: after asking for the owner, the customer sees only 'No reply yet'" width="56%">
  <img src="docs/field-notes/handover-chord-paused.png" alt="Chord: the same chat is paused and shows 'One moment — connecting you with a teammate.'" width="40%">
</p>

### How we found it

- **Thread turns.** In `GET /v1/threads/{id}/turns`, the only outbound turn after "I still want delivery" is a system turn: `"sender": {"kind": "system"}`, `metadata.system_event: "handover_acknowledgement"`, text "One moment — connecting you with a teammate.", `delivery_status: "sent"`. The simulator never displayed it.
- **No message from the teammate.** The skill tells the teammate to tell the customer it is passing them to the owner, then call `handover_to_human`. None of the three handoffs contains that message. Either the model's reply is dropped when it hands off, or it is never generated. We can't tell which, because Chord doesn't show the model's output.
- **Email setting.** `GET /v1/teammates/{id}/escalation-notifications` returns `{"notify_to": "hi@taqib.dev"}`. The settings page says "Every escalation also sends an email to this support inbox." Both of the last two threads show `control_state: "human_active"` with `last_handoff_at` set, so Chord counted them as escalations, but no email arrived for either, in the inbox or in spam. There is no API or screen to check whether Chord tried to send it.

### Fix

None on our side. The handoff works inside Chord: the thread moves to Escalated, the AI pauses, and the owner can reply from Chord. The owner only finds it by opening Chord, though, and the customer is left waiting with no reply.

### What we'd change in Chord

- **Show handoffs to the customer.** Deliver the handover acknowledgement to external-chat apps like the simulator, and keep the teammate's own message when it calls `handover_to_human`.
- **Send the escalation email**, and show a delivery log for it (sent, bounced, last sent at) next to the setting, with a "send test email" button.
- **Make the setting findable.** The inbox field sits in the right-hand Settings panel, under a collapsed Behavior section. The gear icon next to it opens a different Settings window. Until we found it, `notify_to` was `null`, so handoffs would have reached nobody. Warn when a teammate can hand off but has no inbox set.
- **Let builders test handoffs in the in-app chat.** `handover_to_human` is only offered "on thread-bound turns", so we couldn't test any of this before connecting the simulator.

## 3. Zipping the skill folder broke the reference path

- **What happened.** Uploading `zip -r skill.zip skill` stored the files as `skill/SKILL.md` and `skill/references/menu.md`. SKILL.md tells the model to read `references/menu.md`, and the docs say "the path in the instructions must match the uploaded file".
- **How we found it.** The "Review your source material" dialog lists the stored paths.
- **Fix.** We zipped from inside the folder instead (`cd skill && zip -r ../skill.zip SKILL.md references`).
- **What we'd change in Chord.** Strip a single shared top-level folder from ZIP uploads, or warn when a file path named in the instructions isn't in the package.

## 4. "New conversation" in the in-app chat kept the old history

- **What happened.** A new conversation in Chord's in-app chat greeted us with "your Jabi order" and "your Lekki office request" from earlier tests.
- **How we found it.** `GET /v1/threads` shows one `direct_line` thread per operator, holding every in-app message. The teammate's learned memory was empty, so memory wasn't the cause.
- **Fix.** We tested with the WhatsApp Simulator instead, which gives each browser its own thread.
- **What we'd change in Chord.** Make "New conversation" start a fresh thread, or label it as a continuation.
