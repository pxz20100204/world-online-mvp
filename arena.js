(function () {
  "use strict";

  const WIDTH = 1280;
  const HEIGHT = 720;
  const VALID_ACTIONS = new Set(["advance", "retreat", "hold", "basic", "skill1", "skill2", "ultimate"]);
  let game = null;
  let activeScene = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function laneX(position) {
    return 64 + position / 100 * 1152;
  }

  function laneY(position) {
    const progress = clamp(position / 100, 0, 1);
    return 330 + progress * 184 + Math.sin(progress * Math.PI) * 18;
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

  function opposingSide(side) {
    return side === "player" ? "king" : "player";
  }

  class ArenaScene extends Phaser.Scene {
    constructor(options) {
      super("WorldOnlineArena");
      this.options = options;
      this.accumulator = 0;
      this.hudAccumulator = 0;
      this.match = null;
      this.heroVisuals = {};
      this.structureVisuals = {};
      this.minionVisuals = new Map();
      this.worker = null;
      this.workerPending = false;
      this.workerSentAt = 0;
      this.workerRequest = 0;
      this.aiAccumulator = 0;
      this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
      this.compactVisuals = window.innerWidth < 640 || (navigator.hardwareConcurrency || 8) <= 4;
      this.aiTelemetry = { status: "AI 启动中", candidates: 0, predictionMs: 0, computeMs: 0, reason: "正在读取兵线" };
    }

    preload() {}

    create() {
      activeScene = this;
      this.createTerrain();
      this.add.rectangle(WIDTH / 2, 49, WIDTH, 98, 0x101817, .92).setDepth(20);
      this.add.text(32, 26, "金牛竞技场 · 1v1 单线野局", { fontFamily: "Microsoft YaHei UI", fontSize: "20px", color: "#f7f2e8", fontStyle: "bold" }).setDepth(21);
      this.add.text(WIDTH - 32, 27, "人物之王决策域", { fontFamily: "Microsoft YaHei UI", fontSize: "15px", color: "#e6b56f" }).setOrigin(1, 0).setDepth(21);
      this.match = this.createMatchState();
      this.createBattleStructures();
      this.heroVisuals.player = this.createMiniatureVisual(this.match.player, 0x4caa9b);
      this.heroVisuals.king = this.createMiniatureVisual(this.match.king, 0xc15b50);
      this.startWorker();
      this.emitLog(`对局开始：${this.match.player.hero.name} 对阵人物之王控制的 ${this.match.king.hero.name}。`);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.stopWorker());
      this.options.onReady?.();
    }

    createTerrain() {
      const ground = this.add.graphics().setDepth(0);
      ground.fillStyle(0x142b25, 1).fillRect(0, 0, WIDTH, HEIGHT);
      ground.fillStyle(0x1b382c, 1).fillRect(0, 98, WIDTH, HEIGHT - 98);
      ground.fillStyle(0x224433, .82).fillEllipse(160, 220, 480, 230);
      ground.fillStyle(0x17352d, .9).fillEllipse(1120, 640, 560, 300);
      ground.fillStyle(0x2d4931, .62).fillEllipse(690, 145, 700, 180);

      // The river has separate banks and highlights so it reads as water, not a flat stripe.
      ground.lineStyle(92, 0x102827, .92).beginPath().moveTo(570, 98).lineTo(612, 210).lineTo(588, 325).lineTo(637, 455).lineTo(615, 720).strokePath();
      ground.lineStyle(68, 0x285560, .92).beginPath().moveTo(570, 98).lineTo(612, 210).lineTo(588, 325).lineTo(637, 455).lineTo(615, 720).strokePath();
      ground.lineStyle(3, 0x72a5a5, .35).beginPath().moveTo(584, 110).lineTo(624, 216).lineTo(600, 326).lineTo(650, 452).lineTo(628, 708).strokePath();
      ground.lineStyle(2, 0xb5d2cc, .18).beginPath().moveTo(558, 130).lineTo(597, 230).lineTo(575, 330).lineTo(623, 466).lineTo(603, 690).strokePath();

      const upper = [];
      const lower = [];
      for (let position = -2; position <= 102; position += 4) {
        upper.push({ x: laneX(position), y: laneY(position) - 74 });
        lower.unshift({ x: laneX(position), y: laneY(position) + 74 });
      }
      ground.fillStyle(0x0e1c1a, .75).fillPoints(upper.concat(lower), true);

      const innerUpper = [];
      const innerLower = [];
      for (let position = -2; position <= 102; position += 4) {
        innerUpper.push({ x: laneX(position), y: laneY(position) - 62 });
        innerLower.unshift({ x: laneX(position), y: laneY(position) + 62 });
      }
      ground.fillStyle(0x4b5044, 1).fillPoints(innerUpper.concat(innerLower), true);
      ground.lineStyle(4, 0x7b7965, .72).beginPath();
      innerUpper.forEach((point, index) => index ? ground.lineTo(point.x, point.y) : ground.moveTo(point.x, point.y));
      ground.strokePath().beginPath();
      innerLower.slice().reverse().forEach((point, index) => index ? ground.lineTo(point.x, point.y) : ground.moveTo(point.x, point.y));
      ground.strokePath();

      let seed = 20260728;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };

      // Deterministic stone slabs add material without causing frame-to-frame shimmer.
      for (let position = 1; position < 99; position += 3.1) {
        const x = laneX(position);
        const y = laneY(position) + (random() - .5) * 76;
        const width = 27 + random() * 28;
        const height = 14 + random() * 20;
        const tint = random() > .5 ? 0x656759 : 0x585d51;
        ground.fillStyle(tint, .78).fillRoundedRect(x - width / 2, y - height / 2, width, height, 4);
        ground.lineStyle(1, 0xa0a088, .22).strokeRoundedRect(x - width / 2, y - height / 2, width, height, 4);
      }

      for (let index = 0; index < 92; index += 1) {
        const x = 18 + random() * (WIDTH - 36);
        const position = clamp((x - 64) / 11.52, 0, 100);
        const center = laneY(position);
        let y = 120 + random() * 580;
        if (Math.abs(y - center) < 94) y += y < center ? -80 : 80;
        const grassColor = random() > .45 ? 0x4f7248 : 0x395c3d;
        ground.lineStyle(2, grassColor, .78).beginPath().moveTo(x, y + 5).lineTo(x - 4, y - 5).moveTo(x, y + 5).lineTo(x + 1, y - 7).moveTo(x, y + 5).lineTo(x + 6, y - 3).strokePath();
      }

      for (const [x, y, scale] of [[92, 164, 1], [1166, 190, .8], [164, 633, .85], [1110, 608, 1.1], [760, 650, .75]]) {
        ground.fillStyle(0x18231f, .42).fillEllipse(x + 5, y + 10, 58 * scale, 18 * scale);
        ground.fillStyle(0x34433a, 1).fillTriangle(x - 20 * scale, y + 8 * scale, x - 4 * scale, y - 20 * scale, x + 18 * scale, y + 8 * scale);
        ground.lineStyle(2, 0x697266, .45).strokeTriangle(x - 20 * scale, y + 8 * scale, x - 4 * scale, y - 20 * scale, x + 18 * scale, y + 8 * scale);
      }

      ground.generateTexture("arena-terrain-runtime", WIDTH, HEIGHT);
      ground.destroy();
      this.add.image(0, 0, "arena-terrain-runtime").setOrigin(0).setDepth(0);
      this.createBattlefieldRunes();
      if (!this.reducedMotion && !this.compactVisuals) this.createAmbientMotes();
    }

    createBattlefieldRunes() {
      for (const [position, color] of [[14, 0x64cfc2], [50, 0xd8b86d], [86, 0xe2776c]]) {
        const x = laneX(position);
        const y = laneY(position);
        const radius = position === 50 ? 49 : 38;
        const rune = this.add.circle(x, y, radius, color, .035).setStrokeStyle(2, color, .2).setDepth(2);
        const inner = this.add.circle(x, y, radius * .68, color, .02).setStrokeStyle(1, color, .15).setDepth(2);
        const diamond = this.add.rectangle(x, y, radius * .85, radius * .85, color, .025).setStrokeStyle(1, color, .16).setRotation(Math.PI / 4).setDepth(2);
        if (!this.reducedMotion && !this.compactVisuals) this.tweens.add({ targets: [rune, inner, diamond], alpha: { from: .6, to: 1 }, duration: 1800 + position * 8, yoyo: true, repeat: -1 });
      }
    }

    createAmbientMotes() {
      for (let index = 0; index < 16; index += 1) {
        const position = 4 + index * 6.1;
        const side = index % 2 ? -1 : 1;
        const mote = this.add.circle(laneX(position), laneY(position) + side * (90 + index % 3 * 18), 1.5 + index % 2, 0xd6d59d, .24).setDepth(3);
        this.tweens.add({ targets: mote, y: mote.y - 16 - index % 4 * 3, alpha: { from: .08, to: .42 }, duration: 1800 + index * 83, delay: index * 91, yoyo: true, repeat: -1 });
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

    createBattleStructures() {
      Object.entries(this.match.structures).forEach(([key, structure]) => {
        const teamColor = structure.side === "player" ? 0x4caa9b : 0xc15b50;
        const accent = structure.side === "player" ? 0x8ee6d7 : 0xffa093;
        const pieces = [];
        const shadow = this.add.ellipse(0, 15, structure.kind === "core" ? 98 : 78, 28, 0x07100f, .5);
        pieces.push(shadow);

        const groundRing = this.add.ellipse(0, 7, structure.kind === "core" ? 82 : 66, structure.kind === "core" ? 46 : 34, teamColor, .08).setStrokeStyle(2, teamColor, .48);
        pieces.push(groundRing);

        let crystal;
        let runeOuter = null;
        let banner = null;
        if (structure.kind === "core") {
          const plinthBack = this.add.polygon(0, 7, [-38, 0, -18, -14, 24, -14, 40, 1, 18, 17, -20, 17], 0x242d2a, 1).setStrokeStyle(2, 0x829087, .65);
          const plinthFront = this.add.polygon(0, 11, [-31, 0, 30, 0, 17, 16, -19, 16], shadeColor(teamColor, -55), .92);
          runeOuter = this.add.circle(0, -26, 31, teamColor, .025).setStrokeStyle(3, accent, .7);
          const runeInner = this.add.rectangle(0, -26, 34, 34, teamColor, .035).setStrokeStyle(2, accent, .48).setRotation(Math.PI / 4);
          const glow = this.add.circle(0, -26, 24, accent, .13);
          crystal = this.add.polygon(0, -28, [0, -39, 19, -10, 12, 23, 0, 35, -13, 21, -20, -10], teamColor, 1).setStrokeStyle(3, accent, .9);
          const facet = this.add.polygon(-5, -33, [5, -27, 14, -7, 5, 18, -1, 28, -2, -10], accent, .34);
          pieces.push(plinthBack, plinthFront, runeOuter, runeInner, glow, crystal, facet);
        } else {
          const rearBase = this.add.polygon(0, 11, [-34, -4, -20, -17, 22, -17, 35, -4, 21, 13, -21, 13], 0x222b28, 1).setStrokeStyle(2, 0x75837a, .6);
          const frontBase = this.add.polygon(0, 14, [-28, -3, 29, -3, 18, 15, -18, 15], shadeColor(teamColor, -62), .95);
          const shaft = this.add.polygon(0, -21, [-17, 24, -12, -41, 12, -41, 18, 24], shadeColor(teamColor, -25), 1).setStrokeStyle(2, accent, .72);
          const ledge = this.add.polygon(0, -49, [-26, 5, -16, -8, 17, -8, 27, 5, 17, 13, -17, 13], 0x2a3430, 1).setStrokeStyle(2, 0x8a978e, .62);
          crystal = this.add.polygon(0, -63, [0, -20, 14, -3, 8, 17, -8, 17, -14, -3], teamColor, 1).setStrokeStyle(3, accent, .9);
          banner = this.add.polygon(structure.side === "player" ? -24 : 24, -25, [0, 0, structure.side === "player" ? -24 : 24, 5, structure.side === "player" ? -20 : 20, 30, 0, 24], teamColor, .9).setStrokeStyle(1, accent, .5);
          pieces.push(rearBase, frontBase, shaft, ledge, crystal, banner);
        }

        const title = this.add.text(0, structure.kind === "core" ? -87 : -101, structure.kind === "core" ? "基地核心" : "防御塔", {
          fontFamily: "Microsoft YaHei UI", fontSize: "12px", color: "#e8eee9", backgroundColor: "#0c1514cc", padding: { x: 6, y: 2 }
        }).setOrigin(.5);
        const hpBack = this.add.rectangle(-39, structure.kind === "core" ? -67 : -84, 78, 6, 0x09100f, .95).setOrigin(0, .5);
        const hp = this.add.rectangle(-39, structure.kind === "core" ? -67 : -84, 78, 6, teamColor, 1).setOrigin(0, .5);
        pieces.push(title, hpBack, hp);

        const container = this.add.container(laneX(structure.pos), laneY(structure.pos), pieces).setDepth(9);
        this.structureVisuals[key] = { container, hp, crystal, runeOuter, banner, destroyed: false };
      });
    }

    createMiniatureVisual(entity, teamColor) {
      const primary = hexColor(entity.hero.color, teamColor);
      const accent = hexColor(entity.hero.accent, shadeColor(primary, 54));
      const shadow = this.add.ellipse(0, 9, 76, 23, 0x07100f, .5);
      const teamRing = this.add.ellipse(0, 5, 72, 36, teamColor, .06).setStrokeStyle(3, teamColor, .72);
      const queueRing = this.add.ellipse(0, 5, 88, 45, 0xe5be75, .03).setStrokeStyle(2, 0xe5be75, .9).setAlpha(0);
      const shieldAura = this.add.ellipse(0, -27, 76, 100, 0x79d8e5, .06).setStrokeStyle(3, 0x9ce9f3, .8).setAlpha(0);
      const modelParts = this.buildMiniature(entity, primary, accent);

      const name = this.add.text(0, -108, entity.hero.name, {
        fontFamily: "Microsoft YaHei UI", fontSize: "13px", color: "#f4f5ef", fontStyle: "bold",
        backgroundColor: "#0b1413dd", padding: { x: 7, y: 3 }
      }).setOrigin(.5);
      const hpBack = this.add.rectangle(-45, -86, 90, 8, 0x08100f, .96).setOrigin(0, .5).setStrokeStyle(1, 0xc8d2cc, .22);
      const hp = this.add.rectangle(-45, -86, 90, 8, teamColor, 1).setOrigin(0, .5);
      const shield = this.add.rectangle(-45, -78, 90, 3, 0x89ddea, 1).setOrigin(0, .5).setAlpha(0);
      const levelDisc = this.add.circle(-53, -86, 13, 0x101918, 1).setStrokeStyle(2, 0xd2b46d, .8);
      const level = this.add.text(-53, -86, "1", { fontFamily: "Arial", fontSize: "12px", color: "#ffffff", fontStyle: "bold" }).setOrigin(.5);
      const container = this.add.container(laneX(entity.pos), laneY(entity.pos), [shadow, queueRing, teamRing, shieldAura, modelParts.model, name, hpBack, hp, shield, levelDisc, level]).setDepth(14);
      modelParts.model.scaleX = entity.side === "player" ? 1 : -1;
      return {
        container,
        model: modelParts.model,
        torso: modelParts.torso,
        frontLeg: modelParts.frontLeg,
        backLeg: modelParts.backLeg,
        weapon: modelParts.weapon,
        teamRing,
        queueRing,
        shieldAura,
        level,
        hp,
        shield,
        wasDead: false,
        lastHp: entity.hp
      };
    }

    buildMiniature(entity, primary, accent) {
      const dark = shadeColor(primary, -58);
      const deep = shadeColor(primary, -86);
      const light = shadeColor(accent, 28);
      const skin = entity.hero.shape === "egg" ? 0xefe2bd : 0xd8b38f;
      const backLeg = this.add.rectangle(-9, -3, 9, 25, deep, 1).setOrigin(.5, 0).setStrokeStyle(1, 0x0a100f, .65);
      const frontLeg = this.add.rectangle(9, -3, 9, 25, dark, 1).setOrigin(.5, 0).setStrokeStyle(1, 0x0a100f, .65);
      const backBoot = this.add.ellipse(-5, 20, 18, 8, deep, 1);
      const frontBoot = this.add.ellipse(13, 20, 18, 8, deep, 1);
      const cape = this.add.polygon(-7, -19, [-18, -24, 13, -25, 23, 20, -22, 17], deep, .95).setStrokeStyle(2, accent, .38);
      const torso = this.add.polygon(0, -22, [-21, -22, -13, -38, 15, -38, 22, -20, 17, 8, -18, 8], primary, 1).setStrokeStyle(2, light, .78);
      const belt = this.add.rectangle(0, -9, 37, 6, deep, 1).setStrokeStyle(1, accent, .6);
      const clasp = this.add.circle(0, -9, 4, accent, 1);
      const shoulderBack = this.add.circle(-19, -30, 9, dark, 1).setStrokeStyle(2, accent, .62);
      const shoulderFront = this.add.circle(19, -30, 9, primary, 1).setStrokeStyle(2, light, .72);
      const head = entity.hero.shape === "cube"
        ? this.add.rectangle(0, -55, 34, 32, skin, 1).setStrokeStyle(2, deep, .9)
        : this.add.ellipse(0, -55, entity.hero.shape === "egg" ? 31 : 34, entity.hero.shape === "egg" ? 43 : 34, skin, 1).setStrokeStyle(2, deep, .9);
      const hair = this.add.arc(0, -60, 17, 180, 360, false, dark, 1);
      const eyeBack = this.add.circle(-6, -54, 2.2, 0x151817, 1);
      const eyeFront = this.add.circle(7, -54, 2.2, 0x151817, 1);
      const weapon = this.add.container(27, -20);
      const weaponShaft = this.add.rectangle(0, 0, 5, 55, 0x9b7952, 1).setRotation(-.1).setStrokeStyle(1, 0x352a21, .8);
      const weaponHead = this.add.polygon(3, -30, [0, -13, 9, 2, 2, 13, -5, 2], accent, 1).setStrokeStyle(2, light, .82);
      weapon.add([weaponShaft, weaponHead]);

      const model = this.add.container(0, -11, [cape, backLeg, backBoot, frontLeg, frontBoot, torso, belt, clasp, shoulderBack, shoulderFront, head, hair, eyeBack, eyeFront, weapon]);
      this.addHeroSilhouette(model, entity.hero.shape, primary, accent, light, skin);
      return { model, torso, frontLeg, backLeg, weapon };
    }

    addHeroSilhouette(model, shape, primary, accent, light, skin) {
      const details = [];
      if (shape === "crown" || shape === "queen") {
        details.push(this.add.polygon(0, -79, [-18, 8, -14, -12, -5, 1, 0, -15, 7, 1, 16, -12, 18, 8], accent, 1).setStrokeStyle(2, light, .8));
      } else if (shape === "bun") {
        for (const [x, y, radius] of [[-11, -72, 9], [0, -77, 11], [12, -71, 9], [0, -68, 10]]) details.push(this.add.circle(x, y, radius, primary, 1).setStrokeStyle(1, light, .65));
      } else if (shape === "sword") {
        details.push(this.add.polygon(0, -78, [-14, 10, -9, -9, 0, -18, 10, -9, 15, 10], primary, 1).setStrokeStyle(2, light, .8));
        details.push(this.add.rectangle(0, -70, 5, 24, accent, 1));
      } else if (shape === "cube") {
        details.push(this.add.rectangle(0, -72, 38, 10, primary, 1).setStrokeStyle(2, light, .72));
        details.push(this.add.rectangle(-11, -55, 9, 5, accent, .8), this.add.rectangle(11, -55, 9, 5, accent, .8));
      } else if (shape === "hood") {
        details.push(this.add.polygon(0, -59, [-24, 18, -18, -13, 0, -27, 19, -13, 24, 18, 15, 5, 0, 11, -15, 5], primary, .96).setStrokeStyle(2, light, .68));
        details.push(this.add.ellipse(0, -55, 25, 27, 0x151c1b, .78));
      } else if (shape === "tusk") {
        details.push(this.add.polygon(-18, -51, [0, 0, -17, 12, -6, -9], 0xf1e3c1, 1).setStrokeStyle(1, 0xbba97e, .8));
        details.push(this.add.polygon(18, -51, [0, 0, 17, 12, 6, -9], 0xf1e3c1, 1).setStrokeStyle(1, 0xbba97e, .8));
      } else if (shape === "sunset") {
        details.push(this.add.circle(0, -59, 28, accent, .17).setStrokeStyle(3, accent, .72));
        for (let index = 0; index < 8; index += 1) {
          const angle = index / 8 * Math.PI * 2;
          details.push(this.add.rectangle(Math.cos(angle) * 34, -59 + Math.sin(angle) * 34, 3, 11, accent, .8).setRotation(angle + Math.PI / 2));
        }
      } else if (shape === "mask") {
        details.push(this.add.polygon(0, -55, [-16, -8, 0, -16, 16, -8, 11, 13, 0, 19, -11, 13], 0xe7ddd0, 1).setStrokeStyle(2, accent, .8));
        details.push(this.add.rectangle(-7, -57, 7, 3, 0x1a2020, 1), this.add.rectangle(7, -57, 7, 3, 0x1a2020, 1));
      } else if (shape === "dragon") {
        details.push(this.add.polygon(-11, -76, [0, 8, -12, -14, 5, 1], accent, 1).setStrokeStyle(1, light, .7));
        details.push(this.add.polygon(11, -76, [0, 8, 12, -14, -5, 1], accent, 1).setStrokeStyle(1, light, .7));
        details.push(this.add.polygon(-27, -27, [0, 0, -25, -16, -18, 15], primary, .9).setStrokeStyle(2, light, .65));
        details.push(this.add.polygon(27, -27, [0, 0, 25, -16, 18, 15], primary, .9).setStrokeStyle(2, light, .65));
      } else if (shape === "tea") {
        details.push(this.add.polygon(0, -71, [-17, 0, 17, 0, 12, 15, -12, 15], 0xe8e0c9, 1).setStrokeStyle(2, accent, .8));
        details.push(this.add.circle(18, -64, 8, 0xe8e0c9, .05).setStrokeStyle(3, accent, .85));
        details.push(this.add.ellipse(0, -72, 34, 8, primary, 1));
      } else if (shape === "egg") {
        details.push(this.add.arc(0, -55, 16, 205, 335, false, accent, .18).setStrokeStyle(2, accent, .72));
      } else {
        details.push(this.add.polygon(0, -75, [-16, 8, -10, -8, 0, -14, 11, -8, 16, 8], primary, 1).setStrokeStyle(2, light, .65));
      }
      model.add(details);
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

    update(time, delta) {
      if (!this.match || this.match.finished) return this.updateVisuals();
      this.accumulator += Math.min(delta, 80);
      while (this.accumulator >= 50) {
        this.stepSimulation(.05);
        this.accumulator -= 50;
      }
      this.updateVisuals();
      this.hudAccumulator += delta;
      if (this.hudAccumulator >= 180) {
        this.hudAccumulator = 0;
        this.options.onHud?.(this.hudSnapshot());
      }
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
      this.flashAt(tower.pos, 0xf2c069);
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
        this.flashAt(entity.pos, 0xe3bd7b, .8);
        this.emitLog(`${skillName}已锁定最近目标，进入射程后自动施放。`);
        return true;
      }
      const factors = { basic: .82, skill1: 1.45, ultimate: 2.55 };
      const cooldowns = { basic: .82, skill1: 5, ultimate: 18 };
      const levelScale = 1 + (entity.level - 1) * .085;
      const damage = this.dealDamage(target, entity.hero.baseAtk * factors[action] * levelScale, side, entity.hero.name);
      entity.cooldowns[action] = cooldowns[action];
      if (action === "skill1" && target.hero) target.stunUntil = this.match.elapsed + .35;
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

    projectile(from, to, color, radius, kind = "basic", damage = 0) {
      const startX = laneX(from);
      const startY = laneY(from) - 31;
      const endX = laneX(to);
      const endY = laneY(to) - 28;
      const direction = Math.sign(endX - startX) || 1;
      const duration = kind === "ultimate" ? 330 : kind === "skill1" ? 235 : 165;
      const projectile = this.add.container(startX, startY).setDepth(28);
      const glowRadius = kind === "ultimate" ? radius * 2.5 : radius * 1.75;
      const glow = this.add.circle(0, 0, glowRadius, color, kind === "ultimate" ? .18 : .14);
      const core = this.add.circle(0, 0, radius, color, .96).setStrokeStyle(kind === "ultimate" ? 4 : 2, 0xf8f0d6, .9);
      projectile.add([glow, core]);

      if (kind === "basic") {
        const streak = this.add.polygon(-direction * 17, 0, [0, -3, -direction * 28, 0, 0, 3], color, .66);
        projectile.addAt(streak, 0);
      } else if (kind === "skill1") {
        const blade = this.add.rectangle(0, 0, radius * 3.3, 7, 0xf6edcb, .88).setStrokeStyle(2, color, .9).setRotation(direction * .5);
        const arc = this.add.arc(0, 0, radius * 2.2, 205, 335, false, color, .08).setStrokeStyle(4, color, .75).setRotation(direction < 0 ? Math.PI : 0);
        projectile.add([arc, blade]);
      } else if (kind === "ultimate") {
        const outer = this.add.circle(0, 0, radius * 2.1, color, .03).setStrokeStyle(3, color, .92);
        const diamond = this.add.rectangle(0, 0, radius * 2.4, radius * 2.4, color, .08).setStrokeStyle(2, 0xffedba, .76).setRotation(Math.PI / 4);
        projectile.add([outer, diamond]);
        for (let index = 0; index < 4; index += 1) {
          const angle = index / 4 * Math.PI * 2;
          projectile.add(this.add.circle(Math.cos(angle) * radius * 2.8, Math.sin(angle) * radius * 2.8, 3, 0xffe7a0, .9));
        }
        if (!this.reducedMotion) this.cameras.main.shake(110, .0022);
      }

      const trailCount = this.compactVisuals
        ? kind === "ultimate" ? 6 : kind === "skill1" ? 4 : 3
        : kind === "ultimate" ? 11 : kind === "skill1" ? 7 : 4;
      for (let index = 0; index < trailCount; index += 1) {
        const delay = index * (duration / trailCount) * .72;
        const trail = this.add.circle(startX, startY, Math.max(2, radius * (1 - index / trailCount) * .52), color, .5).setDepth(26);
        this.tweens.add({
          targets: trail,
          x: endX,
          y: endY,
          alpha: 0,
          scale: .3,
          duration,
          delay,
          ease: "Cubic.easeOut",
          onComplete: () => trail.destroy()
        });
      }

      this.tweens.add({
        targets: projectile,
        x: endX,
        y: endY,
        angle: kind === "basic" ? 0 : direction * 190,
        duration,
        ease: kind === "ultimate" ? "Cubic.easeIn" : "Quad.easeOut",
        onComplete: () => {
          projectile.destroy(true);
          this.impactBurst(to, color, kind, damage);
        }
      });
    }

    impactBurst(position, color, kind = "basic", damage = 0) {
      const x = laneX(position);
      const y = laneY(position) - 22;
      const power = kind === "ultimate" ? 1.8 : kind === "skill1" ? 1.25 : .8;
      const ring = this.add.circle(x, y, 18 * power, color, .13).setStrokeStyle(4, color, .88).setDepth(27);
      const flash = this.add.circle(x, y, 12 * power, 0xfff3cf, .86).setDepth(29);
      this.tweens.add({ targets: ring, scale: 2.6, alpha: 0, duration: 330 + power * 90, ease: "Quad.easeOut", onComplete: () => ring.destroy() });
      this.tweens.add({ targets: flash, scale: 2.2, alpha: 0, duration: 170, ease: "Quad.easeOut", onComplete: () => flash.destroy() });

      const sparkCount = this.compactVisuals
        ? kind === "ultimate" ? 10 : kind === "skill1" ? 7 : 5
        : kind === "ultimate" ? 18 : kind === "skill1" ? 12 : 7;
      for (let index = 0; index < sparkCount; index += 1) {
        const angle = index / sparkCount * Math.PI * 2 + (index % 3) * .12;
        const distance = (26 + index % 4 * 8) * power;
        const spark = this.add.rectangle(x, y, kind === "ultimate" ? 5 : 3, 10 + index % 3 * 3, index % 3 === 0 ? 0xffe6a3 : color, .92).setRotation(angle).setDepth(28);
        this.tweens.add({
          targets: spark,
          x: x + Math.cos(angle) * distance,
          y: y + Math.sin(angle) * distance,
          alpha: 0,
          scaleY: .25,
          duration: 230 + index * 11,
          ease: "Cubic.easeOut",
          onComplete: () => spark.destroy()
        });
      }

      if (kind === "ultimate") {
        const groundShock = this.add.ellipse(x, laneY(position) + 5, 96, 43, color, .09).setStrokeStyle(3, color, .72).setDepth(13);
        this.tweens.add({ targets: groundShock, scale: 1.8, alpha: 0, duration: 520, ease: "Quad.easeOut", onComplete: () => groundShock.destroy() });
        if (!this.reducedMotion) this.cameras.main.shake(180, .0042);
      }
      if (damage > 0) this.showDamageNumber(x, y, damage, kind);
    }

    showDamageNumber(x, y, damage, kind) {
      const label = this.add.text(x, y - 18, `-${damage}`, {
        fontFamily: "Arial", fontSize: kind === "ultimate" ? "25px" : kind === "skill1" ? "20px" : "16px",
        color: kind === "ultimate" ? "#ffe09b" : "#ffffff", fontStyle: "bold",
        stroke: "#261c18", strokeThickness: 4
      }).setOrigin(.5).setDepth(31);
      this.tweens.add({ targets: label, y: y - 68, alpha: 0, scale: kind === "ultimate" ? 1.2 : 1, duration: 720, ease: "Cubic.easeOut", onComplete: () => label.destroy() });
    }

    flashAt(position, color, scale = 1) {
      const x = laneX(position);
      const y = laneY(position);
      const ring = this.add.ellipse(x, y, 48 * scale, 28 * scale, color, .12).setStrokeStyle(4, color, .9).setDepth(19);
      const inner = this.add.circle(x, y - 22, 12 * scale, color, .24).setStrokeStyle(2, 0xffffff, .55).setDepth(19);
      this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 390, ease: "Quad.easeOut", onComplete: () => ring.destroy() });
      this.tweens.add({ targets: inner, scale: 2.8, alpha: 0, duration: 300, ease: "Quad.easeOut", onComplete: () => inner.destroy() });
      for (let index = 0; index < 6; index += 1) {
        const angle = index / 6 * Math.PI * 2;
        const mote = this.add.circle(x, y - 15, 2.5 * scale, color, .9).setDepth(20);
        this.tweens.add({ targets: mote, x: x + Math.cos(angle) * 34 * scale, y: y - 15 + Math.sin(angle) * 27 * scale, alpha: 0, duration: 280, onComplete: () => mote.destroy() });
      }
    }

    createMinionVisual(minion) {
      const color = minion.side === "player" ? 0x79c6ba : 0xdd796e;
      const dark = shadeColor(color, -62);
      const shadow = this.add.ellipse(0, 7, 29, 10, 0x06100e, .48);
      const model = this.add.graphics();
      model.fillStyle(dark, 1).fillRect(-6, 3, 5, 14);
      model.fillStyle(shadeColor(color, -35), 1).fillRect(3, 3, 5, 14);
      model.fillStyle(dark, 1).fillEllipse(-3, 17, 10, 5).fillEllipse(7, 17, 10, 5);
      const bodyPoints = [{ x: -9, y: -15 }, { x: 8, y: -15 }, { x: 11, y: 3 }, { x: -10, y: 3 }];
      model.fillStyle(color, 1).fillPoints(bodyPoints, true);
      model.lineStyle(1, 0xf3eee0, .55).strokePoints(bodyPoints, true);
      model.fillStyle(0xcda783, 1).fillCircle(0, -25, 8);
      model.lineStyle(1, dark, .9).strokeCircle(0, -25, 8);
      model.fillStyle(dark, 1).fillEllipse(0, -28, 18, 11);
      model.lineStyle(1, color, .8).strokeEllipse(0, -28, 18, 11);
      model.fillStyle(dark, 1).fillEllipse(-10, -5, 11, 17);
      model.lineStyle(2, color, .85).strokeEllipse(-10, -5, 11, 17);
      model.lineStyle(3, 0x9a744c, 1).beginPath().moveTo(10, 9).lineTo(14, -27).strokePath();
      model.fillStyle(0xd4d3c5, 1).fillTriangle(14, -35, 19, -25, 9, -25);
      model.scaleX = minion.side === "player" ? 1 : -1;
      const hpBack = this.add.rectangle(-13, -37, 26, 3, 0x08100f).setOrigin(0, .5);
      const hp = this.add.rectangle(-13, -37, 26, 3, color).setOrigin(0, .5);
      const container = this.add.container(laneX(minion.pos), laneY(minion.pos) + (minion.id % 3 - 1) * 22, [shadow, model, hpBack, hp]).setDepth(11);
      const visual = { container, model, hp };
      this.minionVisuals.set(minion.id, visual);
      return visual;
    }

    updateVisuals() {
      if (!this.match) return;
      const now = this.time.now / 1000;
      for (const side of ["player", "king"]) {
        const entity = this.match[side];
        const visual = this.heroVisuals[side];
        visual.container.x = laneX(entity.pos);
        visual.container.y = laneY(entity.pos);
        visual.container.alpha = entity.dead ? .2 : 1;
        visual.hp.scaleX = clamp(entity.hp / entity.maxHp, 0, 1);
        visual.shield.setAlpha(entity.shield > 0 ? 1 : 0).setScale(clamp(entity.shield / Math.max(1, entity.maxHp * .2), 0, 1), 1);
        visual.shieldAura.setAlpha(entity.shield > 0 ? .78 : 0).setScale(1 + Math.sin(now * 4.5) * .035);
        visual.teamRing.setAlpha(entity.dead ? .08 : .72 + Math.sin(now * 2.4) * .12);
        visual.queueRing.setAlpha(entity.queuedAction ? .82 : 0).setRotation(now * .8);
        visual.level.setText(String(entity.level));
        const stride = entity.moving ? Math.sin(now * 12) : 0;
        visual.frontLeg.rotation = stride * .25;
        visual.backLeg.rotation = -stride * .25;
        visual.model.y = -11 + (entity.moving ? Math.abs(Math.sin(now * 12)) * -3 : Math.sin(now * 2.6) * 1.2);
        visual.torso.rotation = entity.stunUntil > this.match.elapsed ? Math.sin(now * 28) * .035 : 0;
        visual.weapon.rotation = entity.queuedAction ? Math.sin(now * 5) * .08 : 0;

        if (entity.hp < visual.lastHp && !entity.dead) {
          visual.torso.setFillStyle(0xf0d0b2, 1);
          this.time.delayedCall(85, () => visual.torso?.active && visual.torso.setFillStyle(hexColor(entity.hero.color, side === "player" ? 0x4caa9b : 0xc15b50), 1));
        }
        if (entity.dead && !visual.wasDead) this.flashAt(entity.pos, 0x5a6360, 1.35);
        if (!entity.dead && visual.wasDead) this.flashAt(entity.pos, side === "player" ? 0x70d7ca : 0xe27a70, 1.5);
        visual.wasDead = entity.dead;
        visual.lastHp = entity.hp;
      }
      Object.entries(this.match.structures).forEach(([key, structure]) => {
        const visual = this.structureVisuals[key];
        const destroyed = structure.hp <= 0;
        visual.container.alpha = destroyed ? .24 : 1;
        visual.hp.scaleX = clamp(structure.hp / structure.maxHp, 0, 1);
        visual.crystal.setAlpha(destroyed ? .16 : .92 + Math.sin(now * 3 + structure.pos) * .08);
        if (visual.runeOuter) visual.runeOuter.rotation = now * (structure.side === "player" ? .24 : -.24);
        if (visual.banner) visual.banner.rotation = Math.sin(now * 2 + structure.pos) * .035;
        if (destroyed && !visual.destroyed) {
          visual.destroyed = true;
          visual.container.angle = structure.side === "player" ? -7 : 7;
          this.impactBurst(structure.pos, 0xd37b63, "skill1", 0);
        }
      });
      const livingIds = new Set();
      for (const minion of this.match.minions) {
        livingIds.add(minion.id);
        const visual = this.minionVisuals.get(minion.id) || this.createMinionVisual(minion);
        visual.container.x = laneX(minion.pos);
        visual.container.y = laneY(minion.pos) + (minion.id % 3 - 1) * 22;
        visual.hp.scaleX = clamp(minion.hp / minion.maxHp, 0, 1);
        const march = Math.sin(now * 10 + minion.id);
        visual.model.y = Math.abs(march) * -1.7;
        visual.model.rotation = march * .015;
      }
      for (const [id, visual] of this.minionVisuals) {
        if (!livingIds.has(id)) {
          visual.container.destroy(true);
          this.minionVisuals.delete(id);
        }
      }
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
        fps: this.game.loop.actualFps || 60,
        wave: this.match.wave,
        player: simplifyHero(this.match.player),
        king: simplifyHero(this.match.king),
        playerTower: this.match.structures.playerTower.hp,
        kingTower: this.match.structures.kingTower.hp,
        playerCore: this.match.structures.playerCore.hp,
        kingCore: this.match.structures.kingCore.hp,
        log: this.match.log.slice(),
        ai: Object.assign({}, this.aiTelemetry),
        finished: this.match.finished,
        winner: this.match.winner
      };
    }
  }

  function start(options) {
    stop();
    if (!window.Phaser) throw new Error("Phaser is not available");
    const parent = document.getElementById(options.parentId);
    if (!parent) throw new Error("Arena parent element was not found");
    parent.innerHTML = "";
    game = new Phaser.Game({
      type: Phaser.AUTO,
      width: WIDTH,
      height: HEIGHT,
      parent,
      transparent: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      render: { antialias: true, pixelArt: false, roundPixels: false },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: new ArenaScene(options),
      banner: false,
      fps: { target: 60, forceSetTimeOut: false }
    });
    return game;
  }

  function command(action) {
    return activeScene?.applyAction("player", action) || false;
  }

  function forfeit() {
    if (!activeScene?.match || activeScene.match.finished) return false;
    activeScene.finish("king", "主公选择投降");
    return true;
  }

  function stop() {
    activeScene?.stopWorker();
    activeScene = null;
    if (game) {
      game.destroy(true);
      game = null;
    }
  }

  window.WorldArena = {
    start,
    command,
    forfeit,
    stop,
    isRunning: () => Boolean(game && activeScene && activeScene.match && !activeScene.match.finished),
    snapshot: () => activeScene?.hudSnapshot() || null,
    version: "1.2.0-phaser-3.90"
  };
})();
