/**
 * PermaBrain Goal / PRD Parser
 *
 * Parses a PRD or goal markdown file into an ordered implementation plan,
 * then generates executable PermaBrain workflows:
 *   - `plan`: a JSON plan with steps, success criteria, and inferred tasks
 *   - `import`: auto-import URLs mentioned in the PRD as articles
 *   - `batchAttest`: attestations against articles produced by the plan
 *
 * Designed for the Pi `/goal` slash-command workflow and the
 * `permabrain goal` CLI command.
 */

import fs from 'node:fs';
import { slugify } from './tags.mjs';

/**
 * Extract a plan from a PRD/goal markdown document.
 *
 * Recognises:
 *   - H1 as the PRD title / goal name
 *   - H2/H3 sections as candidate steps
 *   - Bullet lists under "Success criteria", "Criteria", or "Acceptance" as criteria
 *   - Numbered lists as ordered steps
 *   - Top-level paragraphs as context
 *   - URLs as importable sources
 *
 * Returns:
 *   {
 *     title,
 *     summary,
 *     urls: [{ url, context }],
 *     steps: [{ title, description, criteria: [], order }],
 *     metadata: { kinds, topics, inferred }
 *   }
 */
export function parseGoal(text, opts = {}) {
  if (!text || typeof text !== 'string') {
    throw new Error('parseGoal requires a markdown string');
  }

  const lines = text.split(/\r?\n/);
  const result = {
    title: '',
    summary: '',
    urls: [],
    steps: [],
    metadata: { kinds: new Set(), topics: new Set(), inferred: false }
  };

  let currentStep = null;
  let inCriteria = false;
  let buffer = [];
  let stepOrder = 0;

  const urlRegex = /https?:\/\/[^\s<>"`{}\[\]]+/g;
  const seenUrls = new Set();

  function flushParagraph() {
    if (buffer.length === 0) return;
    const para = buffer.join(' ').trim();
    buffer = [];
    if (!para) return;

    if (!result.summary) {
      result.summary = para;
    } else if (currentStep) {
      currentStep.description = currentStep.description
        ? `${currentStep.description}\n\n${para}`
        : para;
    }
  }

  function extractUrls(line, context) {
    let m;
    urlRegex.lastIndex = 0;
    while ((m = urlRegex.exec(line)) !== null) {
      const url = m[0].replace(/[.,;!?]+$/, '');
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      result.urls.push({ url, context: context || result.title || 'PRD source' });
    }
  }

  function finishStep() {
    flushParagraph();
    if (currentStep) {
      if (!currentStep.title) {
        currentStep.title = `Step ${currentStep.order}`;
      }
      result.steps.push(currentStep);
      currentStep = null;
    }
  }

  const stepStopWords = [
    'overview', 'summary', 'introduction', 'context', 'background', 'goal', 'purpose',
    'notes', 'sources', 'references', 'see also', 'appendix', 'metadata',
    'when to use', 'safety', 'kinds', 'opinions', 'setup', 'cli fallback'
  ];
  const criteriaSectionWords = [
    'success criteria', 'acceptance criteria', 'criteria',
    'definition of done', 'done when', 'success factors'
  ];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    const criteriaHeaderMatch = line.match(/^\s*\*{0,2}\s*(Success criteria|Acceptance criteria|Criteria|Definition of done|Done when)\s*\*{0,2}:?\s*$/i);
    if (headingMatch || criteriaHeaderMatch) {
      flushParagraph();
      let level, title;
      if (headingMatch) {
        level = headingMatch[1].length;
        title = headingMatch[2].trim();
      } else {
        level = 2;
        title = criteriaHeaderMatch[1];
      }

      if (level === 1 && !result.title) {
        result.title = title;
        extractUrls(line, 'title');
        continue;
      }

      const lower = title.toLowerCase();
      inCriteria = criteriaSectionWords.some(phrase => lower.includes(phrase));
      const isStopWord = stepStopWords.some(phrase => lower === phrase || lower.startsWith(phrase + ' ') || lower.endsWith(' ' + phrase));
      const isStepHeading = level >= 2 && !inCriteria && !isStopWord &&
        !/overview|summary|introduction|context|background|goal|purpose|notes/.test(lower);

      if (isStopWord && currentStep) {
        finishStep();
        inCriteria = false;
        extractUrls(raw, title);
      } else if (isStepHeading && /step \d+|\d+\.|implement|add|build|create|write|update|fix|deploy|wire|test|support/.test(lower)) {
        finishStep();
        currentStep = {
          title,
          description: '',
          criteria: [],
          order: ++stepOrder
        };
        inCriteria = false; // reset; criteria must be explicitly introduced per step
        extractUrls(raw, title);
      } else if (currentStep && inCriteria) {
        // criteria section for current step
        extractUrls(raw, `${currentStep.title} criteria`);
      } else {
        inCriteria = false;
        extractUrls(raw, title);
      }
      continue;
    }

    // List items
    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      const content = listMatch[3].trim();

      if (currentStep && inCriteria) {
        currentStep.criteria.push(content);
      } else if (currentStep) {
        currentStep.description = currentStep.description
          ? `${currentStep.description}\n- ${content}`
          : `- ${content}`;
      }
      extractUrls(content, currentStep?.title || 'list item');
      continue;
    }

    // Empty line ends criteria block when not immediately followed by more criteria
    if (line === '') {
      flushParagraph();
      if (inCriteria && currentStep) {
        // Keep currentStep; criteria block ends on next heading or EOF.
      }
      continue;
    }

    // Plain paragraph content
    extractUrls(raw, currentStep?.title || 'paragraph');
    buffer.push(line);
  }

  finishStep();

  // If no explicit H2/H3 steps were found, treat H1 sections or numbered top-level lists as steps.
  if (result.steps.length === 0) {
    const fallback = parseFallbackSteps(text);
    if (fallback.length > 0) {
      result.steps = fallback;
      result.metadata.inferred = true;
    }
  }

  // Add default criteria to any step that lacks them.
  for (const step of result.steps) {
    if (step.criteria.length === 0) {
      step.criteria.push(`'${step.title}' is implemented and validated.`);
      result.metadata.inferred = true;
    }
  }

  inferKindsAndTopics(result, opts.kinds, opts.topics);

  return result;
}

/**
 * Fallback parser for PRDs that don't use explicit step headings.
 * Looks for numbered lists and strong "Step N" markers.
 */
function parseFallbackSteps(text) {
  const steps = [];
  const lines = text.split(/\r?\n/);
  let order = 0;

  for (const raw of lines) {
    const line = raw.trim();

    // "Step 2 — Add inline button" or "2. Add inline button"
    const stepMatch = line.match(/^(?:Step\s+(\d+)[\s:—-]+|\d+\.)\s+(.+)$/i);
    if (stepMatch) {
      order = Number(stepMatch[1]);
      steps.push({
        title: stepMatch[2].trim(),
        description: '',
        criteria: [`'${stepMatch[2].trim()}' is implemented and validated.`],
        order
      });
      continue;
    }

    // Plain numbered markdown like "1. Do thing"
    const plainMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (plainMatch && steps.length > 0 && Number(plainMatch[1]) === steps.length + 1) {
      order = Number(plainMatch[1]);
      steps.push({
        title: plainMatch[2].trim(),
        description: '',
        criteria: [`'${plainMatch[2].trim()}' is implemented and validated.`],
        order
      });
    }
  }

  return steps;
}

/**
 * Infer PermaBrain article kinds/topics from PRD content.
 */
function inferKindsAndTopics(result, defaultKinds = [], defaultTopics = []) {
  const topicKeywords = {
    ai: ['ai', 'artificial intelligence', 'llm', 'model', 'agent', 'machine learning'],
    crypto: ['crypto', 'arweave', 'hyperbeam', 'blockchain', 'wallet', 'key', 'signature'],
    computing: ['software', 'code', 'programming', 'developer', 'api', 'cli', 'module'],
    protocol: ['protocol', 'dataitem', 'ans-104', 'graphql', 'consensus'],
    design: ['ui', 'interface', 'viewer', 'dashboard', 'frontend', 'html']
  };

  const allText = `${result.title}\n${result.summary}\n${result.steps.map(s => s.title + ' ' + s.description).join('\n')}`.toLowerCase();

  if (defaultTopics.length) {
    for (const t of defaultTopics) result.metadata.topics.add(t);
  }

  // Default to 'subject' if no other kind signals are present.
  result.metadata.kinds.add('subject');
  if (defaultKinds.length) {
    for (const k of defaultKinds) result.metadata.kinds.add(k);
  }

  // Infer additional topics from content after explicit overrides so overrides
  // remain at the front of the Set iteration order.
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some(kw => allText.includes(kw))) {
      result.metadata.topics.add(topic);
    }
  }
}

/**
 * Build a PermaBrain `plan` object from a parsed goal.
 *
 * The plan is a JSON-serializable artifact describing what would be
 * implemented, including inferred articles and batch attestations.
 */
export function planFromGoal(parsed, opts = {}) {
  if (!parsed || !parsed.steps) throw new Error('planFromGoal requires parsed goal output');

  const topics = Array.from(parsed.metadata.topics);
  const kinds = Array.from(parsed.metadata.kinds);
  const primaryTopic = opts.topic || topics[0] || 'general';
  const primaryKind = opts.kind || kinds[0] || 'subject';
  const planKey = slugify(parsed.title || 'goal-plan');

  const articles = parsed.urls.map(({ url, context }, idx) => ({
    url,
    kind: primaryKind,
    topic: primaryTopic,
    title: context,
    key: `${primaryKind}/${slugify(context)}-${idx + 1}`
  }));

  const stepArticles = parsed.steps.map((step, idx) => ({
    content: `# ${step.title}\n\n${step.description || '(no description)'}\n\n## Success criteria\n${step.criteria.map(c => `- ${c}`).join('\n')}`,
    kind: primaryKind,
    topic: primaryTopic,
    title: step.title,
    key: `${primaryKind}/${planKey}-step-${idx + 1}`,
    sourceUrl: 'goal://' + planKey
  }));

  const attestations = stepArticles.map(article => ({
    key: article.key,
    opinion: 'valid',
    confidence: 0.9,
    reason: `Step completed: ${article.title}`
  }));

  return {
    title: parsed.title,
    summary: parsed.summary,
    planKey,
    topic: primaryTopic,
    kind: primaryKind,
    steps: parsed.steps.map(s => ({ title: s.title, order: s.order, criteria: s.criteria })),
    importArticles: articles,
    publishArticles: stepArticles,
    attestations,
    metadata: {
      inferred: parsed.metadata.inferred,
      kinds,
      topics
    }
  };
}

/**
 * Build an `autoImport` articles array from a parsed goal.
 */
export function importArticlesFromGoal(parsed, opts = {}) {
  const plan = planFromGoal(parsed, opts);
  return plan.importArticles;
}

/**
 * Build a `batchAttest` attestations array from a parsed goal.
 */
export function attestationsFromGoal(parsed, opts = {}) {
  const plan = planFromGoal(parsed, opts);
  return plan.attestations;
}

/**
 * Convenience: read a PRD file and parse it.
 */
export function parseGoalFile(filePath, opts = {}) {
  const text = fs.readFileSync(filePath, 'utf8');
  return parseGoal(text, opts);
}

/**
 * Convenience: read a PRD file and return the generated plan object.
 */
export function planFromGoalFile(filePath, opts = {}) {
  const parsed = parseGoalFile(filePath, opts);
  return planFromGoal(parsed);
}
