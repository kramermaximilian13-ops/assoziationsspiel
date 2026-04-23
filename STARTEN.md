# 🧠 Assoziationsspiel

Multiplayer-Webspiel: Kommt auf denselben Begriff – in so wenig Runden wie möglich!

## Schnellstart

```bash
# In diesen Ordner navigieren:
cd association-game

# Server starten:
npm start

# Dann im Browser öffnen:
# http://localhost:3000
```

## Für Entwicklung (auto-reload bei Änderungen):

```bash
npm run dev
```

## Wie funktioniert das Spiel?

1. **Raum erstellen** – Host gibt seinen Namen ein und erstellt einen Raum
2. **Code teilen** – Alle Mitspieler geben denselben 5-stelligen Code ein
3. **Einstellungen** – Host kann Rundenanzahl (3–20) und eigene Kategorien festlegen
4. **Spielen** – Eine Kategorie erscheint, alle tippen gleichzeitig einen Begriff
5. **Reveal** – Alle Antworten werden aufgedeckt – wer hat dasselbe geschrieben?
6. **Ziel** – In möglichst wenigen Runden zur Übereinstimmung kommen

## Als App installieren (PWA)

- **Mobile**: Im Browser öffnen → "Zum Homescreen hinzufügen"
- **Desktop Chrome**: Adressleiste → Install-Icon rechts

## Im Netzwerk spielen

Damit andere Geräte im selben WLAN mitspielen können:

```bash
# Deine lokale IP herausfinden:
ipconfig getifaddr en0   # macOS
hostname -I              # Linux

# Dann mit dieser IP starten:
PORT=3000 npm start

# Mitspieler öffnen: http://DEINE-IP:3000
```

## Projektstruktur

```
association-game/
├── server.js          ← Express + Socket.io Backend
├── categories.js      ← 60+ vordefinierte Kategorien
├── package.json
└── public/
    ├── index.html     ← Alle Views (Landing, Lobby, Game, Reveal, Ende)
    ├── style.css      ← Modern & Clean Design (Dark Mode inklusive)
    ├── app.js         ← Client-Logik & Socket-Events
    ├── manifest.json  ← PWA Manifest
    └── sw.js          ← Service Worker
```
