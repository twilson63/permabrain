/**
 * PermaBrain HTTP API Route Registry
 *
 * Declarative metadata for all registered `permabrain serve` HTTP routes.
 * Used to power:
 *   GET /api/v1/routes
 *   GET /api/v1/openapi.json
 */

export const ROUTES = [
  {
    route: '/health',
    method: 'GET',
    description: 'Server health, transport, and live-stream advertisement.',
    public: true,
    params: [],
    response: { ok: 'boolean', transport: 'string', agentId: 'string|null', home: 'string', streamTransport: 'string', streams: 'object' }
  },
  {
    route: '/api/v1/routes',
    method: 'GET',
    description: 'List all registered HTTP routes with auth requirements and parameter shapes.',
    public: false,
    params: [],
    response: { routes: 'array' }
  },
  {
    route: '/api/v1/openapi.json',
    method: 'GET',
    description: 'OpenAPI 3.0 JSON document describing the HTTP API surface.',
    public: false,
    params: [],
    response: { openapi: 'string', info: 'object', paths: 'object' }
  },
  {
    route: '/api/v1/init',
    method: 'POST',
    description: 'Initialize or re-initialize local PermaBrain state.',
    public: false,
    params: [
      { name: 'home', in: 'body', type: 'string', required: false },
      { name: 'transport', in: 'body', type: 'string', required: false },
      { name: 'keyType', in: 'body', type: 'string', required: false }
    ],
    response: { home: 'string', agentId: 'string', keyType: 'string', config: 'object' }
  },
  {
    route: '/api/v1/articles',
    method: 'GET',
    description: 'Query articles by tags/filters.',
    public: false,
    params: [
      { name: 'topic', in: 'query', type: 'string', required: false },
      { name: 'kind', in: 'query', type: 'string', required: false },
      { name: 'key', in: 'query', type: 'string', required: false },
      { name: 'source-name', in: 'query', type: 'string', required: false },
      { name: 'source-url', in: 'query', type: 'string', required: false },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { articles: 'array', count: 'number' }
  },
  {
    route: '/api/v1/articles',
    method: 'POST',
    description: 'Publish a new article.',
    public: false,
    params: [
      { name: 'content', in: 'body', type: 'string', required: true },
      { name: 'kind', in: 'body', type: 'string', required: true },
      { name: 'topic', in: 'body', type: 'string', required: true },
      { name: 'sourceUrl', in: 'body', type: 'string', required: true },
      { name: 'title', in: 'body', type: 'string', required: false },
      { name: 'key', in: 'body', type: 'string', required: false },
      { name: 'sourceName', in: 'body', type: 'string', required: false },
      { name: 'language', in: 'body', type: 'string', required: false },
      { name: 'visibility', in: 'body', type: 'string', required: false },
      { name: 'encryptedFor', in: 'body', type: 'array', required: false }
    ],
    response: { summary: 'object', item: 'object', encrypted: 'boolean' }
  },
  {
    route: '/api/v1/articles/:key',
    method: 'GET',
    description: 'Fetch the latest version of an article by canonical key.',
    public: false,
    params: [
      { name: 'key', in: 'path', type: 'string', required: true },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { article: 'object' }
  },
  {
    route: '/api/v1/articles/:key/attest',
    method: 'POST',
    description: 'Publish a signed attestation against an article.',
    public: false,
    params: [
      { name: 'key', in: 'path', type: 'string', required: true },
      { name: 'opinion', in: 'body', type: 'string', required: true },
      { name: 'confidence', in: 'body', type: 'number', required: true },
      { name: 'reason', in: 'body', type: 'string', required: true },
      { name: 'sourceUrl', in: 'body', type: 'string', required: false }
    ],
    response: { summary: 'object', reference: 'object' }
  },
  {
    route: '/api/v1/articles/:key/consensus',
    method: 'GET',
    description: 'Compute attestation consensus for an article.',
    public: false,
    params: [
      { name: 'key', in: 'path', type: 'string', required: true },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { score: 'number', attestations: 'array' }
  },
  {
    route: '/api/v1/articles/:key/history',
    method: 'GET',
    description: 'Get the version chain and attestation timeline for an article.',
    public: false,
    params: [
      { name: 'key', in: 'path', type: 'string', required: true },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { versions: 'array', attestations: 'array', consensus: 'object' }
  },
  {
    route: '/api/v1/articles/:key/fork',
    method: 'POST',
    description: 'Fork an article into a new canonical key.',
    public: false,
    params: [
      { name: 'key', in: 'path', type: 'string', required: true },
      { name: 'title', in: 'body', type: 'string', required: false },
      { name: 'content', in: 'body', type: 'string', required: false },
      { name: 'topic', in: 'body', type: 'string', required: false },
      { name: 'kind', in: 'body', type: 'string', required: false },
      { name: 'slug', in: 'body', type: 'string', required: false },
      { name: 'targetId', in: 'body', type: 'string', required: false }
    ],
    response: { summary: 'object' }
  },
  {
    route: '/api/v1/articles/:key/forks',
    method: 'GET',
    description: 'List forks of an article.',
    public: false,
    params: [
      { name: 'key', in: 'path', type: 'string', required: true },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { forks: 'array', count: 'number' }
  },
  {
    route: '/api/v1/merge',
    method: 'POST',
    description: 'Merge a source fork into a target article.',
    public: false,
    params: [
      { name: 'targetKey', in: 'body', type: 'string', required: true },
      { name: 'sourceKey', in: 'body', type: 'string', required: true },
      { name: 'noCarryAttestations', in: 'body', type: 'boolean', required: false }
    ],
    response: { summary: 'object' }
  },
  {
    route: '/api/v1/sync',
    method: 'POST',
    description: 'Sync remote articles/attestations into the local cache.',
    public: false,
    params: [
      { name: 'noAutoMerge', in: 'body', type: 'boolean', required: false },
      { name: 'dryRun', in: 'body', type: 'boolean', required: false },
      { name: 'useHyperbeam', in: 'body', type: 'boolean', required: false }
    ],
    response: { imported: 'number', skipped: 'number', failed: 'number' }
  },
  {
    route: '/api/v1/search',
    method: 'GET',
    description: 'Full-text search across articles.',
    public: false,
    params: [
      { name: 'q', in: 'query', type: 'string', required: true },
      { name: 'kind', in: 'query', type: 'string', required: false },
      { name: 'topic', in: 'query', type: 'string', required: false },
      { name: 'author', in: 'query', type: 'string', required: false },
      { name: 'key', in: 'query', type: 'string', required: false },
      { name: 'after', in: 'query', type: 'string', required: false },
      { name: 'before', in: 'query', type: 'string', required: false },
      { name: 'limit', in: 'query', type: 'integer', required: false },
      { name: 'offset', in: 'query', type: 'integer', required: false },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { results: 'array', count: 'number' }
  },
  {
    route: '/api/v1/status',
    method: 'GET',
    description: 'Local node status overview.',
    public: false,
    params: [
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { transport: 'string', summary: 'object' }
  },
  {
    route: '/api/v1/activity',
    method: 'GET',
    description: 'Chronological activity feed of publish/attest/fork/merge events.',
    public: false,
    params: [
      { name: 'topic', in: 'query', type: 'string', required: false },
      { name: 'kind', in: 'query', type: 'string', required: false },
      { name: 'key', in: 'query', type: 'string', required: false },
      { name: 'agent', in: 'query', type: 'array', required: false },
      { name: 'author', in: 'query', type: 'array', required: false },
      { name: 'attested-by', in: 'query', type: 'array', required: false },
      { name: 'event-kind', in: 'query', type: 'string', required: false },
      { name: 'after', in: 'query', type: 'string', required: false },
      { name: 'before', in: 'query', type: 'string', required: false },
      { name: 'order', in: 'query', type: 'string', required: false },
      { name: 'limit', in: 'query', type: 'integer', required: false },
      { name: 'offset', in: 'query', type: 'integer', required: false },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { events: 'array', count: 'number' }
  },
  {
    route: '/api/v1/topics/:topic',
    method: 'GET',
    description: 'List articles for a topic.',
    public: false,
    params: [
      { name: 'topic', in: 'path', type: 'string', required: true },
      { name: 'kind', in: 'query', type: 'string', required: false },
      { name: 'language', in: 'query', type: 'string', required: false },
      { name: 'author', in: 'query', type: 'string', required: false },
      { name: 'sort', in: 'query', type: 'string', required: false },
      { name: 'limit', in: 'query', type: 'integer', required: false },
      { name: 'offset', in: 'query', type: 'integer', required: false },
      { name: 'no-attestations', in: 'query', type: 'boolean', required: false },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { articles: 'array', count: 'number' }
  },
  {
    route: '/api/v1/list',
    method: 'GET',
    description: 'Paginated article directory.',
    public: false,
    params: [
      { name: 'kind', in: 'query', type: 'string', required: false },
      { name: 'topic', in: 'query', type: 'string', required: false },
      { name: 'author', in: 'query', type: 'string', required: false },
      { name: 'after', in: 'query', type: 'string', required: false },
      { name: 'before', in: 'query', type: 'string', required: false },
      { name: 'sort', in: 'query', type: 'string', required: false },
      { name: 'limit', in: 'query', type: 'integer', required: false },
      { name: 'offset', in: 'query', type: 'integer', required: false },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { articles: 'array', count: 'number', total: 'number' }
  },
  {
    route: '/api/v1/export-articles',
    method: 'GET',
    description: 'Export filtered article directory as JSON or markdown.',
    public: false,
    params: [
      { name: 'kind', in: 'query', type: 'string', required: false },
      { name: 'topic', in: 'query', type: 'string', required: false },
      { name: 'author', in: 'query', type: 'string', required: false },
      { name: 'after', in: 'query', type: 'string', required: false },
      { name: 'before', in: 'query', type: 'string', required: false },
      { name: 'sort', in: 'query', type: 'string', required: false },
      { name: 'limit', in: 'query', type: 'integer', required: false },
      { name: 'offset', in: 'query', type: 'integer', required: false },
      { name: 'format', in: 'query', type: 'string', required: false },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { format: 'string', articles: 'array', markdown: 'string' }
  },
  {
    route: '/api/v1/metrics',
    method: 'GET',
    description: 'Runtime and aggregate metrics (JSON or Prometheus format).',
    public: false,
    params: [
      { name: 'format', in: 'query', type: 'string', required: false },
      { name: 'kind', in: 'query', type: 'string', required: false },
      { name: 'topic', in: 'query', type: 'string', required: false },
      { name: 'author', in: 'query', type: 'string', required: false },
      { name: 'after', in: 'query', type: 'string', required: false },
      { name: 'before', in: 'query', type: 'string', required: false },
      { name: 'top', in: 'query', type: 'integer', required: false }
    ],
    response: { generatedAt: 'string', runtime: 'object', data: 'object' }
  },
  {
    route: '/api/v1/stats',
    method: 'GET',
    description: 'Dashboard-style aggregate stats.',
    public: false,
    params: [
      { name: 'kind', in: 'query', type: 'string', required: false },
      { name: 'topic', in: 'query', type: 'string', required: false },
      { name: 'author', in: 'query', type: 'string', required: false },
      { name: 'after', in: 'query', type: 'string', required: false },
      { name: 'before', in: 'query', type: 'string', required: false },
      { name: 'top', in: 'query', type: 'integer', required: false }
    ],
    response: { totals: 'object', consensus: 'object', agents: 'object', activity: 'array' }
  },
  {
    route: '/api/v1/batch-attest',
    method: 'POST',
    description: 'Batch publish attestations.',
    public: false,
    params: [
      { name: 'attestations', in: 'body', type: 'array', required: true }
    ],
    response: { results: 'array', count: 'number' }
  },
  {
    route: '/api/v1/auto-import',
    method: 'POST',
    description: 'Auto-import articles from URLs.',
    public: false,
    params: [
      { name: 'articles', in: 'body', type: 'array', required: true }
    ],
    response: { results: 'array', count: 'number' }
  },
  {
    route: '/api/v1/import-wikipedia',
    method: 'POST',
    description: 'Import and publish a Wikipedia summary.',
    public: false,
    params: [
      { name: 'title', in: 'body', type: 'string', required: true },
      { name: 'kind', in: 'body', type: 'string', required: true },
      { name: 'topic', in: 'body', type: 'string', required: true },
      { name: 'language', in: 'body', type: 'string', required: false }
    ],
    response: { summary: 'object' }
  },
  {
    route: '/api/v1/verify',
    method: 'POST',
    description: 'Verify a DataItem or article by id/key.',
    public: false,
    params: [
      { name: 'idOrKey', in: 'body', type: 'string', required: true },
      { name: 'attestations', in: 'body', type: 'boolean', required: false },
      { name: 'noVerifyChain', in: 'body', type: 'boolean', required: false },
      { name: 'noVerifyTarget', in: 'body', type: 'boolean', required: false }
    ],
    response: { ok: 'boolean', checks: 'array' }
  },
  {
    route: '/api/v1/remotes',
    method: 'GET',
    description: 'List configured named remotes.',
    public: false,
    params: [],
    response: { remotes: 'array', default: 'string|null' }
  },
  {
    route: '/api/v1/remotes',
    method: 'POST',
    description: 'Add/remove/set-default named remotes.',
    public: false,
    params: [
      { name: 'action', in: 'body', type: 'string', required: true },
      { name: 'params', in: 'body', type: 'object', required: false }
    ],
    response: { ok: 'boolean' }
  },
  {
    route: '/api/v1/config',
    method: 'GET',
    description: 'Read current configuration.',
    public: false,
    params: [
      { name: 'action', in: 'query', type: 'string', required: false },
      { name: 'path', in: 'query', type: 'string', required: false }
    ],
    response: { config: 'object' }
  },
  {
    route: '/api/v1/config',
    method: 'POST',
    description: 'Set/validate/reset configuration.',
    public: false,
    params: [
      { name: 'action', in: 'body', type: 'string', required: true },
      { name: 'path', in: 'body', type: 'string', required: false },
      { name: 'value', in: 'body', type: 'string', required: false }
    ],
    response: { config: 'object' }
  },
  {
    route: '/api/v1/probe',
    method: 'GET',
    description: 'Probe the configured transport.',
    public: false,
    params: [
      { name: 'url', in: 'query', type: 'string', required: false },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { url: 'string', transport: 'string', checks: 'array' }
  },
  {
    route: '/api/v1/transport-status',
    method: 'GET',
    description: 'Show transport metrics and circuit breaker state.',
    public: false,
    params: [],
    response: { metrics: 'object', circuitBreakers: 'object' }
  },
  {
    route: '/api/v1/local-index',
    method: 'GET',
    description: 'Return the local cache index entries.',
    public: false,
    params: [],
    response: { entries: 'array', count: 'number' }
  },
  {
    route: '/api/v1/identity',
    method: 'GET',
    description: 'Return the public identity of the running node.',
    public: false,
    params: [],
    response: { agentId: 'string', type: 'string', publicKey: 'string' }
  },
  {
    route: '/api/v1/raw/:id',
    method: 'GET',
    description: 'Fetch raw ANS-104 DataItem bytes by DataItem id.',
    public: false,
    params: [
      { name: 'id', in: 'path', type: 'string', required: true }
    ],
    response: { binary: 'bytes' }
  },
  {
    route: '/api/v1/goal',
    method: 'POST',
    description: 'Parse a PRD/goal markdown file into a workflow plan.',
    public: false,
    params: [
      { name: 'text', in: 'body', type: 'string', required: false },
      { name: 'filePath', in: 'body', type: 'string', required: false },
      { name: 'options', in: 'body', type: 'object', required: false }
    ],
    response: { goal: 'object', plan: 'object' }
  },
  {
    route: '/api/v1/template',
    method: 'POST',
    description: 'Publish an article from a markdown template.',
    public: false,
    params: [
      { name: 'file', in: 'body', type: 'string', required: false },
      { name: 'source', in: 'body', type: 'string', required: false },
      { name: 'variables', in: 'body', type: 'object', required: false },
      { name: 'topic', in: 'body', type: 'string', required: false },
      { name: 'kind', in: 'body', type: 'string', required: false },
      { name: 'title', in: 'body', type: 'string', required: false },
      { name: 'key', in: 'body', type: 'string', required: false },
      { name: 'app', in: 'body', type: 'string', required: false },
      { name: 'sourceUrl', in: 'body', type: 'string', required: false },
      { name: 'encrypt', in: 'body', type: 'boolean', required: false },
      { name: 'recipients', in: 'body', type: 'array', required: false }
    ],
    response: { summary: 'object' }
  },
  {
    route: '/api/v1/dashboard',
    method: 'GET',
    description: 'Return dashboard data as JSON.',
    public: false,
    params: [
      { name: 'kind', in: 'query', type: 'string', required: false },
      { name: 'topic', in: 'query', type: 'string', required: false },
      { name: 'author', in: 'query', type: 'string', required: false },
      { name: 'after', in: 'query', type: 'string', required: false },
      { name: 'before', in: 'query', type: 'string', required: false },
      { name: 'sort', in: 'query', type: 'string', required: false },
      { name: 'order', in: 'query', type: 'string', required: false },
      { name: 'article-limit', in: 'query', type: 'integer', required: false },
      { name: 'activity-limit', in: 'query', type: 'integer', required: false },
      { name: 'log-limit', in: 'query', type: 'integer', required: false },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { stats: 'object', articles: 'array', activity: 'array', log: 'array' }
  },
  {
    route: '/api/v1/dashboard.html',
    method: 'GET',
    description: 'Return self-contained dashboard HTML.',
    public: false,
    params: [
      { name: 'title', in: 'query', type: 'string', required: false }
    ],
    response: { html: 'string' }
  },
  {
    route: '/api/v1/dashboard/publish',
    method: 'POST',
    description: 'Build a dashboard and publish it to ZenBin.',
    public: false,
    params: [
      { name: 'title', in: 'body', type: 'string', required: false },
      { name: 'pageId', in: 'body', type: 'string', required: false },
      { name: 'recipientKeyId', in: 'body', type: 'string', required: false },
      { name: 'subdomain', in: 'body', type: 'string', required: false }
    ],
    response: { ok: 'boolean', url: 'string' }
  },
  {
    route: '/api/v1/log',
    method: 'GET',
    description: 'Query the local audit log.',
    public: false,
    params: [
      { name: 'action', in: 'query', type: 'string', required: false },
      { name: 'status', in: 'query', type: 'string', required: false },
      { name: 'key', in: 'query', type: 'string', required: false },
      { name: 'agent', in: 'query', type: 'string', required: false },
      { name: 'after', in: 'query', type: 'string', required: false },
      { name: 'before', in: 'query', type: 'string', required: false },
      { name: 'order', in: 'query', type: 'string', required: false },
      { name: 'limit', in: 'query', type: 'integer', required: false },
      { name: 'offset', in: 'query', type: 'integer', required: false }
    ],
    response: { entries: 'array', count: 'number' }
  },
  {
    route: '/api/v1/log',
    method: 'POST',
    description: 'Write an audit log entry.',
    public: false,
    params: [
      { name: 'action', in: 'body', type: 'string', required: true },
      { name: 'status', in: 'body', type: 'string', required: false },
      { name: 'key', in: 'body', type: 'string', required: false },
      { name: 'details', in: 'body', type: 'object', required: false }
    ],
    response: { ok: 'boolean' }
  },
  {
    route: '/api/v1/log/export',
    method: 'GET',
    description: 'Export the audit log as JSON or JSONL.',
    public: false,
    params: [
      { name: 'format', in: 'query', type: 'string', required: false }
    ],
    response: { entries: 'array', raw: 'string' }
  },
  {
    route: '/api/v1/log/import',
    method: 'POST',
    description: 'Import an audit-log bundle or JSONL file.',
    public: false,
    params: [
      { name: 'bundle', in: 'body', type: 'object|array', required: true }
    ],
    response: { imported: 'number', skipped: 'number', failed: 'number' }
  },
  {
    route: '/api/v1/backups',
    method: 'GET',
    description: 'List stored backups.',
    public: false,
    params: [],
    response: { backups: 'array', count: 'number' }
  },
  {
    route: '/api/v1/backups',
    method: 'POST',
    description: 'Create/prune/restore backups.',
    public: false,
    params: [
      { name: 'action', in: 'body', type: 'string', required: true },
      { name: 'passphrase', in: 'body', type: 'string', required: false },
      { name: 'backup', in: 'body', type: 'string', required: false }
    ],
    response: { ok: 'boolean' }
  },
  {
    route: '/api/v1/archive',
    method: 'POST',
    description: 'Create an encrypted snapshot of the local home.',
    public: false,
    params: [
      { name: 'passphrase', in: 'body', type: 'string', required: true },
      { name: 'recipients', in: 'body', type: 'array', required: false },
      { name: 'dryRun', in: 'body', type: 'boolean', required: false }
    ],
    response: { ok: 'boolean', archive: 'object' }
  },
  {
    route: '/api/v1/restore',
    method: 'POST',
    description: 'Restore a PermaBrain home from an archive.',
    public: false,
    params: [
      { name: 'archive', in: 'body', type: 'object', required: true },
      { name: 'passphrase', in: 'body', type: 'string', required: false },
      { name: 'dryRun', in: 'body', type: 'boolean', required: false }
    ],
    response: { ok: 'boolean' }
  },
  {
    route: '/api/v1/bundles',
    method: 'GET',
    description: 'Export an article bundle.',
    public: false,
    params: [
      { name: 'key', in: 'query', type: 'string', required: false },
      { name: 'id', in: 'query', type: 'string', required: false },
      { name: 'no-attestations', in: 'query', type: 'boolean', required: false },
      { name: 'no-versions', in: 'query', type: 'boolean', required: false },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { type: 'string', articles: 'array', attestations: 'array' }
  },
  {
    route: '/api/v1/bundles',
    method: 'POST',
    description: 'Import an article bundle.',
    public: false,
    params: [
      { name: 'bundle', in: 'body', type: 'object', required: true },
      { name: 'verify', in: 'body', type: 'boolean', required: false },
      { name: 'skipDuplicates', in: 'body', type: 'boolean', required: false }
    ],
    response: { imported: 'number', skipped: 'number', failed: 'number', results: 'array' }
  },
  {
    route: '/api/v1/export-all',
    method: 'GET',
    description: 'Export all indexed articles as a bundle.',
    public: false,
    params: [
      { name: 'no-attestations', in: 'query', type: 'boolean', required: false }
    ],
    response: { type: 'string', articles: 'array', attestations: 'array' }
  },
  {
    route: '/api/v1/history-export',
    method: 'GET',
    description: 'Export a full history bundle for an article key.',
    public: false,
    params: [
      { name: 'key', in: 'query', type: 'string', required: true },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { type: 'string', entries: 'array' }
  },
  {
    route: '/api/v1/history-import',
    method: 'POST',
    description: 'Import a history bundle.',
    public: false,
    params: [
      { name: 'bundle', in: 'body', type: 'object', required: true },
      { name: 'verify', in: 'body', type: 'boolean', required: false },
      { name: 'skipDuplicates', in: 'body', type: 'boolean', required: false }
    ],
    response: { imported: 'number', skipped: 'number', failed: 'number', results: 'array' }
  },
  {
    route: '/api/v1/diff',
    method: 'GET',
    description: 'Compare two article versions or local vs remote.',
    public: false,
    params: [
      { name: 'base', in: 'query', type: 'string', required: true },
      { name: 'head', in: 'query', type: 'string', required: false },
      { name: 'local', in: 'query', type: 'boolean', required: false },
      { name: 'format', in: 'query', type: 'string', required: false },
      { name: 'context', in: 'query', type: 'integer', required: false },
      { name: 'use-hyperbeam', in: 'query', type: 'boolean', required: false }
    ],
    response: { format: 'string', diff: 'string|array' }
  },
  {
    route: '/api/v1/completion',
    method: 'POST',
    description: 'Generate shell completion scripts.',
    public: false,
    params: [
      { name: 'shell', in: 'body', type: 'string', required: false }
    ],
    response: { script: 'string' }
  },
  {
    route: '/api/v1/validate',
    method: 'GET',
    description: 'Validation endpoint info and example schema references.',
    public: false,
    params: [
      { name: 'type', in: 'query', type: 'string', required: false }
    ],
    response: { type: 'string', note: 'string', schema: 'string' }
  },
  {
    route: '/api/v1/validate',
    method: 'POST',
    description: 'Validate article/attestation metadata or DataItem tags.',
    public: false,
    params: [
      { name: 'type', in: 'body', type: 'string', required: false },
      { name: 'tags', in: 'body', type: 'object|array', required: false },
      { name: 'dataItem', in: 'body', type: 'object', required: false }
    ],
    response: { valid: 'boolean', errors: 'array' }
  },
  {
    route: '/api/v1/schema',
    method: 'GET',
    description: 'JSON Schemas for article and attestation metadata.',
    public: false,
    params: [],
    response: { article: 'object', attestation: 'object' }
  },
  {
    route: '/api/v1/log/requests',
    method: 'GET',
    description: 'Recent HTTP request ring buffer (memory). Add ?source=disk to query persisted logs with filters, retention, and pagination.',
    public: false,
    params: [
      { name: 'limit', in: 'query', type: 'integer', required: false },
      { name: 'offset', in: 'query', type: 'integer', required: false },
      { name: 'method', in: 'query', type: 'string', required: false },
      { name: 'status', in: 'query', type: 'integer', required: false },
      { name: 'path', in: 'query', type: 'string', required: false },
      { name: 'after', in: 'query', type: 'string', required: false },
      { name: 'before', in: 'query', type: 'string', required: false },
      { name: 'source', in: 'query', type: 'string', required: false }
    ],
    response: { total: 'number', offset: 'number', limit: 'number', entries: 'array' }
  },
  {
    route: '/api/v1/log/requests/stream',
    method: 'GET',
    description: 'Server-Sent Events live stream of new HTTP request log entries.',
    public: true,
    params: [],
    response: { stream: 'text/event-stream' }
  },
  {
    route: '/api/v1/events/stream',
    method: 'GET',
    description: 'Server-Sent Events real-time event stream.',
    public: true,
    params: [
      { name: 'events', in: 'query', type: 'string', required: false }
    ],
    response: { stream: 'text/event-stream' }
  },
  {
    route: '/api/v1/events/ws',
    method: 'GET',
    description: 'WebSocket real-time event stream.',
    public: true,
    params: [],
    response: { stream: 'websocket' }
  },
  {
    route: '/api/v1/articles/stream',
    method: 'GET',
    description: 'Server-Sent Events live query stream of article/attestation updates.',
    public: true,
    params: [
      { name: 'topic', in: 'query', type: 'string', required: false },
      { name: 'kind', in: 'query', type: 'string', required: false },
      { name: 'agent', in: 'query', type: 'string', required: false },
      { name: 'key', in: 'query', type: 'string', required: false },
      { name: 'events', in: 'query', type: 'string', required: false }
    ],
    response: { stream: 'text/event-stream' }
  },
  {
    route: '/api/v1/events/publish',
    method: 'POST',
    description: 'Publish events to the local event bus (used by remote forwarders).',
    public: false,
    params: [
      { name: 'events', in: 'body', type: 'array', required: true }
    ],
    response: { forwarded: 'number' }
  },
  {
    route: '/api/v1/threshold-attest',
    method: 'POST',
    description: 'Create a threshold attestation envelope.',
    public: false,
    params: [
      { name: 'key', in: 'body', type: 'string', required: true },
      { name: 'opinion', in: 'body', type: 'string', required: true },
      { name: 'confidence', in: 'body', type: 'number', required: true },
      { name: 'reason', in: 'body', type: 'string', required: true },
      { name: 'policy', in: 'body', type: 'object', required: true }
    ],
    response: { envelopeId: 'string' }
  },
  {
    route: '/api/v1/threshold-attest/sign',
    method: 'POST',
    description: 'Add a co-signer signature to a threshold envelope.',
    public: false,
    params: [
      { name: 'envelopeId', in: 'body', type: 'string', required: true },
      { name: 'signer', in: 'body', type: 'object', required: true }
    ],
    response: { envelopeId: 'string', signers: 'array' }
  },
  {
    route: '/api/v1/threshold-attest/finalize',
    method: 'POST',
    description: 'Finalize and publish a threshold attestation.',
    public: false,
    params: [
      { name: 'envelopeId', in: 'body', type: 'string', required: true },
      { name: 'useHyperbeam', in: 'body', type: 'boolean', required: false }
    ],
    response: { summary: 'object', item: 'object' }
  },
  {
    route: '/api/v1/threshold-attest/verify',
    method: 'POST',
    description: 'Verify a threshold attestation envelope.',
    public: false,
    params: [
      { name: 'envelope', in: 'body', type: 'object', required: true }
    ],
    response: { ok: 'boolean', valid: 'number', required: 'number' }
  },
  {
    route: '/api/v1/threshold-attest/import',
    method: 'POST',
    description: 'Import a threshold attestation envelope.',
    public: false,
    params: [
      { name: 'envelope', in: 'body', type: 'object', required: true }
    ],
    response: { envelopeId: 'string' }
  },
  {
    route: '/api/v1/threshold/envelope/:envelopeId',
    method: 'GET',
    description: 'Export a threshold envelope by id.',
    public: false,
    params: [
      { name: 'envelopeId', in: 'path', type: 'string', required: true }
    ],
    response: { envelope: 'object' }
  },
  {
    route: '/api/v1/threshold/envelope',
    method: 'POST',
    description: 'Import a threshold envelope (alias).',
    public: false,
    params: [
      { name: 'envelope', in: 'body', type: 'object', required: true }
    ],
    response: { envelopeId: 'string' }
  },
  {
    route: '/api/v1/peer/info',
    method: 'GET',
    description: 'Return local peer information for gossip sync.',
    public: false,
    params: [],
    response: { agentId: 'string', keys: 'array' }
  },
  {
    route: '/api/v1/peer/pull',
    method: 'POST',
    description: 'Build a pull bundle for a remote peer.',
    public: false,
    params: [
      { name: 'requests', in: 'body', type: 'array', required: true },
      { name: 'includeAttestations', in: 'body', type: 'boolean', required: false }
    ],
    response: { type: 'string', articles: 'array', attestations: 'array' }
  },
  {
    route: '/api/v1/peer/push',
    method: 'POST',
    description: 'Accept a push bundle from a remote peer.',
    public: false,
    params: [
      { name: 'bundle', in: 'body', type: 'object', required: true },
      { name: 'verify', in: 'body', type: 'boolean', required: false },
      { name: 'skipDuplicates', in: 'body', type: 'boolean', required: false }
    ],
    response: { imported: 'number', skipped: 'number', failed: 'number', results: 'array' }
  }
];

function typeToOpenApi(type) {
  if (type === 'string') return { type: 'string' };
  if (type === 'integer') return { type: 'integer' };
  if (type === 'number') return { type: 'number' };
  if (type === 'boolean') return { type: 'boolean' };
  if (type === 'array') return { type: 'array' };
  if (type === 'object') return { type: 'object' };
  if (type === 'bytes') return { type: 'string', format: 'binary' };
  return { type: 'string' };
}

export function buildOpenApiDocument(options = {}) {
  const info = options.info || {
    title: 'PermaBrain HTTP API',
    version: options.apiVersion || '1.0.0',
    description: 'REST/JSON API for the local PermaBrain knowledge graph server.'
  };
  const paths = {};
  const securitySchemes = {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      description: 'Authorization: Bearer <api-key>'
    },
    apiKeyHeader: {
      type: 'apiKey',
      in: 'header',
      name: 'x-api-key'
    }
  };

  for (const route of ROUTES) {
    const openApiPath = route.route.replace(/:([^/]+)/g, '{$1}');
    const parameters = [];
    const requestBody = { content: { 'application/json': { schema: { type: 'object', properties: {}, required: [] } } } };
    let hasBody = false;

    for (const param of route.params || []) {
      if (param.in === 'body') {
        hasBody = true;
        requestBody.content['application/json'].schema.properties[param.name] = typeToOpenApi(param.type);
        if (param.required) requestBody.content['application/json'].schema.required.push(param.name);
      } else if (param.in === 'path') {
        parameters.push({
          name: param.name,
          in: 'path',
          required: true,
          schema: typeToOpenApi(param.type)
        });
      } else if (param.in === 'query') {
        parameters.push({
          name: param.name,
          in: 'query',
          required: param.required || false,
          schema: typeToOpenApi(param.type)
        });
      }
    }

    const responses = {
      '200': {
        description: 'Success',
        content: { 'application/json': { schema: typeToOpenApi(route.response ? 'object' : 'object') } }
      }
    };

    const operation = {
      operationId: `${route.method.toLowerCase()}${openApiPath.replace(/[{}\/]/g, '_')}`,
      summary: route.description,
      tags: route.public ? ['Public', 'Discovery'] : ['Agent API'],
      parameters: parameters.length ? parameters : undefined,
      responses
    };
    if (hasBody) operation.requestBody = requestBody;
    if (!route.public && options.requireAuth) {
      operation.security = [{ bearerAuth: [] }, { apiKeyHeader: [] }];
    }

    if (!paths[openApiPath]) paths[openApiPath] = {};
    paths[openApiPath][route.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.0.3',
    info,
    servers: [{ url: options.baseUrl || 'http://localhost:8765', description: 'Local PermaBrain server' }],
    paths,
    components: { securitySchemes }
  };
}

export function listRoutes(options = {}) {
  return ROUTES.map((r) => ({
    route: r.route,
    method: r.method,
    description: r.description,
    auth: options.authRequired ? !r.public : false,
    params: (r.params || []).map((p) => ({ name: p.name, in: p.in, type: p.type, required: !!p.required })),
    public: r.public
  }));
}
