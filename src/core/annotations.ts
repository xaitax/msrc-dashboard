import type { CaseAnnotation } from "../shared/types";

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Preserve the researcher's spelling while treating Unicode equivalents as one tag. */
export function cleanTag(input: string): string {
  return input.normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function tagKey(input: string): string {
  return cleanTag(input).toLocaleLowerCase();
}

export function addTag(tags: string[], input: string): string[] {
  const tag = cleanTag(input);
  return tag && !tags.some((t) => tagKey(t) === tagKey(tag)) ? [...tags, tag] : tags;
}

export function hasTag(tags: string[], selectedKey: string): boolean {
  return tags.some((tag) => tagKey(tag) === selectedKey);
}

export function sortedTags(tags: string[]): string[] {
  return [...tags].sort(collator.compare);
}

export function tagCounts(annotations: CaseAnnotation[]): { tag: string; count: number }[] {
  const byKey = new Map<string, { tag: string; count: number }>();
  for (const annotation of annotations) {
    for (const tag of annotation.tags) {
      const key = tagKey(tag);
      if (!key) continue;
      const item = byKey.get(key);
      if (item) item.count++;
      else byKey.set(key, { tag, count: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => collator.compare(a.tag, b.tag));
}

export function compareTagNames(a: string, b: string): number {
  return collator.compare(a, b);
}
