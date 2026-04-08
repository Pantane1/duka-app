'use strict';

/**
 * /api/cart  – lightweight server-side cart (session-less, keyed by cartId)
 *
 * The frontend generates a UUID cart ID stored in localStorage.
 * Cart items live in MySQL for durability (survive page refresh / device switch).
 *
 * Routes:
 *   GET    /api/cart/:cartId          – fetch cart contents
 *   POST   /api/cart/:cartId/items    – upsert an item
 *   PATCH  /api/cart/:cartId/items/:variantId – change quantity
 *   DELETE /api/cart/:cartId/items/:variantId – remove item
 *   DELETE /api/cart/:cartId          – clear entire cart
 */

const express   = require('express');
const router    = express.Router();
const { pool }  = require('../config/db');

/* ── ensure cart_items table exists (created by schema.sql,
      but guard here for safety) ──────────────────────────── */

/* ── helpers ─────────────────────────────────────────────── */
async function getCartItems(cartId) {
  const [rows] = await pool.query(
    `SELECT ci.variant_id, ci.quantity, ci.custom_price,
            v.label AS variant_label, v.price AS base_price,
            v.allows_custom, v.custom_min_price,
            p.id AS product_id, p.name AS product_name
     FROM cart_items ci
     JOIN variants v ON v.id = ci.variant_id
     JOIN products p ON p.id = v.product_id
     WHERE ci.cart_id = ?
     ORDER BY ci.created_at`,
    [cartId]
  );

  return rows.map(r => {
    const unitPrice = r.allows_custom ? parseFloat(r.custom_price) : parseFloat(r.base_price);
    return {
      product_id:    r.product_id,
      product_name:  r.product_name,
      variant_id:    r.variant_id,
      variant_label: r.variant_label,
      unit_price:    unitPrice,
      quantity:      r.quantity,
      allows_custom: r.allows_custom === 1,
      custom_price:  r.custom_price ? parseFloat(r.custom_price) : null,
      line_total:    parseFloat((unitPrice * r.quantity).toFixed(2)),
    };
  });
}

function validateCartId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

/* ── GET /api/cart/:cartId ──────────────────────────────── */
router.get('/:cartId', async (req, res, next) => {
  try {
    const { cartId } = req.params;
    if (!validateCartId(cartId)) return res.status(400).json({ success: false, error: 'Invalid cart ID' });

    const items = await getCartItems(cartId);
    const total = items.reduce((s, i) => s + i.line_total, 0);
    res.json({ success: true, data: { items, total: parseFloat(total.toFixed(2)) } });
  } catch (err) { next(err); }
});

/* ── POST /api/cart/:cartId/items – add / upsert ─────────── */
router.post('/:cartId/items', async (req, res, next) => {
  try {
    const { cartId } = req.params;
    if (!validateCartId(cartId)) return res.status(400).json({ success: false, error: 'Invalid cart ID' });

    const { variant_id, quantity = 1, custom_price } = req.body;
    const vid = parseInt(variant_id);
    const qty = Math.max(1, parseInt(quantity) || 1);
    if (!vid || vid < 1) return res.status(400).json({ success: false, error: 'Invalid variant_id' });

    // Verify variant exists
    const [[variant]] = await pool.query(
      'SELECT id, price, allows_custom, custom_min_price FROM variants WHERE id = ? AND is_active = 1',
      [vid]
    );
    if (!variant) return res.status(404).json({ success: false, error: 'Variant not found' });

    let resolvedCustom = null;
    if (variant.allows_custom) {
      const cp = parseFloat(custom_price);
      if (isNaN(cp) || cp <= 0) return res.status(400).json({ success: false, error: 'Custom price required' });
      if (variant.custom_min_price && cp < parseFloat(variant.custom_min_price)) {
        return res.status(400).json({ success: false, error: `Custom price below minimum ${variant.custom_min_price}` });
      }
      resolvedCustom = cp;
    }

    // Upsert
    await pool.query(
      `INSERT INTO cart_items (cart_id, variant_id, quantity, custom_price)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         quantity     = quantity + VALUES(quantity),
         custom_price = VALUES(custom_price)`,
      [cartId, vid, qty, resolvedCustom]
    );

    const items = await getCartItems(cartId);
    const total = items.reduce((s, i) => s + i.line_total, 0);
    res.json({ success: true, data: { items, total: parseFloat(total.toFixed(2)) } });
  } catch (err) { next(err); }
});

/* ── PATCH /api/cart/:cartId/items/:variantId ────────────── */
router.patch('/:cartId/items/:variantId', async (req, res, next) => {
  try {
    const { cartId, variantId } = req.params;
    const qty = Math.max(1, parseInt(req.body.quantity) || 1);
    if (!validateCartId(cartId)) return res.status(400).json({ success: false, error: 'Invalid cart ID' });

    await pool.query(
      'UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND variant_id = ?',
      [qty, cartId, parseInt(variantId)]
    );

    const items = await getCartItems(cartId);
    const total = items.reduce((s, i) => s + i.line_total, 0);
    res.json({ success: true, data: { items, total: parseFloat(total.toFixed(2)) } });
  } catch (err) { next(err); }
});

/* ── DELETE /api/cart/:cartId/items/:variantId ───────────── */
router.delete('/:cartId/items/:variantId', async (req, res, next) => {
  try {
    const { cartId, variantId } = req.params;
    if (!validateCartId(cartId)) return res.status(400).json({ success: false, error: 'Invalid cart ID' });

    await pool.query(
      'DELETE FROM cart_items WHERE cart_id = ? AND variant_id = ?',
      [cartId, parseInt(variantId)]
    );

    const items = await getCartItems(cartId);
    const total = items.reduce((s, i) => s + i.line_total, 0);
    res.json({ success: true, data: { items, total: parseFloat(total.toFixed(2)) } });
  } catch (err) { next(err); }
});

/* ── DELETE /api/cart/:cartId – clear entire cart ────────── */
router.delete('/:cartId', async (req, res, next) => {
  try {
    const { cartId } = req.params;
    if (!validateCartId(cartId)) return res.status(400).json({ success: false, error: 'Invalid cart ID' });
    await pool.query('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
    res.json({ success: true, data: { items: [], total: 0 } });
  } catch (err) { next(err); }
});

module.exports = router;
