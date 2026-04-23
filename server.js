const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const CATEGORIES = require('./categories');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory state ───────────────────────────────────────────────────────────
const rooms = {}; // roomCode → RoomState

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getRoom(code) {
  return rooms[code] || null;
}

function sanitize(str) {
  return (str || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9äöüß\s]/g, '')
    .trim();
}

// ─── Socket Logic ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // CREATE ROOM
  socket.on('create-room', ({ playerName, customCategories }) => {
    let code;
    do { code = generateCode(); } while (rooms[code]);

    const room = {
      code,
      host: socket.id,
      players: [{
        id: socket.id,
        name: playerName.trim().slice(0, 20),
        score: 0,
        ready: false
      }],
      phase: 'lobby',          // lobby | input | reveal | gameover
      round: 0,
      maxRounds: 10,
      gameMode: 'points',      // 'points' | 'all-for-one'
      currentCategory: null,
      usedCategories: [],
      customCategories: (customCategories || []).filter(c => c.trim()).map(c => c.trim()),
      answers: {},             // socketId → word
      roundHistory: []
    };

    rooms[code] = room;
    socket.join(code);
    socket.emit('room-created', { code, room: roomView(room, socket.id) });
  });

  // JOIN ROOM
  socket.on('join-room', ({ code, playerName }) => {
    const room = getRoom(code.toUpperCase());
    if (!room) return socket.emit('error', { message: 'Raum nicht gefunden.' });
    if (room.phase !== 'lobby') return socket.emit('error', { message: 'Das Spiel läuft bereits.' });
    if (room.players.length >= 8) return socket.emit('error', { message: 'Der Raum ist voll (max. 8 Spieler).' });
    if (room.players.find(p => p.id === socket.id)) return socket.emit('error', { message: 'Du bist bereits im Raum.' });

    const player = {
      id: socket.id,
      name: playerName.trim().slice(0, 20),
      score: 0,
      ready: false
    };
    room.players.push(player);
    socket.join(code);

    socket.emit('room-joined', { code, room: roomView(room, socket.id) });
    socket.to(code).emit('player-joined', { player, players: room.players });
  });

  // ADD CUSTOM CATEGORIES (host only, during lobby)
  socket.on('add-custom-categories', ({ code, categories }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    const newCats = categories.filter(c => c.trim()).map(c => c.trim());
    room.customCategories = [...new Set([...room.customCategories, ...newCats])];
    io.to(code).emit('custom-categories-updated', { customCategories: room.customCategories });
  });

  // REMOVE CUSTOM CATEGORY (host only)
  socket.on('remove-custom-category', ({ code, category }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    room.customCategories = room.customCategories.filter(c => c !== category);
    io.to(code).emit('custom-categories-updated', { customCategories: room.customCategories });
  });

  // SET GAME MODE (host only, during lobby)
  socket.on('set-game-mode', ({ code, gameMode }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id || room.phase !== 'lobby') return;
    room.gameMode = gameMode === 'all-for-one' ? 'all-for-one' : 'points';
    io.to(code).emit('game-mode-updated', { gameMode: room.gameMode });
  });

  // START GAME (host only)
  socket.on('start-game', ({ code, maxRounds, gameMode }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) return socket.emit('error', { message: 'Mindestens 2 Spieler benötigt.' });

    room.gameMode = gameMode === 'all-for-one' ? 'all-for-one' : 'points';

    if (room.gameMode === 'points') {
      room.maxRounds = Math.min(Math.max(parseInt(maxRounds) || 10, 3), 20);
    } else {
      // All-for-one: no round limit — use 999 as safety ceiling
      room.maxRounds = 999;
    }

    room.phase = 'input';
    room.round = 1;
    room.answers = {};

    const category = pickCategory(room);
    room.currentCategory = category;

    io.to(code).emit('game-started', {
      round: room.round,
      maxRounds: room.maxRounds,
      category,
      players: room.players,
      gameMode: room.gameMode
    });
  });

  // SUBMIT WORD
  socket.on('submit-word', ({ code, word }) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'input') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const clean = sanitize(word);
    if (!clean) return socket.emit('error', { message: 'Bitte gib einen Begriff ein.' });

    room.answers[socket.id] = clean;

    // Broadcast how many have answered (without revealing words)
    const answeredCount = Object.keys(room.answers).length;
    io.to(code).emit('answer-count', {
      answered: answeredCount,
      total: room.players.length
    });

    // All answered → reveal
    if (answeredCount >= room.players.length) {
      revealRound(room);
    }
  });

  // NEXT ROUND (host only)
  socket.on('next-round', ({ code }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    if (room.phase !== 'reveal') return;

    let shouldEnd;
    if (room.gameMode === 'all-for-one') {
      // End when full consensus was achieved
      shouldEnd = room.roundHistory.some(r => r.match);
    } else {
      // Points mode: end only after all rounds played
      shouldEnd = room.round >= room.maxRounds;
    }

    if (shouldEnd) {
      endGame(room);
    } else {
      startNextRound(room);
    }
  });

  // PLAY AGAIN (host only)
  socket.on('play-again', ({ code }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    room.phase = 'lobby';
    room.round = 0;
    room.answers = {};
    room.usedCategories = [];
    room.roundHistory = [];
    room.players.forEach(p => { p.score = 0; p.ready = false; });
    io.to(code).emit('back-to-lobby', { room: roomView(room, socket.id) });
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    for (const [code, room] of Object.entries(rooms)) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx === -1) continue;

      room.players.splice(idx, 1);

      if (room.players.length === 0) {
        delete rooms[code];
        return;
      }

      // Transfer host if needed
      if (room.host === socket.id) {
        room.host = room.players[0].id;
        io.to(code).emit('host-changed', { newHost: room.host });
      }

      io.to(code).emit('player-left', {
        id: socket.id,
        players: room.players
      });

      // If game running and now everyone else answered, reveal
      if (room.phase === 'input') {
        delete room.answers[socket.id];
        const answeredCount = Object.keys(room.answers).length;
        if (answeredCount >= room.players.length && room.players.length > 0) {
          revealRound(room);
        }
      }
    }
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pickCategory(room) {
  const pool = [
    ...CATEGORIES,
    ...room.customCategories
  ].filter(c => !room.usedCategories.includes(c));

  if (pool.length === 0) {
    // reset if exhausted
    room.usedCategories = [];
    return pickCategory(room);
  }

  const cat = pool[Math.floor(Math.random() * pool.length)];
  room.usedCategories.push(cat);
  return cat;
}

function revealRound(room) {
  room.phase = 'reveal';

  // Build results: each player's answer
  const answerList = room.players.map(p => ({
    id: p.id,
    name: p.name,
    word: room.answers[p.id] || '—'
  }));

  // Count word occurrences
  const wordCounts = {};
  Object.values(room.answers).forEach(w => {
    wordCounts[w] = (wordCounts[w] || 0) + 1;
  });

  let isMatch = false;
  let matchWord = null;
  let partialMatchWord = null; // for all-for-one: 2+ but not all

  if (room.gameMode === 'all-for-one') {
    // Full match = ALL players wrote exactly the same word
    const validAnswers = room.players
      .map(p => room.answers[p.id])
      .filter(Boolean);
    const allSame = validAnswers.length === room.players.length &&
                    validAnswers.length > 0 &&
                    validAnswers.every(w => w === validAnswers[0]);
    isMatch = allSame;
    matchWord = isMatch ? validAnswers[0] : null;

    // Check for partial match (2+ but not all)
    if (!isMatch) {
      const partial = Object.entries(wordCounts).find(([, count]) => count >= 2);
      partialMatchWord = partial ? partial[0] : null;
    }
    // No points in all-for-one mode
  } else {
    // Points mode: match = at least 2 players wrote the same word
    const matchingEntry = Object.entries(wordCounts).find(([, count]) => count >= 2);
    isMatch = !!matchingEntry;
    matchWord = matchingEntry ? matchingEntry[0] : null;

    // Award points: fewer rounds remaining = more points
    if (isMatch) {
      const pointsThisRound = Math.max(10 - room.round + 1, 1);
      room.players.forEach(p => {
        if (room.answers[p.id] === matchWord) {
          p.score += pointsThisRound;
        }
      });
    }
  }

  const roundResult = {
    round: room.round,
    maxRounds: room.maxRounds,
    category: room.currentCategory,
    answers: answerList,
    isMatch,
    matchWord,
    partialMatchWord,
    players: room.players,
    gameMode: room.gameMode
  };

  room.roundHistory.push({
    round: room.round,
    match: isMatch,
    matchWord,
    category: room.currentCategory
  });
  room.answers = {};

  io.to(room.code).emit('round-result', roundResult);
}

function startNextRound(room) {
  room.phase = 'input';
  room.round++;
  room.answers = {};

  const category = pickCategory(room);
  room.currentCategory = category;

  io.to(room.code).emit('next-round-start', {
    round: room.round,
    maxRounds: room.maxRounds,
    category,
    players: room.players,
    gameMode: room.gameMode
  });
}

function endGame(room) {
  room.phase = 'gameover';

  const sorted = [...room.players].sort((a, b) => b.score - a.score);

  io.to(room.code).emit('game-over', {
    players: sorted,
    roundHistory: room.roundHistory,
    totalRounds: room.round,
    gameMode: room.gameMode
  });
}

function roomView(room, socketId) {
  return {
    code: room.code,
    host: room.host,
    players: room.players,
    phase: room.phase,
    round: room.round,
    maxRounds: room.maxRounds,
    customCategories: room.customCategories,
    isHost: room.host === socketId,
    gameMode: room.gameMode
  };
}

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 Assoziationsspiel läuft auf http://localhost:${PORT}\n`);
});
