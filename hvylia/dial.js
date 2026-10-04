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
    const a = point(i * 5, 287), b = point(i * 5, i % 5 === 0 ? 300 : 293);
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="dial-tick${i % 5 === 0 ? ' major' : ''}"/>`;
  }).join('');
  const ridges = Array.from({ length: 48 }, (_, i) => {
    const angle = i * Math.PI / 24;
    const a = [360 + Math.cos(angle) * 315, 330 + Math.sin(angle) * 315];
    const b = [360 + Math.cos(angle) * 322, 330 + Math.sin(angle) * 322];
    return `<line class="dial-ridge" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
  }).join('');
  return `<div id="${id}" class="dial" data-shutter="closed" role="slider" aria-label="${t.position}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-disabled="true" tabindex="-1">
    <svg viewBox="0 0 720 680" class="dial-svg" aria-hidden="true">
      <defs><clipPath id="${id}-window" clipPathUnits="userSpaceOnUse"><path d="M80 330 A280 280 0 0 1 640 330 Z"/></clipPath></defs>
      <circle class="dial-shell-edge" cx="360" cy="330" r="323"/>
      <g>${ridges}</g>
      <circle class="dial-shell" cx="360" cy="330" r="310"/>
      <path class="dial-body" d="M112 380 Q360 405 608 380 L592 553 Q570 586 551 605 L169 605 Q150 586 128 553 Z"/>
      <path class="dial-face" d="M80 330 A280 280 0 0 1 640 330 Z"/>
      <g class="dial-target" clip-path="url(#${id}-window)" visibility="hidden">${[2, 3, 4, 3, 2].map((score, i) => `<path data-sector="${i}" class="target-sector sector-${score}"/><text data-sector-label="${i}" class="sector-label">${score}</text>`).join('')}<line class="target-center"/></g>
      <g clip-path="url(#${id}-window)"><g class="dial-shutter" style="transform-origin:360px 330px;transform-box:view-box;transform:rotate(0deg)">
        <path class="shutter-plate" d="M80 330 A280 280 0 0 1 640 330 Z"/>
      </g></g>
      <path class="dial-rim" d="M80 330 A280 280 0 0 1 640 330"/>
      <g>${ticks}</g>
      <line x1="80" y1="330" x2="640" y2="330" class="dial-baseline"/>
      <g class="dial-shutter-control" style="transform-origin:360px 330px;transform-box:view-box;transform:rotate(0deg)">
        <rect class="shutter-handle" x="622" y="318" width="82" height="24" rx="12"/>
      </g>
      <g class="dial-needle" style="transform-origin:360px 330px;transform-box:view-box"><path class="needle-shaft" d="M356 330 L356 89 Q360 81 364 89 L364 330 Z"/><circle class="needle-hub" cx="360" cy="330" r="42"/><circle class="needle-pin" cx="360" cy="330" r="30"/></g>
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
    this.roundId = null;
    this.showNeedle = true;
    this.editable = false;
    this.dragging = false;
    this.lastSend = 0;
    this.lastLocalMove = 0;
    this.timer = null;
    this.reconcileTimer = null;
    this.serverPosition = 50;
    this.needle = element.querySelector('.dial-needle');
    this.caption = element.querySelector('.dial-caption');
    this.targetElement = element.querySelector('.dial-target');
    this.shutter = element.querySelector('.dial-shutter');
    this.shutterElements = [this.shutter, element.querySelector('.dial-shutter-control')];
    this.shutterAngle = 0;
    this.shutterAnimation = null;
    this.shutterAnimations = [];
    this.shutterSerial = 0;
    this.targetSnapshot = null;
    this.desiredTarget = null;
    this.destroyed = false;
    this.listeners = [];
    this.on('pointerdown', event => {
      if (!this.editable || (event.button !== undefined && event.button !== 0)) return;
      const p = this.pointerPoint(event);
      // The lower half holds the spectrum card, rather than another input area.
      const distance = Math.hypot(p.x - 360, p.y - 330);
      if (distance > 302 || (p.y > 330 && distance > 44)) return;
      event.preventDefault();
      element.focus({ preventScroll: true });
      this.dragging = true;
      this.pointerId = event.pointerId;
      element.classList.add('dragging');
      element.setPointerCapture(event.pointerId);
      this.setLocal(this.fromPointer(event));
    });
    this.on('pointermove', event => {
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
    this.on('pointerup', end);
    this.on('pointercancel', end);
    this.on('lostpointercapture', () => { this.dragging = false; element.classList.remove('dragging'); });
    this.on('keydown', event => {
      if (!this.editable) return;
      const step = event.shiftKey ? 5 : 1;
      const positions = { ArrowLeft: this.position - step, ArrowDown: this.position - step, ArrowRight: this.position + step, ArrowUp: this.position + step, Home: 0, End: 100 };
      if (!(event.key in positions)) return;
      event.preventDefault();
      this.setLocal(positions[event.key]);
    });
  }
  on(type, listener) {
    this.element.addEventListener(type, listener);
    this.listeners.push([type, listener]);
  }
  pointerPoint(event) {
    const matrix = this.svg.getScreenCTM();
    if (matrix) return new window.DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    // A hidden SVG can have no matrix. Preserve the viewBox's default meet fit.
    const box = this.svg.getBoundingClientRect(), view = this.svg.viewBox.baseVal;
    const scale = Math.min(box.width / view.width, box.height / view.height) || 1;
    return {
      x: view.x + (event.clientX - box.left - (box.width - view.width * scale) / 2) / scale,
      y: view.y + (event.clientY - box.top - (box.height - view.height * scale) / 2) / scale
    };
  }
  fromPointer(event) {
    const p = this.pointerPoint(event), x = p.x - 360, y = Math.max(0, 330 - p.y);
    // Grabbing the hub should hold its angle until the pointer moves outward.
    if (Math.hypot(x, p.y - 330) < 24) return this.position;
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
    if (!this.editable || this.destroyed) return;
    this.lastSend = Date.now();
    this.onMove(this.position);
  }
  paint(position) {
    this.position = position;
    this.needle.style.transform = `rotate(${(position - 50) * 1.8}deg)`;
    if (this.showNeedle) {
      this.element.setAttribute('aria-valuenow', String(Math.round(position)));
      this.element.setAttribute('aria-valuetext', t.positionValue(Math.round(position)));
    }
  }
  paintTarget(snapshot) {
    this.targetSnapshot = snapshot;
    this.targetElement.setAttribute('visibility', 'visible');
    const { target, position, revealed, result } = snapshot;
    const boundaries = [-10, -6, -2, 2, 6, 10], scores = [2, 3, 4, 3, 2];
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
  clearTarget() {
    this.targetSnapshot = null;
    this.targetElement.setAttribute('visibility', 'hidden');
    this.targetElement.querySelectorAll('[data-sector]').forEach(path => {
      path.removeAttribute('d');
      path.classList.remove('winning-sector');
    });
    this.targetElement.querySelectorAll('[data-sector-label]').forEach(label => {
      label.removeAttribute('x'); label.removeAttribute('y');
    });
    const center = this.targetElement.querySelector('.target-center');
    ['x1', 'y1', 'x2', 'y2'].forEach(name => center.removeAttribute(name));
  }
  rotateShutter(angle, complete) {
    const serial = ++this.shutterSerial;
    let from = this.shutterAngle;
    if (this.shutterAnimation) {
      const transform = window.getComputedStyle(this.shutter).transform;
      if (transform !== 'none') {
        const matrix = new window.DOMMatrixReadOnly(transform);
        from = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
        if (from > 179.9) from -= 360;
        from = Math.max(-180, Math.min(0, from));
      }
      this.shutterAnimations.forEach(animation => animation.cancel());
      this.shutterAnimations = [];
      this.shutterAnimation = null;
    }
    this.shutterAngle = from;
    this.shutterElements.forEach(element => { element.style.transform = `rotate(${from}deg)`; });
    this.element.dataset.shutter = angle === -180 ? 'opening' : 'closing';
    const finish = () => {
      if (serial !== this.shutterSerial || this.destroyed) return;
      this.shutterAngle = angle;
      this.shutterElements.forEach(element => { element.style.transform = `rotate(${angle}deg)`; });
      this.shutterAnimations.forEach(animation => animation.cancel());
      this.shutterAnimations = [];
      this.shutterAnimation = null;
      this.element.dataset.shutter = angle === -180 ? 'open' : 'closed';
      complete?.();
      this.element.dispatchEvent(new window.CustomEvent('shutterchange'));
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || Math.abs(angle - from) < 0.1 || typeof this.shutter.animate !== 'function') {
      finish();
      return;
    }
    const frames = [
      { transform: `rotate(${from}deg)` }, { transform: `rotate(${angle}deg)` }
    ], options = {
      duration: Math.max(160, 650 * Math.abs(angle - from) / 180),
      easing: 'cubic-bezier(.22,.75,.25,1)',
      fill: 'forwards'
    };
    this.shutterAnimations = this.shutterElements.map(element => element.animate(frames, options));
    this.shutterAnimation = this.shutterAnimations[0];
    this.shutterAnimation.onfinish = finish;
  }
  closeShutter() {
    if (this.element.dataset.shutter === 'closing') return;
    this.rotateShutter(0, () => {
      // Retain only a target already seen by this client while its cover closes.
      // A hidden server target is never supplied, invented, or left in the DOM.
      this.clearTarget();
      if (this.desiredTarget) {
        this.paintTarget(this.desiredTarget);
        this.rotateShutter(-180);
      }
    });
  }
  updateTarget(snapshot) {
    this.desiredTarget = snapshot;
    if (!snapshot) {
      if (this.element.dataset.shutter === 'closed') this.clearTarget();
      else this.closeShutter();
      return;
    }
    if (this.element.dataset.shutter === 'closing') return;
    if (this.targetSnapshot && (snapshot.roundId !== this.targetSnapshot.roundId || snapshot.target !== this.targetSnapshot.target)) {
      this.closeShutter();
      return;
    }
    this.paintTarget(snapshot);
    if (this.element.dataset.shutter !== 'open' && this.element.dataset.shutter !== 'opening') this.rotateShutter(-180);
  }
  update({ position = 50, target, editable = false, revealed = false, psychic = false, result = null, showNeedle = true, roundId = null }) {
    if (this.destroyed) return;
    const newRound = roundId !== null && roundId !== this.roundId;
    this.roundId = roundId;
    this.showNeedle = showNeedle;
    this.needle.setAttribute('visibility', showNeedle ? 'visible' : 'hidden');
    // A new round is a reset, not a movement from the previous answer.
    this.needle.style.transition = newRound || !showNeedle ? 'none' : '';
    if (newRound) {
      window.clearTimeout(this.timer);
      this.timer = null;
      this.dragging = false;
      this.lastLocalMove = 0;
      this.element.classList.remove('dragging');
      if (this.pointerId !== undefined && this.element.hasPointerCapture(this.pointerId)) this.element.releasePointerCapture(this.pointerId);
    }
    this.element.setAttribute('role', showNeedle ? 'slider' : 'img');
    this.element.setAttribute('aria-label', showNeedle ? t.position : psychic ? t.targetSecret : t.targetHidden);
    if (showNeedle) {
      this.element.setAttribute('aria-valuemin', '0');
      this.element.setAttribute('aria-valuemax', '100');
    } else {
      ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'].forEach(name => this.element.removeAttribute(name));
    }
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
      if (!this.dragging && !this.destroyed) this.paint(this.serverPosition);
    }, Math.max(1, 125 - sinceMove));
    if (!editable) { window.clearTimeout(this.timer); this.dragging = false; this.element.classList.remove('dragging'); }
    const visible = Number.isFinite(target);
    this.caption.textContent = visible ? (psychic && !revealed ? t.targetSecret : t.revealInstruction) : t.targetHidden;
    this.updateTarget(visible ? { target, position, revealed, result, roundId } : null);
  }
  destroy() {
    this.destroyed = true;
    ++this.shutterSerial;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.reconcileTimer);
    this.shutterAnimations.forEach(animation => animation.cancel());
    this.shutterAnimations = [];
    this.shutterAnimation = null;
    this.listeners.forEach(([type, listener]) => this.element.removeEventListener(type, listener));
    this.listeners = [];
    if (this.pointerId !== undefined && this.element.hasPointerCapture(this.pointerId)) this.element.releasePointerCapture(this.pointerId);
    this.clearTarget();
  }
}
