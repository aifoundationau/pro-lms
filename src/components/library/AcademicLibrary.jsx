import React, { useState, useEffect, useRef } from 'react';
import {
  searchGoogleBooks,
  buildScholarUrl,
  buildBooksWebSearchUrl,
  buildGoogleFullViewSearchUrl,
  formatApaCitation,
  MIN_PUBLICATION_YEAR
} from '../../services/googleBooksService';

const SUGGESTED_TOPICS = [
  'Artificial Intelligence in Education',
  'Higher Education Pedagogy',
  'Cybersecurity & Network Defense',
  'Climate Science & Sustainability',
  'Data Science & Machine Learning',
  'Quantum Computing Principles',
  'Australian Qualifications Framework'
];

export default function AcademicLibrary({ onBack, currentUser, userProfile }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [fullBooksOnly, setFullBooksOnly] = useState(false); // Tick button: full books only (default false to show more books)
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'fullText' | 'preview' | 'ebook' | 'pdf'
  const [sortBy, setSortBy] = useState('relevance'); // 'relevance' | 'newest'
  const [results, setResults] = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errorNotice, setErrorNotice] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastExecutedQuery, setLastExecutedQuery] = useState('');
  const [copiedCitationId, setCopiedCitationId] = useState(null);

  const searchInputRef = useRef(null);

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleSearch = async (queryToRun, overrideFullBooksOnly) => {
    const q = (queryToRun !== undefined ? queryToRun : searchQuery).trim();
    if (!q) return;

    const isFullOnly = overrideFullBooksOnly !== undefined ? overrideFullBooksOnly : fullBooksOnly;

    setIsLoading(true);
    setErrorNotice(null);
    setHasSearched(true);
    setLastExecutedQuery(q);

    try {
      const data = await searchGoogleBooks(q, {
        orderBy: sortBy,
        minYear: MIN_PUBLICATION_YEAR,
        fullOnly: isFullOnly,
        maxResults: 40
      });
      setResults(data.items || []);
      setTotalItems(data.totalItems || (data.items || []).length);
    } catch (err) {
      console.warn('Academic Library search failed:', err);
      setErrorNotice(err?.message || 'Failed to search publications. Please check your internet connection.');
      setResults([]);
      setTotalItems(0);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleFullBooksOnly = (e) => {
    const checked = e.target.checked;
    setFullBooksOnly(checked);
    if (lastExecutedQuery) {
      handleSearch(lastExecutedQuery, checked);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    handleSearch();
  };

  const handleTopicClick = (topic) => {
    setSearchQuery(topic);
    handleSearch(topic);
  };

  const handleCopyCitation = (item) => {
    const citation = formatApaCitation(item);
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(citation).then(() => {
        setCopiedCitationId(item.id);
        setTimeout(() => setCopiedCitationId(null), 2500);
      }).catch(() => {
        setCopiedCitationId(item.id);
        setTimeout(() => setCopiedCitationId(null), 2500);
      });
    } else {
      setCopiedCitationId(item.id);
      setTimeout(() => setCopiedCitationId(null), 2500);
    }
  };

  // Filtered results
  const displayedResults = results.filter(item => {
    if (activeFilter === 'fullText') return item.isFullText;
    if (activeFilter === 'preview') return item.hasPreview;
    if (activeFilter === 'ebook') return item.epubAvailable || item.pdfAvailable || item.webReaderLink;
    if (activeFilter === 'pdf') return item.pdfAvailable;
    return true;
  });

  return (
    <div className="academic-library-page animate-fade-in-up" style={{ maxWidth: '1360px', margin: '0 auto', padding: '16px 20px', width: '100%' }}>
      {/* Top Navigation & Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {onBack && (
            <button
              type="button"
              className="nav-btn secondary"
              onClick={onBack}
              title="Return to previous page"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px' }}
            >
              ← Back
            </button>
          )}
          <div>
            <h1 style={{ margin: 0, fontSize: '1.75rem', color: '#fef08a', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span>📚 Academic Library</span>
              <span style={{ fontSize: '0.8rem', background: 'rgba(52, 211, 153, 0.2)', color: '#6ee7b7', border: '1px solid rgba(52, 211, 153, 0.4)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                2000–Present Only
              </span>
              <span style={{ fontSize: '0.8rem', background: fullBooksOnly ? 'rgba(56, 189, 248, 0.25)' : 'rgba(167, 139, 250, 0.2)', color: fullBooksOnly ? '#7dd3fc' : '#c4b5fd', border: fullBooksOnly ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid rgba(167, 139, 250, 0.4)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                {fullBooksOnly ? '📖 Full Books & Articles Only' : '📚 Books & Academic Articles'}
              </span>
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Search books, full texts, and academic articles published from 2000 onwards. Use the "Full books only" option to filter exclusively for complete full-view publications.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Powered by</span>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '3px 8px', borderRadius: '6px', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
            Google Books API
          </span>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#a78bfa', background: 'rgba(167, 139, 250, 0.1)', padding: '3px 8px', borderRadius: '6px', border: '1px solid rgba(167, 139, 250, 0.25)' }}>
            Google Scholar
          </span>
        </div>
      </div>

      {/* Main Single Search Box Card */}
      <div className="glass card" style={{ padding: '24px', marginBottom: '24px', border: '1px solid rgba(52, 211, 153, 0.35)', background: 'rgba(15, 23, 42, 0.65)' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 320px' }}>
              <input
                ref={searchInputRef}
                id="library-search-input"
                type="text"
                className="form-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="🔍 Search full texts, books, authors, or topics (e.g. quantum physics, macroeconomics)..."
                style={{
                  width: '100%',
                  fontSize: '1.05rem',
                  padding: '14px 44px 14px 16px',
                  borderRadius: '10px',
                  background: 'rgba(15, 41, 30, 0.85)',
                  border: '1px solid rgba(52, 211, 153, 0.5)',
                  color: '#ffffff'
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontSize: '1.2rem',
                    cursor: 'pointer'
                  }}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            <button
              type="submit"
              className="nav-btn primary"
              disabled={isLoading || !searchQuery.trim()}
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                padding: '14px 28px',
                minWidth: '140px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                borderRadius: '10px'
              }}
            >
              {isLoading ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" style={{ width: '16px', height: '16px', border: '2px solid #fff', borderRightColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.75s linear infinite' }}></span>
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <span>🔍 Search</span>
                </>
              )}
            </button>
          </div>

          {/* Tick Button & Sort Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', paddingTop: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              {/* Tick button to select full books only */}
              <label
                htmlFor="library-full-books-checkbox"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  background: fullBooksOnly ? 'rgba(52, 211, 153, 0.22)' : 'rgba(255, 255, 255, 0.06)',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: fullBooksOnly ? '1px solid rgba(52, 211, 153, 0.6)' : '1px solid rgba(255, 255, 255, 0.16)',
                  transition: 'all 0.15s ease'
                }}
              >
                <input
                  id="library-full-books-checkbox"
                  type="checkbox"
                  checked={fullBooksOnly}
                  onChange={handleToggleFullBooksOnly}
                  style={{ width: '16px', height: '16px', accentColor: '#10b981', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '0.86rem', fontWeight: 600, color: fullBooksOnly ? '#86efac' : '#e2e8f0' }}>
                  📖 Full books only
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label htmlFor="library-sort-select" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Sort by:</label>
              <select
                id="library-sort-select"
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  if (lastExecutedQuery) {
                    setTimeout(() => handleSearch(lastExecutedQuery), 50);
                  }
                }}
                className="form-input"
                style={{ padding: '4px 10px', fontSize: '0.85rem', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.9)' }}
              >
                <option value="relevance">Relevance</option>
                <option value="newest">Newest First</option>
              </select>
            </div>
          </div>
        </form>

        {/* Suggested Topics / Quick Chips */}
        <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Explore Topics:</span>
          {SUGGESTED_TOPICS.map((topic, idx) => (
            <button
              key={idx}
              type="button"
              className="chip-btn"
              onClick={() => handleTopicClick(topic)}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#e2e8f0',
                padding: '4px 10px',
                borderRadius: '16px',
                fontSize: '0.78rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {topic}
            </button>
          ))}
        </div>
      </div>

      {/* Google Scholar Quick Hub Card (Displayed when search executed or active query) */}
      {(lastExecutedQuery || searchQuery) && (
        <div
          className="glass card"
          style={{
            padding: '16px 20px',
            marginBottom: '24px',
            border: '1px solid rgba(167, 139, 250, 0.4)',
            background: 'linear-gradient(135deg, rgba(30, 27, 75, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '14px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '1.8rem', background: 'rgba(167, 139, 250, 0.2)', width: '48px', height: '48px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              🎓
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#c4b5fd' }}>
                  Search Academic Articles on Google Scholar
                </h3>
                <span style={{ fontSize: '0.72rem', background: 'rgba(167, 139, 250, 0.25)', color: '#ddd6fe', padding: '1px 6px', borderRadius: '8px' }}>
                  2000–Present
                </span>
              </div>
              <p style={{ margin: '2px 0 0', color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
                Access peer-reviewed research papers, journal articles, conference papers, and citations for "<strong>{lastExecutedQuery || searchQuery}</strong>".
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <a
              href={buildBooksWebSearchUrl(lastExecutedQuery || searchQuery, { fullOnly: fullBooksOnly })}
              target="_blank"
              rel="noopener noreferrer"
              className="nav-btn secondary"
              style={{
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '9px 15px',
                fontSize: '0.88rem'
              }}
              title={fullBooksOnly ? "Search complete full books on Google Books" : "Search books on Google Books"}
            >
              <span>{fullBooksOnly ? '📖 Full Books' : '📖 Books'}</span>
              <span>↗</span>
            </a>

            <a
              href={buildScholarUrl(lastExecutedQuery || searchQuery, { minYear: 2000, fullOnly: fullBooksOnly })}
              target="_blank"
              rel="noopener noreferrer"
              className="nav-btn primary"
              style={{
                background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                borderColor: '#8b5cf6',
                color: '#ffffff',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 18px',
                fontSize: '0.9rem',
                fontWeight: 600,
                borderRadius: '8px'
              }}
              title={fullBooksOnly ? "Search peer-reviewed full articles on Google Scholar" : "Search peer-reviewed articles on Google Scholar"}
            >
              <span>{fullBooksOnly ? '🎓 Full Articles on Scholar' : '🎓 Articles on Scholar'}</span>
              <span>↗</span>
            </a>

            <a
              href={buildGoogleFullViewSearchUrl(lastExecutedQuery || searchQuery, { fullOnly: fullBooksOnly })}
              target="_blank"
              rel="noopener noreferrer"
              className="nav-btn secondary"
              style={{
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '9px 14px',
                fontSize: '0.85rem'
              }}
              title={fullBooksOnly ? "Search full books and articles via Google Search" : "Search academic publications via Google"}
            >
              <span>{fullBooksOnly ? '🌐 Full Web' : '🌐 Web'}</span>
              <span>↗</span>
            </a>

            <a
              href={buildScholarUrl(lastExecutedQuery || searchQuery, { minYear: 2020, fullOnly: fullBooksOnly })}
              target="_blank"
              rel="noopener noreferrer"
              className="nav-btn secondary"
              style={{
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '9px 14px',
                fontSize: '0.85rem'
              }}
              title="Recent articles from 2020 onwards"
            >
              <span>Since 2020</span>
              <span>↗</span>
            </a>
          </div>
        </div>
      )}

      {/* Error / Offline Notice with Fallback to Scholar */}
      {errorNotice && (
        <div
          className="glass card animate-fade-in"
          style={{
            padding: '16px 20px',
            marginBottom: '24px',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            background: 'rgba(69, 10, 10, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px'
          }}
        >
          <div style={{ color: '#fca5a5', fontSize: '0.92rem' }}>
            <span>⚠️ {errorNotice}</span>
          </div>
          {(lastExecutedQuery || searchQuery) && (
            <a
              href={buildScholarUrl(lastExecutedQuery || searchQuery, { minYear: 2000 })}
              target="_blank"
              rel="noopener noreferrer"
              className="nav-btn secondary"
              style={{ textDecoration: 'none', padding: '6px 14px', fontSize: '0.85rem', color: '#fef08a' }}
            >
              🎓 Search Google Scholar Instead ↗
            </a>
          )}
        </div>
      )}

      {/* Filter Tabs & Count Header */}
      {hasSearched && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`nav-btn ${activeFilter === 'all' ? 'primary' : 'secondary'}`}
              onClick={() => setActiveFilter('all')}
              style={{ padding: '6px 14px', fontSize: '0.85rem' }}
            >
              All Texts ({results.length})
            </button>
            <button
              type="button"
              className={`nav-btn ${activeFilter === 'fullText' ? 'primary' : 'secondary'}`}
              onClick={() => setActiveFilter('fullText')}
              style={{ padding: '6px 14px', fontSize: '0.85rem' }}
            >
              📖 Full Text / Preview
            </button>
            <button
              type="button"
              className={`nav-btn ${activeFilter === 'ebook' ? 'primary' : 'secondary'}`}
              onClick={() => setActiveFilter('ebook')}
              style={{ padding: '6px 14px', fontSize: '0.85rem' }}
            >
              ⚡ eBooks
            </button>
            <button
              type="button"
              className={`nav-btn ${activeFilter === 'pdf' ? 'primary' : 'secondary'}`}
              onClick={() => setActiveFilter('pdf')}
              style={{ padding: '6px 14px', fontSize: '0.85rem' }}
            >
              📄 PDF Available
            </button>
          </div>

          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Showing <strong>{displayedResults.length}</strong> publications published <strong>2000–present</strong>
          </div>
        </div>
      )}

      {/* Results List */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '2.4rem', marginBottom: '12px' }}>📚</div>
          <div style={{ fontSize: '1.1rem', color: '#fef08a', fontWeight: 600 }}>Searching Google Books & Academic Index...</div>
          <p style={{ fontSize: '0.9rem', maxWidth: '420px', margin: '8px auto 0' }}>
            Filtering publications strictly from year 2000 onwards and verifying full text previews.
          </p>
        </div>
      ) : hasSearched && displayedResults.length === 0 ? (
        <div className="glass card" style={{ padding: '40px 24px', textAlign: 'center', margin: '20px 0' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔍</div>
          <h3 style={{ margin: '0 0 8px', color: '#fef08a' }}>
            {fullBooksOnly 
              ? 'No full-view publications found from 2000 onwards' 
              : 'No publications found from 2000 onwards'}
          </h3>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '560px', margin: '0 auto 20px', fontSize: '0.92rem' }}>
            {fullBooksOnly 
              ? 'Only complete full-view books are shown. Uncheck "Full books only" to see all available editions and academic previews, or search Google Scholar.'
              : 'Try searching with broader academic keywords or explore Google Scholar.'}
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {fullBooksOnly && (
              <button
                type="button"
                className="nav-btn secondary"
                onClick={() => {
                  setFullBooksOnly(false);
                  if (lastExecutedQuery) {
                    handleSearch(lastExecutedQuery, false);
                  }
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderColor: 'rgba(52, 211, 153, 0.6)', color: '#86efac' }}
              >
                <span>🔓 Show all books (uncheck full books only)</span>
              </button>
            )}
            <a
              href={buildBooksWebSearchUrl(lastExecutedQuery, { fullOnly: fullBooksOnly })}
              target="_blank"
              rel="noopener noreferrer"
              className="nav-btn secondary"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 18px' }}
              title="Search books on Google Books"
            >
              <span>{fullBooksOnly ? '📖 Search Full Books on Google Books ↗' : '📖 Search Books on Google Books ↗'}</span>
            </a>
            <a
              href={buildScholarUrl(lastExecutedQuery, { minYear: 2000, fullOnly: fullBooksOnly })}
              target="_blank"
              rel="noopener noreferrer"
              className="nav-btn primary"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}
              title="Search articles on Google Scholar"
            >
              <span>{fullBooksOnly ? '🎓 Search Full Articles on Scholar ↗' : '🎓 Search Articles on Scholar ↗'}</span>
            </a>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '20px' }}>
          {displayedResults.map((item) => (
            <div
              key={item.id}
              className="glass card volume-card animate-fade-in-up"
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '20px',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(15, 23, 42, 0.75)',
                transition: 'transform 0.2s ease, border-color 0.2s ease',
                position: 'relative'
              }}
            >
              <div style={{ display: 'flex', gap: '16px', marginBottom: '14px' }}>
                {/* Book Thumbnail */}
                <div style={{ width: '84px', minWidth: '84px', height: '120px', borderRadius: '6px', overflow: 'hidden', background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      loading="lazy"
                    />
                  ) : (
                    <div style={{ textAlign: 'center', padding: '8px', color: 'var(--text-secondary)' }}>
                      <div style={{ fontSize: '1.6rem' }}>📖</div>
                      <div style={{ fontSize: '0.65rem', marginTop: '4px' }}>No Cover</div>
                    </div>
                  )}
                </div>

                {/* Main Metadata */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '2px 7px', borderRadius: '6px', background: 'rgba(52, 211, 153, 0.2)', color: '#6ee7b7', border: '1px solid rgba(52, 211, 153, 0.35)' }}>
                      📅 {item.publishedYear}
                    </span>
                    {item.isFullText && (
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '2px 6px', borderRadius: '6px', background: 'rgba(34, 197, 94, 0.2)', color: '#86efac' }}>
                        ✓ Full Text
                      </span>
                    )}
                    {item.hasPreview && !item.isFullText && (
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '2px 6px', borderRadius: '6px', background: 'rgba(56, 189, 248, 0.2)', color: '#7dd3fc' }}>
                        👁️ Preview
                      </span>
                    )}
                  </div>

                  <h3
                    style={{
                      margin: '0 0 4px',
                      fontSize: '1rem',
                      lineHeight: '1.3',
                      color: '#ffffff',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}
                    title={item.title}
                  >
                    {item.title}
                  </h3>

                  {item.subtitle && (
                    <p style={{ margin: '0 0 6px', fontSize: '0.8rem', color: '#cbd5e1', fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.subtitle}
                    </p>
                  )}

                  <p style={{ margin: '0 0 4px', fontSize: '0.82rem', color: '#fef08a' }}>
                    ✍️ {item.authors.join(', ')}
                  </p>

                  <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                    🏛️ {item.publisher} {item.pageCount ? `• ${item.pageCount} pages` : ''}
                  </p>
                </div>
              </div>

              {/* Description snippet */}
              {item.description && (
                <p
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--text-secondary)',
                    lineHeight: '1.45',
                    margin: '0 0 16px',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}
                  title={item.description}
                >
                  {item.description}
                </p>
              )}

              {/* Action Buttons */}
              <div style={{ marginTop: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                {item.previewLink && (
                  <a
                    href={item.previewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="nav-btn primary"
                    style={{
                      textDecoration: 'none',
                      fontSize: '0.82rem',
                      padding: '7px 12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      flex: '1 1 auto',
                      justifyContent: 'center'
                    }}
                    title="Read complete full book on Google Books"
                  >
                    <span>📖 Read Full Book</span>
                    <span>↗</span>
                  </a>
                )}

                <a
                  href={item.scholarSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nav-btn secondary"
                  style={{
                    textDecoration: 'none',
                    fontSize: '0.82rem',
                    padding: '7px 12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    color: '#c4b5fd',
                    borderColor: 'rgba(167, 139, 250, 0.4)'
                  }}
                  title="Search citations & academic articles on Google Scholar"
                >
                  <span>🎓 Scholar</span>
                  <span>↗</span>
                </a>

                <button
                  type="button"
                  className="nav-btn secondary"
                  onClick={() => handleCopyCitation(item)}
                  style={{
                    fontSize: '0.82rem',
                    padding: '7px 10px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title="Copy APA 7th academic citation"
                >
                  {copiedCitationId === item.id ? (
                    <span style={{ color: '#86efac' }}>✓ Copied!</span>
                  ) : (
                    <span>📋 Cite</span>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
