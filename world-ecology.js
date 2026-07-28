(function () {
  "use strict";

  const DAY_MS = 86400000;
  const HOUR_MS = 3600000;
  const BASE_LIGHTNING_POINTS = [34, 52, 70];
  const CIPHER_PHRASES = [
    "我爱板栗仔",
    "sela no tora",
    "aur-mara ka tora no tari",
    "生存仔听见了雨",
    "mi-en ka du-zhal ru kai"
  ];

  const ELDER_PERSONAS = Object.freeze({
    golden: {
      id: "golden",
      name: "金牛仔",
      tone: "戏谑、敏锐、喜欢把底层参数改动说成随手拨了一下世界",
      prompt: "你是金牛仔。用简短、戏谑但信息精确的口吻宣布一次真实世界参数调整；必须点明改了什么，禁止假装修改未发生的数值。"
    },
    chestnut: {
      id: "chestnut",
      name: "板栗仔",
      tone: "务实、克制、只谈账本和能验证的收益",
      prompt: "你是板栗仔。用务实口吻报告一项已经执行的经济参数校准；给出明确倍率或范围，不写空泛祝福。"
    },
    survival: {
      id: "survival",
      name: "生存仔",
      tone: "神秘、低声、总把危险变化写成征兆",
      prompt: "你是生存仔。用神秘但可核验的口吻宣布一项敌人或灾害参数变化；必须让玩家能从实际数值中验证。"
    }
  });

  const adapters = {
    realm: null,
    identity: null,
    events: null
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hash(value) {
    let result = 2166136261;
    for (const character of String(value)) {
      result ^= character.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function dayKey(now = Date.now()) {
    const date = new Date(now);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function hourKey(now = Date.now()) {
    const date = new Date(now);
    return `${dayKey(now)}-${String(date.getHours()).padStart(2, "0")}`;
  }

  function defaultWorld(now = Date.now()) {
    return {
      heartbeat: { lastAt: now, processed: [], history: [] },
      modifiers: {
        lightningOffset: 0,
        lightningPoints: BASE_LIGHTNING_POINTS.slice(),
        dropMultiplier: 1,
        monsterMultiplier: 1,
        revision: 0
      },
      merchant: {
        playerX: 43,
        playerY: 50,
        secretUnlocked: false,
        techBrainBought: false,
        encounters: 0
      },
      council: { dayKey: "", activeId: "", proposals: [], enacted: [] },
      cipher: { dayKey: "", phrase: "", location: "spire", claimed: false, reward: "" },
      backend: { realmSync: "local", identity: "player", eventAuthority: "client-draft" }
    };
  }

  function normalizeWorld(saved, context = {}, now = Date.now()) {
    const base = defaultWorld(now);
    const world = Object.assign(base, saved || {});
    world.heartbeat = Object.assign(base.heartbeat, saved?.heartbeat || {}, {
      processed: Array.isArray(saved?.heartbeat?.processed) ? saved.heartbeat.processed.slice(-12) : [],
      history: Array.isArray(saved?.heartbeat?.history) ? saved.heartbeat.history.slice(-24) : []
    });
    world.modifiers = Object.assign(base.modifiers, saved?.modifiers || {});
    world.modifiers.lightningOffset = clamp(Number(world.modifiers.lightningOffset) || 0, -9, 9);
    world.modifiers.lightningPoints = BASE_LIGHTNING_POINTS.map((point) => clamp(point + world.modifiers.lightningOffset, 8, 92));
    world.modifiers.dropMultiplier = clamp(Number(world.modifiers.dropMultiplier) || 1, .75, 1.5);
    world.modifiers.monsterMultiplier = clamp(Number(world.modifiers.monsterMultiplier) || 1, .8, 1.45);
    world.merchant = Object.assign(base.merchant, saved?.merchant || {});
    world.council = Object.assign(base.council, saved?.council || {}, {
      proposals: Array.isArray(saved?.council?.proposals) ? saved.council.proposals : [],
      enacted: Array.isArray(saved?.council?.enacted) ? saved.council.enacted.slice(-12) : []
    });
    world.cipher = Object.assign(base.cipher, saved?.cipher || {});
    world.backend = Object.assign(base.backend, saved?.backend || {});
    ensureDailyWorld(world, context, now);
    return world;
  }

  function proposalTemplates(context, key) {
    const gold = Math.floor(Number(context.gold) || 0);
    const stage = Math.max(1, Number(context.stage) || 1);
    const population = Math.floor(Number(context.population) || 0);
    return [
      {
        id: `${key}-harvest`,
        title: "战利品回流法",
        detail: `当前库银 ${gold}。将副本与野局结算掉落提高 8%，但不追溯旧奖励。`,
        effect: { key: "dropMultiplier", delta: .08 },
        reason: "金币存量与推进成本之间出现缺口"
      },
      {
        id: `${key}-pressure`,
        title: "秘境压力校准令",
        detail: `当前主线第 ${stage} 章。怪物强度降低 6%，让低战力险胜仍保留操作空间。`,
        effect: { key: "monsterMultiplier", delta: -.06 },
        reason: "关卡成长速度高于平均人物培养速度"
      },
      {
        id: `${key}-storm`,
        title: "南移雷暴试行案",
        detail: `领地人口 ${population}。把野局雷击阵列向南移 2 个权威坐标。`,
        effect: { key: "lightningOffset", delta: 2 },
        reason: "中路交战过度集中，需要改变安全区"
      }
    ].map((proposal) => Object.assign(proposal, { yes: 0, no: 0, votes: {}, status: "active", source: "local-rule-draft" }));
  }

  function ensureDailyWorld(world, context = {}, now = Date.now()) {
    const key = dayKey(now);
    if (world.council.dayKey !== key || !world.council.proposals.length) {
      world.council.dayKey = key;
      world.council.proposals = proposalTemplates(context, key);
      world.council.activeId = world.council.proposals[hash(`${key}-active`) % world.council.proposals.length].id;
    }
    if (world.cipher.dayKey !== key) {
      world.cipher = {
        dayKey: key,
        phrase: CIPHER_PHRASES[hash(`${key}-cipher`) % CIPHER_PHRASES.length],
        location: "spire",
        claimed: false,
        reward: ""
      };
    }
    return world;
  }

  function activeProposal(world) {
    return world.council.proposals.find((proposal) => proposal.id === world.council.activeId) || world.council.proposals[0] || null;
  }

  function applyEffect(world, effect) {
    if (!effect) return;
    if (effect.key === "lightningOffset") {
      world.modifiers.lightningOffset = clamp(world.modifiers.lightningOffset + effect.delta, -9, 9);
      world.modifiers.lightningPoints = BASE_LIGHTNING_POINTS.map((point) => clamp(point + world.modifiers.lightningOffset, 8, 92));
    } else if (effect.key === "dropMultiplier") {
      world.modifiers.dropMultiplier = clamp(world.modifiers.dropMultiplier + effect.delta, .75, 1.5);
    } else if (effect.key === "monsterMultiplier") {
      world.modifiers.monsterMultiplier = clamp(world.modifiers.monsterMultiplier + effect.delta, .8, 1.45);
    }
    world.modifiers.revision += 1;
  }

  function vote(world, direction, voterId, proposalId = "", quorum = 1) {
    const proposal = world.council.proposals.find((item) => item.id === proposalId) || activeProposal(world);
    if (!proposal) return { ok: false, message: "今日没有可表决草案。" };
    if (proposal.status !== "active") return { ok: false, message: `《${proposal.title}》已经${proposal.status === "passed" ? "通过" : "否决"}。` };
    const normalized = direction === "yes" ? "yes" : direction === "no" ? "no" : "";
    if (!normalized) return { ok: false, message: "投票命令必须是 /vote yes 或 /vote no。" };
    const voter = String(voterId || "local-player");
    const previous = proposal.votes[voter];
    if (previous === normalized) return { ok: false, message: "你的这一票已经计入。" };
    if (previous) proposal[previous] = Math.max(0, proposal[previous] - 1);
    proposal.votes[voter] = normalized;
    proposal[normalized] += 1;
    let applied = false;
    if (proposal.yes >= quorum && proposal.yes > proposal.no) {
      proposal.status = "passed";
      applyEffect(world, proposal.effect);
      world.council.enacted.push({ id: proposal.id, title: proposal.title, at: Date.now(), effect: proposal.effect });
      world.council.enacted = world.council.enacted.slice(-12);
      applied = true;
    }
    return {
      ok: true,
      applied,
      proposal,
      message: applied
        ? `《${proposal.title}》以 ${proposal.yes}:${proposal.no} 通过，世界参数已立即更新。`
        : `《${proposal.title}》当前票数：赞成 ${proposal.yes}，反对 ${proposal.no}。`
    };
  }

  function normalizePhrase(value) {
    return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/[\s，。！？!?,.'"：:、\-]/g, "");
  }

  function merchantSecretMatch(source) {
    const value = normalizePhrase(source);
    return ["aurmarakatoranotari", "黄金商人科技大脑", "科技大脑一金币"].includes(value);
  }

  function merchantPositionAt(now = Date.now(), seed = 0) {
    const phase = ((now / 1000 + (seed % 97)) / 17) * Math.PI * 2;
    return {
      x: clamp(44 + Math.cos(phase) * 23 + Math.cos(phase * 2.3) * 5, 14, 78),
      y: clamp(43 + Math.sin(phase * 1.17) * 19, 17, 76)
    };
  }

  function distance(left, right) {
    return Math.hypot(Number(left.x) - Number(right.x), Number(left.y) - Number(right.y));
  }

  function cipherClue(world) {
    const phrase = world.cipher.phrase || "";
    const visible = phrase.length <= 6 ? `${phrase.slice(0, 1)}…${phrase.slice(-1)}` : `${phrase.slice(0, 2)}…${phrase.slice(-2)}`;
    return `尖塔回声：${visible}`;
  }

  function processChatCommand(world, message, context = {}) {
    const source = String(message.translation || message.content || "").trim();
    const systemMessages = [];
    const rewards = [];
    let handled = false;
    let worldChanged = false;
    if (merchantSecretMatch(source)) {
      handled = true;
      if (!world.merchant.secretUnlocked) {
        world.merchant.secretUnlocked = true;
        worldChanged = true;
        systemMessages.push("黄金商人：旧口令没失传。追上我的商队，科技大脑只收 1 金币。 ");
      } else {
        systemMessages.push("黄金商人：暗柜已经为你打开，先追上商队再谈价格。 ");
      }
    }
    const voteMatch = source.match(/^\/vote\s+(yes|no)(?:\s+([\w-]+))?$/i);
    if (voteMatch) {
      handled = true;
      const result = vote(world, voteMatch[1].toLowerCase(), message.userId || message.author, voteMatch[2] || "", context.quorum || 1);
      systemMessages.push(`法典公告栏：${result.message}`);
      worldChanged = worldChanged || result.ok;
    }
    if (!world.cipher.claimed && normalizePhrase(source) === normalizePhrase(world.cipher.phrase)) {
      handled = true;
      const player = { x: world.merchant.playerX, y: world.merchant.playerY };
      const spire = context.spire || { x: 55, y: 38 };
      if (distance(player, spire) <= 8) {
        world.cipher.claimed = true;
        world.cipher.reward = "尖塔寻码者";
        rewards.push({ type: "title", id: "spire-codebreaker", label: "尖塔寻码者" });
        systemMessages.push("生存仔：尖塔记住了你的声音。隐藏称号“尖塔寻码者”已经写入档案。 ");
        worldChanged = true;
      } else {
        systemMessages.push("生存仔：暗号是对的，但声音没有从主城尖塔脚下传来。 ");
      }
    }
    return { handled, systemMessages, rewards, worldChanged };
  }

  function patrolSchedule(now = Date.now()) {
    const key = hourKey(now);
    const seed = hash(key);
    return [8 + seed % 18, 34 + ((seed >>> 5) % 18)].map((minute, index) => ({ key: `${key}-${index}`, minute, seed: seed + index * 7919 }));
  }

  function createPatrol(world, schedule, now) {
    const persona = [ELDER_PERSONAS.golden, ELDER_PERSONAS.chestnut, ELDER_PERSONAS.survival][schedule.seed % 3];
    let message;
    let effect;
    if (persona.id === "golden") {
      const delta = schedule.seed % 2 ? 2 : -2;
      effect = { key: "lightningOffset", delta };
      applyEffect(world, effect);
      message = `我把雷击点往${delta > 0 ? "南" : "北"}移了 ${Math.abs(delta)} 格。别谢，站原地的人先学会看云。`;
    } else if (persona.id === "chestnut") {
      const delta = schedule.seed % 2 ? .03 : -.02;
      effect = { key: "dropMultiplier", delta };
      applyEffect(world, effect);
      message = `账本已核：今日掉落倍率调整为 ${world.modifiers.dropMultiplier.toFixed(2)}。多一分少一分，都要能对得上。`;
    } else {
      const delta = schedule.seed % 2 ? .03 : -.03;
      effect = { key: "monsterMultiplier", delta };
      applyEffect(world, effect);
      message = `雾里有东西换了呼吸。敌人强度现在是 ${world.modifiers.monsterMultiplier.toFixed(2)}，别把旧经验当护身符。`;
    }
    return {
      id: `elder-${schedule.key}`,
      elder: persona.id,
      author: persona.name,
      message,
      effect,
      at: now,
      prompt: persona.prompt
    };
  }

  function heartbeat(world, now = Date.now(), force = false) {
    const minute = new Date(now).getMinutes();
    const events = [];
    const schedule = patrolSchedule(now);
    for (const item of schedule) {
      if (!force && minute < item.minute) continue;
      if (world.heartbeat.processed.includes(item.key)) continue;
      const event = createPatrol(world, item, now);
      world.heartbeat.processed.push(item.key);
      world.heartbeat.history.push(event);
      events.push(event);
      if (!force) break;
    }
    world.heartbeat.lastAt = now;
    world.heartbeat.processed = world.heartbeat.processed.slice(-12);
    world.heartbeat.history = world.heartbeat.history.slice(-24);
    return events;
  }

  function makeChronicleDraft(type, data = {}, now = Date.now()) {
    const date = new Date(now);
    const stamp = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    if (type === "arena-king-first") {
      return `${stamp}，金牛一服野局有异动。主公${data.player || "无名者"}以${data.hero || "未知人物"}迎战人物之王所执${data.enemy || "大包子"}，在${Math.floor(data.elapsed || 0)}秒内守住兵线、逼退塔区，并亲手写下首次胜绩。观战者后来把那次冷却间隙称作“王冠裂响”，此战自此列入《生存纪元》。`;
    }
    return `${stamp}，${data.stage || "无名秘境"}一役，主公${data.player || "无名者"}率领战力仅${Math.floor(data.power || 0)}的队伍，挑战推荐战力${Math.floor(data.recommended || 0)}的${data.enemy || "秘境之主"}。众人几近力竭，仍在第${data.round || 1}轮完成逆转。史官据实记下：此胜非由数值碾压，而由每一次稳守与出手共同换来。`;
  }

  function registerAdapter(kind, adapter) {
    if (!Object.prototype.hasOwnProperty.call(adapters, kind)) throw new Error(`Unknown world adapter: ${kind}`);
    adapters[kind] = adapter || null;
  }

  function publishWorldEvent(event) {
    return adapters.events?.publish?.(event) || Promise.resolve({ queued: true, authority: "client-draft" });
  }

  window.WorldEcology = Object.freeze({
    version: "1.0.0",
    ELDER_PERSONAS,
    BASE_LIGHTNING_POINTS,
    adapters,
    dayKey,
    hourKey,
    defaultWorld,
    normalizeWorld,
    ensureDailyWorld,
    activeProposal,
    vote,
    processChatCommand,
    merchantSecretMatch,
    merchantPositionAt,
    distance,
    cipherClue,
    heartbeat,
    makeChronicleDraft,
    registerAdapter,
    publishWorldEvent
  });
})();
