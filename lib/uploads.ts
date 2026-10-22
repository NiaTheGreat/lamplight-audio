import { randomUUID } from "node:crypto";

/** Large EPUBs go browser -> R2 directly (Vercel rejects request bodies over ~4.5 MB). */
export const newUploadKey = () => `uploads/${randomUUID()}.epub`;

export const isUploadKey = (key: unknown): key is string =>
  typeof key === "string" && /^uploads\/[0-9a-f-]{36}\.epub$/.test(key);
