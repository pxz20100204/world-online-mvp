(function () {
  "use strict";

  const WIDTH = 1280;
  const HEIGHT = 720;
  const LANE_Y = 425;
  const VALID_ACTIONS = new Set(["advance", "retreat", "hold", "basic", "skill1", "skill2", "ultimate"]);
  let game = null;
  let activeScene = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function laneX(position) {
    return 64 + position / 100 * 1152;
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
      this.aiTelemetry = { status: "AI 启动中", candidates: 0, predictionMs: 0, computeMs: 0, reason: "正在读取兵线" };
    }

    preload() {
      this.load.image("arena-map", "assets/arena-map.svg");
    }

    create() {
      activeScene = this;
      this.add.image(WIDTH / 2, HEIGHT / 2, "arena-map").setDisplaySize(WIDTH, HEIGHT);
      this.add.rectangle(WIDTH / 2, 49, WIDTH, 98, 0x101817, .92).setDepth(20);
      this.add.text(32, 26, "金牛竞技场 · 1v1 单线野局", { fontFamily: "Microsoft YaHei UI", fontSize: "20px", color: "#f7f2e8", fontStyle: "bold" }).setDepth(21);
      this.add.text(WIDTH - 32, 27, "人物之王决策域", { fontFamily: "Microsoft YaHei UI", fontSize: "15px", color: "#e6b56f" }).setOrigin(1, 0).setDepth(21);
      this.match = this.createMatchState();
      this.createStructureVisuals();
      this.heroVisuals.player = this.createHeroVisual(this.match.player, 0x4caa9b);
      this.heroVisuals.king = this.createHeroVisual(this.match.king, 0xc15b50);
      this.startWorker();
      this.emitLog(`对局开始：${this.match.player.hero.name} 对阵人物之王控制的 ${this.match.king.hero.name}。`);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.stopWorker());
      this.options.onReady?.();
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

    createStructureVisuals() {
      Object.entries(this.match.structures).forEach(([key, structure]) => {
        const color = structure.side === "player" ? 0x4caa9b : 0xc15b50;
        const radius = structure.kind === "core" ? 34 : 25;
        const base = this.add.circle(0, 0, radius, color, .95).setStrokeStyle(4, 0xffffff, .65);
        const label = this.add.text(0, -2, structure.kind === "core" ? "核" : "塔", { fontFamily: "Microsoft YaHei UI", fontSize: structure.kind === "core" ? "22px" : "17px", color: "#ffffff", fontStyle: "bold" }).setOrigin(.5);
        const hpBack = this.add.rectangle(-35, radius + 13, 70, 6, 0x101817).setOrigin(0, .5);
        const hp = this.add.rectangle(-35, radius + 13, 70, 6, color).setOrigin(0, .5);
        const container = this.add.container(laneX(structure.pos), LANE_Y, [base, label, hpBack, hp]).setDepth(6);
        this.structureVisuals[key] = { container, hp };
      });
    }

    createHeroVisual(entity, color) {
      const shadow = this.add.ellipse(0, 23, 72, 24, 0x101817, .35);
      const body = this.add.circle(0, 0, 31, color, 1).setStrokeStyle(5, 0xffffff, .85);
      const initial = this.add.text(0, -1, entity.hero.name.slice(0, 1), { fontFamily: "Microsoft YaHei UI", fontSize: "25px", color: "#ffffff", fontStyle: "bold" }).setOrigin(.5);
      const name = this.add.text(0, 42, entity.hero.name, { fontFamily: "Microsoft YaHei UI", fontSize: "13px", color: "#ffffff", backgroundColor: "#18201fcc", padding: { x: 6, y: 3 } }).setOrigin(.5, 0);
      const level = this.add.text(-36, -35, "1", { fontFamily: "Arial", fontSize: "12px", color: "#ffffff", backgroundColor: "#18201f", padding: { x: 5, y: 3 } }).setOrigin(.5);
      const hpBack = this.add.rectangle(-42, -48, 84, 8, 0x101817).setOrigin(0, .5);
      const hp = this.add.rectangle(-42, -48, 84, 8, color).setOrigin(0, .5);
      const shield = this.add.rectangle(-42, -41, 84, 3, 0x78cde0).setOrigin(0, .5).setAlpha(0);
      const container = this.add.container(laneX(entity.pos), LANE_Y - 5, [shadow, body, initial, name, level, hpBack, hp, shield]).setDepth(12);
      return { container, body, level, hp, shield };
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
        entity.moveDirection = action === "advance" ? forward : -forward;
        entity.moveUntil = this.match.elapsed + .85;
        return true;
      }
      if (action === "hold") {
        entity.moveUntil = 0;
        entity.moving = false;
        return true;
      }
      if (entity.cooldowns[action] > 0) return false;
      if (action === "skill2") {
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
      if (!target) return false;
      const factors = { basic: .82, skill1: 1.45, ultimate: 2.55 };
      const cooldowns = { basic: .82, skill1: 5, ultimate: 18 };
      const levelScale = 1 + (entity.level - 1) * .085;
      const damage = this.dealDamage(target, entity.hero.baseAtk * factors[action] * levelScale, side, entity.hero.name);
      entity.cooldowns[action] = cooldowns[action];
      if (action === "skill1" && target.hero) target.stunUntil = this.match.elapsed + .35;
      this.projectile(entity.pos, target.pos, side === "player" ? 0x7ed7c9 : 0xef8276, action === "ultimate" ? 13 : 8);
      const skillName = action === "basic" ? "普通攻击" : action === "skill1" ? entity.hero.skills[0] : entity.hero.skills[2];
      this.emitLog(`${entity.hero.name}施放${skillName}，造成 ${damage} 伤害。`);
      return true;
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

    projectile(from, to, color, radius) {
      const orb = this.add.circle(laneX(from), LANE_Y - 12, radius, color, .95).setDepth(16);
      this.tweens.add({ targets: orb, x: laneX(to), duration: 150, ease: "Quad.easeOut", onComplete: () => orb.destroy() });
    }

    flashAt(position, color, scale = 1) {
      const ring = this.add.circle(laneX(position), LANE_Y, 22 * scale, color, .2).setStrokeStyle(4, color, .9).setDepth(15);
      this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 320, onComplete: () => ring.destroy() });
    }

    createMinionVisual(minion) {
      const color = minion.side === "player" ? 0x79c6ba : 0xdd796e;
      const body = this.add.circle(0, 0, 10, color, 1).setStrokeStyle(2, 0xffffff, .7);
      const hpBack = this.add.rectangle(-11, -16, 22, 3, 0x101817).setOrigin(0, .5);
      const hp = this.add.rectangle(-11, -16, 22, 3, color).setOrigin(0, .5);
      const container = this.add.container(laneX(minion.pos), LANE_Y + (minion.id % 3 - 1) * 20, [body, hpBack, hp]).setDepth(8);
      const visual = { container, hp };
      this.minionVisuals.set(minion.id, visual);
      return visual;
    }

    updateVisuals() {
      if (!this.match) return;
      for (const side of ["player", "king"]) {
        const entity = this.match[side];
        const visual = this.heroVisuals[side];
        visual.container.x = laneX(entity.pos);
        visual.container.alpha = entity.dead ? .16 : 1;
        visual.hp.scaleX = clamp(entity.hp / entity.maxHp, 0, 1);
        visual.shield.setAlpha(entity.shield > 0 ? 1 : 0).setScale(clamp(entity.shield / Math.max(1, entity.maxHp * .2), 0, 1), 1);
        visual.level.setText(String(entity.level));
        visual.body.setStrokeStyle(entity.shield > 0 ? 7 : 5, entity.shield > 0 ? 0x8be1ef : 0xffffff, .85);
      }
      Object.entries(this.match.structures).forEach(([key, structure]) => {
        const visual = this.structureVisuals[key];
        visual.container.alpha = structure.hp <= 0 ? .18 : 1;
        visual.hp.scaleX = clamp(structure.hp / structure.maxHp, 0, 1);
      });
      const livingIds = new Set();
      for (const minion of this.match.minions) {
        livingIds.add(minion.id);
        const visual = this.minionVisuals.get(minion.id) || this.createMinionVisual(minion);
        visual.container.x = laneX(minion.pos);
        visual.hp.scaleX = clamp(minion.hp / minion.maxHp, 0, 1);
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
    version: "1.0.0-phaser-3.90"
  };
})();
