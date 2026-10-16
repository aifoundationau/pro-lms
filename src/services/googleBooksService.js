/**
 * Google Books API & Academic Library Service
 * 
 * Provides integration with the Google Books Volumes API and Google Scholar
 * for searching full texts, academic books, research publications, and peer-reviewed articles.
 * 
 * Strict Constraint: Only texts published from 2000 onwards are allowed and returned.
 */

export const DEFAULT_BOOKS_API_KEY = 'AIzaSyDZephkHfDi1eRmIMAgxAQtaitMEteqEOM';
export const MIN_PUBLICATION_YEAR = 2000;

export function getBooksApiKey() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_BOOKS_API_KEY) {
    return import.meta.env.VITE_GOOGLE_BOOKS_API_KEY;
  }
  return DEFAULT_BOOKS_API_KEY;
}

/**
 * Extracts a 4-digit publication year from a date string (e.g. "2018-05-15", "2004", "2021-02").
 * @param {string|number} dateStr 
 * @returns {number|null}
 */
export function parsePublicationYear(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  const match = str.match(/\b(19\d\d|20\d\d)\b/);
  if (match) return parseInt(match[1], 10);
  const leadingYear = parseInt(str.slice(0, 4), 10);
  if (!isNaN(leadingYear) && leadingYear >= 1000 && leadingYear <= 2100) {
    return leadingYear;
  }
  return null;
}

/**
 * Validates whether the given publication date is from year 2000 onwards.
 * @param {string|number} dateStr 
 * @param {number} minYear 
 * @returns {boolean}
 */
export function isEligiblePublicationYear(dateStr, minYear = MIN_PUBLICATION_YEAR) {
  const yr = parsePublicationYear(dateStr);
  return yr !== null && yr >= minYear;
}

export const FULL_VIEW_TBS_PARAM = 'tbs=,bkv:f';

/**
 * Appends &tbs=,bkv:f to a Google Books or Scholar URL to ensure full view mode.
 * @param {string} urlStr 
 * @returns {string}
 */
export function appendFullViewParam(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  if (urlStr.includes('bkv:f')) return urlStr;
  if (urlStr.includes('tbs=')) {
    return urlStr.replace(/(tbs=[^&]*)/, '$1,bkv:f');
  }
  const sep = urlStr.includes('?') ? '&' : '?';
  return `${urlStr}${sep}tbs=,bkv:f`;
}

/**
 * Builds a direct Google Web search URL (enforcing full view &tbs=,bkv:f when fullOnly is true).
 * @param {string} query 
 * @param {object} [options]
 * @returns {string}
 */
export function buildGoogleFullViewSearchUrl(query, options = {}) {
  const q = (query || '').trim();
  const fullOnly = options.fullOnly !== false;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const tbsSuffix = fullOnly ? '&tbs=,bkv:f' : '';
  return `https://www.google.com/search?${params.toString()}${tbsSuffix}`;
}

/**
 * Builds a direct Google Scholar search URL pre-calibrated for publications from year 2000 onwards,
 * optionally appending &tbs=,bkv:f when fullOnly is true.
 * @param {string} query 
 * @param {object} [options]
 * @returns {string}
 */
export function buildScholarUrl(query, options = {}) {
  const q = (query || '').trim();
  const minYear = options.minYear || MIN_PUBLICATION_YEAR;
  const fullOnly = options.fullOnly !== false;
  const params = new URLSearchParams();
  params.set('as_ylo', String(minYear));
  if (q) params.set('q', q);
  const tbsSuffix = fullOnly ? '&tbs=,bkv:f' : '';
  return `https://scholar.google.com/scholar?${params.toString()}${tbsSuffix}`;
}

/**
 * Builds a Google Books web search URL (calibrated for full view &tbs=,bkv:f when fullOnly is true).
 * @param {string} query 
 * @param {object} [options]
 * @returns {string}
 */
export function buildBooksWebSearchUrl(query, options = {}) {
  const q = (query || '').trim();
  const fullOnly = options.fullOnly !== false;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (fullOnly) {
    params.set('as_brr', '1'); // 1 = full view books only in Google Books
    return `https://books.google.com/books?${params.toString()}&tbs=,bkv:f`;
  }
  return `https://books.google.com/books?${params.toString()}`;
}

/**
 * Formats an academic citation in APA 7th edition (pure plain text).
 * @param {object} item 
 * @returns {string}
 */
export function formatApaCitation(item) {
  if (!item) return '';
  const authors = Array.isArray(item.authors) && item.authors.length ? item.authors : ['Unknown Author'];
  const authorText = authors.length === 1 
    ? authors[0] 
    : authors.length === 2 
      ? `${authors[0]} & ${authors[1]}` 
      : `${authors[0]} et al.`;
  
  const yearText = item.publishedYear ? `(${item.publishedYear}).` : '(n.d.).';
  const cleanTitle = (item.title || 'Untitled').trim().replace(/\.+$/, '');
  const titleText = `${cleanTitle}.`;
  const publisherText = item.publisher ? `${item.publisher}.` : '';
  const urlText = item.previewLink || item.infoLink || '';

  return [authorText, yearText, titleText, publisherText, urlText].filter(Boolean).join(' ');
}

/**
 * Searches the Google Books API for volumes, enforcing publication year >= 2000
 * and full books/articles only using filter=full and &tbs=,bkv:f.
 * 
 * @param {string} query 
 * @param {object} [options]
 * @returns {Promise<{ items: Array, totalItems: number, query: string }>}
 */
export async function searchGoogleBooks(query, options = {}) {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    return { items: [], totalItems: 0, query: '' };
  }

  const apiKey = options.apiKey || getBooksApiKey();
  const maxResults = Math.min(Math.max(options.maxResults || 40, 10), 40);
  const startIndex = Math.max(options.startIndex || 0, 0);
  const orderBy = options.orderBy === 'newest' ? 'newest' : 'relevance';
  const printType = options.printType || 'all';
  const minYear = options.minYear || MIN_PUBLICATION_YEAR;
  const isFullOnly = Boolean(options.fullOnly);

  // Build request URL
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q', cleanQuery);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('startIndex', String(startIndex));
  url.searchParams.set('orderBy', orderBy);
  url.searchParams.set('printType', printType);

  // Only apply 'filter=full' when fullOnly is requested
  if (isFullOnly) {
    url.searchParams.set('filter', options.filter || 'full');
  } else if (options.filter) {
    url.searchParams.set('filter', options.filter);
  }

  // When fullOnly is enabled, append &tbs=,bkv:f
  const requestUrl = isFullOnly ? `${url.toString()}&tbs=,bkv:f` : url.toString();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

  try {
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const errMsg = errBody?.error?.message || `Google Books API responded with status ${response.status}`;
      throw new Error(errMsg);
    }

    const data = await response.json();
    const rawItems = Array.isArray(data.items) ? data.items : [];

    // Filter strictly for publications from year 2000 onwards (and optionally full books only)
    const filteredItems = rawItems
      .filter(item => {
        const pubDate = item?.volumeInfo?.publishedDate;
        if (!isEligiblePublicationYear(pubDate, minYear)) return false;
        if (isFullOnly) {
          const viewability = item?.accessInfo?.viewability;
          const isFull = viewability === 'ALL_PAGES' || viewability === 'FULL_PUBLIC_DOMAIN';
          return isFull;
        }
        return true;
      })
      .map(item => {
        const vi = item.volumeInfo || {};
        const ai = item.accessInfo || {};
        const pubYear = parsePublicationYear(vi.publishedDate);

        // Secure HTTPS thumbnails
        const rawThumb = vi.imageLinks?.thumbnail || vi.imageLinks?.smallThumbnail || '';
        const secureThumb = rawThumb ? rawThumb.replace(/^http:\/\//i, 'https://') : '';

        const authors = Array.isArray(vi.authors) && vi.authors.length 
          ? vi.authors 
          : (vi.authors ? [String(vi.authors)] : ['Unknown Author']);

        const isFullText = ai.viewability === 'ALL_PAGES' || ai.viewability === 'FULL_PUBLIC_DOMAIN';
        const hasPreview = ai.viewability === 'PARTIAL' || isFullText;

        const rawPreviewLink = vi.previewLink || vi.infoLink || '';
        const previewLink = isFullOnly ? appendFullViewParam(rawPreviewLink) : rawPreviewLink;
        const infoLink = isFullOnly ? appendFullViewParam(vi.infoLink || '') : (vi.infoLink || '');
        const webReaderLink = isFullOnly ? appendFullViewParam(ai.webReaderLink || '') : (ai.webReaderLink || '');

        return {
          id: item.id || `book-${Math.random().toString(36).slice(2, 9)}`,
          title: vi.title || 'Untitled Publication',
          subtitle: vi.subtitle || '',
          authors,
          publisher: vi.publisher || 'Independent / Academic',
          publishedDate: vi.publishedDate || '',
          publishedYear: pubYear,
          description: vi.description || '',
          pageCount: vi.pageCount || null,
          categories: Array.isArray(vi.categories) && vi.categories.length ? vi.categories : ['Academic'],
          thumbnail: secureThumb,
          previewLink,
          infoLink,
          canonicalVolumeLink: vi.canonicalVolumeLink || '',
          webReaderLink,
          googleBooksUrl: buildBooksWebSearchUrl(vi.title || cleanQuery, { fullOnly: isFullOnly }),
          viewability: ai.viewability || 'PARTIAL',
          isFullText,
          hasPreview,
          pdfAvailable: Boolean(ai.pdf?.isAvailable),
          epubAvailable: Boolean(ai.epub?.isAvailable),
          pdfDownloadLink: ai.pdf?.downloadLink || '',
          epubDownloadLink: ai.epub?.downloadLink || '',
          scholarSearchUrl: buildScholarUrl(`${vi.title || ''} ${authors[0] || ''}`.trim(), { minYear, fullOnly: isFullOnly }),
          isbn: Array.isArray(vi.industryIdentifiers) ? vi.industryIdentifiers.map(i => i.identifier).join(', ') : ''
        };
      });

    return {
      items: filteredItems,
      totalItems: data.totalItems || filteredItems.length,
      query: cleanQuery
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
