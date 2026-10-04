import { t } from './locale.js';
import { telegramHeaders, telegramReady } from './telegram.js';

const STORAGE_PREFIX = 'hvylia.session.';
const read = key => { try { return window.localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { window.localStorage.setItem(key, value); } catch { /* Private browsing still supports the live session. */ } };
export function savedSession(code) {
  try { return JSON.parse(read(STORAGE_PREFIX + code)); } catch { return null; }
}
export function lastRoom() { return read('hvylia.lastRoom'); }
export function forgetSession(code) {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + code);
    if (lastRoom() === code) window.localStorage.removeItem('hvylia.lastRoom');
  } catch { /* Storage may be unavailable. */ }
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
    this.generation = 0;
    this.retry = null;
    this.heartbeat = null;
    window.addEventListener('online', () => { if (!this.stopped && !this.connected) this.connect(); });
  }

  async request(path, body, token) {
    await telegramReady;
    const signedHeaders = telegramHeaders();
    let response;
    try {
      response = await window.fetch(this.base + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...signedHeaders, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body || {}), signal: window.AbortSignal.timeout(12000)
      });
    } catch { throw { message: t.networkError }; }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw { code: data.code || data.error?.code, message: data.message || data.error?.message || t.requestFailed };
    return data;
  }

  async get(path) {
    await telegramReady;
    const signedHeaders = telegramHeaders();
    let response;
    try {
      response = await window.fetch(this.base + path, {
        headers: signedHeaders, signal: window.AbortSignal.timeout(12000), cache: 'no-store'
      });
    } catch { throw { message: t.networkError }; }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw { code: data.code || data.error?.code, message: data.message || data.error?.message || t.requestFailed };
    return data;
  }

  async enter(name, code, packId = 'standard') {
    const result = await this.request(code ? `/rooms/${encodeURIComponent(code)}/join` : '/rooms', { name, ...(!code ? { packId } : {}) });
    this.attach(result);
    return result;
  }

  async resume(code) {
    const saved = savedSession(code);
    if (!saved?.token) return false;
    const result = await this.request(`/rooms/${encodeURIComponent(code)}/resume`, {}, saved.token);
    this.attach(result);
    return true;
  }

  attach(result) {
    this.close();
    this.session = { code: result.code, playerId: result.playerId, token: result.token };
    write(STORAGE_PREFIX + result.code, JSON.stringify(this.session));
    write('hvylia.lastRoom', result.code);
    this.stopped = false;
    this.attempt = 0;
    this.callbacks.state(result.state);
    this.connect();
  }

  async connect() {
    if (this.stopped || !this.session) return;
    window.clearTimeout(this.retry);
    if ((this.socket && this.socket.readyState < 2) || this.connecting) return;
    this.connecting = true;
    const generation = ++this.generation;
    this.callbacks.status('connecting');
    let ticket;
    try {
      ({ ticket } = await this.request(`/rooms/${this.session.code}/socket-ticket`, {}, this.session.token));
    } catch (error) {
      this.connecting = false;
      if (generation !== this.generation || this.stopped) return;
      if (['INVALID_TOKEN', 'SESSION', 'PLAYER_NOT_FOUND', 'UNAUTHORIZED', 'KICKED', 'ROOM_NOT_FOUND', 'NOT_FOUND'].includes(error.code)) {
        this.stopped = true;
        this.callbacks.error(error);
        this.callbacks.status('expired');
        return;
      }
      this.callbacks.status('offline');
      this.retry = window.setTimeout(() => this.connect(), Math.min(10000, 650 * 2 ** this.attempt++));
      return;
    }
    this.connecting = false;
    if (generation !== this.generation || this.stopped) return;
    const url = new URL(`${this.base}/rooms/${this.session.code}/socket`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', ticket);
    const socket = this.socket = new window.WebSocket(url);
    let lastPong = Date.now();
    socket.addEventListener('open', () => {
      if (generation !== this.generation) return;
      this.attempt = 0;
      this.connected = true;
      this.callbacks.status('connected');
      window.clearInterval(this.heartbeat);
      this.heartbeat = window.setInterval(() => {
        if (Date.now() - lastPong > 40000) { socket.close(); return; }
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'ping' }));
      }, 15000);
    });
    socket.addEventListener('message', event => {
      if (generation !== this.generation) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      lastPong = Date.now();
      if (message.type === 'state') this.callbacks.state(message.state);
      if (message.type === 'ack') this.settle(message.id);
      if (message.type === 'error') {
        if (this.pending.has(message.id)) this.settle(message.id, message);
        else this.callbacks.error(message);
        if (['SESSION', 'PLAYER_NOT_FOUND', 'KICKED'].includes(message.code)) {
          this.stopped = true;
          this.callbacks.status('expired');
          socket.close();
        }
      }
      if (message.type === 'replaced') {
        this.stopped = true;
        this.connected = false;
        this.callbacks.status('replaced');
        socket.close();
      }
    });
    socket.addEventListener('close', event => {
      if (generation !== this.generation) return;
      this.connected = false;
      window.clearInterval(this.heartbeat);
      this.rejectPending({ message: t.offline });
      if (event.code === 4003 && !this.stopped) {
        this.stopped = true;
        this.callbacks.error({ code: 'SESSION' });
        this.callbacks.status('expired');
        return;
      }
      if (this.stopped) return;
      this.callbacks.status('offline');
      this.retry = window.setTimeout(() => this.connect(), Math.min(10000, 650 * 2 ** this.attempt++) + Math.random() * 300);
    });
    socket.addEventListener('error', () => { if (socket.readyState < 2) socket.close(); });
  }

  action(action) {
    if (!this.connected || this.socket?.readyState !== 1) return Promise.reject({ message: t.offline });
    const id = window.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => this.settle(id, { message: t.timeout }), 9000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, type: 'action', action }));
    });
  }

  settle(id, error) {
    const item = this.pending.get(id);
    if (!item) return;
    window.clearTimeout(item.timer);
    this.pending.delete(id);
    if (error) item.reject(error); else item.resolve();
  }

  rejectPending(error) { for (const id of this.pending.keys()) this.settle(id, error); }
  close() {
    this.stopped = true;
    this.connected = false;
    this.generation++;
    window.clearTimeout(this.retry);
    window.clearInterval(this.heartbeat);
    this.socket?.close();
    this.socket = null;
    this.rejectPending({ message: t.offline });
  }
}
