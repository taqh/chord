import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { Result } from "@/catalog";
import { checkPaymentStatus, createOrder, createPaymentLink } from "@/orders";

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

const orderReference = z
  .string()
  .min(1)
  .describe(
    'Order reference returned by create_order, for example "JT-7K3QF2".'
  );

export const createMcpServer = (): McpServer => {
  const server = new McpServer({ name: "juicetrybe-orders", version: "1.0.0" });

  server.registerTool(
    "create_order",
    {
      annotations: {
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Create a drinks and snacks order after the customer has told you what they want, their name and their delivery area. " +
        "Validates every item against the menu and the delivery area against the delivery list, then saves the order. " +
        "Returns the order reference, line items, delivery fee and total in naira (NGN). " +
        "On failure returns ok:false with an error code (EMPTY_ORDER, UNKNOWN_ITEM, INVALID_QUANTITY, UNKNOWN_DELIVERY_AREA) and the valid options.",
      inputSchema: {
        customer_name: z
          .string()
          .min(1)
          .describe("Customer's name as they gave it."),
        delivery_area: z
          .string()
          .min(1)
          .describe(
            'Delivery area in Abuja, for example "Wuse" or "Gwarinpa".'
          ),
        items: z
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
          .describe("Everything the customer wants in this order."),
      },
      title: "Create order",
    },
    (args) =>
      respond(
        () => createOrder(args),
        (order) =>
          order.reused_existing_order
            ? `This order already exists as ${order.reference}, created earlier in this chat. Keep using ${order.reference}. Do not tell the customer an earlier reference was wrong. If they already confirmed, call create_payment_link with ${order.reference}.`
            : `Read the items, delivery fee and total of ₦${order.total_ngn.toLocaleString("en-NG")} back to the customer. Only after they confirm, call create_payment_link with reference ${order.reference}.`
      )
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
        "Create a Paystack payment link (TEST mode) for a confirmed order. Call only after the customer has confirmed the order summary. " +
        "Calling it again for the same unpaid order returns the same link. " +
        "On failure returns ok:false with an error code (ORDER_NOT_FOUND, ORDER_ALREADY_PAID, PAYMENT_PROVIDER_UNAVAILABLE, PAYMENT_PROVIDER_EMPTY_RESPONSE, PAYMENT_PROVIDER_REJECTED, PAYMENTS_MISCONFIGURED), plus retryable and handoff_to_owner flags.",
      inputSchema: {
        customer_email: z
          .email()
          .optional()
          .describe(
            "Customer's email for the Paystack receipt. Only pass it if the customer offered one."
          ),
        order_reference: orderReference,
      },
      title: "Create payment link",
    },
    ({ order_reference, customer_email }) =>
      respond(
        () => createPaymentLink(order_reference, customer_email),
        (order) =>
          `Send the customer this link to pay ₦${order.total_ngn.toLocaleString("en-NG")}: ${order.payment_url} . Ask them to tell you once they have paid, then call check_payment_status.`
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
