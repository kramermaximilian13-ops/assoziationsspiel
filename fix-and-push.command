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
git commit -m "feat: emoji reactions, category voting, configurable timer

- Kategorie-Abstimmung: 3 zufällige Kategorien zur Abstimmung pro Runde (Punkte-Modus)
- Emoji Reaktionen: 6 Emojis (🔥😂👏😅🎉💀) auf Reveal- und Game-Over-Screen
- Konfigurierbarer Eingabe-Timer: 10s / 20s / 30s / 60s / Unbegrenzt
- Service Worker auf v4 (zwingt frisches JS/CSS)"

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
