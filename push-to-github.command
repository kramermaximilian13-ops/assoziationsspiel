#!/bin/bash
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

REPO_URL="https://github.com/kramermaximilian13-ops/assoziationsspiel.git"

echo ""
echo "🚀 Code wird auf GitHub gepusht..."
echo "────────────────────────────────────────"

# Git konfigurieren falls nötig
if [ -z "$(git config --global user.email)" ]; then
  git config --global user.email "kramermaximilian13@gmail.com"
  git config --global user.name "Maximilian"
fi

# Repo initialisieren falls nötig
if [ ! -d ".git" ]; then
  git init
  git branch -M main
fi

# Remote setzen
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"

# Alles hinzufügen und committen
git add -A
git commit -m "🧠 Assoziationsspiel – initial commit" 2>/dev/null || true

# Push
echo ""
echo "📤 Pushe zu GitHub..."
echo "   (GitHub fragt nach deinem Passwort/Token)"
echo ""
git push -u origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Erfolgreich gepusht!"
  echo ""
  echo "🚂 Railway wird geöffnet..."
  sleep 1
  open "https://railway.app/new"
else
  echo ""
  echo "⚠️  Push fehlgeschlagen."
  echo ""
  echo "GitHub benötigt einen Personal Access Token statt Passwort."
  echo "Öffne: https://github.com/settings/tokens/new"
  echo "→ Note: 'railway-deploy', Scope: 'repo' anklicken → Generate"
  echo "→ Den Token als Passwort eingeben"
  echo ""
  open "https://github.com/settings/tokens/new?description=railway-deploy&scopes=repo"
fi

echo ""
read -p "Enter drücken zum Schließen..."
