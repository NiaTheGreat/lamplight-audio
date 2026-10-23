import { request, type FullConfig } from "@playwright/test";

/** Log in once and keep the cookie for every test; leave the app with an empty shelf. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post("/api/login", { form: { password: "e2e-password" }, maxRedirects: 0 });
  if (res.status() !== 303) throw new Error(`Login failed (${res.status()})`);
  await ctx.storageState({ path: ".e2e-results/auth.json" });
  // A server left running from an earlier run still has its books: start from an empty shelf.
  const books = (await (await ctx.get("/api/books")).json()) as { id: string }[];
  for (const b of books) await ctx.delete(`/api/books/${b.id}`);
  await ctx.put("/api/pronunciation-lists", { data: { lists: [] } });
  await ctx.dispose();
}
