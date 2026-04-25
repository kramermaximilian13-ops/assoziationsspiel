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
git commit -m "feat: background music playlist (6 tracks)

- Added 6 MP3 tracks to music/ folder (track1-track6.mp3)
- PLAYLIST in app.js now references all 6 tracks
- Music auto-starts on first user interaction, loops through all tracks shuffled"

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
