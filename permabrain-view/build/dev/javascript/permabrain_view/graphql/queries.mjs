import * as $int from "../../gleam_stdlib/gleam/int.mjs";
import * as $list from "../../gleam_stdlib/gleam/list.mjs";
import * as $option from "../../gleam_stdlib/gleam/option.mjs";
import { Some, None } from "../../gleam_stdlib/gleam/option.mjs";
import * as $string from "../../gleam_stdlib/gleam/string.mjs";
import { toList } from "../gleam.mjs";

/**
 * Build a GraphQL query to fetch PermaBrain articles by tags
 */
export function articles_query(tags, after, first) {
  let _block;
  let _pipe = tags;
  let _pipe$1 = $list.map(
    _pipe,
    (tag) => {
      return ((("{ name: \"" + tag[0]) + "\", values: [\"") + tag[1]) + "\"] }";
    },
  );
  _block = $string.join(_pipe$1, ", ");
  let tag_filters = _block;
  let _block$1;
  if (after instanceof Some) {
    let cursor = after[0];
    _block$1 = (", after: \"" + cursor) + "\"";
  } else {
    _block$1 = "";
  }
  let after_clause = _block$1;
  return (((("query { transactions(first: " + $int.to_string(first)) + after_clause) + ", tags: [") + tag_filters) + "]) { edges { cursor node { id tags { name value } } } pageInfo { hasNextPage endCursor } } }";
}

/**
 * Build a query for all PermaBrain articles
 */
export function all_articles_query(after, first) {
  return articles_query(
    toList([["App-Name", "PermaBrain"], ["PermaBrain-Type", "article"]]),
    after,
    first,
  );
}

/**
 * Build a query for articles filtered by topic
 */
export function articles_by_topic_query(topic, after, first) {
  return articles_query(
    toList([
      ["App-Name", "PermaBrain"],
      ["PermaBrain-Type", "article"],
      ["Article-Topic", topic],
    ]),
    after,
    first,
  );
}

/**
 * Build a query for attestations targeting a key
 */
export function attestations_for_key_query(key, after, first) {
  return articles_query(
    toList([
      ["App-Name", "PermaBrain"],
      ["PermaBrain-Type", "attestation"],
      ["Attestation-Target-Key", key],
    ]),
    after,
    first,
  );
}

/**
 * Default Arweave gateway GraphQL endpoint
 */
export function default_gateway() {
  return "https://arweave.net/graphql";
}
