'use strict';

const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');

/**
 * GET /products
 * Returns all active products with their variants.
 */
router.get('/', async (req, res, next) => {
  try {
    const [products] = await pool.query(
      `SELECT id, name, description, image_url
       FROM products
       WHERE is_active = 1
       ORDER BY id`
    );

    if (products.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const productIds = products.map(p => p.id);
    const [variants] = await pool.query(
      `SELECT id, product_id, label, price, allows_custom, custom_min_price, sort_order
       FROM variants
       WHERE product_id IN (?) AND is_active = 1
       ORDER BY product_id, sort_order`,
      [productIds]
    );

    // Group variants under their parent product
    const variantMap = {};
    variants.forEach(v => {
      if (!variantMap[v.product_id]) variantMap[v.product_id] = [];
      variantMap[v.product_id].push({
        id:             v.id,
        label:          v.label,
        price:          v.price !== null ? parseFloat(v.price) : null,
        allows_custom:  v.allows_custom === 1,
        custom_min_price: v.custom_min_price !== null ? parseFloat(v.custom_min_price) : null,
        sort_order:     v.sort_order,
      });
    });

    const data = products.map(p => ({
      id:          p.id,
      name:        p.name,
      description: p.description,
      image_url:   p.image_url,
      variants:    variantMap[p.id] || [],
    }));

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /products/:id
 * Single product with variants.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: 'Invalid product ID' });
    }

    const [[product]] = await pool.query(
      'SELECT id, name, description, image_url FROM products WHERE id = ? AND is_active = 1',
      [id]
    );
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    const [variants] = await pool.query(
      `SELECT id, label, price, allows_custom, custom_min_price, sort_order
       FROM variants WHERE product_id = ? AND is_active = 1 ORDER BY sort_order`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...product,
        variants: variants.map(v => ({
          id:             v.id,
          label:          v.label,
          price:          v.price !== null ? parseFloat(v.price) : null,
          allows_custom:  v.allows_custom === 1,
          custom_min_price: v.custom_min_price !== null ? parseFloat(v.custom_min_price) : null,
          sort_order:     v.sort_order,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
