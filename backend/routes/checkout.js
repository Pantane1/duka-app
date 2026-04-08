'use strict';

const express   = require('express');
const router    = express.Router();
const { pool }  = require('../config/db');
const { initiateStkPush, normalizePhone } = require('../config/lipana');
const validator = require('validator');
// nanoid v3 is CommonJS-compatible
const { nanoid } = require('nanoid');

/* ─── helpers ────────────────────────────────────────────── */

function makeOrderRef() {
  // e.g. DKA-X7K2P9
  return 'DKA-' + nanoid(6).toUpperCase();
}

/**
 * Securely resolve the real price for a cart item on the backend.
 * Returns unit_price (float) or throws an error.
 */
async function resolveItemPrice(variantId, customPrice) {
  const [[variant]] = await pool.query(
    `SELECT v.id, v.price, v.allows_custom, v.custom_min_price,
            p.name AS product_name, v.label
     FROM variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1`,
    [variantId]
  );

  if (!variant) throw Object.assign(new Error(`Variant ${variantId} not found`), { status: 400, expose: true });

  if (variant.allows_custom) {
    const cp = parseFloat(customPrice);
    if (isNaN(cp)) throw Object.assign(new Error(`Custom price required for variant ${variantId}`), { status: 400, expose: true });
    const min = parseFloat(variant.custom_min_price);
    if (!isNaN(min) && cp < min) {
      throw Object.assign(
        new Error(`Custom price ${cp} is below minimum ${min} for "${variant.label}"`),
        { status: 400, expose: true }
      );
    }
    return { unit_price: cp, product_name: variant.product_name, variant_label: variant.label, product_id: variant.id };
  }

  return {
    unit_price:    parseFloat(variant.price),
    product_name:  variant.product_name,
    variant_label: variant.label,
  };
}

/* ─── POST /checkout ─────────────────────────────────────── */

/**
 * Body shape:
 * {
 *   phone: "0712345678",
 *   cart: [
 *     { variant_id: 1, quantity: 2 },
 *     { variant_id: 8, quantity: 1, custom_price: 350 }
 *   ]
 * }
 */
router.post('/', async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { phone, cart } = req.body;

    /* ── 1. Basic input validation ── */
    if (!phone) return res.status(400).json({ success: false, error: 'Phone number is required' });
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ success: false, error: 'Cart is empty' });
    }
    if (cart.length > 50) {
      return res.status(400).json({ success: false, error: 'Cart exceeds 50 items' });
    }

    // Validate phone – will throw on bad input
    let normalizedPhone;
    try {
      normalizedPhone = normalizePhone(phone);
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid phone number. Use a valid Kenyan number (e.g. 0712345678)' });
    }

    /* ── 2. Resolve prices server-side (NEVER trust frontend totals) ── */
    const resolvedItems = [];
    for (const item of cart) {
      const variantId = parseInt(item.variant_id);
      const quantity  = Math.max(1, parseInt(item.quantity) || 1);

      if (!Number.isInteger(variantId) || variantId < 1) {
        return res.status(400).json({ success: false, error: `Invalid variant_id: ${item.variant_id}` });
      }

      let priceInfo;
      try {
        priceInfo = await resolveItemPrice(variantId, item.custom_price);
      } catch (err) {
        if (err.expose) return res.status(err.status || 400).json({ success: false, error: err.message });
        throw err;
      }

      // Get product_id separately
      const [[variantRow]] = await pool.query('SELECT product_id FROM variants WHERE id = ?', [variantId]);

      resolvedItems.push({
        product_id:    variantRow.product_id,
        variant_id:    variantId,
        product_name:  priceInfo.product_name,
        variant_label: priceInfo.variant_label,
        unit_price:    priceInfo.unit_price,
        quantity,
        line_total:    parseFloat((priceInfo.unit_price * quantity).toFixed(2)),
      });
    }

    const subtotal = parseFloat(resolvedItems.reduce((s, i) => s + i.line_total, 0).toFixed(2));
    const total    = subtotal; // extend here for delivery fees, taxes, discounts, etc.

    if (total <= 0) return res.status(400).json({ success: false, error: 'Order total must be greater than zero' });

    /* ── 3. Persist order inside a transaction ── */
    await conn.beginTransaction();

    const orderRef = makeOrderRef();

    const [orderResult] = await conn.query(
      `INSERT INTO orders (order_ref, phone, subtotal, total, status)
       VALUES (?, ?, ?, ?, 'awaiting_payment')`,
      [orderRef, normalizedPhone, subtotal, total]
    );
    const orderId = orderResult.insertId;

    for (const item of resolvedItems) {
      await conn.query(
        `INSERT INTO order_items
         (order_id, product_id, variant_id, product_name, variant_label, unit_price, quantity, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, item.product_id, item.variant_id, item.product_name,
         item.variant_label, item.unit_price, item.quantity, item.line_total]
      );
    }

    /* ── 4. Initiate Lipana STK Push ── */
    let stkResponse;
    try {
      stkResponse = await initiateStkPush({
        phone:       normalizedPhone,
        amount:      total,
        orderRef,
        description: `Duka order ${orderRef}`,
      });
    } catch (stkErr) {
      // Roll back order if STK push fails completely
      await conn.rollback();
      console.error('[STK Push Error]', stkErr.response?.data || stkErr.message);
      return res.status(502).json({
        success: false,
        error:   'Payment initiation failed. Please try again.',
      });
    }

    // Lipana returns checkout_request_id (and optionally merchant_request_id)
    const checkoutRequestId  = stkResponse.checkout_request_id || stkResponse.CheckoutRequestID;
    const merchantRequestId  = stkResponse.merchant_request_id || stkResponse.MerchantRequestID;

    await conn.query(
      `INSERT INTO payments
       (order_id, checkout_request_id, merchant_request_id, amount, phone, status)
       VALUES (?, ?, ?, ?, ?, 'initiated')`,
      [orderId, checkoutRequestId, merchantRequestId || null, total, normalizedPhone]
    );

    await conn.commit();

    res.json({
      success: true,
      message: 'STK push sent. Please confirm the payment on your phone.',
      data: {
        order_ref:           orderRef,
        total,
        checkout_request_id: checkoutRequestId,
      },
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
