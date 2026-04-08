#!/usr/bin/env bash
# ================================================================
# Duka App – first-time setup helper
# Usage: bash setup.sh
# ================================================================
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[duka]${NC} $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $1"; }
error() { echo -e "${RED}[error]${NC} $1"; exit 1; }

echo ""
echo "  🛍️  Duka App Setup"
echo "  ─────────────────────────────────"
echo ""

# ── 1. Node version ───────────────────────────────────────────
NODE_VERSION=$(node -v 2>/dev/null || echo "not found")
if [[ "$NODE_VERSION" == "not found" ]]; then
  error "Node.js is not installed. Install v18+ from https://nodejs.org"
fi
info "Node.js $NODE_VERSION detected"

# ── 2. .env ───────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  cp .env.example .env
  warn ".env created from .env.example — edit it with your credentials before starting!"
else
  info ".env already exists"
fi

# ── 3. npm install ────────────────────────────────────────────
info "Installing backend dependencies…"
cd backend
npm install --silent
cd ..
info "Dependencies installed"

# ── 4. DB migration ──────────────────────────────────────────
info "Running database migration…"
info "(Make sure MySQL is running and DB credentials in .env are correct)"
cd backend
node migrate.js && cd .. || { warn "Migration failed – check DB credentials in .env and retry: node backend/migrate.js"; cd ..; }

# ── 5. Done ───────────────────────────────────────────────────
echo ""
echo "  ✅  Setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Set LIPANA_SECRET_KEY in .env"
echo "    2. Start ngrok:  ngrok http 3000"
echo "    3. Copy ngrok URL → CALLBACK_URL in .env"
echo "    4. Start server: cd backend && npm run dev"
echo "    5. Open browser: http://localhost:3000"
echo ""
