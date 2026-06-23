const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js';

const COLORS = {
    red: 0xff305c,
    blue: 0x00d5ff,
    green: 0xb8ff5c,
    amber: 0xffd166,
    white: 0xffffff,
    violet: 0x9d7cff
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function directionAngle(direction) {
    const angles = {
        0: -Math.PI / 2,
        1: Math.PI / 2,
        2: Math.PI,
        3: 0,
        4: -Math.PI * 0.75,
        5: -Math.PI * 0.25,
        6: Math.PI * 0.75,
        7: Math.PI * 0.25
    };
    return angles[direction] ?? 0;
}

function drawArrowTexture(THREE, direction, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.shadowColor = color === 'red' ? '#ff305c' : '#00d5ff';
    ctx.shadowBlur = 18;
    ctx.lineWidth = 22;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.save();
    ctx.translate(128, 128);

    if (direction === 8) {
        ctx.beginPath();
        ctx.arc(0, 0, 34, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.rotate(directionAngle(direction));
        ctx.beginPath();
        ctx.moveTo(-54, 0);
        ctx.lineTo(42, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(42, 0);
        ctx.lineTo(10, -30);
        ctx.lineTo(10, 30);
        ctx.closePath();
        ctx.fill();
    }

    ctx.restore();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function colorHexFromName(name, fallback = COLORS.blue) {
    if (name === 'red') return COLORS.red;
    if (name === 'blue') return COLORS.blue;
    if (name === 'boost') return COLORS.green;
    if (name === 'white') return COLORS.white;
    return fallback;
}

export class BeatSaberRenderer {
    constructor() {
        this.THREE = null;
        this.container = null;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.noteMeshes = new Map();
        this.bursts = [];
        this.arrowTextures = new Map();
        this.noteGeometry = null;
        this.arrowGeometry = null;
        this.edgeGeometry = null;
        this.clock = { last: performance.now() };
        this.hitZ = 1.2;
        this.spawnZ = -38;
        this.laneSpacing = 1.35;
        this.rowSpacing = 1.05;
        this.rowBase = 1.05;
        this.saberGroup = null;
        this.saberCore = null;
        this.saberGlowBlade = null;
        this.saberHilt = null;
        this.saberGuard = null;
        this.saberGlow = null;
        this.tunnelMaterial = null;
        this.lightRig = null;
        this.lightState = {
            left: { color: COLORS.blue, intensity: 0.2 },
            right: { color: COLORS.red, intensity: 0.2 },
            back: { color: COLORS.violet, intensity: 0.2 },
            center: { color: COLORS.blue, intensity: 0.2 },
            boost: { color: COLORS.green, intensity: 0 }
        };
        this.onFrame = null;
    }

    async init(container) {
        this.container = container;
        this.THREE = await import(THREE_URL);
        const THREE = this.THREE;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x03040a);
        this.scene.fog = new THREE.Fog(0x03040a, 12, 52);

        this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 90);
        this.camera.position.set(0, 2.15, 8.2);
        this.camera.lookAt(0, 1.65, -14);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(container.clientWidth, container.clientHeight, false);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(this.renderer.domElement);

        this.noteGeometry = new THREE.BoxGeometry(0.72, 0.72, 0.72);
        this.arrowGeometry = new THREE.PlaneGeometry(0.58, 0.58);
        this.edgeGeometry = new THREE.EdgesGeometry(this.noteGeometry);

        this.addLights();
        this.addTunnel();
        this.addLightshowRig();
        this.addHitGrid();
        this.addSaber();
        this.resize();

        window.addEventListener('resize', () => this.resize());
        this.renderer.domElement.addEventListener('webglcontextlost', event => {
            event.preventDefault();
        });
    }

    addLights() {
        const THREE = this.THREE;
        this.scene.add(new THREE.AmbientLight(0x99b7ff, 0.55));

        const blue = new THREE.PointLight(COLORS.blue, 12, 22, 2.2);
        blue.position.set(-3.5, 4, 2);
        this.scene.add(blue);

        const red = new THREE.PointLight(COLORS.red, 9, 20, 2.2);
        red.position.set(3.5, 3.6, -2);
        this.scene.add(red);

        const key = new THREE.DirectionalLight(0xffffff, 1.1);
        key.position.set(0, 6, 6);
        this.scene.add(key);
    }

    addTunnel() {
        const THREE = this.THREE;
        const points = [];
        const zMin = -42;
        const zMax = 4;
        const width = 7;
        const floor = 0;
        const roof = 4.5;

        for (let z = zMin; z <= zMax; z += 2) {
            points.push(-width / 2, floor, z, width / 2, floor, z);
            points.push(-width / 2, roof, z, width / 2, roof, z);
            points.push(-width / 2, floor, z, -width / 2, roof, z);
            points.push(width / 2, floor, z, width / 2, roof, z);
        }

        for (let x = -width / 2; x <= width / 2; x += 1.35) {
            points.push(x, floor, zMin, x, floor, zMax);
            points.push(x, roof, zMin, x, roof, zMax);
        }

        for (let y = floor; y <= roof; y += 1.1) {
            points.push(-width / 2, y, zMin, -width / 2, y, zMax);
            points.push(width / 2, y, zMin, width / 2, y, zMax);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        this.tunnelMaterial = new THREE.LineBasicMaterial({ color: 0x2ee9ff, transparent: true, opacity: 0.24 });
        const tunnel = new THREE.LineSegments(geometry, this.tunnelMaterial);
        this.scene.add(tunnel);
    }

    addLightshowRig() {
        const THREE = this.THREE;
        const makeBeam = (target, index, color, xSign) => {
            const y = 0.55 + (index * 0.68);
            const zNear = 3.1 - (index * 0.08);
            const zFar = -34 + (index * 0.9);
            const startX = xSign * 3.42;
            const endX = xSign * (0.35 + (index % 2) * 0.9);
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute([
                startX, y, zNear,
                endX, 1.4 + ((index % 3) * 0.5), zFar
            ], 3));
            const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.16 });
            const line = new THREE.Line(geometry, material);
            this.scene.add(line);
            this.lightRig[target].materials.push(material);
        };

        this.lightRig = {
            left: { materials: [], lights: [] },
            right: { materials: [], lights: [] },
            back: { materials: [], lights: [] },
            center: { materials: [], lights: [] }
        };

        for (let i = 0; i < 9; i += 1) {
            makeBeam('left', i, COLORS.blue, -1);
            makeBeam('right', i, COLORS.red, 1);
        }

        for (let i = 0; i < 8; i += 1) {
            const geometry = new THREE.RingGeometry(2.1 + i * 0.36, 2.13 + i * 0.36, 80);
            const material = new THREE.MeshBasicMaterial({
                color: i % 2 ? COLORS.violet : COLORS.blue,
                transparent: true,
                opacity: 0.045,
                side: THREE.DoubleSide
            });
            const ring = new THREE.Mesh(geometry, material);
            ring.position.set(0, 2.1, -6 - i * 3.15);
            ring.rotation.x = Math.PI / 2;
            this.scene.add(ring);
            this.lightRig.back.materials.push(material);
        }

        const leftLight = new THREE.PointLight(COLORS.blue, 0.8, 26, 2);
        leftLight.position.set(-3.4, 2.6, -8);
        const rightLight = new THREE.PointLight(COLORS.red, 0.8, 26, 2);
        rightLight.position.set(3.4, 2.6, -8);
        const backLight = new THREE.PointLight(COLORS.violet, 0.8, 34, 2);
        backLight.position.set(0, 3.4, -18);
        this.scene.add(leftLight, rightLight, backLight);
        this.lightRig.left.lights.push(leftLight);
        this.lightRig.right.lights.push(rightLight);
        this.lightRig.back.lights.push(backLight);
    }

    addHitGrid() {
        const THREE = this.THREE;
        const points = [];
        const left = this.gridX(0) - 0.68;
        const right = this.gridX(3) + 0.68;
        const bottom = this.gridY(0) - 0.52;
        const top = this.gridY(2) + 0.52;

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
        const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38 });
        this.scene.add(new THREE.LineSegments(geometry, material));
    }

    addSaber() {
        const THREE = this.THREE;
        this.saberGroup = new THREE.Group();

        this.saberCore = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.045, 1, 24, 1, true),
            new THREE.MeshBasicMaterial({ color: COLORS.blue, transparent: true, opacity: 0.98 })
        );
        this.saberGlowBlade = new THREE.Mesh(
            new THREE.CylinderGeometry(0.15, 0.2, 1, 32, 1, true),
            new THREE.MeshBasicMaterial({
                color: COLORS.blue,
                transparent: true,
                opacity: 0.24,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );
        this.saberHilt = new THREE.Mesh(
            new THREE.CylinderGeometry(0.09, 0.12, 0.48, 20),
            new THREE.MeshStandardMaterial({ color: 0x111923, metalness: 0.65, roughness: 0.3 })
        );
        this.saberGuard = new THREE.Mesh(
            new THREE.SphereGeometry(0.12, 18, 18),
            new THREE.MeshBasicMaterial({ color: COLORS.blue })
        );
        this.saberCrossGuard = new THREE.Mesh(
            new THREE.CylinderGeometry(0.028, 0.035, 0.58, 16),
            new THREE.MeshBasicMaterial({ color: COLORS.blue, transparent: true, opacity: 0.92 })
        );

        this.saberGlow = new THREE.PointLight(COLORS.blue, 3, 5, 2);
        this.saberGroup.add(
            this.saberGlowBlade,
            this.saberCore,
            this.saberHilt,
            this.saberGuard,
            this.saberCrossGuard,
            this.saberGlow
        );
        this.scene.add(this.saberGroup);
    }

    start(onFrame) {
        this.onFrame = onFrame;
        this.renderer.setAnimationLoop(() => {
            const now = performance.now();
            const dt = Math.min(0.05, (now - this.clock.last) / 1000);
            this.clock.last = now;
            this.onFrame?.(dt, now);
            this.updateBursts(now);
            this.renderer.render(this.scene, this.camera);
        });
    }

    stop() {
        this.renderer?.setAnimationLoop(null);
    }

    resize() {
        if (!this.container || !this.renderer || !this.camera) return;
        const width = Math.max(this.container.clientWidth, 1);
        const height = Math.max(this.container.clientHeight, 1);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    }

    gridX(column) {
        return (column - 1.5) * this.laneSpacing;
    }

    gridY(row) {
        return this.rowBase + (row * this.rowSpacing);
    }

    normalizedToWorld(pose) {
        return {
            x: clamp(Number(pose?.x) || 0, -1, 1) * 2.35,
            y: 1.95 + (clamp(Number(pose?.y) || 0, -1, 1) * 1.35)
        };
    }

    normalizedToWorld3(pose) {
        return new this.THREE.Vector3(
            clamp(Number(pose?.x) || 0, -1.2, 1.2) * 2.35,
            1.95 + (clamp(Number(pose?.y) || 0, -1.1, 1.1) * 1.35),
            this.hitZ + (clamp(Number(pose?.z) || 0, -1.15, 1.15) * 1.45)
        );
    }

    updateFrame({ notes, lightEvents, currentTime, travelTime, saber }) {
        const active = new Set();
        const exitZ = this.hitZ + 3.2;

        notes.forEach(note => {
            const isPending = note.state === 'pending';
            const inWindow = currentTime >= note.timeSec - travelTime && currentTime <= note.timeSec + 0.36;
            if (!isPending || !inWindow) return;

            active.add(note.runtimeId);
            let group = this.noteMeshes.get(note.runtimeId);
            if (!group) {
                group = this.createNoteMesh(note);
                this.noteMeshes.set(note.runtimeId, group);
                this.scene.add(group);
            }

            const remaining = note.timeSec - currentTime;
            const progress = 1 - (remaining / travelTime);
            const approachProgress = clamp(progress, 0, 1);
            const eased = approachProgress * approachProgress * (3 - (2 * approachProgress));
            const postProgress = clamp((currentTime - note.timeSec) / 0.36, 0, 1);
            const z = currentTime <= note.timeSec
                ? this.spawnZ + ((this.hitZ - this.spawnZ) * eased)
                : this.hitZ + ((exitZ - this.hitZ) * (postProgress * postProgress));
            group.position.set(
                this.gridX(note.x),
                this.gridY(note.y),
                z
            );
            const scale = 0.74 + (approachProgress * 0.16) + (postProgress * 0.18);
            group.scale.setScalar(scale);
            group.rotation.z = note.angleOffset * Math.PI / 180;
        });

        this.noteMeshes.forEach((group, id) => {
            if (active.has(id)) return;
            this.scene.remove(group);
            this.disposeGroup(group);
            this.noteMeshes.delete(id);
        });

        this.updateSaber(saber);
        this.updateLightshow(currentTime, lightEvents, notes);
    }

    createNoteMesh(note) {
        const THREE = this.THREE;
        const isRed = note.color === 0;
        const color = isRed ? COLORS.red : COLORS.blue;
        const group = new THREE.Group();

        const material = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.52,
            roughness: 0.36,
            metalness: 0.18
        });
        const cube = new THREE.Mesh(this.noteGeometry, material);
        group.add(cube);

        const edges = new THREE.LineSegments(
            this.edgeGeometry,
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.48 })
        );
        group.add(edges);

        const textureKey = `${note.color}:${note.direction}`;
        if (!this.arrowTextures.has(textureKey)) {
            this.arrowTextures.set(textureKey, drawArrowTexture(THREE, note.direction, isRed ? 'red' : 'blue'));
        }
        const arrow = new THREE.Mesh(
            this.arrowGeometry,
            new THREE.MeshBasicMaterial({
                map: this.arrowTextures.get(textureKey),
                transparent: true,
                depthWrite: false
            })
        );
        arrow.position.z = 0.371;
        group.add(arrow);
        return group;
    }

    updateSaber(saber) {
        if (!this.saberCore || !this.saberGlowBlade || !this.saberHilt) return;
        const THREE = this.THREE;
        const vector = saber?.bladeVector || saber?.vector || { x: 0, y: 1 };
        const fallbackPoint = this.normalizedToWorld(saber);
        const fallbackBase = { x: (saber?.hand === 'left' ? -0.34 : 0.34), y: -0.82 };
        const fallbackTip = {
            x: clamp(fallbackBase.x + (vector.x * 1.55), -1.12, 1.12),
            y: clamp(fallbackBase.y + (vector.y * 1.55), -1, 1.08)
        };
        const blade = saber?.blade || { base: fallbackBase, tip: fallbackTip };
        const color = saber?.hand === 'left' ? COLORS.red : COLORS.blue;
        const base = this.normalizedToWorld(blade.base || fallbackBase);
        const tip = this.normalizedToWorld(blade.tip || fallbackTip);
        const base3 = blade.base3D
            ? this.normalizedToWorld3(blade.base3D)
            : new THREE.Vector3(base.x, base.y, this.hitZ + 1.85);
        const tip3 = blade.tip3D
            ? this.normalizedToWorld3(blade.tip3D)
            : new THREE.Vector3(tip.x, tip.y, this.hitZ - 0.45);
        const direction = new THREE.Vector3().subVectors(tip3, base3);
        const length = Math.max(direction.length(), 0.001);
        const bladeUnit = direction.clone().normalize();
        const mid = new THREE.Vector3().addVectors(base3, tip3).multiplyScalar(0.5);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            bladeUnit
        );
        const hiltEnd = base3.clone().add(bladeUnit.clone().multiplyScalar(-0.52));
        const hiltMid = new THREE.Vector3().addVectors(base3, hiltEnd).multiplyScalar(0.5);
        const hiltDirection = new THREE.Vector3().subVectors(base3, hiltEnd);
        const hiltQuaternion = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            hiltDirection.clone().normalize()
        );
        const twist = Number(blade.twistRad || blade.rollRad || 0);
        const twistQuaternion = new THREE.Quaternion().setFromAxisAngle(bladeUnit, twist);
        let crossAxis = new THREE.Vector3().crossVectors(bladeUnit, new THREE.Vector3(0, 0, 1));
        if (crossAxis.lengthSq() < 0.001) {
            crossAxis = new THREE.Vector3().crossVectors(bladeUnit, new THREE.Vector3(1, 0, 0));
        }
        crossAxis.normalize().applyQuaternion(twistQuaternion);
        const crossQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), crossAxis);

        this.saberCore.position.copy(mid);
        this.saberCore.quaternion.copy(quaternion);
        this.saberCore.scale.set(1, length, 1);
        this.saberGlowBlade.position.copy(mid);
        this.saberGlowBlade.quaternion.copy(quaternion);
        this.saberGlowBlade.scale.set(1, length, 1);
        this.saberHilt.position.copy(hiltMid);
        this.saberHilt.quaternion.copy(hiltQuaternion).multiply(twistQuaternion);
        this.saberGuard.position.copy(base3);
        this.saberCrossGuard.position.copy(base3.clone().add(bladeUnit.clone().multiplyScalar(-0.06)));
        this.saberCrossGuard.quaternion.copy(crossQuaternion);

        this.saberCore.material.color.setHex(color);
        this.saberGlowBlade.material.color.setHex(color);
        this.saberGuard.material.color.setHex(color);
        this.saberCrossGuard.material.color.setHex(color);
        this.saberGlow.color.setHex(color);
        this.saberGlow.position.copy(tip3);

        if (!saber?.blade) {
            this.saberGroup.position.x = fallbackPoint.x * 0.02;
        }
    }

    updateLightshow(currentTime, lightEvents = [], notes = []) {
        if (!this.lightRig) return;
        Object.values(this.lightState).forEach(state => {
            state.intensity *= 0.9;
            if (state.intensity < 0.04) state.intensity = 0.04;
        });

        if (lightEvents.length) {
            lightEvents.forEach(event => {
                const age = currentTime - event.timeSec;
                if (age < 0 || age > 0.18) return;
                const target = this.lightState[event.target] ? event.target : 'center';
                this.lightState[target].color = colorHexFromName(event.color, this.lightState[target].color);
                this.lightState[target].intensity = Math.max(this.lightState[target].intensity, event.intensity || 0.9);
                if (event.target === 'boost') {
                    this.lightState.left.intensity = Math.max(this.lightState.left.intensity, 1.1);
                    this.lightState.right.intensity = Math.max(this.lightState.right.intensity, 1.1);
                    this.lightState.back.color = COLORS.green;
                }
            });
        } else {
            notes.forEach(note => {
                const age = currentTime - note.timeSec;
                if (age < 0 || age > 0.105) return;
                const target = note.x < 2 ? 'left' : 'right';
                this.lightState[target].color = note.color === 0 ? COLORS.red : COLORS.blue;
                this.lightState[target].intensity = Math.max(this.lightState[target].intensity, 1.25);
                this.lightState.back.color = note.color === 0 ? COLORS.red : COLORS.blue;
                this.lightState.back.intensity = Math.max(this.lightState.back.intensity, 0.75);
            });
        }

        this.applyLightTarget('left');
        this.applyLightTarget('right');
        this.applyLightTarget('back');
        const tunnelColor = this.lightState.back.intensity > 0.35 ? this.lightState.back.color : COLORS.blue;
        this.tunnelMaterial?.color.setHex(tunnelColor);
        if (this.tunnelMaterial) this.tunnelMaterial.opacity = 0.18 + Math.min(this.lightState.back.intensity, 1.2) * 0.16;
    }

    applyLightTarget(target) {
        const rig = this.lightRig[target];
        const state = this.lightState[target];
        if (!rig || !state) return;
        const opacity = target === 'back'
            ? 0.035 + Math.min(state.intensity, 1.45) * 0.12
            : 0.08 + Math.min(state.intensity, 1.45) * 0.32;
        rig.materials.forEach(material => {
            material.color.setHex(state.color);
            material.opacity = opacity;
        });
        rig.lights.forEach(light => {
            light.color.setHex(state.color);
            light.intensity = 0.55 + Math.min(state.intensity, 1.6) * 7;
        });
    }

    pulseNote(note, type = 'hit') {
        const THREE = this.THREE;
        const color = type === 'hit' ? (note.color === 0 ? COLORS.red : COLORS.blue) : COLORS.amber;
        const group = new THREE.Group();
        group.position.set(this.gridX(note.x), this.gridY(note.y), this.hitZ);

        for (let i = 0; i < 10; i += 1) {
            const angle = (Math.PI * 2 * i) / 10;
            const length = type === 'hit' ? 0.56 : 0.34;
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute([
                0, 0, 0,
                Math.cos(angle) * length,
                Math.sin(angle) * length,
                -0.15
            ], 3));
            const line = new THREE.Line(
                geometry,
                new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 })
            );
            group.add(line);
        }

        this.bursts.push({ group, born: performance.now(), life: type === 'hit' ? 260 : 360 });
        this.scene.add(group);
    }

    updateBursts(now) {
        const THREE = this.THREE;
        this.bursts = this.bursts.filter(burst => {
            const age = now - burst.born;
            const t = age / burst.life;
            if (t >= 1) {
                this.scene.remove(burst.group);
                this.disposeGroup(burst.group);
                return false;
            }

            burst.group.scale.setScalar(1 + t * 1.9);
            burst.group.children.forEach(child => {
                if (child.material) child.material.opacity = 1 - t;
                child.position.z = -t * 0.8;
            });
            burst.group.rotation.z += 0.04;
            return true;
        });
    }

    disposeGroup(group) {
        group.traverse(child => {
            if (child.geometry && child.geometry !== this.noteGeometry && child.geometry !== this.arrowGeometry && child.geometry !== this.edgeGeometry) {
                child.geometry.dispose();
            }
            if (child.material && !Array.isArray(child.material)) child.material.dispose();
        });
    }
}
