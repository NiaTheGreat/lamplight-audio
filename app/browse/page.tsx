"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DetailSheet } from "@/components/browse/DetailSheet";
import { FicCard } from "@/components/browse/FicCard";
import { FilterPanel, lengthLabel } from "@/components/browse/FilterPanel";
import { useBrowseData } from "@/components/browse/useBrowseData";
import { useDialog } from "@/components/Dialog";
import { Icon } from "@/components/Icon";
import { usePlayer } from "@/components/PlayerProvider";
import { VIEW_KEY } from "@/components/reader/useReaderView";
import { writeStore } from "@/components/player/store";
import {
  activeCount,
  applyFilters,
  facets as facetsOf,
  filtersToParams,
  pageSlice,
  parseFilters,
  PAGE_SIZE,
  type Filters,
} from "@/lib/catalog/filter";
import { shelveFic } from "@/lib/client/api";
import { uploadEpub } from "@/lib/client/upload";

type Upload = { name: string; status: "waiting" | "working" | "done" | "failed"; error?: string };

export default function BrowsePage() {
  return (
    <Suspense fallback={<main className="screen wide" />}>
      <Browse />
    </Suspense>
  );
}

function Browse() {
  const router = useRouter();
  const params = useSearchParams();
  const p = usePlayer();
  const dialog = useDialog();
  const data = useBrowseData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);

  const filters = useMemo(() => parseFilters(new URLSearchParams(params.toString())), [params]);
  const setFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    if (!("page" in patch)) next.page = 1;
    const qs = filtersToParams(next).toString();
    router.replace(qs ? `/browse?${qs}` : "/browse", { scroll: false });
  };

  // The search box keeps its own text and updates the address a moment after typing stops.
  const [q, setQ] = useState(filters.q);
  useEffect(() => setQ(filters.q), [filters.q]);
  useEffect(() => {
    if (q === filters.q) return;
    const t = setTimeout(() => setFilters({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const matches = useMemo(
    () => applyFilters(data.items, filters, data.ctx),
    [data.items, filters, data.ctx],
  );
  const facets = useMemo(() => facetsOf(data.items), [data.items]);
  const { rows, pages, page } = pageSlice(matches, filters.page);
  const applied = activeCount(filters);
  const open = openId ? data.items.find((i) => i.id === openId) : undefined;

  function readFic(id: string, chapter: number) {
    writeStore(VIEW_KEY, "read");
    router.push(`/book/${id}?chapter=${chapter}`);
  }
  async function narrate(id: string) {
    try {
      await shelveFic(id);
    } catch (err) {
      await dialog.notify(
        "Couldn't get it ready",
        err instanceof Error ? err.message : "Try again.",
      );
      return;
    }
    await p.refreshLibrary();
    router.push(`/book/${id}/narrating`);
  }
  async function listen(id: string) {
    router.push(`/book/${id}`);
    await p.openBook(id);
  }

  async function addFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setUploads(list.map((f) => ({ name: f.name, status: "waiting" })));
    for (let i = 0; i < list.length; i++) {
      setUploads((u) => u.map((x, j) => (j === i ? { ...x, status: "working" } : x)));
      const r = await uploadEpub(list[i], { browse: true });
      setUploads((u) =>
        u.map((x, j) =>
          j === i
            ? r.ok
              ? { ...x, status: "done" }
              : { ...x, status: "failed", error: r.error }
            : x,
        ),
      );
    }
    await data.reload();
    if (fileRef.current) fileRef.current.value = "";
  }

  const chips: { label: string; clear: Partial<Filters> }[] = [
    ...(filters.q ? [{ label: `“${filters.q}”`, clear: { q: "" } }] : []),
    ...(filters.lang ? [{ label: filters.lang, clear: { lang: "" } }] : []),
    ...(filters.fandom ? [{ label: filters.fandom, clear: { fandom: "" } }] : []),
    ...(filters.minWords !== undefined || filters.maxWords !== undefined
      ? [{ label: lengthLabel(filters), clear: { minWords: undefined, maxWords: undefined } }]
      : []),
    ...(filters.complete ? [{ label: "Complete", clear: { complete: false } }] : []),
    ...filters.rating.map((r) => ({
      label: r,
      clear: { rating: filters.rating.filter((x) => x !== r) },
    })),
    ...filters.include.map((t) => ({
      label: t,
      clear: { include: filters.include.filter((x) => x !== t) },
    })),
    ...filters.exclude.map((t) => ({
      label: `not ${t}`,
      clear: { exclude: filters.exclude.filter((x) => x !== t) },
    })),
    ...(filters.read
      ? [
          {
            label: { unread: "Unread", reading: "In progress", finished: "Finished" }[filters.read],
            clear: { read: "" as const },
          },
        ]
      : []),
    ...(filters.narr
      ? [
          {
            label: { none: "Not narrated", partly: "Partly narrated", full: "Fully narrated" }[
              filters.narr
            ],
            clear: { narr: "" as const },
          },
        ]
      : []),
  ];

  const from = matches.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(matches.length, page * PAGE_SIZE);
  const working = uploads.some((u) => u.status === "working" || u.status === "waiting");

  return (
    <main className="screen wide browse">
      <div className="bw-head">
        <div>
          <div className="eyebrow">Your library</div>
          <h1 className="display">Browse</h1>
        </div>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={working}>
          <Icon name="add" size={20} />
          Add EPUBs
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".epub,application/epub+zip"
          hidden
          aria-label="Choose EPUB files"
          onChange={(e) => void addFiles(e.target.files)}
        />
      </div>

      {uploads.length > 0 ? (
        <div className="banner bw-uploads" role="status">
          <div className="grow">
            {working
              ? `Adding ${uploads.filter((u) => u.status === "done" || u.status === "failed").length + 1} of ${uploads.length}…`
              : `Added ${uploads.filter((u) => u.status === "done").length} of ${uploads.length}.`}
            {uploads
              .filter((u) => u.status === "failed")
              .map((u) => (
                <div key={u.name} className="error" style={{ marginTop: 6 }}>
                  {u.name}: {u.error}
                </div>
              ))}
          </div>
          {!working ? (
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setUploads([])}>
              <Icon name="close" />
            </button>
          ) : null}
        </div>
      ) : null}
      {data.backfill ? (
        <div className="banner" role="status">
          <span className="grow">
            Reading details of your earlier books… {data.backfill.done} of {data.backfill.total}
          </span>
        </div>
      ) : null}
      {data.error ? (
        <p className="error" role="alert">
          {data.error}
        </p>
      ) : null}

      <div className="bw-cols">
        <aside className="bw-side" aria-label="Filters">
          <FilterPanel filters={filters} facets={facets} set={setFilters} />
        </aside>

        <section className="bw-main">
          <div className="bw-count" aria-live="polite">
            {!data.loaded
              ? "Loading…"
              : data.items.length === 0
                ? ""
                : applied > 0
                  ? `${matches.length} of ${data.items.length} fics · showing ${from}–${to}`
                  : `${data.items.length} fics · showing ${from}–${to}`}
          </div>
          <div className="bw-search">
            <input
              className="bw-input"
              type="search"
              placeholder="Search title, author, tags"
              aria-label="Search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="bw-filter-btn" onClick={() => setSheet(true)} aria-label="Filters">
              <Icon name="settings" size={20} />
              {applied > 0 ? <em>{applied}</em> : null}
            </button>
          </div>
          <div className="bw-seg4" role="group" aria-label="Reading state">
            {(
              [
                ["", "All"],
                ["unread", "Unread"],
                ["reading", "Reading"],
                ["finished", "Finished"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className={filters.read === k ? "on" : ""}
                aria-pressed={filters.read === k}
                onClick={() => setFilters({ read: k })}
              >
                {label}
              </button>
            ))}
          </div>
          {chips.length > 0 ? (
            <div className="bw-active">
              {chips.map((c) => (
                <button key={c.label} className="bw-chip on" onClick={() => setFilters(c.clear)}>
                  {c.label} <Icon name="close" size={12} />
                </button>
              ))}
            </div>
          ) : null}

          {data.loaded && data.items.length === 0 ? (
            <p className="empty">
              Nothing in your library yet. Add EPUBs to browse them here, read them, and narrate the
              ones you pick.
            </p>
          ) : null}
          {data.loaded && data.items.length > 0 && matches.length === 0 ? (
            <p className="empty">
              Nothing matches.{" "}
              <button className="bw-link" onClick={() => router.replace("/browse")}>
                Reset filters
              </button>
            </p>
          ) : null}

          <div className="bw-list">
            {rows.map((item) => (
              <FicCard
                key={item.id}
                item={item}
                state={data.ctx.read(item.id)}
                shelf={data.shelf.get(item.id)}
                voice={p.settings.voice}
                reader={data.reader}
                onOpen={() => setOpenId(item.id)}
                onRead={() => readFic(item.id, data.ctx.read(item.id).chapter)}
                onNarrate={() => void narrate(item.id)}
                onListen={() => void listen(item.id)}
              />
            ))}
          </div>

          {pages > 1 ? (
            <nav className="bw-pager" aria-label="Pages">
              <button disabled={page <= 1} onClick={() => setFilters({ page: page - 1 })}>
                ‹ Previous
              </button>
              {Array.from({ length: pages }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1)
                .map((n, i, all) => (
                  <span key={n} className="bw-pg-wrap">
                    {i > 0 && n - all[i - 1] > 1 ? <span className="faint">…</span> : null}
                    <button
                      className={n === page ? "cur" : ""}
                      aria-current={n === page ? "page" : undefined}
                      onClick={() => setFilters({ page: n })}
                    >
                      {n}
                    </button>
                  </span>
                ))}
              <button disabled={page >= pages} onClick={() => setFilters({ page: page + 1 })}>
                Next ›
              </button>
            </nav>
          ) : null}
        </section>
      </div>

      {sheet ? (
        <div className="bw-sheet-back" onClick={() => setSheet(false)}>
          <div
            className="bw-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bw-grab" aria-hidden="true" />
            <div className="bw-sheet-head">
              <div className="display" style={{ fontSize: 26 }}>
                Filters
              </div>
              <button
                className="icon-btn"
                aria-label="Close filters"
                onClick={() => setSheet(false)}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="bw-scroll">
              <FilterPanel filters={filters} facets={facets} set={setFilters} />
            </div>
            <div className="bw-foot">
              <button className="btn primary block" onClick={() => setSheet(false)}>
                Show {matches.length} fic{matches.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {open ? (
        <DetailSheet
          item={open}
          state={data.ctx.read(open.id)}
          entry={data.reading[open.id]}
          shelf={data.shelf.get(open.id)}
          voice={p.settings.voice}
          reader={data.reader}
          onClose={() => setOpenId(null)}
          onChanged={() => void data.reload().then(() => p.refreshLibrary())}
          onRead={(chapter) => readFic(open.id, chapter)}
          onNarrate={() => void narrate(open.id)}
          onListen={() => void listen(open.id)}
        />
      ) : null}
    </main>
  );
}
