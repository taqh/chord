# Going live: a note for the owner

**What the assistant does.** It replies to customers in chat. It answers menu and price questions, takes an order (items, the customer's name, delivery area), reads the order and total back, and sends a Paystack payment link once the customer confirms. When the customer says they've paid, it checks with Paystack. It confirms the order only if Paystack says the payment went through. Every order is saved with a reference like `JT-7K3QF2`, so you can match it in your Paystack dashboard.

**What it doesn't do.** It doesn't arrange delivery times or collect the full address. It tells the customer you will message them about that. It doesn't give refunds, discounts or custom orders. It doesn't take bank transfers or accept "I've sent it" without Paystack's confirmation. It doesn't answer allergy questions beyond the menu. It passes these to you: complaints, refunds, bulk, party or office orders, areas outside the list, and anyone who asks for a person.

**What must be true before real customers use it:**

1. **Your real menu.** Prices, sizes, delivery areas, delivery fees and opening hours are placeholders today. We need your confirmed list.
2. **Live Paystack keys.** Your Paystack business must be verified for live payments. Once it is, we switch the assistant from test payments to real ones.
3. **A connected WhatsApp number.** A WhatsApp Business number has to be connected to Chord, usually through Meta's business verification. Instagram DMs need the same kind of connection.
4. **A plan for failed payments.** If a card fails, the assistant asks the customer to retry with the same link or pay by bank transfer inside Paystack. If a payment is reversed or the amount looks wrong, it stops and hands the chat to you. We'll also make orders update by themselves when Paystack confirms a payment, so an order still counts as paid if the customer pays and never comes back to the chat.
5. **Someone who gets alerted.** Set your email in Chord's escalation settings so every handoff reaches you with the transcript. Decide who answers handoffs and how fast. If the ordering system or Paystack stops working, nobody is told today. We'll set up a message to you, by email or WhatsApp, when that happens.
6. **Customer data.** Orders store the customer's name, area and items. Agree how long to keep them, and who can see them.
