# Agentic Pipeline 速度優化調研：併發與非同步

日期：2026-07-30
狀態：關鍵假設已實測驗證

---

## 1. 實測證據

### 1.1 單 turn 並行 tool calls = 真併發（`scripts/poc-agentic-concurrency.ts`）

強制 agent 在同一個 response 發出 4 個 3 秒模擬搜尋：

```
alpha: 3463 -> 6464 (3001ms)
beta:  3463 -> 6464 (3001ms)
gamma: 3463 -> 6464 (3001ms)
delta: 3463 -> 6464 (3001ms)
span=3001ms sum=12004ms -> CONCURRENT
```

**pi 會把同一 turn 的多個 tool calls 併發執行**。這意味著「搜尋次數」不等於「耗時」——只要讓 agent 把獨立搜尋批次化到同一 turn。

### 1.2 並行 agents 加速實測（`scripts/poc-agentic-parallel.ts`）

兩個 research agents（Notion / Obsidian，各 3 次批次搜尋）：

```
sequential: A=42.8s B=30.6s total=73.6s
parallel:   A=12.5s B=37.2s total=37.2s
speedup: 1.98x
```

**獨立 sessions 以 `Promise.all` 並行接近理論 2× 加速**（受 MiniMax 延遲方差影響）。hybrid 架構的核心假設成立。

### 1.3 既有 PoC 的行為佐證

Coffee vs Tea PoC 中 MiniMax-M3 已自然地在單 turn 發出 3–4 個並行搜尋（transcript 可見連續 tool calls 之間無 assistant 回合），16 次搜尋實際只佔約 5 個 turn。

## 2. 四層速度槓桿（按收益排序）

### L1 — 混合式並行 agents（最大收益，目標 ~60–120s）

把「單一巨石 agent」拆成**各自 agentic 但職責受限的小 agents**，階段間並行：

```
            ┌─ research agent A ─┐
 POST ──────┤                    ├──── architect ──┬─ analyst dim1 ─┐
            └─ research agent B ─┘   (1 turn)      ├─ analyst dim2 ─┤
                                                   ├─ analyst dim3 ─┼── synthesis
                                                   ├─ analyst dim4 ─┤   (1–2 turns)
                                                   └─ ... (≤6) ────┘
```

- 每個 research agent 保留 web_search 自主性（可補查），輸出 profile + 精煉來源
- 每個 analyst agent 只做一個維度：上下文小 → 單 turn 快；需要時仍可再搜 1–2 次
- 以 `Promise.all` 並行（research 2 個、analyst 上限 3–4 個，沿用現有 concurrency semaphore）
- **預估耗時** = max(researchA, researchB) + architect + max(analysts) + synthesis ≈ **60–120s**，對齊現行 pipeline，但保留 agentic 的搜尋深度與自我修正
- 每個 agent 是獨立 session（in-memory），彼此無共享狀態，天然可並行

### L2 — 搜尋批次化 prompt（單 agent 場景，2–3× 提速）

若保留單一 agent，prompt 明確要求：

> 「把所有彼此獨立的搜尋查詢放在同一個回應中一次發出（parallel tool calls）；每輪最多 4 個查詢。先規劃全部查詢再執行，不要一個一個查。」

PoC 的 16 次搜尋若以 4/turn 批次化，研究階段從 ~16 個序列等待縮到 ~4 個，研究段耗時預估降 60–70%。

### L3 — 非同步 job 架構 + SSE（消除超時、改善體感）

```
POST /api/comparisons        → 202 { runId }（立即返回）
GET  /api/comparisons/:id/events (SSE) → 進度事件流
GET  /api/comparisons/:id    → 最終報告
```

- 背景 worker pool（全域並發 2–4，沿用 semaphore），請求不再卡 60–90s 代理超時
- 進度事件：phase 切換、第 N 次搜尋、analyst 完成即推 partial dimension（現有 partial result UI 可直接承接）
- 使用者體感：立即開始、即時進度，而不是白等 3 分鐘
- 同時解決現行 pipeline 的長連線風險，**兩種模式都受益**

### L4 — 上下文與模型成本（每 turn 更快）

- **來源精煉**：web_search tool 直接回傳壓縮格式（title/url/≤200 字 snippet，每輪 ≤5 條），不要把整頁內容塞進上下文
- **跨 agent 交接用摘要**：research → analyst 只傳 profile + 精煉事實表，不傳原始搜尋全文
- **compaction 開啟**（pi 內建）防上下文膨脹導致後段 turn 變慢
- **雙層模型路由**（hybrid 設計天然支援）：
  - research/搜尋規劃 → `MiniMax-M2.7-highspeed`（快、便宜）
  - analyst/synthesis → `MiniMax-M3`（品質）
- **entity 研究快取**：normalized name + language 24h TTL；熱門實體（iPhone、ChatGPT）重複比較直接命中，研究段歸零

## 3. 預估耗時對比

| 架構 | 研究段 | 分析段 | 總計（預估） |
|---|---|---|---|
| 現行 phase pipeline | 並行 2×1 次 | 並行 4–6 次 | **60–90s** |
| 單一巨石 agent（PoC 現狀） | 16 次搜尋 ~5 turns | 同上下文串行 | **180–240s** |
| 巨石 agent + L2 批次化 | ~4 turns | 串行 | **90–150s** |
| **混合並行 agents（L1+L3+L4）** | 並行 2 agents | 並行 ≤6 agents | **60–120s** |

## 4. 建議實作順序

1. **先做 L3（非同步 + SSE）**：獨立於 agentic，現行 pipeline 也受益，消除超時風險；前端已有 partial result 基礎
2. **L1 混合架構作為 agentic 正式形態**：research/analyst/synthesis agents 各自帶工具自主性但並行編排；程式碼保留確定性並行控制（不讓單一 agent 自己決定全部分支，成本可預測）
3. **L4 配套**：精煉來源格式、雙層模型、entity 快取
4. **L2 作為 prompt 規範**：所有 agent 的系統提示統一要求批次化獨立搜尋

## 5. 護欄（速度優化不能犧牲安全）

- 每個 agent 獨立 turn/tool-call 上限（research ≤8 calls、analyst ≤3 calls）
- 全域 LLM 並發 semaphore 不變（hybrid 高峰 = 2 research + 3 analyst = 5，低於現行 6）
- citation 白名單、schema 驗證、report grant 全部沿用
- 任一 agent 失敗 → 該分支重試一次 → 整體回退 phase pipeline

## 6. 待驗證（下一步 PoC）

- [x] ~~並行 tool calls 是否真併發~~ → **已驗證 CONCURRENT**（§1.1）
- [x] ~~並行 agents 是否真加速~~ → **已驗證 1.98×**（§1.2）
- [ ] hybrid 完整鏈真實耗時（2 research ∥ + architect + 4 analyst ∥ + synthesis）
- [ ] M2.7-highspeed 在 research agent 的品質是否足夠
- [ ] SSE 事件在現有 Nginx/Express 下的連線穩定性（含斷線重連）
