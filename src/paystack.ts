import { z } from "zod";

import { fail, ok } from "@/catalog";
import type { OrderLine, Result } from "@/catalog";

// Docs: https://paystack.com/docs/api/transaction/ (initialize + verify).
const PAYSTACK_API = "https://api.paystack.co";
const TIMEOUT_MS = 10_000;
const REFERENCE_NOT_FOUND = /reference not found/iu;

const TRANSACTION_STATUSES = [
  "success",
  "failed",
  "abandoned",
  "ongoing",
  "pending",
  "processing",
  "queued",
  "reversed",
] as const;

const envelopeSchema = z.object({
  data: z.unknown().optional(),
  message: z.string().optional(),
  status: z.boolean().optional(),
});

const initializedSchema = z.object({
  authorization_url: z.string().min(1),
  reference: z.string().min(1),
});

const verifiedSchema = z.object({
  amount: z.number(),
  currency: z.string().default("NGN"),
  gateway_response: z.string().nullish(),
  paid_at: z.string().nullish(),
  status: z
    .enum(TRANSACTION_STATUSES)
    .or(z.string().transform(() => "unknown" as const)),
});

type PaystackEnvelope = z.infer<typeof envelopeSchema>;

export type PaystackTransactionStatus = z.infer<
  typeof verifiedSchema
>["status"];

export type InitializedTransaction = z.infer<typeof initializedSchema>;

export type VerifiedTransaction =
  | { found: false }
  | {
      found: true;
      status: PaystackTransactionStatus;
      amount_kobo: number;
      currency: string;
      paid_at: string | null;
      gateway_response: string | null;
    };

const call = async (
  secretKey: string,
  path: string,
  init: RequestInit = {}
): Promise<Result<{ httpStatus: number; body: PaystackEnvelope }>> => {
  if (!secretKey.startsWith("sk_test_")) {
    return fail({
      code: "PAYMENTS_MISCONFIGURED",
      handoff_to_owner: true,
      message:
        "Payments are not set up with a Paystack test key. Tell the customer the owner will follow up, and hand off.",
      retryable: false,
    });
  }

  let response: Response;

  try {
    response = await fetch(`${PAYSTACK_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error("paystack request failed", path, error);

    return fail({
      code: "PAYMENT_PROVIDER_UNAVAILABLE",
      handoff_to_owner: false,
      message:
        "Could not reach Paystack. Try once more; if it fails again, apologise and hand off to the owner.",
      retryable: true,
    });
  }

  const text = await response.text();

  if (text.trim() === "") {
    console.error("paystack empty body", path, response.status);

    return fail({
      code: "PAYMENT_PROVIDER_EMPTY_RESPONSE",
      details: { http_status: response.status },
      handoff_to_owner: false,
      message:
        "Paystack returned an empty response. Try once more; if it repeats, hand off to the owner.",
      retryable: true,
    });
  }

  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }

  const body = envelopeSchema.safeParse(json);

  if (!body.success) {
    console.error(
      "paystack unreadable body",
      path,
      response.status,
      text.slice(0, 200)
    );

    return fail({
      code: "PAYMENT_PROVIDER_UNAVAILABLE",
      details: { http_status: response.status },
      handoff_to_owner: false,
      message:
        "Paystack returned an unreadable response. Try once more; if it repeats, hand off to the owner.",
      retryable: true,
    });
  }

  return ok({ body: body.data, httpStatus: response.status });
};

const rejected = (
  httpStatus: number,
  body: PaystackEnvelope
): Result<never> => {
  const serverSide = httpStatus >= 500;

  console.error("paystack rejected", httpStatus, body.message);

  return fail({
    code: serverSide
      ? "PAYMENT_PROVIDER_UNAVAILABLE"
      : "PAYMENT_PROVIDER_REJECTED",
    details: {
      http_status: httpStatus,
      paystack_message: body.message ?? null,
    },
    handoff_to_owner: !serverSide,
    message: serverSide
      ? "Paystack is having problems. Try once more; if it fails again, apologise and hand off to the owner."
      : "Paystack refused the request. Do not retry. Apologise and hand off to the owner.",
    retryable: serverSide,
  });
};

const emptyData = (what: string): Result<never> =>
  fail({
    code: "PAYMENT_PROVIDER_EMPTY_RESPONSE",
    handoff_to_owner: false,
    message: `Paystack answered without ${what}. Try once more; if it repeats, hand off to the owner.`,
    retryable: true,
  });

export const initializeTransaction = async (
  secretKey: string,
  input: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl: string;
    metadata: {
      customer_name: string;
      delivery_area: string;
      lines: OrderLine[];
    };
  }
): Promise<Result<InitializedTransaction>> => {
  const result = await call(secretKey, "/transaction/initialize", {
    body: JSON.stringify({
      amount: input.amountKobo,
      callback_url: input.callbackUrl,
      currency: "NGN",
      email: input.email,
      metadata: {
        ...input.metadata,
        // Paystack shows custom_fields on the receipt and the dashboard; other metadata stays hidden.
        custom_fields: [
          {
            display_name: "Items",
            value: input.metadata.lines
              .map((line) => `${line.quantity} x ${line.name}`)
              .join(", "),
            variable_name: "items",
          },
          {
            display_name: "Customer",
            value: input.metadata.customer_name,
            variable_name: "customer_name",
          },
          {
            display_name: "Delivery area",
            value: input.metadata.delivery_area,
            variable_name: "delivery_area",
          },
        ],
      },
      reference: input.reference,
    }),
    method: "POST",
  });

  if (!result.ok) {
    return result;
  }

  const { httpStatus, body } = result.value;

  if (httpStatus >= 400 || body.status !== true) {
    return rejected(httpStatus, body);
  }

  const data = initializedSchema.safeParse(body.data);

  return data.success ? ok(data.data) : emptyData("a payment link");
};

export const verifyTransaction = async (
  secretKey: string,
  reference: string
): Promise<Result<VerifiedTransaction>> => {
  const result = await call(
    secretKey,
    `/transaction/verify/${encodeURIComponent(reference)}`
  );

  if (!result.ok) {
    return result;
  }

  const { httpStatus, body } = result.value;

  if (httpStatus === 404 || REFERENCE_NOT_FOUND.test(body.message ?? "")) {
    return ok({ found: false });
  }

  if (httpStatus >= 400 || body.status !== true) {
    return rejected(httpStatus, body);
  }

  const data = verifiedSchema.safeParse(body.data);

  if (!data.success) {
    return emptyData("a transaction status");
  }

  return ok({
    amount_kobo: data.data.amount,
    currency: data.data.currency,
    found: true,
    gateway_response: data.data.gateway_response ?? null,
    paid_at: data.data.paid_at ?? null,
    status: data.data.status,
  });
};
