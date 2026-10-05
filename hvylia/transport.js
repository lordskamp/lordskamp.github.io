import { t } from './locale.js';
import { telegramHeaders, telegramReady } from './telegram.js';

const STORAGE_PREFIX = 'hvylia.session.';
const PROFILE_KEY = 'hvylia.profile';
const read = key => { try { return window.localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { window.localStorage.setItem(key, value); } catch { /* The current session still works in private browsing. */ } };
export function savedSession(code) { try { return JSON.parse(read(STORAGE_PREFIX + code)); } catch { return null; } }
export function lastRoom() { return read('hvylia.lastRoom'); }
export function forgetSession(code) {
  try { window.localStorage.removeItem(STORAGE_PREFIX + code); if (lastRoom() === code) window.localStorage.removeItem('hvylia.lastRoom'); } catch { /* Optional persistence. */ }
}
function apiBase() {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const worker = window.location.hostname.endsWith('.workers.dev');
  const configured = document.querySelector('meta[name="hvylia-api-endpoint"]')?.content;
  return local || worker ? new URL('/api', window.location.origin).href : (configured || new URL('/api', window.location.origin).href).replace(/\/$/, '');
}

export class RoomTransport {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.base = apiBase();
    this.session = null;
    this.socket = null;
    this.pending = new Map();
    this.attempt = 0;
    this.stopped = true;
    this.connected = false;
    this.connecting = false;
    this.generation = 0;
    this.retry = null;
    this.heartbeat = null;
    this.handshakeTimer = null;
    this.lastMessage = 0;
    this.hiddenAt = 0;
    this.profileSession = null;
    try { this.profileSession = JSON.parse(read(PROFILE_KEY)); } catch { /* Start without a profile. */ }
    const wake = () => {
      if (this.stopped || !this.session || document.hidden) return;
      if (!this.connected || Date.now() - this.lastMessage > 25000) this.reconnect();
      else this.ping();
    };
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.hiddenAt = Date.now(); return; }
      wake();
    });
  }

  async headers() {
    await telegramReady;
    const signed = telegramHeaders();
    if (signed['X-Telegram-Init-Data']) return signed;
    if (this.profileSession?.expiresAt <= Date.now()) {
      this.profileSession = null;
      write(PROFILE_KEY, 'null');
    }
    return this.profileSession?.token ? { 'X-Hvylia-Profile': this.profileSession.token } : {};
  }

  async fetchJson(path, { body, token, method = 'POST' } = {}) {
    const signed = await this.headers();
    let response;
    try {
      response = await window.fetch(this.base + path, {
        method, headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...signed, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}),
        signal: window.AbortSignal.timeout(12000), cache: 'no-store'
      });
    } catch { throw { message: t.networkError }; }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw { code: data.code || data.error?.code, message: data.message || data.error?.message || t.requestFailed };
    return data;
  }
  request(path, body, token) { return this.fetchJson(path, { body, token }); }
  get(path) { return this.fetchJson(path, { method: 'GET' }); }
  saveProfile(result) {
    if (!result.token) return;
    this.profileSession = { token: result.token, expiresAt: result.expiresAt, identityType: result.identityType, name: result.profile?.name };
    write(PROFILE_KEY, JSON.stringify(this.profileSession));
  }
  async ensureGuestAccount(name) {
    const headers = await this.headers();
    if (headers['X-Telegram-Init-Data'] || this.profileSession?.identityType === 'telegram') return;
    if (this.profileSession?.name === name.trim()) return;
    const result = await this.request('/hvylia/auth/guest', { name });
    this.saveProfile(result);
    return result;
  }
  beginTelegramLogin() { return this.request('/hvylia/auth/telegram/start', {}); }
  async loginTelegram(challenge) {
    const result = await this.request('/hvylia/auth/telegram/finish', challenge);
    this.saveProfile(result);
    if (this.session && !this.stopped) {
      const resumed = await this.request(`/rooms/${this.session.code}/resume`, {}, this.session.token);
      this.callbacks.state(resumed.state);
    }
    return result;
  }

  async enter(name, code, packId = 'standard') {
    await this.ensureGuestAccount(name);
    const result = await this.request(code ? `/rooms/${encodeURIComponent(code)}/join` : '/rooms', { name, ...(!code ? { packId } : {}) });
    this.attach(result); return result;
  }
  async resume(code) {
    const saved = savedSession(code);
    if (!saved?.token) return false;
    const result = await this.request(`/rooms/${encodeURIComponent(code)}/resume`, {}, saved.token);
    this.attach(result); return true;
  }
  attach(result) {
    this.close();
    this.session = { code: result.code, playerId: result.playerId, token: result.token };
    write(STORAGE_PREFIX + result.code, JSON.stringify(this.session)); write('hvylia.lastRoom', result.code);
    this.stopped = false; this.attempt = 0;
    this.callbacks.state(result.state); this.connect();
  }
  retryLater() {
    if (this.stopped) return;
    window.clearTimeout(this.retry);
    this.callbacks.status('offline');
    this.retry = window.setTimeout(() => this.connect(), Math.min(8000, 400 * 2 ** this.attempt++) + Math.random() * 250);
  }
  reconnect() {
    if (this.stopped || !this.session) return;
    ++this.generation;
    this.connecting = false; this.connected = false;
    window.clearInterval(this.heartbeat); window.clearTimeout(this.handshakeTimer); window.clearTimeout(this.retry);
    const old = this.socket; this.socket = null;
    try { old?.close(); } catch { /* An abandoned socket must not block a new one. */ }
    this.connect();
  }
  expire(error) {
    this.stopped = true; this.connected = false; this.connecting = false;
    window.clearInterval(this.heartbeat); window.clearTimeout(this.handshakeTimer); window.clearTimeout(this.retry);
    this.rejectPending(error);
    this.callbacks.error(error); this.callbacks.status('expired');
    this.socket?.close();
  }
  async connect() {
    if (this.stopped || !this.session || this.connecting || (this.socket && this.socket.readyState < 2)) return;
    window.clearTimeout(this.retry);
    this.connecting = true;
    const generation = ++this.generation;
    this.callbacks.status('connecting');
    let ticket;
    try { ({ ticket } = await this.request(`/rooms/${this.session.code}/socket-ticket`, {}, this.session.token)); }
    catch (error) {
      if (generation !== this.generation || this.stopped) return;
      this.connecting = false;
      if (['INVALID_TOKEN', 'SESSION', 'PLAYER_NOT_FOUND', 'UNAUTHORIZED', 'KICKED', 'ROOM_NOT_FOUND', 'NOT_FOUND'].includes(error.code)) this.expire(error);
      else this.retryLater();
      return;
    }
    if (generation !== this.generation || this.stopped) return;
    this.connecting = false;
    const url = new URL(`${this.base}/rooms/${this.session.code}/socket`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', ticket);
    let socket;
    try { socket = this.socket = new window.WebSocket(url); }
    catch { this.socket = null; this.retryLater(); return; }
    const current = () => generation === this.generation && socket === this.socket && !this.stopped;
    this.handshakeTimer = window.setTimeout(() => { if (current() && !this.connected) this.reconnect(); }, 10000);
    socket.addEventListener('open', () => { if (current()) this.lastMessage = Date.now(); });
    socket.addEventListener('message', event => {
      if (!current()) return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      this.lastMessage = Date.now();
      if (message.type === 'state') {
        this.callbacks.state(message.state);
        if (!current()) return;
        if (!this.connected) {
          this.attempt = 0; this.connected = true;
          window.clearTimeout(this.handshakeTimer);
          this.callbacks.status('connected');
          window.clearInterval(this.heartbeat);
          this.heartbeat = window.setInterval(() => {
            if (document.hidden) return;
            if (Date.now() - this.lastMessage > 45000) { this.reconnect(); return; }
            this.ping();
          }, 15000);
          // Reuse action IDs: a lost acknowledgment cannot award a turn twice.
          for (const [id, item] of this.pending) this.sendAction(id, item.action);
        }
      }
      if (message.type === 'ack') this.settle(message.id);
      if (message.type === 'error') {
        if (['SESSION', 'PLAYER_NOT_FOUND', 'KICKED'].includes(message.code)) { this.expire(message); return; }
        if (message.code === 'DISCONNECTED') { this.reconnect(); return; }
        if (this.pending.has(message.id)) this.settle(message.id, message); else this.callbacks.error(message);
      }
      if (message.type === 'replaced') {
        this.stopped = true; this.connected = false;
        window.clearInterval(this.heartbeat); window.clearTimeout(this.handshakeTimer);
        this.rejectPending({ message: t.replaced }); this.callbacks.status('replaced'); socket.close();
      }
    });
    socket.addEventListener('close', event => {
      if (!current()) return;
      this.socket = null; this.connected = false; this.connecting = false;
      window.clearInterval(this.heartbeat); window.clearTimeout(this.handshakeTimer);
      if (event.code === 4003) { this.expire({ code: 'SESSION', message: t.requestFailed }); return; }
      this.retryLater();
    });
    socket.addEventListener('error', () => { if (current()) this.reconnect(); });
  }
  ping() { try { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'ping' })); } catch { this.reconnect(); } }
  sendAction(id, action) {
    try { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ id, type: 'action', action })); }
    catch { this.reconnect(); }
  }
  action(action) {
    if (!this.connected || this.socket?.readyState !== 1) { if (!this.stopped) this.reconnect(); return Promise.reject({ message: t.offline }); }
    const id = window.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { this.settle(id, { message: t.timeout }); if (!this.stopped) this.reconnect(); }, 20000);
      this.pending.set(id, { resolve, reject, timer, action }); this.sendAction(id, action);
    });
  }
  settle(id, error) {
    const item = this.pending.get(id); if (!item) return;
    window.clearTimeout(item.timer); this.pending.delete(id);
    if (error) item.reject(error); else item.resolve();
  }
  rejectPending(error) { for (const id of this.pending.keys()) this.settle(id, error); }
  close() {
    this.stopped = true; this.connected = false; this.connecting = false; ++this.generation;
    window.clearTimeout(this.retry); window.clearInterval(this.heartbeat); window.clearTimeout(this.handshakeTimer);
    const socket = this.socket; this.socket = null; socket?.close();
    this.rejectPending({ message: t.offline });
  }
}
