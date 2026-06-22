import * as $option from "../../gleam_stdlib/gleam/option.mjs";
import { Ok, Error, CustomType as $CustomType } from "../gleam.mjs";

export class Valid extends $CustomType {}
export const Opinion$Valid = () => new Valid();
export const Opinion$isValid = (value) => value instanceof Valid;

export class Invalid extends $CustomType {}
export const Opinion$Invalid = () => new Invalid();
export const Opinion$isInvalid = (value) => value instanceof Invalid;

export class PartiallyValid extends $CustomType {}
export const Opinion$PartiallyValid = () => new PartiallyValid();
export const Opinion$isPartiallyValid = (value) =>
  value instanceof PartiallyValid;

export class Outdated extends $CustomType {}
export const Opinion$Outdated = () => new Outdated();
export const Opinion$isOutdated = (value) => value instanceof Outdated;

export class Disputed extends $CustomType {}
export const Opinion$Disputed = () => new Disputed();
export const Opinion$isDisputed = (value) => value instanceof Disputed;

export class Attestation extends $CustomType {
  constructor(id, target_id, target_key, opinion, confidence, reason, agent_id, source_url, created_at) {
    super();
    this.id = id;
    this.target_id = target_id;
    this.target_key = target_key;
    this.opinion = opinion;
    this.confidence = confidence;
    this.reason = reason;
    this.agent_id = agent_id;
    this.source_url = source_url;
    this.created_at = created_at;
  }
}
export const Attestation$Attestation = (id, target_id, target_key, opinion, confidence, reason, agent_id, source_url, created_at) =>
  new Attestation(id,
  target_id,
  target_key,
  opinion,
  confidence,
  reason,
  agent_id,
  source_url,
  created_at);
export const Attestation$isAttestation = (value) =>
  value instanceof Attestation;
export const Attestation$Attestation$id = (value) => value.id;
export const Attestation$Attestation$0 = (value) => value.id;
export const Attestation$Attestation$target_id = (value) => value.target_id;
export const Attestation$Attestation$1 = (value) => value.target_id;
export const Attestation$Attestation$target_key = (value) => value.target_key;
export const Attestation$Attestation$2 = (value) => value.target_key;
export const Attestation$Attestation$opinion = (value) => value.opinion;
export const Attestation$Attestation$3 = (value) => value.opinion;
export const Attestation$Attestation$confidence = (value) => value.confidence;
export const Attestation$Attestation$4 = (value) => value.confidence;
export const Attestation$Attestation$reason = (value) => value.reason;
export const Attestation$Attestation$5 = (value) => value.reason;
export const Attestation$Attestation$agent_id = (value) => value.agent_id;
export const Attestation$Attestation$6 = (value) => value.agent_id;
export const Attestation$Attestation$source_url = (value) => value.source_url;
export const Attestation$Attestation$7 = (value) => value.source_url;
export const Attestation$Attestation$created_at = (value) => value.created_at;
export const Attestation$Attestation$8 = (value) => value.created_at;

/**
 * Parse an opinion string from Arweave tags
 */
export function opinion_from_string(s) {
  if (s === "valid") {
    return new Ok(new Valid());
  } else if (s === "invalid") {
    return new Ok(new Invalid());
  } else if (s === "partially-valid") {
    return new Ok(new PartiallyValid());
  } else if (s === "outdated") {
    return new Ok(new Outdated());
  } else if (s === "disputed") {
    return new Ok(new Disputed());
  } else {
    return new Error(undefined);
  }
}

/**
 * Human-readable label for UI display
 */
export function opinion_label(opinion) {
  if (opinion instanceof Valid) {
    return "Valid";
  } else if (opinion instanceof Invalid) {
    return "Invalid";
  } else if (opinion instanceof PartiallyValid) {
    return "Partially Valid";
  } else if (opinion instanceof Outdated) {
    return "Outdated";
  } else {
    return "Disputed";
  }
}

/**
 * Color class for CSS styling
 */
export function opinion_color(opinion) {
  if (opinion instanceof Valid) {
    return "opinion-valid";
  } else if (opinion instanceof Invalid) {
    return "opinion-invalid";
  } else if (opinion instanceof PartiallyValid) {
    return "opinion-partially-valid";
  } else if (opinion instanceof Outdated) {
    return "opinion-outdated";
  } else {
    return "opinion-disputed";
  }
}

/**
 * Weight of an opinion in consensus scoring
 */
export function opinion_weight(opinion) {
  if (opinion instanceof Valid) {
    return 1.0;
  } else if (opinion instanceof Invalid) {
    return -1.0;
  } else if (opinion instanceof PartiallyValid) {
    return 0.5;
  } else if (opinion instanceof Outdated) {
    return -0.5;
  } else {
    return -0.75;
  }
}
