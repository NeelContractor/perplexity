import { Elysia } from "elysia";
 
export const health = new Elysia({ name: "health" }).get("/health", () => ({
  status: "ok",
}));