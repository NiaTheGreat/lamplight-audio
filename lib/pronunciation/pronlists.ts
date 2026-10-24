import { sanitizeLines, type Pron } from "./pronunciation";
import { getObject, putObject } from "../storage/storage";

export type PronList = { id: string; name: string; lines: Pron[] };
export type PronLists = {
  lists: PronList[];
  /** Copied into every new fic unless one is chosen. */ auto?: string;
};

const KEY = "pronlists.json";

export async function getLists(): Promise<PronLists> {
  const raw = await getObject(KEY);
  return raw ? (JSON.parse(raw.toString("utf8")) as PronLists) : { lists: [] };
}

/** Replace all named lists (they're few and small). Ids are made for new lists. */
export async function saveLists(input: unknown): Promise<PronLists> {
  const body = (input ?? {}) as { lists?: unknown; auto?: unknown };
  const seen = new Set<string>();
  const lists: PronList[] = [];
  for (const item of Array.isArray(body.lists) ? body.lists.slice(0, 50) : []) {
    const name = typeof item?.name === "string" ? item.name.trim().slice(0, 60) : "";
    if (!name) continue;
    let id = typeof item.id === "string" && /^[a-z0-9]{6,20}$/.test(item.id) ? item.id : "";
    if (!id || seen.has(id)) id = Math.random().toString(36).slice(2, 10);
    seen.add(id);
    lists.push({ id, name, lines: sanitizeLines(item.lines) });
  }
  const auto = typeof body.auto === "string" && seen.has(body.auto) ? body.auto : undefined;
  const saved: PronLists = { lists, ...(auto ? { auto } : {}) };
  await putObject(KEY, JSON.stringify(saved), "application/json");
  return saved;
}

/** The list a new fic gets: the one chosen ("none" means no list), else the automatic one. */
export async function listForUpload(choice: unknown): Promise<PronList | undefined> {
  if (choice === "none") return undefined;
  const { lists, auto } = await getLists();
  const id = typeof choice === "string" && choice ? choice : auto;
  return lists.find((l) => l.id === id);
}
