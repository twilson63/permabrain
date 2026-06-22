import * as $dict from "../../gleam_stdlib/gleam/dict.mjs";
import * as $list from "../../gleam_stdlib/gleam/list.mjs";
import * as $option from "../../gleam_stdlib/gleam/option.mjs";
import * as $string from "../../gleam_stdlib/gleam/string.mjs";
import {
  Ok,
  Error,
  toList,
  Empty as $Empty,
  prepend as listPrepend,
  CustomType as $CustomType,
} from "../gleam.mjs";

export class CanonicalKey extends $CustomType {
  constructor(kind, slug) {
    super();
    this.kind = kind;
    this.slug = slug;
  }
}
export const CanonicalKey$CanonicalKey = (kind, slug) =>
  new CanonicalKey(kind, slug);
export const CanonicalKey$isCanonicalKey = (value) =>
  value instanceof CanonicalKey;
export const CanonicalKey$CanonicalKey$kind = (value) => value.kind;
export const CanonicalKey$CanonicalKey$0 = (value) => value.kind;
export const CanonicalKey$CanonicalKey$slug = (value) => value.slug;
export const CanonicalKey$CanonicalKey$1 = (value) => value.slug;

/**
 * Parse a canonical key string
 */
export function parse(key) {
  let $ = $string.split(key, "/");
  if ($ instanceof $Empty) {
    return new Error(undefined);
  } else {
    let $1 = $.tail;
    if ($1 instanceof $Empty) {
      let kind = $.head;
      let rest = $1;
      return new Ok(new CanonicalKey(kind, $string.join(rest, "/")));
    } else {
      let $2 = $1.tail;
      if ($2 instanceof $Empty) {
        let kind = $.head;
        let slug = $1.head;
        let $3 = kind === "";
        let $4 = slug === "";
        if ($3) {
          return new Error(undefined);
        } else if ($4) {
          return new Error(undefined);
        } else {
          return new Ok(new CanonicalKey(kind, slug));
        }
      } else {
        let kind = $.head;
        let rest = $1;
        return new Ok(new CanonicalKey(kind, $string.join(rest, "/")));
      }
    }
  }
}

/**
 * Render a canonical key to string
 */
export function to_string(key) {
  return (key.kind + "/") + key.slug;
}

/**
 * Get the kind prefix from a key string
 */
export function kind_of(key) {
  let $ = $string.split(key, "/");
  if ($ instanceof $Empty) {
    return "";
  } else {
    let kind = $.head;
    return kind;
  }
}

/**
 * Get the slug part from a key string
 */
export function slug_of(key) {
  let $ = $string.split(key, "/");
  if ($ instanceof $Empty) {
    return key;
  } else {
    let rest = $.tail;
    return $string.join(rest, "/");
  }
}

/**
 * Group keys by kind
 */
export function group_by_kind(keys) {
  return $list.fold(
    keys,
    $dict.new$(),
    (acc, key) => {
      let kind = kind_of(key);
      let _block;
      let $ = $dict.get(acc, kind);
      if ($ instanceof Ok) {
        let lst = $[0];
        _block = lst;
      } else {
        _block = toList([]);
      }
      let existing = _block;
      return $dict.insert(acc, kind, listPrepend(key, existing));
    },
  );
}
