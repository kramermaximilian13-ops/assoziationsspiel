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
  customCategories: [],
  gameMode:  'points'   // 'points' | 'all-for-one'
};

let prevScores = {};

// ─── Avatar Color ─────────────────────────────────────────────────────────────
function getAvatarColorClass(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  }
  return `avatar-c${Math.abs(hash) % 8}`;
}

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

// ─── SOUND SYSTEM (Web Audio API — no CDN needed) ─────────────────────────────
let sfxVolume = 0.70;
let musicVolume = 0.40;
let _audioCtx = null;

function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

// Play a single tone: freq (Hz), dur (s), type, volume 0-1, delay (s)
function tone(freq, dur, type = 'sine', vol = 0.4, delay = 0) {
  try {
    const ctx = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    const v = Math.max(0, Math.min(1, vol * sfxVolume));
    gain.gain.setValueAtTime(v, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + dur + 0.02);
  } catch (e) {}
}

function playSound(name) {
  try {
    switch (name) {
      case 'submit':
        tone(660, 0.10, 'sine', 0.30);
        break;
      case 'match':
        tone(523, 0.18, 'sine', 0.40);
        tone(659, 0.22, 'sine', 0.40, 0.13);
        tone(784, 0.30, 'sine', 0.35, 0.26);
        break;
      case 'allMatch':
        [523, 659, 784, 1047, 1319].forEach((f, i) =>
          tone(f, 0.4, 'sine', 0.50, i * 0.09));
        break;
      case 'noMatch':
        tone(330, 0.15, 'sawtooth', 0.20);
        tone(220, 0.28, 'sawtooth', 0.18, 0.12);
        break;
      case 'tick':
        tone(1100, 0.04, 'square', 0.10);
        break;
      case 'start':
        [440, 554, 659, 880].forEach((f, i) =>
          tone(f, 0.22, 'sine', 0.38, i * 0.08));
        break;
      case 'gameOver':
        [784, 659, 523, 392].forEach((f, i) =>
          tone(f, 0.38, 'sine', 0.45, i * 0.19));
        break;
    }
  } catch (e) {}
}

// ─── BACKGROUND MUSIC PLAYLIST ────────────────────────────────────────────────
// Tracks werden von GitHub geliefert — einfach MP3s in /music/ hochladen
// und hier die Dateinamen eintragen.
const MUSIC_BASE = 'https://raw.githubusercontent.com/kramermaximilian13-ops/assoziationsspiel/main/music/';
const PLAYLIST = [
  'track1.mp3',
  'track2.mp3',
  'track3.mp3',
  'track4.mp3',
  'track5.mp3',
  'track6.mp3',
];

let currentTrackIndex = 0;
const bgMusic = new Audio();
bgMusic.volume = musicVolume;

function shufflePlaylist() {
  for (let i = PLAYLIST.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [PLAYLIST[i], PLAYLIST[j]] = [PLAYLIST[j], PLAYLIST[i]];
  }
}

function playNextTrack() {
  if (PLAYLIST.length === 0) return;
  bgMusic.src = MUSIC_BASE + PLAYLIST[currentTrackIndex];
  bgMusic.volume = musicVolume;
  bgMusic.play().catch(() => {});
}

bgMusic.addEventListener('ended', () => {
  currentTrackIndex = (currentTrackIndex + 1) % PLAYLIST.length;
  playNextTrack();
});

// Musik startet beim ersten Klick/Tippen (Browser-Autoplay-Regel)
function startMusicOnInteraction() {
  if (PLAYLIST.length === 0) return;
  shufflePlaylist();
  playNextTrack();
  document.removeEventListener('click', startMusicOnInteraction);
  document.removeEventListener('keydown', startMusicOnInteraction);
}
document.addEventListener('click', startMusicOnInteraction);
document.addEventListener('keydown', startMusicOnInteraction);

// ─── AUDIO PANEL ──────────────────────────────────────────────────────────────
const btnAudioFab   = document.getElementById('btn-audio-fab');
const audioPanel    = document.getElementById('audio-panel');
const btnAudioClose = document.getElementById('btn-audio-close');
const sfxSlider     = document.getElementById('sfx-volume');
const musicSlider   = document.getElementById('music-volume');
const sfxVolNum     = document.getElementById('sfx-vol-num');
const musicVolNum   = document.getElementById('music-vol-num');

btnAudioFab.addEventListener('click', () => {
  audioPanel.classList.toggle('hidden');
});
btnAudioClose.addEventListener('click', () => {
  audioPanel.classList.add('hidden');
});

sfxSlider.addEventListener('input', e => {
  sfxVolume = parseInt(e.target.value) / 100;
  sfxVolNum.textContent = e.target.value + '%';
});
musicSlider.addEventListener('input', e => {
  musicVolume = parseInt(e.target.value) / 100;
  musicVolNum.textContent = e.target.value + '%';
  bgMusic.volume = musicVolume;
  if (PLAYLIST.length > 0 && !bgMusic.src) {
    shufflePlaylist();
    playNextTrack();
  }
});

// ─── EMOJI REACTIONS ──────────────────────────────────────────────────────────
const emojiOverlay = document.getElementById('emoji-overlay');

function showFloatingEmoji(emoji, name) {
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  // Random horizontal position
  const left = 8 + Math.random() * 80;
  el.style.left = left + '%';
  el.innerHTML = `<span class="fe-emoji">${emoji}</span><span class="fe-name">${escapeHtml(name)}</span>`;
  emojiOverlay.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// Reaction buttons — use event delegation on the whole document
document.addEventListener('click', e => {
  const btn = e.target.closest('.reaction-btn');
  if (!btn || !state.roomCode) return;
  const emoji = btn.dataset.emoji;
  if (!emoji) return;
  socket.emit('send-reaction', { code: state.roomCode, emoji });
  // Show immediately for sender too
  showFloatingEmoji(emoji, 'Du');
});

// ─── TIMER SELECTOR (lobby, host only) ───────────────────────────────────────
const timerSelector = document.getElementById('timer-selector');
timerSelector.querySelectorAll('.timer-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const ms = parseInt(btn.dataset.ms);
    timerSelector.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    socket.emit('set-input-timer', { code: state.roomCode, ms });
  });
});

// ─── VOTING SCREEN ────────────────────────────────────────────────────────────
const votingRoundBadge  = document.getElementById('voting-round-badge');
const votingProgressBar = document.getElementById('voting-progress-bar');
const votingTimerWrap   = document.getElementById('voting-timer-wrap');
const votingTimerFill   = document.getElementById('voting-timer-fill');
const votingTimerNum    = document.getElementById('voting-timer-num');
const votingOptions     = document.getElementById('voting-options').querySelectorAll('.voting-option');
const votingStatus      = document.getElementById('voting-status');
const votingCount       = document.getElementById('voting-count');

let votingCountdownTimer = null;
let myVote = null;

function stopVotingCountdown() {
  clearInterval(votingCountdownTimer);
  votingCountdownTimer = null;
}

function startVotingCountdown(seconds) {
  stopVotingCountdown();
  votingTimerNum.textContent = seconds;
  votingTimerFill.style.transition = 'none';
  votingTimerFill.style.width = '100%';
  setTimeout(() => {
    votingTimerFill.style.transition = `width ${seconds}s linear`;
    votingTimerFill.style.width = '0%';
  }, 60);
  let secs = seconds;
  votingCountdownTimer = setInterval(() => {
    secs--;
    votingTimerNum.textContent = secs;
    if (secs <= 3 && secs > 0) playSound('tick');
    if (secs <= 0) stopVotingCountdown();
  }, 1000);
}

function setupVoting({ round, maxRounds, candidates, seconds, playerCount }) {
  myVote = null;
  votingRoundBadge.textContent = `Runde ${round} / ${maxRounds}`;
  if (votingProgressBar) {
    votingProgressBar.style.width = `${((round - 1) / maxRounds) * 100}%`;
  }

  votingOptions.forEach((btn, i) => {
    const textEl = btn.querySelector('.option-text');
    const voteBar = btn.querySelector('.vote-bar');
    const votesEl = btn.querySelector('.option-votes');
    if (textEl) textEl.textContent = candidates[i] || '—';
    if (voteBar) voteBar.style.width = '0%';
    if (votesEl) votesEl.textContent = '';
    btn.classList.remove('selected', 'winner');
    btn.disabled = false;
  });

  votingStatus.classList.add('hidden');
  const total = playerCount || state.players.length;
  votingCount.textContent = `0 / ${total} haben abgestimmt`;

  // Update game mode pill
  const modePill = document.querySelector('#screen-voting .game-mode-pill');
  if (modePill) {
    if (state.gameMode === 'all-for-one') {
      modePill.textContent = '🤝 All for One';
      modePill.className = 'game-mode-pill mode-afo';
    } else {
      modePill.textContent = '🏆 Punkte';
      modePill.className = 'game-mode-pill mode-points';
    }
  }

  showScreen('screen-voting');
  startVotingCountdown(seconds);
}

votingOptions.forEach(btn => {
  btn.addEventListener('click', () => {
    if (myVote !== null) return;
    const idx = parseInt(btn.dataset.idx);
    myVote = idx;
    votingOptions.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    votingStatus.classList.remove('hidden');
    socket.emit('cast-vote', { code: state.roomCode, candidateIdx: idx });
  });
});

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

// URL-Parameter ?code= automatisch ins Beitrittsformular einfügen
{
  const codeFromUrl = new URLSearchParams(location.search).get('code');
  if (codeFromUrl) {
    const clean = codeFromUrl.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (clean.length === 5) {
      joinCodeInput.value = clean;
      joinForm.classList.remove('hidden');
    }
  }
}

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
const roundsGroup  = document.getElementById('rounds-group');
const customCatInput = document.getElementById('custom-cat-input');
const btnAddCat    = document.getElementById('btn-add-cat');
const customCatList  = document.getElementById('custom-cat-list');
const lobbyModeBadge = document.getElementById('lobby-mode-badge');
const lobbyModeIcon  = document.getElementById('lobby-mode-icon');
const lobbyModeText  = document.getElementById('lobby-mode-text');

btnCopyCode.addEventListener('click', () => {
  navigator.clipboard.writeText(state.roomCode).then(() => {
    btnCopyCode.textContent = '✓';
    setTimeout(() => btnCopyCode.textContent = '⧉', 1500);
  });
});

document.getElementById('btn-share-link').addEventListener('click', () => {
  const url = `${location.origin}${location.pathname}?code=${state.roomCode}`;
  const btn = document.getElementById('btn-share-link');
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = '✓ Kopiert!';
    setTimeout(() => { btn.textContent = '🔗 Teilen'; }, 2000);
  }).catch(() => {
    prompt('Link kopieren:', url);
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
    tag.innerHTML = `${escapeHtml(cat)} <button class="tag-remove" data-cat="${escapeHtml(cat)}">×</button>`;
    tag.querySelector('.tag-remove').addEventListener('click', () => {
      socket.emit('remove-custom-category', { code: state.roomCode, category: cat });
    });
    customCatList.appendChild(tag);
  });
}

// Game mode selector
const modeSelector = document.getElementById('mode-selector');
modeSelector.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    state.gameMode = mode;
    modeSelector.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Toggle rounds stepper + timer visibility
    if (mode === 'all-for-one') {
      roundsGroup.classList.add('hidden');
      document.getElementById('timer-group').classList.add('hidden');
    } else {
      roundsGroup.classList.remove('hidden');
      document.getElementById('timer-group').classList.remove('hidden');
    }

    // Tell server about the mode change
    socket.emit('set-game-mode', { code: state.roomCode, gameMode: mode });
  });
});

btnStart.addEventListener('click', () => {
  socket.emit('start-game', {
    code: state.roomCode,
    maxRounds: state.maxRounds,
    gameMode: state.gameMode
  });
  playSound('start');
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
    const colorClass = getAvatarColorClass(p.name);
    li.innerHTML = `
      <div class="player-avatar ${colorClass}">${initial}</div>
      <span class="player-name">${escapeHtml(p.name)}</span>
      ${isHost ? '<span class="host-tag">Host</span>' : ''}
      ${isYou  ? '<span class="you-tag">Du</span>' : ''}
    `;
    playerList.appendChild(li);
  });
}

function setLobbyModeBadge(gameMode) {
  if (gameMode === 'all-for-one') {
    lobbyModeIcon.textContent = '🤝';
    lobbyModeText.textContent = 'All for One';
  } else {
    lobbyModeIcon.textContent = '🏆';
    lobbyModeText.textContent = 'Punkte-Modus';
  }
}

// ─── GAME SCREEN ──────────────────────────────────────────────────────────────
const gameCategory    = document.getElementById('game-category');
const categoryCard    = document.getElementById('category-card');
const categoryLabel   = document.getElementById('category-label');
const wordInput       = document.getElementById('word-input');
const btnSubmit       = document.getElementById('btn-submit');
const submittedStatus = document.getElementById('submitted-status');
const answerDots      = document.getElementById('answer-dots');
const roundBadge      = document.getElementById('round-badge');
const progressBar     = document.getElementById('progress-bar');
const gameModeBadge   = document.getElementById('game-mode-badge');
const gameTimerWrap   = document.getElementById('game-timer-wrap');
const gameTimerFill   = document.getElementById('game-timer-fill');
const gameTimerNum    = document.getElementById('game-timer-num');

let gameCountdownTimer = null;

function stopGameCountdown() {
  clearInterval(gameCountdownTimer);
  gameCountdownTimer = null;
  gameTimerWrap.classList.add('hidden');
}

function startGameCountdown(seconds) {
  stopGameCountdown();
  gameTimerWrap.classList.remove('hidden');
  gameTimerNum.textContent = seconds;

  // Reset bar
  gameTimerFill.style.transition = 'none';
  gameTimerFill.style.width = '100%';
  setTimeout(() => {
    gameTimerFill.style.transition = `width ${seconds}s linear`;
    gameTimerFill.style.width = '0%';
  }, 60);

  let secs = seconds;
  gameCountdownTimer = setInterval(() => {
    secs--;
    gameTimerNum.textContent = secs;
    if (secs <= 3 && secs > 0) playSound('tick');
    if (secs <= 0) stopGameCountdown();
  }, 1000);
}

function setupGameRound({ round, maxRounds, category, players, gameMode }) {
  state.round = round;
  state.submitted = false;
  state.maxRounds = maxRounds;
  if (gameMode) state.gameMode = gameMode;

  stopGameCountdown();

  if (state.gameMode === 'all-for-one') {
    roundBadge.textContent = `Runde ${round}`;
    progressBar.style.width = '0%';
    gameModeBadge.textContent = '🤝 All for One';
    gameModeBadge.className = 'game-mode-pill mode-afo';
    // No category in All for One — hide card, show neutral prompt
    categoryCard.classList.add('hidden');
  } else {
    roundBadge.textContent = `Runde ${round} / ${maxRounds}`;
    progressBar.style.width = `${((round - 1) / maxRounds) * 100}%`;
    gameModeBadge.textContent = '🏆 Punkte';
    gameModeBadge.className = 'game-mode-pill mode-points';
    // Show category
    categoryCard.classList.remove('hidden');
    categoryLabel.textContent = 'Kategorie';
    gameCategory.textContent = category || '';
  }

  wordInput.value = '';
  wordInput.disabled = false;
  btnSubmit.disabled = false;
  submittedStatus.classList.add('hidden');

  // Render player chips
  answerDots.innerHTML = '';
  players.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    chip.dataset.playerId = p.id;
    const colorClass = getAvatarColorClass(p.name);
    chip.innerHTML = `<span class="chip-avatar ${colorClass}">${escapeHtml(p.name.charAt(0).toUpperCase())}</span><span class="chip-name">${escapeHtml(p.name)}</span>`;
    answerDots.appendChild(chip);
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
  playSound('submit');
}

// ─── REVEAL SCREEN ────────────────────────────────────────────────────────────
const revealRoundBadge    = document.getElementById('reveal-round-badge');
const revealCategory      = document.getElementById('reveal-category');
const revealMatchBanner   = document.getElementById('reveal-match-banner');
const revealAllMatchBanner = document.getElementById('reveal-all-match-banner');
const revealPartialBanner = document.getElementById('reveal-partial-banner');
const revealNoMatchBanner = document.getElementById('reveal-no-match-banner');
const matchWordEl         = document.getElementById('match-word');
const allMatchWordEl      = document.getElementById('all-match-word');
const partialMatchWordEl  = document.getElementById('partial-match-word');
const revealAnswers       = document.getElementById('reveal-answers');
const revealScores        = document.getElementById('reveal-scores');
const revealScoresSection = document.getElementById('reveal-scores-section');
const btnNextRound        = document.getElementById('btn-next-round');
const revealWaiting       = document.getElementById('reveal-waiting');
const revealCountdownWrap = document.getElementById('reveal-countdown-wrap');
const revealCountdownFill = document.getElementById('reveal-countdown-fill');
const revealCountdownNum  = document.getElementById('reveal-countdown-num');

let revealCountdownTimer = null;

function startRevealCountdown() {
  clearInterval(revealCountdownTimer);

  revealCountdownWrap.classList.remove('hidden');
  revealCountdownNum.textContent = '10';

  // Reset fill bar
  revealCountdownFill.style.transition = 'none';
  revealCountdownFill.style.width = '100%';

  // Trigger smooth animation after a brief delay
  setTimeout(() => {
    revealCountdownFill.style.transition = 'width 10s linear';
    revealCountdownFill.style.width = '0%';
  }, 60);

  let secs = 10;
  revealCountdownTimer = setInterval(() => {
    secs--;
    revealCountdownNum.textContent = secs;

    if (secs <= 3 && secs > 0) playSound('tick');

    if (secs <= 0) {
      clearInterval(revealCountdownTimer);
      revealCountdownWrap.classList.add('hidden');
      if (state.isHost) {
        socket.emit('next-round', { code: state.roomCode });
      }
    }
  }, 1000);
}

function stopRevealCountdown() {
  clearInterval(revealCountdownTimer);
  revealCountdownWrap.classList.add('hidden');
}

function renderReveal(data) {
  const { round, maxRounds, category, answers, isMatch, matchWord: mw,
          partialMatchWord, players, gameMode } = data;

  if (gameMode) state.gameMode = gameMode;

  if (state.gameMode === 'all-for-one') {
    revealRoundBadge.textContent = `Runde ${round}`;
  } else {
    revealRoundBadge.textContent = `Runde ${round} / ${maxRounds}`;
  }
  revealCategory.textContent = category;

  // Hide all banners first
  revealMatchBanner.classList.add('hidden');
  revealAllMatchBanner.classList.add('hidden');
  revealPartialBanner.classList.add('hidden');
  revealNoMatchBanner.classList.add('hidden');

  if (state.gameMode === 'all-for-one') {
    if (isMatch) {
      // Full consensus!
      revealAllMatchBanner.classList.remove('hidden');
      allMatchWordEl.textContent = mw;
      playSound('allMatch');
    } else if (partialMatchWord) {
      // Some players matched but not all
      revealPartialBanner.classList.remove('hidden');
      partialMatchWordEl.textContent = partialMatchWord;
      playSound('match');
    } else {
      revealNoMatchBanner.classList.remove('hidden');
      playSound('noMatch');
    }
    // No scores in all-for-one mode
    revealScoresSection.classList.add('hidden');
  } else {
    // Points mode
    if (isMatch) {
      revealMatchBanner.classList.remove('hidden');
      matchWordEl.textContent = mw;
      playSound('match');
    } else {
      revealNoMatchBanner.classList.remove('hidden');
      playSound('noMatch');
    }
    // Show scores
    revealScoresSection.classList.remove('hidden');
    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    revealScores.innerHTML = '';
    sortedPlayers.forEach(p => {
      const delta = p.score - (prevScores[p.id] || 0);
      const li = document.createElement('li');
      li.className = 'score-item';
      li.innerHTML = `
        <span class="score-name">${escapeHtml(p.name)}</span>
        ${delta > 0 ? `<span class="score-delta">+${delta}</span>` : ''}
        <span class="score-pts">${p.score} Pkt.</span>
      `;
      revealScores.appendChild(li);
    });
  }

  // Answers
  revealAnswers.innerHTML = '';
  answers.forEach((a, i) => {
    const isHighlighted = isMatch
      ? a.word === mw
      : (partialMatchWord && a.word === partialMatchWord);
    const li = document.createElement('li');
    li.className = `reveal-item${isHighlighted ? ' is-match' : ''}`;
    li.style.animationDelay = `${i * 0.08}s`;
    li.innerHTML = `
      <div>
        <div class="reveal-player-name">${escapeHtml(a.name)}</div>
        <div class="reveal-word">${escapeHtml(a.word)}</div>
      </div>
      ${isHighlighted ? '<span class="match-checkmark">✓</span>' : ''}
    `;
    revealAnswers.appendChild(li);
  });

  // Host sees skip button; start countdown for everyone
  if (state.isHost) {
    btnNextRound.classList.remove('hidden');
    // Update button label based on whether this is the final action
    const isFinal = state.gameMode === 'all-for-one'
      ? isMatch
      : round >= maxRounds;
    btnNextRound.textContent = isFinal ? '🏆 Ergebnisse' : '⏭ Überspringen';
    revealWaiting.classList.add('hidden');
  } else {
    btnNextRound.classList.add('hidden');
    revealWaiting.classList.add('hidden');
  }

  showScreen('screen-reveal');
  startRevealCountdown();
}

btnNextRound.addEventListener('click', () => {
  stopRevealCountdown();
  socket.emit('next-round', { code: state.roomCode });
});

// ─── GAME OVER SCREEN ─────────────────────────────────────────────────────────
const finalScores      = document.getElementById('final-scores');
const roundHistoryEl   = document.getElementById('round-history');
const btnPlayAgain     = document.getElementById('btn-play-again');
const gameoverWaiting  = document.getElementById('gameover-waiting');
const gameoverTrophy   = document.getElementById('gameover-trophy');
const gameoverTitle    = document.getElementById('gameover-title');
const gameoverSubtitle = document.getElementById('gameover-subtitle');

function renderGameOver(data) {
  const { players, roundHistory: history, totalRounds, gameMode } = data;

  if (gameMode) state.gameMode = gameMode;

  playSound('gameOver');

  if (state.gameMode === 'all-for-one') {
    const winRound = history.find(r => r.match);
    gameoverTrophy.textContent = '🥳';
    gameoverTitle.textContent = 'Ihr habt es geschafft!';
    if (winRound) {
      gameoverSubtitle.textContent =
        `In Runde ${winRound.round} wart ihr euch alle einig: "${winRound.matchWord}"`;
      gameoverSubtitle.classList.remove('hidden');
    }
  } else {
    gameoverTrophy.textContent = '🏆';
    gameoverTitle.textContent = 'Spiel beendet!';
    gameoverSubtitle.classList.add('hidden');
  }

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
  roundHistoryEl.innerHTML = '';
  history.forEach(r => {
    const li = document.createElement('li');
    li.className = `history-item${r.match ? ' matched' : ''}`;
    li.innerHTML = `
      <span class="history-round">Runde ${r.round}</span>
      <span class="history-cat">${escapeHtml(r.category)}</span>
      <span class="history-result">${r.match ? `✓ ${escapeHtml(r.matchWord)}` : '✗'}</span>
    `;
    roundHistoryEl.appendChild(li);
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
  state.gameMode = room.gameMode || 'points';

  lobbyCode.textContent = code;
  renderPlayerList(room.players, room.host);
  hostControls.classList.remove('hidden');
  lobbyWaiting.classList.add('hidden');
  lobbyModeBadge.classList.add('hidden');
  renderCustomCategories();
  showScreen('screen-lobby');
});

socket.on('room-joined', ({ code, room }) => {
  state.roomCode = code;
  state.isHost   = false;
  state.players  = room.players;
  state.gameMode = room.gameMode || 'points';

  lobbyCode.textContent = code;
  renderPlayerList(room.players, room.host);
  hostControls.classList.add('hidden');
  lobbyWaiting.classList.remove('hidden');
  lobbyModeBadge.classList.remove('hidden');
  setLobbyModeBadge(state.gameMode);
  showScreen('screen-lobby');
});

socket.on('player-joined', ({ players }) => {
  state.players = players;
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
    const activeScreen = document.querySelector('.screen.active')?.id;
    if (activeScreen === 'screen-lobby') {
      hostControls.classList.remove('hidden');
      lobbyWaiting.classList.add('hidden');
      lobbyModeBadge.classList.add('hidden');
    }
    if (activeScreen === 'screen-reveal') {
      btnNextRound.classList.remove('hidden');
      revealWaiting.classList.add('hidden');
    }
    if (activeScreen === 'screen-gameover') {
      btnPlayAgain.classList.remove('hidden');
      gameoverWaiting.classList.add('hidden');
    }
  }
  renderPlayerList(state.players, newHost);
});

socket.on('game-mode-updated', ({ gameMode }) => {
  state.gameMode = gameMode;
  setLobbyModeBadge(gameMode);
  // Update host selector UI
  if (state.isHost) {
    modeSelector.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === gameMode);
    });
    if (gameMode === 'all-for-one') {
      roundsGroup.classList.add('hidden');
      document.getElementById('timer-group').classList.add('hidden');
    } else {
      roundsGroup.classList.remove('hidden');
      document.getElementById('timer-group').classList.remove('hidden');
    }
  }
});

socket.on('custom-categories-updated', ({ customCategories }) => {
  state.customCategories = customCategories;
  if (state.isHost) renderCustomCategories();
});

socket.on('game-started', (data) => {
  state.players = data.players;
  if (data.gameMode) state.gameMode = data.gameMode;
  setupGameRound(data);
});

socket.on('answer-count', ({ answered, total, answeredIds }) => {
  answerDots.querySelectorAll('.player-chip').forEach(chip => {
    chip.classList.toggle('answered', answeredIds ? answeredIds.includes(chip.dataset.playerId) : false);
  });
});

socket.on('round-timer-start', ({ seconds }) => {
  startGameCountdown(seconds);
});

socket.on('round-result', (data) => {
  stopGameCountdown();
  prevScores = {};
  state.players.forEach(p => { prevScores[p.id] = p.score; });
  state.players = data.players;
  renderReveal(data);
});

socket.on('next-round-start', (data) => {
  stopRevealCountdown();
  stopGameCountdown();
  state.players = data.players;
  if (data.gameMode) state.gameMode = data.gameMode;
  setupGameRound(data);
});

socket.on('game-over', (data) => {
  stopRevealCountdown();
  stopGameCountdown();
  renderGameOver(data);
});

// ── NEW: voting events ──────────────────────────────────────────────────────
socket.on('voting-start', (data) => {
  stopRevealCountdown();
  stopGameCountdown();
  setupVoting(data);
});

socket.on('vote-count', ({ votes, total }) => {
  votingCount.textContent = `${votes} / ${total} haben abgestimmt`;
});

socket.on('voting-result', (data) => {
  stopVotingCountdown();
  // Show winner briefly, then transition to game screen
  const { winnerIdx, counts, category } = data;
  const total = counts.reduce((a, b) => a + b, 0);

  // Update vote bars to show final result
  votingOptions.forEach((btn, i) => {
    const voteBar = btn.querySelector('.vote-bar');
    const votesEl = btn.querySelector('.option-votes');
    const pct = total > 0 ? Math.round((counts[i] / total) * 100) : 0;
    if (voteBar) voteBar.style.width = pct + '%';
    if (votesEl) votesEl.textContent = `${counts[i]} Stimme${counts[i] !== 1 ? 'n' : ''}`;
    btn.classList.remove('selected');
    if (i === winnerIdx) btn.classList.add('winner');
    btn.disabled = true;
  });

  // Brief pause then start game round
  setTimeout(() => {
    state.players = data.players;
    if (data.gameMode) state.gameMode = data.gameMode;
    setupGameRound(data);
  }, 1200);
});

// ── NEW: reactions ──────────────────────────────────────────────────────────
socket.on('reaction-received', ({ emoji, name }) => {
  showFloatingEmoji(emoji, name);
});

// ── NEW: input timer updated ────────────────────────────────────────────────
socket.on('input-timer-updated', ({ inputTimerMs }) => {
  // Sync timer selector UI for all clients (including host on reconnect)
  if (state.isHost) {
    timerSelector.querySelectorAll('.timer-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.ms) === inputTimerMs);
    });
  }
});

socket.on('back-to-lobby', ({ room }) => {
  state.players  = room.players;
  state.isHost   = room.isHost;
  state.customCategories = room.customCategories || [];
  state.maxRounds = room.maxRounds || 10;
  state.gameMode  = room.gameMode || 'points';
  roundsDisplay.textContent = state.maxRounds;

  lobbyCode.textContent = room.code;
  renderPlayerList(room.players, room.host);

  if (state.isHost) {
    hostControls.classList.remove('hidden');
    lobbyWaiting.classList.add('hidden');
    lobbyModeBadge.classList.add('hidden');
    renderCustomCategories();

    // Sync mode selector
    modeSelector.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === state.gameMode);
    });
    roundsGroup.classList.toggle('hidden', state.gameMode === 'all-for-one');
  } else {
    hostControls.classList.add('hidden');
    lobbyWaiting.classList.remove('hidden');
    lobbyModeBadge.classList.remove('hidden');
    setLobbyModeBadge(state.gameMode);
  }

  showScreen('screen-lobby');
});

socket.on('error', ({ message }) => {
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
  stopRevealCountdown();
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
