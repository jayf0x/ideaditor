import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { loadConfig } from "./config";
import {
  buildBootBackupPath,
  createBootBackup,
  createIdea,
  loadIdeasFile,
  removeBootBackup,
  revertToBootBackup,
  sortIdeas,
  writeIdeasFile
} from "./ideasStore";
import type { Idea, IdeaField } from "./types";

type SaveState = "idle" | "saving" | "saved" | "error";
type DragSide = "left" | "right";

type TreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
};

export function App() {
  const config = useMemo(loadConfig, []);
  const backupPath = useMemo(
    () =>
      config.ideaIndexPath
        ? buildBootBackupPath(config.ideaIndexPath)
        : "__INDEX.boot.bak.md",
    [config.ideaIndexPath]
  );

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errors, setErrors] = useState<string[]>(config.errors);
  const [ready, setReady] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(300);
  const [sidebarsEnabled, setSidebarsEnabled] = useState(
    Boolean(config.obsidianPath)
  );
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [fileQuery, setFileQuery] = useState("");
  const [selectedMdPath, setSelectedMdPath] = useState("");
  const [previewMd, setPreviewMd] = useState(
    "# Markdown Preview\nPick a .md file from the right pane."
  );
  const [toast, setToast] = useState("");
  const [dirty, setDirty] = useState(false);

  const workspaceRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ side: DragSide } | null>(null);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const closeBypassRef = useRef(false);
  const leftRestoreRef = useRef(320);
  const rightRestoreRef = useRef(300);

  const orderedIdeas = useMemo(() => sortIdeas(ideas), [ideas]);
  const previewHtml = useMemo(() => marked.parse(previewMd) as string, [previewMd]);
  const filteredTree = useMemo(
    () => filterTree(tree, fileQuery.trim().toLowerCase()),
    [tree, fileQuery]
  );

  useEffect(() => {
    if (config.errors.length > 0) {
      return;
    }
    void (async () => {
      try {
        const { raw, ideas: loadedIdeas } = await loadIdeasFile(config.ideaIndexPath);
        await createBootBackup(backupPath, raw);
        setIdeas(loadedIdeas);
        setReady(true);
      } catch (e) {
        setErrors((prev) => [...prev, String(e)]);
      }
    })();
  }, [backupPath, config.errors.length, config.ideaIndexPath]);

  useEffect(() => {
    if (!config.obsidianPath) {
      setSidebarsEnabled(false);
      setLeftOpen(false);
      setRightOpen(false);
      return;
    }
    void loadTree(config.obsidianPath);
  }, [config.obsidianPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) {
        return;
      }
      if (key === "s") {
        event.preventDefault();
        void saveNow();
      }
      if (key === "n") {
        event.preventDefault();
        addIdea();
      }
      if (key === "b" && !event.shiftKey && sidebarsEnabled) {
        event.preventDefault();
        toggleRight();
      }
      if (key === "b" && event.shiftKey && sidebarsEnabled) {
        event.preventDefault();
        toggleLeft();
      }
      if (key === "\\" && sidebarsEnabled) {
        event.preventDefault();
        if (leftOpen || rightOpen) {
          setLeftOpen(false);
          setRightOpen(false);
        } else {
          setLeftOpen(true);
          setRightOpen(true);
        }
      }
      if (key === "f" && event.shiftKey && sidebarsEnabled) {
        event.preventDefault();
        if (!rightOpen) {
          toggleRight(true);
        }
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [leftOpen, rightOpen, sidebarsEnabled]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragRef.current || !workspaceRef.current) {
        return;
      }
      const rect = workspaceRef.current.getBoundingClientRect();
      if (dragRef.current.side === "left") {
        const width = clamp(event.clientX - rect.left, 240, 560);
        leftRestoreRef.current = width;
        setLeftWidth(width);
      } else {
        const width = clamp(rect.right - event.clientX, 240, 560);
        rightRestoreRef.current = width;
        setRightWidth(width);
      }
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    let unlisten: null | (() => void) = null;
    void (async () => {
      unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
        if (closeBypassRef.current) {
          return;
        }
        event.preventDefault();
        await saveNow();
        await removeBootBackup(backupPath);
        closeBypassRef.current = true;
        await getCurrentWindow().close();
      });
    })();
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [backupPath, ideas, ready]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const t = window.setTimeout(() => setToast(""), 1600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const queueSave = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      void saveNow();
    }, 420);
  };

  const saveNow = async () => {
    if (!ready || savingRef.current || !config.ideaIndexPath) {
      return;
    }
    savingRef.current = true;
    setSaveState("saving");
    try {
      await writeIdeasFile(config.ideaIndexPath, ideas);
      setSaveState("saved");
      setDirty(false);
      window.setTimeout(() => setSaveState("idle"), 700);
    } catch (e) {
      setSaveState("error");
      setErrors((prev) => [...prev, String(e)]);
    } finally {
      savingRef.current = false;
    }
  };

  const patchIdea = (id: string, field: IdeaField, value: string) => {
    setIdeas((prev) =>
      prev.map((idea) => (idea.id === id ? { ...idea, [field]: value } : idea))
    );
    setDirty(true);
    queueSave();
  };

  const addIdea = () => {
    setIdeas((prev) => [createIdea(), ...prev]);
    setDirty(true);
    queueSave();
  };

  const onRevert = async () => {
    try {
      const reverted = await revertToBootBackup(backupPath, config.ideaIndexPath);
      setIdeas(reverted);
      setDirty(false);
      setSaveState("idle");
    } catch (e) {
      setSaveState("error");
      setErrors((prev) => [...prev, String(e)]);
    }
  };

  const onSelectMd = async (path: string) => {
    try {
      const md = await readTextFile(path);
      setSelectedMdPath(path);
      setPreviewMd(md);
      if (!leftOpen && sidebarsEnabled) {
        toggleLeft(true);
      }
    } catch (e) {
      setErrors((prev) => [...prev, String(e)]);
    }
  };

  const onCopyRelative = async (path: string) => {
    const relative = toRelative(config.ideaIndexPath, path);
    await copyText(relative);
    setToast(`Copied ${relative}`);
  };

  const startDrag = (side: DragSide) => {
    dragRef.current = { side };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const toggleLeft = (forceOpen = false) => {
    if (!sidebarsEnabled) {
      return;
    }
    setLeftOpen((prev) => {
      if (forceOpen || !prev) {
        setLeftWidth(leftRestoreRef.current);
        return true;
      }
      leftRestoreRef.current = leftWidth;
      return false;
    });
  };

  const toggleRight = (forceOpen = false) => {
    if (!sidebarsEnabled) {
      return;
    }
    setRightOpen((prev) => {
      if (forceOpen || !prev) {
        setRightWidth(rightRestoreRef.current);
        return true;
      }
      rightRestoreRef.current = rightWidth;
      return false;
    });
  };

  const statusText =
    saveState === "saving"
      ? "Saving"
      : saveState === "error"
        ? "Save Error"
        : dirty
          ? "Syncing"
          : "Synced";

  const layoutColumns = sidebarsEnabled
    ? `${leftOpen ? `${leftWidth}px 6px` : "0px 0px"} minmax(0,1fr) ${
        rightOpen ? `6px ${rightWidth}px` : "0px 0px"
      }`
    : "minmax(0,1fr)";

  return (
    <main class={`app-shell ${!leftOpen && !rightOpen ? "zen" : ""}`}>
      <header class="topbar">
        <div class="brand">
          <h1>Idea Index</h1>
          <p>Minimal local editor with Obsidian-compatible output.</p>
        </div>
        <div class="actions">
          <button class="ghost" onClick={() => void saveNow()}>
            Save
          </button>
          <button class="ghost" onClick={onRevert}>
            Revert
          </button>
          <button class="plus" onClick={addIdea}>
            + Entry
          </button>
        </div>
      </header>

      <section class="status">
        <span class={`dot ${saveState}`} />
        <span>{statusText}</span>
        {toast && <span class="toast">{toast}</span>}
      </section>

      {errors.length > 0 && (
        <pre class="error">
          {errors.slice(-3).join("\n")}
        </pre>
      )}

      <section
        ref={workspaceRef}
        class="workspace"
        style={{ gridTemplateColumns: layoutColumns }}
      >
        {sidebarsEnabled && leftOpen && (
          <aside class="pane left">
            <div class="pane-head">Preview</div>
            <div class="preview-content" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </aside>
        )}

        {sidebarsEnabled && leftOpen && (
          <div class="resizer" onMouseDown={() => startDrag("left")} />
        )}

        <section class="center">
          {sidebarsEnabled && (
            <>
              <button
                class={`edge-toggle left ${leftOpen ? "open" : "closed"}`}
                onClick={() => toggleLeft()}
              >
                {leftOpen ? "⟨" : "⟩"}
              </button>
              <button
                class={`edge-toggle right ${rightOpen ? "open" : "closed"}`}
                onClick={() => toggleRight()}
              >
                {rightOpen ? "⟩" : "⟨"}
              </button>
            </>
          )}

          <div class="legend">
            <span class="summary">summary</span>
            <span class="good">good</span>
            <span class="bad">bad</span>
            <span class="ugly">ugly</span>
            <span class="result">result</span>
            <span class="source">source</span>
          </div>

          <div class="cards-scroll">
            {orderedIdeas.map((idea) => (
              <article class="card" key={idea.id}>
                <div class="mini-row">
                  <input
                    class="date-input"
                    type="text"
                    placeholder="DD/MM/YYYY"
                    value={idea.date}
                    onInput={(e) =>
                      patchIdea(idea.id, "date", (e.target as HTMLInputElement).value)
                    }
                  />
                  <input
                    class="link-input"
                    type="text"
                    placeholder="./notes/idea.md"
                    value={idea.link}
                    onInput={(e) =>
                      patchIdea(idea.id, "link", (e.target as HTMLInputElement).value)
                    }
                  />
                </div>

                <IdeaFieldInput
                  value={idea.summary}
                  colorClass="summary"
                  placeholder="Summary"
                  onInput={(value) => patchIdea(idea.id, "summary", value)}
                />
                <IdeaFieldInput
                  value={idea.good}
                  colorClass="good"
                  placeholder="Good"
                  onInput={(value) => patchIdea(idea.id, "good", value)}
                />
                <IdeaFieldInput
                  value={idea.bad}
                  colorClass="bad"
                  placeholder="Bad"
                  onInput={(value) => patchIdea(idea.id, "bad", value)}
                />
                <IdeaFieldInput
                  value={idea.ugly}
                  colorClass="ugly"
                  placeholder="Ugly"
                  onInput={(value) => patchIdea(idea.id, "ugly", value)}
                />
                <IdeaFieldInput
                  value={idea.result}
                  colorClass="result short"
                  placeholder="Result"
                  onInput={(value) => patchIdea(idea.id, "result", value)}
                />
                <IdeaFieldInput
                  value={idea.source}
                  colorClass="source tiny"
                  placeholder="Source"
                  onInput={(value) => patchIdea(idea.id, "source", value)}
                />
              </article>
            ))}
          </div>
          <div class="viewport-fade" />
        </section>

        {sidebarsEnabled && rightOpen && (
          <div class="resizer" onMouseDown={() => startDrag("right")} />
        )}

        {sidebarsEnabled && rightOpen && (
          <aside class="pane right">
            <div class="pane-head">Obsidian Markdown</div>
            <div class="search-wrap">
              <input
                ref={searchInputRef}
                class="file-search"
                placeholder="Search files (Cmd+Shift+F)"
                value={fileQuery}
                onInput={(e) => setFileQuery((e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="file-tree">
              {filteredTree.map((node) => (
                <TreeItem
                  key={node.path}
                  node={node}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  selected={selectedMdPath}
                  onSelect={onSelectMd}
                  onCopy={onCopyRelative}
                  forceOpen={Boolean(fileQuery.trim())}
                />
              ))}
            </div>
          </aside>
        )}
      </section>
    </main>
  );

  async function loadTree(root: string) {
    try {
      const nodes = await walkMarkdown(root);
      setTree(nodes);
      setExpanded({ [root]: true });
      setSidebarsEnabled(true);
      setLeftOpen(true);
      setRightOpen(true);
    } catch {
      setSidebarsEnabled(false);
      setLeftOpen(false);
      setRightOpen(false);
      setErrors((prev) => [
        ...prev,
        "PATH_FOLDERS is blank or invalid. Sidebars disabled."
      ]);
    }
  }
}

function IdeaFieldInput(props: {
  value: string;
  colorClass: string;
  placeholder: string;
  onInput: (value: string) => void;
}) {
  const empty = props.value.trim().length === 0;
  return (
    <textarea
      rows={2}
      class={`field ${props.colorClass} ${empty ? "empty" : ""}`}
      placeholder={props.placeholder}
      value={props.value}
      onInput={(e) => props.onInput((e.target as HTMLTextAreaElement).value)}
    />
  );
}

function TreeItem(props: {
  node: TreeNode;
  expanded: Record<string, boolean>;
  setExpanded: (
    next:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void;
  selected: string;
  onSelect: (path: string) => void;
  onCopy: (path: string) => void;
  forceOpen: boolean;
}) {
  const isOpen = props.forceOpen || (props.expanded[props.node.path] ?? false);

  if (props.node.isDirectory) {
    return (
      <div class="tree-item">
        <div class="tree-row">
          <button
            class="tree-dir"
            onClick={() =>
              props.setExpanded((prev) => ({
                ...prev,
                [props.node.path]: !isOpen
              }))
            }
          >
            {isOpen ? "▾" : "▸"} {props.node.name}
          </button>
          <button class="copy-btn" onClick={() => props.onCopy(props.node.path)}>
            Copy
          </button>
        </div>
        {isOpen && props.node.children.length > 0 && (
          <div class="tree-children">
            {props.node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                expanded={props.expanded}
                setExpanded={props.setExpanded}
                selected={props.selected}
                onSelect={props.onSelect}
                onCopy={props.onCopy}
                forceOpen={props.forceOpen}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div class="tree-row">
      <button
        class={`tree-file ${props.selected === props.node.path ? "active" : ""}`}
        onClick={() => void props.onSelect(props.node.path)}
      >
        {props.node.name}
      </button>
      <button class="copy-btn" onClick={() => props.onCopy(props.node.path)}>
        Copy
      </button>
    </div>
  );
}

async function walkMarkdown(root: string): Promise<TreeNode[]> {
  const entries = await readDir(root);
  const nodes = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry) => {
        const fullPath = `${root.replace(/\/$/, "")}/${entry.name}`;
        if (entry.isDirectory) {
          const children = await walkMarkdown(fullPath);
          if (children.length === 0) {
            return null;
          }
          return {
            name: entry.name,
            path: fullPath,
            isDirectory: true,
            children
          } as TreeNode;
        }
        if (!entry.name.toLowerCase().endsWith(".md")) {
          return null;
        }
        return {
          name: entry.name,
          path: fullPath,
          isDirectory: false,
          children: []
        } as TreeNode;
      })
  );

  return nodes
    .filter((node): node is TreeNode => node !== null)
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const filterTree = (nodes: TreeNode[], query: string): TreeNode[] => {
  if (!query) {
    return nodes;
  }
  return nodes
    .map((node) => {
      if (!node.isDirectory) {
        const hit = node.name.toLowerCase().includes(query);
        return hit ? node : null;
      }
      const children = filterTree(node.children, query);
      const selfHit = node.name.toLowerCase().includes(query);
      if (children.length === 0 && !selfHit) {
        return null;
      }
      return { ...node, children };
    })
    .filter((node): node is TreeNode => node !== null);
};

const toRelative = (fromFile: string, toPath: string): string => {
  const fromParts = fromFile.split("/").filter(Boolean);
  const toParts = toPath.split("/").filter(Boolean);
  const fromDir = fromParts.slice(0, -1);
  let i = 0;
  while (i < fromDir.length && i < toParts.length && fromDir[i] === toParts[i]) {
    i += 1;
  }
  const up = new Array(fromDir.length - i).fill("..");
  const down = toParts.slice(i);
  const rel = [...up, ...down].join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
};

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const el = document.createElement("textarea");
  el.value = value;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
};
