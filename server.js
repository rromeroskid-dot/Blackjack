const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const MAX_PLAYERS = 6;
const MAX_ROUNDS = 10;
const STARTING_CHIPS = 1000;
const DEFAULT_BET = 100;

function roomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function newDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const suit of suits) for (const rank of ranks) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.rank === 'A') {
      total += 11;
      aces++;
    } else if (['K', 'Q', 'J'].includes(card.rank)) total += 10;
    else total += Number(card.rank);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

function publicRoom(room) {
  return {
    id: room.id,
    hostId: room.hostId,
    status: room.status,
    round: room.round,
    maxRounds: MAX_ROUNDS,
    maxPlayers: MAX_PLAYERS,
    log: room.log.slice(-7),
    dealer: {
      hand: room.status === 'playing' ? [room.dealer.hand[0], { rank: '?', suit: '?' }] : room.dealer.hand,
      value: room.status === 'playing' ? handValue([room.dealer.hand[0]]) : handValue(room.dealer.hand)
    },
    currentTurn: room.currentTurn,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      gain: p.chips - STARTING_CHIPS,
      bet: p.bet,
      hand: p.hand,
      value: handValue(p.hand),
      status: p.status,
      connected: p.connected
    })),
    winners: room.status === 'finished' ? getWinners(room) : []
  };
}

function getWinners(room) {
  const maxGain = Math.max(...room.players.map(p => p.chips - STARTING_CHIPS));
  return room.players.filter(p => p.chips - STARTING_CHIPS === maxGain).map(p => ({ name: p.name, gain: p.chips - STARTING_CHIPS, chips: p.chips }));
}

function emitRoom(room) {
  io.to(room.id).emit('room:update', publicRoom(room));
}

function findPlayer(room, socketId) {
  return room.players.find(p => p.id === socketId);
}

function activePlayers(room) {
  return room.players.filter(p => p.connected && p.chips > 0);
}

function nextTurn(room) {
  const order = room.players.filter(p => p.chips > 0);
  const next = order.find(p => p.status === 'active');
  room.currentTurn = next ? next.id : null;
  if (!room.currentTurn) finishDealerAndRound(room);
}

function startRound(room) {
  if (room.round >= MAX_ROUNDS) {
    room.status = 'finished';
    room.log.push('Game complete. Final winner calculated by highest net gain.');
    return;
  }
  const players = activePlayers(room);
  if (players.length === 0) return;

  room.round += 1;
  room.status = 'playing';
  room.deck = newDeck();
  room.dealer = { hand: [] };
  room.currentTurn = null;

  for (const p of room.players) {
    p.hand = [];
    p.bet = 0;
    if (p.connected && p.chips > 0) {
      p.bet = Math.min(DEFAULT_BET, p.chips);
      p.chips -= p.bet;
      p.status = 'active';
    } else {
      p.status = p.chips <= 0 ? 'broke' : 'away';
    }
  }

  for (let i = 0; i < 2; i++) {
    for (const p of room.players.filter(p => p.status === 'active')) p.hand.push(room.deck.pop());
    room.dealer.hand.push(room.deck.pop());
  }

  for (const p of room.players.filter(p => p.status === 'active')) {
    if (isBlackjack(p.hand)) p.status = 'stand';
  }

  room.log.push(`Round ${room.round} started. Each player antes ${DEFAULT_BET} chips.`);
  nextTurn(room);
}

function finishDealerAndRound(room) {
  room.status = 'settling';
  while (handValue(room.dealer.hand) < 17) room.dealer.hand.push(room.deck.pop());
  const dealerValue = handValue(room.dealer.hand);
  const dealerBust = dealerValue > 21;

  for (const p of room.players.filter(p => p.bet > 0)) {
    const value = handValue(p.hand);
    let result = '';
    if (p.status === 'bust' || value > 21) {
      result = 'lost';
    } else if (isBlackjack(p.hand) && !isBlackjack(room.dealer.hand)) {
      p.chips += Math.floor(p.bet * 2.5); // original bet + 3:2 profit
      result = 'blackjack win';
    } else if (dealerBust || value > dealerValue) {
      p.chips += p.bet * 2;
      result = 'won';
    } else if (value === dealerValue) {
      p.chips += p.bet;
      result = 'pushed';
    } else {
      result = 'lost';
    }
    p.status = result;
  }

  room.log.push(`Dealer finished at ${dealerValue}${dealerBust ? ' and busted' : ''}.`);
  if (room.round >= MAX_ROUNDS) {
    room.status = 'finished';
    room.log.push('Game complete. Final winner calculated by highest net gain.');
  } else {
    room.status = 'roundOver';
  }
}

io.on('connection', socket => {
  socket.on('room:create', ({ name }, cb) => {
    const id = roomId();
    const player = { id: socket.id, name: cleanName(name), chips: STARTING_CHIPS, bet: 0, hand: [], status: 'waiting', connected: true };
    const room = { id, hostId: socket.id, players: [player], status: 'lobby', round: 0, deck: [], dealer: { hand: [] }, currentTurn: null, log: ['Room created. Share the link to invite players.'] };
    rooms.set(id, room);
    socket.join(id);
    cb({ roomId: id });
    emitRoom(room);
  });

  socket.on('room:join', ({ roomId, name }, cb) => {
    const id = String(roomId || '').toUpperCase();
    const room = rooms.get(id);
    if (!room) return cb({ error: 'Room not found.' });
    if (room.status !== 'lobby') return cb({ error: 'This game already started.' });
    if (room.players.length >= MAX_PLAYERS) return cb({ error: 'Room is full.' });
    room.players.push({ id: socket.id, name: cleanName(name), chips: STARTING_CHIPS, bet: 0, hand: [], status: 'waiting', connected: true });
    socket.join(id);
    room.log.push(`${cleanName(name)} joined.`);
    cb({ roomId: id });
    emitRoom(room);
  });

  socket.on('game:start', ({ roomId }) => {
    const room = rooms.get(String(roomId || '').toUpperCase());
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    startRound(room);
    emitRoom(room);
  });

  socket.on('player:hit', ({ roomId }) => {
    const room = rooms.get(String(roomId || '').toUpperCase());
    if (!room || room.currentTurn !== socket.id || room.status !== 'playing') return;
    const p = findPlayer(room, socket.id);
    p.hand.push(room.deck.pop());
    if (handValue(p.hand) > 21) {
      p.status = 'bust';
      room.log.push(`${p.name} busted.`);
      nextTurn(room);
    }
    emitRoom(room);
  });

  socket.on('player:stand', ({ roomId }) => {
    const room = rooms.get(String(roomId || '').toUpperCase());
    if (!room || room.currentTurn !== socket.id || room.status !== 'playing') return;
    const p = findPlayer(room, socket.id);
    p.status = 'stand';
    room.log.push(`${p.name} stood at ${handValue(p.hand)}.`);
    nextTurn(room);
    emitRoom(room);
  });

  socket.on('game:nextRound', ({ roomId }) => {
    const room = rooms.get(String(roomId || '').toUpperCase());
    if (!room || room.hostId !== socket.id || room.status !== 'roundOver') return;
    startRound(room);
    emitRoom(room);
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const player = findPlayer(room, socket.id);
      if (!player) continue;
      player.connected = false;
      if (room.currentTurn === socket.id) {
        player.status = 'away';
        nextTurn(room);
      }
      room.log.push(`${player.name} disconnected.`);
      emitRoom(room);
    }
  });
});

function cleanName(name) {
  return String(name || 'Player').trim().slice(0, 18) || 'Player';
}

server.listen(PORT, () => console.log(`Blackjack app running on port ${PORT}`));
