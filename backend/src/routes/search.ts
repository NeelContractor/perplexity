import { Elysia, t } from "elysia"
// import OpenRouter from "openrouter"
import { tavily } from "@tavily/core"
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "../prompt.js"
import { prisma } from "../lib/prisma.js"
import { requireAuth } from "../middleware/auth.js"
import OpenAI from "openai"

//  Client
// const openRouterClient = new OpenRouter
const openAIClient = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:5173", // TODO fix this if needed
        "X-Title": "Purplexity",
    },
});
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! });

// Helpers
function sseEvent(event: string, data: object) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Controller
export const search = new Elysia({ name: "search" })
    .use(requireAuth)

    // POST / perplexity-ask
    // Main route - web search + LLM stream, saves to DB
    .post(
        "/perplexity-ask",
        async function* ({ body, user, set }) {
            const { query, conversationId } = body;
            const userId = user!.id;

            set.headers["content-type"] = "text/event-stream";
            set.headers["cache-control"] = "no-cache";
            set.headers["connection"] = "keep-alive";

            try {
                // Step 1 - Resolve or create conversation
                let convo = conversationId 
                    ? await prisma.conversation.findFirst({
                        where: { id: conversationId, userId }
                    })
                    : null;
                
                if (!convo) {
                    convo = await prisma.conversation.create({
                        data: {
                            userId,
                            title: query.slice(0, 80),
                        }
                    })
                }

                yield sseEvent("conversation", {conversationId: convo.id});

                // Step 2 - Save user message
                await prisma.message.create({
                    data: {
                        conversationId: convo.id,
                        role: "user",
                        content: query,
                    }
                });

                // Step 3 - Web search
                const webResponse = await tavilyClient.search(query, {
                    searchDepth: "advanced",
                });
                const webResults = webResponse.results
                yield sseEvent("source", { source: webResults });

                // Step 4 - Build prompt
                const prompt = PROMPT_TEMPLATE.replace(
                    "{{WEB_RESULT}}",
                    JSON.stringify(webResults),
                ).replace("{{USER_QUERY}}", query);

                // Step 5 - Load conversation history for multi-tur context
                const history = await prisma.message.findMany({
                    where: { conversationId: convo.id },
                    orderBy: { createdAt: "asc" },
                    take: 10,
                    select: { role: true, content: true }
                })

                // Step 6 - Stream LLM response
                const stream = await openAIClient.chat.completions.create({
                    model: OPENROUTER_MODEL,
                    stream: true,
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        ...history.map((m) => ({
                            role: m.role as "user" | "assistant",
                            content: m.content,
                        })),
                        { role: "user", content: prompt },
                    ],
                });

                // Step 7 - Forward chunks + accumulate full response
                let fullResponse = "";
                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta?.content;
                    if (delta) {
                        fullResponse += delta;
                        yield sseEvent("delta", { text: delta });
                    }
                }

                // Step 8 - Save assistant message + bump conversation updatedAt
                await Promise.all([
                    prisma.message.create({
                        data: {
                            conversationId: convo.id,
                            role: "assistant",
                            content: fullResponse,
                            sources: webResults,
                        },
                    }),
                    prisma.conversation.update({
                        where: { id: convo.id },
                        data: { updatedAt: new Date() },
                    })
                ])

                yield sseEvent("done", { conversationId: convo.id });
            } catch (err) {
                console.error("perplexity-ask error:", err);
                yield sseEvent("event", { message: "Something went wrong" });
            }
        },
        {
            body: t.Object({
                query: t.String({ minLength: 1 }),
                conversationId: t.Optional(t.String())
            }),
        },
    )

    // POST /perplexity-ask-followups
    // Returns 3 follow-up question suggestions for a conversation
    .post("perplexity-ask-followups",
        async ({ body, user, set }) => {
            try {
                const { conversactionId } = body;
                const userId = user!.id;

                const convo = await prisma.conversation.findFirst({
                    where: { id: conversactionId, userId },
                    include: {
                        messages: {
                            orderBy: { createdAt: "asc" },
                            take: 10,
                        }
                    }
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
                            "content": `You are a helpful assistant. Based on the conversation, suggest exactly 3 concise follow-up questions the user might want to ask next. Respond ONLY woth a JSON array of 3 strings. No explanation, no markdown, EXample ["What are the side effects?", "How lond does it take?", "Are there alternatives?"]`,
                        },
                        {
                            "role": "user",
                            "content": `Conversation so far:\n${history}\n\nSuggest 3 folloe-up questions.`,
                        }
                    ]
                })

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
                console.error("folloeups error:", err);
                set.status = 500;
                return { error: "Failed to generate follow-ups" };
            }
        }, 
        {
            body: t.Object({
                conversactionId: t.String()
            })
        }
    )