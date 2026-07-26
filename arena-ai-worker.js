"use strict";

const ACTIONS = ["advance", "retreat", "hold", "basic", "skill1", "skill2", "ultimate"];

function scoreActions(snapshot) {
  const self = snapshot.self;
  const enemy = snapshot.enemy;
  const distance = Math.abs(self.pos - enemy.pos);
  const health = self.hp / Math.max(1, self.maxHp);
  const enemyHealth = enemy.hp / Math.max(1, enemy.maxHp);
  const scores = Object.fromEntries(ACTIONS.map((action) => [action, -1000]));

  if (self.dead) return { action: "hold", scores, reason: "等待复活" };

  const recent = snapshot.playerHistory || [];
  const aggressive = recent.filter((action) => ["advance", "basic", "skill1", "ultimate"].includes(action)).length;
  const defensive = recent.filter((action) => ["retreat", "hold", "skill2"].includes(action)).length;
  const enemyUltimateReady = (enemy.cooldowns?.ultimate || 0) <= 0;
  const enemyControlUnavailable = (enemy.cooldowns?.skill1 || 0) > 2.5;
  const underEnemyTower = Boolean(snapshot.underEnemyTower && !snapshot.allyMinionCover);
  const killWindow = enemyHealth < .26 && health > .3;

  scores.hold = 12 + (snapshot.allyMinionCover ? 8 : 0) + (snapshot.towerCover ? 10 : 0);
  scores.advance = 24 + (health - enemyHealth) * 45 + (defensive > aggressive ? 12 : 0) + (snapshot.allyMinionCover ? 16 : -4);
  scores.retreat = 8 + (1 - health) * 72 + (underEnemyTower ? 80 : 0) + (aggressive >= 5 ? 14 : 0);
  if (enemyControlUnavailable) scores.advance += 14;

  if (distance <= self.basicRange && self.cooldowns.basic <= 0) {
    scores.basic = 42 + (1 - enemyHealth) * 36 + (killWindow ? 28 : 0);
  }
  if (distance <= self.skill1Range && self.cooldowns.skill1 <= 0) {
    scores.skill1 = 54 + (1 - enemyHealth) * 42 + (enemy.moving ? 10 : 0) + (killWindow ? 32 : 0);
  }
  if (self.cooldowns.skill2 <= 0) {
    scores.skill2 = 25 + (1 - health) * 58 + (aggressive >= 4 ? 18 : 0) + (snapshot.towerDanger ? 20 : 0);
    if (enemyUltimateReady && distance <= self.ultimateRange + 2) scores.skill2 += 24;
  }
  if (enemyUltimateReady && distance <= self.ultimateRange + 2) scores.retreat += 14;
  if (distance <= self.ultimateRange && self.cooldowns.ultimate <= 0) {
    scores.ultimate = 48 + (1 - enemyHealth) * 65 + (killWindow ? 45 : 0) - (enemy.shield > 0 ? 18 : 0);
  }

  if (underEnemyTower) {
    scores.advance -= 70;
    scores.basic -= 25;
    scores.skill1 -= 22;
    scores.ultimate -= 18;
  }
  if (health < .2) {
    scores.retreat += 80;
    scores.advance -= 60;
  }
  if (snapshot.enemyChanneling && self.cooldowns.skill1 <= 0 && distance <= self.skill1Range) scores.skill1 += 45;
  if (snapshot.objectiveOpen && snapshot.allyMinionCover) scores.advance += 30;

  let action = "hold";
  for (const candidate of ACTIONS) {
    if (scores[candidate] > scores[action]) action = candidate;
  }
  const reasons = {
    advance: "借兵线推进并压缩安全区",
    retreat: "退出高风险区域并等待冷却",
    hold: "保持塔线与兵线的双重掩护",
    basic: "用最低成本完成可确认伤害",
    skill1: "预测位移后打断或追击",
    skill2: "吸收下一轮爆发并改变换血结果",
    ultimate: "进入斩杀窗口，释放最高收益技能"
  };
  return { action, scores, reason: reasons[action] };
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== "decide" || !message.snapshot) return;
  const startedAt = performance.now();
  const result = scoreActions(message.snapshot);
  self.postMessage({
    type: "decision",
    requestId: message.requestId,
    action: ACTIONS.includes(result.action) ? result.action : "hold",
    telemetry: {
      candidates: ACTIONS.length,
      predictionMs: 1200,
      computeMs: Math.round((performance.now() - startedAt) * 100) / 100,
      reason: result.reason
    }
  });
};
