'use strict';

const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/db');
const { getTransaction } = require('../config/lipana');

/* ─── POST /payment/callback ─────────────────────────────── */
/**
 * Lipana / M-Pesa sends the STK push result here.
 *
 * Expected Lipana callback body (mirrors Safaricom):
 * {
 *   "Body": {
 *     "stkCallback": {
 *       "MerchantRequestID":  "...",
 *       "CheckoutRequestID":  "...",
 *       "ResultCode":         0,        // 0 = success
 *       "ResultDesc":         "...",
 *       "CallbackMetadata": {
 *         "Item": [
 *           { "Name": "Amount",              "Value": 100  },
 *           { "Name": "MpesaReceiptNumber",  "Value": "QGH..." },
 *           { "Name": "PhoneNumber",         "Value": 254... }
 *         ]
 *       }
 *     }
 *   }
 * }
 */
router.post('/callback', async (req, res) => {
  // Always respond 200 quickly so Lipana/Safaricom doesn't retry
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  // Process asynchronously
  setImmediate(() => handleCallback(req.body));
});

async function handleCallback(body) {
  try {
    const callback = body?.Body?.stkCallback || body?.stkCallback || body;

    const checkoutRequestId = callback?.CheckoutRequestID || callback?.checkout_request_id;
    const resultCode        = callback?.ResultCode ?? callback?.result_code;
    const resultDesc        = callback?.ResultDesc || callback?.result_desc || '';

    if (!checkoutRequestId) {
      console.error('[Callback] Missing CheckoutRequestID in payload', body);
      return;
    }

    // Find the payment record
    const [[payment]] = await pool.query(
      'SELECT * FROM payments WHERE checkout_request_id = ?',
      [checkoutRequestId]
    );

    if (!payment) {
      console.warn('[Callback] Unknown CheckoutRequestID:', checkoutRequestId);
      return;
    }

    // Extract metadata items (Safaricom-style)
    const items = callback?.CallbackMetadata?.Item || [];
    function meta(name) {
      const found = items.find(i => i.Name === name);
      return found ? found.Value : null;
    }

    const mpesaReceipt = meta('MpesaReceiptNumber') || callback?.mpesa_receipt || null;
    const paidAmount   = meta('Amount') || callback?.amount || null;

    if (String(resultCode) === '0') {
      /* ── Payment succeeded ── */

      // ── Verification step: query Lipana to confirm transaction ──
      let verified = false;
      if (mpesaReceipt) {
        try {
          const txn = await getTransaction(mpesaReceipt);
          // Accept if Lipana confirms amount matches (allow ±1 KES for rounding)
          const confirmedAmt = parseFloat(txn?.amount || txn?.Amount || 0);
          const expectedAmt  = parseFloat(payment.amount);
          verified = Math.abs(confirmedAmt - expectedAmt) <= 1;
        } catch (err) {
          console.warn('[Callback] Transaction verification failed, trusting callback:', err.message);
          // If verification API itself fails, fall back to trusting the callback
          verified = true;
        }
      } else {
        // No receipt yet – trust result code 0 from Lipana
        verified = true;
      }

      if (!verified) {
        console.error('[Callback] Amount mismatch for receipt', mpesaReceipt);
        await markPayment(payment.id, payment.order_id, 'failed', mpesaReceipt, resultCode, 'Amount mismatch – verification failed', body);
        return;
      }

      await markPayment(payment.id, payment.order_id, 'success', mpesaReceipt, resultCode, resultDesc, body);
      console.log(`✅  Payment confirmed for order ${payment.order_id}, receipt ${mpesaReceipt}`);

    } else {
      /* ── Payment failed / cancelled ── */
      // ResultCode 1032 = cancelled by user, 1037 = timeout
      const status = String(resultCode) === '1032' ? 'cancelled'
                   : String(resultCode) === '1037' ? 'timeout'
                   : 'failed';

      await markPayment(payment.id, payment.order_id, status, null, resultCode, resultDesc, body);
      console.log(`⚠️   Payment ${status} for order ${payment.order_id}: ${resultDesc}`);
    }
  } catch (err) {
    console.error('[Callback] Unexpected error:', err);
  }
}

async function markPayment(paymentId, orderId, status, receipt, resultCode, resultDesc, rawBody) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE payments
       SET status = ?, mpesa_receipt = ?, result_code = ?,
           result_desc = ?, raw_callback = ?, completed_at = NOW()
       WHERE id = ?`,
      [status, receipt || null, String(resultCode), resultDesc, JSON.stringify(rawBody), paymentId]
    );

    const orderStatus = status === 'success' ? 'paid' : (status === 'cancelled' ? 'cancelled' : 'failed');
    await conn.query('UPDATE orders SET status = ? WHERE id = ?', [orderStatus, orderId]);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ─── GET /payment/status/:checkoutRequestId ────────────── */
/**
 * Polling endpoint – frontend can poll this to check if payment was confirmed.
 */
router.get('/status/:checkoutRequestId', async (req, res, next) => {
  try {
    const [[payment]] = await pool.query(
      `SELECT p.status, p.mpesa_receipt, p.result_desc, o.order_ref, o.total
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.checkout_request_id = ?`,
      [req.params.checkoutRequestId]
    );

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    res.json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
