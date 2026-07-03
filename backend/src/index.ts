import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors"
import dotenv from "dotenv"
import { health } from "./routes/health";
import { search } from "./routes/search";
import { conversations } from "./routes/conversations";

dotenv.config()

const app = new Elysia()
  .use(
    cors({
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
      methods: ["GET", "POST", "DELETE", "PATCH"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  )
  .use(health)
  .use(search)
  .use(conversations)
  .listen(process.env.PORT ? Number(process.env.PORT) : 3000);

console.log(
  `Server running at http://${app.server?.hostname}:${app.server?.port}`,
);
