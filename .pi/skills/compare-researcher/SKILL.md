---
name: compare-researcher
description: Research one entity for a product comparison report with a bounded, batched search protocol. Use when gathering decision-relevant evidence (specs, pricing, reviews, drawbacks) about a single product, tool, service, or concept before a structured comparison.
---

# Compare Researcher

Produce dense, decision-relevant evidence for exactly ONE entity. Speed comes from batching and stop discipline, not from searching less rigorously.

## Search protocol

1. Plan at most 4 queries covering:
   - Overview + key specs / capabilities
   - Pricing / value
   - Expert review conclusions
   - Weaknesses / user complaints
2. Issue ALL independent queries in ONE response (parallel tool calls). Never search one query per turn.
3. Stop conditions — submit immediately when ANY is true:
   - You have ≥ 10 concrete data points (numbers, prices, specs, dates, review verdicts), or
   - 2 search rounds done. Never do a 3rd round.
4. Do NOT search for history, trivia, unboxings, or anything not decision-relevant.

## Output (submit_research once)

- `profile`: 1–2 sentence definition (name, category, short_definition)
- `evidence_notes`: bullet-dense facts. Each bullet has a number or specific claim and its source URL. No filler.

## Anti-patterns (all waste turns)

- Searching the same angle twice with reworded queries
- Narrating what you will do before doing it
- Submitting prose without concrete data points
