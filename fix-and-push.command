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
git commit -m "fix: disconnect grace period, 10s round timer, All for One no-category, cleaner mode selector

- Players now have 30s grace period to reconnect (no more lobby kicks)
- 10s countdown starts after first answer is submitted
- All for One: no category shown - converge on any word freely
- Mode selector redesigned as clean segmented control
- Game screen shows countdown bar when timer is running"

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
