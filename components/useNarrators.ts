"use client";

import { useEffect, useState } from "react";
import { NARRATOR_GROUPS, type NarratorGroup } from "@/lib/narrators-shared";
import { getNarrators } from "@/lib/client/api";

export type NarratorGroupInfo = NarratorGroup & { configured: boolean; keyName?: string };

/**
 * The narrators on offer and whether each provider's key is set on the server. Until the
 * server answers, every group is assumed available so the lists never flash empty.
 */
export function useNarrators(): NarratorGroupInfo[] {
  const [groups, setGroups] = useState<NarratorGroupInfo[]>(
    NARRATOR_GROUPS.map((g) => ({ ...g, configured: true })),
  );
  useEffect(() => {
    let alive = true;
    void getNarrators().then((g) => alive && g && setGroups(g));
    return () => {
      alive = false;
    };
  }, []);
  return groups;
}
