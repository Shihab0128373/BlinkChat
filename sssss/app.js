'use strict';
// ---- Config -------------------------------------------------------------
// STUN helps most networks connect. Some (strict NAT, corporate, some mobile
// carriers) need a TURN relay: add one below. Anything here is visible to
// every visitor, so only use throwaway/free-tier TURN credentials.
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const PREFIX = 'blinkchat-';
const MAX_PEOPLE = 8;
const $ = s => document.querySelector(s);
const S = fresh();
function fresh() {
  return { peer: null, isHost: false, room: '', nick: '', myId: '', conns: new Map(), hostConn: null,
    roster: [], calls: new Map(), stream: null, inCall: false, muted: false, deaf: false, vol: 1,
    pending: [], t0: 0, tick: null, left: false };
}
const clean = (n, d = 'Guest') => (typeof n === 'string' ? n.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 20) : '') || d;
const norm = v => v.toLowerCase().replace(/[^a-z0-9]/g, '');
const hostPid = () => PREFIX + S.room;
function genRoom() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), x => a[x % a.length]).join('');
}
const nameOf = id => (S.roster.find(p => p.id === id) || {}).nick || 'Someone';

// ---- Landing --------------------------------------------------------------
function showErr(m) { $('#busy').hidden = true; const e = $('#err'); e.textContent = m; e.hidden = !m; setBusy(false); }
function setBusy(b, t) { $('#busy').hidden = !b; $('#busyTxt').textContent = t || ''; $('#create').disabled = $('#join').disabled = b; if (b) $('#err').hidden = true; }
function start(host) {
  const nick = clean($('#nick').value, '');
  if (!nick) return showErr('Enter a nickname first.');
  if (typeof Peer === 'undefined') return showErr('Could not load the PeerJS library. Check your internet connection and reload.');
  let room = genRoom();
  if (!host) { room = norm($('#rid').value); if (room.length < 8) return showErr('Enter the Room ID your friend shared.'); }
  Object.assign(S, fresh(), { nick, room, isHost: host });
  setBusy(true, host ? 'Creating room…' : 'Joining room…');
  const p = S.peer = new Peer(host ? hostPid() : undefined, { config: { iceServers: ICE }, debug: 0 });
  const wait = setTimeout(() => { if (!S.myId) { abort(); showErr('The signaling server did not respond. It may be down; try again later.'); } }, 15000);
  p.on('open', id => { clearTimeout(wait); S.myId = id; host ? hostReady() : joinHost(); });
  p.on('error', e => {
    clearTimeout(wait);
    if (!S.roster.length && !S.hostConn) { abort(); showErr(e.type === 'peer-unavailable' ? 'Room not found, or its host is offline.'
      : e.type === 'unavailable-id' ? 'Room ID collision. Please try again.' : 'Connection problem: ' + e.type); }
    else sys('Connection problem: ' + e.type);
  });
  p.on('disconnected', () => { if (!S.left && !p.destroyed) { status('Signaling lost, reconnecting…', 'warn'); p.reconnect(); } });
  p.on('call', onCall);
  if (host) p.on('connection', onGuest);
}
function abort() { try { S.peer && S.peer.destroy(); } catch (e) {} Object.assign(S, fresh()); }
function hostReady() {
  S.roster = [{ id: S.myId, nick: S.nick }];
  openRoom(); sys('Room created. Copy the invite link and send it to your friends.'); status('Online, waiting for friends', 'ok');
}
function joinHost() {
  const c = S.hostConn = S.peer.connect(hostPid(), { reliable: true, metadata: { nick: S.nick } });
  const t = setTimeout(() => { if (!c.open) { abort(); showErr('Could not reach the room. The host may be offline or your network blocks peer connections.'); } }, 12000);
  c.on('open', () => { clearTimeout(t); openRoom(); status('Connected', 'ok'); });
  c.on('data', onClientData);
  c.on('close', () => { if (!S.left) leave('The host left, so the room has ended.'); });
  c.on('error', () => { if (!S.left) status('Connection to host failed', 'err'); });
}
function openRoom() {
  setBusy(false); $('#landing').hidden = true; $('#room').hidden = false;
  $('#rid-show').textContent = 'ID: ' + S.room; $('#msgs').innerHTML = '<p id="empty" class="empty">No messages yet. Say hi 👋</p>';
  renderRoster(); updateCall(); $('#text').focus();
}

// ---- Host: accept guests, relay chat, publish roster ---------------------
function onGuest(conn) {
  conn.on('open', () => {
    if (S.roster.length >= MAX_PEOPLE) { conn.send({ t: 'full' }); return setTimeout(() => conn.close(), 300); }
    S.conns.set(conn.peer, conn);
    hostSet(S.roster.concat({ id: conn.peer, nick: clean(conn.metadata && conn.metadata.nick) }));
  });
  conn.on('data', d => {
    if (!d || d.t !== 'msg' || typeof d.text !== 'string' || !S.conns.has(conn.peer)) return;
    const m = { t: 'msg', id: conn.peer, nick: nameOf(conn.peer), text: d.text.slice(0, 1000), ts: Date.now() };
    bcast(m); addMsg(m);
  });
  const gone = () => { if (S.conns.delete(conn.peer)) hostSet(S.roster.filter(p => p.id !== conn.peer)); };
  conn.on('close', gone); conn.on('error', gone);
}
const bcast = o => S.conns.forEach(c => c.open && c.send(o));
function hostSet(list) { setRoster(list); bcast({ t: 'roster', list }); }
function onClientData(d) {
  if (!d) return;
  if (d.t === 'full') return leave('This room is full.');
  if (d.t === 'roster' && Array.isArray(d.list)) setRoster(d.list.slice(0, MAX_PEOPLE).filter(p => p && typeof p.id === 'string').map(p => ({ id: p.id, nick: clean(p.nick) })));
  if (d.t === 'msg' && typeof d.text === 'string') addMsg({ id: String(d.id), nick: clean(d.nick), text: d.text.slice(0, 1000), ts: +d.ts || Date.now() });
}
function setRoster(list) {
  const old = new Set(S.roster.map(p => p.id)), now = new Set(list.map(p => p.id));
  if (S.roster.length) {
    list.forEach(p => old.has(p.id) || sys(p.nick + ' joined'));
    S.roster.forEach(p => { if (!now.has(p.id)) { sys(p.nick + ' left'); dropCall(p.id); } });
  }
  S.roster = list; renderRoster(); updateCall();
}

// ---- Chat UI ----------------------------------------------------------------
function addMsg(m) {
  const own = m.id === S.myId, box = $('#msgs'), e = $('#empty'); e && e.remove();
  const d = document.createElement('div'); d.className = 'msg ' + (own ? 'out' : 'in');
  if (!own) { const b = document.createElement('b'); b.textContent = m.nick; d.append(b); }
  d.append(document.createTextNode(m.text));
  const t = document.createElement('time'); t.textContent = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); d.append(t);
  box.append(d); box.scrollTop = box.scrollHeight;
}
function sys(txt) {
  const box = $('#msgs'); if (!box) return; const e = $('#empty'); e && e.remove();
  const d = document.createElement('div'); d.className = 'sys'; d.textContent = txt; box.append(d); box.scrollTop = box.scrollHeight;
}
function status(t, k) { $('#status').textContent = t; $('#dot').className = 'dot ' + (k || ''); }
function renderRoster() {
  const h = S.roster.find(p => p.id === hostPid());
  $('#rname').textContent = (h ? h.nick : 'Friends') + "'s room";
  const ul = $('#people'); ul.innerHTML = '';
  S.roster.forEach(p => {
    const li = document.createElement('li'), n = document.createElement('span'), s = document.createElement('small');
    n.textContent = p.nick + (p.id === S.myId ? ' (you)' : '') + (p.id === hostPid() ? ' ★' : '');
    const c = S.calls.get(p.id);
    if (p.id === S.myId) { s.textContent = S.inCall ? 'in call' : ''; }
    else if (c) { s.textContent = c.state; s.className = c.state === 'connected' ? 'live' : ''; }
    li.append(n, s); ul.append(li);
  });
}
function sendMsg(text) {
  text = text.trim().slice(0, 1000); if (!text) return;
  if (S.isHost) { const m = { t: 'msg', id: S.myId, nick: S.nick, text, ts: Date.now() }; bcast(m); addMsg(m); }
  else if (S.hostConn && S.hostConn.open) S.hostConn.send({ t: 'msg', text });
  else sys('Not connected, message not sent.');
}

// ---- Voice (WebRTC mesh via PeerJS media calls) ---------------------------
async function getMic() {
  if (S.stream) return S.stream;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { sys('Voice needs HTTPS (or localhost) and a supported browser.'); return null; }
  try { return S.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { sys(e.name === 'NotAllowedError' ? 'Microphone permission was denied.' : e.name === 'NotFoundError' ? 'No microphone found.' : 'Microphone error: ' + e.message); return null; }
}
async function toggleCall() {
  if (S.inCall) return endCall();
  if (!(await getMic())) return;
  enterCall();
  const others = S.roster.filter(p => p.id !== S.myId);
  others.forEach(callPeer);
  if (!others.length) sys('Call started. Waiting for friends to join the room.');
}
function enterCall() { S.inCall = true; S.muted = false; S.t0 = 0; clearInterval(S.tick); S.tick = setInterval(updateCall, 1000); updateCall(); renderRoster(); }
function callPeer(p) {
  if (S.calls.has(p.id) || !S.peer) return;
  const c = S.peer.call(p.id, S.stream, { metadata: { nick: S.nick } });
  if (c) track(c, p.id);
}
function track(call, id) {
  const old = S.calls.get(id); if (old && old.call !== call) { old.call.close(); }
  const e = { call, state: call.open ? 'connecting' : 'ringing', to: setTimeout(() => { if (e.state === 'ringing') { sys(nameOf(id) + ' did not answer.'); dropCall(id); } }, 30000) };
  S.calls.set(id, e);
  call.on('stream', st => {
    e.state = 'connecting'; clearTimeout(e.to); attach(id, st);
    const pc = call.peerConnection, upd = () => {
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') { e.state = 'connected'; if (!S.t0) S.t0 = Date.now(); }
      else if (s === 'failed') { e.state = 'failed'; sys('Voice link to ' + nameOf(id) + ' failed. A TURN relay may be needed on one of your networks.'); }
      else if (s === 'disconnected') e.state = 'reconnecting'; else e.state = 'connecting';
      renderRoster(); updateCall();
    };
    pc.addEventListener('iceconnectionstatechange', upd); upd();
  });
  call.on('close', () => { if (S.calls.get(id) === e) dropCall(id); });
  call.on('error', () => { if (S.calls.get(id) === e) { sys('Call error with ' + nameOf(id)); dropCall(id); } });
  renderRoster();
}
function attach(id, st) {
  document.querySelectorAll('#audios audio').forEach(a => a.dataset.id === id && a.remove());
  const a = document.createElement('audio'); a.autoplay = true; a.srcObject = st; a.dataset.id = id; a.volume = S.vol; a.muted = S.deaf;
  $('#audios').append(a); a.play().catch(() => sys('Your browser blocked audio playback. Tap the page and try again.'));
}
function dropCall(id) {
  const e = S.calls.get(id);
  if (e) { clearTimeout(e.to); S.calls.delete(id); try { e.call.close(); } catch (x) {} }
  document.querySelectorAll('#audios audio').forEach(a => a.dataset.id === id && a.remove());
  renderRoster(); updateCall();
}
function onCall(call) {
  const id = call.peer;
  if (!S.roster.some(p => p.id === id)) return call.close(); // only people in this room
  if (S.inCall) { call.answer(S.stream); return track(call, id); }
  S.pending.push(call);
  call.on('close', () => { S.pending = S.pending.filter(c => c !== call); if (!S.pending.length) $('#incoming').hidden = true; });
  $('#inTxt').textContent = nameOf(id) + ' is calling you on voice.'; $('#incoming').hidden = false; $('#accept').focus();
}
async function accept() {
  $('#incoming').hidden = true;
  const calls = S.pending; S.pending = [];
  if (!(await getMic())) return calls.forEach(c => c.close());
  enterCall();
  calls.forEach(c => { c.answer(S.stream); track(c, c.peer); });
  // Mesh: to avoid both sides dialing at once, only dial peers with a larger ID.
  S.roster.filter(p => p.id !== S.myId && p.id > S.myId).forEach(callPeer);
}
function decline() { $('#incoming').hidden = true; S.pending.forEach(c => c.close()); S.pending = []; }
function endCall() {
  [...S.calls.keys()].forEach(dropCall);
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  S.stream = null; S.inCall = false; S.muted = false; S.t0 = 0; clearInterval(S.tick);
  decline(); renderRoster(); updateCall();
}
function updateCall() {
  if (!$('#callBtn')) return;
  $('#callBtn').textContent = S.inCall ? '📵 End call' : '🎤 Start call';
  $('#callCtl').hidden = !S.inCall;
  const n = S.calls.size, ok = [...S.calls.values()].filter(c => c.state === 'connected').length;
  const dur = S.t0 ? (() => { const s = Math.floor((Date.now() - S.t0) / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); })() : '--:--';
  $('#callInfo').textContent = !S.inCall ? 'Not in a call. Voice uses a peer-to-peer mesh, best for about 4 people.'
    : !n ? 'In call, waiting for others… ' : ok ? `Connected to ${ok} of ${n} · ${dur}` : 'Connecting… (not connected yet)';
  $('#muteBtn').textContent = S.muted ? 'Unmute' : 'Mute';
  $('#spkBtn').textContent = S.deaf ? 'Speaker on' : 'Speaker off';
}

// ---- Leave / cleanup ------------------------------------------------------
function leave(note) {
  S.left = true; endCall();
  S.conns.forEach(c => c.close()); S.hostConn && S.hostConn.close();
  try { S.peer && S.peer.destroy(); } catch (e) {}
  Object.assign(S, fresh());
  $('#msgs').innerHTML = ''; $('#people').innerHTML = ''; $('#text').value = '';
  $('#room').hidden = true; $('#landing').hidden = false; setBusy(false);
  if (note) showErr(note);
}

// ---- Wiring -------------------------------------------------------------------
const copy = (t, label) => (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => sys(label + ' copied.'), () => prompt('Copy this:', t));
$('#create').onclick = () => start(true);
$('#join').onclick = () => start(false);
$('#nick').onkeydown = $('#rid').onkeydown = e => { if (e.key === 'Enter') start(!norm($('#rid').value)); };
$('#copyId').onclick = () => copy(S.room, 'Room ID');
$('#copyLink').onclick = () => copy(location.href.split('#')[0] + '#' + S.room, 'Invite link');
$('#leave').onclick = () => leave();
$('#form').onsubmit = e => { e.preventDefault(); sendMsg($('#text').value); $('#text').value = ''; $('#emo').hidden = true; };
$('#callBtn').onclick = toggleCall;
$('#muteBtn').onclick = () => { S.muted = !S.muted; S.stream && S.stream.getAudioTracks().forEach(t => t.enabled = !S.muted); updateCall(); };
$('#spkBtn').onclick = () => { S.deaf = !S.deaf; document.querySelectorAll('#audios audio').forEach(a => a.muted = S.deaf); updateCall(); };
$('#vol').oninput = e => { S.vol = +e.target.value; document.querySelectorAll('#audios audio').forEach(a => a.volume = S.vol); };
$('#accept').onclick = accept; $('#decline').onclick = decline;
$('#peopleBtn').onclick = () => $('#side').classList.toggle('open');
$('#msgs').onclick = () => $('#side').classList.remove('open');
$('#emoBtn').onclick = () => { $('#emo').hidden = !$('#emo').hidden; };
['😀','😂','😍','👍','🙏','🎉','🔥','❤️','😮','😢','😎','🤝','👋','✅','🙌','😅'].forEach(x => {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = x; b.setAttribute('aria-label', 'Insert ' + x);
  b.onclick = () => { const i = $('#text'); i.value += x; i.focus(); }; $('#emo').append(b);
});
window.addEventListener('offline', () => S.peer && status('You are offline', 'err'));
window.addEventListener('online', () => S.peer && status('Back online', 'ok'));
window.addEventListener('pagehide', () => { try { S.peer && S.peer.destroy(); } catch (e) {} });
if (location.hash.length > 1) { $('#rid').value = norm(location.hash); $('#nick').focus(); }
