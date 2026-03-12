# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CompareAI is a React + Vite + TypeScript web application that uses Grok AI to compare any two entities (products, concepts, etc.) through a multi-agent AI pipeline.

## Development Commands

```bash
# Install dependencies
npm install

# Run development server (port 3000)
npm run dev

# Type checking
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview

# Clean build artifacts
npm run clean
```

## Environment Setup

Create `.env.local` with:
```
XAI_API_KEY=your_api_key_here
```

The API key is injected at build time via Vite's `define` config.

## Architecture

### Multi-Agent AI Pipeline

The comparison process uses a 4-phase agent system in `src/services/geminiService.ts`:

1. **Phase 1 - Dual-Track Research**: Two `ResearcherAgent` calls run concurrently to profile each entity using web search
2. **Phase 2 - Framework Architecture**: `ArchitectAgent` determines relationship type and generates 4-6 tailored comparison dimensions
3. **Phase 3 - Multi-Dimensional Analysis**: `AnalystAgent` analyzes each dimension concurrently (limited to 3 concurrent requests to avoid rate limits)
4. **Phase 4 - Synthesis**: `ProsConsAgent` and `RecommendationAgent` run in parallel to generate final verdict

All agents use structured JSON Schema outputs with `grok-4-1-fast-reasoning` model.

### Component Structure

- `App.tsx`: Main application with form input and result display
- `components/ComparisonGrid.tsx`: Responsive grid layout for dimension cards
- `components/ComparisonCard.tsx`: Individual dimension comparison card
- `components/DimensionChart.tsx`: Recharts-based radar/bar chart for dimension scores
- `components/AILoadingState.tsx`: Animated loading state with progress steps
- `services/geminiService.ts`: All AI agent logic and API calls

### Key Technical Details

- **Concurrency Control**: `mapConcurrent` helper limits parallel API calls to avoid rate limits
- **Progress Tracking**: `onProgress` callback provides real-time status updates to UI
- **Type Safety**: Full TypeScript coverage with `ComparisonResult` interface defining the entire data structure
- **Styling**: Tailwind CSS 4 with custom glassmorphism effects and Motion animations
- **HMR**: Can be disabled via `DISABLE_HMR=true` env var (used in AI Studio)

## Code Conventions

- Use functional React components with hooks
- Prefer `async/await` over promise chains
- Keep components focused: UI components in `components/`, business logic in `services/`
- Use Tailwind utility classes; avoid custom CSS
- Icons from `lucide-react` library
- Animations via `motion/react` (Framer Motion)

## Common Modifications

**Adding a new comparison dimension**: Modify the `ArchitectAgent` prompt in `geminiService.ts` to guide dimension generation, or adjust the `frameworkSchema` if changing the data structure.

**Changing AI model**: Update `model: 'grok-4-1-fast-reasoning'` in all agent functions. Current Grok models include `grok-4-1-fast-reasoning`, `grok-4-1-fast-non-reasoning`, `grok-4-fast-reasoning`, `grok-4-fast-non-reasoning`, `grok-code-fast-1`, `grok-4`, `grok-3`, `grok-3-mini`, `grok-2-vision-1212`, `grok-2-image-1212`, `grok-2-1212`, `grok-vision-beta`, and `grok-beta`. Note that schema support and tool availability vary by model.

**Adjusting concurrency**: Change the limit in `mapConcurrent(framework.dimensions, 3, ...)` - higher values may hit rate limits.

**Modifying UI layout**: Main sections are in `App.tsx` lines 139-341. Each section (verdict, dimensions, pros/cons, recommendations) is independently styled.
