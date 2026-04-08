'use strict';
/**
 * node migrate.js
 *
 * Runs schema.sql against the configured MySQL database.
 * Safe to re-run – uses CREATE TABLE IF NOT EXISTS / INSERT IGNORE.
 */

require('dotenv').config();
const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');

const schemaPath = path.join(__dirname, 'db', 'schema.sql');

async function migrate() {
  console.log('🔄  Running database migration…\n');

  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');

    // Split on semicolons but ignore empty statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    let ok = 0;
    for (const stmt of statements) {
      try {
        await conn.query(stmt);
        const firstLine = stmt.split('\n')[0].slice(0, 70);
        console.log(`  ✅  ${firstLine}`);
        ok++;
      } catch (err) {
        // Warn but continue – duplicate key on seed data is expected on re-runs
        if (err.code === 'ER_DUP_ENTRY') {
          console.log(`  ⏭   Skipped (duplicate): ${stmt.split('\n')[0].slice(0, 60)}`);
        } else {
          console.error(`  ❌  Failed: ${err.message}`);
          console.error(`      Statement: ${stmt.slice(0, 120)}`);
        }
      }
    }

    console.log(`\n✅  Migration complete – ${ok} statements executed.\n`);
  } finally {
    await conn.end();
  }
}

migrate().catch(err => {
  console.error('Fatal migration error:', err.message);
  process.exit(1);
});
