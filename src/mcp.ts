import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { Result } from "@/catalog";
import {
  checkPaymentStatus,
  createOrder,
  createPaymentLink,
  quoteOrder,
} from "@/orders";
import type { PlacedOrder } from "@/orders";

const respond = async <T extends object>(
  run: () => Promise<Result<T>>,
  nextStep: (value: T) => string
): Promise<CallToolResult> => {
  let result: Result<T>;

  try {
    result = await run();
  } catch (error) {
    console.error("tool crashed", error);
    result = {
      error: {
        code: "INTERNAL_ERROR",
        handoff_to_owner: true,
        message:
          "Something went wrong on our side. Apologise, do not retry, and hand off to the owner.",
        retryable: false,
      },
      ok: false,
    };
  }

  const payload = result.ok
    ? { ok: true, ...result.value, next_step: nextStep(result.value) }
    : { error: result.error, ok: false };

  return {
    content: [{ text: JSON.stringify(payload, null, 2), type: "text" }],
    isError: !result.ok,
    structuredContent: payload,
  };
};

const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

const orderReference = z
  .string()
  .min(1)
  .describe(
    'Order reference returned by create_order, for example "JT-7K3QF2".'
  );

const orderItems = z
  .array(
    z.object({
      item_id: z
        .string()
        .describe(
          'Menu item id from the menu, for example "zobo-50cl". The exact display name also works.'
        ),
      quantity: z
        .number()
        .describe("How many of this item. Whole number, 1 or more."),
    })
  )
  .describe("Everything the customer wants in this order.");

const deliveryArea = z
  .string()
  .min(1)
  .describe('Delivery area in Abuja, for example "Wuse" or "Gwarinpa".');

const customerEmail = z
  .email()
  .optional()
  .describe(
    "Customer's email for the Paystack receipt. Only pass it if the customer gave one."
  );

const placedNextStep = (order: PlacedOrder): string => {
  if (order.status === "paid") {
    return `An identical order, ${order.reference}, is already paid. Tell the customer it is paid and the owner will arrange delivery. Do not create another order. If they want a second identical order, hand off to the owner.`;
  }

  const send = `Send the customer the order reference ${order.reference} and this Paystack test link to pay ${naira(order.total_ngn)}: ${order.payment_url} . When they say they have paid, call check_payment_status with ${order.reference}.`;

  return order.reused_existing_order
    ? `This is the order already placed earlier in this chat. ${send} Do not say any earlier reference or link was wrong.`
    : send;
};

export const createMcpServer = (): McpServer => {
  const server = new McpServer({ name: "juicetrybe-orders", version: "2.0.0" });

  server.registerTool(
    "quote_order",
    {
      annotations: {
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description:
        "Price an order before the customer confirms it. Checks every item against the menu and the delivery area against the delivery list. " +
        "Saves nothing and creates no reference, so it is safe to call as often as needed. " +
        "Returns the line items, delivery fee and total in naira (NGN). " +
        "On failure returns ok:false with an error code (EMPTY_ORDER, UNKNOWN_ITEM, INVALID_QUANTITY, UNKNOWN_DELIVERY_AREA) and the valid options.",
      inputSchema: { delivery_area: deliveryArea, items: orderItems },
      title: "Quote order",
    },
    (args) =>
      respond(
        () => quoteOrder(args),
        (quote) =>
          `Read the items, delivery fee and total of ${naira(quote.total_ngn)} back to the customer. There is no order reference yet, so do not mention one. When they confirm and you have their name, call create_order with the same items and area.`
      )
  );

  server.registerTool(
    "create_order",
    {
      annotations: {
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Place a confirmed order and create its Paystack payment link (TEST mode) in one step. Call only after the customer has confirmed the quote. " +
        "Returns the order reference, line items, total and payment_url. " +
        "Calling it again with the same name, area and items returns the same order and link instead of a duplicate, and says so if that order is already paid. " +
        "On failure returns ok:false with an error code (EMPTY_ORDER, UNKNOWN_ITEM, INVALID_QUANTITY, UNKNOWN_DELIVERY_AREA, PAYMENT_PROVIDER_UNAVAILABLE, PAYMENT_PROVIDER_EMPTY_RESPONSE, PAYMENT_PROVIDER_REJECTED, PAYMENTS_MISCONFIGURED), plus retryable and handoff_to_owner flags.",
      inputSchema: {
        customer_email: customerEmail,
        customer_name: z
          .string()
          .min(1)
          .describe("Customer's name as they gave it."),
        delivery_area: deliveryArea,
        items: orderItems,
      },
      title: "Create order",
    },
    ({ customer_email, ...request }) =>
      respond(() => createOrder(request, customer_email), placedNextStep)
  );

  server.registerTool(
    "create_payment_link",
    {
      annotations: {
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Get the Paystack payment link (TEST mode) for an existing order, for example when the customer asks for the link again. create_order already returns the link, so this is rarely needed. " +
        "Returns the same link every time for an unpaid order. " +
        "On failure returns ok:false with an error code (ORDER_NOT_FOUND, ORDER_ALREADY_PAID, PAYMENT_PROVIDER_UNAVAILABLE, PAYMENT_PROVIDER_EMPTY_RESPONSE, PAYMENT_PROVIDER_REJECTED, PAYMENTS_MISCONFIGURED), plus retryable and handoff_to_owner flags.",
      inputSchema: {
        customer_email: customerEmail,
        order_reference: orderReference,
      },
      title: "Create payment link",
    },
    ({ order_reference, customer_email }) =>
      respond(
        () => createPaymentLink(order_reference, customer_email),
        (order) =>
          `Send the customer this link to pay ${naira(order.total_ngn)}: ${order.payment_url} . When they say they have paid, call check_payment_status with ${order.reference}.`
      )
  );

  server.registerTool(
    "check_payment_status",
    {
      annotations: {
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Check with Paystack whether an order has been paid. Use when the customer says they have paid or asks about their order. " +
        "Returns paid true/false and payment_status (paid, not_paid_yet, in_progress, failed, reversed) with a message saying what to tell the customer. " +
        "An unpaid order is a normal result, not an error. Never tell the customer an order is paid unless paid is true.",
      inputSchema: { order_reference: orderReference },
      title: "Check payment status",
    },
    ({ order_reference }) =>
      respond(
        () => checkPaymentStatus(order_reference),
        (check) => check.message
      )
  );

  return server;
};
