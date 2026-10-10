import React, { useState } from 'react';
import {
  AQF_LEVELS,
  CONTENT_BLOCK_TYPES,
  getAqfLevelMeta,
  generateEntityId,
  createBlankUnit,
  createBlankLesson,
  createBlankContentBlock,
  createBlankAssessment,
  createDefaultRubric
} from '../../types/courseBuilderTypes';
import {
  isUserCharityTeacher,
  executeContentClone,
  createFreeContentRequest,
  searchMarketplaceContent,
  publishCourseToMarketplace,
  listAuthorIncomingRequests,
  approveFreeContentRequest,
  rejectFreeContentRequest
} from '../../services/courseMarketplaceService';
import {
  ingestCourseSyllabusWithAI,
  AI_INGEST_COST_TOKENS
} from '../../services/aqfAiIngestService';
import { getUserTokenBalance } from '../../services/tokenService';
import CourseAddPeopleModal from '../course/CourseAddPeopleModal.jsx';

export default function AQFCourseBuilder({
  course,
  onSaveCourse,
  onBack,
  currentUser,
  userProfile,
  userTokenBalance = 0,
  onRefreshBalance
}) {
  // Course State
  const [currentCourse, setCurrentCourse] = useState(course);
  const [activeUnitId, setActiveUnitId] = useState(course.units?.[0]?.id || null);
  const [activeTab, setActiveTab] = useState('curriculum'); // 'curriculum' | 'assessments' | 'settings'

  // Add People / Enrol Members Modal State (0 Tokens)
  const [isAddPeopleOpen, setIsAddPeopleOpen] = useState(false);

  // AI Ingest Modal / Banner State
  const [isAiIngestOpen, setIsAiIngestOpen] = useState(false);
  const [aiSyllabusText, setAiSyllabusText] = useState('');
  const [aiTargetLevel, setAiTargetLevel] = useState(course.aqfLevel || 4);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiNotice, setAiNotice] = useState(null);

  // AQF Equivalence Assistant Modal State
  const [isAqfAssistantOpen, setIsAqfAssistantOpen] = useState(false);

  // Search & Import Drawer State
  const [isImportDrawerOpen, setIsImportDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchAqfLevel, setSearchAqfLevel] = useState('ALL');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [importNotice, setImportNotice] = useState(null);

  // Free Content Request Modal State
  const [requestModalData, setRequestModalData] = useState(null);
  const [requestReason, setRequestReason] = useState('');

  // Incoming Author Requests Modal State
  const [isIncomingRequestsOpen, setIsIncomingRequestsOpen] = useState(false);
  const [incomingRequests, setIncomingRequests] = useState([]);

  // Save feedback
  const [saveNotice, setSaveNotice] = useState(null);

  const isCharity = isUserCharityTeacher(userProfile);
  const selectedAqf = getAqfLevelMeta(currentCourse.aqfLevel);

  // Update top-level course fields
  const handleCourseFieldChange = (field, value) => {
    setCurrentCourse(prev => ({
      ...prev,
      [field]: value,
      updatedAt: Date.now()
    }));
  };

  // Unit Operations
  const handleAddUnit = () => {
    const nextIdx = (currentCourse.units?.length || 0) + 1;
    const newUnit = createBlankUnit(`UNIT-${nextIdx}01`, `Unit ${nextIdx}: Advanced Practice`);
    setCurrentCourse(prev => ({
      ...prev,
      units: [...(prev.units || []), newUnit]
    }));
    setActiveUnitId(newUnit.id);
  };

  const handleUpdateUnit = (unitId, field, value) => {
    setCurrentCourse(prev => ({
      ...prev,
      units: (prev.units || []).map(u => u.id === unitId ? { ...u, [field]: value } : u)
    }));
  };

  const handleDeleteUnit = (unitId) => {
    if ((currentCourse.units || []).length <= 1) {
      alert('A course must contain at least one unit.');
      return;
    }
    if (confirm('Are you sure you want to delete this unit and all its lessons?')) {
      setCurrentCourse(prev => {
        const nextUnits = prev.units.filter(u => u.id !== unitId);
        if (activeUnitId === unitId) setActiveUnitId(nextUnits[0]?.id || null);
        return { ...prev, units: nextUnits };
      });
    }
  };

  // Lesson Operations
  const handleAddLesson = (unitId) => {
    const unit = currentCourse.units?.find(u => u.id === unitId);
    const order = unit?.lessons?.length || 0;
    const newLesson = createBlankLesson(order, `Lesson ${order + 1}: Topic ${order + 1}`);
    setCurrentCourse(prev => ({
      ...prev,
      units: prev.units.map(u => u.id === unitId ? { ...u, lessons: [...(u.lessons || []), newLesson] } : u)
    }));
  };

  const handleUpdateLesson = (unitId, lessonId, field, value) => {
    setCurrentCourse(prev => ({
      ...prev,
      units: prev.units.map(u => {
        if (u.id !== unitId) return u;
        return {
          ...u,
          lessons: u.lessons.map(l => l.id === lessonId ? { ...l, [field]: value } : l)
        };
      })
    }));
  };

  const handleDeleteLesson = (unitId, lessonId) => {
    setCurrentCourse(prev => ({
      ...prev,
      units: prev.units.map(u => {
        if (u.id !== unitId) return u;
        return { ...u, lessons: u.lessons.filter(l => l.id !== lessonId) };
      })
    }));
  };

  // Content Block Operations
  const handleAddBlock = (unitId, lessonId, type) => {
    const unit = currentCourse.units?.find(u => u.id === unitId);
    const lesson = unit?.lessons?.find(l => l.id === lessonId);
    const order = lesson?.blocks?.length || 0;
    const newBlock = createBlankContentBlock(type, order);

    setCurrentCourse(prev => ({
      ...prev,
      units: prev.units.map(u => {
        if (u.id !== unitId) return u;
        return {
          ...u,
          lessons: u.lessons.map(l => {
            if (l.id !== lessonId) return l;
            return { ...l, blocks: [...(l.blocks || []), newBlock] };
          })
        };
      })
    }));
  };

  const handleUpdateBlock = (unitId, lessonId, blockId, patch) => {
    setCurrentCourse(prev => ({
      ...prev,
      units: prev.units.map(u => {
        if (u.id !== unitId) return u;
        return {
          ...u,
          lessons: u.lessons.map(l => {
            if (l.id !== lessonId) return l;
            return {
              ...l,
              blocks: l.blocks.map(b => b.id === blockId ? { ...b, ...patch, metadata: { ...b.metadata, ...(patch.metadata || {}) } } : b)
            };
          })
        };
      })
    }));
  };

  const handleDeleteBlock = (unitId, lessonId, blockId) => {
    setCurrentCourse(prev => ({
      ...prev,
      units: prev.units.map(u => {
        if (u.id !== unitId) return u;
        return {
          ...u,
          lessons: u.lessons.map(l => {
            if (l.id !== lessonId) return l;
            return { ...l, blocks: l.blocks.filter(b => b.id !== blockId) };
          })
        };
      })
    }));
  };

  // Assessment Operations
  const handleAddAssessment = (unitId, type = 'formative') => {
    const newAsmt = createBlankAssessment(type, type === 'summative' ? 'Summative Task' : 'Formative Task');
    setCurrentCourse(prev => ({
      ...prev,
      units: prev.units.map(u => u.id === unitId ? { ...u, assessments: [...(u.assessments || []), newAsmt] } : u)
    }));
  };

  const handleUpdateAssessment = (unitId, asmtId, patch) => {
    setCurrentCourse(prev => ({
      ...prev,
      units: prev.units.map(u => {
        if (u.id !== unitId) return u;
        return {
          ...u,
          assessments: (u.assessments || []).map(a => a.id === asmtId ? { ...a, ...patch } : a)
        };
      })
    }));
  };

  const handleDeleteAssessment = (unitId, asmtId) => {
    setCurrentCourse(prev => ({
      ...prev,
      units: prev.units.map(u => {
        if (u.id !== unitId) return u;
        return { ...u, assessments: (u.assessments || []).filter(a => a.id !== asmtId) };
      })
    }));
  };

  // Rubric Matrix Operations
  const handleAddRubricCriterion = (unitId, asmtId) => {
    const newCrit = {
      id: generateEntityId('rubric'),
      criterionTitle: 'New Evaluation Criterion',
      weightPercentage: 25,
      levels: [
        { label: 'Novice (0-49%)', points: 40, descriptor: 'Demonstrates preliminary understanding.' },
        { label: 'Competent (50-74%)', points: 70, descriptor: 'Satisfies primary standards reliably.' },
        { label: 'Proficient (75-89%)', points: 85, descriptor: 'Shows comprehensive mastery.' },
        { label: 'Advanced (90-100%)', points: 100, descriptor: 'Exceeds benchmark standards.' }
      ]
    };

    setCurrentCourse(prev => ({
      ...prev,
      units: prev.units.map(u => {
        if (u.id !== unitId) return u;
        return {
          ...u,
          assessments: (u.assessments || []).map(a => {
            if (a.id !== asmtId) return a;
            return { ...a, rubric: [...(a.rubric || []), newCrit] };
          })
        };
      })
    }));
  };

  // 10-Token AI Ingestion Execution
  const handleRunAiIngestion = async () => {
    if (!aiSyllabusText.trim()) {
      setAiNotice({ type: 'error', message: 'Please paste syllabus text or upload a document.' });
      return;
    }

    setIsAiLoading(true);
    setAiNotice(null);

    try {
      const res = await ingestCourseSyllabusWithAI({
        currentUser,
        userProfile,
        syllabusText: aiSyllabusText,
        targetAqfLevel: aiTargetLevel
      });

      setCurrentCourse(res.course);
      setActiveUnitId(res.course.units?.[0]?.id || null);
      setAiNotice({ type: 'success', message: res.message });
      if (onRefreshBalance) onRefreshBalance();
      setTimeout(() => setIsAiIngestOpen(false), 1800);
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS_FOR_AI') {
        setAiNotice({
          type: 'error',
          message: `⚠️ Insufficient tokens (${err.currentBalance}/${err.requiredTokens} tokens). Please buy tokens or request a Charity Pass.`
        });
      } else {
        setAiNotice({ type: 'error', message: err.message || 'AI Ingestion encountered an error.' });
      }
    } finally {
      setIsAiLoading(false);
    }
  };

  // Content Search & Cloning
  const handleSearchMarketplace = async () => {
    setIsSearching(true);
    try {
      const results = await searchMarketplaceContent({
        keyword: searchQuery,
        aqfLevel: searchAqfLevel
      });
      setSearchResults(results);
    } finally {
      setIsSearching(false);
    }
  };

  const handleImportUnit = async (unitToImport, authorId, courseTitle) => {
    setImportNotice(null);
    try {
      const res = await executeContentClone({
        currentUser,
        userProfile,
        targetAuthorId: authorId,
        entityType: 'unit',
        entityId: unitToImport.id,
        entityTitle: unitToImport.unitTitle
      });

      // Clone unit with fresh IDs
      const clonedUnit = {
        ...unitToImport,
        id: generateEntityId('unit'),
        unitTitle: `${unitToImport.unitTitle} (Imported)`,
        lessons: (unitToImport.lessons || []).map(l => ({
          ...l,
          id: generateEntityId('lesson'),
          blocks: (l.blocks || []).map(b => ({ ...b, id: generateEntityId('block') }))
        })),
        assessments: (unitToImport.assessments || []).map(a => ({
          ...a,
          id: generateEntityId('asmt')
        }))
      };

      setCurrentCourse(prev => ({
        ...prev,
        units: [...(prev.units || []), clonedUnit]
      }));
      setActiveUnitId(clonedUnit.id);
      setImportNotice({ type: 'success', message: res.message });
      if (onRefreshBalance) onRefreshBalance();
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS') {
        setRequestModalData({
          unit: unitToImport,
          authorId,
          courseTitle
        });
      } else {
        setImportNotice({ type: 'error', message: err.message || 'Import failed.' });
      }
    }
  };

  const handleSendFreeRequest = async () => {
    if (!requestModalData) return;
    try {
      await createFreeContentRequest({
        requesterUser: currentUser,
        requesterProfile: userProfile,
        authorId: requestModalData.authorId,
        targetEntityType: 'unit',
        targetEntityId: requestModalData.unit.id,
        targetEntityTitle: requestModalData.unit.unitTitle,
        reasonMessage: requestReason
      });
      alert('Free content request submitted to the author! You will receive notification when approved.');
      setRequestModalData(null);
      setRequestReason('');
    } catch (err) {
      alert(err.message || 'Failed to dispatch free request.');
    }
  };

  // Save Course
  const handleSave = () => {
    onSaveCourse(currentCourse);
    setSaveNotice({ type: 'success', message: '✅ Course saved successfully to your repository.' });
    setTimeout(() => setSaveNotice(null), 3000);
  };

  const handlePublish = async () => {
    await publishCourseToMarketplace(currentCourse);
    onSaveCourse({ ...currentCourse, isPublished: true });
    setSaveNotice({ type: 'success', message: '🚀 Published to the OzEdu Content Exchange Marketplace!' });
    setTimeout(() => setSaveNotice(null), 3500);
  };

  const currentUnit = currentCourse.units?.find(u => u.id === activeUnitId) || currentCourse.units?.[0];

  return (
    <div className="aqf-builder-container animate-fade-in-up">
      {/* Top Banner Header */}
      <header className="builder-top-header glass">
        <div className="builder-header-left">
          <button className="nav-btn secondary" onClick={onBack} title="Back to Courses">
            ← Back
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#fef08a' }}>
                Course Builder: {currentCourse.title || 'Untitled Course'}
              </h2>
              <span className="aqf-badge-pill" style={{ background: '#0284c7' }}>
                {selectedAqf.shortTitle}
              </span>
            </div>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Australian Qualifications Framework (AQF Levels 1–9) • Every Category is Optional & Customizable
            </p>
          </div>
        </div>

        <div className="builder-header-right">
          {/* Token Indicator */}
          <div className="token-balance-pill" title="Your Token Balance">
            <span>🪙 {userTokenBalance} Tokens</span>
            {isCharity && (
              <span style={{ background: '#10b981', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 800 }}>
                Charity Pass
              </span>
            )}
          </div>

          <button
            className="nav-btn secondary"
            onClick={() => setIsAqfAssistantOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            title="AQF Reference Guide & International Equivalence"
          >
            <span>🇦🇺</span> AQF Guide
          </button>

          <button
            className="nav-btn secondary"
            onClick={() => {
              setIsImportDrawerOpen(true);
              handleSearchMarketplace();
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Search and import units from other courses (1 Token / Charity Pass)"
          >
            <span>🔍</span> Content Exchange
          </button>

          <button
            className="nav-btn primary"
            onClick={() => {
              setIsAiIngestOpen(true);
              setAiNotice(null);
            }}
            style={{ background: 'linear-gradient(135deg, #a855f7, #6366f1)', border: 'none', fontWeight: 700 }}
            title="Auto-Fill with Gemini AI (Costs 10 Tokens • Free for Charity Teachers)"
          >
            <span>✨</span> AI Ingest (10 Tokens)
          </button>

          <button
            className="nav-btn secondary"
            style={{ borderColor: 'rgba(52, 211, 153, 0.5)', color: '#86efac', display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setIsAddPeopleOpen(true)}
            title="Free Teacher Privilege: Add any students, teachers, or colleagues at 0 tokens"
          >
            👥 Add People (0 🪙)
          </button>

          <button className="nav-btn secondary" onClick={handleSave}>
            Save
          </button>

          <button className="nav-btn primary" onClick={handlePublish}>
            🚀 Publish
          </button>
        </div>
      </header>

      {/* Save Notice */}
      {saveNotice && (
        <div className={`builder-notice-bar ${saveNotice.type}`}>
          {saveNotice.message}
        </div>
      )}

      {/* Main Grid: Left Sidebar (Units/Meta) + Right Editor */}
      <div className="builder-workspace-grid">
        {/* Left Sidebar: Course Config & Unit Navigator */}
        <aside className="builder-sidebar glass">
          <div className="sidebar-section">
            <h4 className="sidebar-heading">Course Specifications</h4>
            
            <label className="field-label">Course Title</label>
            <input
              type="text"
              className="form-input"
              value={currentCourse.title || ''}
              onChange={e => handleCourseFieldChange('title', e.target.value)}
              placeholder="e.g. Diploma of Cyber Security"
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label className="field-label">Course Code</label>
                <input
                  type="text"
                  className="form-input"
                  value={currentCourse.code || ''}
                  onChange={e => handleCourseFieldChange('code', e.target.value)}
                  placeholder="e.g. ICT50220"
                />
              </div>
              <div>
                <label className="field-label">Token Cost</label>
                <input
                  type="number"
                  min="0"
                  className="form-input"
                  value={currentCourse.token_cost !== undefined ? currentCourse.token_cost : 10}
                  onChange={e => handleCourseFieldChange('token_cost', Number(e.target.value) || 0)}
                  title="How many tokens students spend to enroll (0 = Free)"
                />
              </div>
            </div>

            <label className="field-label">AQF Level Taxonomy</label>
            <select
              className="form-input"
              value={currentCourse.aqfLevel !== undefined ? currentCourse.aqfLevel : 4}
              onChange={e => handleCourseFieldChange('aqfLevel', Number(e.target.value))}
            >
              {AQF_LEVELS.map(lvl => (
                <option key={lvl.level} value={lvl.level}>
                  {lvl.title}
                </option>
              ))}
            </select>
            <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '4px', fontSize: '0.78rem' }}>
              {selectedAqf.competencySummary}
            </small>

            <label className="field-label" style={{ marginTop: '10px' }}>Course Description</label>
            <textarea
              rows="3"
              className="form-input"
              value={currentCourse.description || ''}
              onChange={e => handleCourseFieldChange('description', e.target.value)}
              placeholder="Comprehensive industry overview and target learning cohort..."
            />
          </div>

          <div className="sidebar-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 className="sidebar-heading" style={{ margin: 0 }}>
                Units of Study ({(currentCourse.units || []).length})
              </h4>
              <button className="nav-btn primary icon-only-btn" onClick={handleAddUnit} title="Add Unit">
                + Unit
              </button>
            </div>

            <div className="units-nav-list">
              {(currentCourse.units || []).map((u, idx) => (
                <div
                  key={u.id}
                  className={`unit-nav-item ${u.id === activeUnitId ? 'active' : ''}`}
                  onClick={() => setActiveUnitId(u.id)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="unit-nav-code">{u.unitCode || `UNIT-${idx + 1}`}</div>
                    <div className="unit-nav-title">{u.unitTitle || 'Untitled Unit'}</div>
                  </div>
                  <button
                    className="delete-icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteUnit(u.id);
                    }}
                    title="Delete Unit"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Right Editor Area */}
        <main className="builder-main-panel glass">
          {currentUnit ? (
            <div>
              {/* Unit Header Card */}
              <div className="unit-editor-header">
                <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 120px', gap: '12px', alignItems: 'flex-start' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                      Unit Code
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={currentUnit.unitCode || ''}
                      onChange={e => handleUpdateUnit(currentUnit.id, 'unitCode', e.target.value)}
                      placeholder="e.g. BSBTEC301"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                      Unit Title
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      style={{ fontWeight: 700, fontSize: '1.05rem' }}
                      value={currentUnit.unitTitle || ''}
                      onChange={e => handleUpdateUnit(currentUnit.id, 'unitTitle', e.target.value)}
                      placeholder="e.g. Design and produce business documents"
                    />
                  </div>
                  <div>
                    <label
                      style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}
                      title="Nominal Guided Learning Hours: the estimated study and instructional hours allocated to complete this unit."
                    >
                      Nominal Hours
                    </label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="number"
                        min="1"
                        className="form-input"
                        style={{ paddingRight: '36px' }}
                        value={currentUnit.nominalHours || 40}
                        onChange={e => handleUpdateUnit(currentUnit.id, 'nominalHours', Number(e.target.value) || 0)}
                        placeholder="40"
                        title="Nominal Guided Learning Hours (guided instructional and study time)"
                      />
                      <span style={{ position: 'absolute', right: '10px', fontSize: '0.78rem', color: '#94a3b8', pointerEvents: 'none', fontWeight: 600 }}>
                        hrs
                      </span>
                    </div>
                  </div>
                </div>
                <textarea
                  rows="2"
                  className="form-input"
                  style={{ marginTop: '10px' }}
                  value={currentUnit.description || ''}
                  onChange={e => handleUpdateUnit(currentUnit.id, 'description', e.target.value)}
                  placeholder="Unit performance criteria and learning outcomes..."
                />
              </div>

              {/* Navigation Tabs for Active Unit */}
              <div className="unit-tabs-row">
                <button
                  className={`tab-btn ${activeTab === 'curriculum' ? 'active' : ''}`}
                  onClick={() => setActiveTab('curriculum')}
                >
                  📚 Lessons & Blocks ({(currentUnit.lessons || []).length})
                </button>
                <button
                  className={`tab-btn ${activeTab === 'assessments' ? 'active' : ''}`}
                  onClick={() => setActiveTab('assessments')}
                >
                  🎯 Assessments & Rubrics ({(currentUnit.assessments || []).length})
                </button>
              </div>

              {/* TAB 1: CURRICULUM (LESSONS & BLOCKS) */}
              {activeTab === 'curriculum' && (
                <div className="lessons-container">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Modular Lesson Stack</h3>
                    <button className="nav-btn primary" onClick={() => handleAddLesson(currentUnit.id)}>
                      + Add Lesson
                    </button>
                  </div>

                  {(currentUnit.lessons || []).length === 0 ? (
                    <div className="empty-state-card">
                      <p>No lessons added yet.</p>
                      <button className="nav-btn primary" onClick={() => handleAddLesson(currentUnit.id)}>
                        Create First Lesson
                      </button>
                    </div>
                  ) : (
                    (currentUnit.lessons || []).map((lesson, lIdx) => (
                      <div key={lesson.id} className="lesson-card glass">
                        {/* Lesson Header */}
                        <div className="lesson-header-row">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                            <span className="lesson-index-badge">#{lIdx + 1}</span>
                            <input
                              type="text"
                              className="form-input lesson-title-input"
                              value={lesson.title || ''}
                              onChange={e => handleUpdateLesson(currentUnit.id, lesson.id, 'title', e.target.value)}
                              placeholder="Lesson Title"
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                              type="number"
                              className="form-input"
                              style={{ width: '80px', margin: 0 }}
                              value={lesson.estimatedMinutes || 45}
                              onChange={e => handleUpdateLesson(currentUnit.id, lesson.id, 'estimatedMinutes', Number(e.target.value))}
                              title="Estimated duration in minutes"
                            />
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>min</span>
                            <button
                              className="delete-icon-btn"
                              onClick={() => handleDeleteLesson(currentUnit.id, lesson.id)}
                              title="Delete Lesson"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>

                        {/* Modular Content Blocks Stack */}
                        <div className="blocks-stack">
                          {(lesson.blocks || []).map((block, bIdx) => (
                            <div key={block.id} className={`content-block-item type-${block.type}`}>
                              <div className="block-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span className="block-type-icon">
                                    {CONTENT_BLOCK_TYPES.find(t => t.type === block.type)?.icon || '📄'}
                                  </span>
                                  <span className="block-type-label">
                                    {CONTENT_BLOCK_TYPES.find(t => t.type === block.type)?.label || block.type}
                                  </span>
                                </div>
                                <button
                                  className="delete-icon-btn"
                                  onClick={() => handleDeleteBlock(currentUnit.id, lesson.id, block.id)}
                                  title="Remove Block"
                                >
                                  ×
                                </button>
                              </div>

                              <input
                                type="text"
                                className="form-input block-title-input"
                                value={block.title || ''}
                                onChange={e => handleUpdateBlock(currentUnit.id, lesson.id, block.id, { title: e.target.value })}
                                placeholder="Block Title or Section Heading"
                              />

                              {/* BLOCK TYPE: Text Description */}
                              {block.type === 'text_description' && (
                                <textarea
                                  rows="3"
                                  className="form-input"
                                  value={block.content || ''}
                                  onChange={e => handleUpdateBlock(currentUnit.id, lesson.id, block.id, { content: e.target.value })}
                                  placeholder="Markdown instructional content, core theory, or student notes..."
                                />
                              )}

                              {/* BLOCK TYPE: Teacher Guide */}
                              {block.type === 'teacher_guide' && (
                                <div className="teacher-guide-box">
                                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f59e0b', marginBottom: '4px' }}>
                                    🧑‍🏫 Internal Pedagogy & Facilitation Guide (Invisible to students)
                                  </div>
                                  <textarea
                                    rows="3"
                                    className="form-input"
                                    style={{ borderColor: '#f59e0b' }}
                                    value={block.content || ''}
                                    onChange={e => handleUpdateBlock(currentUnit.id, lesson.id, block.id, { content: e.target.value })}
                                    placeholder="Classroom timings, discussion scaffolding, common misconceptions..."
                                  />
                                </div>
                              )}

                              {/* BLOCK TYPE: YouTube Video */}
                              {block.type === 'youtube_video' && (
                                <div>
                                  <input
                                    type="text"
                                    className="form-input"
                                    value={block.metadata?.youtubeUrl || block.content || ''}
                                    onChange={e => {
                                      const url = e.target.value;
                                      handleUpdateBlock(currentUnit.id, lesson.id, block.id, {
                                        content: url,
                                        metadata: { youtubeUrl: url }
                                      });
                                    }}
                                    placeholder="Paste YouTube Video URL (e.g. https://www.youtube.com/watch?v=...)"
                                  />
                                  {(block.metadata?.youtubeUrl || block.content)?.includes('youtube.com') && (
                                    <div className="video-preview-badge">
                                      <span>▶️ YouTube Streaming Embed Active</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* BLOCK TYPE: Google Drive Resource */}
                              {block.type === 'google_drive_link' && (
                                <div>
                                  {/* Prominent Google Drive Public-Sharing Warning Banner */}
                                  <div className="drive-advisory-banner">
                                    <span>⚠️</span>
                                    <div>
                                      <strong>Google Drive Link Advisory:</strong> Please ensure this file/folder is set to <strong>"Anyone with the link can view"</strong> in Google Drive before publishing.
                                    </div>
                                  </div>

                                  <input
                                    type="text"
                                    className="form-input"
                                    value={block.metadata?.driveUrl || block.content || ''}
                                    onChange={e => {
                                      const url = e.target.value;
                                      handleUpdateBlock(currentUnit.id, lesson.id, block.id, {
                                        content: url,
                                        metadata: { driveUrl: url }
                                      });
                                    }}
                                    placeholder="Paste Google Drive shared link (Docs, Slides, Sheets, or Folders)"
                                  />
                                </div>
                              )}

                              {/* BLOCK TYPE: Direct File Upload */}
                              {block.type === 'file_upload' && (
                                <div>
                                  <input
                                    type="text"
                                    className="form-input"
                                    value={block.metadata?.fileUrl || block.content || ''}
                                    onChange={e => {
                                      const url = e.target.value;
                                      handleUpdateBlock(currentUnit.id, lesson.id, block.id, {
                                        content: url,
                                        metadata: { fileUrl: url }
                                      });
                                    }}
                                    placeholder="File Download URL or Cloud Storage Link..."
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Add Block Toolbar */}
                        <div className="add-block-toolbar">
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Add Block:</span>
                          {CONTENT_BLOCK_TYPES.map(bt => (
                            <button
                              key={bt.type}
                              type="button"
                              className="add-block-btn"
                              onClick={() => handleAddBlock(currentUnit.id, lesson.id, bt.type)}
                              title={bt.description}
                            >
                              <span>{bt.icon}</span>
                              <span>{bt.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 2: ASSESSMENTS & RUBRICS */}
              {activeTab === 'assessments' && (
                <div className="assessments-container">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Unit Assessments & Evidence Tasks</h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="nav-btn secondary" onClick={() => handleAddAssessment(currentUnit.id, 'formative')}>
                        + Formative Task
                      </button>
                      <button className="nav-btn primary" onClick={() => handleAddAssessment(currentUnit.id, 'summative')}>
                        + Summative Task
                      </button>
                    </div>
                  </div>

                  {(currentUnit.assessments || []).length === 0 ? (
                    <div className="empty-state-card">
                      <p>No assessment tasks configured for this unit.</p>
                      <button className="nav-btn primary" onClick={() => handleAddAssessment(currentUnit.id, 'summative')}>
                        Add Summative Capstone
                      </button>
                    </div>
                  ) : (
                    (currentUnit.assessments || []).map((asmt, aIdx) => (
                      <div key={asmt.id} className="assessment-card glass">
                        <div className="assessment-header-row">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                            <span className={`asmt-type-pill ${asmt.type}`}>
                              {asmt.type?.toUpperCase()}
                            </span>
                            <input
                              type="text"
                              className="form-input"
                              style={{ fontWeight: 700 }}
                              value={asmt.title || ''}
                              onChange={e => handleUpdateAssessment(currentUnit.id, asmt.id, { title: e.target.value })}
                              placeholder="Assessment Title"
                            />
                          </div>

                          <button
                            className="delete-icon-btn"
                            onClick={() => handleDeleteAssessment(currentUnit.id, asmt.id)}
                            title="Delete Assessment"
                          >
                            🗑️
                          </button>
                        </div>

                        <textarea
                          rows="2"
                          className="form-input"
                          style={{ marginTop: '10px' }}
                          value={asmt.description || ''}
                          onChange={e => handleUpdateAssessment(currentUnit.id, asmt.id, { description: e.target.value })}
                          placeholder="Task brief, submission requirements, and evidence portfolio..."
                        />

                        {/* External Submission Link */}
                        <div style={{ marginTop: '8px' }}>
                          <label className="field-label">External Submission Link (Google Forms / Canvas / Teams)</label>
                          <input
                            type="text"
                            className="form-input"
                            value={asmt.externalSubmissionLinks?.[0] || ''}
                            onChange={e => handleUpdateAssessment(currentUnit.id, asmt.id, { externalSubmissionLinks: [e.target.value] })}
                            placeholder="https://forms.google.com/... or https://teams.microsoft.com/..."
                          />
                        </div>

                        {/* Interactive Rubric Matrix */}
                        <div className="rubric-matrix-box">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <strong style={{ fontSize: '0.9rem', color: '#fef08a' }}>📊 Assessment Rubric Matrix</strong>
                            <button
                              className="nav-btn secondary"
                              style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                              onClick={() => handleAddRubricCriterion(currentUnit.id, asmt.id)}
                            >
                              + Add Criterion Row
                            </button>
                          </div>

                          <div className="rubric-table-responsive">
                            <table className="rubric-matrix-table">
                              <thead>
                                <tr>
                                  <th style={{ width: '25%' }}>Criterion & Weight</th>
                                  <th>Novice (0–49%)</th>
                                  <th>Competent (50–74%)</th>
                                  <th>Proficient (75–89%)</th>
                                  <th>Advanced (90–100%)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(asmt.rubric || []).map((crit) => (
                                  <tr key={crit.id}>
                                    <td>
                                      <input
                                        type="text"
                                        className="form-input matrix-crit-input"
                                        value={crit.criterionTitle || ''}
                                        onChange={e => {
                                          const nextRubric = asmt.rubric.map(r => r.id === crit.id ? { ...r, criterionTitle: e.target.value } : r);
                                          handleUpdateAssessment(currentUnit.id, asmt.id, { rubric: nextRubric });
                                        }}
                                        placeholder="Criterion Title"
                                      />
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                                        <input
                                          type="number"
                                          className="form-input"
                                          style={{ width: '65px', padding: '4px' }}
                                          value={crit.weightPercentage || 25}
                                          onChange={e => {
                                            const nextRubric = asmt.rubric.map(r => r.id === crit.id ? { ...r, weightPercentage: Number(e.target.value) || 0 } : r);
                                            handleUpdateAssessment(currentUnit.id, asmt.id, { rubric: nextRubric });
                                          }}
                                        />
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>% weight</span>
                                      </div>
                                    </td>
                                    {(crit.levels || []).map((lvl, lIdx) => (
                                      <td key={lIdx}>
                                        <textarea
                                          rows="2"
                                          className="form-input matrix-desc-input"
                                          value={lvl.descriptor || ''}
                                          onChange={e => {
                                            const updatedLevels = crit.levels.map((oldL, i) => i === lIdx ? { ...oldL, descriptor: e.target.value } : oldL);
                                            const nextRubric = asmt.rubric.map(r => r.id === crit.id ? { ...r, levels: updatedLevels } : r);
                                            handleUpdateAssessment(currentUnit.id, asmt.id, { rubric: nextRubric });
                                          }}
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state-card">
              <p>No unit selected. Select or add a unit from the left panel.</p>
            </div>
          )}
        </main>
      </div>

      {/* MODAL 1: 10-TOKEN GEMINI AI INGESTION */}
      {isAiIngestOpen && (
        <div className="builder-modal-overlay" onClick={() => setIsAiIngestOpen(false)}>
          <div className="builder-modal-dialog glass" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0, color: '#fef08a' }}>✨ Auto-Fill Course with Gemini AI</h3>
              <button className="close-btn" onClick={() => setIsAiIngestOpen(false)}>✕</button>
            </div>

            <div className="ai-token-cost-badge">
              <span>🪙 Cost: <strong>10 Tokens</strong></span>
              {isCharity ? (
                <span className="charity-badge">🎉 Free for Charity Teachers</span>
              ) : (
                <span>(Your balance: {userTokenBalance} tokens)</span>
              )}
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: '8px 0 14px 0' }}>
              Paste your raw course outline, syllabus file, or lesson notes below. Gemini will automatically structure units, lessons, modular content blocks, assessment tasks, and rubrics mapped to your target AQF level.
            </p>

            <label className="field-label">Target AQF Level</label>
            <select
              className="form-input"
              value={aiTargetLevel}
              onChange={e => setAiTargetLevel(Number(e.target.value))}
            >
              {AQF_LEVELS.map(lvl => (
                <option key={lvl.level} value={lvl.level}>
                  {lvl.title}
                </option>
              ))}
            </select>

            <label className="field-label" style={{ marginTop: '10px' }}>Syllabus / Course Outline</label>
            <textarea
              rows="7"
              className="form-input"
              value={aiSyllabusText}
              onChange={e => setAiSyllabusText(e.target.value)}
              placeholder="Paste course syllabus, lecture schedule, topic list, or learning objectives..."
            />

            {aiNotice && (
              <div className={`builder-notice-bar ${aiNotice.type}`} style={{ marginTop: '12px' }}>
                {aiNotice.message}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button className="nav-btn secondary" onClick={() => setIsAiIngestOpen(false)} disabled={isAiLoading}>
                Cancel
              </button>
              <button
                className="nav-btn primary"
                onClick={handleRunAiIngestion}
                disabled={isAiLoading || !aiSyllabusText.trim()}
                style={{ background: 'linear-gradient(135deg, #a855f7, #6366f1)', border: 'none', fontWeight: 700 }}
              >
                {isAiLoading ? '⚡ Gemini AI Generating...' : 'Ingest & Generate Course (10 Tokens)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: AQF EQUIVALENCE & TAXONOMY ASSISTANT */}
      {isAqfAssistantOpen && (
        <div className="builder-modal-overlay" onClick={() => setIsAqfAssistantOpen(false)}>
          <div className="builder-modal-dialog glass" style={{ maxWidth: '820px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0, color: '#fef08a' }}>🇦🇺 Australian Qualifications Framework (AQF) Reference Guide</h3>
              <button className="close-btn" onClick={() => setIsAqfAssistantOpen(false)}>✕</button>
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Teachers worldwide use OzEdu. Every category is optional and customizable. Use this reference matrix to calibrate your course to Australian national qualification benchmarks or international equivalents.
            </p>

            <div className="aqf-guide-grid">
              {AQF_LEVELS.map(lvl => (
                <div key={lvl.level} className={`aqf-guide-card ${currentCourse.aqfLevel === lvl.level ? 'selected' : ''}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="aqf-badge-pill" style={{ background: lvl.level === 0 ? '#64748b' : '#0284c7' }}>
                      {lvl.shortTitle}
                    </span>
                    <button
                      className="nav-btn secondary"
                      style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                      onClick={() => {
                        handleCourseFieldChange('aqfLevel', lvl.level);
                        setIsAqfAssistantOpen(false);
                      }}
                    >
                      Select
                    </button>
                  </div>
                  <div style={{ fontWeight: 700, margin: '6px 0 2px 0', fontSize: '0.92rem' }}>{lvl.credential}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lvl.summary}</div>
                  <div style={{ fontSize: '0.75rem', color: '#38bdf8', marginTop: '4px', fontStyle: 'italic' }}>
                    Demand: {lvl.competencySummary}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '16px', textAlign: 'right' }}>
              <button className="nav-btn primary" onClick={() => setIsAqfAssistantOpen(false)}>
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER 3: CONTENT EXCHANGE & SEARCH DRAWER */}
      {isImportDrawerOpen && (
        <div className="builder-drawer-overlay" onClick={() => setIsImportDrawerOpen(false)}>
          <div className="builder-drawer glass" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h3 style={{ margin: 0, color: '#fef08a' }}>🔍 Content Exchange Marketplace</h3>
                <small style={{ color: 'var(--text-secondary)' }}>
                  Cloning costs <strong>1 Token</strong> transferred to the author • <strong>0 Tokens</strong> for Charity Teachers
                </small>
              </div>
              <button className="close-btn" onClick={() => setIsImportDrawerOpen(false)}>✕</button>
            </div>

            {/* Search Filter Bar */}
            <div className="drawer-search-bar">
              <input
                type="text"
                className="form-input"
                placeholder="Search by topic, unit code, or keyword..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearchMarketplace()}
              />
              <select
                className="form-input"
                style={{ width: '130px' }}
                value={searchAqfLevel}
                onChange={e => setSearchAqfLevel(e.target.value)}
              >
                <option value="ALL">All Levels</option>
                {AQF_LEVELS.map(l => (
                  <option key={l.level} value={l.level}>{l.shortTitle}</option>
                ))}
              </select>
              <button className="nav-btn primary" onClick={handleSearchMarketplace} disabled={isSearching}>
                Search
              </button>
            </div>

            {importNotice && (
              <div className={`builder-notice-bar ${importNotice.type}`} style={{ margin: '10px 0' }}>
                {importNotice.message}
              </div>
            )}

            {/* Results List */}
            <div className="drawer-results-list">
              {searchResults.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 0' }}>
                  No published resources found matching your query.
                </div>
              ) : (
                searchResults.map(courseItem => (
                  <div key={courseItem.id} className="marketplace-item-card glass">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span className="aqf-badge-pill" style={{ background: '#0284c7' }}>
                          AQF Level {courseItem.aqfLevel}
                        </span>
                        <h4 style={{ margin: '4px 0 2px 0', fontSize: '1rem', color: '#fef08a' }}>
                          {courseItem.title}
                        </h4>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          Author: <strong>{courseItem.authorName}</strong> • {courseItem.code}
                        </div>
                      </div>
                    </div>

                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '6px 0' }}>
                      {courseItem.description?.slice(0, 140)}...
                    </p>

                    {/* Unit List to Import */}
                    <div className="marketplace-unit-sublist">
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                        Units Available to Import:
                      </div>
                      {(courseItem.units || []).map(u => (
                        <div key={u.id} className="marketplace-unit-row">
                          <div>
                            <strong>{u.unitCode}:</strong> {u.unitTitle}
                          </div>
                          <button
                            className="nav-btn primary"
                            style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                            onClick={() => handleImportUnit(u, courseItem.authorId, courseItem.title)}
                          >
                            {isCharity ? 'Import (0 Tokens)' : 'Import (1 Token)'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: INSUFFICIENT TOKENS -> FREE CONTENT REQUEST */}
      {requestModalData && (
        <div className="builder-modal-overlay" onClick={() => setRequestModalData(null)}>
          <div className="builder-modal-dialog glass" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0, color: '#f87171' }}>⚠️ Insufficient Tokens (1 Token Required)</h3>
              <button className="close-btn" onClick={() => setRequestModalData(null)}>✕</button>
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Your current token balance is <strong>{userTokenBalance} tokens</strong>. You need 1 token to import <strong>"{requestModalData.unit?.unitTitle}"</strong>.
            </p>

            <div style={{ background: 'rgba(255,255,255,0.06)', padding: '12px', borderRadius: '8px', margin: '10px 0' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fef08a' }}>
                Option: Request Free Access from Author
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '4px 0 8px 0' }}>
                You can dispatch an educational request to the content author explaining your school or classroom needs. Once approved, the unit will be imported at 0 tokens.
              </p>
              <textarea
                rows="3"
                className="form-input"
                placeholder="Reason for free request (e.g., teaching at an under-resourced school in regional Australia / developing nation)..."
                value={requestReason}
                onChange={e => setRequestReason(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button className="nav-btn secondary" onClick={() => setRequestModalData(null)}>
                Cancel
              </button>
              <button className="nav-btn primary" onClick={handleSendFreeRequest}>
                Send Free Request to Author
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Course Add People Modal (0 Tokens) */}
      {isAddPeopleOpen && (
        <CourseAddPeopleModal
          course={currentCourse}
          currentUser={currentUser}
          onClose={() => setIsAddPeopleOpen(false)}
          onMemberAdded={() => {}}
        />
      )}

      {/* Scoped CSS Styles for AQF Course Builder */}
      <style>{`
        .aqf-builder-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
          width: 100%;
          max-width: 1360px;
          margin: 0 auto;
          color: var(--text-primary);
        }
        .builder-top-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 20px;
          border-radius: 16px;
          flex-wrap: wrap;
          gap: 12px;
        }
        .builder-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .builder-header-right {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .token-balance-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 20px;
          background: rgba(245, 158, 11, 0.15);
          border: 1px solid rgba(245, 158, 11, 0.4);
          color: #fef08a;
          font-weight: 700;
          font-size: 0.85rem;
        }
        .aqf-badge-pill {
          padding: 3px 10px;
          border-radius: 12px;
          font-size: 0.72rem;
          font-weight: 800;
          text-transform: uppercase;
          color: #ffffff;
        }
        .builder-notice-bar {
          padding: 10px 16px;
          border-radius: 10px;
          font-size: 0.9rem;
          font-weight: 600;
        }
        .builder-notice-bar.success {
          background: rgba(34, 197, 94, 0.2);
          border: 1px solid rgba(34, 197, 94, 0.5);
          color: #86efac;
        }
        .builder-notice-bar.error {
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid rgba(239, 68, 68, 0.5);
          color: #fca5a5;
        }
        .builder-workspace-grid {
          display: grid;
          grid-template-columns: 340px 1fr;
          gap: 18px;
          align-items: start;
        }
        @media (max-width: 980px) {
          .builder-workspace-grid {
            grid-template-columns: 1fr;
          }
        }
        .builder-sidebar {
          padding: 18px;
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .sidebar-heading {
          margin: 0 0 10px 0;
          font-size: 0.95rem;
          font-weight: 700;
          color: #fef08a;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .field-label {
          display: block;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 4px;
        }
        .units-nav-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 400px;
          overflow-y: auto;
        }
        .unit-nav-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 12px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .unit-nav-item:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        .unit-nav-item.active {
          background: rgba(14, 165, 233, 0.2);
          border-color: #38bdf8;
        }
        .unit-nav-code {
          font-size: 0.75rem;
          font-weight: 800;
          color: #38bdf8;
        }
        .unit-nav-title {
          font-size: 0.85rem;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .delete-icon-btn {
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 1.1rem;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .delete-icon-btn:hover {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.15);
        }
        .builder-main-panel {
          padding: 22px;
          border-radius: 16px;
          min-height: 600px;
        }
        .unit-editor-header {
          padding-bottom: 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          margin-bottom: 16px;
        }
        .unit-tabs-row {
          display: flex;
          gap: 10px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          padding-bottom: 10px;
          margin-bottom: 18px;
        }
        .tab-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 0.95rem;
          font-weight: 600;
          padding: 8px 16px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .tab-btn.active {
          background: rgba(255, 255, 255, 0.12);
          color: #ffffff;
        }
        .lesson-card {
          padding: 16px;
          border-radius: 12px;
          margin-bottom: 16px;
          border: 1px solid rgba(255, 255, 255, 0.14);
        }
        .lesson-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          gap: 10px;
        }
        .lesson-index-badge {
          background: #3b82f6;
          color: #fff;
          font-size: 0.75rem;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 6px;
        }
        .lesson-title-input {
          font-size: 1.05rem;
          font-weight: 700;
          flex: 1;
        }
        .blocks-stack {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .content-block-item {
          padding: 12px;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .content-block-item.type-teacher_guide {
          background: rgba(245, 158, 11, 0.08);
          border-color: rgba(245, 158, 11, 0.3);
        }
        .block-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .block-type-label {
          font-size: 0.78rem;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-secondary);
        }
        .block-title-input {
          font-weight: 600;
          margin-bottom: 8px;
        }
        .drive-advisory-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(234, 179, 8, 0.15);
          border: 1px solid rgba(234, 179, 8, 0.4);
          color: #fef08a;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 0.82rem;
          margin-bottom: 8px;
        }
        .video-preview-badge {
          margin-top: 6px;
          font-size: 0.78rem;
          color: #4ade80;
          font-weight: 600;
        }
        .add-block-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px dashed rgba(255, 255, 255, 0.1);
          flex-wrap: wrap;
        }
        .add-block-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 0.78rem;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: var(--text-primary);
          cursor: pointer;
        }
        .add-block-btn:hover {
          background: rgba(255, 255, 255, 0.16);
        }
        .assessment-card {
          padding: 16px;
          border-radius: 12px;
          margin-bottom: 16px;
          border: 1px solid rgba(255, 255, 255, 0.14);
        }
        .assessment-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .asmt-type-pill {
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 0.72rem;
          font-weight: 800;
          color: #ffffff;
        }
        .asmt-type-pill.formative {
          background: #0d9488;
        }
        .asmt-type-pill.summative {
          background: #e11d48;
        }
        .rubric-matrix-box {
          margin-top: 14px;
          background: rgba(0, 0, 0, 0.25);
          padding: 12px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .rubric-table-responsive {
          overflow-x: auto;
        }
        .rubric-matrix-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8rem;
        }
        .rubric-matrix-table th {
          text-align: left;
          padding: 6px 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.14);
          color: #94a3b8;
        }
        .rubric-matrix-table td {
          padding: 6px 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          vertical-align: top;
        }
        .matrix-crit-input {
          font-weight: 700;
          font-size: 0.82rem;
        }
        .matrix-desc-input {
          font-size: 0.75rem;
          resize: vertical;
        }
        .builder-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 20px;
        }
        .builder-modal-dialog {
          width: 100%;
          max-width: 640px;
          padding: 24px;
          border-radius: 16px;
          max-height: 90vh;
          overflow-y: auto;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .ai-token-cost-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          border-radius: 20px;
          background: rgba(168, 85, 247, 0.2);
          border: 1px solid rgba(168, 85, 247, 0.5);
          color: #e9d5ff;
          font-size: 0.85rem;
          margin-bottom: 12px;
        }
        .charity-badge {
          background: #10b981;
          color: #fff;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 0.75rem;
          font-weight: 800;
        }
        .aqf-guide-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 12px;
          max-height: 60vh;
          overflow-y: auto;
        }
        .aqf-guide-card {
          padding: 12px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .aqf-guide-card.selected {
          border-color: #38bdf8;
          background: rgba(14, 165, 233, 0.15);
        }
        .builder-drawer-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          justify-content: flex-end;
          z-index: 1000;
        }
        .builder-drawer {
          width: 100%;
          max-width: 580px;
          height: 100%;
          padding: 24px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .drawer-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          padding-bottom: 12px;
        }
        .drawer-search-bar {
          display: flex;
          gap: 8px;
        }
        .drawer-results-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
          overflow-y: auto;
        }
        .marketplace-item-card {
          padding: 14px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.12);
        }
        .marketplace-unit-sublist {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px dashed rgba(255, 255, 255, 0.1);
        }
        .marketplace-unit-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;
          font-size: 0.82rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
      `}</style>
    </div>
  );
}
