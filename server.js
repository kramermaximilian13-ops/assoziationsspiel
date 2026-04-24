const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const CATEGORIES = require('./categories');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Constants ─────────────────────────────────────────────────────────────────
const ROUND_TIMER_MS   = 10_000;  // 10 s after first answer
const GRACE_PERIOD_MS  = 30_000;  // 30 s to reconnect before removal

// ─── In-memory state ───────────────────────────────────────────────────────────
const rooms            = {};       // roomCode → RoomState
const roundTimers      = new Map(); // roomCode → timeoutId
const gracePeriodTimers = new Map(); // oldSocketId → { code, timerId, player }

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function getRoom(code) { return rooms[code] || null; }

function sanitize(str) {
  return (str || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
      disconnectedPlayers: [],   // players in grace period
      phase: 'lobby',
      round: 0,
      maxRounds: 10,
      gameMode: 'points',        // 'points' | 'all-for-one'
      currentCategory: null,
      usedCategories: [],
      customCategories: (customCategories || []).filter(c => c.trim()).map(c => c.trim()),
      answers: {},
      roundHistory: []
    };

    rooms[code] = room;
    socket.join(code);
    socket.emit('room-created', { code, room: roomView(room, socket.id) });
  });

  // JOIN ROOM
  socket.on('join-room', ({ code, playerName }) => {
    const upperCode = code.toUpperCase();
    const room = getRoom(upperCode);
    if (!room) return socket.emit('error', { message: 'Raum nicht gefunden.' });

    const cleanName = playerName.trim().slice(0, 20);

    // ── Reconnect: check active players first ─────────────────────────────
    const activePlayer = room.players.find(p => p.name === cleanName && p.id !== socket.id);
    if (activePlayer) {
      const oldId = activePlayer.id;
      if (room.host === oldId) room.host = socket.id;
      activePlayer.id = socket.id;
      socket.join(upperCode);
      socket.emit('room-joined', { code: room.code, room: roomView(room, socket.id) });
      io.to(room.code).emit('player-joined', { player: activePlayer, players: room.players });
      return;
    }

    // ── Reconnect from grace period ───────────────────────────────────────
    const disconnected = room.disconnectedPlayers.find(p => p.name === cleanName);
    if (disconnected) {
      const oldId = disconnected.id;

      // Cancel removal timer
      if (gracePeriodTimers.has(oldId)) {
        clearTimeout(gracePeriodTimers.get(oldId).timerId);
        gracePeriodTimers.delete(oldId);
      }

      // Restore to active players
      room.disconnectedPlayers = room.disconnectedPlayers.filter(p => p !== disconnected);
      disconnected.id = socket.id;
      room.players.push(disconnected);
      if (room.host === oldId) room.host = socket.id;

      socket.join(upperCode);
      socket.emit('room-joined', { code: room.code, room: roomView(room, socket.id) });
      io.to(room.code).emit('player-joined', { player: disconnected, players: room.players });
      return;
    }

    // ── New player: only allowed in lobby ─────────────────────────────────
    if (room.phase !== 'lobby') return socket.emit('error', { message: 'Das Spiel läuft bereits.' });
    if (room.players.length >= 8) return socket.emit('error', { message: 'Der Raum ist voll (max. 8 Spieler).' });

    const player = { id: socket.id, name: cleanName, score: 0, ready: false };
    room.players.push(player);
    socket.join(upperCode);

    socket.emit('room-joined', { code: room.code, room: roomView(room, socket.id) });
    socket.to(room.code).emit('player-joined', { player, players: room.players });
  });

  // ADD CUSTOM CATEGORIES (host only)
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

  // SET GAME MODE (host only, lobby only)
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
    room.maxRounds = room.gameMode === 'points'
      ? Math.min(Math.max(parseInt(maxRounds) || 10, 3), 20)
      : 999;

    room.phase = 'input';
    room.round = 1;
    room.answers = {};

    // All for One: no category — players converge from scratch
    if (room.gameMode === 'all-for-one') {
      room.currentCategory = null;
    } else {
      room.currentCategory = pickCategory(room);
    }

    io.to(code).emit('game-started', {
      round: room.round,
      maxRounds: room.maxRounds,
      category: room.currentCategory,
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
    if (room.answers[socket.id] !== undefined) return; // already submitted

    const clean = sanitize(word);
    if (!clean) return socket.emit('error', { message: 'Bitte gib einen Begriff ein.' });

    room.answers[socket.id] = clean;

    const answeredCount = Object.keys(room.answers).length;

    // First answer → start 10-second round timer
    if (answeredCount === 1 && !roundTimers.has(code)) {
      const timerId = setTimeout(() => {
        roundTimers.delete(code);
        if (room.phase === 'input') revealRound(room);
      }, ROUND_TIMER_MS);
      roundTimers.set(code, timerId);
      io.to(code).emit('round-timer-start', { seconds: ROUND_TIMER_MS / 1000 });
    }

    io.to(code).emit('answer-count', {
      answered: answeredCount,
      total: room.players.length
    });

    // All answered → reveal immediately
    if (answeredCount >= room.players.length) {
      clearRoundTimer(code);
      revealRound(room);
    }
  });

  // NEXT ROUND (host only)
  socket.on('next-round', ({ code }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id || room.phase !== 'reveal') return;

    const shouldEnd = room.gameMode === 'all-for-one'
      ? room.roundHistory.some(r => r.match)
      : room.round >= room.maxRounds;

    if (shouldEnd) endGame(room);
    else startNextRound(room);
  });

  // PLAY AGAIN (host only)
  socket.on('play-again', ({ code }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    clearRoundTimer(code);
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

      const player = room.players.splice(idx, 1)[0];

      // Notify others immediately
      io.to(code).emit('player-left', { id: socket.id, players: room.players });

      // Empty room → clean up
      if (room.players.length === 0 && room.disconnectedPlayers.length === 0) {
        clearRoundTimer(code);
        delete rooms[code];
        return;
      }

      // Transfer host if needed (pick from active players)
      if (room.host === socket.id && room.players.length > 0) {
        room.host = room.players[0].id;
        io.to(code).emit('host-changed', { newHost: room.host });
      }

      // Remove their pending answer; check if everyone else finished
      if (room.phase === 'input') {
        delete room.answers[socket.id];
        if (room.players.length > 0 &&
            Object.keys(room.answers).length >= room.players.length) {
          clearRoundTimer(code);
          revealRound(room);
        }
      }

      // Grace period: keep player data for 30 s so they can rejoin
      room.disconnectedPlayers.push(player);
      const timerId = setTimeout(() => {
        gracePeriodTimers.delete(socket.id);
        room.disconnectedPlayers = room.disconnectedPlayers.filter(p => p !== player);
        // If room is now fully empty, clean it up
        if (room.players.length === 0 && room.disconnectedPlayers.length === 0) {
          clearRoundTimer(code);
          delete rooms[code];
        }
      }, GRACE_PERIOD_MS);

      gracePeriodTimers.set(socket.id, { code, timerId, player });
      break;
    }
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clearRoundTimer(code) {
  if (roundTimers.has(code)) {
    clearTimeout(roundTimers.get(code));
    roundTimers.delete(code);
  }
}

function pickCategory(room) {
  const pool = [...CATEGORIES, ...room.customCategories]
    .filter(c => !room.usedCategories.includes(c));
  if (pool.length === 0) {
    room.usedCategories = [];
    return pickCategory(room);
  }
  const cat = pool[Math.floor(Math.random() * pool.length)];
  room.usedCategories.push(cat);
  return cat;
}

function revealRound(room) {
  clearRoundTimer(room.code);
  room.phase = 'reveal';

  const answerList = room.players.map(p => ({
    id: p.id,
    name: p.name,
    word: room.answers[p.id] || '—'
  }));

  const wordCounts = {};
  Object.values(room.answers).forEach(w => {
    wordCounts[w] = (wordCounts[w] || 0) + 1;
  });

  let isMatch = false, matchWord = null, partialMatchWord = null;

  if (room.gameMode === 'all-for-one') {
    const validAnswers = room.players
      .map(p => room.answers[p.id])
      .filter(Boolean);
    const allSame = validAnswers.length === room.players.length &&
                    validAnswers.length > 0 &&
                    validAnswers.every(w => w === validAnswers[0]);
    isMatch = allSame;
    matchWord = isMatch ? validAnswers[0] : null;

    if (!isMatch) {
      const partial = Object.entries(wordCounts).find(([, count]) => count >= 2);
      partialMatchWord = partial ? partial[0] : null;
    }
  } else {
    const matchEntry = Object.entries(wordCounts).find(([, count]) => count >= 2);
    isMatch = !!matchEntry;
    matchWord = matchEntry ? matchEntry[0] : null;

    if (isMatch) {
      const pts = Math.max(10 - room.round + 1, 1);
      room.players.forEach(p => {
        if (room.answers[p.id] === matchWord) p.score += pts;
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
  clearRoundTimer(room.code);
  room.phase = 'input';
  room.round++;
  room.answers = {};

  room.currentCategory = room.gameMode === 'all-for-one' ? null : pickCategory(room);

  io.to(room.code).emit('next-round-start', {
    round: room.round,
    maxRounds: room.maxRounds,
    category: room.currentCategory,
    players: room.players,
    gameMode: room.gameMode
  });
}

function endGame(room) {
  clearRoundTimer(room.code);
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
