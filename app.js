(function () {
  "use strict";

  const { heroes, stages, villages, archive } = window.GAME_DATA;
  const STORAGE_KEY = "world-online-save-v1";
  const main = document.getElementById("main-content");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");

  const ui = {
    heroFilter: "all",
    selectedHero: "egg-lord",
    selectedStage: 1,
    archiveTab: "world",
    onboardingStep: 1,
    onboardingCareer: "warrior",
    onboardingName: "",
    onboardingAnswers: {},
    giftResults: [],
    battle: null
  };

  const defaultState = () => ({
    version: 1,
    initialized: false,
    player: { name: "见习主公", career: "战士", iq: 0, level: 1, exp: 0 },
    gold: 4800,
    survival: 3200,
    energy: 80,
    maxEnergy: 80,
    population: 140000,
    troops: 2400,
    reputation: 12,
    tech: 0.00000001,
    village: 1,
    stageProgress: 0,
    finalCleared: false,
    roster: {
      "egg-lord": { level: 1, star: 1, fragments: 0 },
      "reputation-master": { level: 1, star: 1, fragments: 0 }
    },
    team: ["egg-lord", "reputation-master"],
    pity: 0,
    summons: 0,
    researchCount: 0,
    inventory: { reviveGem: 1, reviveCharges: 5, shapeshifterShard: 0, loyaltyPill: 0, spiritOrb: 0 },
    tasks: {
      battle: { progress: 0, goal: 1, claimed: false },
      summon: { progress: 0, goal: 1, claimed: false },
      research: { progress: 0, goal: 1, claimed: false }
    },
    idleClaimAt: Date.now() - 3 * 60 * 60 * 1000,
    lastSaveAt: Date.now(),
    settings: { sound: true, motion: true }
  });

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const saved = JSON.parse(raw);
      return Object.assign(defaultState(), saved, {
        player: Object.assign(defaultState().player, saved.player || {}),
        roster: Object.assign(defaultState().roster, saved.roster || {}),
        inventory: Object.assign(defaultState().inventory, saved.inventory || {}),
        tasks: Object.assign(defaultState().tasks, saved.tasks || {}),
        settings: Object.assign(defaultState().settings, saved.settings || {})
      });
    } catch (error) {
      return defaultState();
    }
  }

  function saveState() {
    state.lastSaveAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateHeader();
  }

  function icon(name, className = "") {
    return `<i data-lucide="${name}"${className ? ` class="${className}"` : ""}></i>`;
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons({ attrs: { "aria-hidden": "true" } });
  }

  function formatNumber(value) {
    if (value >= 100000000) return `${(value / 100000000).toFixed(value >= 1000000000 ? 0 : 1)}亿`;
    if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
    return Math.floor(value).toLocaleString("zh-CN");
  }

  function worldDay() {
    const start = new Date("2026-07-26T00:00:00+08:00");
    return Math.max(1, Math.floor((Date.now() - start.getTime()) / 86400000) + 1);
  }

  function updateHeader() {
    document.getElementById("world-day").textContent = worldDay();
    document.getElementById("gold-value").textContent = formatNumber(state.gold);
    document.getElementById("survival-value").textContent = formatNumber(state.survival);
    document.getElementById("energy-value").textContent = `${Math.floor(state.energy)}/${state.maxEnergy}`;
    document.getElementById("profile-level").textContent = `Lv.${state.player.level}`;
    document.getElementById("profile-avatar").textContent = state.player.name.slice(0, 1) || "主";
  }

  function getHero(id) {
    return heroes.find((hero) => hero.id === id);
  }

  function heroData(id) {
    return state.roster[id] || { level: 1, star: 0, fragments: 0 };
  }

  function heroPower(id) {
    const hero = getHero(id);
    if (!hero || !state.roster[id]) return 0;
    const owned = heroData(id);
    const levelScale = 1 + (owned.level - 1) * 0.11;
    const starScale = 1 + (owned.star - 1) * 0.19;
    const reputationScale = id === "reputation-master" ? 1 + state.reputation / 100 : 1;
    return Math.floor((hero.baseAtk * 2 + hero.baseHp * .38 + hero.baseDef) * levelScale * starScale * reputationScale);
  }

  function teamPower() {
    return state.team.reduce((total, id) => total + heroPower(id), 0);
  }

  function rarityColor(rarity) {
    return { R: "#7a8985", SR: "#3a7d72", SSR: "#b2762f", UR: "#9d4c43" }[rarity] || "#7a8985";
  }

  function roleIcon(role) {
    return { "守御": "shield", "辅助": "heart-handshake", "突击": "sword", "谋略": "brain", "术法": "wand-sparkles", "狂战": "flame", "猎手": "crosshair", "规则": "scale" }[role] || "sparkles";
  }

  function portraitSvg(heroLike) {
    const hero = heroLike || { name: "未知", color: "#586763", accent: "#dce4e1", shape: "mask" };
    const symbols = {
      egg: '<ellipse cx="50" cy="49" rx="24" ry="29" fill="var(--accent)"/><path d="M35 49c8-7 22-7 30 0" stroke="var(--color)" stroke-width="5" stroke-linecap="round"/><circle cx="43" cy="43" r="3" fill="#1d2725"/><circle cx="57" cy="43" r="3" fill="#1d2725"/>',
      crown: '<path d="M27 43l8-19 15 13 15-13 8 19-5 28H32l-5-28Z" fill="var(--accent)"/><circle cx="50" cy="50" r="17" fill="var(--color)"/><path d="M42 54c5 4 11 4 16 0" stroke="white" stroke-width="3" stroke-linecap="round"/>',
      bun: '<circle cx="39" cy="46" r="18" fill="var(--accent)"/><circle cx="60" cy="46" r="18" fill="var(--accent)"/><ellipse cx="50" cy="58" rx="25" ry="22" fill="var(--accent)"/><path d="M36 41c8 8 20 8 28 0M42 59h16" stroke="var(--color)" stroke-width="3" stroke-linecap="round"/>',
      sword: '<circle cx="50" cy="39" r="18" fill="var(--accent)"/><path d="M30 81c2-22 10-31 20-31s18 9 20 31H30Z" fill="var(--color)"/><path d="M72 23 38 69m2-37 23 23" stroke="white" stroke-width="4" stroke-linecap="round"/>',
      cube: '<path d="m50 19 27 15v32L50 82 23 66V34l27-15Z" fill="var(--color)"/><path d="m50 19 27 15-27 16-27-16 27-15Zm0 31v32" fill="none" stroke="var(--accent)" stroke-width="3"/><path d="m38 29 6-11 6 8 7-9 6 12" stroke="#f6d68f" stroke-width="3"/>',
      hood: '<path d="M22 77c3-39 12-57 28-57s25 18 28 57H22Z" fill="var(--color)"/><path d="M34 50c1-14 7-21 16-21s15 7 16 21c-6 9-26 9-32 0Z" fill="#17211f"/><circle cx="43" cy="46" r="3" fill="var(--accent)"/><circle cx="57" cy="46" r="3" fill="var(--accent)"/>',
      tusk: '<circle cx="50" cy="47" r="25" fill="var(--accent)"/><path d="M25 77c5-15 13-23 25-23s20 8 25 23" fill="var(--color)"/><path d="M35 49 27 61m38-12 8 12" stroke="white" stroke-width="5" stroke-linecap="round"/><circle cx="42" cy="41" r="3" fill="#1d2725"/><circle cx="58" cy="41" r="3" fill="#1d2725"/>',
      sunset: '<circle cx="63" cy="31" r="17" fill="#e1a24e" opacity=".8"/><path d="M31 77c2-37 7-54 20-54s19 17 22 54H31Z" fill="var(--color)"/><path d="m65 18-30 63M29 34l43 30" stroke="var(--accent)" stroke-width="4"/><circle cx="50" cy="38" r="12" fill="#e3c4af"/>',
      mask: '<path d="M29 25c12-10 30-10 42 0l-4 39-17 17-17-17-4-39Z" fill="var(--color)"/><path d="m35 37 12 7-11 6m29-13-12 7 11 6M43 62h14" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/>',
      dragon: '<path d="M19 67c14-8 12-27 6-42 13 1 22 8 25 20 3-12 12-19 25-20-6 15-8 34 6 42-9 11-19 16-31 16S28 78 19 67Z" fill="var(--color)"/><path d="M39 51c6-8 16-8 22 0l-4 19H43l-4-19Z" fill="var(--accent)"/><circle cx="45" cy="54" r="2"/><circle cx="55" cy="54" r="2"/>',
      tea: '<circle cx="50" cy="35" r="18" fill="var(--accent)"/><path d="M28 78c4-23 10-33 22-33s18 10 22 33H28Z" fill="var(--color)"/><path d="M24 66h31v9H29c-3 0-5-4-5-9Zm31 2h8c9 0 9 11 0 11h-5" fill="var(--accent)"/><path d="M39 29c3-6 8-6 11 0 3-6 8-6 11 0" fill="none" stroke="var(--color)" stroke-width="3"/>',
      queen: '<path d="m31 34 6-18 13 11 13-11 6 18" fill="var(--accent)"/><circle cx="50" cy="43" r="18" fill="#e9c2b4"/><path d="M24 82c4-25 13-34 26-34s22 9 26 34H24Z" fill="var(--color)"/><path d="M43 45c5 4 9 4 14 0" stroke="white" stroke-width="3" stroke-linecap="round"/>',
      soldier: '<path d="M25 37 50 17l25 20-8 45H33l-8-45Z" fill="var(--color)"/><path d="M31 40h38M39 50h22" stroke="var(--accent)" stroke-width="4"/><path d="M17 78 43 52m40 26L57 52" stroke="#e8e6dc" stroke-width="5"/>',
      king: '<circle cx="50" cy="48" r="27" fill="var(--color)"/><path d="m23 32 9-21 18 15 18-15 9 21" fill="var(--accent)"/><path d="M25 81c6-20 14-29 25-29s19 9 25 29H25Z" fill="#101715"/><path d="M36 44h28M42 56h16" stroke="var(--accent)" stroke-width="4"/>'
    };
    const drawing = symbols[hero.shape] || symbols.mask;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="--color:${hero.color};--accent:${hero.accent || "#e4ebe8"}"><rect width="100" height="100" fill="${hero.color}"/><circle cx="50" cy="50" r="43" fill="white" opacity=".1"/><path d="M0 78 100 33v67H0Z" fill="#101715" opacity=".17"/>${drawing}</svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function portrait(hero, sizeClass = "") {
    return `<span class="portrait ${sizeClass}"><img src="${portraitSvg(hero)}" alt="${hero.name}人物图"><span class="rarity">${hero.rarity || "BOSS"}</span></span>`;
  }

  function stars(count) {
    return `<span class="stars" aria-label="${count}星">${"◆".repeat(count)}${"◇".repeat(Math.max(0, 7 - count))}</span>`;
  }

  function currentRoute() {
    const route = (location.hash || "#home").slice(1).split("?")[0];
    return ["home", "campaign", "heroes", "summon", "archives"].includes(route) ? route : "home";
  }

  function setRoute(route) {
    location.hash = route;
    document.body.classList.remove("menu-open");
  }

  function updateNavigation(route) {
    document.querySelectorAll("[data-route]").forEach((link) => {
      link.classList.toggle("active", link.dataset.route === route);
    });
  }

  function render() {
    const route = currentRoute();
    updateNavigation(route);
    if (route === "home") renderHome();
    if (route === "campaign") renderCampaign();
    if (route === "heroes") renderHeroes();
    if (route === "summon") renderSummon();
    if (route === "archives") renderArchives();
    updateHeader();
    refreshIcons();
  }

  function pageHead(eyebrow, title, description, actions = "") {
    return `<header class="page-head"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="head-actions">${actions}</div>` : ""}</header>`;
  }

  function taskRow(key, title, description, reward) {
    const task = state.tasks[key];
    const done = task.progress >= task.goal;
    return `<div class="task-row">
      <span class="task-check">${icon(done ? "check" : "circle-dashed")}</span>
      <div><strong>${title}</strong><small>${description} · ${Math.min(task.progress, task.goal)}/${task.goal}</small></div>
      <button class="button small ${done && !task.claimed ? "primary" : ""}" data-action="claim-task" data-task="${key}" ${!done || task.claimed ? "disabled" : ""}>${task.claimed ? "已领取" : `领 ${reward}`}</button>
    </div>`;
  }

  function miniTeam() {
    return state.team.map((id) => {
      const hero = getHero(id);
      return `<div class="team-mini">${portrait(hero)}<strong>${hero.name}</strong></div>`;
    }).join("") + Array.from({ length: Math.max(0, 3 - state.team.length) }, () => `<button class="team-mini" data-action="go-heroes">${icon("plus")}<strong>空位</strong></button>`).join("");
  }

  function canPromote() {
    if (state.village >= 9) return false;
    if (state.village === 8) return state.finalCleared;
    return state.stageProgress >= state.village;
  }

  function nextPromotionText() {
    if (state.village >= 9) return "已进入通关村";
    if (state.village === 8) return "击败人物之王后晋升";
    return `通关第 ${state.village} 章后晋升`;
  }

  function renderHome() {
    const promotion = canPromote();
    const currentVillage = villages[state.village];
    const nextVillage = villages[Math.min(9, state.village + 1)];
    main.innerHTML = `<section class="page home-page">
      ${pageHead("领地总览", `${state.player.name}的主城`, `${currentVillage} · 新手保护第 1 日 · 当前天气：薄雾`, `<button class="button" data-action="share-game">${icon("share-2")}<span>分享游戏</span></button><button class="button" data-action="open-profile">${icon("scroll-text")}<span>主公档案</span></button><button class="button primary" data-action="go-campaign">${icon("swords")}<span>继续主线</span></button>`)}
      <div class="home-grid">
        <div class="home-main">
          <section class="panel world-map" aria-label="领地地图">
            <div class="map-bar"><div class="map-title"><strong>龙城北境 · 领地 07</strong><small>领土稳定，未检测到玩家入侵</small></div><div class="weather-chip">${icon("cloud-sun")} 薄雾 18°C</div></div>
            <button class="map-node merchant" style="left:23%;top:28%" data-action="merchant"><span class="node-icon">${icon("store")}</span><strong>黄金商人</strong><small>停留 13:24</small></button>
            <button class="map-node main-city" style="left:43%;top:50%" data-action="open-profile"><span class="node-icon">${icon("castle")}</span><strong>${state.player.name}的主城</strong><small>保护中</small></button>
            <button class="map-node battle" style="left:71%;top:34%" data-action="go-campaign"><span class="node-icon">${icon("swords")}</span><strong>${stages[Math.min(state.stageProgress, 8)].name}</strong><small>主线可挑战</small></button>
            <button class="map-node ${state.stageProgress < 2 ? "locked" : ""}" style="left:78%;top:72%" data-action="archive-faction"><span class="node-icon">${icon("landmark")}</span><strong>霞踪遗迹</strong><small>${state.stageProgress < 2 ? "尚未探明" : "可调查"}</small></button>
            <div class="map-alert"><span class="alert-icon">${icon("cloud-lightning")}</span><div><strong>天降狂雷预警</strong><small>北境将在 02:48 后出现雷区，无视防御扣除 20% 生命</small></div><button class="button small" data-action="dismiss-alert">${icon("map-pin")}<span>查看位置</span></button></div>
          </section>
          <div class="stats-row">
            <div class="stat-tile"><span class="stat-icon">${icon("users")}</span><div><small>领地人口</small><strong>${formatNumber(state.population)}</strong></div></div>
            <div class="stat-tile"><span class="stat-icon gold">${icon("shield")}</span><div><small>可用兵力</small><strong>${formatNumber(state.troops)}</strong></div></div>
            <div class="stat-tile"><span class="stat-icon blue">${icon("microscope")}</span><div><small>科技指数</small><strong>${state.tech < .001 ? state.tech.toFixed(8) : state.tech.toFixed(4)}</strong></div></div>
            <div class="stat-tile"><span class="stat-icon red">${icon("flag")}</span><div><small>村落声望</small><strong>${state.reputation}</strong></div></div>
          </div>
          <section class="panel">
            <div class="panel-head"><div><h2>今日委托</h2><p>服务器每日 05:00 刷新</p></div><span class="tag teal">完成 ${Object.values(state.tasks).filter((task) => task.claimed).length}/3</span></div>
            <div class="task-list">
              ${taskRow("battle", "完成一次个人副本", "任意主线副本", "500 金币")}
              ${taskRow("summon", "召唤一位人物", "单次或十连均可", "200 生存币")}
              ${taskRow("research", "推进一次科技研发", "主城研究所", "300 金币")}
            </div>
          </section>
        </div>
        <aside class="home-rail">
          <section class="panel">
            <div class="panel-head"><div><h2>出战队伍</h2><p>三人编队</p></div><button class="text-button" data-action="go-heroes">调整</button></div>
            <div class="panel-body"><div class="team-line">${miniTeam()}</div><div class="team-power"><span class="muted">总战力</span><strong>${formatNumber(teamPower())}</strong></div></div>
          </section>
          <section class="panel">
            <div class="panel-head"><div><h2>村落晋升</h2><p>${currentVillage} → ${nextVillage}</p></div>${icon("chevrons-up")}</div>
            <div class="panel-body">
              <div class="progress" style="--value:${state.village / 9 * 100}%"><span></span></div>
              <p style="margin:10px 0 13px;font-size:10px;color:var(--ink-faint)">${nextPromotionText()}</p>
              <button class="button wide ${promotion ? "gold" : ""}" data-action="promote" ${promotion ? "" : "disabled"}>${icon("badge-up")} ${promotion ? `晋升${nextVillage}` : "条件未达成"}</button>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><div><h2>研究所</h2><p>原料储备：充足</p></div><span class="tag">Lv.${state.researchCount + 1}</span></div>
            <div class="panel-body">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><strong style="font-size:11px">聚落基础技术</strong><small style="display:block;margin-top:3px;color:var(--ink-faint);font-size:9px">提升人口与兵力生产</small></div>${icon("flask-conical")}</div>
              <button class="button wide" data-action="research" ${state.gold < 800 ? "disabled" : ""}>${icon("hammer")} 研发 · 800 金币</button>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><div><h2>服务器事件</h2><p>金牛一服</p></div><span class="status-dot"></span></div>
            <div class="panel-body" style="padding-top:6px;padding-bottom:6px">
              <div class="event-list">
                <div class="event-row"><span class="event-time">19:00</span><div><strong>经验泡点</strong><small>双倍经验区开放</small></div><span class="event-state">今晚</span></div>
                <div class="event-row"><span class="event-time">周六</span><div><strong>天降首领</strong><small>将降临主城外环</small></div><span class="event-state">预告</span></div>
                <div class="event-row"><span class="event-time">进行中</span><div><strong>黄金商人</strong><small>出现在领地西北</small></div><span class="event-state">13:24</span></div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>`;
  }

  function heroCard(hero) {
    const owned = state.roster[hero.id];
    const inTeam = state.team.indexOf(hero.id);
    if (!owned) return `<button class="hero-card locked" data-hero="${hero.id}">
      <div class="hero-card-top">${portrait(hero)}<div style="min-width:0"><h3>？？？</h3><div class="hero-meta">${hero.role} · 尚未获得</div></div></div>
      <div class="hero-card-stats"><span>${hero.rarity}</span><span>${icon("lock")}</span></div>
    </button>`;
    return `<button class="hero-card ${ui.selectedHero === hero.id ? "selected" : ""}" data-hero="${hero.id}">
      ${inTeam >= 0 ? `<span class="team-badge">${inTeam + 1}</span>` : ""}
      <div class="hero-card-top">${portrait(hero)}<div style="min-width:0"><h3>${hero.name}</h3><div class="hero-meta">Lv.${owned.level} · ${hero.role}</div>${stars(owned.star)}</div></div>
      <div class="hero-card-stats"><span>战力 <strong>${formatNumber(heroPower(hero.id))}</strong></span><span>${hero.faction}</span></div>
    </button>`;
  }

  function heroDetail(hero) {
    const owned = state.roster[hero.id];
    if (!owned) return `<aside class="panel hero-detail"><div class="detail-banner">${portrait(hero)}<div class="detail-title"><h2>身份未解锁</h2><p>${hero.rarity} · ${hero.role}</p></div></div><div class="detail-body"><p style="font-size:10px;line-height:1.7;color:var(--ink-faint)">在人物召唤或限定事件中获得后，才能查看完整档案与技能。</p><button class="button wide primary" data-action="go-summon">${icon("sparkles")} 前往召唤</button></div></aside>`;
    const hp = Math.floor(hero.baseHp * (1 + (owned.level - 1) * .11) * (1 + (owned.star - 1) * .19));
    const atk = Math.floor(hero.baseAtk * (1 + (owned.level - 1) * .11) * (1 + (owned.star - 1) * .19));
    const teamIndex = state.team.indexOf(hero.id);
    return `<aside class="panel hero-detail">
      <div class="detail-banner">${portrait(hero)}<div class="detail-title"><h2>${hero.name}</h2><p>${hero.rarity} · ${hero.role} · ${hero.faction}</p>${stars(owned.star)}</div></div>
      <div class="detail-body">
        <div class="detail-stats"><div class="detail-stat"><small>战力</small><strong>${formatNumber(heroPower(hero.id))}</strong></div><div class="detail-stat"><small>攻击</small><strong>${formatNumber(atk)}</strong></div><div class="detail-stat"><small>生命</small><strong>${formatNumber(hp)}</strong></div></div>
        <p style="margin:13px 0 0;font-size:9px;line-height:1.7;color:var(--ink-soft)">${hero.lore}</p>
        <div class="skill-list">
          <div class="skill-row"><strong>${hero.skills[0]} · 小招</strong><span>造成 100% 攻击伤害，并恢复 18 点气。</span></div>
          <div class="skill-row"><strong>${hero.skills[1]} · 战技</strong><span>消耗 25 点气，造成 170% 攻击伤害。</span></div>
          <div class="skill-row"><strong>${hero.skills[2]} · 必杀</strong><span>消耗 80 点气，造成 320% 攻击伤害。</span></div>
        </div>
        <div class="detail-actions"><button class="button ${teamIndex < 0 ? "primary" : "danger"}" data-action="toggle-team" data-hero-id="${hero.id}">${icon(teamIndex < 0 ? "user-plus" : "user-minus")} ${teamIndex < 0 ? "加入编队" : "移出编队"}</button><button class="button" data-action="level-hero" data-hero-id="${hero.id}" ${state.gold < owned.level * 500 || hero.id === "reputation-master" ? "disabled" : ""}>${icon("arrow-up")} 升级 ${owned.level * 500}</button></div>
      </div>
    </aside>`;
  }

  function renderHeroes() {
    const filters = ["all", "守御", "突击", "术法", "辅助", "谋略", "狂战", "猎手", "规则"];
    const shown = heroes.filter((hero) => ui.heroFilter === "all" || hero.role === ui.heroFilter);
    const selected = getHero(ui.selectedHero) || heroes[0];
    main.innerHTML = `<section class="page">
      ${pageHead("人物管理", "人物阵容", `已获得 ${Object.keys(state.roster).length}/${heroes.length} · 出战 ${state.team.length}/3`, `<button class="button" data-action="go-summon">${icon("sparkles")}<span>召唤人物</span></button>`)}
      <div class="filter-bar panel">${filters.map((filter) => `<button class="filter-chip ${ui.heroFilter === filter ? "active" : ""}" data-filter="${filter}">${filter === "all" ? "全部" : filter}</button>`).join("")}</div>
      <div class="heroes-layout" style="margin-top:14px"><div class="hero-grid">${shown.map(heroCard).join("")}</div>${heroDetail(selected)}</div>
    </section>`;
  }

  const stagePositions = [[10,82],[25,67],[18,43],[38,29],[52,48],[67,31],[82,48],[73,73],[91,18]];

  function stageLineup() {
    return state.team.map((id) => {
      const hero = getHero(id);
      return `<div class="lineup-slot">${portrait(hero)}<strong>${hero.name}</strong></div>`;
    }).join("") + Array.from({ length: Math.max(0, 3 - state.team.length) }, () => `<button class="lineup-slot" data-action="go-heroes">${icon("plus")}<strong>选择人物</strong></button>`).join("");
  }

  function stageDetail(stage) {
    const unlocked = stage.id <= state.stageProgress + 1;
    const completed = stage.id <= state.stageProgress || (stage.id === 9 && state.finalCleared);
    return `<aside class="panel stage-detail">
      <div class="stage-art"><div><span class="tag ${stage.type === "普通" ? "teal" : "red"}">${stage.type}</span><h2 style="margin-top:9px">${stage.id}. ${stage.name}</h2><p>${stage.subtitle} · ${stage.enemy}</p></div></div>
      <div class="stage-info">
        <div class="recommended"><span class="muted">建议战力</span><strong style="color:${teamPower() >= stage.recommended ? "var(--teal)" : "var(--red)"}">${formatNumber(stage.recommended)}</strong></div>
        <p style="margin:0 0 12px;color:var(--ink-soft);font-size:9px;line-height:1.7">${stage.note}</p>
        <p class="section-label">首通奖励</p><div class="reward-line"><span class="reward-item">${icon("coins")} ${formatNumber(stage.gold)}</span><span class="reward-item">${icon("gem")} ${stage.survival}</span><span class="reward-item">${icon("sparkles")} ${stage.exp} 经验</span></div>
        <div class="lineup"><div class="lineup-head"><span class="muted">出战队伍</span><strong>${formatNumber(teamPower())}</strong></div><div class="lineup-slots">${stageLineup()}</div></div>
        <button class="button wide primary" data-action="start-battle" data-stage-id="${stage.id}" ${!unlocked || state.team.length === 0 || state.energy < stage.energy ? "disabled" : ""}>${icon(completed ? "rotate-cw" : "swords")} ${completed ? "再次讨伐" : "开始讨伐"} · ${stage.energy} 行动力</button>
      </div>
    </aside>`;
  }

  function renderCampaign() {
    const selected = stages.find((stage) => stage.id === ui.selectedStage) || stages[0];
    main.innerHTML = `<section class="page">
      ${pageHead("主线征战", "生存纪元", `第 ${Math.min(state.stageProgress + 1, 9)} 章 · ${villages[state.village]} · 主线完成 ${state.stageProgress}/9`, `<button class="button" data-action="go-heroes">${icon("users")}<span>调整编队</span></button>`)}
      <div class="campaign-layout">
        <section class="panel stage-map">
          <svg class="stage-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M10 82 C17 76,20 72,25 67 S16 50,18 43 S31 30,38 29 S45 42,52 48 S60 36,67 31 S76 39,82 48 S78 65,73 73 S84 41,91 18" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="1.4" stroke-dasharray="1.6 1.6" vector-effect="non-scaling-stroke"/></svg>
          <div class="stage-list">${stages.map((stage, index) => {
            const unlocked = stage.id <= state.stageProgress + 1;
            const completed = stage.id <= state.stageProgress || (stage.id === 9 && state.finalCleared);
            const [left, top] = stagePositions[index];
            return `<button class="stage-node ${completed ? "completed" : ""} ${stage.type === "首领" || stage.type === "终局" ? "boss" : ""} ${unlocked ? "" : "locked"}" style="left:${left}%;top:${top}%" data-stage="${stage.id}" ${unlocked ? "" : "disabled"}><span class="stage-icon">${icon(completed ? "check" : unlocked ? (stage.type === "普通" ? "flag" : "skull") : "lock")}</span><strong>${stage.id}. ${stage.name}</strong><small>${completed ? "已通关" : unlocked ? formatNumber(stage.recommended) : "未解锁"}</small></button>`;
          }).join("")}</div>
        </section>
        ${stageDetail(selected)}
      </div>
    </section>`;
  }

  function renderSummon() {
    const featured = heroes.filter((hero) => ["sunset-steward", "taylo-ming", "tea-weakened", "big-bun"].includes(hero.id));
    main.innerHTML = `<section class="page">
      ${pageHead("人物召唤", "服务器征募令", "完整人物直接加入阵容；重复人物自动升星", `<button class="button" data-action="summon-history">${icon("history")}<span>召唤规则</span></button>`)}
      <div class="summon-layout">
        <section class="panel summon-banner">
          <div class="summon-rings"></div><div class="summon-figure"><div class="figure-head"></div><div class="figure-body"></div></div>
          <div class="summon-copy"><span class="tag gold">本期征募 · 霞踪回响</span><h1 style="margin-top:12px">落日之后，仍有回声</h1><p>夕阳总管、泰洛冥获得概率提升。七十次内必得 SSR 或以上人物，十连至少获得一位 SR。</p>
            <div class="summon-actions"><button class="button" data-action="summon" data-count="1" ${state.survival < 200 ? "disabled" : ""}>${icon("sparkle")} 召唤一次 · 200</button><button class="button gold" data-action="summon" data-count="10" ${state.survival < 1800 ? "disabled" : ""}>${icon("sparkles")} 召唤十次 · 1800</button></div>
            <div class="pity"><div class="pity-label"><span>SSR 保底进度</span><strong>${state.pity}/70</strong></div><div class="progress" style="--value:${state.pity / 70 * 100}%"><span></span></div></div>
          </div>
        </section>
        <aside class="panel"><div class="panel-head"><div><h2>概率提升</h2><p>本期人物详情</p></div><span class="tag">剩余 6 日</span></div><div class="panel-body"><div class="pool-list">${featured.map((hero) => `<div class="pool-hero">${portrait(hero)}<div><strong>${hero.name}</strong><small>${hero.rarity} · ${hero.role}</small></div><span class="rate">${hero.rarity === "UR" ? ".5%" : hero.rarity === "SSR" ? "4.5%" : "18%"}</span></div>`).join("")}</div><div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line);font-size:9px;line-height:1.8;color:var(--ink-faint)">R 级 60% · SR 级 30% · SSR 级 9% · UR 级 1%。本期概率提升不会让开局队伍直接跨越多个村级。</div></div></aside>
      </div>
    </section>`;
  }

  function renderArchives() {
    const tabs = [["world", "globe-2", "世界架构"], ["characters", "users", "人物系统"], ["nation", "landmark", "国家经营"], ["factions", "flag", "阵营活动"], ["rules", "scale", "法律裁决"]];
    const lore = archive[ui.archiveTab];
    main.innerHTML = `<section class="page">
      ${pageHead("世界档案", "生存纪元", "由服务器之星持续校订的公开设定", `<span class="tag gold">馆藏版本 26.7</span>`)}
      <div class="archive-layout"><nav class="panel archive-nav" aria-label="档案分类">${tabs.map(([id, iconName, label]) => `<button class="archive-tab ${ui.archiveTab === id ? "active" : ""}" data-archive="${id}">${icon(iconName)} ${label}</button>`).join("")}</nav>
      <article class="panel lore-page"><span class="eyebrow">Archive / ${ui.archiveTab}</span><h1>${lore.title}</h1><p class="lead">${lore.lead}</p><div class="lore-facts">${lore.facts.map(([title, text]) => `<div class="fact"><strong>${title}</strong><span>${text}</span></div>`).join("")}</div><div class="lore-sections">${lore.sections.map(([title, text]) => `<section class="lore-section"><h2>${title}</h2><p>${text}</p></section>`).join("")}</div></article></div>
    </section>`;
  }

  function showModal(content, className = "") {
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal ${className}" role="dialog" aria-modal="true">${content}</section></div>`;
    refreshIcons();
  }

  function closeModal() {
    modalRoot.innerHTML = "";
    ui.battle = null;
  }

  function modalShell(title, body, foot = "", className = "") {
    return `<div class="modal-head"><h2>${title}</h2><button class="modal-close" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}`;
  }

  function toast(message, iconName = "circle-check") {
    const element = document.createElement("div");
    element.className = "toast";
    element.innerHTML = `${icon(iconName)}<span>${message}</span>`;
    toastRoot.appendChild(element);
    refreshIcons();
    setTimeout(() => element.remove(), 3200);
  }

  function showOnboarding() {
    if (state.initialized) return;
    const stepDots = `<div class="step-indicator"><span class="${ui.onboardingStep >= 1 ? "active" : ""}"></span><span class="${ui.onboardingStep >= 2 ? "active" : ""}"></span><span class="${ui.onboardingStep >= 3 ? "active" : ""}"></span></div>`;
    let body = "";
    let foot = "";
    if (ui.onboardingStep === 1) {
      const careers = [["warrior", "swords", "战士", "稳定攻防"], ["mage", "wand-sparkles", "法师", "高额术法"], ["taoist", "sparkles", "道士", "恢复增益"], ["archer", "crosshair", "弓箭手", "连续输出"]];
      body = `${stepDots}<div class="field"><label for="lord-name">主公名号</label><input id="lord-name" maxlength="8" value="${ui.onboardingName}" placeholder="输入 2-8 个字"></div><p class="section-label" style="margin-top:18px">选择职业</p><div class="career-grid">${careers.map(([id, iconName, name, note]) => `<button class="career-card ${ui.onboardingCareer === id ? "selected" : ""}" data-career="${id}">${icon(iconName)}<strong>${name}</strong><small>${note}</small></button>`).join("")}</div>`;
      foot = `<button class="button primary" data-action="onboarding-next">进入规则测试 ${icon("arrow-right")}</button>`;
    } else if (ui.onboardingStep === 2) {
      const questions = [
        ["q1", "和平状态下反复击杀无恶意玩家会怎样？", ["获得额外奖励", "可能被判定红名", "自动加入叛军"], 1],
        ["q2", "复活宝石每次复活会消耗什么？", ["一格能量", "全部金币", "一个人物"], 0],
        ["q3", "通关村承认的最终条件是什么？", ["充值高级特权", "收服黄金商人", "击败人物之王"], 2]
      ];
      const answeredCount = questions.filter(([id]) => ui.onboardingAnswers[id] !== undefined).length;
      body = `${stepDots}<div class="quiz-progress"><div class="quiz-progress-head"><span>作答进度</span><strong id="quiz-progress-count">已作答 ${answeredCount}/3</strong></div><div class="progress" id="quiz-progress-bar" style="--value:${answeredCount / 3 * 100}%"><span></span></div></div><div class="quiz-list">${questions.map(([id, question, options], questionIndex) => `<section class="quiz-item ${ui.onboardingAnswers[id] !== undefined ? "answered" : ""}" data-question-id="${id}"><h3>${questionIndex + 1}. ${question}</h3><div class="quiz-options">${options.map((option, index) => `<label class="quiz-option"><input type="radio" name="${id}" value="${index}" ${String(ui.onboardingAnswers[id]) === String(index) ? "checked" : ""}>${option}</label>`).join("")}</div></section>`).join("")}</div>`;
      foot = `<button class="button ghost" data-action="onboarding-back">返回</button><button class="button primary" data-action="submit-quiz">提交答案 ${icon("file-check")}</button>`;
    } else {
      body = `${stepDots}<div class="scan-box"><div><div class="scan-ring"><strong>${state.player.iq || "..."}</strong></div><p>${state.player.iq ? "无限量表扫描完成 · 仅影响游戏内提示" : "正在读取游戏内决策样本"}</p></div></div>${ui.giftResults.length ? `<div style="margin-top:18px"><p class="section-label">开局礼包 · 五位完整人物</p><div class="summon-result-grid">${ui.giftResults.map(resultCard).join("")}</div></div>` : ""}`;
      foot = ui.giftResults.length ? `<button class="button primary" data-action="enter-world">进入世界 ${icon("arrow-right")}</button>` : `<button class="button gold" data-action="scan-and-gift">${icon("scan-face")} 完成扫描并领取礼包</button>`;
    }
    const subtitle = ["建立主公档案", "银牛仔规则测试 · 3 题体验版", "IQ 扫描与开局礼包"][ui.onboardingStep - 1];
    modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal onboarding" role="dialog" aria-modal="true"><div class="onboarding-top"><span class="brand-mark">世</span><h1>欢迎进入《世界 Online》</h1><p>${subtitle}</p></div><div class="onboarding-body">${body}</div><div class="modal-foot">${foot}</div></section></div>`;
    refreshIcons();
  }

  function getRarityRoll(forceSr = false) {
    if (forceSr) {
      const roll = Math.random() * 40;
      return roll < 1 ? "UR" : roll < 10 ? "SSR" : "SR";
    }
    const roll = Math.random() * 100;
    return roll < 1 ? "UR" : roll < 10 ? "SSR" : roll < 40 ? "SR" : "R";
  }

  function drawHero(rarity, onboarding = false) {
    let pool = heroes.filter((hero) => hero.rarity === rarity);
    if (onboarding) pool = pool.filter((hero) => hero.id !== "tea-weakened" && hero.id !== "sunset-steward");
    if (!pool.length) pool = heroes.filter((hero) => hero.rarity === "R");
    if (!onboarding && rarity === "SSR" && Math.random() < .55) pool = pool.filter((hero) => ["sunset-steward", "taylo-ming"].includes(hero.id));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function addHero(hero) {
    const current = state.roster[hero.id];
    if (!current) {
      state.roster[hero.id] = { level: 1, star: 1, fragments: 0 };
      return { hero, duplicate: false, star: 1 };
    }
    if (current.star < 7) {
      current.star += 1;
      return { hero, duplicate: true, star: current.star };
    }
    current.fragments += 80;
    return { hero, duplicate: true, star: 7, burned: true };
  }

  function performSummon(count, onboarding = false) {
    const results = [];
    let hasHigh = false;
    for (let index = 0; index < count; index += 1) {
      const forcePity = !onboarding && state.pity >= 69;
      const forceSr = count >= 5 && index === count - 1 && !hasHigh;
      let rarity = forcePity ? (Math.random() < .08 ? "UR" : "SSR") : getRarityRoll(forceSr);
      if (onboarding && rarity === "UR") rarity = "SR";
      if (onboarding && rarity === "SSR" && hasHigh) rarity = "SR";
      const hero = drawHero(rarity, onboarding);
      const result = addHero(hero);
      results.push(result);
      if (["SR", "SSR", "UR"].includes(rarity)) hasHigh = true;
      if (!onboarding) state.pity = ["SSR", "UR"].includes(rarity) ? 0 : state.pity + 1;
    }
    if (onboarding) {
      const unique = [];
      for (const result of results) {
        if (!unique.some((item) => item.hero.id === result.hero.id)) unique.push(result);
      }
      while (unique.length < 5) {
        const candidates = heroes.filter((hero) => ["R", "SR"].includes(hero.rarity) && !state.roster[hero.id]);
        if (!candidates.length) break;
        unique.push(addHero(candidates[Math.floor(Math.random() * candidates.length)]));
      }
      return unique.slice(0, 5);
    }
    return results;
  }

  function resultCard(result, index = 0) {
    return `<div class="result-card" style="--rarity-color:${rarityColor(result.hero.rarity)};animation-delay:${index * 55}ms">${portrait(result.hero)}<strong>${result.hero.name}</strong><small>${result.duplicate ? result.burned ? "满星 · 转为碎片" : `重复 · 升至 ${result.star} 星` : `${result.hero.rarity} · 新人物`}</small></div>`;
  }

  function showSummonResults(results, title = "召唤结果") {
    showModal(modalShell(title, `<div class="summon-result-grid">${results.map(resultCard).join("")}</div>`, `<button class="button primary" data-action="close-modal">收入阵容</button>`), "large");
  }

  function doSummon(count) {
    const cost = count === 10 ? 1800 : 200;
    if (state.survival < cost) return toast("生存币不足", "circle-alert");
    state.survival -= cost;
    state.summons += count;
    state.tasks.summon.progress = Math.max(state.tasks.summon.progress, 1);
    const results = performSummon(count);
    if (state.team.length < 3) {
      const newHero = results.find((result) => !state.team.includes(result.hero.id));
      if (newHero) state.team.push(newHero.hero.id);
    }
    saveState();
    render();
    showSummonResults(results);
  }

  function showProfile() {
    const nextLevelExp = state.player.level * 1000;
    const body = `<div style="display:grid;grid-template-columns:90px 1fr;gap:16px;align-items:center"><span class="profile-avatar" style="width:86px;height:86px;font-size:30px">${state.player.name.slice(0,1)}</span><div><span class="tag gold">${villages[state.village]}</span><h2 style="margin:9px 0 4px;font-size:18px">${state.player.name}</h2><p style="margin:0;color:var(--ink-faint);font-size:10px">${state.player.career} · 游戏 IQ ${state.player.iq || "未扫描"} · Lv.${state.player.level}</p><div class="progress" style="margin-top:10px;--value:${Math.min(100,state.player.exp / nextLevelExp * 100)}%"><span></span></div><small style="display:block;margin-top:4px;color:var(--ink-faint)">${state.player.exp}/${nextLevelExp} 经验</small></div></div><div class="detail-stats" style="margin-top:18px"><div class="detail-stat"><small>队伍战力</small><strong>${formatNumber(teamPower())}</strong></div><div class="detail-stat"><small>人物</small><strong>${Object.keys(state.roster).length}</strong></div><div class="detail-stat"><small>主线</small><strong>${state.stageProgress}/9</strong></div></div><div style="margin-top:16px;padding:12px;background:#f1f0ea;border-radius:5px;font-size:9px;line-height:1.8;color:var(--ink-soft)"><strong style="display:block;color:var(--ink)">当前称号：北境开拓者</strong>主城离线保护已开启。新手保护结束前，真死副本与叛军入侵不会开放。</div>`;
    showModal(modalShell("主公档案", body, `<button class="button" data-action="close-modal">关闭</button>`));
  }

  function showResource(type) {
    const info = {
      gold: ["金币", "用于科技研发、人物培养与普通商店交易。通过主线、委托与挂机获得。", "coins"],
      survival: ["生存币", "由生存仔维护的专属货币，用于人物召唤与稀有道具交易。", "gem"],
      energy: ["行动力", "进入副本时消耗。原型版每次启动会保留当前数量，不设置真钱补充。", "zap"]
    }[type];
    showModal(modalShell(info[0], `<div style="display:flex;gap:14px;align-items:center"><span class="stat-icon gold" style="width:54px;height:54px">${icon(info[2])}</span><p style="margin:0;color:var(--ink-soft);font-size:11px;line-height:1.8">${info[1]}</p></div>`, `<button class="button" data-action="close-modal">知道了</button>`));
  }

  function showAssistant() {
    const hours = Math.max(1, Math.min(12, Math.floor((Date.now() - state.idleClaimAt) / 3600000)));
    const gold = hours * 420;
    const exp = hours * 90;
    const body = `<div style="display:flex;align-items:center;gap:14px"><span class="stat-icon" style="width:62px;height:62px">${icon("bot")}</span><div><strong style="font-size:13px">离线巡逻完成</strong><p style="margin:5px 0 0;color:var(--ink-faint);font-size:10px">初级助手工作 ${hours} 小时，最多累计 12 小时。</p></div></div><div class="reward-line" style="margin-top:18px"><span class="reward-item">${icon("coins")} ${formatNumber(gold)} 金币</span><span class="reward-item">${icon("sparkles")} ${exp} 经验</span></div>`;
    showModal(modalShell("挂机小助手", body, `<button class="button primary" data-action="claim-idle" data-gold="${gold}" data-exp="${exp}">领取收益</button>`));
  }

  function showMerchant() {
    const body = `<div style="display:flex;gap:13px;align-items:center;margin-bottom:16px"><span class="stat-icon gold" style="width:54px;height:54px">${icon("store")}</span><div><strong>黄金商人已被主城护卫拦下</strong><p style="margin:4px 0 0;color:var(--ink-faint);font-size:9px">普通语言翻译剩余 13 分钟。不要攻击商人。</p></div></div><div class="skill-list"><div class="skill-row" style="display:flex;align-items:center;gap:10px"><span class="stat-icon">${icon("heart")}</span><div style="flex:1"><strong>忠心丸</strong><span>一位人物忠诚永久提升至 100</span></div><button class="button small" data-action="buy-item" data-item="loyaltyPill" data-currency="gold" data-cost="8000" ${state.gold < 8000 ? "disabled" : ""}>8000 金币</button></div><div class="skill-row" style="display:flex;align-items:center;gap:10px"><span class="stat-icon blue">${icon("orbit")}</span><div style="flex:1"><strong>高阶通灵球</strong><span>用于武器通灵，原型版作为收藏品</span></div><button class="button small" data-action="buy-item" data-item="spiritOrb" data-currency="survival" data-cost="1200" ${state.survival < 1200 ? "disabled" : ""}>1200 生存币</button></div></div>`;
    showModal(modalShell("黄金商人", body, `<button class="button" data-action="close-modal">结束交易</button>`));
  }

  function showSettings() {
    const toggle = (label, note, key) => `<div style="min-height:52px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line)"><div><strong style="font-size:10px">${label}</strong><small style="display:block;margin-top:3px;color:var(--ink-faint);font-size:9px">${note}</small></div><button class="button small ${state.settings[key] ? "primary" : ""}" data-action="toggle-setting" data-setting="${key}">${state.settings[key] ? "已开启" : "已关闭"}</button></div>`;
    showModal(modalShell("设置", `${toggle("界面动态", "地图节点与战斗反馈动画", "motion")}${toggle("游戏音效", "当前原型未加载音频素材", "sound")}<div style="padding-top:15px"><button class="button danger" data-action="confirm-reset">${icon("trash-2")} 重置本地存档</button></div>`, `<button class="button" data-action="close-modal">完成</button>`));
  }

  const PUBLIC_GAME_URL = "https://pxz20100204.github.io/world-online-mvp/";

  function showShareGame() {
    const nativeShare = typeof navigator.share === "function";
    const body = `<div class="share-preview"><img src="assets/social-preview.png" alt="世界 Online 主城游戏画面"><div><span class="tag gold">公开测试版</span><h3>邀请朋友进入世界</h3><p>经营主城、召唤人物、组成三人队伍，一起从弱鸡村走向通关村。</p></div></div><label class="share-link"><span>公开网址</span><input value="${PUBLIC_GAME_URL}" readonly aria-label="游戏公开网址"></label>`;
    const foot = `<button class="button" data-action="copy-share-link">${icon("copy")} 复制链接</button>${nativeShare ? `<button class="button primary" data-action="native-share">${icon("share-2")} 系统分享</button>` : ""}`;
    showModal(modalShell("分享《世界 Online》", body, foot));
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(PUBLIC_GAME_URL);
      toast("公开链接已复制，可以发送给朋友", "copy-check");
      closeModal();
    } catch (error) {
      const input = document.querySelector(".share-link input");
      input?.select();
      toast("请使用浏览器菜单复制已选中的链接", "info");
    }
  }

  async function nativeShareGame() {
    try {
      await navigator.share({ title: "世界 Online", text: "经营主城、召唤人物、组成队伍，来挑战人物之王。", url: PUBLIC_GAME_URL });
      closeModal();
    } catch (error) {
      if (error.name !== "AbortError") copyShareLink();
    }
  }

  function startBattle(stageId) {
    const stage = stages.find((item) => item.id === stageId);
    if (!stage || stage.id > state.stageProgress + 1 || state.energy < stage.energy || !state.team.length) return;
    state.energy -= stage.energy;
    const fighters = state.team.map((id) => {
      const hero = getHero(id);
      const owned = heroData(id);
      const scale = (1 + (owned.level - 1) * .11) * (1 + (owned.star - 1) * .19);
      const maxHp = Math.floor(hero.baseHp * scale);
      return { id, hp: maxHp, maxHp, qi: 20 };
    });
    const enemyMaxHp = Math.floor(stage.recommended * (stage.id === 9 ? 1.65 : 1.15));
    ui.battle = { stage, fighters, activeIndex: 0, enemyHp: enemyMaxHp, enemyMaxHp, log: [`进入 ${stage.name}，遭遇 ${stage.enemy}。`], busy: false, finished: false, guarding: false };
    saveState();
    renderBattle();
  }

  function currentFighter() {
    if (!ui.battle) return null;
    const alive = ui.battle.fighters.filter((fighter) => fighter.hp > 0);
    if (!alive.length) return null;
    let tries = 0;
    while (ui.battle.fighters[ui.battle.activeIndex].hp <= 0 && tries < ui.battle.fighters.length) {
      ui.battle.activeIndex = (ui.battle.activeIndex + 1) % ui.battle.fighters.length;
      tries += 1;
    }
    return ui.battle.fighters[ui.battle.activeIndex];
  }

  function renderBattle() {
    const battle = ui.battle;
    if (!battle) return;
    const fighter = currentFighter();
    if (!fighter) return finishBattle(false);
    const hero = getHero(fighter.id);
    const enemy = { name: battle.stage.enemy, rarity: "BOSS", color: battle.stage.enemyColor, accent: "#e6e0ce", shape: battle.stage.enemyShape };
    const hpPercent = Math.max(0, fighter.hp / fighter.maxHp * 100);
    const enemyPercent = Math.max(0, battle.enemyHp / battle.enemyMaxHp * 100);
    modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal battle-modal" role="dialog" aria-modal="true"><div class="battle-head"><div><h2>${battle.stage.id}. ${battle.stage.name}</h2><small>${battle.stage.type} · 回合制讨伐</small></div><button class="button small danger" data-action="retreat">撤退</button></div><div class="battle-field"><div class="fighter" id="fighter-player">${portrait(hero)}<h3>${hero.name}</h3><div class="fighter-bars"><div class="hp-line" style="--hp:${hpPercent}%"><span></span></div><div class="qi-line" style="--qi:${fighter.qi}%"><span></span></div><div class="fighter-stats"><span>生命 ${Math.max(0, fighter.hp)}/${fighter.maxHp}</span><span>气 ${fighter.qi}/100</span></div></div></div><div class="versus">VS</div><div class="fighter enemy" id="fighter-enemy">${portrait(enemy)}<h3>${enemy.name}</h3><div class="fighter-bars"><div class="hp-line" style="--hp:${enemyPercent}%"><span></span></div><div class="fighter-stats"><span>生命 ${Math.max(0, battle.enemyHp)}/${battle.enemyMaxHp}</span><span>${battle.stage.type}</span></div></div></div></div><div class="battle-bottom"><div class="battle-log">${battle.log.slice(-10).map((line, index) => `<p class="${index === battle.log.slice(-10).length - 1 ? "important" : ""}">${line}</p>`).join("")}</div><div class="battle-controls"><div class="turn-label">轮到 ${hero.name} 行动 · 队伍存活 ${battle.fighters.filter((item) => item.hp > 0).length}/${battle.fighters.length}</div><div class="skill-buttons"><button class="skill-button" data-action="battle-skill" data-skill="basic" ${battle.busy ? "disabled" : ""}><strong>${hero.skills[0]}</strong><small>100% 伤害 · 气 +18</small></button><button class="skill-button" data-action="battle-skill" data-skill="skill" ${battle.busy || fighter.qi < 25 ? "disabled" : ""}><strong>${hero.skills[1]}</strong><small>170% 伤害 · 气 -25</small></button><button class="skill-button" data-action="battle-skill" data-skill="ultimate" ${battle.busy || fighter.qi < 80 ? "disabled" : ""}><strong>${hero.skills[2]}</strong><small>320% 伤害 · 气 -80</small></button><button class="skill-button" data-action="battle-skill" data-skill="guard" ${battle.busy ? "disabled" : ""}><strong>稳守</strong><small>恢复 8% 生命 · 本回合减伤</small></button></div></div></div></section></div>`;
    refreshIcons();
  }

  function battleAction(skill) {
    const battle = ui.battle;
    const fighter = currentFighter();
    if (!battle || !fighter || battle.busy || battle.finished) return;
    const hero = getHero(fighter.id);
    const owned = heroData(hero.id);
    const scale = (1 + (owned.level - 1) * .11) * (1 + (owned.star - 1) * .19);
    battle.busy = true;
    let damage = 0;
    let actionName = "";
    if (skill === "basic") {
      damage = hero.baseAtk * scale * (1.05 + Math.random() * .18);
      fighter.qi = Math.min(100, fighter.qi + 18);
      actionName = hero.skills[0];
    } else if (skill === "skill" && fighter.qi >= 25) {
      damage = hero.baseAtk * scale * (1.72 + Math.random() * .22);
      fighter.qi -= 25;
      actionName = hero.skills[1];
    } else if (skill === "ultimate" && fighter.qi >= 80) {
      damage = hero.baseAtk * scale * (3.2 + Math.random() * .38);
      fighter.qi -= 80;
      actionName = hero.skills[2];
    } else if (skill === "guard") {
      const healed = Math.floor(fighter.maxHp * .08);
      fighter.hp = Math.min(fighter.maxHp, fighter.hp + healed);
      battle.guarding = true;
      actionName = `稳守，恢复 ${healed} 生命`;
    } else {
      battle.busy = false;
      return;
    }
    damage = Math.floor(damage);
    if (damage > 0) battle.enemyHp = Math.max(0, battle.enemyHp - damage);
    battle.log.push(`${hero.name}施放${actionName}${damage ? `，造成 ${damage} 伤害` : ""}。`);
    renderBattle();
    if (damage > 0) animateDamage("fighter-enemy", damage);
    if (battle.enemyHp <= 0) {
      setTimeout(() => finishBattle(true), 550);
      return;
    }
    setTimeout(enemyTurn, 650);
  }

  function animateDamage(targetId, damage) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.classList.add("hit");
    const pop = document.createElement("span");
    pop.className = "damage-pop";
    pop.textContent = `-${damage}`;
    target.appendChild(pop);
  }

  function enemyTurn() {
    const battle = ui.battle;
    const fighter = currentFighter();
    if (!battle || !fighter || battle.finished) return;
    const base = battle.stage.recommended / (battle.stage.id === 9 ? 15 : 17);
    let damage = Math.floor(base * (.82 + Math.random() * .34));
    if (battle.guarding) damage = Math.floor(damage * .46);
    battle.guarding = false;
    fighter.hp = Math.max(0, fighter.hp - damage);
    const enemySkill = battle.stage.id >= 8 && Math.random() < .28 ? "首领技" : "攻击";
    battle.log.push(`${battle.stage.enemy}发动${enemySkill}，${getHero(fighter.id).name}受到 ${damage} 伤害。`);
    if (fighter.hp <= 0) battle.log.push(`${getHero(fighter.id).name}暂时退出战斗。`);
    battle.activeIndex = (battle.activeIndex + 1) % battle.fighters.length;
    battle.busy = false;
    renderBattle();
    animateDamage("fighter-player", damage);
    if (!currentFighter()) setTimeout(() => finishBattle(false), 500);
  }

  function gainExp(amount) {
    state.player.exp += amount;
    let leveled = false;
    while (state.player.exp >= state.player.level * 1000) {
      state.player.exp -= state.player.level * 1000;
      state.player.level += 1;
      state.maxEnergy += 2;
      state.energy = Math.min(state.maxEnergy, state.energy + 10);
      leveled = true;
    }
    return leveled;
  }

  function finishBattle(victory) {
    const battle = ui.battle;
    if (!battle || battle.finished) return;
    battle.finished = true;
    if (!victory) {
      showModal(modalShell("讨伐失败", `<div style="text-align:center;padding:16px"><span class="stat-icon red" style="width:60px;height:60px;margin:auto">${icon("shield-x")}</span><h2 style="font-size:16px">队伍撤回主城</h2><p style="color:var(--ink-faint);font-size:10px">人物不会永久死亡。升级人物或调整编队后再次挑战。</p></div>`, `<button class="button" data-action="close-modal">返回章节</button><button class="button primary" data-action="go-heroes">调整编队</button>`));
      return;
    }
    const stage = battle.stage;
    const firstClear = stage.id > state.stageProgress;
    const gold = firstClear ? stage.gold : Math.floor(stage.gold * .3);
    const survival = firstClear ? stage.survival : Math.floor(stage.survival * .25);
    const exp = firstClear ? stage.exp : Math.floor(stage.exp * .4);
    state.gold += gold;
    state.survival += survival;
    state.reputation += firstClear ? 3 + stage.id : 1;
    state.population += firstClear ? stage.id * 280 : 30;
    state.troops += firstClear ? stage.id * 160 : 40;
    state.tasks.battle.progress = Math.max(state.tasks.battle.progress, 1);
    if (stage.id === 1 && firstClear) state.inventory.shapeshifterShard += 1;
    if (stage.id === 9) {
      state.finalCleared = true;
      state.stageProgress = 9;
    } else if (firstClear) {
      state.stageProgress = stage.id;
    }
    const leveled = gainExp(exp);
    saveState();
    const extra = stage.id === 1 && firstClear ? `<span class="reward-item">${icon("puzzle")} 百变魔主碎片 ×1</span>` : "";
    showModal(modalShell(firstClear ? "首通成功" : "讨伐完成", `<div style="text-align:center;padding:7px 0 16px"><span class="stat-icon gold" style="width:60px;height:60px;margin:auto">${icon(stage.id === 9 ? "crown" : "trophy")}</span><h2 style="font-size:17px">${stage.enemy} 已被击败</h2><p style="color:var(--ink-faint);font-size:10px">${leveled ? `主公升至 ${state.player.level} 级。` : firstClear ? "下一章节已开放。" : "重复讨伐奖励已结算。"}</p></div><div class="reward-line" style="justify-content:center"><span class="reward-item">${icon("coins")} ${formatNumber(gold)}</span><span class="reward-item">${icon("gem")} ${survival}</span><span class="reward-item">${icon("sparkles")} ${exp}</span>${extra}</div>`, `<button class="button primary" data-action="battle-complete">返回纪元地图</button>`));
    render();
  }

  function promoteVillage() {
    if (!canPromote()) return;
    const previous = villages[state.village];
    state.village += 1;
    const current = villages[state.village];
    state.reputation += 15;
    state.population += 8000;
    state.gold += state.village * 1000;
    saveState();
    render();
    showModal(modalShell("村落晋升", `<div style="text-align:center;padding:15px"><span class="stat-icon gold" style="width:68px;height:68px;margin:auto">${icon("badge-up")}</span><p style="margin:15px 0 3px;color:var(--ink-faint);font-size:10px">${previous}</p><h2 style="margin:0;font-size:20px">${current}</h2><p style="color:var(--ink-soft);font-size:10px;line-height:1.7">领地人口上升，声望 +15，并获得 ${formatNumber(state.village * 1000)} 金币。</p></div>`, `<button class="button gold" data-action="close-modal">进入${current}</button>`));
  }

  function handleClick(event) {
    const route = event.target.closest("[data-route]");
    if (route) {
      if (route.tagName === "A") return;
      setRoute(route.dataset.route);
      return;
    }
    const heroCardElement = event.target.closest("[data-hero]");
    if (heroCardElement) {
      ui.selectedHero = heroCardElement.dataset.hero;
      renderHeroes(); refreshIcons(); return;
    }
    const filter = event.target.closest("[data-filter]");
    if (filter) { ui.heroFilter = filter.dataset.filter; renderHeroes(); refreshIcons(); return; }
    const stage = event.target.closest("[data-stage]");
    if (stage) { ui.selectedStage = Number(stage.dataset.stage); renderCampaign(); refreshIcons(); return; }
    const archiveButton = event.target.closest("[data-archive]");
    if (archiveButton) { ui.archiveTab = archiveButton.dataset.archive; renderArchives(); refreshIcons(); return; }
    const career = event.target.closest("[data-career]");
    if (career) { ui.onboardingCareer = career.dataset.career; showOnboarding(); return; }
    const resource = event.target.closest("[data-resource]");
    if (resource) { showResource(resource.dataset.resource); return; }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === "close-modal" || action === "battle-complete") closeModal();
    if (action === "backdrop-close" && event.target === actionButton) closeModal();
    if (action === "go-campaign") { closeModal(); setRoute("campaign"); }
    if (action === "go-heroes") { closeModal(); setRoute("heroes"); }
    if (action === "go-summon") { closeModal(); setRoute("summon"); }
    if (action === "open-profile") showProfile();
    if (action === "share-game") showShareGame();
    if (action === "copy-share-link") copyShareLink();
    if (action === "native-share") nativeShareGame();
    if (action === "merchant") showMerchant();
    if (action === "archive-faction") { ui.archiveTab = "factions"; setRoute("archives"); }
    if (action === "dismiss-alert") { actionButton.closest(".map-alert")?.remove(); toast("雷区位置已标记在北境外环", "map-pin"); }
    if (action === "promote") promoteVillage();
    if (action === "research") {
      if (state.gold < 800) return toast("金币不足", "circle-alert");
      state.gold -= 800; state.researchCount += 1; state.tech = Math.min(.55, state.tech * 12 + .00000002); state.population += 260; state.troops += 85; state.tasks.research.progress = 1; saveState(); render(); toast("研究完成：人口与兵力生产提高", "flask-conical");
    }
    if (action === "claim-task") {
      const key = actionButton.dataset.task; const task = state.tasks[key];
      if (!task || task.claimed || task.progress < task.goal) return;
      task.claimed = true; if (key === "summon") state.survival += 200; else state.gold += key === "battle" ? 500 : 300; saveState(); render(); toast("委托奖励已领取");
    }
    if (action === "toggle-team") {
      const id = actionButton.dataset.heroId; const index = state.team.indexOf(id);
      if (index >= 0) {
        if (state.team.length <= 1) return toast("至少保留一位出战人物", "circle-alert");
        state.team.splice(index, 1);
      } else if (state.team.length < 3) state.team.push(id);
      else { state.team[2] = id; toast("已替换第三编队位"); }
      saveState(); renderHeroes(); refreshIcons();
    }
    if (action === "level-hero") {
      const id = actionButton.dataset.heroId; const owned = heroData(id); const cost = owned.level * 500;
      if (!state.roster[id] || state.gold < cost || id === "reputation-master") return;
      state.gold -= cost; owned.level += 1; saveState(); renderHeroes(); refreshIcons(); toast(`${getHero(id).name}升至 Lv.${owned.level}`, "arrow-up");
    }
    if (action === "summon") doSummon(Number(actionButton.dataset.count));
    if (action === "summon-history") showModal(modalShell("召唤规则", `<div class="lore-section"><h2>完整人物</h2><p>每次召唤直接获得完整人物，不会只获得碎片。重复人物自动升星，七星后转为 80 枚碎片。</p></div><div class="lore-section" style="margin-top:18px"><h2>公平与保底</h2><p>十连至少获得一位 SR，七十次内必得 SSR 或 UR。开局礼包不会出现足以直接跳过多个村落的服务器级人物。</p></div>`, `<button class="button" data-action="close-modal">关闭</button>`));
    if (action === "start-battle") startBattle(Number(actionButton.dataset.stageId));
    if (action === "battle-skill") battleAction(actionButton.dataset.skill);
    if (action === "retreat") { ui.battle = null; closeModal(); toast("已撤回主城，行动力不返还", "log-out"); }
    if (action === "onboarding-next") {
      const input = document.getElementById("lord-name"); const name = (input?.value || "").trim();
      if (name.length < 2) return toast("主公名号至少需要 2 个字", "circle-alert");
      ui.onboardingName = name; ui.onboardingStep = 2; showOnboarding();
    }
    if (action === "onboarding-back") { ui.onboardingStep = 1; showOnboarding(); }
    if (action === "submit-quiz") {
      const score = Number(ui.onboardingAnswers.q1 === "1") + Number(ui.onboardingAnswers.q2 === "0") + Number(ui.onboardingAnswers.q3 === "2");
      if (Object.keys(ui.onboardingAnswers).length < 3) return toast("请完成全部规则题", "circle-alert");
      if (score < 2) return toast("得分未达要求，请重新核对规则", "file-warning");
      const careerNames = { warrior: "战士", mage: "法师", taoist: "道士", archer: "弓箭手" };
      state.player.name = ui.onboardingName; state.player.career = careerNames[ui.onboardingCareer]; state.player.iq = 118 + Math.floor(Math.random() * 49); ui.onboardingStep = 3; saveState(); showOnboarding();
    }
    if (action === "scan-and-gift") {
      ui.giftResults = performSummon(5, true);
      const preferred = ui.giftResults.find((result) => !state.team.includes(result.hero.id));
      if (preferred && state.team.length < 3) state.team.push(preferred.hero.id);
      saveState(); showOnboarding();
    }
    if (action === "enter-world") { state.initialized = true; saveState(); closeModal(); render(); toast("主城已建立，新手保护开始", "castle"); }
    if (action === "claim-idle") { state.gold += Number(actionButton.dataset.gold); gainExp(Number(actionButton.dataset.exp)); state.idleClaimAt = Date.now(); saveState(); closeModal(); render(); toast("挂机收益已存入仓库"); }
    if (action === "buy-item") {
      const currency = actionButton.dataset.currency; const cost = Number(actionButton.dataset.cost); const item = actionButton.dataset.item;
      if (state[currency] < cost) return; state[currency] -= cost; state.inventory[item] += 1; saveState(); showMerchant(); toast("交易完成，物品已收入仓库", "package-check");
    }
    if (action === "toggle-setting") { const key = actionButton.dataset.setting; state.settings[key] = !state.settings[key]; document.documentElement.style.setProperty("--motion-state", state.settings.motion ? "running" : "paused"); saveState(); showSettings(); }
    if (action === "confirm-reset") showModal(modalShell("重置存档？", `<p style="font-size:11px;line-height:1.8;color:var(--ink-soft)">这会删除当前主公、人物、关卡和资源进度。操作只影响本浏览器，无法撤销。</p>`, `<button class="button" data-action="settings-back">取消</button><button class="button danger" data-action="reset-save">确认重置</button>`));
    if (action === "settings-back") showSettings();
    if (action === "reset-save") { localStorage.removeItem(STORAGE_KEY); state = defaultState(); Object.assign(ui, { onboardingStep: 1, onboardingName: "", onboardingAnswers: {}, giftResults: [] }); closeModal(); render(); showOnboarding(); }
  }

  function handleChange(event) {
    if (event.target.matches('.quiz-option input[type="radio"]')) {
      ui.onboardingAnswers[event.target.name] = event.target.value;
      event.target.closest(".quiz-item")?.classList.add("answered");
      const answeredCount = ["q1", "q2", "q3"].filter((id) => ui.onboardingAnswers[id] !== undefined).length;
      const progressCount = document.getElementById("quiz-progress-count");
      const progressBar = document.getElementById("quiz-progress-bar");
      if (progressCount) progressCount.textContent = `已作答 ${answeredCount}/3`;
      if (progressBar) progressBar.style.setProperty("--value", `${answeredCount / 3 * 100}%`);
    }
  }

  function handleInput(event) {
    if (event.target.id === "lord-name") ui.onboardingName = event.target.value;
  }

  document.addEventListener("click", handleClick);
  document.addEventListener("change", handleChange);
  document.addEventListener("input", handleInput);
  window.addEventListener("hashchange", render);
  document.getElementById("mobile-menu").addEventListener("click", () => document.body.classList.toggle("menu-open"));
  document.getElementById("sidebar-scrim").addEventListener("click", () => document.body.classList.remove("menu-open"));
  document.getElementById("profile-button").addEventListener("click", showProfile);
  document.getElementById("assistant-button").addEventListener("click", showAssistant);
  document.getElementById("settings-button").addEventListener("click", showSettings);

  if (!location.hash) history.replaceState(null, "", "#home");
  render();
  if (!state.initialized) setTimeout(showOnboarding, 80);
})();
