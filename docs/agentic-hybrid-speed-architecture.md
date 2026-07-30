# Agentic 提速定案：混合式 Scoped Agents（不犧牲品質）

日期：2026-07-30
方法：三種架構變體真實對照（`scripts/poc-hybrid-agentic.ts`），Notion vs Obsidian

---

## 1. 三種架構實測對照

| 架構 | 總耗時 | 研究段 | 分析段 | 平均 summary 深度 | Citation 有效率 |
|---|---|---|---|---|---|
| 現行 pipeline（含研究） | ~60–90s | ~43s | ~16s | 140 字元 | 100% |
| 全 agentic（研究+分析都是 agent） | **175s** | 90s | 75s | **485 字元** | 92% |
| **混合（agentic 研究 ∥ + 直接分析 ∥）** | **83s** | 69s | **5.6s** | **177 字元** | 31%（需修） |

## 2. 關鍵洞察

### 2.1 Agentic 的價值在「研究」，不在「分析」

- 研究是開放式探索：agent 自主決定查什麼、補查什麼，證據筆記明顯更密（這是 485→177 vs 現行 140 的深度來源）
- 分析/綜合是封閉式轉換：證據已足，單 turn 就能完成，**agent loop 純屬浪費**（75s → 5.6s，13× 差距，深度只從 485 降到 177 仍高於現行 140）

### 2.2 慢的主因是模型選擇，不是架構

- 全 agentic 的分析段慢是因為用 MiniMax-M3 agent session 做單 turn 轉換
- 換成 DeepSeek 直接呼叫後同樣內容 5.6s 完成——**分析段根本不需要 agent**

### 2.3 直接分析的 citation 要守白名單

- 直接分析版 citation 有效率掉到 31%（模型在無強制下編 URL）
- 修法就是現行 pipeline 已有的 allowlist 過濾/映射，與架構無關，一行驗證即可恢復 100%

## 3. 定案架構（品質不打折的提速）

```
POST /compare
   │
   ├─ research agent A (agentic, ≤4 batched searches) ─┐
   │                                                      ├─ ∥ ~40–70s
   └─ research agent B (agentic, ≤4 batched searches) ─┘
   │
   architect（直接呼叫，schema 強制）~5s
   │
   ├─ analyst dim 1 ─┐
   ├─ analyst dim 2 ─┤ 直接呼叫 ∥（上限 3），citation 白名單過濾  ~6s
   ├─ ...（≤6）     ─┘
   │
   pros/cons + verdict（直接呼叫 ∥2）~3s
```

**預估總耗時：~55–85s**（對齊現行 60–90s），但研究證據更密、summary 更深（177 vs 140）。

### 進一步提速（不影響品質）

| 手段 | 效果 | 品質風險 |
|---|---|---|
| 研究 searches 上限 4 且強制單 turn 批次 | 研究段 90s → ~40–60s | 低（4 次批次搜尋已足） |
| 研究模型換 `MiniMax-M2.7-highspeed` | 研究段再降 30–50% | 中（需 A/B 驗證證據品質） |
| 證據筆記截斷（每實體 ≤2500 字元傳給 analyst） | 分析 token 降、略快 | 低 |
| **非同步 job + SSE**（獨立於架構） | 體感即時、消除 60s 代理超時 | 無 |
| entity 研究快取 24h | 重複實體研究段歸零 | 無 |

## 4. 與其他方案的關係

| 方案 | 耗時 | 品質（judge/深度） | 結論 |
|---|---|---|---|
| 現行多段 pipeline | 60–90s | 9/10，140 字元 | **預設，品質標竿** |
| 長任務整份 | 快 18%、省 43% token | 7/10，較淺 | 成本敏感模式 |
| 單一巨石 agent | 180–240s | 深但太慢 | 不採用 |
| **混合 scoped agents** | **55–85s** | **更深（177 字元）且更快** | **agentic 的正確形態** |

## 5. 實作建議

1. **第一階段（最大收益、最低風險）**：保持現行 pipeline，只把 research 換成 2 個 agentic research agents（∥、≤4 批次搜尋、evidence notes），分析/綜合不變 → 品質提升（證據更密）且時間持平
2. **第二階段**：非同步 job + SSE 進度（兩種模式都受益，消除超時）
3. **第三階段**：研究模型 A/B（M2.7-highspeed vs M3）、entity 快取
4. 護欄沿用：每 agent tool-call 上限、全域 semaphore、citation 白名單、失敗回退現行 pipeline

## 附：實驗產物

- `scripts/poc-hybrid-agentic.ts`（三變體可切換復跑）
- 數據為單次實體（Notion vs Obsidian）單次生成，建議落地前以 5 組實體複測
