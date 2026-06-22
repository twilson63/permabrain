import * as $dict from "../../gleam_stdlib/gleam/dict.mjs";
import * as $option from "../../gleam_stdlib/gleam/option.mjs";
import { Some, None } from "../../gleam_stdlib/gleam/option.mjs";
import { CustomType as $CustomType } from "../gleam.mjs";

export class DecodeError extends $CustomType {
  constructor($0) {
    super();
    this[0] = $0;
  }
}
export const DecodeError$DecodeError = ($0) => new DecodeError($0);
export const DecodeError$isDecodeError = (value) =>
  value instanceof DecodeError;
export const DecodeError$DecodeError$0 = (value) => value[0];

export class TransactionNode extends $CustomType {
  constructor(id, tags) {
    super();
    this.id = id;
    this.tags = tags;
  }
}
export const TransactionNode$TransactionNode = (id, tags) =>
  new TransactionNode(id, tags);
export const TransactionNode$isTransactionNode = (value) =>
  value instanceof TransactionNode;
export const TransactionNode$TransactionNode$id = (value) => value.id;
export const TransactionNode$TransactionNode$0 = (value) => value.id;
export const TransactionNode$TransactionNode$tags = (value) => value.tags;
export const TransactionNode$TransactionNode$1 = (value) => value.tags;

export class TransactionPage extends $CustomType {
  constructor(nodes, has_next, end_cursor) {
    super();
    this.nodes = nodes;
    this.has_next = has_next;
    this.end_cursor = end_cursor;
  }
}
export const TransactionPage$TransactionPage = (nodes, has_next, end_cursor) =>
  new TransactionPage(nodes, has_next, end_cursor);
export const TransactionPage$isTransactionPage = (value) =>
  value instanceof TransactionPage;
export const TransactionPage$TransactionPage$nodes = (value) => value.nodes;
export const TransactionPage$TransactionPage$0 = (value) => value.nodes;
export const TransactionPage$TransactionPage$has_next = (value) =>
  value.has_next;
export const TransactionPage$TransactionPage$1 = (value) => value.has_next;
export const TransactionPage$TransactionPage$end_cursor = (value) =>
  value.end_cursor;
export const TransactionPage$TransactionPage$2 = (value) => value.end_cursor;
