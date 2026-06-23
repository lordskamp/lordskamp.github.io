import { THREE_MODULE_URL } from './constants.js';
import { noteWorldPosition } from './simulation.js';

const COLORS = {
    blue: 0x00d5ff,
    blueDeep: 0x006dff,
    red: 0xff2456,
    redDeep: 0xb00028,
    white: 0xffffff,
    amber: 0xffd166,
    dark: 0x02030a
};

const CHANNEL_COLORS = {
    blue: COLORS.blue,
    red: COLORS.red,
    white: COLORS.white,
    off: COLORS.dark
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function directionAngle(direction) {
    const table = {
        0: Math.PI / 2,
        1: -Math.PI / 2,
        2: Math.PI,
        3: 0,
        4: Math.PI * 0.75,
        5: Math.PI * 0.25,
        6: -Math.PI * 0.75,
        7: -Math.PI * 0.25
    };
    return table[direction] || 0;
}

function makeArrowTexture(THREE, direction) {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 192, 192);
    ctx.translate(96, 96);
    ctx.rotate(directionAngle(direction));
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00d5ff';
    ctx.shadowBlur = 18;
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (direction === 8) {
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.moveTo(-46, 0);
        ctx.lineTo(36, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(36, 0);
        ctx.lineTo(7, -25);
        ctx.lineTo(7, 25);
        ctx.closePath();
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function targetChannel(target) {
    const value = Number(target) || 0;
    if (value === 0 || value === 1 || value === 4 || value === 6 || value === 12) return 'left';
    if (value === 2 || value === 3 || value === 5 || value === 7 || value === 13) return 'right';
    if (value === 8 || value === 9 || value === 10 || value === 11) return 'back';
    return value % 2 ? 'right' : 'left';
}

function eventColor(event, fallback) {
    return CHANNEL_COLORS[event.color] || fallback || COLORS.blue;
}

export class BeatSaberScene {
    constructor() {
        this.THREE = null;
        this.container = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.noteMeshes = new Map();
        this.arrowTextures = new Map();
        this.bursts = [];
        this.hitZ = 0;
        this.spawnZ = -28;
        this.noteGeometry = null;
        this.edgeGeometry = null;
        this.arrowGeometry = null;
        this.saber = {};
        this.clock = performance.now();
        this.lightEventsCursor = 0;
        this.lastLightTime = 0;
        this.channelState = {
            left: { color: COLORS.blue, intensity: 0.22, flash: 0 },
            right: { color: COLORS.red, intensity: 0.2, flash: 0 },
            back: { color: COLORS.blue, intensity: 0.16, flash: 0 },
            ring: { color: COLORS.blue, intensity: 0.16, flash: 0 }
        };
        this.channelObjects = {
            left: { materials: [], lights: [], pivots: [] },
            right: { materials: [], lights: [], pivots: [] },
            back: { materials: [], lights: [], pivots: [] },
            ring: { materials: [], lights: [], pivots: [] }
        };
        this.rings = [];
        this.runwayMaterials = [];
    }

    async init(container) {
        this.container = container;
        this.THREE = await import(THREE_MODULE_URL);
        const THREE = this.THREE;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(COLORS.dark);
        this.scene.fog = new THREE.Fog(COLORS.dark, 7, 36);

        this.camera = new THREE.PerspectiveCamera(64, 1, 0.08, 72);
        this.camera.position.set(0, 1.54, 4.2);
        this.camera.lookAt(0, 1.38, -8.8);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(this.renderer.domElement);

        this.noteGeometry = new THREE.BoxGeometry(0.58, 0.58, 0.58);
        this.edgeGeometry = new THREE.EdgesGeometry(this.noteGeometry);
        this.arrowGeometry = new THREE.PlaneGeometry(0.42, 0.42);

        this.addLights();
        this.addBeatSaberStage();
        this.addHitGrid();
        this.addSaber();
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.renderer.domElement.addEventListener('webglcontextlost', event => event.preventDefault());
    }

    addLights() {
        const THREE = this.THREE;
        this.scene.add(new THREE.AmbientLight(0x335777, 0.28));
        const key = new THREE.DirectionalLight(0xffffff, 0.72);
        key.position.set(0, 4.6, 3.4);
        this.scene.add(key);

        const left = new THREE.PointLight(COLORS.blue, 2.6, 18, 2);
        left.position.set(-2.65, 2.1, -4);
        const right = new THREE.PointLight(COLORS.red, 2.3, 18, 2);
        right.position.set(2.65, 2.1, -4);
        const back = new THREE.PointLight(COLORS.blue, 2, 28, 2);
        back.position.set(0, 2.8, -16);
        this.scene.add(left, right, back);
        this.channelObjects.left.lights.push(left);
        this.channelObjects.right.lights.push(right);
        this.channelObjects.back.lights.push(back);
    }

    addBeatSaberStage() {
        const THREE = this.THREE;
        this.addFloorGrid();
        this.addSideRails();
        this.addLaserCurtains();
        this.addTunnelRings();
        this.addBackGate();
    }

    addFloorGrid() {
        const THREE = this.THREE;
        const grid = new THREE.GridHelper(7.8, 18, COLORS.blue, 0x173042);
        grid.position.set(0, 0, -12);
        grid.material.transparent = true;
        grid.material.opacity = 0.28;
        this.scene.add(grid);
        this.runwayMaterials.push(grid.material);

        const center = new THREE.Mesh(
            new THREE.PlaneGeometry(3.55, 30),
            new THREE.MeshBasicMaterial({ color: 0x061422, transparent: true, opacity: 0.34, side: THREE.DoubleSide })
        );
        center.rotation.x = -Math.PI / 2;
        center.position.set(0, 0.003, -13);
        this.scene.add(center);
        this.runwayMaterials.push(center.material);

        for (const x of [-1.56, -0.78, 0, 0.78, 1.56]) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute([x, 0.025, 1.4, x, 0.025, -28], 3));
            const material = new THREE.LineBasicMaterial({ color: x < 0 ? COLORS.blue : COLORS.red, transparent: true, opacity: x === 0 ? 0.22 : 0.42 });
            this.scene.add(new THREE.Line(geometry, material));
            this.runwayMaterials.push(material);
        }
    }

    addSideRails() {
        const THREE = this.THREE;
        for (const side of [-1, 1]) {
            const channel = side < 0 ? 'left' : 'right';
            const color = side < 0 ? COLORS.blue : COLORS.red;
            for (let y = 0.28; y <= 2.35; y += 0.62) {
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute([
                    side * 2.18, y, 1.2,
                    side * 2.82, y + 0.18, -27
                ], 3));
                const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.18 });
                this.scene.add(new THREE.Line(geometry, material));
                this.channelObjects[channel].materials.push(material);
            }
        }
    }

    addLaserCurtains() {
        const THREE = this.THREE;
        const beamGeometry = new THREE.CylinderGeometry(0.012, 0.042, 1, 10, 1, true);
        for (const side of [-1, 1]) {
            const channel = side < 0 ? 'left' : 'right';
            const color = side < 0 ? COLORS.blue : COLORS.red;
            for (let i = 0; i < 10; i += 1) {
                const group = new THREE.Group();
                const material = new THREE.MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: 0.18,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                });
                const beam = new THREE.Mesh(beamGeometry, material);
                beam.scale.set(1, 12 + i * 0.35, 1);
                beam.rotation.z = Math.PI / 2;
                beam.position.set(side * (2.75 + (i % 3) * 0.18), 1.2 + (i % 4) * 0.16, -3.2 - i * 2.35);
                group.add(beam);
                group.rotation.z = side * (0.24 + i * 0.012);
                this.scene.add(group);
                this.channelObjects[channel].materials.push(material);
                this.channelObjects[channel].pivots.push(group);
            }
        }
    }

    addTunnelRings() {
        const THREE = this.THREE;
        for (let i = 0; i < 9; i += 1) {
            const material = new THREE.MeshBasicMaterial({
                color: i % 2 ? COLORS.red : COLORS.blue,
                transparent: true,
                opacity: 0.075,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const ring = new THREE.Mesh(new THREE.TorusGeometry(2.35 + i * 0.14, 0.012, 8, 88), material);
            ring.position.set(0, 1.35, -4.4 - i * 3);
            ring.rotation.x = Math.PI / 2;
            this.scene.add(ring);
            this.rings.push(ring);
            this.channelObjects.ring.materials.push(material);
            this.channelObjects.ring.pivots.push(ring);
        }
    }

    addBackGate() {
        const THREE = this.THREE;
        const points = [];
        for (let i = 0; i < 18; i += 1) {
            const a = (Math.PI * 2 * i) / 18;
            const r1 = 1.4;
            const r2 = 3.3;
            points.push(Math.cos(a) * r1, 1.35 + Math.sin(a) * r1, -28);
            points.push(Math.cos(a) * r2, 1.35 + Math.sin(a) * r2, -28);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        const material = new THREE.LineBasicMaterial({ color: COLORS.blue, transparent: true, opacity: 0.18 });
        this.scene.add(new THREE.LineSegments(geometry, material));
        this.channelObjects.back.materials.push(material);
    }

    addHitGrid() {
        const THREE = this.THREE;
        const points = [];
        const left = -1.56;
        const right = 1.56;
        const bottom = 0.72;
        const top = 1.88;
        for (let i = 0; i <= 4; i += 1) {
            const x = left + ((right - left) / 4) * i;
            points.push(x, bottom, this.hitZ, x, top, this.hitZ);
        }
        for (let i = 0; i <= 3; i += 1) {
            const y = bottom + ((top - bottom) / 3) * i;
            points.push(left, y, this.hitZ, right, y, this.hitZ);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        this.scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: COLORS.white, transparent: true, opacity: 0.26 })));
    }

    addSaber() {
        const THREE = this.THREE;
        this.saber.group = new THREE.Group();
        this.saber.blade = new THREE.Mesh(
            new THREE.CylinderGeometry(0.026, 0.034, 1, 24, 1, true),
            new THREE.MeshBasicMaterial({ color: COLORS.blue })
        );
        this.saber.glow = new THREE.Mesh(
            new THREE.CylinderGeometry(0.14, 0.19, 1, 32, 1, true),
            new THREE.MeshBasicMaterial({
                color: COLORS.blue,
                transparent: true,
                opacity: 0.28,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );
        this.saber.hilt = new THREE.Mesh(
            new THREE.CylinderGeometry(0.07, 0.095, 0.42, 22),
            new THREE.MeshStandardMaterial({ color: 0x121722, metalness: 0.78, roughness: 0.28 })
        );
        this.saber.guard = new THREE.Mesh(
            new THREE.CylinderGeometry(0.018, 0.024, 0.54, 14),
            new THREE.MeshBasicMaterial({ color: COLORS.blue, transparent: true, opacity: 0.9 })
        );
        this.saber.light = new THREE.PointLight(COLORS.blue, 3.6, 5.4, 2);
        this.saber.group.add(this.saber.blade, this.saber.glow, this.saber.hilt, this.saber.guard, this.saber.light);
        this.scene.add(this.saber.group);
    }

    resize() {
        if (!this.container || !this.renderer || !this.camera) return;
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    }

    start(onFrame) {
        this.renderer.setAnimationLoop(() => {
            const now = performance.now();
            const dt = Math.min(0.05, (now - this.clock) / 1000);
            this.clock = now;
            onFrame?.(dt, now);
            this.updateBursts(now);
            this.renderer.render(this.scene, this.camera);
        });
    }

    update({ notes, lightEvents, currentTime, travelTime, saber }) {
        this.updateNotes(notes, currentTime, travelTime);
        this.updateSaber(saber);
        this.updateLightshow(lightEvents, currentTime);
    }

    updateNotes(notes, currentTime, travelTime) {
        const active = new Set();
        notes.forEach(note => {
            if (note.state !== 'pending') return;
            if (currentTime < note.timeSec - travelTime || currentTime > note.timeSec + 0.24) return;
            active.add(note.runtimeId);
            let mesh = this.noteMeshes.get(note.runtimeId);
            if (!mesh) {
                mesh = this.createNote(note);
                this.noteMeshes.set(note.runtimeId, mesh);
                this.scene.add(mesh);
            }
            const progress = 1 - ((note.timeSec - currentTime) / travelTime);
            const eased = clamp(progress, 0, 1);
            const post = clamp((currentTime - note.timeSec) / 0.24, 0, 1);
            const position = noteWorldPosition(note);
            mesh.position.set(position.x, position.y, currentTime <= note.timeSec
                ? this.spawnZ + ((this.hitZ - this.spawnZ) * (eased * eased * (3 - 2 * eased)))
                : this.hitZ + (post * post * 1.9));
            mesh.rotation.z = (note.angle || 0) * Math.PI / 180;
            mesh.rotation.x = 0.03 * Math.sin(currentTime * 9 + note.x);
            mesh.scale.setScalar(0.9 + eased * 0.16 + post * 0.22);
        });

        this.noteMeshes.forEach((mesh, id) => {
            if (active.has(id)) return;
            this.scene.remove(mesh);
            this.disposeObject(mesh);
            this.noteMeshes.delete(id);
        });
    }

    createNote(note) {
        const THREE = this.THREE;
        const group = new THREE.Group();
        const cube = new THREE.Mesh(
            this.noteGeometry,
            new THREE.MeshStandardMaterial({
                color: COLORS.blue,
                emissive: COLORS.blue,
                emissiveIntensity: 0.74,
                roughness: 0.24,
                metalness: 0.2
            })
        );
        const edges = new THREE.LineSegments(this.edgeGeometry, new THREE.LineBasicMaterial({ color: COLORS.white, transparent: true, opacity: 0.55 }));
        const textureKey = String(note.direction);
        if (!this.arrowTextures.has(textureKey)) this.arrowTextures.set(textureKey, makeArrowTexture(THREE, note.direction));
        const arrow = new THREE.Mesh(
            this.arrowGeometry,
            new THREE.MeshBasicMaterial({ map: this.arrowTextures.get(textureKey), transparent: true, depthWrite: false })
        );
        arrow.position.z = 0.296;
        const glow = new THREE.Mesh(
            new THREE.BoxGeometry(0.7, 0.7, 0.7),
            new THREE.MeshBasicMaterial({ color: COLORS.blue, transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        group.add(glow, cube, edges, arrow);
        return group;
    }

    updateSaber(saber) {
        if (!saber?.base || !saber?.tip) return;
        const THREE = this.THREE;
        const base = new THREE.Vector3(saber.base.x, saber.base.y, saber.base.z);
        const tip = new THREE.Vector3(saber.tip.x, saber.tip.y, saber.tip.z);
        const direction = new THREE.Vector3().subVectors(tip, base);
        const length = Math.max(direction.length(), 0.01);
        const unit = direction.clone().normalize();
        const middle = new THREE.Vector3().addVectors(base, tip).multiplyScalar(0.5);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), unit);
        const hiltMiddle = base.clone().add(unit.clone().multiplyScalar(-0.22));
        const guardAxis = new THREE.Vector3().crossVectors(unit, new THREE.Vector3(0, 0, 1));
        if (guardAxis.lengthSq() < 0.001) guardAxis.set(1, 0, 0);
        guardAxis.normalize();
        const guardQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), guardAxis);

        this.saber.blade.position.copy(middle);
        this.saber.blade.quaternion.copy(quaternion);
        this.saber.blade.scale.set(1, length, 1);
        this.saber.glow.position.copy(middle);
        this.saber.glow.quaternion.copy(quaternion);
        this.saber.glow.scale.set(1, length, 1);
        this.saber.hilt.position.copy(hiltMiddle);
        this.saber.hilt.quaternion.copy(quaternion);
        this.saber.guard.position.copy(base);
        this.saber.guard.quaternion.copy(guardQuaternion);
        this.saber.light.position.copy(tip);
    }

    updateLightshow(lightEvents = [], currentTime = 0) {
        if (currentTime + 0.05 < this.lastLightTime) this.lightEventsCursor = 0;
        this.lastLightTime = currentTime;

        while (this.lightEventsCursor < lightEvents.length && lightEvents[this.lightEventsCursor].timeSec <= currentTime + 0.012) {
            const event = lightEvents[this.lightEventsCursor];
            if (event.timeSec >= currentTime - 0.08) this.applyLightEvent(event);
            this.lightEventsCursor += 1;
        }

        Object.values(this.channelState).forEach(state => {
            state.flash *= 0.86;
            state.intensity = Math.max(0.1, state.intensity * 0.94);
        });

        const beatSweep = currentTime * 0.48;
        this.rings.forEach((ring, index) => {
            ring.rotation.z = beatSweep + index * 0.14;
            ring.position.z += Math.sin(currentTime * 0.7 + index) * 0.002;
        });

        this.applyChannel('left', 0.18);
        this.applyChannel('right', 0.18);
        this.applyChannel('back', 0.12);
        this.applyChannel('ring', 0.06);

        const floorBoost = Math.max(this.channelState.left.flash, this.channelState.right.flash, this.channelState.back.flash);
        this.runwayMaterials.forEach((material, index) => {
            material.opacity = (index === 1 ? 0.22 : 0.16) + floorBoost * 0.18;
        });
    }

    applyLightEvent(event) {
        if (event.kind === 'rotation') {
            const channel = targetChannel(event.target);
            this.channelObjects[channel]?.pivots.forEach((pivot, index) => {
                pivot.rotation.z += (event.rotation || 0) * Math.PI / 180 * (index % 2 ? -0.08 : 0.08);
            });
            this.channelState.ring.flash = Math.max(this.channelState.ring.flash, 0.7);
            return;
        }

        const channel = targetChannel(event.target);
        const state = this.channelState[channel] || this.channelState.back;
        state.color = eventColor(event, state.color);
        state.intensity = Math.max(state.intensity, clamp(event.intensity || 0.8, 0.12, 2.6));
        state.flash = Math.max(state.flash, clamp(event.intensity || 0.8, 0.18, 2.6));
        this.channelState.ring.color = state.color;
        this.channelState.ring.flash = Math.max(this.channelState.ring.flash, state.flash * 0.55);
    }

    applyChannel(channel, baseOpacity) {
        const objects = this.channelObjects[channel];
        const state = this.channelState[channel];
        if (!objects || !state) return;
        const color = state.color || COLORS.blue;
        const boost = clamp(state.intensity + state.flash, 0, 2.8);
        objects.materials.forEach((material, index) => {
            material.color.setHex(color);
            material.opacity = baseOpacity + boost * (channel === 'ring' ? 0.08 : 0.18) + (index % 3) * 0.01;
        });
        objects.lights.forEach(light => {
            light.color.setHex(color);
            light.intensity = 1.2 + boost * 5.4;
        });
        objects.pivots.forEach((pivot, index) => {
            pivot.rotation.z += (channel === 'left' ? 1 : -1) * (0.0008 + boost * 0.0009) * (index + 1);
        });
    }

    pulseNote(note, type) {
        const THREE = this.THREE;
        const position = noteWorldPosition(note);
        const group = new THREE.Group();
        group.position.set(position.x, position.y, this.hitZ);
        const color = type === 'hit' ? COLORS.blue : COLORS.amber;
        for (let i = 0; i < 14; i += 1) {
            const angle = (Math.PI * 2 * i) / 14;
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute([
                0, 0, 0,
                Math.cos(angle) * 0.52,
                Math.sin(angle) * 0.52,
                -0.28
            ], 3));
            group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 })));
        }
        this.bursts.push({ group, born: performance.now(), life: type === 'hit' ? 250 : 360 });
        this.scene.add(group);
        this.channelState.ring.flash = Math.max(this.channelState.ring.flash, type === 'hit' ? 0.75 : 0.35);
    }

    updateBursts(now) {
        this.bursts = this.bursts.filter(burst => {
            const t = (now - burst.born) / burst.life;
            if (t >= 1) {
                this.scene.remove(burst.group);
                this.disposeObject(burst.group);
                return false;
            }
            burst.group.scale.setScalar(1 + t * 2.2);
            burst.group.children.forEach(child => {
                child.material.opacity = 1 - t;
                child.position.z = -t * 0.7;
            });
            return true;
        });
    }

    disposeObject(object) {
        object.traverse(child => {
            if (child.geometry && child.geometry !== this.noteGeometry && child.geometry !== this.edgeGeometry && child.geometry !== this.arrowGeometry) {
                child.geometry.dispose();
            }
            if (child.material && !Array.isArray(child.material)) child.material.dispose();
        });
    }
}
