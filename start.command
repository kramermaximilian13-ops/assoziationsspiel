#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "🧠 Assoziationsspiel"
echo "────────────────────────────────────────"

# ── Node.js prüfen ────────────────────────────────────────────────────────────
# nvm-Pfade laden (falls schon installiert)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Homebrew node
[ -f "/opt/homebrew/bin/node" ]  && export PATH="/opt/homebrew/bin:$PATH"
[ -f "/usr/local/bin/node" ]     && export PATH="/usr/local/bin:$PATH"

if ! command -v node &> /dev/null; then
  echo ""
  echo "⚙️  Node.js nicht gefunden – wird jetzt installiert (einmalig, ~1 Minute)..."
  echo ""

  # nvm installieren
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash

  # nvm sofort laden
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

  # Node 22 LTS installieren
  nvm install 22
  nvm use 22
  nvm alias default 22

  echo ""
  echo "✅ Node.js installiert: $(node -v)"
  echo ""
fi

echo "✅ Node.js: $(node -v)"

# ── Dependencies prüfen ───────────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "📦 Installiere Dependencies (einmalig)..."
  npm install
fi

# ── Browser öffnen ────────────────────────────────────────────────────────────
(sleep 1.5 && open http://localhost:3000) &

echo ""
echo "🚀 Server läuft → http://localhost:3000"
echo "   Browser öffnet sich automatisch..."
echo ""
echo "   Zum Beenden: Ctrl+C"
echo "────────────────────────────────────────"
echo ""

node server.js
