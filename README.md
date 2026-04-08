# Duka App 🛍️

> A production-ready Node.js + MySQL + Vanilla JS shop with M-Pesa (Lipana) payments.

---

## Folder Structure

```
duka-app/
├── backend/
│   ├── config/
│   │   ├── db.js          # MySQL connection pool
│   │   └── lipana.js      # Lipana M-Pesa service
│   ├── db/
│   │   └── schema.sql     # Full DB schema + seed data
│   ├── middleware/
│   │   └── errorHandler.js
│   ├── routes/
│   │   ├── products.js    # GET /api/products
│   │   ├── checkout.js    # POST /api/checkout
│   │   ├── payment.js     # POST /payment/callback, GET /api/payment/status/:id
│   │   └── orders.js      # GET /api/orders
│   ├── package.json
│   └── server.js          # Express app entry point
├── frontend/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── app.js
│   └── index.html
├── .env.example
└── README.md
```

---

## Prerequisites

| Tool    | Version   |
|---------|-----------|
| Node.js | ≥ 18.x    |
| MySQL   | ≥ 5.7 / 8 |
| ngrok   | any       |

---

## Local Setup

### 1. Clone / copy the project

```bash
git clone <repo> duka-app
cd duka-app
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Create the database

```sql
-- In MySQL client / Workbench / DBeaver:
source backend/db/schema.sql
```

Or via the CLI:

```bash
mysql -u root -p < backend/db/schema.sql
```

This creates the `duka_app` database, all tables, and seeds the four products with their variants.

### 4. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=3000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_NAME=duka_app
DB_USER=root
DB_PASSWORD=your_password

LIPANA_SECRET_KEY=your_lipana_secret_key
LIPANA_BASE_URL=https://api.lipana.dev

# For local dev, expose your server with ngrok (see below)
CALLBACK_URL=https://xxxx.ngrok.io/payment/callback
```

### 5. Expose localhost for M-Pesa callbacks (ngrok)

M-Pesa needs a public HTTPS URL to send payment callbacks to.

```bash
# In a separate terminal:
ngrok http 3000
```

Copy the `https://xxxx.ngrok.io` URL and set `CALLBACK_URL=https://xxxx.ngrok.io/payment/callback` in your `.env`.

### 6. Start the server

```bash
# Development (auto-reload)
cd backend && npm run dev

# Production
cd backend && npm start
```

Open: **http://localhost:3000**

---

## API Reference

### Products

```
GET /api/products          – all products with variants
GET /api/products/:id      – single product
```

### Checkout

```
POST /api/checkout
Body: {
  "phone": "0712345678",
  "cart": [
    { "variant_id": 1, "quantity": 2 },
    { "variant_id": 8, "quantity": 1, "custom_price": 350 }
  ]
}
```

Returns: `{ order_ref, total, checkout_request_id }`

### Payment

```
POST /payment/callback     – Lipana/M-Pesa STK push result (Lipana calls this)
GET  /api/payment/status/:checkoutRequestId – poll payment status
```

### Orders

```
GET /api/orders            – paginated order list (?page=1&limit=20)
GET /api/orders/:ref       – order detail with items + payments
```

---

## Payment Flow

```
User selects items → Cart → Checkout
        ↓
Backend POST /api/checkout
  1. Validates phone
  2. Re-calculates totals server-side (never trusts frontend)
  3. Inserts order + items (status = awaiting_payment)
  4. Calls Lipana initiate_stk_push
  5. Saves payment record with CheckoutRequestID
        ↓
User receives STK push on phone
        ↓
Lipana calls POST /payment/callback
  1. Parses result
  2. Verifies transaction via Lipana GET /transactions/:receipt
  3. Marks payment success/failed
  4. Updates order status → paid / failed
        ↓
Frontend polls GET /api/payment/status/:id every 5s
  → Shows confirmation / error to user
```

---

## Security Notes

- **Totals are always recalculated on the backend** – the frontend total is only for display.
- Custom prices are validated against `custom_min_price` server-side.
- All payments are verified against the Lipana transaction API before marking an order as paid.
- API keys live in `.env` – never commit this file.
- Helmet and CORS middleware are applied.
- Rate limiting protects checkout (5 req/min) and all API routes (200 req/15min).

---

## Lipana Key Notes

- Get your secret key from https://lipana.dev/dashboard
- Use sandbox/test keys during development
- The `callback_url` must be a publicly accessible HTTPS URL
- M-Pesa requires the amount to be a whole integer (the app uses `Math.ceil`)

---

## Extending the App

| Feature          | Where                                 |
|------------------|---------------------------------------|
| Add a product    | Insert row into `products` + `variants` |
| Add delivery fee | `backend/routes/checkout.js` – `total` calc |
| Discount codes   | Add `discounts` table, validate in checkout |
| Admin panel      | Add `/admin` Express router           |
| Email receipt    | Hook into `onPaymentSuccess` in payment.js |
