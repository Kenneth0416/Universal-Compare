# Agentic Pipeline 調研：以 pi Agent 取代多階段 Pipeline

日期：2026-07-30
狀態：**可行性已驗證（PoC 端到端成功）**

---

## 1. 結論

**可行，建議採用。** 已用真實 API 完成端到端 PoC：單一 pi agent session 自主完成「搜尋 → 關係判定 → 維度設計 → 逐維分析 → 結構化提交」，產出通過現行 `normalizeComparisonResult` 嚴格校驗的完整報告，最終輸出格式與現有 pipeline 完全一致（UI、SEO、海報、報告儲存無需改動）。

### PoC 實測證據（`scripts/poc-agentic-compare.ts`，Coffee vs Tea）

| 指標 | 結果 |
|---|---|
| 模型 | `minimax-cn/MiniMax-M3`（pi 內建 provider，Anthropic-messages API） |
| 自主 web_search 次數 | **16 次**（agent 自行決定查詢角度與數量） |
| 自我修正 | 首次 submit 因 citations 超限被 schema 拒絕，agent **自行修正後重新提交成功** |
| 最終 schema 校驗 | `normalizeComparisonResult` → **true**（與生產同一 validator） |
| 產出 | 6 dimensions、10 sources、英文 verdict，欄位完整 |

## 2. 現行 Pipeline vs Agentic 模式

| 面向 | 現行（固定 4 階段，10–13 次呼叫） | Agentic（單 session 自主循環） |
|---|---|---|
| 編排 | 程式碼硬編排：researcher×2 → architect → analyst×4–6 → pros/cons+verdict | Agent 自主規劃：搜幾次、查什麼、何時收尾由模型決定 |
| 搜尋品質 | 每實體固定 1 次廣泛搜尋（Grok responses）或 planner 5–8 query（MiniMax） | 按需多輪搜尋，發現資訊缺口可補查（PoC 實測 16 次，涵蓋價格/環境/健康/文化多角度） |
| 維度設計 | 單次 architect 呼叫，品質一次定型 | Agent 帶著搜尋證據設計維度，上下文更足 |
| 一致性 | 各階段獨立呼叫，實體名稱/口徑偶有不一致 | 單一上下文，實體稱呼與口徑天然一致 |
| 結構化輸出 | 每階段 JSON schema 強制 + 伺服器逐層驗證 | 終端 `submit_comparison_report` tool（typebox schema）+ 同一個生產 validator |
| 錯誤恢復 | 任一階段失敗整體失敗（已部分降級） | Agent 可自我修正（PoC 已觀察到），仍需要兜底 |
| 成本 | 固定約 10–13 次 LLM 呼叫 | 變動（turn 數 × 上下文），需預算控制，見 §5 |
| 延遲 | 研究/分析可並行，P95 較可控 | 本質串行循環，預期更慢（PoC 約 3–5 分鐘級） |
| 可觀測性 | 固定 phase 進度條 | tool_execution 事件可映射為更真實的進度（搜尋中/分析中/提交中） |

## 3. 目標架構

```
POST /api/comparisons (agentic mode)
        │
        ▼
┌─────────────────────────────────────────────┐
│ server/agenticComparison.ts                  │
│  createAgentSession({                        │
│    model: minimax-cn/MiniMax-M3 (或 xai),    │
│    tools: [web_search, submit_report],       │
│    sessionManager: inMemory,                 │
│    settingsManager: retry + compaction       │
│  })                                          │
│                                              │
│  customTools:                                │
│   • web_search      → 現有 MiniMax Search    │
│     (記錄所有來源 → citation allowlist)      │
│   • submit_comparison_report                 │
│     → 捕獲參數 = 結構化報告                  │
└─────────────────────────────────────────────┘
        │ 事件流 → progress 回調（搜尋次數/階段）
        ▼
提交的 report
        ▼
shared/comparisonSchema 驗證 + citation 白名單（與現行一致）
        ▼
既有 report grant / save / SEO / poster（零改動）
```

關鍵設計決策：

1. **結構化輸出用「終端提交 tool」而非文字 JSON**：agent 的最後動作是呼叫 `submit_comparison_report`，typebox schema 即現行 ComparisonResult 形狀（4–6 dimensions、score 0–10、better_for enum、citations ≤2）。PoC 證明模型能遵守，且出錯時會自我修正。
2. **證據白名單不變**：`web_search` tool 在伺服器端記錄所有回傳 URL，submit 後驗證 `sources` 與每條 citation 都必須出自實際搜尋結果——沿用現有 citation allowlist 邏輯，杜絕幻覺引用。
3. **報告儲存鏈不變**：agentic 產出經同一 `serializeComparisonResult` + finalize grant 流程持久化，無需改 reportToken/proof chain（proof chain 保護的是「各 phase 由本伺服器發出」，agentic 下整份報告本就由單一伺服器 session 產出，可直接簽 grant）。
4. **provider 抽象**：pi 內建 `xai`（Grok 4.x）與 `minimax`/`minimax-cn`（M2.7/M3，anthropic-messages）。以 `AI_PROVIDER` 選型，與現行一致。注意 **xAI 帳號目前額度耗盡**，預設走 minimax-cn。
5. **工具面最小化**：只開 `web_search` + `submit_comparison_report`（`noTools: "builtin"`），不給 read/bash/edit——agent 不需要碰檔案系統，安全面更小。

## 4. 實作計畫

### Phase 1 — 核心服務（1–2 天）
- `server/agenticComparison.ts`：
  - session factory（model 選擇、custom tools、in-memory session、retry/compaction 設定）
  - `runAgenticComparison(itemA, itemB, language, signal, onProgress) → ComparisonResult`
  - web_search tool：複用 `callMinimaxSearch`（或 Grok responses），截斷 snippet（≤500 字/條，每輪 ≤6 條），累積來源白名單
  - submit tool：捕獲參數；回傳 validator 錯誤給 agent 讓其自修（PoC 已驗證此模式有效）
  - 事件 → 進度映射：`tool_execution_start(web_search)` → "Researching…（第 N 次搜尋）"，`submit` → "Finalizing…"
  - AbortSignal → `session.abort()`
  - **Turn/成本護欄**：訂閱事件計數，超過 N 次 tool call（建議 25）或 M 分鐘（建議 8）→ abort 並回退
- `POST /api/comparisons/agentic`（或 `AI_PIPELINE_MODE=agentic` 切換既有端點）
- 沿用既有 rate limit / budget / run tracking

### Phase 2 — 前端整合（0.5 天）
- 進度文案對應新事件（搜尋進行中/正在分析/正在提交）
- 其餘零改動（ComparisonResult 形狀不變）

### Phase 3 — 驗證與灰度（1–2 天）
- mock streamSimple 的單元測試（固定 transcript：搜尋×3 → submit）
- 真實 API 灰度：`test:real` 加 agentic 變體，對比 5 組典型實體的品質/成本/延遲
- 指標門檻：schema 一次通過率、平均 turn 數、單次成本 vs 現行、P95 延遲

### Phase 4 — 切流與回退
- `AI_PIPELINE_MODE=phase|agentic` 環境切換，預設 phase
- agentic 失敗自動回退 phase pipeline（保留現有實作作為 fallback，不刪除）

## 5. 成本與效能評估

| 項目 | 現行 phase pipeline | Agentic（PoC 觀察） |
|---|---|---|
| LLM 呼叫次數 | 固定 10–13 | 變動，約 6–20 turns（PoC：16 搜尋 + ~6 assistant turns） |
| 每次呼叫上下文 | 各階段小而獨立 | 逐 turn 累積（含全部搜尋結果）→ token 成本偏高 |
| 延遲 | 並行，約 60–90s | 串行，PoC 約 3–4 分鐘 |
| 緩解 | — | snippet 截斷、搜尋結果壓縮、compaction 開啟、turn 上限、背景化（見下） |

**延遲是主要 trade-off**：agentic 本質串行。建議：
- 接受更長等待（現有 loading UI 可承接，進度回報反而更真實）
- 或改「非同步生成」：POST 立即回 runId，前端輪詢/SSE 取結果，順便解決現行 60s 代理超時風險

## 6. 風險與緩解

| 風險 | 緩解 |
|---|---|
| Agent 不呼叫 submit（跑題/只輸出文字） | turn 上限 + 偵測 agent_end 無提交 → 以既有 transcript followUp 催交一次 → 仍失敗則回退 phase pipeline |
| 成本失控 | tool call 上限、時間上限、daily budget 沿用、snippet 截斷 |
| 幻覺來源/引用 | citation 白名單強制校驗（沿用） |
| 幻覺內容 | prompt 要求「只可基於搜尋結果」；品質抽樣灰度 |
| pi 依賴體積 | pi-coding-agent 含完整 provider 生態（aws-sdk 等），server 依賴 +~150MB；可用 pkg 裁剪或子行程 RPC 模式隔離 |
| 模型相容性 | MiniMax-M3 已實測 OK；xAI Grok 4.x 待額度恢復後驗證；DeepSeek 走 openai-completions compat |
| 並發 | 沿用全域 semaphore；agentic 單次更吃資源，建議降全域並發（4→2） |

## 7. 建議

1. **先上 Phase 1 + feature flag**，與現行 pipeline 並存，5–10 組實體 A/B 對比品質與成本後再決定是否預設切換。
2. **不刪除現行 phase pipeline**——它更快更便宜，agentic 適合追求搜尋深度與一致性的場景，兩者可按需求選型。
3. PoC 腳本保留於 `scripts/poc-agentic-compare.ts`（需全域安裝的 pi 路徑，正式實作時改為專案依賴 `@earendil-works/pi-coding-agent`）。

## 附：PoC 關鍵技術點

- `createAgentSession` + `customTools`（`web_search`、`submit_comparison_report`）
- 模型選型：`modelRegistry.getAvailable()` → `minimax-cn/MiniMax-M3`
- typebox schema 直接作為 tool parameters，pi 轉為 provider tool schema
- submit 驗證失敗時把錯誤作為 tool result 回給 agent → 自我修正（實測有效）
- `session.subscribe` 事件流可直接驅動現有 `onProgress` 介面
