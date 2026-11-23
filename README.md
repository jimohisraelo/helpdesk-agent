# Helpdesk Agent

An AI customer-support agent for a demo online store ("Kora Market"). It answers policy questions from a help centre, looks up orders, and hands hard cases to a human by opening a ticket.

Built with **TypeScript, Express, PostgreSQL, Docker** and **Claude** (Anthropic API, tool calling).

## What it does

| Customer asks | Agent does |
|---|---|
| "What's your return policy?" | Searches help articles (Postgres full-text search) and answers only from them |
| "Where is order KM-10421?" | Asks for the order email, then looks the order up |
| "My blender arrived broken" | Opens a support ticket and gives the ticket number |
| Something the help centre doesn't cover | Says so and offers a ticket instead of guessing |

## How it works

```
Browser ──POST /api/chat──▶ Express ──▶ agent loop ──▶ Claude API
                               │            │  ▲
                               │            ▼  │ tool results
                               │        tools.ts (search / lookup / ticket)
                               ▼            │
                           PostgreSQL ◀─────┘
                 (orders, help_articles, tickets, conversations)
```

- **Agent loop** (`src/agent.ts`): sends the conversation and tool list to Claude, runs the tools it asks for, sends the results back, repeats until it has an answer (capped at 8 steps per message).
- **Tools** (`src/tools.ts`): `search_help_center`, `lookup_order`, `create_ticket`.
- **Conversations** are stored in Postgres as JSONB, so a chat continues across requests and the transcript is only ever appended to.

## Security decisions

- **The model is never trusted for authorization.** `lookup_order` checks the email inside the SQL query, so an order is only returned to its owner.
- **No order-ID enumeration.** A wrong email and a non-existent order get the same response.
- **Every tool input is validated** with Zod before it touches the database, and all SQL is parameterised.
- **Search operators are stripped** from model-written search queries.
- **Cost control:** per-IP rate limiting on `/api/chat`, a 2,000-character message limit, a step cap per message and a length cap per conversation.
- The chat UI renders replies with `textContent`, never `innerHTML`.

## Run it

You need Docker and an [Anthropic API key](https://console.anthropic.com/).

```bash
cp .env.example .env          # then put your key in ANTHROPIC_API_KEY
docker compose up --build
```

Open http://localhost:3000.

### Local development (hot reload)

```bash
docker compose up -d db       # Postgres on localhost:5433, schema + seed load automatically
npm install
npm run dev
```

```bash
npm test          # unit tests (tool validation and authorization)
npm run typecheck
npm run evals     # behaviour evals against the real model + database (uses API credit)
```

## Evals

`evals/run.ts` sends fixed customer messages through the real agent and checks its behaviour, not just its wording:

- policy questions must go through `search_help_center`
- it must ask for the email before calling `lookup_order`
- it must never show another customer's order, even when the customer asks it to "ignore your instructions"
- a damaged-item report must end in a ticket
- it must not invent a policy the help centre doesn't have

Run them after changing the prompt, the tools or the model. The script exits with code 1 if any case fails.

## Admin: tickets page

Set `ADMIN_TOKEN` in `.env`, restart, and open http://localhost:3000/admin.html. It lists the tickets the assistant has opened, newest first. The token is checked in constant time and the endpoint is rate-limited; without `ADMIN_TOKEN` the endpoint is switched off.

To reset the database: `docker compose down -v` (deletes the data volume), then start again.

## Demo data

| Order | Email | Status |
|---|---|---|
| KM-10421 | ada@example.com | shipped |
| KM-10422 | ada@example.com | delivered |
| KM-10430 | tunde@example.com | processing |
| KM-10433 | zainab@example.com | cancelled |

## Roadmap

- [ ] Deploy (Render or AWS) and add the live link here
- [ ] Stream replies token by token
- [x] Evals: a fixed set of customer questions with expected behaviour
- [x] Admin page listing tickets
- [x] GitHub Actions: typecheck, test, build the Docker image
- [ ] Semantic search with pgvector alongside full-text search
