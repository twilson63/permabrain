import * as $option from "../../gleam_stdlib/gleam/option.mjs";
import { Ok, Error, CustomType as $CustomType } from "../gleam.mjs";

export class Person extends $CustomType {}
export const Kind$Person = () => new Person();
export const Kind$isPerson = (value) => value instanceof Person;

export class Subject extends $CustomType {}
export const Kind$Subject = () => new Subject();
export const Kind$isSubject = (value) => value instanceof Subject;

export class Event extends $CustomType {}
export const Kind$Event = () => new Event();
export const Kind$isEvent = (value) => value instanceof Event;

export class Organization extends $CustomType {}
export const Kind$Organization = () => new Organization();
export const Kind$isOrganization = (value) => value instanceof Organization;

export class Source extends $CustomType {}
export const Kind$Source = () => new Source();
export const Kind$isSource = (value) => value instanceof Source;

export class News extends $CustomType {}
export const Kind$News = () => new News();
export const Kind$isNews = (value) => value instanceof News;

export class Article extends $CustomType {
  constructor(id, key, kind, title, slug, topic, language, version, previous_id, root_id, source_name, source_url, content_hash, updated_at, author_agent_id) {
    super();
    this.id = id;
    this.key = key;
    this.kind = kind;
    this.title = title;
    this.slug = slug;
    this.topic = topic;
    this.language = language;
    this.version = version;
    this.previous_id = previous_id;
    this.root_id = root_id;
    this.source_name = source_name;
    this.source_url = source_url;
    this.content_hash = content_hash;
    this.updated_at = updated_at;
    this.author_agent_id = author_agent_id;
  }
}
export const Article$Article = (id, key, kind, title, slug, topic, language, version, previous_id, root_id, source_name, source_url, content_hash, updated_at, author_agent_id) =>
  new Article(id,
  key,
  kind,
  title,
  slug,
  topic,
  language,
  version,
  previous_id,
  root_id,
  source_name,
  source_url,
  content_hash,
  updated_at,
  author_agent_id);
export const Article$isArticle = (value) => value instanceof Article;
export const Article$Article$id = (value) => value.id;
export const Article$Article$0 = (value) => value.id;
export const Article$Article$key = (value) => value.key;
export const Article$Article$1 = (value) => value.key;
export const Article$Article$kind = (value) => value.kind;
export const Article$Article$2 = (value) => value.kind;
export const Article$Article$title = (value) => value.title;
export const Article$Article$3 = (value) => value.title;
export const Article$Article$slug = (value) => value.slug;
export const Article$Article$4 = (value) => value.slug;
export const Article$Article$topic = (value) => value.topic;
export const Article$Article$5 = (value) => value.topic;
export const Article$Article$language = (value) => value.language;
export const Article$Article$6 = (value) => value.language;
export const Article$Article$version = (value) => value.version;
export const Article$Article$7 = (value) => value.version;
export const Article$Article$previous_id = (value) => value.previous_id;
export const Article$Article$8 = (value) => value.previous_id;
export const Article$Article$root_id = (value) => value.root_id;
export const Article$Article$9 = (value) => value.root_id;
export const Article$Article$source_name = (value) => value.source_name;
export const Article$Article$10 = (value) => value.source_name;
export const Article$Article$source_url = (value) => value.source_url;
export const Article$Article$11 = (value) => value.source_url;
export const Article$Article$content_hash = (value) => value.content_hash;
export const Article$Article$12 = (value) => value.content_hash;
export const Article$Article$updated_at = (value) => value.updated_at;
export const Article$Article$13 = (value) => value.updated_at;
export const Article$Article$author_agent_id = (value) => value.author_agent_id;
export const Article$Article$14 = (value) => value.author_agent_id;

/**
 * Parse a kind string from Arweave tags
 */
export function kind_from_string(s) {
  if (s === "person") {
    return new Ok(new Person());
  } else if (s === "subject") {
    return new Ok(new Subject());
  } else if (s === "event") {
    return new Ok(new Event());
  } else if (s === "organization") {
    return new Ok(new Organization());
  } else if (s === "source") {
    return new Ok(new Source());
  } else if (s === "news") {
    return new Ok(new News());
  } else {
    return new Error(undefined);
  }
}

/**
 * Render a kind to its string tag value
 */
export function kind_to_string(kind) {
  if (kind instanceof Person) {
    return "person";
  } else if (kind instanceof Subject) {
    return "subject";
  } else if (kind instanceof Event) {
    return "event";
  } else if (kind instanceof Organization) {
    return "organization";
  } else if (kind instanceof Source) {
    return "source";
  } else {
    return "news";
  }
}

/**
 * Get the icon emoji for an article kind
 */
export function kind_icon(kind) {
  if (kind instanceof Person) {
    return "👤";
  } else if (kind instanceof Subject) {
    return "📚";
  } else if (kind instanceof Event) {
    return "📅";
  } else if (kind instanceof Organization) {
    return "🏢";
  } else if (kind instanceof Source) {
    return "🔗";
  } else {
    return "📰";
  }
}

/**
 * Get the display label for an article kind
 */
export function kind_label(kind) {
  if (kind instanceof Person) {
    return "Person";
  } else if (kind instanceof Subject) {
    return "Subject";
  } else if (kind instanceof Event) {
    return "Event";
  } else if (kind instanceof Organization) {
    return "Organization";
  } else if (kind instanceof Source) {
    return "Source";
  } else {
    return "News";
  }
}
