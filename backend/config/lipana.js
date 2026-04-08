'use strict';

/**
 * Lipana M-Pesa service
 * Docs: https://docs.lipana.dev
 *
 * Environment variables required:
 *   LIPANA_SECRET_KEY  – your Lipana secret key
 *   LIPANA_BASE_URL    – e.g. https://api.lipana.dev
 *   CALLBACK_URL       – publicly reachable POST endpoint
 */

require('dotenv').config();
const axios = require('axios');

const BASE_URL     = (process.env.LIPANA_BASE_URL || 'https://api.lipana.dev').replace(/\/$/, '');
const SECRET_KEY   = process.env.LIPANA_SECRET_KEY;
const CALLBACK_URL = process.env.CALLBACK_URL;

if (!SECRET_KEY) {
  console.warn('⚠️   LIPANA_SECRET_KEY is not set – payments will fail');
}

// Shared axios instance
const lipana = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SECRET_KEY}`,
  },
});

/**
 * Normalize a Kenyan phone number to the 2547XXXXXXXX format.
 */
function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10)  return '254' + digits.slice(1);
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('7') && digits.length === 9)   return '254' + digits;
  throw new Error(`Invalid Kenyan phone number: ${raw}`);
}

/**
 * Initiate an STK Push.
 *
 * @param {object} opts
 * @param {string} opts.phone       – customer phone (any common KE format)
 * @param {number} opts.amount      – amount in KES (integer required by M-Pesa)
 * @param {string} opts.orderRef    – your internal order reference
 * @param {string} [opts.description]
 * @returns {Promise<object>}       – Lipana response body
 */
async function initiateStkPush({ phone, amount, orderRef, description }) {
  const normalizedPhone = normalizePhone(phone);
  const intAmount       = Math.ceil(amount); // M-Pesa requires whole KES

  const payload = {
    phone:        normalizedPhone,
    amount:       intAmount,
    order_id:     orderRef,          // passed back in callback
    callback_url: CALLBACK_URL,
    description:  description || `Order ${orderRef}`,
  };

  const { data } = await lipana.post('/stk/push', payload);
  return data;
}

/**
 * Query the status of a previous STK push by CheckoutRequestID.
 *
 * @param {string} checkoutRequestId
 * @returns {Promise<object>}
 */
async function queryStkStatus(checkoutRequestId) {
  const { data } = await lipana.get(`/stk/query/${checkoutRequestId}`);
  return data;
}

/**
 * Retrieve a transaction by M-Pesa receipt number for final verification.
 *
 * @param {string} mpesaReceipt
 * @returns {Promise<object>}
 */
async function getTransaction(mpesaReceipt) {
  const { data } = await lipana.get(`/transactions/${mpesaReceipt}`);
  return data;
}

module.exports = { initiateStkPush, queryStkStatus, getTransaction, normalizePhone };
