'use strict';
/* =====================================================================
   Duka App – Frontend JS
   Features: server-side cart persistence, orders page + detail drawer,
             payment polling, toasts, SPA router, localStorage cart ID.
   ===================================================================== */

const API = '/api';

/* ── Stable browser cart identity ──────────────────────────────────── */
function getCartId() {
  let id = localStorage.getItem('duka_cart_id');
  if (!id) {
    id = 'cart-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('duka_cart_id', id);
  }
  return id;
}
const CART_ID = getCartId();

/* ── State ─────────────────────────────────────────────────────────── */
let products         = [];
let cart             = [];
let pollInterval     = null;
let ordersPage       = 1;
let ordersTotalPages = 1;

/* ── DOM refs ──────────────────────────────────────────────────────── */
const pages       = document.querySelectorAll('.page');
const navLinks    = document.querySelectorAll('.nav-link[data-page]');
const cartCountEl = document.getElementById('cart-count');

/* ═══════════════════════════════════════════════════════════════════
   ROUTER
   ═══════════════════════════════════════════════════════════════════ */
function showPage(name) {
  pages.forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  navLinks.forEach(l => l.classList.toggle('active', l.dataset.page === name));
  if (name === 'cart')     renderCart();
  if (name === 'checkout') renderCheckoutSummary();
  if (name === 'orders')   loadOrders(1);
}
navLinks.forEach(l => l.addEventListener('click', () => showPage(l.dataset.page)));

/* ═══════════════════════════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════════════════════════ */
function toast(msg, type, duration) {
  type     = type     || 'info';
  duration = duration || 3500;
  const el = document.createElement('div');
  el.className   = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(function() { el.remove(); }, duration);
}

/* ═══════════════════════════════════════════════════════════════════
   CART HELPERS
   ═══════════════════════════════════════════════════════════════════ */
function cartTotal() {
  return cart.reduce(function(s, i) { return s + i.unit_price * i.quantity; }, 0);
}

function updateCartBadge() {
  const count = cart.reduce(function(s, i) { return s + i.quantity; }, 0);
  cartCountEl.textContent = count;
  if (count > 0) {
    cartCountEl.classList.add('bump');
    setTimeout(function() { cartCountEl.classList.remove('bump'); }, 300);
  }
}

function syncCartFromServer(data) {
  cart = (data.items || []).map(function(item) {
    return {
      _key:          String(item.variant_id),
      product_id:    item.product_id,
      variant_id:    item.variant_id,
      product_name:  item.product_name,
      variant_label: item.variant_label,
      unit_price:    item.unit_price,
      quantity:      item.quantity,
      allows_custom: item.allows_custom,
      custom_price:  item.custom_price,
    };
  });
  updateCartBadge();
}

async function loadCart() {
  try {
    const res  = await fetch(API + '/cart/' + CART_ID);
    const json = await res.json();
    if (json.success) syncCartFromServer(json.data);
  } catch (e) { /* offline */ }
}

async function addToCart(product, variant, customPrice) {
  var price = variant.allows_custom ? parseFloat(customPrice) : variant.price;
  if (isNaN(price) || price <= 0) return toast('Enter a valid price', 'error');
  if (variant.allows_custom && variant.custom_min_price && price < variant.custom_min_price) {
    return toast('Minimum price is KES ' + variant.custom_min_price, 'error');
  }
  try {
    var body = { variant_id: variant.id, quantity: 1 };
    if (variant.allows_custom) body.custom_price = price;
    const res  = await fetch(API + '/cart/' + CART_ID + '/items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.success) return toast(json.error || 'Could not add item', 'error');
    syncCartFromServer(json.data);
    toast(product.name + ' – ' + variant.label + ' added', 'success');
  } catch (e) { toast('Network error', 'error'); }
}

async function removeFromCart(variantId) {
  try {
    const res  = await fetch(API + '/cart/' + CART_ID + '/items/' + variantId, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) { syncCartFromServer(json.data); renderCart(); }
  } catch (e) { toast('Could not remove item', 'error'); }
}

async function changeQty(variantId, delta) {
  var item = cart.find(function(i) { return i.variant_id === variantId; });
  if (!item) return;
  var newQty = Math.max(1, item.quantity + delta);
  try {
    const res  = await fetch(API + '/cart/' + CART_ID + '/items/' + variantId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: newQty }),
    });
    const json = await res.json();
    if (json.success) { syncCartFromServer(json.data); renderCart(); }
  } catch (e) { toast('Could not update qty', 'error'); }
}

async function clearCart() {
  await fetch(API + '/cart/' + CART_ID, { method: 'DELETE' }).catch(function() {});
  cart = [];
  updateCartBadge();
}

/* ═══════════════════════════════════════════════════════════════════
   PRODUCTS PAGE
   ═══════════════════════════════════════════════════════════════════ */
async function loadProducts() {
  var grid = document.getElementById('products-grid');
  grid.innerHTML = Array(4).fill('<div class="skeleton skel-card"></div>').join('');
  try {
    const res  = await fetch(API + '/products');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    products = json.data;
    renderProducts();
  } catch (err) {
    grid.innerHTML = '<p style="color:var(--red);grid-column:1/-1">Failed to load: ' + esc(err.message) + '</p>';
  }
}

var EMOJIS = { Roll: '🍞', Ori: '🍪', Supermatch: '🚬', 'Item X': '📦' };

function renderProducts() {
  var grid = document.getElementById('products-grid');
  if (!products.length) { grid.innerHTML = '<p>No products.</p>'; return; }
  grid.innerHTML = products.map(function(p) {
    return '<div class="product-card" id="product-' + p.id + '">' +
      '<span class="product-emoji">' + (EMOJIS[p.name] || '🛍️') + '</span>' +
      '<div class="product-name">' + esc(p.name) + '</div>' +
      '<div class="product-desc">'  + esc(p.description || '') + '</div>' +
      '<div class="variants-list">' + p.variants.map(function(v) { return variantRowHTML(p, v); }).join('') + '</div>' +
      '</div>';
  }).join('');

  products.forEach(function(p) {
    p.variants.forEach(function(v) {
      var btn = document.getElementById('btn-add-' + v.id);
      if (btn) btn.addEventListener('click', function() {
        var inp = document.getElementById('custom-' + v.id);
        addToCart(p, v, inp ? inp.value : null);
      });
    });
  });
}

function variantRowHTML(product, v) {
  var priceLabel = v.price !== null
    ? '<span class="variant-price">KES ' + fmtPrice(v.price) + '</span>'
    : '<span class="variant-price custom-label">custom price</span>';

  var customBlock = '';
  if (v.allows_custom) {
    customBlock = '<div class="custom-price-wrap"><div class="custom-price-row">' +
      '<input type="number" id="custom-' + v.id + '"' +
      ' placeholder="' + (v.custom_min_price ? 'Min ' + v.custom_min_price : 'Enter price') + '"' +
      ' min="' + (v.custom_min_price || 1) + '" step="1">' +
      '<button class="btn-add" id="btn-add-' + v.id + '">Add</button>' +
      '</div>' +
      (v.custom_min_price ? '<div class="custom-min-note">Minimum: KES ' + v.custom_min_price + '</div>' : '') +
      '</div>';
  }

  return '<div class="variant-row">' +
    '<span class="variant-label">' + esc(v.label) + '</span>' +
    priceLabel +
    (!v.allows_custom ? '<button class="btn-add" id="btn-add-' + v.id + '">Add</button>' : '') +
    '</div>' + customBlock;
}

/* ═══════════════════════════════════════════════════════════════════
   CART PAGE
   ═══════════════════════════════════════════════════════════════════ */
function renderCart() {
  var wrap = document.getElementById('cart-content');
  if (!cart.length) {
    wrap.innerHTML = '<div class="cart-empty">' +
      '<div class="cart-empty-icon">🛒</div>' +
      '<p>Your cart is empty</p>' +
      '<p style="margin-top:8px;font-size:.85rem">' +
      '<a href="#" style="color:var(--amber)" onclick="showPage(\'products\');return false;">← Browse products</a></p>' +
      '</div>';
    return;
  }

  var rows = cart.map(function(item) {
    return '<tr>' +
      '<td><div class="item-name">' + esc(item.product_name) + '</div>' +
      '<div class="item-variant">' + esc(item.variant_label) +
      (item.allows_custom ? ' · KES ' + fmtPrice(item.unit_price) : '') + '</div></td>' +
      '<td><div class="qty-ctrl">' +
      '<button class="qty-btn" data-vid="' + item.variant_id + '" data-delta="-1">−</button>' +
      '<span class="qty-value">' + item.quantity + '</span>' +
      '<button class="qty-btn" data-vid="' + item.variant_id + '" data-delta="1">+</button>' +
      '</div></td>' +
      '<td>KES ' + fmtPrice(item.unit_price) + '</td>' +
      '<td><span class="line-price">KES ' + fmtPrice(item.unit_price * item.quantity) + '</span></td>' +
      '<td><button class="btn-remove" data-vid="' + item.variant_id + '" title="Remove">✕</button></td>' +
      '</tr>';
  }).join('');

  wrap.innerHTML =
    '<table class="cart-table"><thead><tr>' +
    '<th>Product</th><th>Qty</th><th>Unit</th><th>Total</th><th></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="cart-footer">' +
    '<div class="cart-total">Total: <span>KES ' + fmtPrice(cartTotal()) + '</span></div>' +
    '<button class="btn-checkout" id="btn-go-checkout">Checkout →</button>' +
    '</div>';

  wrap.querySelectorAll('.qty-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { changeQty(Number(btn.dataset.vid), Number(btn.dataset.delta)); });
  });
  wrap.querySelectorAll('.btn-remove').forEach(function(btn) {
    btn.addEventListener('click', function() { removeFromCart(Number(btn.dataset.vid)); });
  });
  document.getElementById('btn-go-checkout').addEventListener('click', function() { showPage('checkout'); });
}

/* ═══════════════════════════════════════════════════════════════════
   CHECKOUT PAGE
   ═══════════════════════════════════════════════════════════════════ */
function renderCheckoutSummary() {
  var el = document.getElementById('checkout-summary');
  if (!cart.length) {
    el.innerHTML = '<p style="color:var(--text-muted)">Cart is empty. ' +
      '<a href="#" style="color:var(--amber)" onclick="showPage(\'products\');return false;">Add items first</a>.</p>';
    return;
  }
  el.innerHTML = cart.map(function(i) {
    return '<div class="order-summary-row">' +
      '<span>' + esc(i.product_name) + ' – ' + esc(i.variant_label) + ' × ' + i.quantity + '</span>' +
      '<span class="price">KES ' + fmtPrice(i.unit_price * i.quantity) + '</span>' +
      '</div>';
  }).join('') +
  '<div class="order-summary-row total">' +
  '<span>Total</span><span class="price">KES ' + fmtPrice(cartTotal()) + '</span>' +
  '</div>';
}

document.getElementById('btn-pay').addEventListener('click', async function() {
  var phone = document.getElementById('phone-input').value.trim();
  if (!phone) return toast('Please enter your phone number', 'error');
  if (!/^(07|01|2547|2541)\d{7,8}$/.test(phone.replace(/\s+/g, ''))) {
    return toast('Enter a valid Kenyan number (e.g. 0712345678)', 'error');
  }
  if (!cart.length) return toast('Your cart is empty', 'error');

  setBtnPaying(true);

  var payload = {
    phone: phone,
    cart: cart.map(function(i) {
      return { variant_id: i.variant_id, quantity: i.quantity, custom_price: i.custom_price };
    }),
  };

  try {
    const res  = await fetch(API + '/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.success) { toast(json.error || 'Checkout failed', 'error'); return setBtnPaying(false); }
    var d = json.data;
    openPaymentModal(d.order_ref, d.checkout_request_id, d.total);
    startPolling(d.checkout_request_id, d.order_ref);
  } catch (e) {
    toast('Network error. Please try again.', 'error');
    setBtnPaying(false);
  }
});

function setBtnPaying(paying) {
  var btn = document.getElementById('btn-pay');
  if (!btn) return;
  btn.disabled  = paying;
  btn.innerHTML = paying ? '<div class="spinner"></div> Sending STK Push…' : '📱 Pay with M-Pesa';
}

/* ═══════════════════════════════════════════════════════════════════
   PAYMENT MODAL
   ═══════════════════════════════════════════════════════════════════ */
function openPaymentModal(orderRef, checkoutRequestId, total) {
  document.getElementById('modal-icon').textContent  = '📱';
  document.getElementById('modal-title').textContent = 'Check your phone';
  document.getElementById('modal-body').innerHTML    =
    'An M-Pesa STK push was sent.<br>Enter your PIN to pay <strong>KES ' + fmtPrice(total) + '</strong>.';
  document.getElementById('modal-ref').textContent   = 'Order: ' + orderRef;
  setPollingStatus('Waiting for confirmation…');
  document.getElementById('modal-actions').innerHTML =
    '<button class="btn-modal" id="btn-cancel-poll">Cancel</button>';
  document.getElementById('btn-cancel-poll').addEventListener('click', function() {
    closeModal(); setBtnPaying(false);
  });
  document.getElementById('modal-overlay').classList.add('visible');
}

function setPollingStatus(msg) {
  document.getElementById('polling-status').innerHTML =
    '<div class="spinner" style="border-top-color:var(--amber)"></div>' + msg;
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('visible');
  stopPolling();
}

function startPolling(checkoutRequestId, orderRef) {
  var attempts = 0;
  pollInterval = setInterval(async function() {
    attempts++;
    try {
      const res  = await fetch(API + '/payment/status/' + encodeURIComponent(checkoutRequestId));
      const json = await res.json();
      if (!json.success) return;
      var st = json.data.status;
      if (st === 'success')                                  { stopPolling(); onPaymentSuccess(orderRef); }
      else if (['failed','cancelled','timeout'].includes(st)){ stopPolling(); onPaymentFailed(st); }
      else if (attempts >= 40)                               { stopPolling(); onPaymentFailed('timeout'); }
    } catch (e) { /* keep polling */ }
  }, 5000);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function onPaymentSuccess(orderRef) {
  setBtnPaying(false);
  document.getElementById('modal-icon').textContent   = '✅';
  document.getElementById('modal-title').textContent  = 'Payment Confirmed!';
  document.getElementById('modal-body').textContent   = 'Payment received. Your order is confirmed.';
  document.getElementById('polling-status').innerHTML = '';
  document.getElementById('modal-actions').innerHTML  =
    '<button class="btn-modal primary" id="btn-done">Done</button>';
  document.getElementById('btn-done').addEventListener('click', async function() {
    await clearCart(); closeModal(); showPage('products');
    toast('Order placed! 🎉', 'success', 5000);
  });
}

function onPaymentFailed(status) {
  setBtnPaying(false);
  var map = {
    cancelled: ['Payment Cancelled', 'You cancelled the M-Pesa request.'],
    timeout:   ['Request Timed Out', 'The STK push expired. Please try again.'],
    failed:    ['Payment Failed',    'The payment could not be processed.'],
  };
  var info = map[status] || map.failed;
  document.getElementById('modal-icon').textContent   = '❌';
  document.getElementById('modal-title').textContent  = info[0];
  document.getElementById('modal-body').textContent   = info[1];
  document.getElementById('polling-status').innerHTML = '';
  document.getElementById('modal-actions').innerHTML  =
    '<button class="btn-modal" id="btn-retry">Try Again</button>' +
    '<button class="btn-modal" id="btn-close-fail">Close</button>';
  document.getElementById('btn-retry').addEventListener('click',      closeModal);
  document.getElementById('btn-close-fail').addEventListener('click', closeModal);
}

/* ═══════════════════════════════════════════════════════════════════
   ORDERS PAGE
   ═══════════════════════════════════════════════════════════════════ */
async function loadOrders(page) {
  ordersPage = page || 1;
  var wrap = document.getElementById('orders-content');
  wrap.innerHTML = '<div style="padding:48px 0;text-align:center;color:var(--text-muted)">' +
    '<div class="spinner" style="margin:0 auto 12px;width:28px;height:28px;border-top-color:var(--amber)"></div>' +
    'Loading orders…</div>';
  try {
    const res  = await fetch(API + '/orders?page=' + ordersPage + '&limit=15');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    renderOrders(json.data, json.pagination);
  } catch (err) {
    wrap.innerHTML = '<p style="color:var(--red);padding:40px 0">Failed to load: ' + esc(err.message) + '</p>';
  }
}

function renderOrders(orders, pagination) {
  ordersTotalPages = pagination.pages || 1;
  var wrap = document.getElementById('orders-content');
  if (!orders.length) {
    wrap.innerHTML = '<div class="cart-empty"><div class="cart-empty-icon">📋</div>' +
      '<p>No orders yet</p>' +
      '<p style="margin-top:8px;font-size:.85rem"><a href="#" style="color:var(--amber)"' +
      ' onclick="showPage(\'products\');return false;">Start shopping →</a></p></div>';
    return;
  }

  var rows = orders.map(function(o) {
    return '<tr class="order-row" data-ref="' + esc(o.order_ref) + '">' +
      '<td><span class="order-ref-cell">' + esc(o.order_ref) + '</span></td>' +
      '<td><span class="order-phone">'  + esc(formatPhone(o.phone)) + '</span></td>' +
      '<td><span class="order-total">KES ' + fmtPrice(o.total) + '</span></td>' +
      '<td>' + statusPill(o.status) + '</td>' +
      '<td style="color:var(--text-muted);font-size:.82rem">' + fmtDate(o.created_at) + '</td>' +
      '</tr>';
  }).join('');

  wrap.innerHTML =
    '<div class="orders-toolbar">' +
    '<span style="color:var(--text-muted);font-size:.875rem">' + pagination.total + ' order' + (pagination.total !== 1 ? 's' : '') + '</span>' +
    '<button class="btn-refresh" id="btn-refresh-orders">↻ Refresh</button>' +
    '</div>' +
    '<div class="orders-table-wrap"><table class="orders-table">' +
    '<thead><tr><th>Reference</th><th>Phone</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>' +
    '<div class="pagination">' +
    '<button class="pg-btn" id="pg-prev"' + (pagination.page <= 1 ? ' disabled' : '') + '>← Prev</button>' +
    '<span class="pg-info">Page ' + pagination.page + ' of ' + ordersTotalPages + '</span>' +
    '<button class="pg-btn" id="pg-next"' + (pagination.page >= ordersTotalPages ? ' disabled' : '') + '>Next →</button>' +
    '</div>';

  document.getElementById('btn-refresh-orders').addEventListener('click', function() { loadOrders(ordersPage); });
  document.getElementById('pg-prev').addEventListener('click', function() { loadOrders(ordersPage - 1); });
  document.getElementById('pg-next').addEventListener('click', function() { loadOrders(ordersPage + 1); });
  wrap.querySelectorAll('.order-row').forEach(function(row) {
    row.addEventListener('click', function() { openOrderDrawer(row.dataset.ref); });
  });
}

/* ── Order detail drawer ──────────────────────────────────────────── */
async function openOrderDrawer(orderRef) {
  var overlay = document.getElementById('drawer-overlay');
  var body    = document.getElementById('drawer-body');
  document.getElementById('drawer-title').textContent = 'Order ' + orderRef;
  body.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-muted)">' +
    '<div class="spinner" style="margin:0 auto 12px;border-top-color:var(--amber)"></div>Loading…</div>';
  overlay.classList.add('open');
  try {
    const res  = await fetch(API + '/orders/' + encodeURIComponent(orderRef));
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    renderDrawer(json.data);
  } catch (err) {
    body.innerHTML = '<p style="color:var(--red)">Failed to load: ' + esc(err.message) + '</p>';
  }
}

document.getElementById('btn-drawer-close').addEventListener('click', function() {
  document.getElementById('drawer-overlay').classList.remove('open');
});
document.getElementById('drawer-overlay').addEventListener('click', function(e) {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
});

function renderDrawer(order) {
  var body    = document.getElementById('drawer-body');
  var payment = order.payments && order.payments[0];

  var html = '<div class="drawer-section"><h3>Order Info</h3>' +
    dr('Reference', '<span style="font-family:monospace;color:var(--amber)">' + esc(order.order_ref) + '</span>') +
    dr('Status',    statusPill(order.status)) +
    dr('Phone',     esc(formatPhone(order.phone))) +
    dr('Total',     '<span style="color:var(--amber);font-weight:700">KES ' + fmtPrice(order.total) + '</span>') +
    dr('Date',      fmtDate(order.created_at)) +
    '</div>';

  html += '<div class="drawer-section"><h3>Items</h3>' +
    '<table class="drawer-items-table">' +
    '<thead><tr><th>Product</th><th>Qty</th><th>Total</th></tr></thead><tbody>' +
    (order.items || []).map(function(i) {
      return '<tr>' +
        '<td><div style="font-weight:500">' + esc(i.product_name) + '</div>' +
        '<div style="font-size:.78rem;color:var(--text-muted)">' + esc(i.variant_label) + '</div></td>' +
        '<td style="color:var(--text-muted)">× ' + i.quantity + '</td>' +
        '<td>KES ' + fmtPrice(i.line_total) + '</td></tr>';
    }).join('') +
    '</tbody></table></div>';

  if (payment) {
    html += '<div class="drawer-section"><h3>Payment</h3>' +
      dr('Status',  statusPill(payment.status)) +
      dr('Amount',  'KES ' + fmtPrice(payment.amount)) +
      (payment.mpesa_receipt ? dr('M-Pesa Receipt', '<span class="receipt-code">' + esc(payment.mpesa_receipt) + '</span>') : '') +
      (payment.result_desc   ? dr('Note', '<span style="color:var(--text-muted);font-size:.82rem">' + esc(payment.result_desc) + '</span>') : '') +
      dr('Initiated',  fmtDate(payment.initiated_at)) +
      (payment.completed_at ? dr('Completed', fmtDate(payment.completed_at)) : '') +
      '</div>';
  }

  body.innerHTML = html;
}

function dr(label, value) {
  return '<div class="drawer-row"><span class="label">' + label + '</span>' +
         '<span class="value">' + value + '</span></div>';
}

/* ═══════════════════════════════════════════════════════════════════
   UTILS
   ═══════════════════════════════════════════════════════════════════ */
function fmtPrice(n) {
  return Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(raw) {
  if (!raw) return '—';
  return new Date(raw).toLocaleString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatPhone(phone) {
  var s = String(phone || '');
  return (s.startsWith('254') && s.length === 12) ? '0' + s.slice(3) : s;
}

function statusPill(status) {
  var labels = {
    pending: 'Pending', awaiting_payment: 'Awaiting Payment', paid: 'Paid',
    success: 'Paid', failed: 'Failed', cancelled: 'Cancelled',
    timeout: 'Timeout', initiated: 'Initiated',
  };
  return '<span class="pill pill-' + (status || '') + '">' + (labels[status] || status) + '</span>';
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

/* ═══════════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════════ */
(async function init() {
  await loadCart();
  await loadProducts();
  showPage('products');
}());
