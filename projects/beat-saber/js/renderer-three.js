const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js';

const COLORS = {
    red: 0xff305c,
    blue: 0x00d5ff,
    green: 0xb8ff5c,
    amber: 0xffd166,
    white: 0xffffff
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
        this.saberLine = null;
        this.saberTip = null;
        this.saberGlow = null;
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
        const material = new THREE.LineBasicMaterial({ color: 0x2ee9ff, transparent: true, opacity: 0.28 });
        const tunnel = new THREE.LineSegments(geometry, material);
        this.scene.add(tunnel);
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
        const positions = new Float32Array(6);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({ color: COLORS.blue, linewidth: 4, transparent: true, opacity: 0.96 });
        this.saberLine = new THREE.Line(geometry, material);
        this.scene.add(this.saberLine);

        this.saberTip = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 20, 20),
            new THREE.MeshBasicMaterial({ color: COLORS.blue })
        );
        this.scene.add(this.saberTip);

        this.saberGlow = new THREE.PointLight(COLORS.blue, 3, 5, 2);
        this.scene.add(this.saberGlow);
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

    updateFrame({ notes, currentTime, travelTime, saber }) {
        const active = new Set();

        notes.forEach(note => {
            const isPending = note.state === 'pending';
            const inWindow = currentTime >= note.timeSec - travelTime && currentTime <= note.timeSec + 0.42;
            if (!isPending || !inWindow) return;

            active.add(note.runtimeId);
            let group = this.noteMeshes.get(note.runtimeId);
            if (!group) {
                group = this.createNoteMesh(note);
                this.noteMeshes.set(note.runtimeId, group);
                this.scene.add(group);
            }

            const remaining = note.timeSec - currentTime;
            const progress = clamp(1 - (remaining / travelTime), 0, 1);
            const eased = progress * progress * (3 - (2 * progress));
            group.position.set(
                this.gridX(note.x),
                this.gridY(note.y),
                this.spawnZ + ((this.hitZ - this.spawnZ) * eased)
            );
            const scale = 0.74 + (progress * 0.16);
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
        if (!this.saberLine || !this.saberTip) return;
        const THREE = this.THREE;
        const point = this.normalizedToWorld(saber);
        const vector = saber?.vector || { x: 0, y: 1 };
        const color = saber?.hand === 'left' ? COLORS.red : COLORS.blue;
        const positions = this.saberLine.geometry.attributes.position.array;
        const vx = clamp(Number(vector.x) || 0, -1, 1);
        const vy = clamp(Number(vector.y) || 1, -1, 1);

        positions[0] = point.x - (vx * 0.48);
        positions[1] = point.y - (vy * 0.48);
        positions[2] = this.hitZ + 1.2;
        positions[3] = point.x + (vx * 0.92);
        positions[4] = point.y + (vy * 0.92);
        positions[5] = this.hitZ - 0.42;
        this.saberLine.geometry.attributes.position.needsUpdate = true;
        this.saberLine.material.color.setHex(color);
        this.saberTip.position.set(point.x, point.y, this.hitZ + 0.18);
        this.saberTip.material.color.setHex(color);
        this.saberGlow.color.setHex(color);
        this.saberGlow.position.copy(this.saberTip.position);
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
