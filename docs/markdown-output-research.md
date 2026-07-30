# 輸出格式調研：LLM 輸出 Markdown 解析為前端元素 vs 結構化 JSON

日期：2026-07-30
方法：真實 API 對照實驗（DeepSeek `deepseek-v4-flash`，thinking disabled，同任務同模型）
結論：**技術可行，但對核心資料路徑不建議採用；只吸收兩個局部優點。**

---

## 1. 實驗數據

### 1.1 完整輸出對照（`scripts/poc-md-vs-json.ts`，2 維度小型報告）

| 指標 | JSON | Markdown | 差異 |
|---|---|---|---|
| Wall time | 3986ms | 4132ms | MD +3.7% |
| Prompt tokens | 151 | 200 | **MD +32%**（模板說明書開銷） |
| Completion tokens | 500 | 429 | MD −14%（結構符號更少） |
| Total tokens | 651 | 629 | 幾乎打平（−3%） |
| 解析結果 | 2/2 dims、2/2 sources、verdict ✓ | 2/2 dims、2/2 sources、verdict ✓ | 相同 |
| 欄位內容品質 | 正常 | 正常（敘述自然度無可量化差異） | — |

**token 與延遲上兩者基本打平**：MD 省一點生成 token，但要付出模板說明書的 prompt 成本；模型越大、報告越長，模板說明書佔比越低，MD 略省但不顯著。

### 1.2 截斷容錯（max_tokens=300 強制截斷，4 維度長文）

| | JSON | Markdown |
|---|---|---|
| finish_reason | length | length |
| 結果 | **TOTAL LOSS**（`JSON.parse` 失敗，整份不可用） | **部分打撈**（1/4 完整維度可用） |

**這是 MD 唯一的實質優勢**：流式/截斷場景下可以邊產邊用、壞掉只丟尾部；JSON 截斷即全毀。

### 1.3 解析器可靠性（實驗副產物，重要）

- 模型對**簡單扁平模板**遵循度極佳（heading + bullet + score/table 格式穩定）
- 但第一版手寫 parser 在格式良好的 MD 上仍然解析失敗（em-dash、空白、citation 格式邊界）→ **parser 脆弱性是真實工程成本**，正式採用必須用 remark/micromark 級 parser + 嚴格模板 + 修復重試，而不是正則
- JSON 路徑：provider 層 `json_schema`/`json_object` 強制 + 現有 validator，parse 層面零自定義代碼

## 2. 對本專案的適配性分析

本專案前端不只是「渲染文字」：

- **雷達圖/分數條/海報**：需要精確數值（0–10 score），MD 解析出來的數字還要二次校驗
- **SEO/OG/JSON-LD**：需要穩定結構欄位
- **citation 白名單**：URL 必須精確匹配搜尋結果，MD link 解析多一層失真風險
- **proof chain / finalize grant**：建立在確定性序列化上，MD 無 canonical form（同義排版差異會改變 hash）

也就是說，MD 並不能「直接變成前端元素」——它必須先被解析回**同一個 ComparisonResult**，等於在 JSON 路徑上**額外插入一層有損解析**：

```
JSON 路徑：LLM → schema 強制 → validator → 前端
MD 路徑： LLM → MD 模板 → 自寫 parser（有損） → 同一 validator → 前端
```

## 3. 性能與效果結論

| 維度 | 結論 |
|---|---|
| Token 成本 | 打平（±5%），無顯著收益 |
| 延遲 | 打平（生成時間相近；parser CPU 成本可忽略，<5ms） |
| 輸出品質 | 無可測差異；小模板下模型對兩者遵循度都滿分 |
| 可靠性 | JSON 明顯更優（parse 保證 + 零自寫代碼）；MD 需 parser + 修復重試 |
| 截斷容錯 | **MD 明顯更優**（部分打撈 vs 全毀） |
| 可串流展示 | MD 可逐段顯示給人看；JSON 需等完整（但本專案已有 partial result 機制用結構化事件流解決） |
| 除錯/可讀性 | MD 對人類友善，log 可直接讀 |

## 4. 建議

**核心資料路徑維持 JSON（含 agentic submit tool）**，理由：token/速度無收益、解析可靠性倒退、proof chain 依賴確定性序列化。

吸收兩個 MD 的優點，不改主架構：

1. **截斷韌性思路**：現有 partial-result 降級已覆蓋此場景（階段失敗保留已完成維度），無需換格式；agentic 模式再把「agent 超時被 abort」設計為可提交已完成部分的降級提交即可。
2. **敘事段落可選 MD**：若未來想給 `long_verdict` 支援富文本（粗體/連結），可以只讓該欄位是 MD 字串並在前端安全渲染——欄位級 MD，而非整份報告 MD。

**不建議**把整份報告 wire format 換成 MD：工程成本（parser、驗證、proof chain 重構）大，收益（截斷打撈、人類可讀）可由現有機制以更低成本取得。

## 附：實驗產物

- `scripts/poc-md-vs-json.ts` — 完整對照實驗（可復跑）
- 原始輸出存於實驗期 `/tmp/exp-*.txt`、`/tmp/trunc-*.txt`
