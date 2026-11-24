import "dotenv/config";
import path from "node:path";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { PROVIDER, describeModelError, runAgent, type AgentMessage } from "./agent.js";
import { tokenMatches } from "./auth.js";
import { createPool } from "./db.js";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_STORED_MESSAGES = 80; // keeps each conversation (and its cost) bounded

const db = createPool();
const app = express();

app.set("trust proxy", 1); // correct client IPs behind Render/Railway/AWS load balancers
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/api/health", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// Lets the UI show a "demo mode" note when the scripted model is in use.
app.get("/api/config", (_req, res) => {
  res.json({ provider: PROVIDER });
});

const ChatBody = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(2000),
});

// Each chat call costs money, so limit it per IP.
const chatLimiter = rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false });

app.post("/api/chat", chatLimiter, async (req, res) => {
  const body = ChatBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Send a message between 1 and 2000 characters." });
    return;
  }
  const { conversationId, message } = body.data;

  try {
    let id = conversationId;
    let history: AgentMessage[] = [];

    if (id) {
      const { rows } = await db.query<{ messages: AgentMessage[] }>(
        "SELECT messages FROM conversations WHERE id = $1",
        [id],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "Conversation not found. Start a new chat." });
        return;
      }
      history = rows[0].messages;
    } else {
      const { rows } = await db.query<{ id: string }>("INSERT INTO conversations DEFAULT VALUES RETURNING id");
      id = rows[0].id;
    }

    if (history.length >= MAX_STORED_MESSAGES) {
      res.status(409).json({ error: "This chat is getting long. Please start a new one." });
      return;
    }

    const result = await runAgent(history, message, db);

    await db.query("UPDATE conversations SET messages = $2::jsonb, updated_at = now() WHERE id = $1", [
      id,
      JSON.stringify(result.messages),
    ]);

    res.json({ conversationId: id, reply: result.reply });
  } catch (err) {
    const modelError = describeModelError(err);
    if (modelError) {
      res.status(modelError.status).json({ error: modelError.message });
    } else {
      console.error(err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
});

// --- Admin: list tickets. Protected by a shared token (ADMIN_TOKEN); disabled if it isn't set. ---
const adminLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });

app.get("/api/admin/tickets", adminLimiter, async (req, res) => {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    res.status(404).json({ error: "Admin is disabled. Set ADMIN_TOKEN to enable it." });
    return;
  }
  if (!tokenMatches(req.get("authorization"), expected)) {
    res.status(401).json({ error: "Wrong admin token." });
    return;
  }
  try {
    const { rows } = await db.query(
      "SELECT id, email, subject, summary, priority, created_at FROM tickets ORDER BY created_at DESC LIMIT 200",
    );
    res.json({ tickets: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load tickets." });
  }
});

app.listen(PORT, () => {
  console.log(`Helpdesk agent running on http://localhost:${PORT} (model provider: ${PROVIDER})`);
});
