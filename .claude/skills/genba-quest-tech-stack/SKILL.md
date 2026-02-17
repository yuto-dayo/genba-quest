---
name: genba-quest-tech-stack
description: GENBA QUESTの技術スタック定義。依存関係・バージョン確認、新機能追加時の技術選定に参照
---

# Tech Stack - GENBA QUEST

## Overview
建設現場の経費・請求管理をゲーミフィケーションで効率化するWebアプリケーション。

## Frontend

| Category | Technology | Version |
|----------|------------|---------|
| Framework | React | 19.2.0 |
| Build Tool | Vite | 7.2.4 |
| Language | TypeScript | 5.9.3 |
| Routing | React Router | 7.13.0 |
| State Management | Zustand | 5.0.10 |
| Animation | Framer Motion | 12.29.2 |
| Icons | Lucide React | 0.563.0 |
| Styling | CSS Modules | - |
| Linting | ESLint | 9.39.1 |

## Backend

| Category | Technology | Version |
|----------|------------|---------|
| Runtime | Node.js | 20+ |
| Framework | Express | 5.1.0 |
| Language | TypeScript | 5.9.3 |
| Database | PostgreSQL (Supabase) | - |
| ORM/Client | Supabase JS | 2.89.0 |

## AI/ML Services

| Service | SDK | Purpose |
|---------|-----|---------|
| Anthropic Claude | @anthropic-ai/sdk 0.71.2 | AI Sherpa (チャットアシスタント) |
| Google Gemini | @google/generative-ai 0.24.1 | OCR処理 |
| Google APIs | googleapis 144.0.0 | Gmail連携（integration actor） |
| OpenAI | openai 6.17.0 | 補助AI処理 |

## Infrastructure

| Category | Service |
|----------|---------|
| Database | Supabase (PostgreSQL + RLS) |
| Storage | Supabase Storage |
| Auth | Supabase Auth |
| Hosting | TBD |

## Development Tools

| Tool | Purpose |
|------|---------|
| nodemon | Hot reload (backend) |
| ts-node | TypeScript execution |
| Vite | Frontend dev server |

## Key Patterns

- **Frontend**: Page-based components with CSS Modules
- **Backend**: Route-based Express handlers
- **State**: Zustand for client state, Supabase for server state
- **Auth**: JWT tokens via Supabase Auth
