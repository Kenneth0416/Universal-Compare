# 真實 Pipeline 對照實驗：JSON 多段呼叫 vs MD 分段 vs MD 長任務

日期：2026-07-30
方法：生產式 prompt + DeepSeek `deepseek-v4-flash`（thinking disabled），Notion vs Obsidian，4 維度，三種變體各跑一次（`scripts/poc-pipeline-md-vs-json.ts`）

---

## 1. 實測結果

| 變體 | 呼叫數 | Wall time | Prompt tok | Completion tok | **Total tok** | 解析完整度 |
|---|---|---|---|---|---|---|
| **JSON 多段呼叫**（現行） | 7 | 14259ms | 873 | 1206 | **2079** | 4/4 dims ✓ 全部成功 |
| **MD 分段輸出** | 7 | 11547ms（−19%） | 674 | 715 | **1389（−33%）** | 4/4 dims ✓；verdict 僅 19 字元偏薄 |
| **MD 長任務整份** | **2** | **8740ms（−39%）** | 237 | 787 | **1024（−51%）** | 4/4 dims + pros/cons + verdict ✓ 全部成功 |
| **JSON 長任務整份** | **2** | **9888ms（−31%）** | 288 | 1136 | **1424（−31%）** | 4/4 dims + pros/cons + verdict ✓ schema 強制原生解析 |

## 2. 發現

### 長任務 MD 整份輸出效率顯著更高

- **呼叫數 7 → 2**（−71% 往返）：少 5 次網路 + 排隊 + 每次的系統提示重複
- **Token −51%**：省掉每次呼叫重複帶的任務說明與 schema 開銷（JSON 每段都要重新交代格式）
- **Wall time −39%**：分析與綜合在同一上下文完成，無需等待前段結果再發後段
- 解析完整度滿分：單一大上下文下模型對扁平 MD 模板遵循穩定

### 分段 MD 也省 token（−33%），但品質有隱憂

- 分段後每段上下文單薄，verdict 段只回 19 字元——**沒有 JSON schema 的必填約束時，模型在小上下文會偷懶**
- 換言之：MD 的效率優勢**依賴單次大任務的大上下文**；拆回分段後優勢打折且品質下滑

### JSON 多段的成本結構

- 873 prompt tokens 中大部分是重複的任務說明（7 次）
- 每段都有固定 schema/格式開銷，completion 含大量重複 key
- 換來的是：每段獨立可重試、並行度高（現行 analyst ×6 並行）、結構保證最強

## 3. 對「多段 vs 長任務」的直接回答

| 問題 | 答案 |
|---|---|
| 長任務 MD 是否比現行 JSON 高效？ | **是：token −51%、wall −39%、呼叫 −71%，且本次解析滿分** |
| 多段 MD 是否比現行 JSON 高效？ | token −33% 但品質不穩（必填約束消失後模型偷懶），**不建議** |
| 代價是什麼？ | 長任務 = 單次大輸出，截斷時只能部分打撈（JSON 單段失敗可只重試該段）；結構保證從 schema 強制降為模板 + parser；分析段失去並行（不過本實驗顯示省下的往返更多） |

## 4. 對架構的啟示

這個結果與 agentic 調研相互印證，指向同一方向：

**「一次長任務生成完整報告」本身就是效率最優解**——不論用 MD 還是 JSON。真正的效率差異不在格式，而在**呼叫編排**：

| 方案 | 實測效率 |
|---|---|
| 現行 7–13 次 JSON 分段 | 基準（2079 tok / 14.3s） |
| **MD 長任務（2 次）** | **−51% tok / −39% 時間**，結構保證變弱 |
| **JSON 長任務（2 次）** | **−31% tok / −31% 時間**，保留 schema 強制 |
| Agentic 單 session + submit tool | 同為少次大上下文 + schema 強制 + 自我修正（PoC 已驗證） |

### JSON 長任務整份（第四組對照，已補測）

- 同樣 2 次呼叫：token −31%、wall −31%、解析原生成功且保留 schema 強制
- 比 MD 長任務多 39% token（1424 vs 1024），但**不需要自寫 parser、無模板遵循風險**
- 結論：**效率提升的主因確定是「少次大呼叫」**；MD 比 JSON 再省約 28% token，但代價是結構保證

### 建議的下一步驗證

1. ~~JSON 長任務整份~~ → **已驗證可行且解析滿分**
2. ~~4–6 維度、中文、真實搜尋內容下的品質~~ → **已驗證（§5，EN + zh-CN 均通過生產 validator）**
3. MD 長任務 + remark parser 的錯誤率統計（20+ 次樣本）——非必要，優先落地 JSON 長任務

## 5. 真實 Pipeline 長任務驗證（`scripts/bench-long-task.ts`，真實搜尋 + 生產 validator）

用 MiniMax 真實研究資料 + `normalizeComparisonResult` 生產校驗門檻，EN 與 zh-CN 各一組：

| 變體 | Total tok（EN） | 節省 | Wall | 生產 schema | Citation 白名單 |
|---|---|---|---|---|---|
| 現行多段（analyst ∥3 + synthesis ∥2） | 21782 | — | 15.8s | ✓ | ✓ |
| JSON 長任務（thinking） | 14815 | **−32%** | 29.3s（**較慢**） | ✓ | ✓ |
| JSON 長任務（no-think） | 12387 | **−43%** | **12.9s（較快）** | ✓ | ✓ |

zh-CN（iPhone vs Samsung Galaxy）同樣成立：token −26%（thinking），4 dims，schema ✓，citations ✓，中文品質正常。

**定案結論**：

1. **JSON 長任務（no-think）是同時更省且更快的方案**：token −43%、wall −18%，且通過生產 schema 與 citation 白名單驗證——可作為現行 pipeline 的直接優化
2. thinking 版本雖省 token（−32%）但因單次序列生成完整報告而**更慢**（29s）——thinking 只該留給 architect/final 等小輸出步驟
3. 效率主因確認為「少次大呼叫」（現行 7 次 → 3 次：research/profile 共享 + architect + 1 次全量分析綜合）
4. 前提不變：長任務單次失敗 = 全部重來（多段只需重試單段）；需保留多段 pipeline 作為回退與長維度數場景

**建議落地**：在 `comparisonAgentApi.ts` 新增 long-task 路徑（architect → 單次 no-think 全量分析+pros/cons+verdict），以 `AI_PIPELINE_MODE=long-task|phased` 切換，預期每次比較省約 40% token 且略快；超時/解析失敗自動回退 phased。
