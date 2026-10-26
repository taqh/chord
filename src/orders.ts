import { env } from "cloudflare:workers";

import { fail, ok, priceOrder } from "@/catalog";
import type { OrderLine, OrderRequest, PricedOrder, Result } from "@/catalog";
import { initializeTransaction, verifyTransaction } from "@/paystack";
import type { PaystackTransactionStatus } from "@/paystack";

export type OrderStatus = "awaiting_payment" | "paid";

export type Order = PricedOrder & {
  reference: string;
  status: OrderStatus;
  payment_url: string | null;
  paid_at: string | null;
  created_at: string;
};

type OrderRow = Omit<Order, "lines"> & { lines_json: string };

export interface PaymentCheck {
  reference: string;
  paid: boolean;
  payment_status:
    | "paid"
    | "not_paid_yet"
    | "in_progress"
    | "failed"
    | "reversed";
  paystack_status: PaystackTransactionStatus | "not_started" | null;
  total_ngn: number;
  paid_at: string | null;
  message: string;
}

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

const newReference = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));

  return `JT-${Array.from(bytes, (b) => REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length]).join("")}`;
};

const fromRow = ({ lines_json, ...row }: OrderRow): Order => ({
  ...row,
  // SAFETY: lines_json is only written by createOrder, from a typed OrderLine[].
  lines: JSON.parse(lines_json) as OrderLine[],
});

const loadOrder = async (reference: string): Promise<Result<Order>> => {
  const row = await env.DB.prepare("SELECT * FROM orders WHERE reference = ?")
    .bind(reference.trim().toUpperCase())
    .first<OrderRow>();

  if (!row) {
    return fail({
      code: "ORDER_NOT_FOUND",
      handoff_to_owner: false,
      message: `No order with reference "${reference}". Check the reference with the customer, or create the order first.`,
      retryable: false,
    });
  }

  return ok(fromRow(row));
};

// Chord's model can lose sight of an earlier create_order result and call it
// again for the same order, so an identical unpaid order is returned instead.
const findRecentDuplicate = async (
  priced: PricedOrder
): Promise<Order | null> => {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();

  const row = await env.DB.prepare(
    `SELECT * FROM orders
     WHERE status = 'awaiting_payment' AND lower(customer_name) = lower(?)
       AND delivery_area = ? AND lines_json = ? AND created_at > ?
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(
      priced.customer_name,
      priced.delivery_area,
      JSON.stringify(priced.lines),
      since
    )
    .first<OrderRow>();

  return row ? fromRow(row) : null;
};

export const createOrder = async (
  request: OrderRequest
): Promise<Result<Order & { reused_existing_order: boolean }>> => {
  const priced = priceOrder(request);

  if (!priced.ok) {
    return priced;
  }

  const duplicate = await findRecentDuplicate(priced.value);

  if (duplicate) {
    return ok({ ...duplicate, reused_existing_order: true });
  }

  const order: Order = {
    ...priced.value,
    created_at: new Date().toISOString(),
    paid_at: null,
    payment_url: null,
    reference: newReference(),
    status: "awaiting_payment",
  };

  await env.DB.prepare(
    `INSERT INTO orders (reference, customer_name, delivery_area, lines_json, subtotal_ngn, delivery_fee_ngn, total_ngn, status, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      order.reference,
      order.customer_name,
      order.delivery_area,
      JSON.stringify(order.lines),
      order.subtotal_ngn,
      order.delivery_fee_ngn,
      order.total_ngn,
      order.status,
      order.created_at
    )
    .run();

  return ok({ ...order, reused_existing_order: false });
};

export const createPaymentLink = async (
  reference: string,
  customerEmail?: string
): Promise<Result<Order & { payment_url: string }>> => {
  const loaded = await loadOrder(reference);

  if (!loaded.ok) {
    return loaded;
  }

  const order = loaded.value;

  if (order.status === "paid") {
    return fail({
      code: "ORDER_ALREADY_PAID",
      handoff_to_owner: false,
      message: `Order ${order.reference} is already paid. No new link is needed.`,
      retryable: false,
    });
  }

  // Paystack rejects a reused reference, so an order keeps the link it was first given.
  if (order.payment_url) {
    return ok({ ...order, payment_url: order.payment_url });
  }

  const initialized = await initializeTransaction(env.PAYSTACK_SECRET_KEY, {
    amountKobo: order.total_ngn * 100,
    callbackUrl: `${env.PUBLIC_URL}/payment/return`,
    // Paystack requires an email. Customers on WhatsApp rarely give one, so fall back to a per-order address.
    email:
      customerEmail ??
      `${order.reference.toLowerCase()}@orders.chord.taqib.dev`,
    metadata: {
      customer_name: order.customer_name,
      delivery_area: order.delivery_area,
      lines: order.lines,
    },
    reference: order.reference,
  });

  if (!initialized.ok) {
    return initialized;
  }

  const paymentUrl = initialized.value.authorization_url;
  await env.DB.prepare("UPDATE orders SET payment_url = ? WHERE reference = ?")
    .bind(paymentUrl, order.reference)
    .run();

  return ok({ ...order, payment_url: paymentUrl });
};

export const checkPaymentStatus = async (
  reference: string
): Promise<Result<PaymentCheck>> => {
  const loaded = await loadOrder(reference);

  if (!loaded.ok) {
    return loaded;
  }

  const order = loaded.value;

  const check = (
    fields: Omit<PaymentCheck, "reference" | "total_ngn" | "paid_at">
  ): PaymentCheck => ({
    paid_at: order.paid_at,
    reference: order.reference,
    total_ngn: order.total_ngn,
    ...fields,
  });

  if (order.status === "paid") {
    return ok(
      check({
        message:
          "Paid. Confirm to the customer and tell them the owner will arrange delivery.",
        paid: true,
        payment_status: "paid",
        paystack_status: "success",
      })
    );
  }

  if (!order.payment_url) {
    return fail({
      code: "PAYMENT_LINK_NOT_CREATED",
      handoff_to_owner: false,
      message: `Order ${order.reference} has no payment link yet. Call create_payment_link first.`,
      retryable: false,
    });
  }

  const verified = await verifyTransaction(
    env.PAYSTACK_SECRET_KEY,
    order.reference
  );

  if (!verified.ok) {
    return verified;
  }

  const tx = verified.value;

  if (!tx.found) {
    return ok(
      check({
        message:
          "Not paid yet. The customer has not started checkout. Resend the same payment link.",
        paid: false,
        payment_status: "not_paid_yet",
        paystack_status: "not_started",
      })
    );
  }

  switch (tx.status) {
    case "success": {
      if (tx.amount_kobo !== order.total_ngn * 100 || tx.currency !== "NGN") {
        return fail({
          code: "PAYMENT_AMOUNT_MISMATCH",
          details: {
            currency: tx.currency,
            expected_kobo: order.total_ngn * 100,
            paid_kobo: tx.amount_kobo,
          },
          handoff_to_owner: true,
          message:
            "Paystack shows a payment that does not match the order total. Do not confirm the order. Hand off to the owner.",
          retryable: false,
        });
      }

      const paidAt = tx.paid_at ?? new Date().toISOString();
      await env.DB.prepare(
        "UPDATE orders SET status = 'paid', paid_at = ? WHERE reference = ?"
      )
        .bind(paidAt, order.reference)
        .run();

      return ok({
        ...check({
          message:
            "Paid. Confirm to the customer and tell them the owner will arrange delivery.",
          paid: true,
          payment_status: "paid",
          paystack_status: tx.status,
        }),
        paid_at: paidAt,
      });
    }

    case "abandoned": {
      return ok(
        check({
          message:
            "Not paid yet. Checkout has not been completed. Resend the same payment link.",
          paid: false,
          payment_status: "not_paid_yet",
          paystack_status: tx.status,
        })
      );
    }

    case "ongoing":
    case "pending":
    case "processing":
    case "queued": {
      return ok(
        check({
          message:
            "Payment is still processing at Paystack. Ask the customer to wait a minute, then check again.",
          paid: false,
          payment_status: "in_progress",
          paystack_status: tx.status,
        })
      );
    }

    case "failed": {
      return ok(
        check({
          message: `The payment attempt failed (${tx.gateway_response ?? "no reason given"}). Ask the customer to try the same link again with another card or bank transfer. If it keeps failing, hand off to the owner.`,
          paid: false,
          payment_status: "failed",
          paystack_status: tx.status,
        })
      );
    }

    case "reversed": {
      return ok(
        check({
          message:
            "The payment was reversed. Do not confirm the order. Hand off to the owner.",
          paid: false,
          payment_status: "reversed",
          paystack_status: tx.status,
        })
      );
    }

    default: {
      console.error("unexpected paystack status", order.reference, tx);

      return ok(
        check({
          message:
            "Paystack returned a status we don't recognise. Do not confirm the order. Hand off to the owner.",
          paid: false,
          payment_status: "in_progress",
          paystack_status: tx.status,
        })
      );
    }
  }
};
