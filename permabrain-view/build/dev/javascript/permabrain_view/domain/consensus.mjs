import * as $dict from "../../gleam_stdlib/gleam/dict.mjs";
import * as $float from "../../gleam_stdlib/gleam/float.mjs";
import * as $list from "../../gleam_stdlib/gleam/list.mjs";
import * as $option from "../../gleam_stdlib/gleam/option.mjs";
import { Some, None } from "../../gleam_stdlib/gleam/option.mjs";
import * as $string from "../../gleam_stdlib/gleam/string.mjs";
import * as $attestation from "../domain/attestation.mjs";
import { Valid, opinion_weight } from "../domain/attestation.mjs";
import { Ok, toList, Empty as $Empty, CustomType as $CustomType, divideFloat } from "../gleam.mjs";

export class Unattested extends $CustomType {}
export const ConsensusStatus$Unattested = () => new Unattested();
export const ConsensusStatus$isUnattested = (value) =>
  value instanceof Unattested;

export class Attested extends $CustomType {}
export const ConsensusStatus$Attested = () => new Attested();
export const ConsensusStatus$isAttested = (value) => value instanceof Attested;

export class TopReason extends $CustomType {
  constructor(opinion, confidence, reason, agent_id) {
    super();
    this.opinion = opinion;
    this.confidence = confidence;
    this.reason = reason;
    this.agent_id = agent_id;
  }
}
export const TopReason$TopReason = (opinion, confidence, reason, agent_id) =>
  new TopReason(opinion, confidence, reason, agent_id);
export const TopReason$isTopReason = (value) => value instanceof TopReason;
export const TopReason$TopReason$opinion = (value) => value.opinion;
export const TopReason$TopReason$0 = (value) => value.opinion;
export const TopReason$TopReason$confidence = (value) => value.confidence;
export const TopReason$TopReason$1 = (value) => value.confidence;
export const TopReason$TopReason$reason = (value) => value.reason;
export const TopReason$TopReason$2 = (value) => value.reason;
export const TopReason$TopReason$agent_id = (value) => value.agent_id;
export const TopReason$TopReason$3 = (value) => value.agent_id;

export class Consensus extends $CustomType {
  constructor(key, status, score, total_attestations, opinion_counts, top_reasons) {
    super();
    this.key = key;
    this.status = status;
    this.score = score;
    this.total_attestations = total_attestations;
    this.opinion_counts = opinion_counts;
    this.top_reasons = top_reasons;
  }
}
export const Consensus$Consensus = (key, status, score, total_attestations, opinion_counts, top_reasons) =>
  new Consensus(key,
  status,
  score,
  total_attestations,
  opinion_counts,
  top_reasons);
export const Consensus$isConsensus = (value) => value instanceof Consensus;
export const Consensus$Consensus$key = (value) => value.key;
export const Consensus$Consensus$0 = (value) => value.key;
export const Consensus$Consensus$status = (value) => value.status;
export const Consensus$Consensus$1 = (value) => value.status;
export const Consensus$Consensus$score = (value) => value.score;
export const Consensus$Consensus$2 = (value) => value.score;
export const Consensus$Consensus$total_attestations = (value) =>
  value.total_attestations;
export const Consensus$Consensus$3 = (value) => value.total_attestations;
export const Consensus$Consensus$opinion_counts = (value) =>
  value.opinion_counts;
export const Consensus$Consensus$4 = (value) => value.opinion_counts;
export const Consensus$Consensus$top_reasons = (value) => value.top_reasons;
export const Consensus$Consensus$5 = (value) => value.top_reasons;

/**
 * Count opinions across attestations
 * 
 * @ignore
 */
function opinion_counts(attestations) {
  return $list.fold(
    attestations,
    $dict.new$(),
    (acc, att) => {
      let _block;
      let $ = $dict.get(acc, att.opinion);
      if ($ instanceof Ok) {
        let n = $[0];
        _block = n;
      } else {
        _block = 0;
      }
      let current = _block;
      return $dict.insert(acc, att.opinion, current + 1);
    },
  );
}

/**
 * Keep only the latest attestation per agent per target
 * 
 * @ignore
 */
function latest_per_agent(attestations) {
  let _pipe = $list.fold(
    attestations,
    $dict.new$(),
    (acc, att) => {
      let key = (att.agent_id + ":") + att.target_key;
      let $ = $dict.get(acc, key);
      if ($ instanceof Ok) {
        return $dict.insert(acc, key, att);
      } else {
        return $dict.insert(acc, key, att);
      }
    },
  );
  return $dict.values(_pipe);
}

/**
 * Compute consensus score for a list of attestations
 */
export function compute_consensus(attestations, key, latest_article_id, _) {
  if (attestations instanceof $Empty) {
    return new Consensus(
      key,
      new Unattested(),
      0.0,
      0,
      $dict.new$(),
      toList([]),
    );
  } else {
    let considered = latest_per_agent(attestations);
    let counts = opinion_counts(considered);
    let $ = $list.fold(
      considered,
      [0.0, 0.0],
      (acc, att) => {
        let ow = opinion_weight(att.opinion);
        let weight = 1.0;
        let contribution = (ow * att.confidence) * weight;
        return [acc[0] + contribution, acc[1] + weight];
      },
    );
    let weighted_sum = $[0];
    let total_weight = $[1];
    let _block;
    if (total_weight === 0.0) {
      _block = total_weight;
    } else {
      _block = divideFloat(weighted_sum, total_weight);
    }
    let score = _block;
    return new Consensus(
      key,
      new Attested(),
      score,
      $list.length(considered),
      counts,
      (() => {
        let _pipe = $list.take(considered, 5);
        return $list.map(
          _pipe,
          (a) => {
            return new TopReason(a.opinion, a.confidence, a.reason, a.agent_id);
          },
        );
      })(),
    );
  }
}

/**
 * Score color class for CSS
 */
export function score_color(score) {
  let $ = score >= 0.5;
  if ($) {
    return "score-good";
  } else {
    let $1 = score >= 0.0;
    if ($1) {
      return "score-neutral";
    } else {
      let $2 = score >= -0.5;
      if ($2) {
        return "score-poor";
      } else {
        return "score-bad";
      }
    }
  }
}

/**
 * Format score for display
 */
export function format_score(score) {
  let _pipe = $float.to_string(score);
  return $string.slice(_pipe, 0, 5);
}
