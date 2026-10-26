CREATE TABLE orders (
	reference TEXT PRIMARY KEY,
	customer_name TEXT NOT NULL,
	delivery_area TEXT NOT NULL,
	lines_json TEXT NOT NULL,
	subtotal_ngn INTEGER NOT NULL,
	delivery_fee_ngn INTEGER NOT NULL,
	total_ngn INTEGER NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'paid')),
	payment_url TEXT,
	paid_at TEXT,
	created_at TEXT NOT NULL
);
