# 世界 Online MVP

《世界 Online》设定的最小可玩网页版本。从弱鸡村出发，经营主城、召唤人物、组成三人队伍，并沿九章主线挑战人物之王。

[立即游玩](https://pxz20100204.github.io/world-online-mvp/) · [报告问题](https://github.com/pxz20100204/world-online-mvp/issues)

![世界 Online 主城画面](assets/social-preview.png)

## 已实现

- 规则测试、职业选择与开局五连礼包
- 主城经营、科技研发、任务和挂机收益
- 人物召唤、重复升星、升级与三人编队
- 九章回合制战斗、首通掉落和村落晋升
- 黄金商人、服务器事件、纪元档案及本地存档
- Supabase 全服实时聊天、频道切换与金牛语转换
- 桌面与移动端响应式界面

## 开始游戏

访问：https://pxz20100204.github.io/world-online-mvp/

游戏进度保存在当前浏览器的本地存储中。更换设备或清除网站数据后会重新开始。聊天使用匿名玩家会话，消息会实时同步到其他在线玩家并保存在 Supabase 中。

## 实时后端

- 浏览器仅使用 Supabase 可公开发布的客户端密钥。
- 消息表启用了行级安全策略，玩家只能以自己的匿名会话身份发送消息。
- 服务端限制同一玩家每 3 秒一条、每分钟最多 10 条消息。
- 数据库结构和安全策略位于 `supabase/schema.sql`。

## 自动部署

推送到 `main` 分支后，GitHub Actions 会自动部署当前目录到 GitHub Pages。
