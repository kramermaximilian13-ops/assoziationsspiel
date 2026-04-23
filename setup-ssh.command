#!/bin/bash
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

KEY_FILE="$HOME/.ssh/github_assoziationsspiel"

echo ""
echo "🔑 SSH-Key wird generiert..."

# SSH-Key generieren (keine Passphrase, vollautomatisch)
ssh-keygen -t ed25519 -C "kramermaximilian13@gmail.com" -f "$KEY_FILE" -N "" -q

# SSH-Config einrichten
mkdir -p ~/.ssh
cat >> ~/.ssh/config << EOF

Host github-assoz
  HostName github.com
  User git
  IdentityFile $KEY_FILE
  IdentitiesOnly yes
EOF

# Remote auf SSH umstellen
git remote set-url origin "git@github-assoz:kramermaximilian13-ops/assoziationsspiel.git"

# Public Key in Zwischenablage kopieren
pbcopy < "${KEY_FILE}.pub"

echo ""
echo "✅ SSH-Key generiert & in Zwischenablage kopiert!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PUBLIC KEY (auch in Zwischenablage):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cat "${KEY_FILE}.pub"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "GitHub SSH-Settings werden geöffnet..."
sleep 1
open "https://github.com/settings/ssh/new"
echo ""
read -p "Sobald du den Key auf GitHub hinzugefügt hast, Enter drücken..."
echo ""
echo "📤 Code wird gepusht..."
git push -u origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Erfolgreich auf GitHub gepusht!"
  echo "🚂 Railway wird geöffnet..."
  sleep 1
  open "https://railway.app/new"
else
  echo "❌ Push fehlgeschlagen – bitte Claude bescheid geben."
fi
echo ""
read -p "Enter drücken zum Schließen..."
