const socket = io();
let myRoom = null;
let latestRoom = null;

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
if (params.get('room')) $('roomInput').value = params.get('room').toUpperCase();

$('createBtn').onclick = () => {
  socket.emit('room:create', { name: $('name').value }, res => {
    if (res.error) return showError(res.error);
    myRoom = res.roomId;
    history.replaceState(null, '', `?room=${myRoom}`);
  });
};

$('joinBtn').onclick = () => {
  socket.emit('room:join', { roomId: $('roomInput').value, name: $('name').value }, res => {
    if (res.error) return showError(res.error);
    myRoom = res.roomId;
    history.replaceState(null, '', `?room=${myRoom}`);
  });
};

$('copyLink').onclick = async () => {
  await navigator.clipboard.writeText(`${location.origin}?room=${myRoom}`);
  $('copyLink').textContent = 'Copied!';
  setTimeout(() => $('copyLink').textContent = 'Copy Invite Link', 1200);
};

$('startBtn').onclick = () => socket.emit('game:start', { roomId: myRoom });
$('hitBtn').onclick = () => socket.emit('player:hit', { roomId: myRoom });
$('standBtn').onclick = () => socket.emit('player:stand', { roomId: myRoom });
$('nextBtn').onclick = () => socket.emit('game:nextRound', { roomId: myRoom });

socket.on('room:update', room => {
  if (!myRoom) myRoom = room.id;
  latestRoom = room;
  render(room);
});

function render(room) {
  $('entry').classList.add('hidden');
  $('game').classList.remove('hidden');
  $('roomCode').textContent = room.id;
  $('roundText').textContent = `Round ${room.round || 0} of ${room.maxRounds} · Up to ${room.maxPlayers} players`;

  renderCards($('dealerCards'), room.dealer.hand);
  $('dealerValue').textContent = `Value: ${room.dealer.value}`;

  const me = room.players.find(p => p.id === socket.id);
  const isHost = room.hostId === socket.id;
  const isMyTurn = room.currentTurn === socket.id;

  $('startBtn').disabled = !(isHost && room.status === 'lobby' && room.players.length > 0);
  $('hitBtn').disabled = !(room.status === 'playing' && isMyTurn);
  $('standBtn').disabled = !(room.status === 'playing' && isMyTurn);
  $('nextBtn').disabled = !(isHost && room.status === 'roundOver');

  const turnPlayer = room.players.find(p => p.id === room.currentTurn);
  if (room.status === 'lobby') $('statusText').textContent = isHost ? 'You are host. Start when ready.' : 'Waiting for host to start.';
  else if (room.status === 'playing') $('statusText').textContent = isMyTurn ? 'Your turn. Hit or stand.' : `${turnPlayer?.name || 'Someone'} is playing.`;
  else if (room.status === 'roundOver') $('statusText').textContent = isHost ? 'Round over. Start the next round.' : 'Round over. Waiting for host.';
  else if (room.status === 'finished') $('statusText').textContent = 'Game over.';

  renderScoreboard(room.players);

  $('players').innerHTML = '';
  for (const p of room.players) {
    const div = document.createElement('div');
    div.className = `player ${p.id === room.currentTurn ? 'turn' : ''}`;
    div.innerHTML = `<h3><span>${escapeHtml(p.name)}${p.id === socket.id ? ' (you)' : ''}</span><span>${p.connected ? '🟢' : '⚫'}</span></h3>
      <div class="stat">Chips: ${p.chips} · Gain: ${formatGain(p.gain)} · Bet: ${p.bet}</div>
      <div class="stat">Value: ${p.value} · Status: ${p.status}</div>
      <div class="cards"></div>`;
    renderCards(div.querySelector('.cards'), p.hand);
    $('players').appendChild(div);
  }

  $('log').innerHTML = room.log.map(item => `<li>${escapeHtml(item)}</li>`).join('');

  if (room.status === 'finished') {
    $('winnerBox').classList.remove('hidden');
    const names = room.winners.map(w => `${escapeHtml(w.name)} (${formatGain(w.gain)})`).join(', ');
    $('winnerBox').innerHTML = `<h2>🏆 Winner: ${names}</h2><p>Final score is based on highest net gain from the 1,000-chip starting stack.</p>`;
  } else {
    $('winnerBox').classList.add('hidden');
  }
}

function renderScoreboard(players) {
  const board = $('scoreboard');
  if (!board) return;
  board.innerHTML = [...players]
    .sort((a, b) => b.gain - a.gain)
    .map((p, i) => `<div class="score-row"><span>${i + 1}. ${escapeHtml(p.name)}</span><span class="gain">${formatGain(p.gain)}</span></div>`)
    .join('');
}

function renderCards(container, cards) {
  container.innerHTML = '';
  for (const c of cards || []) {
    const el = document.createElement('div');
    const red = c.suit === '♥' || c.suit === '♦';
    el.className = `playing-card ${red ? 'red' : ''}`;
    el.textContent = `${c.rank}${c.suit}`;
    container.appendChild(el);
  }
}

function showError(msg) { $('entryError').textContent = msg; }
function formatGain(n) { return n >= 0 ? `+${n}` : `${n}`; }
function escapeHtml(str) { return String(str).replace(/[&<>'"]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[s])); }
