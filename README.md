# 10-Round Multiplayer Blackjack

A lightweight browser-based blackjack game with:

- Shareable room links
- Up to 6 players
- 10 rounds
- 1,000 starting chips per player
- 100-chip ante per round
- Winner calculated by highest net gain after round 10
- Real-time multiplayer via Socket.IO

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Deploy and share by link

The easiest options are Render, Railway, Fly.io, or any Node-compatible host.

### Render quick deploy

1. Create a new Web Service.
2. Upload/connect this project.
3. Build command: `npm install`
4. Start command: `npm start`
5. After deploy, share the app URL. Players can create a room and use the Copy Invite Link button.

## Notes

This version stores rooms in server memory. It is perfect for casual sessions, but rooms reset if the server restarts. For persistent games, add a database such as Redis or Postgres.

## iPhone browser experience

This version is mobile-first and works in iPhone Safari/Chrome as a normal browser game. It also includes a web app manifest and Apple mobile tags, so players can open the link in Safari and use Share → Add to Home Screen for an app-like launch icon.

Recommended deployment: Render, Railway, Fly.io, or any Node host that supports WebSockets. Socket.IO must be allowed for real-time rooms.
