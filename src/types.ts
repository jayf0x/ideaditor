export type IdeaField =
  | "date"
  | "link"
  | "summary"
  | "good"
  | "bad"
  | "ugly"
  | "result"
  | "source";

export type Idea = {
  id: string;
  date: string;
  link: string;
  summary: string;
  good: string;
  bad: string;
  ugly: string;
  result: string;
  source: string;
};
