# 定制 Skills 調研：能否提升 agentic 速度

日期：2026-07-30
方法：A/B 對照實驗（樸素 prompt vs 優化 skill 指令，同實體同模型），並產出正式 skill 套件

---

## 1. 直接回答

**對速度的提升不顯著，不應作為提速手段。** 原因是 MiniMax-M3 本身就具備良好的搜尋紀律（自然批次化、自然停止），skill 指令沒有額外可壓縮的浪費。Skills 的真正價值是**一致性與標準化**，不是速度。

## 2. A/B 實驗數據（`scripts/poc-skill-ab.ts`）

| 組別 | 耗時 | 搜尋數 | 回合 | 證據筆記 | 數據點 |
|---|---|---|---|---|---|
| Fujifilm X-T50 基線 | 34.8s | 4 | 3 | 2315 字元 | ~91 |
| Fujifilm X-T50 skilled | 65.7s | 4 | 4 | 1294 字元 | ~51 |
| Sony ZV-E10 樸素 prompt | 40.2s | 4 | 4 | 2848 字元 | ~46 |
| Sony ZV-E10 skilled | 43.5s | 4 | 4 | 1365 字元 | ~36 |

解讀：
- 兩組實驗中 skilled 都**沒有更快**（單次方差大，但方向一致：無提速效果）
- 模型在樸素 prompt 下也自然做 4 次批次搜尋——**M3 已內建我們想教的紀律**
- skilled 版證據筆記反而更短（更嚴格的字數控制有代價）

## 3. 為什麼 skill 沒提速

1. **瓶頸不在指令**：速度瓶頸是模型生成時間與搜尋 API 延遲，不是「agent 不知道該做什麼」
2. **強模型已具備紀律**：M3 在無指引時也會批次搜尋、適時停止（首個 PoC 已觀察到）
3. **Skill 與 system prompt 等價**：對程式化 SDK session，把同樣指令放 system prompt 或 skill 檔，模型行為沒有差別

## 4. Skills 真正有用的地方

| 用途 | 價值 |
|---|---|
| **一致性/標準化** | 團隊共享統一的 research/analyst 協議，避免每次手寫 prompt 漂移 |
| **弱模型引導** | 若研究段換 M2.7-highspeed 省錢，skill 可補足其紀律（待驗證） |
| **可維護性** | 協議改一處（skill 檔），所有 session 生效 |
| **可組合性** | 未來加新 agent（如 fact-checker）可複用同一協議 |

## 5. 產出：正式 skill 套件

- `.pi/skills/compare-researcher/SKILL.md` — 4 查詢上限、單 turn 批次、停止條件、決策相關性過濾、數據點密度要求
- `.pi/skills/compare-analyst/SKILL.md` — 單維度分析、desirability 評分規則、citation 白名單、實體命名規範

## 6. 結論與建議

1. **不以 skill 提速**——實驗證明無效（瓶頸在模型與 API 延遲）
2. **採用 skill 作為協議標準**——把 `.pi/skills/compare-*` 作為研究/分析 agent 的統一指令來源，提升一致性與可維護性
3. **提速仍走已定案路線**：並行 scoped agents + 直接分析呼叫 + 批次搜尋上限 + 非同步 SSE（見 `agentic-hybrid-speed-architecture.md`），這些才有實測數據支撐
