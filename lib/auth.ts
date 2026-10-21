// Edge-safe helpers (Web Crypto only) shared by middleware and the login route.
export const AUTH_COOKIE = "abg_auth";

export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`audiobook-generator:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
