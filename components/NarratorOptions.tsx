import { formatUsd } from "@/lib/narrators-shared";
import type { NarratorGroupInfo } from "./useNarrators";

/**
 * The narrators as `<optgroup>`s, to go inside any `<select>`. Narrators of a provider whose
 * key isn't set are disabled and say so.
 */
export function NarratorOptions({
  groups,
  showPrice = true,
  hideKeyHint = false,
  exclude,
  keep,
  markKept = false,
}: {
  groups: NarratorGroupInfo[];
  /** Put the provider's price per million characters in the group label. */
  showPrice?: boolean;
  /** Don't add "(needs a key)" to unavailable narrators. */
  hideKeyHint?: boolean;
  /** A narrator to leave out (the one already shown as the default). */
  exclude?: string;
  /** A narrator that stays selectable even if its provider has no key (the one already in use). */
  keep?: string;
  /** Add "(current)" to the kept narrator. */
  markKept?: boolean;
}) {
  return (
    <>
      {groups.map((g) => (
        <optgroup
          key={g.provider}
          label={
            showPrice
              ? `${g.label} · about ${formatUsd(g.pricePerMillion)} per million characters`
              : g.label
          }
        >
          {g.narrators
            .filter((n) => n.id !== exclude)
            .map((n) => (
              <option key={n.id} value={n.id} disabled={!g.configured && n.id !== keep}>
                {n.label}
                {markKept && n.id === keep ? " (current)" : ""}
                {g.configured || hideKeyHint ? "" : " (needs a key)"}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}
