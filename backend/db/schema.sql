-- ============================================================
-- Duka App – Full Database Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS duka_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE duka_app;

-- ------------------------------------------------------------
-- products
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120)  NOT NULL,
  description TEXT,
  image_url   VARCHAR(500),
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active (is_active)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- variants
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS variants (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id       INT UNSIGNED NOT NULL,
  label            VARCHAR(120) NOT NULL,          -- e.g. "1 roll", "Packet", "Custom"
  price            DECIMAL(10,2),                  -- NULL = custom-priced variant
  allows_custom    TINYINT(1)  NOT NULL DEFAULT 0, -- 1 = user may enter own price
  custom_min_price DECIMAL(10,2) DEFAULT NULL,     -- minimum for custom price
  is_active        TINYINT(1)  NOT NULL DEFAULT 1,
  sort_order       SMALLINT    NOT NULL DEFAULT 0,
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_variant_product FOREIGN KEY (product_id)
    REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_product (product_id),
  INDEX idx_active  (is_active)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- orders
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_ref       VARCHAR(40)  NOT NULL UNIQUE,   -- human-readable reference
  phone           VARCHAR(20)  NOT NULL,
  subtotal        DECIMAL(10,2) NOT NULL,
  total           DECIMAL(10,2) NOT NULL,
  status          ENUM('pending','awaiting_payment','paid','failed','cancelled')
                  NOT NULL DEFAULT 'pending',
  notes           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_phone  (phone),
  INDEX idx_ref    (order_ref)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- order_items
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id      INT UNSIGNED NOT NULL,
  product_id    INT UNSIGNED NOT NULL,
  variant_id    INT UNSIGNED NOT NULL,
  product_name  VARCHAR(120) NOT NULL,   -- snapshot at purchase time
  variant_label VARCHAR(120) NOT NULL,   -- snapshot
  unit_price    DECIMAL(10,2) NOT NULL,  -- resolved price (incl. custom)
  quantity      SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  line_total    DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_item_order   FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
  CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_variant FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE RESTRICT,
  INDEX idx_order (order_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- payments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id            INT UNSIGNED NOT NULL,
  checkout_request_id VARCHAR(200) NOT NULL UNIQUE, -- Lipana / M-Pesa CheckoutRequestID
  merchant_request_id VARCHAR(200),
  amount              DECIMAL(10,2) NOT NULL,
  phone               VARCHAR(20)   NOT NULL,
  status              ENUM('initiated','success','failed','cancelled','timeout')
                      NOT NULL DEFAULT 'initiated',
  mpesa_receipt       VARCHAR(100),                 -- M-Pesa transaction code
  result_code         VARCHAR(10),
  result_desc         TEXT,
  raw_callback        JSON,                         -- full callback payload
  initiated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at        TIMESTAMP NULL,
  CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_order    (order_id),
  INDEX idx_checkout (checkout_request_id),
  INDEX idx_status   (status)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- cart_items  (server-side cart, keyed by browser-generated cartId)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cart_items (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cart_id      VARCHAR(64)  NOT NULL,          -- browser UUID stored in localStorage
  variant_id   INT UNSIGNED NOT NULL,
  quantity     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  custom_price DECIMAL(10,2) DEFAULT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cart_variant (cart_id, variant_id),
  CONSTRAINT fk_cart_variant FOREIGN KEY (variant_id)
    REFERENCES variants(id) ON DELETE CASCADE,
  INDEX idx_cart_id (cart_id)
) ENGINE=InnoDB;

-- ============================================================
-- Seed data
-- ============================================================

INSERT INTO products (name, description) VALUES
  ('Roll',       'Fresh bread rolls, sold individually or in pairs'),
  ('Ori',        'Ori snacks – individual pieces or full packet'),
  ('Supermatch', 'Supermatch – single stick or full packet'),
  ('Item X',     'Generic product with small, medium, or custom pricing');

-- Roll variants
INSERT INTO variants (product_id, label, price, allows_custom, custom_min_price, sort_order)
SELECT id, '1 Roll',   50.00, 0, NULL, 1 FROM products WHERE name='Roll'
UNION ALL
SELECT id, '2 Rolls',  80.00, 0, NULL, 2 FROM products WHERE name='Roll';

-- Ori variants
INSERT INTO variants (product_id, label, price, allows_custom, custom_min_price, sort_order)
SELECT id, '1 Piece',  10.00, 0, NULL, 1 FROM products WHERE name='Ori'
UNION ALL
SELECT id, '5 Pieces', 42.00, 0, NULL, 2 FROM products WHERE name='Ori'
UNION ALL
SELECT id, 'Packet',  170.00, 0, NULL, 3 FROM products WHERE name='Ori';

-- Supermatch variants
INSERT INTO variants (product_id, label, price, allows_custom, custom_min_price, sort_order)
SELECT id, 'Single',   5.00, 0, NULL, 1 FROM products WHERE name='Supermatch'
UNION ALL
SELECT id, 'Packet',  90.00, 0, NULL, 2 FROM products WHERE name='Supermatch';

-- Item X variants
INSERT INTO variants (product_id, label, price, allows_custom, custom_min_price, sort_order)
SELECT id, 'Small',    30.00, 0,    NULL, 1 FROM products WHERE name='Item X'
UNION ALL
SELECT id, 'Medium',  200.00, 0,    NULL, 2 FROM products WHERE name='Item X'
UNION ALL
SELECT id, 'Custom',    NULL, 1, 200.00,  3 FROM products WHERE name='Item X';
