import * as cheerio from 'cheerio';

// ─── Element ──────────────────────────────────────────────────────────────────
class WElement {
  constructor(el, $) {
    this._el = el;
    this._$ = $;
  }
  get text() { return this._$(this._el).text().trim(); }
  get innerHtml() { return this._$(this._el).html() ?? ''; }
  get innerHTML() { return this.innerHtml; }
  get outerHtml() { return cheerio.html(this._$(this._el)); }
  get outerHTML() { return this.outerHtml; }
  get getHref() { return this._$(this._el).attr('href') ?? ''; }
  get getSrc() { return this._$(this._el).attr('data-src') || this._$(this._el).attr('src') || ''; }
  attr(name) { return this._$(this._el).attr(name) ?? ''; }
  select(css) {
    return this._$(css, this._el).toArray().map(e => new WElement(e, this._$));
  }
  selectFirst(css) {
    const found = this._$(css, this._el).first();
    if (!found.length) return null;
    return new WElement(found[0], this._$);
  }
  get children() {
    return this._$(this._el).children().toArray().map(e => new WElement(e, this._$));
  }
  toString() { return this.outerHtml; }
}

// ─── Document ─────────────────────────────────────────────────────────────────
class WDocument {
  constructor(html) {
    this._$ = cheerio.load(html ?? '', { decodeEntities: false });
  }
  select(css) {
    return this._$(css).toArray().map(e => new WElement(e, this._$));
  }
  selectFirst(css) {
    const found = this._$(css).first();
    if (!found.length) return null;
    return new WElement(found[0], this._$);
  }
  get body() {
    return new WElement(this._$('body')[0], this._$);
  }
}

// ─── SharedPreferences ────────────────────────────────────────────────────────
class WSharedPreferences {
  constructor() { this._data = {}; }
  get(key) { return this._data[key] ?? null; }
  set(key, value) { this._data[key] = value; }
  getString(key, def) { return this._data[key] ?? def ?? ''; }
  getBool(key, def) { return this._data[key] ?? def ?? false; }
}

// ─── Shim code injected before every extension ───────────────────────────────
// $SOURCE_JSON will be replaced at runtime with the actual source object
export function buildShimCode(sourceJson) {
  return `
class MProvider {
  get source() { return ${sourceJson}; }
  get supportsLatest() { return true; }
  getHeaders(url) { return {}; }
  async getPopular(page) { throw new Error('getPopular not implemented'); }
  async getLatestUpdates(page) { throw new Error('getLatestUpdates not implemented'); }
  async search(query, page, filters) { throw new Error('search not implemented'); }
  async getDetail(url) { throw new Error('getDetail not implemented'); }
  async getPageList() { throw new Error('getPageList not implemented'); }
  async getVideoList(url) { throw new Error('getVideoList not implemented'); }
  async getHtmlContent(name, url) { throw new Error('getHtmlContent not implemented'); }
  async cleanHtmlContent(html) { throw new Error('cleanHtmlContent not implemented'); }
  getFilterList() { return []; }
  getSourcePreferences() { return []; }
  getCustomLists() { return []; }
  async getCustomList(id, page) { return { list: [], hasNextPage: false }; }
  getPreference(key) { return new SharedPreferences().get(key); }
}
`;
}

export { WDocument, WElement, WSharedPreferences };
