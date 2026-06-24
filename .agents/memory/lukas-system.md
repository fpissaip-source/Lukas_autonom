---
name: Lukas System Architecture
description: Stack, ports, routes, and key decisions for the Lukas AI system in Replit
---

## Stack
- Frontend: React + Vite at `artifacts/lukas-ui`, port 18186, previewPath "/"
- Backend: Express 5 at `artifacts/api-server`, port 8080 (proxied via port 80)
- DB: PostgreSQL via Drizzle ORM, schema in `lib/db/src/schema/lukas.ts`
- AI: Anthropic via `@workspace/integrations-anthropic-ai` (no user key needed)
- API Client: Generated hooks in `lib/api-client-react/src/generated/api.ts`

## Key Routes
- GET/POST `/api/lukas/memories` — Lukas memory bank
- GET/POST/PATCH/DELETE `/api/lukas/goals` — Active directives
- GET `/api/lukas/diary` — Diary entries
- GET `/api/lukas/dashboard` — Aggregated dashboard data
- POST `/api/higgsfield/generate-prompt` — Claude generates Higgsfield prompt from vision
- POST `/api/higgsfield/generate` — Submit to Higgsfield API
- GET `/api/higgsfield/status/:requestId` — Poll job status
- POST `/api/anthropic/conversations/:id/messages` — SSE streaming chat (claude-sonnet-4-6)

## SSE Chat Pattern
Returns `text/event-stream`. Client reads chunks: `data: {"content": "..."}` then `data: {"done": true}`.
Uses `claude-sonnet-4-6` for chat, `claude-opus-4-8` for Higgsfield prompt generation.

## DB Tables
`lukas_memories`, `lukas_goals`, `lukas_diary`, `lukas_media_jobs`, `lukas_status`, `conversations`, `messages`

**Why:** Keeping architecture documented because this is a large multi-service system with non-obvious routing.
