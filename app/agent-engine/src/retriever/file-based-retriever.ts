import fs from "node:fs/promises";
import path from "node:path";

export interface CatalogItem {
  id: string;
  title: string;
  unit: string;
  author: string;
  category: string;
  lessonNo: string;
  fileName: string;
  relPath: string;
  startPage: number;
  keywords: string[];
}

export interface QueryKnowledgeParams {
  subject?: string;
  grade?: string;
  volume?: string;
  query: string;
  top_k?: number;
}

export interface KnowledgeMatch {
  title: string;
  author: string;
  unit: string;
  content: string;
  score: number;
}

export class FileBasedRetriever {
  private baseDir: string;
  private catalogCache: Map<string, CatalogItem[]> = new Map();

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.resolve(process.cwd(), "..", "..", "knowledge-base");
  }

  public setBaseDir(baseDir: string): void {
    this.baseDir = baseDir;
    this.catalogCache.clear();
  }

  public async retrieve(params: QueryKnowledgeParams): Promise<KnowledgeMatch[]> {
    const subject = params.subject || "chinese";
    const grade = params.grade || "grade8";
    const volume = params.volume || "volume_1";
    const key = `${subject}_${grade}_${volume}`;

    let items = this.catalogCache.get(key);

    if (!items) {
      const catalogPath = path.join(this.baseDir, subject, grade, volume, "catalog.json");
      try {
        const raw = await fs.readFile(catalogPath, "utf-8");
        const parsed = JSON.parse(raw);
        items = parsed.items || [];
        this.catalogCache.set(key, items!);
      } catch {
        // Try fallback paths if running in different working directory
        const altPaths = [
          path.resolve(process.cwd(), "knowledge-base", subject, grade, volume, "catalog.json"),
          path.resolve(process.cwd(), "..", "knowledge-base", subject, grade, volume, "catalog.json"),
          path.resolve(process.cwd(), "..", "..", "knowledge-base", subject, grade, volume, "catalog.json"),
        ];
        for (const alt of altPaths) {
          try {
            const raw = await fs.readFile(alt, "utf-8");
            const parsed = JSON.parse(raw);
            items = parsed.items || [];
            this.catalogCache.set(key, items!);
            this.baseDir = path.dirname(path.dirname(path.dirname(path.dirname(alt))));
            break;
          } catch {
            // continue
          }
        }
      }
    }

    if (!items || items.length === 0) return [];

    const q = params.query.toLowerCase().trim();
    const scored: Array<{ item: CatalogItem; score: number }> = [];

    for (const item of items) {
      let score = 0;
      const title = (item.title || "").toLowerCase();
      const author = (item.author || "").toLowerCase();
      const unit = (item.unit || "").toLowerCase();
      const keywords = (item.keywords || []).map((k) => k.toLowerCase());

      if (q.includes(title) || (title && title.includes(q))) score += 15.0;
      if (author && (q.includes(author) || author.includes(q))) score += 10.0;
      if (unit && (q.includes(unit) || unit.includes(q))) score += 5.0;

      for (const kw of keywords) {
        if (q.includes(kw) || kw.includes(q)) score += 4.0;
      }

      if (score > 0) {
        scored.push({ item, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const topMatches = scored.slice(0, params.top_k || 2);
    const results: KnowledgeMatch[] = [];

    for (const match of topMatches) {
      const lessonPath = path.join(this.baseDir, subject, grade, volume, match.item.relPath);
      let content = "";
      try {
        content = await fs.readFile(lessonPath, "utf-8");
      } catch {
        content = `课文《${match.item.title}》内容载入失败。`;
      }
      results.push({
        title: match.item.title,
        author: match.item.author,
        unit: match.item.unit,
        content: content.slice(0, 3000),
        score: match.score,
      });
    }

    return results;
  }
}
