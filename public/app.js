'use strict';

// ─── Socket Connection ────────────────────────────────────────────────────────
const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  myName:    '',
  roomCode:  '',
  isHost:    false,
  players:   [],
  maxRounds: 10,
  round:     0,
  submitted: false,
  customCategories: []
};

// ─── Screen Management ─────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('active');
    window.scrollTo(0, 0);
  }
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function clearError(elId) {
  const el = document.getElementById(elId);
  if (el) el.classList.add('hidden');
}

// ─── LANDING SCREEN ───────────────────────────────────────────────────────────
const landingName   = document.getElementById('landing-name');
const btnCreate     = document.getElementById('btn-create');
const btnJoinShow   = document.getElementById('btn-join-show');
const joinForm      = document.getElementById('join-form');
const joinCodeInput = document.getElementById('join-code');
const btnJoin       = document.getElementById('btn-join');

btnJoinShow.addEventListener('click', () => {
  joinForm.classList.toggle('hidden');
  if (!joinForm.classList.contains('hidden')) joinCodeInput.focus();
});

btnCreate.addEventListener('click', () => {
  const name = landingName.value.trim();
  if (!name) return showError('landing-error', 'Bitte gib deinen Namen ein.');
  state.myName = name;
  socket.emit('create-room', { playerName: name, customCategories: [] });
});

btnJoin.addEventListener('click', doJoin);
joinCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
joinCodeInput.addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

function doJoin() {
  const name = landingName.value.trim();
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!name) return showError('landing-error', 'Bitte gib deinen Namen ein.');
  if (!code || code.length !== 5) return showError('landing-error', 'Bitte gib einen 5-stelligen Raum-Code ein.');
  state.myName = name;
  socket.emit('join-room', { code, playerName: name });
}

// ─── LOBBY SCREEN ─────────────────────────────────────────────────────────────
const lobbyCode    = document.getElementById('lobby-code');
const btnCopyCode  = document.getElementById('btn-copy-code');
const playerList   = document.getElementById('player-list');
const playerCount  = document.getElementById('player-count');
const hostControls = document.getElementById('host-controls');
const lobbyWaiting = document.getElementById('lobby-waiting');
const btnStart     = document.getElementById('btn-start');
const roundsMinus  = document.getElementById('rounds-minus');
const roundsPlus   = document.getElementById('rounds-plus');
const roundsDisplay = document.getElementById('rounds-display');
const customCatInput = document.getElementById('custom-cat-input');
const btnAddCat    = document.getElementById('btn-add-cat');
const customCatList  = document.getElementById('custom-cat-list');

btnCopyCode.addEventListener('click', () => {
  navigator.clipboard.writeText(state.roomCode).then(() => {
    btnCopyCode.textContent = '✓';
    setTimeout(() => btnCopyCode.textContent = '⧉', 1500);
  });
});

roundsMinus.addEventListener('click', () => {
  state.maxRounds = Math.max(3, state.maxRounds - 1);
  roundsDisplay.textContent = state.maxRounds;
});
roundsPlus.addEventListener('click', () => {
  state.maxRounds = Math.min(20, state.maxRounds + 1);
  roundsDisplay.textContent = state.maxRounds;
});

btnAddCat.addEventListener('click', addCustomCategory);
customCatInput.addEventListener('keydown', e => { if (e.key === 'Enter') addCustomCategory(); });

function addCustomCategory() {
  const val = customCatInput.value.trim();
  if (!val) return;
  if (state.customCategories.includes(val)) {
    customCatInput.value = '';
    return;
  }
  socket.emit('add-custom-categories', { code: state.roomCode, categories: [val] });
  customCatInput.value = '';
  customCatInput.focus();
}

function renderCustomCategories() {
  customCatList.innerHTML = '';
  state.customCategories.forEach(cat => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `${cat} <button class="tag-remove" data-cat="${cat}">×</button>`;
    tag.querySelector('.tag-remove').addEventListener('click', () => {
      socket.emit('remove-custom-category', { code: state.roomCode, category: cat });
    });
    customCatList.appendChild(tag);
  });
}

btnStart.addEventListener('click', () => {
  socket.emit('start-game', { code: state.roomCode, maxRounds: state.maxRounds });
});

function renderPlayerList(players, hostId) {
  playerList.innerHTML = '';
  playerCount.textContent = players.length;
  players.forEach(p => {
    const li = document.createElement('li');
    li.className = 'player-item';
    const initial = p.name.charAt(0).toUpperCase();
    const isHost  = p.id === hostId;
    const isYou   = p.id === socket.id;
    li.innerHTML = `
      <div class="player-avatar">${initial}</div>
      <span class="player-name">${escapeHtml(p.name)}</span>
      ${isHost ? '<span class="host-tag">Host</span>' : ''}
      ${isYou  ? '<span class="you-tag">Du</span>' : ''}
    `;
    playerList.appendChild(li);
  });
}

// ─── GAME SCREEN ──────────────────────────────────────────────────────────────
const gameCategory   = document.getElementById('game-category');
const wordInput      = document.getElementById('word-input');
const btnSubmit      = document.getElementById('btn-submit');
const submittedStatus = document.getElementById('submitted-status');
const answerDots     = document.getElementById('answer-dots');
const roundBadge     = document.getElementById('round-badge');
const progressBar    = document.getElementById('progress-bar');

function setupGameRound({ round, maxRounds, category, players }) {
  state.round = round;
  state.submitted = false;
  state.maxRounds = maxRounds;

  roundBadge.textContent = `Runde ${round} / ${maxRounds}`;
  progressBar.style.width = `${((round - 1) / maxRounds) * 100}%`;
  gameCategory.textContent = category;

  wordInput.value = '';
  wordInput.disabled = false;
  btnSubmit.disabled = false;
  submittedStatus.classList.add('hidden');

  // Render answer dots
  answerDots.innerHTML = '';
  players.forEach(() => {
    const dot = document.createElement('div');
    dot.className = 'dot';
    answerDots.appendChild(dot);
  });

  showScreen('screen-game');
  setTimeout(() => wordInput.focus(), 200);
}

btnSubmit.addEventListener('click', submitWord);
wordInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitWord(); });

function submitWord() {
  if (state.submitted) return;
  const word = wordInput.value.trim();
  if (!word) return showError('game-error', 'Bitte schreib etwas!');
  state.submitted = true;
  wordInput.disabled = true;
  btnSubmit.disabled = true;
  submittedStatus.classList.remove('hidden');
  clearError('game-error');
  socket.emit('submit-word', { code: state.roomCode, word });
}

// ─── REVEAL SCREEN ────────────────────────────────────────────────────────────
const revealRoundBadge    = document.getElementById('reveal-round-badge');
const revealCategory      = document.getElementById('reveal-category');
const revealMatchBanner   = document.getElementById('reveal-match-banner');
const revealNoMatchBanner = document.getElementById('reveal-no-match-banner');
const matchWord           = document.getElementById('match-word');
const revealAnswers       = document.getElementById('reveal-answers');
const revealScores        = document.getElementById('reveal-scores');
const btnNextRound        = document.getElementById('btn-next-round');
const revealWaiting       = document.getElementById('reveal-waiting');

function renderReveal(data) {
  const { round, maxRounds, category, answers, isMatch, matchWord: mw, players } = data;

  revealRoundBadge.textContent = `Runde ${round} / ${maxRounds}`;
  revealCategory.textContent = category;

  // Match banner
  if (isMatch) {
    revealMatchBanner.classList.remove('hidden');
    revealNoMatchBanner.classList.add('hidden');
    matchWord.textContent = mw;
  } else {
    revealMatchBanner.classList.add('hidden');
    revealNoMatchBanner.classList.remove('hidden');
  }

  // Answers
  revealAnswers.innerHTML = '';
  answers.forEach((a, i) => {
    const li = document.createElement('li');
    li.className = `reveal-item${(isMatch && a.word === mw) ? ' is-match' : ''}`;
    li.style.animationDelay = `${i * 0.08}s`;
    li.innerHTML = `
      <div>
        <div class="reveal-player-name">${escapeHtml(a.name)}</div>
        <div class="reveal-word">${escapeHtml(a.word)}</div>
      </div>
      ${(isMatch && a.word === mw) ? '<span class="match-checkmark">✓</span>' : ''}
    `;
    revealAnswers.appendChild(li);
  });

  // Scores
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
  revealScores.innerHTML = '';
  sortedPlayers.forEach(p => {
    const li = document.createElement('li');
    li.className = 'score-item';
    li.innerHTML = `
      <span class="score-name">${escapeHtml(p.name)}</span>
      <span class="score-pts">${p.score} Pkt.</span>
    `;
    revealScores.appendChild(li);
  });

  // Host buttons
  if (state.isHost) {
    btnNextRound.classList.remove('hidden');
    revealWaiting.classList.add('hidden');

    // Check if we should show "Ende" vs "Nächste Runde"
    const gameWon = isMatch;
    const lastRound = round >= maxRounds;
    if (gameWon || lastRound) {
      btnNextRound.textContent = 'Spielende → Ergebnisse';
    } else {
      btnNextRound.textContent = 'Nächste Runde →';
    }
  } else {
    btnNextRound.classList.add('hidden');
    revealWaiting.classList.remove('hidden');
  }

  showScreen('screen-reveal');
}

btnNextRound.addEventListener('click', () => {
  socket.emit('next-round', { code: state.roomCode });
});

// ─── GAME OVER SCREEN ─────────────────────────────────────────────────────────
const finalScores      = document.getElementById('final-scores');
const roundHistory     = document.getElementById('round-history');
const btnPlayAgain     = document.getElementById('btn-play-again');
const gameoverWaiting  = document.getElementById('gameover-waiting');

function renderGameOver(data) {
  const { players, roundHistory: history, totalRounds } = data;

  // Final scores
  finalScores.innerHTML = '';
  players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = `final-score-item rank-${i + 1}`;
    li.style.animationDelay = `${i * 0.1}s`;
    const medals = ['🥇', '🥈', '🥉'];
    li.innerHTML = `
      <span class="rank-num">${medals[i] || `${i + 1}.`}</span>
      <span class="final-name">${escapeHtml(p.name)}</span>
      <span class="final-pts">${p.score} Pkt.</span>
    `;
    finalScores.appendChild(li);
  });

  // Round history
  roundHistory.innerHTML = '';
  history.forEach(r => {
    const li = document.createElement('li');
    li.className = `history-item${r.match ? ' matched' : ''}`;
    li.innerHTML = `
      <span class="history-round">Runde ${r.round}</span>
      <span class="history-cat">${escapeHtml(r.category)}</span>
      <span class="history-result">${r.match ? `✓ ${escapeHtml(r.matchWord)}` : '✗'}</span>
    `;
    roundHistory.appendChild(li);
  });

  // Buttons
  if (state.isHost) {
    btnPlayAgain.classList.remove('hidden');
    gameoverWaiting.classList.add('hidden');
  } else {
    btnPlayAgain.classList.add('hidden');
    gameoverWaiting.classList.remove('hidden');
  }

  showScreen('screen-gameover');
}

btnPlayAgain.addEventListener('click', () => {
  socket.emit('play-again', { code: state.roomCode });
});

// ─── SOCKET EVENTS ────────────────────────────────────────────────────────────

socket.on('room-created', ({ code, room }) => {
  state.roomCode = code;
  state.isHost   = true;
  state.players  = room.players;
  state.customCategories = room.customCategories || [];

  lobbyCode.textContent = code;
  renderPlayerList(room.players, room.host);
  hostControls.classList.remove('hidden');
  lobbyWaiting.classList.add('hidden');
  renderCustomCategories();
  showScreen('screen-lobby');
});

socket.on('room-joined', ({ code, room }) => {
  state.roomCode = code;
  state.isHost   = false;
  state.players  = room.players;

  lobbyCode.textContent = code;
  renderPlayerList(room.players, room.host);
  hostControls.classList.add('hidden');
  lobbyWaiting.classList.remove('hidden');
  showScreen('screen-lobby');
});

socket.on('player-joined', ({ players }) => {
  state.players = players;
  // Find host: first player or existing host
  const hostId = players[0]?.id;
  renderPlayerList(players, hostId);
});

socket.on('player-left', ({ players }) => {
  state.players = players;
  renderPlayerList(players, players[0]?.id);
});

socket.on('host-changed', ({ newHost }) => {
  if (newHost === socket.id) {
    state.isHost = true;
    hostControls.classList.remove('hidden');
    lobbyWaiting.classList.add('hidden');
    // Show next round / play again buttons if in those screens
    btnNextRound.classList.remove('hidden');
    btnPlayAgain.classList.remove('hidden');
    revealWaiting.classList.add('hidden');
    gameoverWaiting.classList.add('hidden');
  }
  renderPlayerList(state.players, newHost);
});

socket.on('custom-categories-updated', ({ customCategories }) => {
  state.customCategories = customCategories;
  if (state.isHost) renderCustomCategories();
});

socket.on('game-started', (data) => {
  state.players = data.players;
  setupGameRound(data);
});

socket.on('answer-count', ({ answered, total }) => {
  const dots = answerDots.querySelectorAll('.dot');
  dots.forEach((dot, i) => {
    if (i < answered) dot.classList.add('answered');
    else dot.classList.remove('answered');
  });
});

socket.on('round-result', (data) => {
  state.players = data.players;
  renderReveal(data);
});

socket.on('next-round-start', (data) => {
  state.players = data.players;
  setupGameRound(data);
});

socket.on('game-over', (data) => {
  renderGameOver(data);
});

socket.on('back-to-lobby', ({ room }) => {
  state.players  = room.players;
  state.isHost   = room.isHost;
  state.customCategories = room.customCategories || [];
  state.maxRounds = room.maxRounds || 10;
  roundsDisplay.textContent = state.maxRounds;

  lobbyCode.textContent = room.code;
  renderPlayerList(room.players, room.host);

  if (state.isHost) {
    hostControls.classList.remove('hidden');
    lobbyWaiting.classList.add('hidden');
    renderCustomCategories();
  } else {
    hostControls.classList.add('hidden');
    lobbyWaiting.classList.remove('hidden');
  }

  showScreen('screen-lobby');
});

socket.on('error', ({ message }) => {
  // Show error on the currently active screen
  const active = document.querySelector('.screen.active');
  if (!active) return;
  const errEl = active.querySelector('.error-msg');
  if (errEl) {
    errEl.textContent = message;
    errEl.classList.remove('hidden');
    setTimeout(() => errEl.classList.add('hidden'), 4000);
  }
});

socket.on('disconnect', () => {
  showError('landing-error', 'Verbindung getrennt. Bitte neu laden.');
  showScreen('screen-landing');
});

// ─── Utility ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// ─── PWA: Service Worker Registration ────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
