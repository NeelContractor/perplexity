import { Elysia } from "elysia"
import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"

dotenv.config()

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Resolve the Supabase user (if any) from the Authorization header and
// attaches it to context as `user`. Never throws - attaches `null` when
// the token is missing/invalid so a guard can decide what to do with that.
export const authPlugin = new Elysia({ name: "auth" }).derive(
    { as: "global" },
    async ({ headers }) => {
        const token = headers.authorization?.split('Bearer ')[1];

        if (!token) return { user: null };

        const { 
            data: { user },
            error,
        } = await supabase.auth.getUser(token);

        return { user: error ? null : user };
    },
);

// Guard plugin - `.use(requireAuth)` on any route/group that needs auth.
// Short-circuits with 401 before the handler runs if no valid user resolved.
export const requireAuth = new Elysia({ name: "requireAuth" })
    .use(authPlugin)
    .onBeforeHandle({ as: "global" }, ({ user, set }) => {
        if (!user) {
            set.status = 401;
            return { error: "Unauthorized" };
        }
    })