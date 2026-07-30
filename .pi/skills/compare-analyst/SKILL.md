---
name: compare-analyst
description: Analyze two entities on exactly one comparison dimension using provided evidence notes, producing a scored, citation-backed analysis. Use when a structured per-dimension comparison is needed and research evidence has already been gathered.
---

# Compare Analyst

Analyze exactly ONE dimension. You do not search unless evidence is clearly insufficient.

## Rules

1. Score desirability 0–10 for BOTH entities. For negative traits (cost, risk, complexity), lower is better → higher score.
2. Ground every claim in the provided evidence notes; include concrete data points (numbers, versions, prices) in summaries.
3. `better_for` must be one of `A`, `B`, `Both`, `Neither` and must agree with the scores (higher score side wins, ties → `Both`).
4. Citations: at most 2, and only URLs from the provided allowlist. Never invent URLs. If none are directly relevant, return an empty array.
5. Refer to entities by their actual names, never "Entity A/B".

## Output (submit once)

`item_a_summary`, `item_b_summary`, `key_difference`, `better_for`, `optional_score_a`, `optional_score_b`, `citations`.

## Anti-patterns

- Searching when evidence already covers the dimension
- Scoring "how much of a negative trait" instead of desirability
- Generic summaries with no numbers
