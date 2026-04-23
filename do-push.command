#\!/bin/bash
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo ""
echo "📤 Push zu GitHub..."

# SSH Config für GitHub-Alias aktualisieren
mkdir -p ~/.ssh
# Known hosts für github.com und Alias eintragen
ssh-keyscan -H github.com >> ~/.ssh/known_hosts 2>/dev/null
ssh-keyscan -H 140.82.121.4 >> ~/.ssh/known_hosts 2>/dev/null

# StrictHostKeyChecking deaktivieren für diesen Push
export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=no -i $HOME/.ssh/github_assoziationsspiel"

git push -u origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Erfolgreich gepusht\! Railway wird geöffnet..."
  sleep 1
  open "https://railway.app/new"
else
  echo "❌ Push fehlgeschlagen."
fi

read -p ""
