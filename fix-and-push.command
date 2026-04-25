#!/bin/bash
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo ""
echo "🔧 Git-Locks entfernen..."
rm -f .git/index.lock .git/HEAD.lock .git/refs/heads/main.lock

echo "📦 Änderungen hinzufügen..."
git add -A

echo "💾 Commit erstellen..."
git commit -m "fix: fuzzy matching, Web Audio sounds, visible sound button, cache bust

- Fuzzy word matching: typos and plurals now count as the same answer
- Sounds now use Web Audio API (no CDN dependency, always works)
- Sound button moved to top-right, always visible on all screens
- Service worker cache bumped to v3 (forces fresh JS/CSS for all users)"

echo ""
echo "📤 Push zu GitHub..."
export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=no -i $HOME/.ssh/github_assoziationsspiel"
git push -u origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Fertig! Deployment läuft auf Railway..."
  sleep 1
  open "https://assoziationsspiel-production.up.railway.app"
else
  echo "❌ Push fehlgeschlagen."
fi

read -p "Drücke Enter zum Schließen..."
