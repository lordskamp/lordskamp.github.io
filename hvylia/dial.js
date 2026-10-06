import { t } from './locale.js';
import { DIAL_GEOMETRY, DIAL_WINDOW_PATH, DIAL_TARGET_WINDOW_PATH, DIAL_SHUTTER_PATH, angleForPosition, positionForAngle, dialPoint as point } from './dial-geometry.js';

const clamp = n => Math.max(0, Math.min(100, n));
function sector(start, end) {
  const { centerX, centerY, faceRadius } = DIAL_GEOMETRY;
  const a = point(start, faceRadius), b = point(end, faceRadius);
  return `M${centerX} ${centerY} L${a[0]} ${a[1]} A${faceRadius} ${faceRadius} 0 0 1 ${b[0]} ${b[1]} Z`;
}
// Cubic segments follow a polar wave, leaving one continuous, smooth wheel edge.
function waveRim() {
  const lobes = 36, radius = 323, amplitude = 6;
  const step = Math.PI * 2 / (lobes * 4);
  const sample = angle => {
    const r = radius + amplitude * Math.cos(lobes * angle);
    const dr = -amplitude * lobes * Math.sin(lobes * angle);
    return {
      x: 360 + r * Math.cos(angle), y: 330 + r * Math.sin(angle),
      dx: dr * Math.cos(angle) - r * Math.sin(angle),
      dy: dr * Math.sin(angle) + r * Math.cos(angle)
    };
  };
  const f = value => value.toFixed(2);
  let a = sample(0), path = `M${f(a.x)} ${f(a.y)}`;
  for (let i = 1; i <= lobes * 4; i++) {
    const b = sample(i * step);
    path += ` C${f(a.x + a.dx * step / 3)} ${f(a.y + a.dy * step / 3)} ${f(b.x - b.dx * step / 3)} ${f(b.y - b.dy * step / 3)} ${f(b.x)} ${f(b.y)}`;
    a = b;
  }
  return path + ' Z';
}
export function dialMarkup(id = 'dial') {
  // The shoulders are sharp; each end of the window returns in a 16px U,
  // matching the diameter of the shutter handle instead of flattening at its base.
  // Scoring sectors stop at the sloped body, leaving the handle recesses uncolored.
  const windowPath = DIAL_WINDOW_PATH;
  return `<div id="${id}" class="dial" data-shutter="closed" data-wheel="still" role="group" aria-label="${t.position}" tabindex="-1">
    <svg viewBox="0 0 720 680" class="dial-svg" role="group">
      <defs><clipPath id="${id}-window" clipPathUnits="userSpaceOnUse"><path d="${windowPath}"/></clipPath><clipPath id="${id}-target-window" clipPathUnits="userSpaceOnUse"><path d="${DIAL_TARGET_WINDOW_PATH}"/></clipPath><clipPath id="${id}-shutter-window" clipPathUnits="userSpaceOnUse"><path d="${DIAL_SHUTTER_PATH}"/></clipPath></defs>
      <g class="dial-wheel" aria-hidden="true" style="transform-origin:360px 330px;transform-box:view-box;transform:rotate(0deg)"><path class="dial-wave-rim" d="${waveRim()}"/></g>
      <circle class="dial-shell" cx="360" cy="330" r="310"/>
      <path class="dial-face" d="${windowPath}"/>
      <g id="${id}-target" class="dial-target" clip-path="url(#${id}-window)" visibility="hidden" aria-hidden="true"><g clip-path="url(#${id}-target-window)">${[2, 3, 4, 3, 2].map((score, i) => `<path data-sector="${i}" class="target-sector sector-${score}"/><text data-sector-label="${i}" class="sector-label">${score}</text>`).join('')}<line class="target-center"/></g></g>
      <g clip-path="url(#${id}-window)"><g clip-path="url(#${id}-shutter-window)"><g class="dial-shutter" style="transform-origin:360px 330px;transform-box:view-box;transform:rotate(0deg)">
        <path class="shutter-plate" d="${DIAL_SHUTTER_PATH}"/>
      </g></g>
        <path class="shutter-plate shutter-cap" data-cap="left" d="M80 330 H112 A16 16 0 0 1 80 330 Z"/>
        <path class="shutter-plate shutter-cap" data-cap="right" d="M608 330 H640 A16 16 0 0 1 608 330 Z"/>
      </g>
      <g class="dial-shutter-control" role="button" aria-label="${t.shutterOpen}" aria-controls="${id}-target" aria-expanded="false" aria-disabled="true" aria-hidden="true" tabindex="-1" style="transform-origin:360px 330px;transform-box:view-box;transform:rotate(0deg)">
        <rect class="shutter-hitarea" x="4" y="292" width="144" height="76" rx="24"/>
        <rect class="shutter-handle" x="14" y="314" width="112" height="32" rx="16"/>
      </g>
      <g class="dial-needle" style="transform-origin:360px 330px;transform-box:view-box"><path class="needle-shaft" d="M356.5 330 L356.5 91 Q360 84 363.5 91 L363.5 330 Z"/><circle class="needle-hub" cx="360" cy="330" r="60"/><circle class="needle-pin" cx="360" cy="330" r="46"/></g>
    </svg>
    <span class="dial-caption">${t.targetHidden}</span>
  </div>`;
}

export class Dial {
  constructor(element, onMove, { shutterButton = null, nudgeControls = [], preview = false } = {}) {
    this.element = element;
    this.svg = element.querySelector('svg');
    this.onMove = onMove;
    this.position = 50;
    this.roundId = null;
    this.wheel = element.querySelector('.dial-wheel');
    this.wheelAngle = 0;
    this.wheelAnimation = null;
    this.wheelSerial = 0;
    this.wheelMotion = null;
    this.showNeedle = true;
    this.editable = false;
    this.canPeek = false;
    this.preview = preview;
    this.previewInitialized = false;
    this.peekClosed = false;
    this.hasViewedTarget = false;
    this.availableTarget = null;
    this.shutterButton = shutterButton;
    this.nudgeControls = nudgeControls.filter(Boolean);
    this.nudgeTimer = null;
    this.heldNudge = null;
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
    this.shutterControl = element.querySelector('.dial-shutter-control');
    this.shutterElements = [this.shutter, this.shutterControl];
    this.shutterAngle = 0;
    this.shutterAnimation = null;
    this.shutterAnimations = [];
    this.shutterSerial = 0;
    this.shutterMotion = null;
    this.shutterCaps = [...element.querySelectorAll('.shutter-cap')];
    this.targetSnapshot = null;
    this.desiredTarget = null;
    this.destroyed = false;
    this.listeners = [];
    this.on('pointerdown', event => {
      if (!this.editable || (event.button !== undefined && event.button !== 0)) return;
      const p = this.pointerPoint(event);
      // The lower half holds the card. Include the thin baseline rim because
      // touch coordinates can round a point on the edge a few SVG units down.
      const distance = Math.hypot(p.x - 360, p.y - 330);
      if (distance > 302 || (p.y > 336 && distance > 64)) return;
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
    this.on('click', event => {
      if (event.target.closest('.dial-shutter-control')) this.togglePeek();
    });
    this.listen(this.shutterControl, 'keydown', event => {
      if (!['Enter', ' '].includes(event.key) && event.code !== 'Space') return;
      if (!this.canPeek || !this.availableTarget || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) this.togglePeek();
    });
    if (this.shutterButton) this.listen(this.shutterButton, 'click', () => this.togglePeek());
    this.nudgeControls.forEach(button => {
      this.listen(button, 'pointerdown', event => {
        if (!this.editable || event.button !== 0) return;
        event.preventDefault();
        button.focus({ preventScroll: true });
        this.stopNudge();
        button.setPointerCapture(event.pointerId);
        this.heldNudge = { button, pointerId: event.pointerId, direction: Number(button.dataset.direction) < 0 ? -1 : 1 };
        button.classList.add('is-held');
        this.nudge(this.heldNudge.direction);
        const repeat = () => {
          if (!this.editable || !this.heldNudge || this.destroyed) { this.stopNudge(); return; }
          this.nudge(this.heldNudge.direction);
          this.nudgeTimer = window.setTimeout(repeat, 70);
        };
        this.nudgeTimer = window.setTimeout(repeat, 280);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => this.listen(button, type, event => {
        if (this.heldNudge?.button === button && this.heldNudge.pointerId === event.pointerId) {
          this.stopNudge();
          this.flush();
        }
      }));
      this.listen(button, 'click', event => {
        // Pointer input already takes its first step on press; native keyboard/AT clicks take one here.
        if (this.editable && event.detail === 0) this.nudge(Number(button.dataset.direction) < 0 ? -1 : 1);
      });
    });
    this.listen(document, 'keydown', event => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || document.querySelector('dialog[open]')) return;
      if (event.target instanceof window.Element && event.target.closest('input,textarea,select,button,a,[role="button"],[contenteditable]')) return;
      if (event.code === 'Space' || event.key === ' ') {
        if (this.canPeek && this.availableTarget) {
          event.preventDefault();
          if (!event.repeat) this.togglePeek();
        }
        return;
      }
      if (!this.editable) return;
      const key = event.key.toLowerCase();
      const direction = event.code === 'KeyA' || key === 'a' ? -1 : event.code === 'KeyD' || key === 'd' ? 1 : 0;
      if (!direction) return;
      event.preventDefault();
      this.setLocal(clamp(this.position + direction * (event.shiftKey ? 5 : 1)));
    });
    this.listen(window, 'blur', () => this.stopNudge());
    this.listen(document, 'visibilitychange', () => { if (document.hidden) this.stopNudge(); });
  }
  on(type, listener) {
    this.listen(this.element, type, listener);
  }
  listen(target, type, listener) {
    target.addEventListener(type, listener);
    this.listeners.push([target, type, listener]);
  }
  stopNudge() {
    window.clearTimeout(this.nudgeTimer);
    this.nudgeTimer = null;
    const held = this.heldNudge;
    this.heldNudge = null;
    if (!held) return;
    held.button.classList.remove('is-held');
    if (held.button.hasPointerCapture(held.pointerId)) held.button.releasePointerCapture(held.pointerId);
  }
  nudge(direction) {
    const position = clamp(this.position + direction);
    if (position !== this.position) this.setLocal(position);
  }
  syncPeekControl() {
    this.element.classList.toggle('can-peek', this.canPeek);
    this.shutterControl.style.pointerEvents = this.canPeek ? 'auto' : 'none';
    this.shutterControl.setAttribute('aria-hidden', String(!this.canPeek));
    this.shutterControl.setAttribute('aria-disabled', String(!this.canPeek || !this.availableTarget));
    this.shutterControl.setAttribute('aria-label', this.peekClosed ? t.shutterOpen : t.shutterClose);
    this.shutterControl.setAttribute('aria-expanded', String(this.element.dataset.shutter === 'open'));
    this.shutterControl.setAttribute('tabindex', this.canPeek && this.availableTarget ? '0' : '-1');
    if (!this.shutterButton) return;
    this.shutterButton.hidden = !this.canPeek;
    this.shutterButton.disabled = !this.canPeek || !this.availableTarget;
    this.shutterButton.textContent = this.peekClosed ? t.shutterOpen : t.shutterClose;
    this.shutterButton.setAttribute('aria-expanded', String(this.element.dataset.shutter === 'open'));
    this.shutterButton.title = t.shutterHint;
  }
  get clueReady() {
    return this.canPeek && this.hasViewedTarget && ['open', 'closed'].includes(this.element.dataset.shutter);
  }
  togglePeek() {
    if (!this.canPeek || !this.availableTarget || this.destroyed) return;
    this.peekClosed = !this.peekClosed;
    this.caption.textContent = this.peekClosed ? t.targetHidden : this.preview ? t.revealInstruction : t.targetSecret;
    this.updateTarget(this.peekClosed ? null : this.availableTarget);
    this.syncPeekControl();
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
    const { centerX, centerY } = DIAL_GEOMETRY;
    const p = this.pointerPoint(event), x = p.x - centerX, y = Math.max(0, centerY - p.y);
    // Grabbing the hub should hold its angle until the pointer moves outward.
    if (Math.hypot(x, p.y - centerY) < 24) return this.position;
    return Math.round(positionForAngle(180 - Math.atan2(y, x) * 180 / Math.PI) * 10) / 10;
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
    this.needle.style.transform = `rotate(${angleForPosition(position) - 90}deg)`;
    if (this.showNeedle && this.editable) {
      this.element.setAttribute('aria-valuenow', String(Math.round(position)));
      this.element.setAttribute('aria-valuetext', t.positionValue(Math.round(position)));
    } else if (this.showNeedle) {
      this.element.setAttribute('aria-label', `${t.position}: ${t.positionValue(Math.round(position))}`);
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
      const p = point(middle, 243);
      label.setAttribute('x', p[0]); label.setAttribute('y', p[1] + 5);
      label.style.display = '';
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
  motionEvent(mechanism, phase, motion) {
    this.element.dispatchEvent(new window.CustomEvent('dialmotion', {
      detail: { mechanism, phase, duration: motion.duration, distance: motion.distance, serial: motion.serial }
    }));
  }
  startMotion(mechanism, motion) {
    this[mechanism + 'Motion'] = motion;
    this.motionEvent(mechanism, 'start', motion);
  }
  endMotion(mechanism, phase, serial) {
    const motion = this[mechanism + 'Motion'];
    if (!motion || (serial !== undefined && serial !== motion.serial)) return;
    this[mechanism + 'Motion'] = null;
    this.motionEvent(mechanism, phase, motion);
  }
  capOpacity(cap, angle) {
    return cap.dataset.cap === 'left' ? Math.max(0, 1 - angle / 18) : Math.min(1, (180 - angle) / 18);
  }
  paintShutterCaps(angle) {
    this.shutterCaps.forEach(cap => { cap.style.opacity = String(this.capOpacity(cap, angle)); });
  }
  capFrames(cap, from, angle) {
    const angles = [from, ...[18, 162].filter(a => a > Math.min(from, angle) && a < Math.max(from, angle)), angle];
    angles.sort((a, b) => angle > from ? a - b : b - a);
    return angles.map(a => ({ offset: (a - from) / (angle - from), opacity: this.capOpacity(cap, a) }));
  }
  rotateShutter(angle, complete) {
    const serial = ++this.shutterSerial;
    let from = this.shutterAngle;
    if (this.shutterAnimation) {
      const transform = window.getComputedStyle(this.shutter).transform;
      if (transform !== 'none') {
        const matrix = new window.DOMMatrixReadOnly(transform);
        from = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
        if (from < -0.1) from += 360;
        from = Math.max(0, Math.min(180, from));
      }
      this.endMotion('shutter', 'cancel');
      this.shutterAnimations.forEach(animation => animation.cancel());
      this.shutterAnimations = [];
      this.shutterAnimation = null;
    }
    this.shutterAngle = from;
    this.paintShutterCaps(from);
    this.shutterElements.forEach(element => { element.style.transform = `rotate(${from}deg)`; });
    this.element.dataset.shutter = angle === 180 ? 'opening' : 'closing';
    this.syncPeekControl();
    this.element.dispatchEvent(new window.CustomEvent('shutterchange'));
    const finish = () => {
      if (serial !== this.shutterSerial || this.destroyed) return;
      this.shutterAngle = angle;
      this.paintShutterCaps(angle);
      this.shutterElements.forEach(element => { element.style.transform = `rotate(${angle}deg)`; });
      this.shutterAnimations.forEach(animation => animation.cancel());
      this.shutterAnimations = [];
      this.shutterAnimation = null;
      this.endMotion('shutter', 'finish', serial);
      this.element.dataset.shutter = angle === 180 ? 'open' : 'closed';
      if (angle === 180 && this.availableTarget) this.hasViewedTarget = true;
      complete?.();
      this.syncPeekControl();
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
    this.shutterAnimations = [
      ...this.shutterElements.map(element => element.animate(frames, options)),
      ...this.shutterCaps.map(cap => cap.animate(this.capFrames(cap, from, angle), options))
    ];
    this.shutterAnimation = this.shutterAnimations[0];
    this.shutterAnimation.onfinish = finish;
    this.shutterAnimation.oncancel = () => this.endMotion('shutter', 'cancel', serial);
    this.startMotion('shutter', { serial, duration: options.duration, distance: Math.abs(angle - from) });
  }
  turnWheel(roundId) {
    const serial = ++this.wheelSerial;
    // This is a decorative mechanical turn driven only by the public round ID.
    // Never derive its angle from the target: opponents see the same animation.
    let hash = 0;
    for (const character of String(roundId)) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
    let from = this.wheelAngle;
    if (this.wheelAnimation) {
      const transform = window.getComputedStyle(this.wheel).transform;
      if (transform !== 'none') {
        const matrix = new window.DOMMatrixReadOnly(transform);
        const measured = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
        from = measured + 360 * Math.ceil((this.wheelFrom - measured - .001) / 360);
      }
    }
    const angle = from + 135 + hash % 90;
    this.wheelFrom = from;
    this.endMotion('wheel', 'cancel');
    this.wheelAnimation?.cancel();
    this.wheelAnimation = null;
    this.wheelAngle = angle;
    this.wheel.style.transform = `rotate(${angle}deg)`;
    const finish = () => {
      if (serial !== this.wheelSerial || this.destroyed) return;
      this.wheelAnimation?.cancel();
      this.wheelAnimation = null;
      this.wheelAngle = angle % 360;
      this.wheel.style.transform = `rotate(${this.wheelAngle}deg)`;
      this.element.dataset.wheel = 'still';
      this.endMotion('wheel', 'finish', serial);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof this.wheel.animate !== 'function') {
      finish();
      return;
    }
    this.element.dataset.wheel = 'turning';
    this.wheelAnimation = this.wheel.animate([
      { transform: `rotate(${from}deg)` },
      { transform: `rotate(${angle}deg)` }
    ], { duration: 980, easing: 'cubic-bezier(.18,.72,.24,1)', fill: 'forwards' });
    this.wheelAnimation.onfinish = finish;
    this.wheelAnimation.oncancel = () => this.endMotion('wheel', 'cancel', serial);
    this.startMotion('wheel', { serial, duration: 980, distance: angle - from });
  }
  closeShutter() {
    if (this.element.dataset.shutter === 'closing') return;
    this.rotateShutter(0, () => {
      // Retain only a target already seen by this client while its cover closes.
      // A hidden server target is never supplied, invented, or left in the DOM.
      this.clearTarget();
      if (this.desiredTarget) {
        this.paintTarget(this.desiredTarget);
        this.rotateShutter(180);
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
    if (this.element.dataset.shutter !== 'open' && this.element.dataset.shutter !== 'opening') this.rotateShutter(180);
  }
  update({ position = 50, target, editable = false, revealed = false, psychic = false, canPeek = false, result = null, showNeedle = true, roundId = null }) {
    if (this.destroyed) return;
    const newRound = roundId !== null && roundId !== this.roundId;
    if (newRound && this.roundId !== null) this.turnWheel(roundId);
    const privateTarget = psychic && !revealed && Number.isFinite(target);
    // Public previews may close their disclosed example locally. Live matches
    // retain the stricter private-psychic condition, including after revelation.
    const peekableTarget = privateTarget || (this.preview && revealed && Number.isFinite(target));
    this.canPeek = canPeek && peekableTarget;
    if (newRound || !peekableTarget) this.peekClosed = false;
    this.roundId = roundId;
    this.showNeedle = showNeedle;
    this.needle.setAttribute('visibility', showNeedle ? 'visible' : 'hidden');
    // A new round is a reset, not a movement from the previous answer.
    this.needle.style.transition = newRound || !showNeedle ? 'none' : '';
    if (newRound) {
      this.hasViewedTarget = false;
      this.stopNudge();
      window.clearTimeout(this.timer);
      this.timer = null;
      this.dragging = false;
      this.lastLocalMove = 0;
      this.element.classList.remove('dragging');
      if (this.pointerId !== undefined && this.element.hasPointerCapture(this.pointerId)) this.element.releasePointerCapture(this.pointerId);
    }
    const slider = showNeedle && editable;
    // Slider and img roles flatten descendants in the accessibility tree. Use
    // a group while reading the target so the physical handle remains a button.
    this.element.setAttribute('role', slider ? 'slider' : 'group');
    this.element.setAttribute('aria-label', showNeedle ? t.position : psychic ? t.targetSecret : t.targetHidden);
    if (slider) {
      this.element.setAttribute('aria-valuemin', '0');
      this.element.setAttribute('aria-valuemax', '100');
    } else {
      ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'].forEach(name => this.element.removeAttribute(name));
    }
    this.editable = editable;
    this.nudgeControls.forEach(button => { button.hidden = !editable; button.disabled = !editable; });
    if (slider) this.element.setAttribute('aria-disabled', 'false');
    else this.element.removeAttribute('aria-disabled');
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
    if (!editable) { this.stopNudge(); window.clearTimeout(this.timer); this.dragging = false; this.element.classList.remove('dragging'); }
    const visible = Number.isFinite(target);
    this.availableTarget = visible ? { target, position, revealed, result, roundId } : null;
    this.caption.textContent = visible && !this.peekClosed ? (psychic && !revealed ? t.targetSecret : t.revealInstruction) : t.targetHidden;
    if (this.preview && !this.previewInitialized && this.availableTarget) {
      this.previewInitialized = true;
      this.shutterAngle = 180;
      this.paintShutterCaps(180);
      this.shutterElements.forEach(element => { element.style.transform = 'rotate(180deg)'; });
      this.element.dataset.shutter = 'open';
      this.hasViewedTarget = true;
    }
    this.updateTarget(visible && !this.peekClosed ? this.availableTarget : null);
    this.syncPeekControl();
  }
  destroy() {
    this.destroyed = true;
    this.stopNudge();
    this.canPeek = false;
    this.availableTarget = null;
    this.desiredTarget = null;
    this.syncPeekControl();
    ++this.shutterSerial;
    ++this.wheelSerial;
    this.endMotion('wheel', 'cancel');
    this.endMotion('shutter', 'cancel');
    this.wheelAnimation?.cancel();
    this.wheelAnimation = null;
    this.element.dataset.wheel = 'still';
    window.clearTimeout(this.timer);
    window.clearTimeout(this.reconcileTimer);
    this.shutterAnimations.forEach(animation => animation.cancel());
    this.shutterAnimations = [];
    this.shutterAnimation = null;
    this.listeners.forEach(([target, type, listener]) => target.removeEventListener(type, listener));
    this.listeners = [];
    if (this.pointerId !== undefined && this.element.hasPointerCapture(this.pointerId)) this.element.releasePointerCapture(this.pointerId);
    this.clearTarget();
  }
}
