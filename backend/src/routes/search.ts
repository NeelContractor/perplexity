import { Elysia, t } from "elysia";
import { tavily } from "@tavily/core";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "../prompt.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import OpenAI from "openai";

// ─── Clients ─────────────────────────────────────────────────────────────────

// OpenRouter exposes an OpenAI-compatible API — same SDK, different base URL/key.
const openAIClient = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:5173",
    "X-Title": "Perplexity",
  },
});
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sseEvent(event: string, data: object) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ─── Controller ──────────────────────────────────────────────────────────────

export const search = new Elysia({ name: "search" })
  .use(requireAuth)
  .post(
    "/perplexity-ask",
    async ({ body, user, set }) => {
      const { query, conversationId } = body;
      const userId = user!.id;
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: object) => {
            controller.enqueue(encoder.encode(sseEvent(event, data)));
          };

          try {
            let convo = conversationId
              ? await prisma.conversation.findFirst({ where: { id: conversationId, userId } })
              : null;

            if (!convo) {
              convo = await prisma.conversation.create({
                data: { userId, title: query.slice(0, 80) },
              });
            }

            send("conversation", { conversationId: convo.id });

            await prisma.message.create({
              data: { conversationId: convo.id, role: "user", content: query },
            });

            const webResponse = await tavilyClient.search(query, { searchDepth: "advanced" });
            const webResults = webResponse.results;
            send("sources", { sources: webResults });

            const prompt = PROMPT_TEMPLATE
              .replace("{{WEB_RESULT}}", JSON.stringify(webResults))
              .replace("{{USER_QUERY}}", query);

            const history = await prisma.message.findMany({
              where: { conversationId: convo.id },
              orderBy: { createdAt: "asc" },
              take: 10,
              select: { role: true, content: true },
            });

            const llmStream = await openAIClient.chat.completions.create({
              model: OPENROUTER_MODEL,
              stream: true,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
                { role: "user", content: prompt },
              ],
            });

            // Step 7 — Forward only the <answer>...</answer> content, stripping tags
            let rawBuffer = "";
            let cleanAnswer = "";
            let emittedLength = 0;
            let state: "before" | "in" | "done" = "before";

            const OPEN_TAG = "<answer>";
            const CLOSE_TAG = "</answer>";

            for await (const chunk of llmStream) {
              if (state === "done") break;

              const delta = chunk.choices[0]?.delta?.content;
              if (!delta) continue;

              rawBuffer += delta;

              if (state === "before") {
                const idx = rawBuffer.indexOf(OPEN_TAG);
                if (idx === -1) continue;
                rawBuffer = rawBuffer.slice(idx + OPEN_TAG.length);
                state = "in";
              }

              if (state === "in") {
                const endIdx = rawBuffer.indexOf(CLOSE_TAG);
                if (endIdx !== -1) {
                  cleanAnswer = rawBuffer.slice(0, endIdx).trim();
                  const newText = cleanAnswer.slice(emittedLength);
                  if (newText) send("delta", { text: newText });
                  state = "done";
                } else {
                  const safeLength = Math.max(0, rawBuffer.length - (CLOSE_TAG.length - 1));
                  if (safeLength > emittedLength) {
                    const newText = rawBuffer.slice(emittedLength, safeLength);
                    send("delta", { text: newText });
                    emittedLength = safeLength;
                    cleanAnswer = rawBuffer.slice(0, safeLength);
                  }
                }
              }
            }

            const fullResponse = cleanAnswer;

            await Promise.all([
              prisma.message.create({
                data: { conversationId: convo.id, role: "assistant", content: fullResponse, sources: webResults },
              }),
              prisma.conversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } }),
            ]);

            send("done", { conversationId: convo.id });
          } catch (err) {
            console.error("perplexity-ask error:", err);
            send("error", { message: "Something went wrong" });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      });
    },
    {
      body: t.Object({
        query: t.String({ minLength: 1 }),
        conversationId: t.Optional(t.Nullable(t.String())),
      }),
    },
  )


  // POST /perplexity-ask-followups
  // Returns 3 follow-up question suggestions for a conversation
  .post(
    "/perplexity-ask-followups",
    async ({ body, user, set }) => {
      try {
        const { conversationId } = body;
        const userId = user!.id;

        const convo = await prisma.conversation.findFirst({
          where: { id: conversationId, userId },
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
              take: 10,
            },
          },
        });

        if (!convo) {
          set.status = 404;
          return { error: "Conversation not found" };
        }

        const history = convo.messages
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n\n");

        const response = await openAIClient.chat.completions.create({
          model: OPENROUTER_MODEL,
          messages: [
            {
              role: "system",
              content: `You are a helpful assistant. Based on the conversation, suggest exactly 3 concise follow-up questions the user might want to ask next. Respond ONLY with a JSON array of 3 strings. No explanation, no markdown. Example: ["What are the side effects?", "How long does it take?", "Are there alternatives?"]`,
            },
            {
              role: "user",
              content: `Conversation so far:\n${history}\n\nSuggest 3 follow-up questions.`,
            },
          ],
        });

        const raw = response.choices[0]?.message?.content ?? "[]";

        let followups: string[] = [];
        try {
          followups = JSON.parse(raw);
          if (!Array.isArray(followups)) followups = [];
        } catch {
          followups = [];
        }

        return { followups };
      } catch (err) {
        console.error("followups error:", err);
        set.status = 500;
        return { error: "Failed to generate follow-ups" };
      }
    },
    {
      body: t.Object({
        conversationId: t.String(),
      }),
    },
  );