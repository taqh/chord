// Placeholder menu and delivery fees, made up for the demo. Replace with the
// owner's real prices, then run `pnpm menu:gen` to refresh the skill's menu.md.

export interface MenuItem {
  id: string;
  name: string;
  category: "Drinks" | "Snacks";
  description: string;
  priceNgn: number;
}

export interface DeliveryArea {
  name: string;
  feeNgn: number;
}

export const MENU: readonly MenuItem[] = [
  {
    category: "Drinks",
    description: "Hibiscus drink with ginger and pineapple",
    id: "zobo-35cl",
    name: "Zobo (35cl)",
    priceNgn: 1000,
  },
  {
    category: "Drinks",
    description: "Hibiscus drink with ginger and pineapple",
    id: "zobo-50cl",
    name: "Zobo (50cl)",
    priceNgn: 1800,
  },
  {
    category: "Drinks",
    description: "Millet drink, lightly spiced",
    id: "kunu-35cl",
    name: "Kunu (35cl)",
    priceNgn: 900,
  },
  {
    category: "Drinks",
    description: "Millet drink, lightly spiced",
    id: "kunu-50cl",
    name: "Kunu (50cl)",
    priceNgn: 1600,
  },
  {
    category: "Drinks",
    description: "Creamy tigernut drink with dates",
    id: "tigernut-35cl",
    name: "Tigernut (35cl)",
    priceNgn: 1300,
  },
  {
    category: "Drinks",
    description: "Creamy tigernut drink with dates",
    id: "tigernut-50cl",
    name: "Tigernut (50cl)",
    priceNgn: 2400,
  },
  {
    category: "Snacks",
    description: "Fresh fried dough balls",
    id: "puff-puff-10",
    name: "Puff puff (10 pieces)",
    priceNgn: 1500,
  },
  {
    category: "Snacks",
    description: "4 puff puff, 3 samosas, 3 spring rolls, 2 chicken wings",
    id: "small-chops-pack",
    name: "Small chops pack",
    priceNgn: 4500,
  },
];

export const DELIVERY_AREAS: readonly DeliveryArea[] = [
  { feeNgn: 1500, name: "Wuse" },
  { feeNgn: 1500, name: "Garki" },
  { feeNgn: 1500, name: "Maitama" },
  { feeNgn: 1500, name: "Jabi" },
  { feeNgn: 1500, name: "Utako" },
  { feeNgn: 2000, name: "Asokoro" },
  { feeNgn: 2500, name: "Gwarinpa" },
  { feeNgn: 3000, name: "Lugbe" },
  { feeNgn: 3000, name: "Kubwa" },
];

export const MAX_QUANTITY_PER_ITEM = 30;

export type ErrorCode =
  | "EMPTY_ORDER"
  | "UNKNOWN_ITEM"
  | "INVALID_QUANTITY"
  | "UNKNOWN_DELIVERY_AREA"
  | "ORDER_NOT_FOUND"
  | "ORDER_ALREADY_PAID"
  | "PAYMENT_LINK_NOT_CREATED"
  | "PAYMENT_PROVIDER_UNAVAILABLE"
  | "PAYMENT_PROVIDER_EMPTY_RESPONSE"
  | "PAYMENT_PROVIDER_REJECTED"
  | "PAYMENT_AMOUNT_MISMATCH"
  | "PAYMENTS_MISCONFIGURED"
  | "INTERNAL_ERROR";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ToolError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  handoff_to_owner: boolean;
  details?: { [key: string]: JsonValue };
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ToolError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (error: ToolError): Result<never> => ({ error, ok: false });

export interface OrderLine {
  item_id: string;
  name: string;
  quantity: number;
  unit_price_ngn: number;
  line_total_ngn: number;
}

export interface PricedOrder {
  customer_name: string;
  delivery_area: string;
  lines: OrderLine[];
  subtotal_ngn: number;
  delivery_fee_ngn: number;
  total_ngn: number;
}

export interface OrderRequest {
  items: { item_id: string; quantity: number }[];
  customer_name: string;
  delivery_area: string;
}

const NON_ALPHANUMERIC = /[^a-z0-9]/gu;

const normalize = (s: string) =>
  s.toLowerCase().replaceAll(NON_ALPHANUMERIC, "");

const itemsByKey = new Map<string, MenuItem>(
  MENU.flatMap((item) => [
    [normalize(item.id), item],
    [normalize(item.name), item],
  ])
);

const areasByKey = new Map(
  DELIVERY_AREAS.map((area) => [normalize(area.name), area])
);

export const priceOrder = (request: OrderRequest): Result<PricedOrder> => {
  if (request.items.length === 0) {
    return fail({
      code: "EMPTY_ORDER",
      handoff_to_owner: false,
      message:
        "The order has no items. Ask the customer what they would like from the menu.",
      retryable: false,
    });
  }

  const resolved = request.items.map(({ item_id, quantity }) => ({
    item_id,
    menuItem: itemsByKey.get(normalize(item_id)),
    quantity,
  }));

  const unknown = resolved
    .filter(({ menuItem }) => !menuItem)
    .map(({ item_id }) => item_id);

  if (unknown.length > 0) {
    return fail({
      code: "UNKNOWN_ITEM",
      details: {
        available_item_ids: MENU.map((m) => m.id),
        unknown_items: unknown,
      },
      handoff_to_owner: false,
      message: `Not on the menu: ${unknown.join(", ")}. Offer the closest items from the menu instead.`,
      retryable: false,
    });
  }

  const notWhole = request.items.filter(
    ({ quantity }) => !Number.isInteger(quantity) || quantity < 1
  );

  if (notWhole.length > 0) {
    return fail({
      code: "INVALID_QUANTITY",
      details: { invalid: notWhole },
      handoff_to_owner: false,
      message:
        "Each quantity must be a whole number of at least 1. Confirm the quantity with the customer.",
      retryable: false,
    });
  }

  const quantities = new Map<MenuItem, number>();

  for (const { menuItem, quantity } of resolved) {
    if (menuItem) {
      quantities.set(menuItem, (quantities.get(menuItem) ?? 0) + quantity);
    }
  }

  const tooMany = [...quantities].filter(
    ([, quantity]) => quantity > MAX_QUANTITY_PER_ITEM
  );

  if (tooMany.length > 0) {
    return fail({
      code: "INVALID_QUANTITY",
      details: {
        too_many: tooMany.map(([menuItem, quantity]) => ({
          item_id: menuItem.id,
          quantity,
        })),
      },
      handoff_to_owner: true,
      message: `More than ${MAX_QUANTITY_PER_ITEM} of one item is a bulk or event order. Hand off to the owner.`,
      retryable: false,
    });
  }

  const area = areasByKey.get(normalize(request.delivery_area));

  if (!area) {
    return fail({
      code: "UNKNOWN_DELIVERY_AREA",
      details: { supported_areas: DELIVERY_AREAS.map((a) => a.name) },
      handoff_to_owner: false,
      message: `We don't deliver to "${request.delivery_area}" yet. Ask the customer to pick a listed area, or hand off to the owner.`,
      retryable: false,
    });
  }

  const lines = [...quantities].map(([menuItem, quantity]) => ({
    item_id: menuItem.id,
    line_total_ngn: menuItem.priceNgn * quantity,
    name: menuItem.name,
    quantity,
    unit_price_ngn: menuItem.priceNgn,
  }));

  const subtotal = lines.reduce((sum, line) => sum + line.line_total_ngn, 0);

  return ok({
    customer_name: request.customer_name.trim(),
    delivery_area: area.name,
    delivery_fee_ngn: area.feeNgn,
    lines,
    subtotal_ngn: subtotal,
    total_ngn: subtotal + area.feeNgn,
  });
};
