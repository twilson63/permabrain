import fs from 'node:fs';
import path from 'node:path';
import { slugify } from './tags.mjs';
import { publishArticle } from './article.mjs';

export async function fetchWikipediaSummary(title, { language = 'en', env = process.env } = {}) {
  if (env.PERMABRAIN_WIKIPEDIA_FIXTURE_DIR) {
    const fixture = path.join(env.PERMABRAIN_WIKIPEDIA_FIXTURE_DIR, `${slugify(title)}.json`);
    return JSON.parse(fs.readFileSync(fixture, 'utf8'));
  }
  const endpoint = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(endpoint, { headers: { accept: 'application/json', 'user-agent': 'PermaBrain/0.1.0 (public-third-brain)' } });
  if (!res.ok) throw new Error(`Wikipedia fetch failed for '${title}': HTTP ${res.status}`);
  return res.json();
}

export function wikipediaMarkdown(summary, { fetchedAt = new Date().toISOString() } = {}) {
  const title = summary.title || summary.displaytitle || 'Untitled Wikipedia Article';
  const extract = summary.extract || '';
  const url = summary.content_urls?.desktop?.page || summary.content_urls?.mobile?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  return `# ${title}\n\n${extract}\n\n## Source\n\n- Source: Wikipedia\n- URL: ${url}\n- License: CC BY-SA\n- Fetched-At: ${fetchedAt}\n`;
}

export async function importWikipediaArticle({ title, kind, topic, language = 'en' }) {
  if (!title) throw new Error('import-wikipedia requires <title>');
  const summary = await fetchWikipediaSummary(title, { language });
  const pageTitle = summary.title || title;
  const sourceUrl = summary.content_urls?.desktop?.page || summary.content_urls?.mobile?.page || `https://${language}.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`;
  const content = wikipediaMarkdown(summary);
  return publishArticle({
    content,
    kind,
    topic,
    key: `${kind}/${slugify(title)}`,
    title,
    sourceUrl,
    sourceName: 'Wikipedia',
    sourceLicense: 'CC BY-SA',
    language
  });
}
