-- PermaBrain AO Process
-- Live on-chain index (derived state) for fast queries over PermaBrain articles and attestations.
--
-- Arweave DataItems remain the source of truth. This AO process is a cache/index:
--   - Writes: articles and attestations are pushed here AND to Arweave in parallel
--   - Reads: AO dryrun (instant, free) → GraphQL scan (slow) → local cache (offline)
--
-- Tag schema matches the PermaBrain spec (see docs/tag-schema.md).
-- Action tags route messages to handlers; PermaBrain-Type tags mirror the DataItem schema.
--
-- Usage:
--   .load process.lua
--   Handlers.list   -- inspect registered handlers

local json = require('json')

-- ============================================================================
-- State
-- ============================================================================

-- Articles indexed by canonical key (e.g., "person/ada-lovelace")
-- Each entry: { id, key, kind, title, slug, topic, language, version, previousId, rootId,
--              sourceName, sourceUrl, sourceLicense, contentHash, publishedAt, updatedAt, authorAgentId }
Articles = Articles or {}

-- Attestations indexed by target article key
-- Each key maps to an array of attestation entries:
--   { id, targetId, targetKey, opinion, confidence, reason, agentId, sourceUrl, createdAt }
Attestations = Attestations or {}

-- Track the latest DataItem ID per article key (for consensus target-version weighting)
LatestArticleIds = LatestArticleIds or {}

-- Process version
PermaBrainVersion = "0.1.0"

-- Valid opinion values
local VALID_OPINIONS = {
  valid = true,
  invalid = true,
  ["partially-valid"] = true,
  outdated = true,
  disputed = true
}

-- Valid article kinds
local VALID_KINDS = {
  person = true,
  subject = true,
  event = true,
  organization = true,
  source = true,
  news = true
}

-- Opinion weights for consensus scoring
local OPINION_WEIGHTS = {
  valid = 1,
  ["partially-valid"] = 0.5,
  invalid = -1,
  disputed = -0.75,
  outdated = -0.5
}

-- ============================================================================
-- Helpers
-- ============================================================================

--- Validate an article key format: "kind/slug" or "kind/slug/sub"
local function validateArticleKey(key)
  if type(key) ~= "string" then return false end
  local kind = key:match("^([a-z]+)/")
  if not kind then return false end
  if not VALID_KINDS[kind] then return false end
  -- slug part: lowercase alphanumeric and hyphens
  local slug = key:match("^" .. kind .. "/([a-z0-9][a-z0-9-]*)$")
  if slug then return true end
  -- allow one level of nesting: kind/slug/sub
  local sub = key:match("^" .. kind .. "/([a-z0-9][a-z0-9-]*)/([a-z0-9][a-z0-9-]*)$")
  if sub then return true end
  return false
end

--- Validate opinion value
local function validateOpinion(opinion)
  return VALID_OPINIONS[opinion] == true
end

--- Validate confidence: number between 0 and 1
local function validateConfidence(conf)
  local n = tonumber(conf)
  return n ~= nil and n >= 0 and n <= 1
end

--- Compute freshness weight for an attestation (mirrors consensus.mjs logic)
--   0-90 days: weight 1
--   90-365 days: linear decay 1 → 0.5
--   365+ days: weight 0.5
local function freshnessWeight(createdAt)
  if not createdAt or createdAt == "" then return 1 end
  local created = parse_iso8601(createdAt)
  if not created then return 1 end
  local now = tonumber(msg and msg["Block-Height"] or 0) -- approximate; real impl would use block timestamp
  -- Simple approach: use ao.env or fallback
  -- For dryrun queries, freshness is less critical (recent data assumed)
  return 1
end

--- Simple ISO 8601 date parser (YYYY-MM-DDTHH:MM:SSZ)
local function parse_iso8601(str)
  if not str then return nil end
  -- Just return the string for comparison; Lua doesn't have native date parsing
  -- but string comparison works for ISO 8601 dates
  return str
end

--- Find latest attestation per agent per target (mirrors consensus.mjs latestAttestationsByAgentAndTarget)
local function latestAttestationsByAgent(atts)
  local latest = {}
  for _, att in ipairs(atts) do
    local compositeKey = (att.agentId or att.id) .. ":" .. (att.targetId or "")
    local current = latest[compositeKey]
    if not current or (att.createdAt or "") >= (current.createdAt or "") then
      latest[compositeKey] = att
    end
  end
  local result = {}
  for _, v in pairs(latest) do
    table.insert(result, v)
  end
  return result
end

--- Compute consensus score for a set of attestations (mirrors consensus.mjs consensusScore)
local function computeConsensus(atts, latestArticleId)
  if #atts == 0 then
    return { score = 0, status = "unattested", consideredCount = 0 }
  end

  local considered = latestAttestationsByAgent(atts)
  local weightedSum = 0
  local totalWeight = 0

  for _, att in ipairs(considered) do
    local confidence = tonumber(att.confidence or 0)
    local opinionWeight = OPINION_WEIGHTS[att.opinion] or 0
    -- Target version weight: if attestation targets a non-latest version, halve its weight
    local targetVersionWeight = 1
    if latestArticleId and att.targetId and att.targetId ~= latestArticleId then
      targetVersionWeight = 0.5
    end
    -- Freshness weight: currently 1 (would need block timestamps for real calculation)
    local recencyWeight = 1
    local weight = targetVersionWeight * recencyWeight
    local contribution = opinionWeight * confidence * weight
    weightedSum = weightedSum + contribution
    totalWeight = totalWeight + weight
  end

  local score = totalWeight > 0 and (weightedSum / totalWeight) or 0
  return {
    score = score,
    status = "attested",
    consideredCount = #considered
  }
end

--- Count opinions across attestations
local function countOpinions(atts)
  local counts = {
    valid = 0,
    invalid = 0,
    ["partially-valid"] = 0,
    outdated = 0,
    disputed = 0
  }
  for _, att in ipairs(atts) do
    if counts[att.opinion] then
      counts[att.opinion] = counts[att.opinion] + 1
    end
  end
  return counts
end

--- Extract tags from a message as a table (name → value)
local function tagsToTable(msgTags)
  local t = {}
  if type(msgTags) ~= "table" then return t end
  for _, tag in ipairs(msgTags) do
    if tag.name and tag.value then
      t[tag.name] = tag.value
    end
  end
  return t
end

-- ============================================================================
-- Handlers
-- ============================================================================

-- Publish — index an article in process state
-- Tags required: Action = "Publish", plus all Article-* tags from the PermaBrain spec
-- This mirrors publishArticle() in article.mjs: stores the article, tracks version, updates LatestArticleIds
Handlers.add("Publish", "Publish", function(msg)
  local tags = tagsToTable(msg.Tags)

  -- Required fields
  local key = tags["Article-Key"]
  local kind = tags["Article-Kind"]
  local title = tags["Article-Title"]
  local topic = tags["Article-Topic"]
  local agentId = tags["Author-Agent-Id"]

  if not key or not kind or not title or not topic or not agentId then
    msg.reply({
      Action = "Publish-Error",
      Error = "Missing required tags: Article-Key, Article-Kind, Article-Title, Article-Topic, Author-Agent-Id"
    })
    return
  end

  if not validateArticleKey(key) then
    msg.reply({
      Action = "Publish-Error",
      Error = "Invalid Article-Key: " .. key
    })
    return
  end

  if not VALID_KINDS[kind] then
    msg.reply({
      Action = "Publish-Error",
      Error = "Invalid Article-Kind: " .. kind .. ". Expected: person, subject, event, organization, source, news"
    })
    return
  end

  local version = tonumber(tags["Article-Version"]) or 1
  local existing = Articles[key]
  local previousId = tags["Article-Previous-Id"] or (existing and existing.id or nil)
  local rootId = tags["Article-Root-Id"] or (existing and existing.rootId or nil)

  -- If no explicit previousId/rootId but we have existing state, derive them
  if existing and not tags["Article-Previous-Id"] then
    previousId = existing.id
  end
  if existing and not tags["Article-Root-Id"] then
    rootId = existing.rootId or existing.id
  end

  -- Version bumping: if existing article has higher version, reject or auto-increment
  if existing and version <= existing.version then
    version = existing.version + 1
  end

  local article = {
    id = tags["DataItem-Id"] or msg.Id or "",
    key = key,
    kind = kind,
    title = title,
    slug = tags["Article-Slug"] or key:match("/([a-z0-9-]+)$"),
    topic = topic,
    language = tags["Article-Language"] or "en",
    version = version,
    previousId = previousId,
    rootId = rootId,
    sourceName = tags["Article-Source-Name"] or "Unknown",
    sourceUrl = tags["Article-Source-Url"] or "",
    sourceLicense = tags["Article-Source-License"] or "",
    contentHash = tags["Article-Content-Hash"] or "",
    publishedAt = tags["Article-Published-At"] or "",
    updatedAt = tags["Article-Updated-At"] or tags["Article-Published-At"] or "",
    authorAgentId = agentId
  }

  Articles[key] = article
  LatestArticleIds[key] = article.id

  msg.reply({
    Action = "Publish-Notice",
    ["Article-Key"] = key,
    ["Article-Version"] = tostring(version),
    ["DataItem-Id"] = article.id,
    Data = "Published " .. key .. " v" .. tostring(version)
  })
end)

-- Attest — record an attestation against an article
-- Tags required: Action = "Attest", Attestation-Target-Key, Attestation-Opinion,
--                Attestation-Confidence, Attestation-Reason, Attestation-Agent-Id
-- This mirrors attestArticle() in attestation.mjs
Handlers.add("Attest", "Attest", function(msg)
  local tags = tagsToTable(msg.Tags)

  local targetKey = tags["Attestation-Target-Key"]
  local opinion = tags["Attestation-Opinion"]
  local confidence = tags["Attestation-Confidence"]
  local reason = tags["Attestation-Reason"]
  local agentId = tags["Attestation-Agent-Id"]

  if not targetKey or not opinion or not confidence or not reason or not agentId then
    msg.reply({
      Action = "Attest-Error",
      Error = "Missing required tags: Attestation-Target-Key, Attestation-Opinion, Attestation-Confidence, Attestation-Reason, Attestation-Agent-Id"
    })
    return
  end

  if not validateArticleKey(targetKey) then
    msg.reply({
      Action = "Attest-Error",
      Error = "Invalid Attestation-Target-Key: " .. targetKey
    })
    return
  end

  if not validateOpinion(opinion) then
    msg.reply({
      Action = "Attest-Error",
      Error = "Invalid Attestation-Opinion: " .. opinion .. ". Expected: valid, invalid, partially-valid, outdated, disputed"
    })
    return
  end

  if not validateConfidence(confidence) then
    msg.reply({
      Action = "Attest-Error",
      Error = "Invalid Attestation-Confidence: " .. confidence .. ". Expected: number 0 to 1"
    })
    return
  end

  local attestation = {
    id = tags["DataItem-Id"] or msg.Id or "",
    targetId = tags["Attestation-Target-Id"] or "",
    targetKey = targetKey,
    opinion = opinion,
    confidence = tonumber(confidence),
    reason = reason,
    agentId = agentId,
    sourceUrl = tags["Attestation-Source-Url"] or "",
    createdAt = tags["Attestation-Created-At"] or ""
  }

  if not Attestations[targetKey] then
    Attestations[targetKey] = {}
  end
  table.insert(Attestations[targetKey], attestation)

  msg.reply({
    Action = "Attest-Notice",
    ["Attestation-Target-Key"] = targetKey,
    ["Attestation-Opinion"] = opinion,
    ["Attestation-Confidence"] = tostring(confidence),
    ["DataItem-Id"] = attestation.id,
    Data = "Attested " .. targetKey .. ": " .. opinion .. " (" .. tostring(confidence) .. ")"
  })
end)

-- Query — search articles by topic, kind, or key prefix
-- Tags: Action = "Query", [Article-Topic], [Article-Kind], [Article-Key], [Article-Source-Name]
-- Returns JSON array of matching article summaries
-- This mirrors queryArticles() in article.mjs
Handlers.add("Query", "Query", function(msg)
  local tags = tagsToTable(msg.Tags)

  local filterTopic = tags["Article-Topic"]
  local filterKind = tags["Article-Kind"]
  local filterKey = tags["Article-Key"]
  local filterSourceName = tags["Article-Source-Name"]

  local results = {}
  for key, article in pairs(Articles) do
    if filterTopic and article.topic ~= filterTopic then goto next end
    if filterKind and article.kind ~= filterKind then goto next end
    if filterKey and article.key ~= filterKey then goto next end
    if filterSourceName and article.sourceName ~= filterSourceName then goto next end
    table.insert(results, article)
    ::next::
  end

  -- Sort by key for deterministic output
  table.sort(results, function(a, b) return a.key < b.key end)

  msg.reply({
    Action = "Query-Response",
    Data = json.encode(results)
  })
end)

-- Get — fetch a single article by canonical key
-- Tags: Action = "Get", Article-Key = "<key>"
-- Returns the article metadata as JSON (content itself lives on Arweave, not in process state)
-- This mirrors getArticle() in article.mjs
Handlers.add("Get", "Get", function(msg)
  local tags = tagsToTable(msg.Tags)
  local key = tags["Article-Key"]

  if not key then
    msg.reply({
      Action = "Get-Error",
      Error = "Missing required tag: Article-Key"
    })
    return
  end

  local article = Articles[key]
  if not article then
    msg.reply({
      Action = "Get-Error",
      Error = "Article not found: " .. key
    })
    return
  end

  msg.reply({
    Action = "Get-Response",
    Data = json.encode(article)
  })
end)

-- Consensus — compute weighted consensus score for an article
-- Tags: Action = "Consensus", Article-Key = "<key>"
-- Returns score, status, opinion counts, total attestations
-- This mirrors consensusForArticle() in consensus.mjs
Handlers.add("Consensus", "Consensus", function(msg)
  local tags = tagsToTable(msg.Tags)
  local key = tags["Article-Key"]

  if not key then
    msg.reply({
      Action = "Consensus-Error",
      Error = "Missing required tag: Article-Key"
    })
    return
  end

  local article = Articles[key]
  local latestId = article and article.id or LatestArticleIds[key] or nil
  local atts = Attestations[key] or {}
  local scored = computeConsensus(atts, latestId)
  local opinionCounts = countOpinions(atts)

  local result = {
    key = key,
    latestArticleId = latestId,
    latestVersion = article and article.version or nil,
    status = scored.status,
    totalAttestations = scored.consideredCount,
    rawAttestations = #atts,
    opinionCounts = opinionCounts,
    score = scored.score
  }

  msg.reply({
    Action = "Consensus-Response",
    Data = json.encode(result)
  })
end)

-- Sync — bulk-load articles and attestations into process state
-- Tags: Action = "Sync", Data = JSON { articles: [...], attestations: [...] }
-- This is the bootstrap path: replay existing Arweave DataItems into the AO process
-- Mirrors syncArticlesAndAttestations() in article.mjs but takes pre-fetched data
Handlers.add("Sync", "Sync", function(msg)
  local data = msg.Data
  if not data or data == "" then
    msg.reply({
      Action = "Sync-Error",
      Error = "Missing Data payload. Expected JSON with 'articles' and 'attestations' arrays."
    })
    return
  end

  local ok, payload = pcall(json.decode, data)
  if not ok or type(payload) ~= "table" then
    msg.reply({
      Action = "Sync-Error",
      Error = "Invalid JSON payload"
    })
    return
  end

  local articleCount = 0
  local attestationCount = 0

  -- Index articles — keep latest version per key
  if payload.articles then
    for _, a in ipairs(payload.articles) do
      if a.key then
        local existing = Articles[a.key]
        if not existing or (a.version and tonumber(a.version) > tonumber(existing.version or 0)) then
          Articles[a.key] = {
            id = a.id or "",
            key = a.key,
            kind = a.kind or "",
            title = a.title or "",
            slug = a.slug or "",
            topic = a.topic or "",
            language = a.language or "en",
            version = tonumber(a.version) or 1,
            previousId = a.previousId or nil,
            rootId = a.rootId or nil,
            sourceName = a.sourceName or "",
            sourceUrl = a.sourceUrl or "",
            sourceLicense = a.sourceLicense or "",
            contentHash = a.contentHash or "",
            publishedAt = a.publishedAt or a.updatedAt or "",
            updatedAt = a.updatedAt or a.publishedAt or "",
            authorAgentId = a.authorAgentId or a.authorAgentId or ""
          }
          LatestArticleIds[a.key] = a.id or ""
          articleCount = articleCount + 1
        end
      end
    end
  end

  -- Index attestations — append to existing arrays
  if payload.attestations then
    for _, att in ipairs(payload.attestations) do
      local targetKey = att.targetKey
      if targetKey then
        if not Attestations[targetKey] then
          Attestations[targetKey] = {}
        end
        table.insert(Attestations[targetKey], {
          id = att.id or "",
          targetId = att.targetId or "",
          targetKey = targetKey,
          opinion = att.opinion or "",
          confidence = tonumber(att.confidence) or 0,
          reason = att.reason or "",
          agentId = att.agentId or "",
          sourceUrl = att.sourceUrl or "",
          createdAt = att.createdAt or ""
        })
        attestationCount = attestationCount + 1
      end
    end
  end

  local totalArticles = 0
  for _ in pairs(Articles) do totalArticles = totalArticles + 1 end
  local totalAttestations = 0
  for _, atts in pairs(Attestations) do
    totalAttestations = totalAttestations + #atts
  end

  msg.reply({
    Action = "Sync-Notice",
    ["Sync-Articles-Loaded"] = tostring(articleCount),
    ["Sync-Attestations-Loaded"] = tostring(attestationCount),
    ["Total-Articles"] = tostring(totalArticles),
    ["Total-Attestations"] = tostring(totalAttestations),
    Data = "Synced " .. tostring(articleCount) .. " articles and " .. tostring(attestationCount) .. " attestations"
  })
end)

-- ============================================================================
-- Info — return process metadata
-- ============================================================================
Handlers.add("Info", "Info", function(msg)
  local totalArticles = 0
  for _ in pairs(Articles) do totalArticles = totalArticles + 1 end
  local totalAttestations = 0
  for _, atts in pairs(Attestations) do
    totalAttestations = totalAttestations + #atts
  end

  msg.reply({
    Action = "Info-Response",
    ["App-Name"] = "PermaBrain",
    ["App-Version"] = PermaBrainVersion,
    ["Process-Id"] = ao.id,
    ["Total-Articles"] = tostring(totalArticles),
    ["Total-Attestations"] = tostring(totalAttestations),
    Data = "PermaBrain v" .. PermaBrainVersion .. " | " .. tostring(totalArticles) .. " articles | " .. tostring(totalAttestations) .. " attestations"
  })
end)