'use strict';

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
const GRACE_PERIOD_MS  = 30_000;
const VOTING_TIMER_MS  = 10_000;
const ALLOWED_EMOJIS   = ['🔥', '😂', '👏', '😅', '🎉', '💀'];

// ─── In-memory state ───────────────────────────────────────────────────────────
const rooms             = {};
const roundTimers       = new Map();
const votingTimers      = new Map();
const gracePeriodTimers = new Map();

// ─── Utilities ─────────────────────────────────────────────────────────────────

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
    .replace(/\s+/g, ' ')
    .trim();
}

function clearRoundTimer(code) {
  if (roundTimers.has(code)) { clearTimeout(roundTimers.get(code)); roundTimers.delete(code); }
}

function clearVotingTimer(code) {
  if (votingTimers.has(code)) { clearTimeout(votingTimers.get(code)); votingTimers.delete(code); }
}

// ─── Fuzzy Matching ────────────────────────────────────────────────────────────

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function fuzzyMatch(a, b) {
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  if (len < 4) return false;
  const maxDist = len <= 6 ? 1 : 2;
  return levenshtein(a, b) <= maxDist;
}

function fuzzyGroups(answers) {
  const groups = [];
  for (const [id, word] of Object.entries(answers)) {
    if (!word) continue;
    const hit = groups.find(g => fuzzyMatch(word, g.canonical));
    if (hit) hit.playerIds.push(id);
    else groups.push({ canonical: word, playerIds: [id] });
  }
  return groups;
}

// ─── Room View ─────────────────────────────────────────────────────────────────

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
    gameMode: room.gameMode,
    inputTimerMs: room.inputTimerMs
  };
}

// ─── Category Helpers ──────────────────────────────────────────────────────────

function getPool(room) {
  let pool = [...CATEGORIES, ...room.customCategories]
    .filter(c => !room.usedCategories.includes(c));
  if (pool.length === 0) {
    room.usedCategories = [];
    pool = [...CATEGORIES, ...room.customCategories];
  }
  return pool;
}

function pickThreeCandidates(room) {
  const pool = getPool(room);
  const copy = [...pool];
  const candidates = [];
  while (candidates.length < 3 && copy.length > 0) {
    const i = Math.floor(Math.random() * copy.length);
    candidates.push(copy.splice(i, 1)[0]);
  }
  while (candidates.length < 3) candidates.push(candidates[0]); // pad if <3
  return candidates;
}

// ─── Game Flow Functions ───────────────────────────────────────────────────────

function startVoting(room) {
  clearVotingTimer(room.code);
  room.phase = 'voting';
  room.votes = {};

  const candidates = pickThreeCandidates(room);
  room.votingCandidates = candidates;

  io.to(room.code).emit('voting-start', {
    round: room.round,
    maxRounds: room.maxRounds,
    candidates,
    seconds: VOTING_TIMER_MS / 1000
  });

  const timerId = setTimeout(() => {
    votingTimers.delete(room.code);
    if (room.phase === 'voting') resolveVoting(room);
  }, VOTING_TIMER_MS);
  votingTimers.set(room.code, timerId);
}

function resolveVoting(room) {
  clearVotingTimer(room.code);
  if (room.phase !== 'voting') return;

  // Count votes per candidate
  const counts = [0, 0, 0];
  for (const vote of Object.values(room.votes)) {
    if (Number.isInteger(vote) && vote >= 0 && vote < 3) counts[vote]++;
  }

  // Resolve ties randomly
  const maxVotes = Math.max(...counts);
  const tied = counts.map((c, i) => c === maxVotes ? i : -1).filter(i => i >= 0);
  const winnerIdx = tied[Math.floor(Math.random() * tied.length)];
  const category = room.votingCandidates[winnerIdx] || room.votingCandidates[0];

  room.currentCategory = category;
  room.usedCategories.push(category);
  room.phase = 'input';
  room.answers = {};

  io.to(room.code).emit('voting-result', {
    winnerIdx,
    category,
    counts,
    round: room.round,
    maxRounds: room.maxRounds,
    players: room.players,
    gameMode: room.gameMode,
    inputTimerMs: room.inputTimerMs
  });
}

function revealRound(room) {
  clearRoundTimer(room.code);
  room.phase = 'reveal';

  const answerList = room.players.map(p => ({
    id: p.id, name: p.name, word: room.answers[p.id] || '—'
  }));

  const groups = fuzzyGroups(room.answers);
  groups.sort((a, b) => b.playerIds.length - a.playerIds.length);
  const bestGroup = groups[0] || { canonical: null, playerIds: [] };

  let isMatch = false, matchWord = null, partialMatchWord = null;

  if (room.gameMode === 'all-for-one') {
    const answeredCount = Object.values(room.answers).filter(Boolean).length;
    isMatch = answeredCount === room.players.length &&
              answeredCount > 0 &&
              bestGroup.playerIds.length === room.players.length;
    matchWord = isMatch ? bestGroup.canonical : null;
    if (!isMatch && bestGroup.playerIds.length >= 2) partialMatchWord = bestGroup.canonical;
  } else {
    isMatch = bestGroup.playerIds.length >= 2;
    matchWord = isMatch ? bestGroup.canonical : null;
    if (isMatch) {
      const pts = Math.max(10 - room.round + 1, 1);
      room.players.forEach(p => {
        if (bestGroup.playerIds.includes(p.id)) p.score += pts;
      });
    }
  }

  room.roundHistory.push({ round: room.round, match: isMatch, matchWord, category: room.currentCategory });
  room.answers = {};

  io.to(room.code).emit('round-result', {
    round: room.round, maxRounds: room.maxRounds,
    category: room.currentCategory, answers: answerList,
    isMatch, matchWord, partialMatchWord, players: room.players, gameMode: room.gameMode
  });
}

function startNextRound(room) {
  clearRoundTimer(room.code);
  clearVotingTimer(room.code);
  room.round++;
  room.answers = {};

  if (room.gameMode === 'all-for-one') {
    room.phase = 'input';
    room.currentCategory = null;
    io.to(room.code).emit('next-round-start', {
      round: room.round, maxRounds: room.maxRounds,
      category: null, players: room.players,
      gameMode: room.gameMode, inputTimerMs: room.inputTimerMs
    });
  } else {
    startVoting(room);
  }
}

function endGame(room) {
  clearRoundTimer(room.code);
  clearVotingTimer(room.code);
  room.phase = 'gameover';
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  io.to(room.code).emit('game-over', {
    players: sorted, roundHistory: room.roundHistory,
    totalRounds: room.round, gameMode: room.gameMode
  });
}

// ─── Socket Logic ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── CREATE ROOM ──────────────────────────────────────────────────────────────
  socket.on('create-room', ({ playerName, customCategories }) => {
    let code;
    do { code = generateCode(); } while (rooms[code]);

    const room = {
      code, host: socket.id,
      players: [{ id: socket.id, name: playerName.trim().slice(0, 20), score: 0, ready: false }],
      disconnectedPlayers: [],
      phase: 'lobby', round: 0, maxRounds: 10,
      gameMode: 'points', inputTimerMs: 20_000,
      currentCategory: null, usedCategories: [],
      customCategories: (customCategories || []).filter(c => c.trim()).map(c => c.trim()),
      answers: {}, roundHistory: [],
      votingCandidates: [], votes: {}
    };

    rooms[code] = room;
    socket.join(code);
    socket.emit('room-created', { code, room: roomView(room, socket.id) });
  });

  // ── JOIN ROOM ────────────────────────────────────────────────────────────────
  socket.on('join-room', ({ code, playerName }) => {
    const upperCode = code.toUpperCase();
    const room = getRoom(upperCode);
    if (!room) return socket.emit('error', { message: 'Raum nicht gefunden.' });

    const cleanName = playerName.trim().slice(0, 20);

    // Reconnect: active player with same name
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

    // Reconnect from grace period
    const disconnected = room.disconnectedPlayers.find(p => p.name === cleanName);
    if (disconnected) {
      const oldId = disconnected.id;
      if (gracePeriodTimers.has(oldId)) {
        clearTimeout(gracePeriodTimers.get(oldId).timerId);
        gracePeriodTimers.delete(oldId);
      }
      room.disconnectedPlayers = room.disconnectedPlayers.filter(p => p !== disconnected);
      disconnected.id = socket.id;
      room.players.push(disconnected);
      if (room.host === oldId) room.host = socket.id;
      socket.join(upperCode);
      socket.emit('room-joined', { code: room.code, room: roomView(room, socket.id) });
      io.to(room.code).emit('player-joined', { player: disconnected, players: room.players });
      return;
    }

    // New player — lobby only
    if (room.phase !== 'lobby') return socket.emit('error', { message: 'Das Spiel läuft bereits.' });
    if (room.players.length >= 8) return socket.emit('error', { message: 'Der Raum ist voll (max. 8 Spieler).' });

    const player = { id: socket.id, name: cleanName, score: 0, ready: false };
    room.players.push(player);
    socket.join(upperCode);
    socket.emit('room-joined', { code: room.code, room: roomView(room, socket.id) });
    socket.to(room.code).emit('player-joined', { player, players: room.players });
  });

  // ── LOBBY SETTINGS ───────────────────────────────────────────────────────────

  socket.on('add-custom-categories', ({ code, categories }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    const newCats = categories.filter(c => c.trim()).map(c => c.trim());
    room.customCategories = [...new Set([...room.customCategories, ...newCats])];
    io.to(code).emit('custom-categories-updated', { customCategories: room.customCategories });
  });

  socket.on('remove-custom-category', ({ code, category }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    room.customCategories = room.customCategories.filter(c => c !== category);
    io.to(code).emit('custom-categories-updated', { customCategories: room.customCategories });
  });

  socket.on('set-game-mode', ({ code, gameMode }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id || room.phase !== 'lobby') return;
    room.gameMode = gameMode === 'all-for-one' ? 'all-for-one' : 'points';
    io.to(code).emit('game-mode-updated', { gameMode: room.gameMode });
  });

  socket.on('set-input-timer', ({ code, ms }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id || room.phase !== 'lobby') return;
    const valid = [0, 10_000, 20_000, 30_000, 60_000];
    if (!valid.includes(ms)) return;
    room.inputTimerMs = ms;
    io.to(code).emit('input-timer-updated', { inputTimerMs: ms });
  });

  // ── REACTIONS ────────────────────────────────────────────────────────────────

  socket.on('send-reaction', ({ code, emoji }) => {
    const room = getRoom(code);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const safeEmoji = ALLOWED_EMOJIS.includes(emoji) ? emoji : '🔥';
    io.to(code).emit('reaction-received', { emoji: safeEmoji, name: player.name });
  });

  // ── VOTING ───────────────────────────────────────────────────────────────────

  socket.on('cast-vote', ({ code, candidateIdx }) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'voting') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || room.votes[socket.id] !== undefined) return;

    room.votes[socket.id] = candidateIdx;
    io.to(code).emit('vote-count', {
      votes: Object.keys(room.votes).length,
      total: room.players.length
    });

    if (Object.keys(room.votes).length >= room.players.length) resolveVoting(room);
  });

  // ── START GAME ───────────────────────────────────────────────────────────────

  socket.on('start-game', ({ code, maxRounds, gameMode }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) return socket.emit('error', { message: 'Mindestens 2 Spieler benötigt.' });

    room.gameMode = gameMode === 'all-for-one' ? 'all-for-one' : 'points';
    room.maxRounds = room.gameMode === 'points'
      ? Math.min(Math.max(parseInt(maxRounds) || 10, 3), 20)
      : 999;

    room.round = 1;
    room.answers = {};

    if (room.gameMode === 'all-for-one') {
      room.phase = 'input';
      room.currentCategory = null;
      io.to(code).emit('game-started', {
        round: room.round, maxRounds: room.maxRounds,
        category: null, players: room.players,
        gameMode: room.gameMode, inputTimerMs: room.inputTimerMs
      });
    } else {
      // Points mode → category voting first
      startVoting(room);
    }
  });

  // ── SUBMIT WORD ──────────────────────────────────────────────────────────────

  socket.on('submit-word', ({ code, word }) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'input') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || room.answers[socket.id] !== undefined) return;

    const clean = sanitize(word);
    if (!clean) return socket.emit('error', { message: 'Bitte gib einen Begriff ein.' });

    room.answers[socket.id] = clean;
    const answeredCount = Object.keys(room.answers).length;

    // First answer → start round timer (if not unlimited)
    if (answeredCount === 1 && !roundTimers.has(code) && room.inputTimerMs > 0) {
      const timerId = setTimeout(() => {
        roundTimers.delete(code);
        if (room.phase === 'input') revealRound(room);
      }, room.inputTimerMs);
      roundTimers.set(code, timerId);
      io.to(code).emit('round-timer-start', { seconds: room.inputTimerMs / 1000 });
    }

    io.to(code).emit('answer-count', { answered: answeredCount, total: room.players.length });

    if (answeredCount >= room.players.length) {
      clearRoundTimer(code);
      revealRound(room);
    }
  });

  // ── NEXT ROUND ───────────────────────────────────────────────────────────────

  socket.on('next-round', ({ code }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id || room.phase !== 'reveal') return;

    const shouldEnd = room.gameMode === 'all-for-one'
      ? room.roundHistory.some(r => r.match)
      : room.round >= room.maxRounds;

    if (shouldEnd) endGame(room);
    else startNextRound(room);
  });

  // ── PLAY AGAIN ───────────────────────────────────────────────────────────────

  socket.on('play-again', ({ code }) => {
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    clearRoundTimer(code);
    clearVotingTimer(code);
    room.phase = 'lobby'; room.round = 0; room.answers = {};
    room.usedCategories = []; room.roundHistory = [];
    room.votingCandidates = []; room.votes = {};
    room.players.forEach(p => { p.score = 0; p.ready = false; });
    io.to(code).emit('back-to-lobby', { room: roomView(room, socket.id) });
  });

  // ── DISCONNECT ───────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    for (const [code, room] of Object.entries(rooms)) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx === -1) continue;

      const player = room.players.splice(idx, 1)[0];
      io.to(code).emit('player-left', { id: socket.id, players: room.players });

      if (room.players.length === 0 && room.disconnectedPlayers.length === 0) {
        clearRoundTimer(code); clearVotingTimer(code);
        delete rooms[code]; return;
      }

      if (room.host === socket.id && room.players.length > 0) {
        room.host = room.players[0].id;
        io.to(code).emit('host-changed', { newHost: room.host });
      }

      if (room.phase === 'input') {
        delete room.answers[socket.id];
        if (room.players.length > 0 &&
            Object.keys(room.answers).length >= room.players.length) {
          clearRoundTimer(code);
          revealRound(room);
        }
      }

      if (room.phase === 'voting') {
        delete room.votes[socket.id];
        if (room.players.length > 0 &&
            Object.keys(room.votes).length >= room.players.length) {
          resolveVoting(room);
        }
      }

      room.disconnectedPlayers.push(player);
      const timerId = setTimeout(() => {
        gracePeriodTimers.delete(socket.id);
        room.disconnectedPlayers = room.disconnectedPlayers.filter(p => p !== player);
        if (room.players.length === 0 && room.disconnectedPlayers.length === 0) {
          clearRoundTimer(code); clearVotingTimer(code);
          delete rooms[code];
        }
      }, GRACE_PERIOD_MS);
      gracePeriodTimers.set(socket.id, { code, timerId, player });
      break;
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 Assoziationsspiel läuft auf http://localhost:${PORT}\n`);
});
