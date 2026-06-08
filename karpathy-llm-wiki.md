# Karpathy LLM Wiki Pattern

The LLM Wiki is a pattern for building persistent, compounding knowledge bases using LLMs, proposed by Andrej Karpathy in 2025.

## Core Idea

Instead of retrieving from raw documents at query time (RAG), the LLM incrementally builds and maintains a persistent wiki — a structured, interlinked collection of markdown files that sits between you and the raw sources. When you add a new source, the LLM reads it, extracts key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting contradictions, strengthening or challenging the evolving synthesis. The knowledge is compiled once and kept current, not re-derived on every query.

## Three-Layer Architecture

1. **Raw Sources** — Your curated collection of source documents (articles, papers, images, data files). These are immutable. The LLM reads from them but never modifies them. This is your source of truth.

2. **The Wiki** — A directory of LLM-generated markdown files: summaries, entity pages, concept pages, comparisons, an overview, and a synthesis. The LLM owns this layer entirely. It creates pages, updates them when new sources arrive, maintains cross-references, and keeps everything consistent. You read it; the LLM writes it.

3. **The Schema** — A document (e.g., CLAUDE.md for Claude Code or AGENTS.md for Codex) that tells the LLM how the wiki is structured, what conventions to follow, and what workflows to use when ingesting sources, answering questions, or maintaining the wiki. This is the key configuration file that makes the LLM a disciplined wiki maintainer rather than a generic chatbot.

## Key Workflows

### Ingest
Drop a new source into the raw collection and tell the LLM to process it. The LLM reads the source, discusses key takeaways, writes a summary page, updates the index, updates relevant entity and concept pages across the wiki, and appends an entry to the log. A single source might touch 10-15 wiki pages.

### Query
Ask questions against the wiki. The LLM searches for relevant pages, reads them, and synthesizes an answer with citations. Good answers can be filed back into the wiki as new pages — so your explorations compound in the knowledge base just like ingested sources do.

### Lint
Periodically ask the LLM to health-check the wiki: look for contradictions between pages, stale claims superseded by newer sources, orphan pages with no inbound links, important concepts mentioned but lacking their own page, missing cross-references, and data gaps. This keeps the wiki healthy as it grows.

## Navigation Files

- **index.md** — Content-oriented catalog of everything in the wiki. Each page listed with a link, a one-line summary, and optional metadata. Organized by category. The LLM updates it on every ingest. Works surprisingly well at moderate scale (~100 sources, hundreds of pages) without RAG infrastructure.

- **log.md** — Chronological, append-only record of what happened and when: ingests, queries, lint passes. Each entry starts with a consistent prefix (e.g., `## [2026-04-02] ingest | Article Title`) making it parseable with simple unix tools.

## Key Insight

> The tedious part of maintaining a knowledge base is not the reading or the thinking — it's the bookkeeping. Updating cross-references, keeping summaries current, noting when new data contradicts old claims, maintaining consistency across dozens of pages. Humans abandon wikis because the maintenance burden grows faster than the value. LLMs don't get bored, don't forget to update a cross-reference, and can touch 15 files in one pass. The wiki stays maintained because the cost of maintenance is near zero.

## Use Cases

- **Personal**: Tracking goals, health, psychology, self-improvement — building a structured picture of yourself over time
- **Research**: Going deep on a topic over weeks/months — reading papers and incrementally building a comprehensive wiki with an evolving thesis
- **Reading a book**: Filing each chapter, building pages for characters, themes, plot threads — like a fan wiki built personally as you read
- **Business/team**: An internal wiki maintained by LLMs, fed by Slack threads, meeting transcripts, project documents, customer calls
- **Competitive analysis, due diligence, trip planning, course notes, hobby deep-dives**

## Tooling

- **Obsidian** — The IDE for browsing the wiki; the LLM is the programmer; the wiki is the codebase
- **qmd** — Local search engine for markdown files with hybrid BM25/vector search and LLM re-ranking
- **Obsidian Web Clipper** — Browser extension that converts web articles to markdown
- **Marp** — Markdown-based slide deck format for presentations from wiki content
- **Dataview** — Obsidian plugin for running queries over page frontmatter
- **Git** — The wiki is just a git repo of markdown files — version history, branching, and collaboration for free

## Historical Connection

Related in spirit to Vannevar Bush's **Memex** (1945) — a personal, curated knowledge store with associative trails between documents. Bush's vision was closer to this than to what the web became: private, actively curated, with the connections between documents as valuable as the documents themselves. The part he couldn't solve was who does the maintenance. The LLM handles that.

## Source

- Original gist by Andrej Karpathy: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- Karpathy Wiki community site: https://karpathy-wiki.lol/
- LLM Wiki open-source implementation: https://llmwiki.app/
- StarMorph guide: https://blog.starmorph.com/blog/karpathy-llm-wiki-knowledge-base-guide