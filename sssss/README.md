# BlinkChat (backend-free)

Temporary text + voice rooms for friends. Plain HTML/CSS/JS. No database, accounts, or storage.

## Files
```
blinkchat/
├── index.html
├── css/style.css
├── js/app.js
└── README.md
```

## Run locally
Browsers only allow microphone access on HTTPS or localhost, so don't double-click the file for voice.
```
cd blinkchat
python -m http.server 8000     # or: npx serve
```
Open http://localhost:8000. Open a second tab/browser to test.

## Deploy free (GitHub Pages)
1. Create a GitHub repo and upload these files (index.html at the root).
2. Settings → Pages → Deploy from branch → `main` / root.
3. Your site is at `https://<you>.github.io/<repo>/` (HTTPS, so voice works). Netlify/Cloudflare Pages work the same way.

## Share a room
Create a room, press **Copy link** (or **Copy ID**) and send it. Friends open the link (the ID is in the `#` part and is never sent to the web host), enter a nickname, and join. Or they paste the ID on the home page.

## How it works / required external service
- **Signaling: PeerJS public cloud server** (`0.peerjs.com`, loaded via the PeerJS script from jsDelivr). Free, no key, but shared, unguaranteed, and able to see IPs and Room IDs. To self-host later, pass `host/port/path` to `new Peer(...)` in `app.js`.
- **Text:** star topology. The room creator is the host; friends connect to the host over WebRTC data channels and the host relays messages.
- **Voice:** full mesh, every person connects directly to every other in the call. Fine for about 2–4 people; bandwidth and CPU grow quickly beyond that.
- **STUN:** Google public STUN (`ICE` in `app.js`). **TURN:** none included. Without one, some network pairs (strict NAT, school/office, some mobile data) cannot connect. Add your own TURN entry to `ICE`; credentials in frontend code are public, so use throwaway ones.

## Honest limitations
- If the host closes the tab or loses connection, the room ends.
- If the signaling server is down, nobody can create or join rooms (existing connections keep working).
- WebRTC is encrypted in transit, but BlinkChat has no end-to-end encryption layer of its own and the host relays all text. Anyone can screenshot or copy messages.
- Anyone with the Room ID can join (up to 8 people). Treat the ID like a password.
- Nothing is stored: refresh or leave and messages are gone.
- Not yet tested in this environment against real devices or the live PeerJS server (no network access). Test with two devices, including one on mobile data, before relying on it.
