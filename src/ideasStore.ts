import { readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Idea } from "./types";

const emptyIdea = (): Idea => ({
  id: globalThis.crypto.randomUUID(),
  date: todayEu(),
  link: "",
  summary: "",
  good: "",
  bad: "",
  ugly: "",
  result: "",
  source: ""
});

export const createIdea = emptyIdea;

export const buildBootBackupPath = (ideaIndexPath: string): string => {
  const normalized = ideaIndexPath.replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return "__INDEX.boot.bak.md";
  }
  const dir = normalized.slice(0, lastSlash);
  const file = normalized.slice(lastSlash + 1);
  const stem = file.endsWith(".md") ? file.slice(0, -3) : file;
  return `${dir}/${stem}.boot.bak.md`;
};

export const loadIdeasFile = async (ideaIndexPath: string) => {
  const raw = await readTextFile(ideaIndexPath);
  const ideas = parseIdeas(raw);
  return { raw, ideas };
};

export const writeIdeasFile = async (ideaIndexPath: string, ideas: Idea[]) => {
  const sorted = sortIdeas(ideas);
  const html = ideasToHtml(sorted);
  await writeTextFile(ideaIndexPath, `${html}\n`);
};

export const createBootBackup = async (backupPath: string, raw: string) => {
  await writeTextFile(backupPath, raw);
};

export const revertToBootBackup = async (
  backupPath: string,
  ideaIndexPath: string
) => {
  const raw = await readTextFile(backupPath);
  await writeTextFile(ideaIndexPath, raw);
  return parseIdeas(raw);
};

export const removeBootBackup = async (backupPath: string) => {
  try {
    await remove(backupPath);
  } catch {
    // Ignore missing file and cleanup races on shutdown.
  }
};

export const sortIdeas = (ideas: Idea[]) =>
  [...ideas].sort((a, b) => parseDateRank(b.date) - parseDateRank(a.date));

const parseDateRank = (value: string): number => {
  const time = Date.parse(euToIso(normalizeDate(value)));
  return Number.isFinite(time) ? time : 0;
};

const todayEu = (): string => isoToEu(new Date().toISOString().slice(0, 10));

const parseIdeas = (htmlLike: string): Idea[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlLike, "text/html");
  const cards = doc.querySelectorAll(".obix-card, .idea-card, .card");
  if (cards.length === 0) {
    return [];
  }

  return [...cards]
    .map((card) => {
      const isNew =
        card.classList.contains("obix-card") ||
        card.classList.contains("idea-card");
      if (isNew) {
        return {
          id: card.getAttribute("data-id") ?? globalThis.crypto.randomUUID(),
          date: normalizeDate(text(card, ".obix-date, .idea-date")),
          link: attr(card, ".obix-link, .idea-link", "href"),
          summary: text(card, ".obix-summary, .summary"),
          good: text(card, ".obix-good, .good"),
          bad: text(card, ".obix-bad, .bad"),
          ugly: text(card, ".obix-ugly, .ugly"),
          result: text(card, ".obix-result, .result"),
          source: text(card, ".obix-source, .source")
        } as Idea;
      }

      const children = [...card.querySelectorAll(":scope > div")];
      const header = children[0];
      const headerText = header?.textContent?.trim() ?? "";
      const oldDate =
        headerText.match(/^(.+?)(?:\s+\u2014|\s+-\s+)/)?.[1]?.trim() ??
        headerText;
      const oldLink = header?.querySelector("a")?.getAttribute("href") ?? "";
      return {
        id: globalThis.crypto.randomUUID(),
        date: normalizeDate(oldDate),
        link: oldLink,
        summary: children[1]?.textContent?.trim() ?? "",
        good: children[2]?.textContent?.trim() ?? "",
        bad: children[3]?.textContent?.trim() ?? "",
        ugly: children[4]?.textContent?.trim() ?? "",
        result: children[5]?.textContent?.trim() ?? "",
        source: children[6]?.textContent?.trim() ?? ""
      };
    })
    .map((idea) => ({ ...emptyIdea(), ...idea }));
};

const text = (el: Element, selector: string) =>
  el.querySelector(selector)?.textContent?.trim() ?? "";
const attr = (el: Element, selector: string, name: string) =>
  el.querySelector(selector)?.getAttribute(name)?.trim() ?? "";

const normalizeDate = (value: string) => {
  const cleaned = value.trim();
  const euMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (euMatch) {
    const [, dd, mm, yyyy] = euMatch;
    return `${dd.padStart(2, "0")}/${mm.padStart(2, "0")}/${yyyy}`;
  }
  const parsed = Date.parse(cleaned);
  if (!Number.isFinite(parsed)) {
    return todayEu();
  }
  return isoToEu(new Date(parsed).toISOString().slice(0, 10));
};

const isoToEu = (iso: string): string => {
  const [yyyy, mm, dd] = iso.split("-");
  if (!yyyy || !mm || !dd) {
    return todayEu();
  }
  return `${dd}/${mm}/${yyyy}`;
};

const euToIso = (eu: string): string => {
  const match = eu.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return "1970-01-01";
  }
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
};

const esc = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const section = (className: string, value: string) =>
  `<div class="obix-field ${className}">${esc(value)}</div>`;

const ideasToHtml = (ideas: Idea[]) => {
  const legend =
    '<div class="obix-legend"><span>summary</span><span>good</span><span>bad</span><span>ugly</span><span>result</span><span>source</span></div>';

  const cards = ideas
    .map(
      (idea) => `
<div class="obix-card" data-id="${esc(idea.id)}">
  <div class="obix-head">
    <span class="obix-date">${esc(normalizeDate(idea.date))}</span>
    ${
      idea.link.trim()
        ? `<a class="obix-link" href="${esc(idea.link)}">${esc(idea.link)}</a>`
        : ""
    }
  </div>
  ${section("obix-summary", idea.summary)}
  ${section("obix-good", idea.good)}
  ${section("obix-bad", idea.bad)}
  ${section("obix-ugly", idea.ugly)}
  ${section("obix-result", idea.result)}
  ${section("obix-source", idea.source)}
</div>`
    )
    .join("\n");

  return `<div class="obix-index">\n${legend}\n${cards}\n</div>`;
};
