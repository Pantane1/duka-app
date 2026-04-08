'use strict';

const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');

/**
 * GET /orders
 * List recent orders (paginated).
 */
router.get('/', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM orders');
    const [orders] = await pool.query(
      `SELECT id, order_ref, phone, subtotal, total, status, notes, created_at, updated_at
       FROM orders ORDER BY id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json({
      success: true,
      data: orders,
      pagination: { page, limit, total: Number(total), pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /orders/:ref
 * Single order detail with items and payment info.
 */
router.get('/:ref', async (req, res, next) => {
  try {
    const [[order]] = await pool.query(
      'SELECT * FROM orders WHERE order_ref = ?',
      [req.params.ref]
    );
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const [items] = await pool.query(
      'SELECT * FROM order_items WHERE order_id = ?',
      [order.id]
    );
    const [payments] = await pool.query(
      `SELECT id, checkout_request_id, amount, phone, status, mpesa_receipt,
              result_code, result_desc, initiated_at, completed_at
       FROM payments WHERE order_id = ? ORDER BY initiated_at DESC`,
      [order.id]
    );

    res.json({ success: true, data: { ...order, items, payments } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
