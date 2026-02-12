export type AppConfig = {
  ideaIndexPath: string;
  obsidianPath: string | null;
  errors: string[];
};

export const loadConfig = (): AppConfig => {
  const ideaIndexPath = clean(import.meta.env.PATH_IDEA_INDEX);
  const obsidianPathRaw = clean(import.meta.env.PATH_FOLDERS);
  const errors: string[] = [];

  if (!ideaIndexPath) {
    errors.push("Missing required PATH_IDEA_INDEX in .env.");
  } else if (!ideaIndexPath.endsWith(".md")) {
    errors.push("PATH_IDEA_INDEX must point to a .md file.");
  }

  return {
    ideaIndexPath,
    obsidianPath: obsidianPathRaw || null,
    errors
  };
};

const clean = (value?: string): string => (value ?? "").trim();
