import { MotionPadController } from './controller-input.js';
import { createPadTransport, getRoomFromUrl } from './transport-trystero.js';

const ui = {
    root: document.querySelector('.bs-pad-page'),
    codeForm: document.getElementById('codeForm'),
    codeInput: document.getElementById('roomInput'),
    roomLabel: document.getElementById('padRoomCode'),
    status: document.getElementById('padStatus'),
    connect: document.getElementById('connectButton'),
    calibrate: document.getElementById('calibrateButton'),
    handButtons: document.querySelectorAll('[data-hand]'),
    saberPreview: document.getElementById('padSaberPreview'),
    score: document.getElementById('padScore'),
    combo: document.getElementById('padCombo')
};

const state = {
    roomId: getRoomFromUrl(),
    transport: null,
    controller: null,
    hand: 'right',
    connected: false
};

function setStatus(text, mode = 'idle') {
    ui.status.textContent = text;
    ui.status.dataset.mode = mode;
}

function normalizeRoom(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function setRoom(roomId) {
    state.roomId = normalizeRoom(roomId);
    ui.roomLabel.textContent = state.roomId || '----';
    ui.codeInput.value = state.roomId;
    ui.connect.disabled = state.roomId.length !== 4;
    ui.calibrate.disabled = state.roomId.length !== 4;
}

function setHand(hand) {
    state.hand = hand === 'left' ? 'left' : 'right';
    ui.handButtons.forEach(button => button.classList.toggle('is-selected', button.dataset.hand === state.hand));
    state.controller?.setHand(state.hand);
}

function moveSaberPreview(pose) {
    const vector = pose.bladeVector || pose.vector || { x: 0, y: 1 };
    const angle = Math.atan2(vector.x, vector.y) * (180 / Math.PI);
    const depth = pose.blade?.axis3D ? Math.max(-1, Math.min(1, -pose.blade.axis3D.z)) : 0.7;
    const twist = pose.blade?.rollRad ? pose.blade.rollRad * (180 / Math.PI) : 0;
    ui.saberPreview.style.setProperty('--pad-saber-tilt', `${angle}deg`);
    ui.saberPreview.style.setProperty('--pad-saber-depth', `${0.82 + depth * 0.2}`);
    ui.saberPreview.style.setProperty('--pad-saber-twist', `${Math.max(-62, Math.min(62, twist))}deg`);
}

function feedback(type) {
    ui.root.dataset.feedback = type;
    ui.root.classList.remove('is-feedback');
    window.requestAnimationFrame(() => ui.root.classList.add('is-feedback'));

    if (navigator.vibrate) {
        const pattern = type === 'hit' ? 18 : type === 'miss' ? [24, 30, 24] : 45;
        navigator.vibrate(pattern);
    }
}

async function connect() {
    if (!state.roomId || state.transport?.online) return;
    setStatus('Connecting...', 'loading');
    state.transport = await createPadTransport(state.roomId, {
        onStatus: (mode, message) => setStatus(message, mode),
        onPeerJoin: () => {
            state.connected = true;
            setStatus('Connected', 'online');
        },
        onPeerLeave: () => {
            state.connected = false;
            setStatus('Disconnected', 'idle');
        },
        onHello: data => {
            if (data?.role === 'desktop') {
                state.connected = true;
                setStatus('Connected', 'online');
            }
        },
        onFeedback: data => feedback(data?.type || 'hit'),
        onState: data => {
            ui.score.textContent = Number(data?.score || 0).toLocaleString('en-US');
            ui.combo.textContent = `${Number(data?.combo || 0)}x`;
        }
    });
    state.transport.sendHello({ role: 'pad' });
}

async function calibrate() {
    try {
        await connect();
        if (!state.controller) {
            state.controller = new MotionPadController({
                sendPose: data => state.transport?.sendPose(data),
                sendSwing: data => state.transport?.sendSwing(data),
                onPose: moveSaberPreview,
                onSwing: () => feedback('swing'),
                onStatus: message => setStatus(message, 'online')
            });
            state.controller.setHand(state.hand);
        }
        await state.controller.start();
        state.controller.calibrate();
    } catch (error) {
        console.error(error);
        setStatus(error.message, 'error');
    }
}

ui.codeForm.addEventListener('submit', event => {
    event.preventDefault();
    setRoom(ui.codeInput.value);
    connect();
});

ui.codeInput.addEventListener('input', event => setRoom(event.target.value));
ui.connect.addEventListener('click', connect);
ui.calibrate.addEventListener('click', calibrate);
ui.handButtons.forEach(button => button.addEventListener('click', () => setHand(button.dataset.hand)));

setRoom(state.roomId);
setHand('right');
if (state.roomId) connect();
