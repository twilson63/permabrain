/**
 * PermaBrain Article/Attestation Metadata JSON Schema
 *
 * Lightweight, dependency-free schema validation for DataItem tag metadata.
 * Used by publish/attest/import/HTTP to catch bad metadata before it hits the
 * transport. The schema describes the tags we emit, not the full Arweave tx.
 */

export const ARTICLE_METADATA_SCHEMA = {
  type: 'object',
  required: ['App-Name', 'App-Version', 'PermaBrain-Type', 'Article-Key', 'Article-Kind', 'Article-Title', 'Article-Slug', 'Article-Topic', 'Article-Language', 'Article-Version', 'Article-Source-Name', 'Article-Source-Url', 'Article-Content-Hash', 'Article-Published-At', 'Article-Updated-At', 'Author-Agent-Id', 'Visibility'],
  properties: {
    'App-Name': { type: 'string', const: 'PermaBrain' },
    'App-Version': { type: 'string', minLength: 1 },
    'PermaBrain-Type': { type: 'string', const: 'article' },
    'Article-Key': { type: 'string', pattern: '^[a-z]+/[a-z0-9][a-z0-9-]*(?:/[a-z0-9][a-z0-9-]*)*$' },
    'Article-Kind': { type: 'string', enum: ['person', 'subject', 'event', 'organization', 'source', 'news'] },
    'Article-Title': { type: 'string', minLength: 1, maxLength: 240 },
    'Article-Slug': { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' },
    'Article-Topic': { type: 'string', minLength: 1, maxLength: 120 },
    'Article-Language': { type: 'string', pattern: '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)*$' },
    'Article-Version': { type: 'integer', minimum: 1 },
    'Article-Previous-Id': { oneOf: [{ type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' }, { type: 'null' }] },
    'Article-Root-Id': { oneOf: [{ type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' }, { type: 'null' }] },
    'Article-Source-Name': { type: 'string', minLength: 1, maxLength: 120 },
    'Article-Source-Url': { type: 'string', format: 'uri' },
    'Article-Source-License': { type: 'string', maxLength: 120 },
    'Article-Content-Hash': { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    'Article-Published-At': { type: 'string', format: 'date-time' },
    'Article-Updated-At': { type: 'string', format: 'date-time' },
    'Author-Agent-Id': { type: 'string', pattern: '^(ed25519|arweave):[A-Za-z0-9_-]+$' },
    'Visibility': { type: 'string', enum: ['public', 'encrypted', 'private'] },
    'Encryption-Recipients': { type: 'string', maxLength: 4096 },
    'Encryption-Ephemeral-Public-Key': { type: 'string', maxLength: 256 }
  },
  additionalProperties: { type: 'string', maxLength: 4096 }
};

export const ATTESTATION_METADATA_SCHEMA = {
  type: 'object',
  required: ['App-Name', 'App-Version', 'PermaBrain-Type', 'Attestation-Target-Id', 'Attestation-Target-Key', 'Attestation-Opinion', 'Attestation-Confidence', 'Attestation-Reason', 'Attestation-Agent-Id', 'Attestation-Created-At'],
  properties: {
    'App-Name': { type: 'string', const: 'PermaBrain' },
    'App-Version': { type: 'string', minLength: 1 },
    'PermaBrain-Type': { type: 'string', const: 'attestation' },
    'Attestation-Target-Id': { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
    'Attestation-Target-Key': { type: 'string', pattern: '^[a-z]+/[a-z0-9][a-z0-9-]*(?:/[a-z0-9][a-z0-9-]*)*$' },
    'Attestation-Opinion': { type: 'string', enum: ['valid', 'invalid', 'partially-valid', 'outdated', 'disputed'] },
    'Attestation-Confidence': { type: 'number', minimum: 0, maximum: 1 },
    'Attestation-Reason': { type: 'string', minLength: 1, maxLength: 2000 },
    'Attestation-Agent-Id': { type: 'string', pattern: '^(ed25519|arweave):[A-Za-z0-9_-]+$' },
    'Attestation-Source-Url': { oneOf: [{ type: 'string', format: 'uri' }, { type: 'string', maxLength: 0 }] },
    'Attestation-Proxy': { type: 'string', enum: ['true', 'false'] },
    'Attestation-Requester-Id': { oneOf: [{ type: 'string', pattern: '^(ed25519|arweave):[A-Za-z0-9_-]+$' }, { type: 'null' }] },
    'Attestation-Created-At': { type: 'string', format: 'date-time' },
    'Attestation-Threshold': { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    'Attestation-Co-Signer-Count': { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    'Attestation-Co-Signer-Ids': { oneOf: [{ type: 'string', maxLength: 4096 }, { type: 'null' }] },
    'Attestation-Multi-Sig': { type: 'string', enum: ['true', 'false'] }
  },
  additionalProperties: { type: 'string', maxLength: 4096 }
};

const TYPE_CHECKERS = {
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  null: (v) => v === null
};

const FORMATS = {
  'date-time': (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v),
  uri: (v) => {
    try { new URL(v); return true; } catch { return false; }
  }
};

function isIntegerString(value) {
  return typeof value === 'string' && /^-?\d+$/.test(value);
}

function isNumberString(value) {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value));
}

function matchSchema(value, schema, path = '') {
  const errors = [];
  if (schema.const !== undefined && value !== schema.const) {
    errors.push({ path, message: `expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}` });
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path, message: `expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}` });
    return errors;
  }
  // Permit integer/number-typed schema fields to accept canonical numeric strings
  // because ANS-104 tags always serialize values as strings.
  let coercedValue = value;
  if (schema.type === 'integer' && typeof value === 'string' && isIntegerString(value)) {
    coercedValue = Number(value);
  }
  if (schema.type === 'number' && typeof value === 'string' && isNumberString(value)) {
    coercedValue = Number(value);
  }
  const checker = TYPE_CHECKERS[schema.type];
  if (schema.type && checker && !checker(coercedValue)) {
    errors.push({ path, message: `expected ${schema.type}, got ${typeof value}` });
    return errors;
  }
  if (schema.type === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, message: `minLength ${schema.minLength}` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path, message: `maxLength ${schema.maxLength}` });
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path, message: `pattern ${schema.pattern}` });
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format](value)) errors.push({ path, message: `format ${schema.format}` });
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    if (schema.minimum !== undefined && coercedValue < schema.minimum) errors.push({ path, message: `minimum ${schema.minimum}` });
    if (schema.maximum !== undefined && coercedValue > schema.maximum) errors.push({ path, message: `maximum ${schema.maximum}` });
  }
  if (schema.oneOf) {
    const subErrors = schema.oneOf.map((sub) => matchSchema(value, sub, path));
    const anyOk = subErrors.some((e) => e.length === 0);
    if (!anyOk) errors.push({ path, message: 'did not match any allowed schema' });
  }
  return errors;
}

export function validateMetadata(obj, schema) {
  const errors = [];
  if (schema.required) {
    for (const key of schema.required) {
      if (!(key in obj)) errors.push({ path: key, message: 'required property missing' });
    }
  }
  for (const [key, value] of Object.entries(obj)) {
    const propSchema = schema.properties?.[key];
    if (propSchema) {
      errors.push(...matchSchema(value, propSchema, key));
    } else if (schema.additionalProperties === false) {
      errors.push({ path: key, message: 'additional property not allowed' });
    } else if (typeof schema.additionalProperties === 'object') {
      errors.push(...matchSchema(value, schema.additionalProperties, key));
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateArticleMetadata(tagsObject) {
  return validateMetadata(tagsObject, ARTICLE_METADATA_SCHEMA);
}

export function validateAttestationMetadata(tagsObject) {
  return validateMetadata(tagsObject, ATTESTATION_METADATA_SCHEMA);
}

export function validateDataItemTags(dataItem, type = 'article') {
  const tagsObj = Object.fromEntries((dataItem.tags || []).map((t) => [t.name, t.value]));
  if (type === 'article') return validateArticleMetadata(tagsObj);
  if (type === 'attestation') return validateAttestationMetadata(tagsObj);
  return { valid: false, errors: [{ path: '', message: `unknown type ${type}` }] };
}

export function formatValidationErrors(result) {
  if (result.valid) return 'OK';
  return result.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
}
