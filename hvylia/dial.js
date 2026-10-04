import { t } from './locale.js';

const clamp = n => Math.max(0, Math.min(100, n));
const point = (position, radius) => {
  const angle = Math.PI * (1 - position / 100);
  return [360 + Math.cos(angle) * radius, 330 - Math.sin(angle) * radius];
};
function sector(start, end) {
  const a = point(clamp(start), 280), b = point(clamp(end), 280);
  return `M360 330 L${a[0]} ${a[1]} A280 280 0 0 1 ${b[0]} ${b[1]} Z`;
}
export function dialMarkup(id = 'dial') {
  const ticks = Array.from({ length: 21 }, (_, i) => {
    const a = point(i * 5, 288), b = point(i * 5, i % 5 === 0 ? 302 : 295);
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="dial-tick${i % 5 === 0 ? ' major' : ''}"/>`;
  }).join('');
  return `<div id="${id}" class="dial" role="slider" aria-label="${t.position}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-disabled="true" tabindex="-1">
    <svg viewBox="0 0 720 380" class="dial-svg" aria-hidden="true">
      <path class="dial-face" d="M80 330 A280 280 0 0 1 640 330 Z"/>
      <g class="dial-target" visibility="hidden">${[2, 3, 4, 3, 2].map((score, i) => `<path data-sector="${i}" class="target-sector sector-${score}"/><text data-sector-label="${i}" class="sector-label">${score}</text>`).join('')}<line class="target-center"/></g>
      <path class="dial-rim" d="M80 330 A280 280 0 0 1 640 330"/>
      <g>${ticks}</g>
      <line x1="80" y1="330" x2="640" y2="330" class="dial-baseline"/>
      <g class="dial-needle"><path d="M351 330 L356 83 Q360 76 364 83 L369 330 Z"/><circle cx="360" cy="330" r="20"/><circle class="needle-pin" cx="360" cy="330" r="5"/></g>
      <text class="dial-readout" x="360" y="373" text-anchor="middle">50</text>
    </svg>
    <span class="dial-caption">${t.targetHidden}</span>
  </div>`;
}

export class Dial {
  constructor(element, onMove) {
    this.element = element;
    this.svg = element.querySelector('svg');
    this.onMove = onMove;
    this.position = 50;
    this.editable = false;
    this.dragging = false;
    this.lastSend = 0;
    this.lastLocalMove = 0;
    this.timer = null;
    this.reconcileTimer = null;
    this.serverPosition = 50;
    this.needle = element.querySelector('.dial-needle');
    this.readout = element.querySelector('.dial-readout');
    this.caption = element.querySelector('.dial-caption');
    element.addEventListener('pointerdown', event => {
      if (!this.editable || (event.button !== undefined && event.button !== 0)) return;
      event.preventDefault();
      element.focus({ preventScroll: true });
      this.dragging = true;
      this.pointerId = event.pointerId;
      element.classList.add('dragging');
      element.setPointerCapture(event.pointerId);
      this.setLocal(this.fromPointer(event));
    });
    element.addEventListener('pointermove', event => {
      if (this.dragging && event.pointerId === this.pointerId) this.setLocal(this.fromPointer(event));
    });
    const end = event => {
      if (!this.dragging || event.pointerId !== this.pointerId) return;
      if (event.type === 'pointerup') this.setLocal(this.fromPointer(event));
      this.dragging = false;
      element.classList.remove('dragging');
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      this.flush();
    };
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('lostpointercapture', () => { this.dragging = false; element.classList.remove('dragging'); });
    element.addEventListener('keydown', event => {
      if (!this.editable) return;
      const step = event.shiftKey ? 5 : 1;
      const positions = { ArrowLeft: this.position - step, ArrowDown: this.position - step, ArrowRight: this.position + step, ArrowUp: this.position + step, Home: 0, End: 100 };
      if (!(event.key in positions)) return;
      event.preventDefault();
      this.setLocal(positions[event.key]);
    });
  }
  fromPointer(event) {
    const box = this.svg.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width * 720 - 360;
    const y = Math.max(0, 330 - (event.clientY - box.top) / box.height * 380);
    return Math.round(clamp(100 - Math.atan2(y, x) / Math.PI * 100) * 10) / 10;
  }
  setLocal(position) {
    this.lastLocalMove = Date.now();
    this.paint(clamp(position));
    const delay = Math.max(0, 50 - (Date.now() - this.lastSend));
    window.clearTimeout(this.timer);
    if (delay === 0) this.flush();
    else this.timer = window.setTimeout(() => this.flush(), delay);
  }
  flush() {
    window.clearTimeout(this.timer);
    this.timer = null;
    if (!this.editable) return;
    this.lastSend = Date.now();
    this.onMove(this.position);
  }
  paint(position) {
    this.position = position;
    this.needle.setAttribute('transform', `rotate(${(position - 50) * 1.8} 360 330)`);
    this.readout.textContent = Math.round(position);
    this.element.setAttribute('aria-valuenow', String(Math.round(position)));
    this.element.setAttribute('aria-valuetext', t.positionValue(Math.round(position)));
  }
  update({ position = 50, target, editable = false, revealed = false, psychic = false, result = null }) {
    this.editable = editable;
    this.element.setAttribute('aria-disabled', String(!editable));
    this.element.tabIndex = editable ? 0 : -1;
    this.element.classList.toggle('editable', editable);
    this.element.classList.toggle('revealed', revealed);
    this.serverPosition = position;
    window.clearTimeout(this.reconcileTimer);
    const sinceMove = Date.now() - this.lastLocalMove;
    if (!this.dragging && (!editable || sinceMove > 120 || Math.abs(position - this.position) < 0.2)) this.paint(position);
    else if (!this.dragging) this.reconcileTimer = window.setTimeout(() => {
      if (!this.dragging) this.paint(this.serverPosition);
    }, Math.max(1, 125 - sinceMove));
    if (!editable) { window.clearTimeout(this.timer); this.dragging = false; this.element.classList.remove('dragging'); }
    const visible = typeof target === 'number';
    this.element.querySelector('.dial-target').setAttribute('visibility', visible ? 'visible' : 'hidden');
    this.caption.textContent = visible ? (psychic && !revealed ? t.targetSecret : t.revealInstruction) : t.targetHidden;
    if (!visible) return;
    const boundaries = [-10, -6, -2, 2, 6, 10];
    const scores = [2, 3, 4, 3, 2];
    boundaries.slice(0, -1).forEach((offset, i) => {
      const path = this.element.querySelector(`[data-sector="${i}"]`);
      path.setAttribute('d', sector(target + offset, target + boundaries[i + 1]));
      path.classList.toggle('winning-sector', Boolean(revealed && result?.activePoints === scores[i] && position >= target + offset - 1e-8 && position <= target + boundaries[i + 1] + 1e-8));
      const label = this.element.querySelector(`[data-sector-label="${i}"]`);
      const middle = target + (offset + boundaries[i + 1]) / 2;
      const p = point(clamp(middle), 243);
      label.setAttribute('x', p[0]); label.setAttribute('y', p[1] + 5);
      label.style.display = middle < 0 || middle > 100 ? 'none' : '';
    });
    const a = point(target, 27), b = point(target, 283);
    const center = this.element.querySelector('.target-center');
    center.setAttribute('x1', a[0]); center.setAttribute('y1', a[1]);
    center.setAttribute('x2', b[0]); center.setAttribute('y2', b[1]);
  }
  destroy() { window.clearTimeout(this.timer); window.clearTimeout(this.reconcileTimer); }
}
