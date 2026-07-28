import * as THREE from "./vendor/three.module.min.js";

const WIDTH = 1280;
const HEIGHT = 720;
const POSITION_SCALE = .3;
const VALID_ACTIONS = new Set(["advance", "retreat", "hold", "basic", "skill1", "skill2", "ultimate"]);
let activeArena = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function opposingSide(side) {
  return side === "player" ? "king" : "player";
}

function hexColor(value, fallback = 0x6f8279) {
  const normalized = String(value || "").replace("#", "");
  return /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : fallback;
}

function shadeColor(color, amount) {
  const red = clamp((color >> 16) + amount, 0, 255);
  const green = clamp(((color >> 8) & 0xff) + amount, 0, 255);
  const blue = clamp((color & 0xff) + amount, 0, 255);
  return (red << 16) | (green << 8) | blue;
}

function seededRandom(seed = 20260728) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

class ArenaRuntime {
  constructor(options) {
    this.options = options;
    this.parent = document.getElementById(options.parentId);
    this.match = null;
    this.heroVisuals = {};
    this.structureVisuals = {};
    this.minionVisuals = new Map();
    this.effects = [];
    this.runes = [];
    this.accumulator = 0;
    this.hudAccumulator = 0;
    this.lastFrameAt = performance.now();
    this.fps = 60;
    this.frameHandle = 0;
    this.stopped = false;
    this.worker = null;
    this.workerPending = false;
    this.workerSentAt = 0;
    this.workerRequest = 0;
    this.aiAccumulator = 0;
    this.aiTelemetry = { status: "AI 启动中", candidates: 0, predictionMs: 0, computeMs: 0, reason: "正在读取兵线" };
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
    this.compactVisuals = window.innerWidth < 640 || (navigator.hardwareConcurrency || 8) <= 4;
    this.cameraAzimuth = .83;
    this.cameraElevation = .67;
    this.cameraZoom = 1;
    this.appliedCameraZoom = 0;
    this.cameraShake = 0;
    this.pointerState = null;
    this.resizeObserver = null;
  }

  start() {
    if (!this.parent) throw new Error("Arena parent element was not found");
    this.parent.innerHTML = "";
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1b18);
    this.scene.fog = new THREE.FogExp2(0x10241e, .022);
    this.world = new THREE.Group();
    this.scene.add(this.world);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.compactVisuals,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.compactVisuals ? 1.25 : 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = !this.compactVisuals;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "arena-three-canvas";
    this.renderer.domElement.style.touchAction = "none";
    this.parent.appendChild(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(-16, 16, 10, -10, .1, 90);
    this.cameraTarget = new THREE.Vector3(0, .8, 0);
    this.createLights();
    this.createTerrain();
    this.match = this.createMatchState();
    this.createStructureVisuals();
    this.heroVisuals.player = this.createHeroVisual(this.match.player);
    this.heroVisuals.king = this.createHeroVisual(this.match.king);
    this.bindCameraControls();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.parent);
    this.resize();
    this.updateCamera();
    this.startWorker();
    this.emitLog(`对局开始：${this.match.player.hero.name} 对阵人物之王控制的 ${this.match.king.hero.name}。`);
    this.options.onReady?.();
    this.frameHandle = requestAnimationFrame((time) => this.frame(time));
    return this;
  }

  createLights() {
    const hemisphere = new THREE.HemisphereLight(0xb9d9cf, 0x263122, 1.85);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffe6bd, 3.1);
    sun.position.set(-9, 18, 11);
    sun.castShadow = !this.compactVisuals;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 13;
    sun.shadow.camera.bottom = -13;
    sun.shadow.bias = -.0008;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x70bfc3, 1.05);
    rim.position.set(12, 8, -10);
    this.scene.add(rim);
  }

  terrainHeight(x, z) {
    return -.35 + Math.sin(x * .31) * .16 + Math.cos(z * .48) * .13 + Math.sin((x + z) * .21) * .09;
  }

  laneCoordinates(position, lift = 0, rowOffset = 0) {
    const progress = clamp(position / 100, 0, 1);
    const x = (position - 50) * POSITION_SCALE;
    const z = (progress - .5) * 3.2 + Math.sin(progress * Math.PI) * .75 + rowOffset;
    return new THREE.Vector3(x, this.terrainHeight(x, z) + .18 + lift, z);
  }

  createTerrain() {
    const random = seededRandom();
    const groundGeometry = new THREE.PlaneGeometry(38, 23, 38, 23);
    groundGeometry.rotateX(-Math.PI / 2);
    const positions = groundGeometry.attributes.position;
    const colors = [];
    const low = new THREE.Color(0x173629);
    const high = new THREE.Color(0x35563b);
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const y = this.terrainHeight(x, z) + (random() - .5) * .055;
      positions.setY(index, y);
      const color = low.clone().lerp(high, clamp((y + .65) * 1.2, 0, 1));
      color.offsetHSL((random() - .5) * .018, 0, (random() - .5) * .025);
      colors.push(color.r, color.g, color.b);
    }
    groundGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    groundGeometry.computeVertexNormals();
    const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: .96,
      metalness: 0,
      flatShading: true
    }));
    ground.receiveShadow = true;
    this.world.add(ground);

    const riverPoints = [];
    for (let index = 0; index <= 30; index += 1) {
      const z = -11 + index / 30 * 22;
      const x = .35 + Math.sin(z * .42) * .65;
      riverPoints.push(new THREE.Vector3(x, this.terrainHeight(x, z) + .055, z));
    }
    const river = this.createRibbon(riverPoints, 2.35, new THREE.MeshStandardMaterial({
      color: 0x22637a,
      roughness: .26,
      metalness: .08,
      transparent: true,
      opacity: .9,
      side: THREE.DoubleSide
    }));
    river.receiveShadow = true;
    this.world.add(river);

    const riverHighlight = this.createRibbon(riverPoints.map((point) => point.clone().add(new THREE.Vector3(-.34, .025, 0))), .07, new THREE.MeshBasicMaterial({
      color: 0xa0d6d2,
      transparent: true,
      opacity: .34,
      side: THREE.DoubleSide
    }));
    this.world.add(riverHighlight);

    const lanePoints = [];
    for (let position = -3; position <= 103; position += 2.5) lanePoints.push(this.laneCoordinates(position, .025));
    const laneBorder = this.createRibbon(lanePoints, 3.55, new THREE.MeshStandardMaterial({ color: 0x252d29, roughness: 1, flatShading: true }));
    laneBorder.receiveShadow = true;
    this.world.add(laneBorder);
    const lane = this.createRibbon(lanePoints.map((point) => point.clone().add(new THREE.Vector3(0, .045, 0))), 3.18, new THREE.MeshStandardMaterial({
      color: 0x66695b,
      roughness: .94,
      metalness: .02,
      flatShading: true
    }));
    lane.receiveShadow = true;
    this.world.add(lane);
    this.createStonePaving(random);
    this.createForest(random);
    this.createArenaRunes();
  }

  createRibbon(points, width, material) {
    const vertices = [];
    const indices = [];
    for (let index = 0; index < points.length; index += 1) {
      const before = points[Math.max(0, index - 1)];
      const after = points[Math.min(points.length - 1, index + 1)];
      const tangent = after.clone().sub(before).setY(0).normalize();
      const perpendicular = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(width / 2);
      const left = points[index].clone().add(perpendicular);
      const right = points[index].clone().sub(perpendicular);
      vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
      if (index < points.length - 1) {
        const offset = index * 2;
        indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
  }

  createStonePaving(random) {
    const geometry = new THREE.BoxGeometry(.62, .095, 1.12, 1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x858575, roughness: .98, flatShading: true });
    const stones = new THREE.InstancedMesh(geometry, material, 54);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < 54; index += 1) {
      const position = 1 + index / 53 * 98;
      const row = index % 3 - 1;
      const point = this.laneCoordinates(position, .115, row * .94 + (random() - .5) * .18);
      dummy.position.copy(point);
      dummy.rotation.y = -.105 + (random() - .5) * .08;
      dummy.scale.set(.72 + random() * .42, .8 + random() * .3, .7 + random() * .32);
      dummy.updateMatrix();
      stones.setMatrixAt(index, dummy.matrix);
      stones.setColorAt(index, new THREE.Color(index % 4 === 0 ? 0x77796b : 0x909080));
    }
    stones.receiveShadow = true;
    this.world.add(stones);
  }

  createForest(random) {
    const count = this.compactVisuals ? 30 : 54;
    const trunkGeometry = new THREE.CylinderGeometry(.09, .14, .72, 5);
    const crownGeometry = new THREE.ConeGeometry(.52, 1.5, 6);
    const trunks = new THREE.InstancedMesh(trunkGeometry, new THREE.MeshStandardMaterial({ color: 0x544936, roughness: 1 }), count);
    const crowns = new THREE.InstancedMesh(crownGeometry, new THREE.MeshStandardMaterial({ color: 0x285338, roughness: .94, flatShading: true }), count);
    const dummy = new THREE.Object3D();
    let placed = 0;
    while (placed < count) {
      const x = -17 + random() * 34;
      const z = -9.5 + random() * 19;
      const approximatePosition = clamp(x / POSITION_SCALE + 50, 0, 100);
      const lane = this.laneCoordinates(approximatePosition);
      if (Math.abs(z - lane.z) < 2.8 || Math.abs(x - (.35 + Math.sin(z * .42) * .65)) < 1.7) continue;
      const y = this.terrainHeight(x, z);
      const scale = .72 + random() * .62;
      dummy.position.set(x, y + .35 * scale, z);
      dummy.rotation.y = random() * Math.PI;
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      dummy.position.y = y + 1.22 * scale;
      dummy.rotation.y += random();
      dummy.updateMatrix();
      crowns.setMatrixAt(placed, dummy.matrix);
      placed += 1;
    }
    trunks.castShadow = !this.compactVisuals;
    trunks.receiveShadow = true;
    crowns.castShadow = !this.compactVisuals;
    crowns.receiveShadow = true;
    this.world.add(trunks, crowns);

    const rockCount = this.compactVisuals ? 8 : 15;
    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(.42, 0),
      new THREE.MeshStandardMaterial({ color: 0x56635a, roughness: 1, flatShading: true }),
      rockCount
    );
    for (let index = 0; index < rockCount; index += 1) {
      const x = -16 + random() * 32;
      const z = (index % 2 ? -1 : 1) * (5.4 + random() * 3.4);
      dummy.position.set(x, this.terrainHeight(x, z) + .2, z);
      dummy.rotation.set(random(), random() * Math.PI, random());
      dummy.scale.setScalar(.55 + random() * .8);
      dummy.updateMatrix();
      rocks.setMatrixAt(index, dummy.matrix);
    }
    rocks.castShadow = !this.compactVisuals;
    rocks.receiveShadow = true;
    this.world.add(rocks);
  }

  createArenaRunes() {
    for (const [position, color] of [[14, 0x58d4c2], [50, 0xe0b95d], [86, 0xf16f68]]) {
      const point = this.laneCoordinates(position, .1);
      const group = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(position === 50 ? .92 : .66, position === 50 ? 1.02 : .74, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .42, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      const diamond = new THREE.Mesh(
        new THREE.RingGeometry(.33, .37, 4),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false })
      );
      diamond.rotation.x = -Math.PI / 2;
      diamond.rotation.z = Math.PI / 4;
      group.position.copy(point);
      group.add(ring, diamond);
      group.userData.rune = true;
      group.userData.direction = position === 86 ? -1 : 1;
      this.runes.push(group);
      this.world.add(group);
    }
  }

  createMatchState() {
    const makeHero = (side, hero, position) => ({
      side,
      hero,
      pos: position,
      hp: hero.baseHp,
      maxHp: hero.baseHp,
      level: 1,
      xp: 0,
      gold: 0,
      kills: 0,
      deaths: 0,
      shield: 0,
      shieldUntil: 0,
      dead: false,
      respawn: 0,
      moving: false,
      moveDirection: 0,
      moveUntil: 0,
      queuedAction: null,
      stunUntil: 0,
      cooldowns: { basic: 0, skill1: 0, skill2: 0, ultimate: 0 },
      basicRange: 7.5,
      skill1Range: 12,
      ultimateRange: 14.5
    });
    return {
      elapsed: 0,
      timeLimit: 180,
      nextWaveAt: .8,
      wave: 0,
      minionId: 0,
      minions: [],
      playerHistory: [],
      player: makeHero("player", this.options.playerHero, 13),
      king: makeHero("king", this.options.kingHero, 87),
      structures: {
        playerTower: { side: "player", kind: "tower", pos: 27, hp: 5200, maxHp: 5200, cooldown: 0 },
        kingTower: { side: "king", kind: "tower", pos: 73, hp: 5200, maxHp: 5200, cooldown: 0 },
        playerCore: { side: "player", kind: "core", pos: 5, hp: 8500, maxHp: 8500 },
        kingCore: { side: "king", kind: "core", pos: 95, hp: 8500, maxHp: 8500 }
      },
      finished: false,
      winner: null,
      log: []
    };
  }

  standardMaterial(color, options = {}) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: .72, metalness: .04, flatShading: true }, options));
  }

  prepareMesh(mesh, shadows = true) {
    mesh.castShadow = shadows && !this.compactVisuals;
    mesh.receiveShadow = shadows;
    return mesh;
  }

  createHeroVisual(entity) {
    const teamColor = entity.side === "player" ? 0x4caa9b : 0xc15b50;
    const primary = hexColor(entity.hero.color, teamColor);
    const accent = hexColor(entity.hero.accent, shadeColor(primary, 50));
    const root = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(.72, .85, 32),
      new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: .75, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = .035;
    root.add(ring);
    const queueRing = new THREE.Mesh(
      new THREE.RingGeometry(.94, 1.01, 32),
      new THREE.MeshBasicMaterial({ color: 0xe7be6d, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
    );
    queueRing.rotation.x = -Math.PI / 2;
    queueRing.position.y = .045;
    root.add(queueRing);

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(.88, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0x7fe5ed, transparent: true, opacity: .12, wireframe: true, depthWrite: false })
    );
    shield.position.y = 1.25;
    shield.visible = false;
    root.add(shield);

    const model = this.createLowPolyHero(entity.hero, primary, accent);
    model.rotation.y = entity.side === "player" ? Math.PI / 2 : -Math.PI / 2;
    root.add(model);
    const billboard = this.createStatusBillboard(`${entity.hero.name}`, teamColor, 1.8);
    billboard.group.position.y = 3.18;
    root.add(billboard.group);
    root.position.copy(this.laneCoordinates(entity.pos));
    this.world.add(root);
    return {
      root,
      model,
      ring,
      queueRing,
      shield,
      billboard,
      primary,
      teamColor,
      wasDead: false,
      lastHp: entity.hp,
      lastLevel: entity.level,
      attackStartedAt: -10,
      attackKind: "basic"
    };
  }

  createLowPolyHero(hero, primary, accent) {
    const model = new THREE.Group();
    const dark = shadeColor(primary, -62);
    const skin = hero.shape === "egg" ? 0xeadbb2 : 0xd4ab86;
    const torso = this.prepareMesh(new THREE.Mesh(new THREE.CapsuleGeometry(.38, .72, 3, 7), this.standardMaterial(primary)));
    torso.position.y = 1.35;
    torso.scale.z = .72;
    model.add(torso);
    const belt = this.prepareMesh(new THREE.Mesh(new THREE.CylinderGeometry(.4, .4, .12, 8), this.standardMaterial(dark)));
    belt.position.y = 1.08;
    model.add(belt);

    const headGeometry = hero.shape === "cube" ? new THREE.BoxGeometry(.75, .68, .7) : new THREE.IcosahedronGeometry(.43, 1);
    const head = this.prepareMesh(new THREE.Mesh(headGeometry, this.standardMaterial(skin)));
    head.position.y = 2.25;
    if (hero.shape === "egg") head.scale.set(.82, 1.22, .82);
    model.add(head);

    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x171b19 });
    for (const x of [-.14, .14]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.038, 6, 4), eyeMaterial);
      eye.position.set(x, 2.29, .405);
      model.add(eye);
    }

    const limbMaterial = this.standardMaterial(dark);
    const leftLeg = this.prepareMesh(new THREE.Mesh(new THREE.CapsuleGeometry(.12, .55, 2, 6), limbMaterial));
    leftLeg.position.set(-.2, .48, 0);
    const rightLeg = this.prepareMesh(new THREE.Mesh(new THREE.CapsuleGeometry(.12, .55, 2, 6), limbMaterial));
    rightLeg.position.set(.2, .48, 0);
    model.add(leftLeg, rightLeg);

    const armMaterial = this.standardMaterial(shadeColor(primary, -25));
    const leftArm = this.prepareMesh(new THREE.Mesh(new THREE.CapsuleGeometry(.1, .52, 2, 6), armMaterial));
    leftArm.position.set(-.49, 1.43, 0);
    leftArm.rotation.z = -.12;
    const rightArm = this.prepareMesh(new THREE.Mesh(new THREE.CapsuleGeometry(.1, .52, 2, 6), armMaterial));
    rightArm.position.set(.49, 1.43, 0);
    rightArm.rotation.z = .12;
    model.add(leftArm, rightArm);

    const cape = this.prepareMesh(new THREE.Mesh(new THREE.ConeGeometry(.56, 1.1, 5, 1, true), this.standardMaterial(shadeColor(primary, -75), { side: THREE.DoubleSide })));
    cape.position.set(0, 1.27, -.26);
    cape.rotation.x = -.08;
    model.add(cape);

    const weapon = new THREE.Group();
    const shaft = this.prepareMesh(new THREE.Mesh(new THREE.CylinderGeometry(.035, .045, 1.25, 6), this.standardMaterial(0x8b6745)));
    shaft.position.y = .18;
    const tip = this.prepareMesh(new THREE.Mesh(new THREE.ConeGeometry(.13, .34, 5), this.standardMaterial(accent, { metalness: .25 })));
    tip.position.y = .97;
    weapon.add(shaft, tip);
    weapon.position.set(.62, 1.1, .03);
    weapon.rotation.z = -.22;
    model.add(weapon);
    this.addHeroAccessory(model, hero.shape, primary, accent);
    model.userData = { torso, leftLeg, rightLeg, leftArm, rightArm, weapon };
    return model;
  }

  addHeroAccessory(model, shape, primary, accent) {
    const accessoryMaterial = this.standardMaterial(accent, { metalness: .18, roughness: .48 });
    const add = (mesh, x, y, z, rotation = null) => {
      mesh.position.set(x, y, z);
      if (rotation) mesh.rotation.set(...rotation);
      this.prepareMesh(mesh);
      model.add(mesh);
      return mesh;
    };
    if (shape === "crown" || shape === "queen") {
      add(new THREE.Mesh(new THREE.ConeGeometry(.48, .42, 5, 1, true), accessoryMaterial), 0, 2.75, 0);
    } else if (shape === "bun") {
      for (const [x, y, z, scale] of [[-.28, 2.62, 0, .2], [0, 2.72, 0, .25], [.28, 2.62, 0, .2]]) {
        const bun = add(new THREE.Mesh(new THREE.DodecahedronGeometry(scale, 0), this.standardMaterial(primary)), x, y, z);
        bun.rotation.y = x * 2;
      }
    } else if (shape === "sword") {
      add(new THREE.Mesh(new THREE.ConeGeometry(.26, .62, 4), accessoryMaterial), 0, 2.76, 0, [0, 0, 0]);
    } else if (shape === "hood") {
      add(new THREE.Mesh(new THREE.ConeGeometry(.61, .88, 7, 1, true), this.standardMaterial(primary, { side: THREE.DoubleSide })), 0, 2.39, -.04);
    } else if (shape === "tusk") {
      add(new THREE.Mesh(new THREE.ConeGeometry(.09, .48, 6), this.standardMaterial(0xeee0bd)), -.43, 2.17, .2, [0, 0, Math.PI / 2]);
      add(new THREE.Mesh(new THREE.ConeGeometry(.09, .48, 6), this.standardMaterial(0xeee0bd)), .43, 2.17, .2, [0, 0, -Math.PI / 2]);
    } else if (shape === "sunset") {
      add(new THREE.Mesh(new THREE.TorusGeometry(.57, .055, 6, 20), new THREE.MeshBasicMaterial({ color: accent })), 0, 2.28, -.32);
    } else if (shape === "mask") {
      add(new THREE.Mesh(new THREE.BoxGeometry(.51, .46, .06), this.standardMaterial(0xe5ddd0)), 0, 2.24, .43);
    } else if (shape === "dragon") {
      add(new THREE.Mesh(new THREE.ConeGeometry(.1, .48, 5), accessoryMaterial), -.23, 2.72, -.02, [0, 0, -.35]);
      add(new THREE.Mesh(new THREE.ConeGeometry(.1, .48, 5), accessoryMaterial), .23, 2.72, -.02, [0, 0, .35]);
      add(new THREE.Mesh(new THREE.ConeGeometry(.42, .85, 3), this.standardMaterial(primary, { side: THREE.DoubleSide })), -.48, 1.52, -.3, [0, 0, .65]);
      add(new THREE.Mesh(new THREE.ConeGeometry(.42, .85, 3), this.standardMaterial(primary, { side: THREE.DoubleSide })), .48, 1.52, -.3, [0, 0, -.65]);
    } else if (shape === "tea") {
      add(new THREE.Mesh(new THREE.CylinderGeometry(.32, .24, .38, 8), this.standardMaterial(0xe6ddc7)), 0, 2.72, 0);
      add(new THREE.Mesh(new THREE.TorusGeometry(.18, .045, 5, 12, Math.PI * 1.6), accessoryMaterial), .33, 2.72, 0, [0, Math.PI / 2, 0]);
    } else if (shape === "cube") {
      add(new THREE.Mesh(new THREE.BoxGeometry(.82, .16, .76), this.standardMaterial(primary)), 0, 2.62, 0);
    } else if (shape === "egg") {
      add(new THREE.Mesh(new THREE.TorusGeometry(.35, .035, 5, 18, Math.PI * 1.15), new THREE.MeshBasicMaterial({ color: accent })), 0, 2.22, .39, [0, 0, -.28]);
    }
  }

  createStructureVisuals() {
    Object.entries(this.match.structures).forEach(([key, structure]) => {
      const teamColor = structure.side === "player" ? 0x4caa9b : 0xc15b50;
      const accent = structure.side === "player" ? 0x8ce7d8 : 0xff9d90;
      const root = new THREE.Group();
      const base = this.prepareMesh(new THREE.Mesh(new THREE.CylinderGeometry(structure.kind === "core" ? 1.12 : .9, structure.kind === "core" ? 1.28 : 1.05, .42, 8), this.standardMaterial(0x29332f)));
      base.position.y = .22;
      root.add(base);
      const teamBase = this.prepareMesh(new THREE.Mesh(new THREE.CylinderGeometry(structure.kind === "core" ? .92 : .72, structure.kind === "core" ? 1.02 : .82, .28, 8), this.standardMaterial(shadeColor(teamColor, -45))));
      teamBase.position.y = .5;
      root.add(teamBase);
      let crystal;
      let rune;
      if (structure.kind === "core") {
        crystal = this.prepareMesh(new THREE.Mesh(new THREE.OctahedronGeometry(.64, 0), this.standardMaterial(teamColor, { emissive: teamColor, emissiveIntensity: .28, metalness: .22, roughness: .34 })));
        crystal.position.y = 1.45;
        crystal.scale.y = 1.42;
        rune = new THREE.Mesh(new THREE.TorusGeometry(.94, .045, 7, 32), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: .72 }));
        rune.position.y = 1.45;
        rune.rotation.x = Math.PI / 2;
        root.add(crystal, rune);
      } else {
        const shaft = this.prepareMesh(new THREE.Mesh(new THREE.CylinderGeometry(.42, .64, 1.75, 7), this.standardMaterial(shadeColor(teamColor, -35))));
        shaft.position.y = 1.45;
        const crown = this.prepareMesh(new THREE.Mesh(new THREE.CylinderGeometry(.72, .5, .36, 7), this.standardMaterial(0x35413c)));
        crown.position.y = 2.38;
        crystal = this.prepareMesh(new THREE.Mesh(new THREE.OctahedronGeometry(.38, 0), this.standardMaterial(teamColor, { emissive: teamColor, emissiveIntensity: .25, metalness: .18 })));
        crystal.position.y = 2.9;
        root.add(shaft, crown, crystal);
      }
      const billboard = this.createStatusBillboard(structure.kind === "core" ? "基地核心" : "防御塔", teamColor, 1.65);
      billboard.group.position.y = structure.kind === "core" ? 2.72 : 3.7;
      root.add(billboard.group);
      root.position.copy(this.laneCoordinates(structure.pos));
      this.world.add(root);
      this.structureVisuals[key] = { root, crystal, rune, billboard, crystalBaseY: crystal.position.y, destroyed: false };
    });
  }

  createStatusBillboard(name, color, width) {
    const group = new THREE.Group();
    const nameSprite = this.createTextSprite(name, "#f6f3e8", "rgba(8,16,15,.86)");
    nameSprite.scale.set(width, width * .25, 1);
    nameSprite.position.y = .32;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(width, .13), new THREE.MeshBasicMaterial({ color: 0x07100e, depthTest: false, transparent: true, opacity: .94 }));
    const front = new THREE.Mesh(new THREE.PlaneGeometry(width, .1), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    back.renderOrder = 100;
    front.renderOrder = 101;
    nameSprite.renderOrder = 102;
    group.add(back, front, nameSprite);
    return { group, front, nameSprite, width, name };
  }

  createTextSprite(text, color = "#ffffff", background = "rgba(8,16,15,.82)") {
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = background;
    context.beginPath();
    context.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 18);
    context.fill();
    context.font = "700 38px 'Microsoft YaHei UI', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = color;
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 1, canvas.width - 24);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.userData.canvasTexture = texture;
    return sprite;
  }

  updateStatusBillboard(billboard, ratio) {
    const safeRatio = clamp(ratio, .001, 1);
    billboard.front.scale.x = safeRatio;
    billboard.front.position.x = -(1 - safeRatio) * billboard.width / 2;
    billboard.group.quaternion.copy(this.camera.quaternion);
  }

  createMinionVisual(minion) {
    const color = minion.side === "player" ? 0x79c6ba : 0xdd796e;
    const dark = shadeColor(color, -58);
    const root = new THREE.Group();
    const model = new THREE.Group();
    const body = this.prepareMesh(new THREE.Mesh(new THREE.CapsuleGeometry(.17, .34, 2, 5), this.standardMaterial(color)));
    body.position.y = .64;
    const head = this.prepareMesh(new THREE.Mesh(new THREE.IcosahedronGeometry(.19, 0), this.standardMaterial(0xcda783)));
    head.position.y = 1.13;
    const helmet = this.prepareMesh(new THREE.Mesh(new THREE.ConeGeometry(.23, .22, 6), this.standardMaterial(dark)));
    helmet.position.y = 1.33;
    const legs = this.prepareMesh(new THREE.Mesh(new THREE.BoxGeometry(.32, .36, .17), this.standardMaterial(dark)));
    legs.position.y = .25;
    const spear = this.prepareMesh(new THREE.Mesh(new THREE.CylinderGeometry(.018, .025, 1.12, 5), this.standardMaterial(0x93704b)));
    spear.position.set(.27, .73, .04);
    spear.rotation.z = -.12;
    const tip = this.prepareMesh(new THREE.Mesh(new THREE.ConeGeometry(.06, .2, 4), this.standardMaterial(0xd5d3c5, { metalness: .3 })));
    tip.position.set(.33, 1.38, .04);
    model.add(body, head, helmet, legs, spear, tip);
    model.rotation.y = minion.side === "player" ? Math.PI / 2 : -Math.PI / 2;
    root.add(model);
    const health = new THREE.Group();
    const back = new THREE.Mesh(new THREE.PlaneGeometry(.7, .07), new THREE.MeshBasicMaterial({ color: 0x07100e, depthTest: false }));
    const front = new THREE.Mesh(new THREE.PlaneGeometry(.7, .05), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    health.position.y = 1.65;
    health.add(back, front);
    root.add(health);
    const row = (minion.id % 3 - 1) * .48;
    root.position.copy(this.laneCoordinates(minion.pos, 0, row));
    this.world.add(root);
    const visual = { root, model, health, front, width: .7, row, bornAt: performance.now() / 1000 };
    this.minionVisuals.set(minion.id, visual);
    return visual;
  }

  frame(time) {
    if (this.stopped) return;
    const deltaMs = Math.min(80, Math.max(0, time - this.lastFrameAt));
    this.lastFrameAt = time;
    if (deltaMs > 0) this.fps = this.fps * .9 + Math.min(144, 1000 / deltaMs) * .1;
    if (this.match && !this.match.finished) {
      this.accumulator += deltaMs;
      while (this.accumulator >= 50) {
        this.stepSimulation(.05);
        this.accumulator -= 50;
      }
    }
    this.updateVisuals(time / 1000);
    this.updateEffects(deltaMs / 1000);
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
    this.hudAccumulator += deltaMs;
    if (this.hudAccumulator >= 180) {
      this.hudAccumulator = 0;
      this.options.onHud?.(this.hudSnapshot());
    }
    this.frameHandle = requestAnimationFrame((nextTime) => this.frame(nextTime));
  }

  stepSimulation(dt) {
    const match = this.match;
    match.elapsed += dt;
    if (match.elapsed >= match.nextWaveAt) {
      this.spawnWave();
      match.nextWaveAt += 8;
    }
    this.stepHero(match.player, dt);
    this.stepHero(match.king, dt);
    this.stepMinions(dt);
    this.stepTower(match.structures.playerTower, dt);
    this.stepTower(match.structures.kingTower, dt);
    this.aiAccumulator += dt;
    if (this.aiAccumulator >= .4) {
      this.aiAccumulator = 0;
      this.requestAiDecision();
    }
    if (this.workerPending && match.elapsed - this.workerSentAt > 1.2) {
      this.aiTelemetry = { status: "超时降级", candidates: 7, predictionMs: 1200, computeMs: 0, reason: "决策器超时，执行撤退" };
      this.workerPending = false;
      this.stopWorker();
      this.applyAction("king", "retreat");
    }
    this.checkMatchEnd();
  }

  stepHero(entity, dt) {
    Object.keys(entity.cooldowns).forEach((key) => { entity.cooldowns[key] = Math.max(0, entity.cooldowns[key] - dt); });
    if (entity.dead) {
      entity.queuedAction = null;
      entity.respawn -= dt;
      if (entity.respawn <= 0) {
        entity.dead = false;
        entity.hp = entity.maxHp;
        entity.shield = 0;
        entity.pos = entity.side === "player" ? 11 : 89;
        this.emitLog(`${entity.hero.name}重新进入野局。`);
      }
      return;
    }
    if (entity.shieldUntil <= this.match.elapsed) entity.shield = 0;
    entity.moving = entity.moveUntil > this.match.elapsed && entity.stunUntil <= this.match.elapsed;
    if (entity.moving) {
      const speed = (4.4 + entity.level * .08) * entity.moveDirection;
      entity.pos = clamp(entity.pos + speed * dt, 5, 95);
    }
    this.stepQueuedAction(entity);
  }

  stepQueuedAction(entity) {
    const action = entity.queuedAction;
    if (!action || entity.dead || entity.stunUntil > this.match.elapsed || entity.cooldowns[action] > 0) return;
    const ranges = { basic: entity.basicRange, skill1: entity.skill1Range, ultimate: entity.ultimateRange };
    const target = this.heroTarget(entity, ranges[action]);
    if (target) {
      entity.queuedAction = null;
      entity.moveUntil = 0;
      entity.moving = false;
      this.applyAction(entity.side, action);
      return;
    }
    const nearest = this.nearestEnemyTarget(entity);
    if (!nearest) {
      entity.queuedAction = null;
      return;
    }
    entity.moveDirection = Math.sign(nearest.pos - entity.pos) || (entity.side === "player" ? 1 : -1);
    entity.moveUntil = this.match.elapsed + .25;
  }

  spawnWave() {
    this.match.wave += 1;
    for (const side of ["player", "king"]) {
      for (let index = 0; index < 3; index += 1) {
        this.match.minionId += 1;
        this.match.minions.push({
          id: this.match.minionId,
          side,
          pos: side === "player" ? 8 - index * .7 : 92 + index * .7,
          hp: 540 + this.match.wave * 28,
          maxHp: 540 + this.match.wave * 28,
          attack: 72 + this.match.wave * 4,
          range: 2.5,
          cooldown: index === 2 ? .3 : 0,
          alive: true
        });
      }
    }
    this.emitLog(`第 ${this.match.wave} 波兵线进入战场。`);
  }

  stepMinions(dt) {
    for (const minion of this.match.minions) {
      if (!minion.alive) continue;
      minion.cooldown = Math.max(0, minion.cooldown - dt);
      const target = this.minionTarget(minion);
      if (!target || Math.abs(minion.pos - target.pos) > minion.range) {
        minion.pos = clamp(minion.pos + (minion.side === "player" ? 1 : -1) * 2.05 * dt, 4, 96);
        continue;
      }
      if (minion.cooldown <= 0) {
        this.dealDamage(target, minion.attack, minion.side, "小兵");
        minion.cooldown = 1.15;
        this.pulseMinion(minion.id);
      }
    }
    this.match.minions = this.match.minions.filter((minion) => minion.alive);
  }

  minionTarget(minion) {
    const enemySide = opposingSide(minion.side);
    const enemyMinions = this.match.minions.filter((other) => other.alive && other.side === enemySide).sort((left, right) => Math.abs(left.pos - minion.pos) - Math.abs(right.pos - minion.pos));
    if (enemyMinions[0] && Math.abs(enemyMinions[0].pos - minion.pos) <= minion.range) return enemyMinions[0];
    const enemyHero = this.match[enemySide];
    if (!enemyHero.dead && Math.abs(enemyHero.pos - minion.pos) <= minion.range) return enemyHero;
    const tower = this.match.structures[`${enemySide}Tower`];
    if (tower.hp > 0) return tower;
    return this.match.structures[`${enemySide}Core`];
  }

  stepTower(tower, dt) {
    if (tower.hp <= 0) return;
    tower.cooldown = Math.max(0, tower.cooldown - dt);
    if (tower.cooldown > 0) return;
    const enemySide = opposingSide(tower.side);
    const minion = this.match.minions.filter((unit) => unit.alive && unit.side === enemySide && Math.abs(unit.pos - tower.pos) <= 11).sort((left, right) => Math.abs(left.pos - tower.pos) - Math.abs(right.pos - tower.pos))[0];
    const hero = this.match[enemySide];
    const target = minion || (!hero.dead && Math.abs(hero.pos - tower.pos) <= 11 ? hero : null);
    if (!target) return;
    this.dealDamage(target, 245 + this.match.elapsed * .55, tower.side, "防御塔");
    tower.cooldown = .9;
    this.projectile(tower.pos, target.pos, 0xf2c069, 5, "tower", 0);
  }

  dealDamage(target, rawDamage, sourceSide, sourceName) {
    if (!target || target.hp <= 0 || target.dead) return 0;
    const defense = target.hero ? target.hero.baseDef * (1 + (target.level - 1) * .06) : 45;
    let damage = Math.max(1, Math.floor(rawDamage * 100 / (100 + defense * .22)));
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, damage);
      target.shield -= absorbed;
      damage -= absorbed;
    }
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp <= 0) this.handleDefeat(target, sourceSide, sourceName);
    return damage;
  }

  handleDefeat(target, sourceSide, sourceName) {
    if (target.hero) {
      target.dead = true;
      target.deaths += 1;
      target.respawn = 4.5 + target.level * .45;
      const killer = this.match[sourceSide];
      if (killer?.hero) {
        killer.kills += 1;
        killer.gold += 300;
        this.addXp(killer, 210);
      }
      this.emitLog(`${sourceName}击败了 ${target.hero.name}。`);
    } else if (target.kind === "tower") {
      this.emitLog(`${target.side === "player" ? "我方" : "人物之王"}外塔被摧毁。`);
      this.flashAt(target.pos, 0xff8a70, 1.7);
    } else if (target.kind === "core") {
      this.emitLog(`${target.side === "player" ? "我方" : "人物之王"}基地核心被摧毁。`);
    } else {
      target.alive = false;
      const killer = this.match[sourceSide];
      if (killer?.hero) {
        killer.gold += 34;
        this.addXp(killer, 38);
      }
    }
  }

  addXp(entity, amount) {
    entity.xp += amount;
    const needed = () => 90 + entity.level * 65;
    while (entity.level < 12 && entity.xp >= needed()) {
      entity.xp -= needed();
      entity.level += 1;
      const hpGain = Math.floor(entity.hero.baseHp * .075);
      entity.maxHp += hpGain;
      entity.hp = Math.min(entity.maxHp, entity.hp + hpGain);
      this.emitLog(`${entity.hero.name}升至 ${entity.level} 级。`);
    }
  }

  applyAction(side, action) {
    if (!VALID_ACTIONS.has(action) || !this.match || this.match.finished) return false;
    const entity = this.match[side];
    if (!entity || entity.dead || entity.stunUntil > this.match.elapsed) return false;
    if (side === "player") {
      this.match.playerHistory.push(action);
      this.match.playerHistory = this.match.playerHistory.slice(-8);
    }
    const forward = side === "player" ? 1 : -1;
    if (action === "advance" || action === "retreat") {
      entity.queuedAction = null;
      entity.moveDirection = action === "advance" ? forward : -forward;
      entity.moveUntil = this.match.elapsed + .85;
      return true;
    }
    if (action === "hold") {
      entity.queuedAction = null;
      entity.moveUntil = 0;
      entity.moving = false;
      return true;
    }
    if (entity.cooldowns[action] > 0) return false;
    if (action === "skill2") {
      entity.queuedAction = null;
      entity.shield = Math.floor(entity.maxHp * .2 + entity.hero.baseDef * .8);
      entity.shieldUntil = this.match.elapsed + 4;
      entity.hp = Math.min(entity.maxHp, entity.hp + Math.floor(entity.maxHp * .05));
      entity.cooldowns.skill2 = 8;
      this.triggerAttack(side, action);
      this.flashAt(entity.pos, side === "player" ? 0x70d7ca : 0xe27a70, 1.3);
      this.emitLog(`${entity.hero.name}施放${entity.hero.skills[1]}，获得护盾。`);
      return true;
    }
    const ranges = { basic: entity.basicRange, skill1: entity.skill1Range, ultimate: entity.ultimateRange };
    const target = this.heroTarget(entity, ranges[action]);
    if (!target) {
      if (side !== "player") return false;
      if (entity.queuedAction === action) {
        entity.queuedAction = null;
        entity.moveUntil = 0;
        entity.moving = false;
        this.emitLog(`${entity.hero.name}取消了自动追击。`);
        return true;
      }
      entity.queuedAction = action;
      const nearest = this.nearestEnemyTarget(entity);
      if (nearest) {
        entity.moveDirection = Math.sign(nearest.pos - entity.pos) || 1;
        entity.moveUntil = this.match.elapsed + .25;
      }
      const skillName = action === "basic" ? "普通攻击" : action === "skill1" ? entity.hero.skills[0] : entity.hero.skills[2];
      this.showRangeLock(entity, ranges[action]);
      this.emitLog(`${skillName}已锁定最近目标，进入射程后自动施放。`);
      return true;
    }
    const factors = { basic: .82, skill1: 1.45, ultimate: 2.55 };
    const cooldowns = { basic: .82, skill1: 5, ultimate: 18 };
    const levelScale = 1 + (entity.level - 1) * .085;
    const damage = this.dealDamage(target, entity.hero.baseAtk * factors[action] * levelScale, side, entity.hero.name);
    entity.cooldowns[action] = cooldowns[action];
    if (action === "skill1" && target.hero) target.stunUntil = this.match.elapsed + .35;
    this.triggerAttack(side, action);
    this.projectile(entity.pos, target.pos, side === "player" ? 0x7ed7c9 : 0xef8276, action === "ultimate" ? 13 : 8, action, damage);
    const skillName = action === "basic" ? "普通攻击" : action === "skill1" ? entity.hero.skills[0] : entity.hero.skills[2];
    this.emitLog(`${entity.hero.name}施放${skillName}，造成 ${damage} 伤害。`);
    return true;
  }

  nearestEnemyTarget(entity) {
    const enemySide = opposingSide(entity.side);
    const candidates = this.match.minions.filter((unit) => unit.alive && unit.side === enemySide);
    const enemyHero = this.match[enemySide];
    if (!enemyHero.dead) candidates.push(enemyHero);
    const tower = this.match.structures[`${enemySide}Tower`];
    if (tower.hp > 0) candidates.push(tower);
    else {
      const core = this.match.structures[`${enemySide}Core`];
      if (core.hp > 0) candidates.push(core);
    }
    return candidates.sort((left, right) => Math.abs(left.pos - entity.pos) - Math.abs(right.pos - entity.pos))[0] || null;
  }

  heroTarget(entity, range) {
    const enemySide = opposingSide(entity.side);
    const enemyHero = this.match[enemySide];
    if (!enemyHero.dead && Math.abs(enemyHero.pos - entity.pos) <= range) return enemyHero;
    const enemyMinion = this.match.minions.filter((unit) => unit.alive && unit.side === enemySide && Math.abs(unit.pos - entity.pos) <= range).sort((left, right) => Math.abs(left.pos - entity.pos) - Math.abs(right.pos - entity.pos))[0];
    if (enemyMinion) return enemyMinion;
    const tower = this.match.structures[`${enemySide}Tower`];
    if (tower.hp > 0 && Math.abs(tower.pos - entity.pos) <= range) return tower;
    const core = this.match.structures[`${enemySide}Core`];
    if (tower.hp <= 0 && Math.abs(core.pos - entity.pos) <= range) return core;
    return null;
  }

  startWorker() {
    if (!window.Worker) {
      this.aiTelemetry.status = "安全降级";
      return;
    }
    try {
      this.worker = new Worker("arena-ai-worker.js");
      this.worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type !== "decision" || message.requestId !== this.workerRequest || this.match.finished) return;
        this.workerPending = false;
        const action = VALID_ACTIONS.has(message.action) ? message.action : "hold";
        this.aiTelemetry = Object.assign({ status: "独立决策器正常" }, message.telemetry || {});
        this.applyAction("king", action);
      };
      this.worker.onerror = () => {
        this.aiTelemetry.status = "安全降级";
        this.stopWorker();
      };
    } catch (error) {
      this.aiTelemetry.status = "安全降级";
      this.worker = null;
    }
  }

  stopWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.workerPending = false;
  }

  requestAiDecision() {
    if (this.match.king.dead || this.match.finished) return;
    if (!this.worker) return this.applyAction("king", this.fallbackAiAction());
    if (this.workerPending) return;
    this.workerRequest += 1;
    this.workerPending = true;
    this.workerSentAt = this.match.elapsed;
    this.worker.postMessage({ type: "decide", requestId: this.workerRequest, snapshot: this.aiSnapshot() });
  }

  aiSnapshot() {
    const self = this.match.king;
    const enemy = this.match.player;
    const enemyTower = this.match.structures.playerTower;
    const allyMinionCover = this.match.minions.some((unit) => unit.alive && unit.side === "king" && Math.abs(unit.pos - self.pos) <= 8);
    return {
      self: {
        hp: self.hp, maxHp: self.maxHp, pos: self.pos, dead: self.dead, level: self.level,
        cooldowns: Object.assign({}, self.cooldowns), basicRange: self.basicRange, skill1Range: self.skill1Range, ultimateRange: self.ultimateRange
      },
      enemy: { hp: enemy.hp, maxHp: enemy.maxHp, pos: enemy.pos, moving: enemy.moving, shield: enemy.shield, cooldowns: Object.assign({}, enemy.cooldowns) },
      playerHistory: this.match.playerHistory.slice(-8),
      allyMinionCover,
      towerCover: Math.abs(self.pos - this.match.structures.kingTower.pos) <= 10 && this.match.structures.kingTower.hp > 0,
      towerDanger: Math.abs(self.pos - enemyTower.pos) <= 11 && enemyTower.hp > 0,
      underEnemyTower: Math.abs(self.pos - enemyTower.pos) <= 11 && enemyTower.hp > 0,
      enemyChanneling: enemy.cooldowns.ultimate > 17.5,
      objectiveOpen: enemyTower.hp <= 0
    };
  }

  fallbackAiAction() {
    const king = this.match.king;
    const player = this.match.player;
    const distance = Math.abs(king.pos - player.pos);
    if (king.hp / king.maxHp < .25) return "retreat";
    if (distance <= king.basicRange && king.cooldowns.basic <= 0) return "basic";
    if (distance <= king.skill1Range && king.cooldowns.skill1 <= 0) return "skill1";
    return "advance";
  }

  checkMatchEnd() {
    const match = this.match;
    if (match.structures.kingCore.hp <= 0) return this.finish("player", "人物之王基地核心被摧毁");
    if (match.structures.playerCore.hp <= 0) return this.finish("king", "我方基地核心被摧毁");
    if (match.elapsed < match.timeLimit) return;
    const playerScore = match.structures.playerCore.hp + match.structures.playerTower.hp + match.player.kills * 1400;
    const kingScore = match.structures.kingCore.hp + match.structures.kingTower.hp + match.king.kills * 1400;
    this.finish(playerScore === kingScore ? "draw" : playerScore > kingScore ? "player" : "king", "三分钟对局时间结束");
  }

  finish(winner, reason) {
    if (this.match.finished) return;
    this.match.finished = true;
    this.match.winner = winner;
    this.stopWorker();
    this.emitLog(reason);
    this.options.onHud?.(this.hudSnapshot());
    this.options.onFinish?.({ winner, reason, elapsed: this.match.elapsed, snapshot: this.hudSnapshot() });
  }

  emitLog(message) {
    this.match.log.push(message);
    this.match.log = this.match.log.slice(-7);
  }

  triggerAttack(side, kind) {
    const visual = this.heroVisuals[side];
    if (!visual) return;
    visual.attackStartedAt = performance.now() / 1000;
    visual.attackKind = kind;
  }

  pulseMinion(id) {
    const visual = this.minionVisuals.get(id);
    if (visual) visual.attackStartedAt = performance.now() / 1000;
  }

  showRangeLock(entity, range) {
    const point = this.laneCoordinates(entity.pos, .08);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(.72, range * POSITION_SCALE - .06), range * POSITION_SCALE, 64),
      new THREE.MeshBasicMaterial({ color: 0xe6bd6f, transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(point);
    this.world.add(ring);
    this.addEffect(ring, .8, (progress) => {
      ring.material.opacity = .3 * (1 - progress);
      ring.scale.setScalar(.94 + progress * .08);
    });
  }

  projectile(from, to, color, radius, kind = "basic", damage = 0) {
    const start = this.laneCoordinates(from, kind === "tower" ? 2.65 : 1.55);
    const end = this.laneCoordinates(to, .95);
    const group = new THREE.Group();
    const visualScale = kind === "ultimate" ? .34 : kind === "skill1" ? .24 : kind === "tower" ? .16 : .13;
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(visualScale, kind === "ultimate" ? 2 : 1),
      new THREE.MeshBasicMaterial({ color })
    );
    group.add(orb);
    if (kind === "skill1" || kind === "ultimate") {
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(visualScale * 1.7, visualScale * .13, 5, 20),
        new THREE.MeshBasicMaterial({ color: kind === "ultimate" ? 0xffe6a0 : color, transparent: true, opacity: .82 })
      );
      torus.rotation.x = Math.PI / 2;
      group.add(torus);
    }
    if (kind === "ultimate" && !this.compactVisuals) {
      const light = new THREE.PointLight(color, 4.5, 5.5, 2);
      group.add(light);
    }
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([start, start]);
    const trail = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .65, blending: THREE.AdditiveBlending }));
    group.position.copy(start);
    this.world.add(group, trail);
    const duration = kind === "ultimate" ? .42 : kind === "skill1" ? .3 : .2;
    this.addEffect(group, duration, (progress, elapsed) => {
      const arc = Math.sin(progress * Math.PI) * (kind === "ultimate" ? 2 : .65);
      group.position.lerpVectors(start, end, progress);
      group.position.y += arc;
      group.rotation.y = elapsed * (kind === "ultimate" ? 11 : 7);
      group.rotation.z = elapsed * 8;
      const trailEnd = group.position.clone();
      lineGeometry.setFromPoints([start, trailEnd]);
      trail.material.opacity = .65 * (1 - progress * .55);
    }, () => {
      this.world.remove(trail);
      this.disposeObject(trail);
      this.impactBurst(to, color, kind, damage);
    });
  }

  impactBurst(position, color, kind = "basic", damage = 0) {
    const origin = this.laneCoordinates(position, .9);
    const count = this.compactVisuals ? (kind === "ultimate" ? 22 : 10) : (kind === "ultimate" ? 48 : kind === "skill1" ? 24 : 14);
    const positions = new Float32Array(count * 3);
    const velocities = [];
    const random = seededRandom(Math.floor(position * 997 + this.match.elapsed * 100));
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = origin.x;
      positions[index * 3 + 1] = origin.y;
      positions[index * 3 + 2] = origin.z;
      const angle = random() * Math.PI * 2;
      const speed = .9 + random() * (kind === "ultimate" ? 4.2 : 2.4);
      velocities.push(new THREE.Vector3(Math.cos(angle) * speed, 1 + random() * 3.2, Math.sin(angle) * speed));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color,
      size: kind === "ultimate" ? .22 : .14,
      transparent: true,
      opacity: .92,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const particles = new THREE.Points(geometry, material);
    this.world.add(particles);
    const duration = kind === "ultimate" ? .82 : .48;
    this.addEffect(particles, duration, (progress, elapsed, dt) => {
      const attribute = geometry.attributes.position;
      for (let index = 0; index < count; index += 1) {
        const velocity = velocities[index];
        velocity.y -= 5.4 * dt;
        attribute.array[index * 3] += velocity.x * dt;
        attribute.array[index * 3 + 1] += velocity.y * dt;
        attribute.array[index * 3 + 2] += velocity.z * dt;
      }
      attribute.needsUpdate = true;
      material.opacity = .92 * (1 - progress);
    });

    const shock = new THREE.Mesh(
      new THREE.RingGeometry(.25, .36, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .82, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    shock.rotation.x = -Math.PI / 2;
    shock.position.copy(this.laneCoordinates(position, .12));
    this.world.add(shock);
    this.addEffect(shock, kind === "ultimate" ? .72 : .38, (progress) => {
      shock.scale.setScalar(1 + progress * (kind === "ultimate" ? 8 : 4));
      shock.material.opacity = .82 * (1 - progress);
    });
    if (kind === "ultimate") this.cameraShake = this.reducedMotion ? 0 : .24;
    if (damage > 0) this.showDamageNumber(origin, damage, kind);
  }

  showDamageNumber(origin, damage, kind) {
    const sprite = this.createTextSprite(`-${damage}`, kind === "ultimate" ? "#ffe09b" : "#ffffff", "rgba(39,20,14,.74)");
    sprite.scale.set(kind === "ultimate" ? 1.45 : 1.05, kind === "ultimate" ? .38 : .28, 1);
    sprite.position.copy(origin).add(new THREE.Vector3(0, .65, 0));
    this.world.add(sprite);
    this.addEffect(sprite, .85, (progress) => {
      sprite.position.y += .015;
      sprite.material.opacity = 1 - progress;
    });
  }

  flashAt(position, color, scale = 1) {
    const point = this.laneCoordinates(position, .1);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(.36 * scale, .46 * scale, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .78, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(point);
    this.world.add(ring);
    this.addEffect(ring, .48, (progress) => {
      ring.scale.setScalar(1 + progress * 3.4);
      ring.material.opacity = .78 * (1 - progress);
    });
  }

  addEffect(object, duration, update, complete = null) {
    this.effects.push({ object, duration, elapsed: 0, update, complete });
  }

  updateEffects(dt) {
    const survivors = [];
    for (const effect of this.effects) {
      effect.elapsed += dt;
      const progress = clamp(effect.elapsed / effect.duration, 0, 1);
      effect.update?.(progress, effect.elapsed, dt);
      if (progress >= 1) {
        effect.complete?.();
        this.world.remove(effect.object);
        this.disposeObject(effect.object);
      } else {
        survivors.push(effect);
      }
    }
    this.effects = survivors;
  }

  updateVisuals(now) {
    if (!this.match) return;
    this.runes.forEach((rune) => { rune.rotation.y += .0025 * rune.userData.direction; });
    for (const side of ["player", "king"]) {
      const entity = this.match[side];
      const visual = this.heroVisuals[side];
      visual.root.position.copy(this.laneCoordinates(entity.pos));
      visual.root.visible = !entity.dead;
      visual.shield.visible = entity.shield > 0;
      if (visual.shield.visible) {
        visual.shield.rotation.y = now * 1.8;
        visual.shield.scale.setScalar(1 + Math.sin(now * 5) * .035);
      }
      visual.queueRing.material.opacity = entity.queuedAction ? .82 : 0;
      visual.queueRing.rotation.z = now * 1.1;
      visual.ring.material.opacity = .58 + Math.sin(now * 3 + (side === "player" ? 0 : 1)) * .14;
      this.updateStatusBillboard(visual.billboard, entity.hp / entity.maxHp);
      visual.billboard.group.position.y = 3.18 + Math.sin(now * 2.4) * .025;

      const parts = visual.model.userData;
      const stride = entity.moving ? Math.sin(now * 10.5) : 0;
      parts.leftLeg.rotation.z = stride * .38;
      parts.rightLeg.rotation.z = -stride * .38;
      visual.model.position.y = entity.moving ? Math.abs(stride) * .09 : Math.sin(now * 2.2) * .025;
      visual.model.rotation.z = entity.stunUntil > this.match.elapsed ? Math.sin(now * 28) * .06 : 0;
      const attackAge = now - visual.attackStartedAt;
      const attackDuration = visual.attackKind === "ultimate" ? .62 : .38;
      const attackPulse = attackAge >= 0 && attackAge < attackDuration ? Math.sin(attackAge / attackDuration * Math.PI) : 0;
      parts.rightArm.rotation.x = -attackPulse * 1.8;
      parts.weapon.rotation.x = -attackPulse * 1.45;
      parts.leftArm.rotation.x = visual.attackKind === "skill2" ? -attackPulse * 1.1 : 0;
      parts.torso.rotation.x = attackPulse * .12;
      if (entity.dead && !visual.wasDead) this.impactBurst(entity.pos, 0x6c7772, "skill1", 0);
      if (!entity.dead && visual.wasDead) this.flashAt(entity.pos, visual.teamColor, 1.6);
      visual.wasDead = entity.dead;
      visual.lastHp = entity.hp;
      visual.lastLevel = entity.level;
    }

    Object.entries(this.match.structures).forEach(([key, structure]) => {
      const visual = this.structureVisuals[key];
      this.updateStatusBillboard(visual.billboard, structure.hp / structure.maxHp);
      visual.crystal.rotation.y += .012 * (structure.side === "player" ? 1 : -1);
      visual.crystal.position.y = visual.crystalBaseY + Math.sin(now * 2.7 + structure.pos) * .045;
      if (visual.rune) {
        visual.rune.rotation.z += .009 * (structure.side === "player" ? 1 : -1);
        visual.rune.material.opacity = .52 + Math.sin(now * 2.3) * .18;
      }
      if (structure.hp <= 0 && !visual.destroyed) {
        visual.destroyed = true;
        visual.root.rotation.z = structure.side === "player" ? -.22 : .22;
        this.setObjectOpacity(visual.root, .3);
        this.impactBurst(structure.pos, 0xd37b63, "skill1", 0);
      }
    });

    const livingIds = new Set();
    for (const minion of this.match.minions) {
      livingIds.add(minion.id);
      const visual = this.minionVisuals.get(minion.id) || this.createMinionVisual(minion);
      visual.root.position.copy(this.laneCoordinates(minion.pos, 0, visual.row));
      visual.health.quaternion.copy(this.camera.quaternion);
      const ratio = clamp(minion.hp / minion.maxHp, .001, 1);
      visual.front.scale.x = ratio;
      visual.front.position.x = -(1 - ratio) * visual.width / 2;
      const march = Math.sin(now * 9 + minion.id);
      visual.model.position.y = Math.abs(march) * .05;
      const attackAge = now - (visual.attackStartedAt || -10);
      visual.model.rotation.z = attackAge >= 0 && attackAge < .25 ? Math.sin(attackAge / .25 * Math.PI) * .15 : march * .018;
    }
    for (const [id, visual] of this.minionVisuals) {
      if (!livingIds.has(id)) {
        this.world.remove(visual.root);
        this.disposeObject(visual.root);
        this.minionVisuals.delete(id);
      }
    }
  }

  setObjectOpacity(root, opacity) {
    root.traverse((object) => {
      if (!object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        material.transparent = true;
        material.opacity = Math.min(material.opacity, opacity);
      });
    });
  }

  bindCameraControls() {
    const canvas = this.renderer.domElement;
    this.onPointerDown = (event) => {
      this.pointerState = { id: event.pointerId, x: event.clientX, y: event.clientY, azimuth: this.cameraAzimuth, elevation: this.cameraElevation };
      canvas.setPointerCapture?.(event.pointerId);
    };
    this.onPointerMove = (event) => {
      if (!this.pointerState || this.pointerState.id !== event.pointerId) return;
      const dx = event.clientX - this.pointerState.x;
      const dy = event.clientY - this.pointerState.y;
      this.cameraAzimuth = clamp(this.pointerState.azimuth - dx * .004, -.05, 1.65);
      this.cameraElevation = clamp(this.pointerState.elevation + dy * .0025, .48, .86);
    };
    this.onPointerUp = (event) => {
      if (this.pointerState?.id === event.pointerId) this.pointerState = null;
    };
    this.onWheel = (event) => {
      event.preventDefault();
      this.cameraZoom = clamp(this.cameraZoom * (event.deltaY > 0 ? .93 : 1.07), .76, 1.28);
    };
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  updateCamera() {
    const radius = 24;
    const horizontal = Math.cos(this.cameraElevation) * radius;
    let x = Math.cos(this.cameraAzimuth) * horizontal;
    let z = Math.sin(this.cameraAzimuth) * horizontal;
    let y = Math.sin(this.cameraElevation) * radius;
    if (this.cameraShake > 0) {
      const strength = this.cameraShake;
      x += (Math.random() - .5) * strength;
      y += (Math.random() - .5) * strength * .5;
      z += (Math.random() - .5) * strength;
      this.cameraShake *= .82;
      if (this.cameraShake < .003) this.cameraShake = 0;
    }
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.cameraTarget);
    if (this.appliedCameraZoom !== this.cameraZoom) {
      this.camera.zoom = this.cameraZoom;
      this.camera.updateProjectionMatrix();
      this.appliedCameraZoom = this.cameraZoom;
    }
  }

  resize() {
    if (!this.renderer || !this.parent) return;
    const width = Math.max(1, this.parent.clientWidth || WIDTH);
    const height = Math.max(1, this.parent.clientHeight || HEIGHT);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const vertical = 10.2;
    this.camera.left = -vertical * aspect;
    this.camera.right = vertical * aspect;
    this.camera.top = vertical;
    this.camera.bottom = -vertical;
    this.camera.updateProjectionMatrix();
  }

  disposeObject(root) {
    root.traverse?.((object) => {
      object.geometry?.dispose?.();
      if (!object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        material.map?.dispose?.();
        material.dispose?.();
      });
    });
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.frameHandle);
    this.stopWorker();
    this.resizeObserver?.disconnect();
    const canvas = this.renderer?.domElement;
    if (canvas) {
      canvas.removeEventListener("pointerdown", this.onPointerDown);
      canvas.removeEventListener("pointermove", this.onPointerMove);
      canvas.removeEventListener("pointerup", this.onPointerUp);
      canvas.removeEventListener("pointercancel", this.onPointerUp);
      canvas.removeEventListener("wheel", this.onWheel);
    }
    this.disposeObject(this.scene);
    this.renderer?.dispose();
    canvas?.remove();
  }

  hudSnapshot() {
    const simplifyHero = (entity) => ({
      name: entity.hero.name,
      hp: Math.floor(entity.hp), maxHp: Math.floor(entity.maxHp), level: entity.level, xp: entity.xp,
      gold: entity.gold, kills: entity.kills, deaths: entity.deaths, dead: entity.dead, respawn: Math.max(0, entity.respawn),
      queuedAction: entity.queuedAction,
      cooldowns: Object.fromEntries(Object.entries(entity.cooldowns).map(([key, value]) => [key, Math.max(0, value)]))
    });
    return {
      elapsed: this.match.elapsed,
      timeLimit: this.match.timeLimit,
      fps: this.fps,
      wave: this.match.wave,
      player: simplifyHero(this.match.player),
      king: simplifyHero(this.match.king),
      playerTower: this.match.structures.playerTower.hp,
      kingTower: this.match.structures.kingTower.hp,
      playerCore: this.match.structures.playerCore.hp,
      kingCore: this.match.structures.kingCore.hp,
      log: this.match.log.slice(),
      ai: Object.assign({}, this.aiTelemetry),
      view: { azimuth: this.cameraAzimuth, elevation: this.cameraElevation, zoom: this.cameraZoom },
      finished: this.match.finished,
      winner: this.match.winner
    };
  }
}

function start(options) {
  stop();
  activeArena = new ArenaRuntime(options);
  return activeArena.start();
}

function command(action) {
  return activeArena?.applyAction("player", action) || false;
}

function forfeit() {
  if (!activeArena?.match || activeArena.match.finished) return false;
  activeArena.finish("king", "主公选择投降");
  return true;
}

function stop() {
  activeArena?.stop();
  activeArena = null;
}

window.WorldArena = {
  start,
  command,
  forfeit,
  stop,
  isRunning: () => Boolean(activeArena && activeArena.match && !activeArena.match.finished),
  snapshot: () => activeArena?.hudSnapshot() || null,
  version: "2.0.0-three-0.185.1"
};
