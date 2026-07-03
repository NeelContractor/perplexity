import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const conversations = new Elysia({ name: "conversations" })
    .use(requireAuth)

    // GET /conversations
    // List all conversations for the logged-in user
    .get("/conversations", async ({ user, set }) => {
        try {
            const userId = user!.id;

            const conversations = await prisma.conversation.findMany({
                where: { userId },
                orderBy: { updatedAt: "desc" },
                select: {
                    id: true,
                    title: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: { select: { messages: true } },
                }
            });

            return { conversations };
        } catch (err) {
            console.error("conversations list error:", err);
            set.status = 500;
            return { error: "Failed to fetch conversations" }
        }
    })

    // GET /conversation/:id
    // Get full conversation with all messages
    .get("/conversation/:id", async ({ params, user, set }) => {
        try {
            const userId = user!.id;
            const { id } = params;

            const conversation = await prisma.conversation.findFirst({
                where: { id, userId },
                include: {
                    messages: {
                        orderBy: { createdAt: "asc" },
                    },
                }
            })

            if (!conversation) {
                set.status = 404;
                return { error: "Conversation not found" };
            }

            return { conversation };
        } catch (err) {
            console.error("conversation fetch error:", err);
            set.status = 500  
            return { error: "Failed to fetch conversation" }
        }
    })

    // PATCH /conversation/:id/title
    // Rename a conversation
    .patch(
        "/conversation/:id/title",
        async ({ params, body, user, set }) => {
            try {
                const userId = user!.id;
                const { id } = params;
                const { title } = body;
        
                if (!title?.trim()) {
                    set.status = 400;
                    return { error: "Title is required" };
                }
        
                const convo = await prisma.conversation.findFirst({
                    where: { id, userId },
                });
        
                if (!convo) {
                    set.status = 404;
                    return { error: "Conversation not found" };
                }
        
                const updated = await prisma.conversation.update({
                    where: { id },
                    data: { title: title.trim() },
                });
        
                return { conversation: updated };
            } catch (err) {
                console.error("rename error:", err);
                set.status = 500;
                return { error: "Failed to rename conversation" };
            }
        },
        {
            body: t.Object({
                title: t.String(),
            }),
        },
    )

    // DELETE / conversation/:id
    // Delete a single conversation and all its messages
    .delete("/conversation/:id", async ({ params, user, set }) => {
        try {
            const userId = user!.id;
            const { id } = params;

            const convo = await prisma.conversation.findFirst({
                where: { id, userId },
            })

            if (!convo) {
                set.status = 404;
                return { error: "Conversation not found" }
            }
            
            await prisma.conversation.delete({ where: { id } });

            return { success: true };
        } catch(err) {
            console.error("delete error:", err);
            set.status = 500
            return { error: "Failed to delete conversation" };
        }
    })

    // DELETE /conversation
    // Delete ALL conversations for the logged-in user
    .delete("/conversations", async ({ user, set }) => {
        try {
            const userId = user!.id;
            await prisma.conversation.deleteMany({ where: { userId } });
            return { success: true }
        } catch(err) {
            console.error("delete all error:", err);
            set.status = 500;
            return { error: "Failed to delete conversations" }
        }
    })