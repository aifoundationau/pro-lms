import React, { useState, useEffect } from 'react';
import {
  AQF_LEVELS,
  CONTENT_BLOCK_TYPES,
  DEFAULT_RUBRIC_LEVEL_LABELS,
  getAqfLevelMeta,
  generateEntityId,
  createBlankUnit,
  createBlankLesson,
  createBlankContentBlock,
  createBlankAssessment,
  defaultLevelPoints,
  isGoogleNotebookUrl,
  createDefaultRubric,
  moveUnitAssessmentsToCourse
} from '../../types/courseBuilderTypes';
import QuizBlockEditor from './QuizBlockEditor.jsx';
import { mergeQuizAnswerKeys, remapQuizAnswerKeys, listCourseQuizzes } from '../../services/quizModel';
import { loadQuizAnswerKeys } from '../../services/quizService';
import CourseSpreadsheetPanel from './CourseSpreadsheetPanel.jsx';
import RubricSpreadsheetImport from './RubricSpreadsheetImport.jsx';
import { formatTokenBalance, hasUnlimitedTokens } from '../../services/rolePrivileges';
import { youtubeVideoId } from '../../services/mediaLinks';
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
import {
  DEFAULT_AI_ASSIST_COST_TOKENS,
  getAiAssistCostTokens
} from '../../services/aiAssistTokenService';
import {
  CURRICULUM_STANDARDS,
  sanitizeStandardIds,
  resolveActiveStandards
} from '../../services/curriculumStandards';
import { SKILL_TEXTS } from '../../services/curriculumSkillTexts';

/** Sum of rubric criterion weights (used for the Σ 100% indicator). */
function rubricWeightTotal(rubric) {
  const total = (Array.isArray(rubric) ? rubric : []).reduce((sum, r) => sum + (Number(r?.weightPercentage) || 0), 0);
  return Math.round(total * 100) / 100;
}

/**
 * Column headers: the level labels of the criterion with the most levels (rubrics may have
 * 2–10 levels, e.g. HD/D/C/P/F bands uploaded from a spreadsheet).
 */
function getRubricTierLabels(rubric) {
  let levels = [];
  for (const criterion of Array.isArray(rubric) ? rubric : []) {
    if (Array.isArray(criterion?.levels) && criterion.levels.length > levels.length) levels = criterion.levels;
  }
  if (!levels.length) return DEFAULT_RUBRIC_LEVEL_LABELS;
  return levels.map((level, idx) => {
    const label = level?.label;
    return typeof label === 'string' && label.trim() ? label : (DEFAULT_RUBRIC_LEVEL_LABELS[idx] || `Level ${idx + 1}`);
  });
}

/** Text area value <-> list of outcomes (one per line; blank lines are kept while typing). */
function linesToList(value) {
  return String(value ?? '').split('\n');
}

function listToLines(list) {
  return Array.isArray(list) ? list.join('\n') : '';
}

/**
 * Error boundary: if the builder crashes, show a recoverable fallback instead of
 * blanking the whole app.
 */
class CourseBuilderErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('AQFCourseBuilder crashed:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="glass" style={{ padding: '24px', borderRadius: '16px', maxWidth: '640px', margin: '40px auto', color: 'var(--text-primary)' }}>
          <h3 style={{ marginTop: 0, color: '#fca5a5' }}>⚠️ The Course Builder hit an unexpected error</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            Your last saved draft is safe. Unsaved edits in this session may be lost.
          </p>
          <pre style={{ fontSize: '0.75rem', whiteSpace: 'pre-wrap', color: '#fca5a5' }}>{String(this.state.error?.message || this.state.error)}</pre>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="nav-btn primary" onClick={() => this.setState({ error: null })}>Try Again</button>
            {this.props.onBack && (
              <button className="nav-btn secondary" onClick={this.props.onBack}>← Back</button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AQFCourseBuilder(props) {
  return (
    <CourseBuilderErrorBoundary onBack={props.onBack}>
      <AQFCourseBuilderInner {...props} />
    </CourseBuilderErrorBoundary>
  );
}

function AQFCourseBuilderInner({
  course,
  initialPanel = null,
  onSaveCourse,
  onBack,
  currentUser,
  userProfile,
  userTokenBalance = 0,
  onRefreshBalance
}) {
  // Course State
  // Assessments live once, at course level (older courses keep their tasks, moved up from units).
  const [currentCourse, setCurrentCourse] = useState(() => moveUnitAssessmentsToCourse(course));
  const [activeUnitId, setActiveUnitId] = useState(course.units?.[0]?.id || null);
  const [activeTab, setActiveTab] = useState(initialPanel === 'assessments' ? 'assessments' : 'curriculum');
  const [isSpecsExpanded, setIsSpecsExpanded] = useState(true);
  const [isAssessmentsExpanded, setIsAssessmentsExpanded] = useState(true);
  const [isUnitsSectionExpanded, setIsUnitsSectionExpanded] = useState(true);
  const [expandedUnits, setExpandedUnits] = useState(() => {
    const map = {};
    if (course.units?.[0]?.id) map[course.units[0].id] = true;
    return map;
  });
  const [expandedLessons, setExpandedLessons] = useState({});
  const [expandedAssessments, setExpandedAssessments] = useState({});

  const toggleUnitExpand = (unitId) => {
    setExpandedUnits(prev => ({ ...prev, [unitId]: !prev[unitId] }));
  };

  // Quiz answer keys are stored separately (teachers only) and merged in here for editing.
  const [quizKeysStatus, setQuizKeysStatus] = useState('loading'); // 'loading' | 'ok' | 'error'
  const keysCourseId = course?.id;
  useEffect(() => {
    if (!keysCourseId) return undefined;
    let cancelled = false;
    loadQuizAnswerKeys(keysCourseId).then(({ keys, ok }) => {
      if (cancelled) return;
      setQuizKeysStatus(ok ? 'ok' : 'error');
      if (ok) setCurrentCourse(prev => mergeQuizAnswerKeys(prev, keys));
    });
    return () => {
      cancelled = true;
    };
  }, [keysCourseId]);

  // Add People / Enrol Members Modal State (0 Tokens)
  const [isAddPeopleOpen, setIsAddPeopleOpen] = useState(false);

  // AI Ingest Modal / Banner State
  const [isAiIngestOpen, setIsAiIngestOpen] = useState(false);
  const [aiSyllabusText, setAiSyllabusText] = useState('');
  const [aiTargetLevel, setAiTargetLevel] = useState(Number.isInteger(Number(course.aqfLevel)) && course.aqfLevel !== '' && course.aqfLevel !== null ? Number(course.aqfLevel) : 0);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiNotice, setAiNotice] = useState(null);

  // 📊 Course Spreadsheet window & ✨ AI Assist source ('text' syllabus or 'spreadsheet')
  const [isSpreadsheetOpen, setIsSpreadsheetOpen] = useState(initialPanel === 'spreadsheet');
  const [aiSourceMode, setAiSourceMode] = useState('text');
  const [isSpreadsheetBusy, setIsSpreadsheetBusy] = useState(false);
  const [importWarnings, setImportWarnings] = useState([]);

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

  // AI Assist fee (Super Admin configured, default 10 tokens)
  const [aiAssistCost, setAiAssistCost] = useState(DEFAULT_AI_ASSIST_COST_TOKENS);

  const isCharity = isUserCharityTeacher(userProfile);
  // The Super Admin never needs tokens ("UNL" = unlimited).
  const isUnlimited = hasUnlimitedTokens(userProfile || { email: currentUser?.email });
  const selectedAqf = getAqfLevelMeta(currentCourse.aqfLevel);
  const selectedStandardIds = sanitizeStandardIds(currentCourse.curriculumStandards);
  const standardsRouting = resolveActiveStandards(selectedStandardIds, selectedAqf.level);
  const aiAssistRouting = resolveActiveStandards(selectedStandardIds, aiTargetLevel);
  const displayBalance = formatTokenBalance(userTokenBalance, userProfile || { email: currentUser?.email });
  const isAiAssistFree = isCharity || isUnlimited || aiAssistCost === 0;

  // Load the Super Admin configured AI Assist fee (falls back to 10 on any failure)
  useEffect(() => {
    let cancelled = false;
    getAiAssistCostTokens().then(cost => {
      if (!cancelled) setAiAssistCost(cost);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleStandard = (standardId) => {
    setCurrentCourse(prev => {
      const current = sanitizeStandardIds(prev.curriculumStandards);
      const next = current.includes(standardId)
        ? current.filter(id => id !== standardId)
        : [...current, standardId];
      return { ...prev, curriculumStandards: sanitizeStandardIds(next), updatedAt: Date.now() };
    });
  };

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
    setExpandedUnits(prev => ({ ...prev, [newUnit.id]: true }));
    setIsUnitsSectionExpanded(true);
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
        if (activeUnitId === unitId) {
          const nextActive = nextUnits[0]?.id || null;
          setActiveUnitId(nextActive);
          if (nextActive) setExpandedUnits(p => ({ ...p, [nextActive]: true }));
        }
        const assessments = (Array.isArray(prev.assessments) ? prev.assessments : []).map(a => (a?.unitId === unitId ? { ...a, unitId: '' } : a));
        return { ...prev, units: nextUnits, assessments };
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

  // Assessment Operations (one Assessments & Rubrics section for the whole course)
  const updateAssessments = (updater) => {
    setCurrentCourse(prev => ({
      ...prev,
      assessments: updater(Array.isArray(prev.assessments) ? prev.assessments.filter(a => a && typeof a === 'object') : []),
      updatedAt: Date.now()
    }));
  };

  const handleAddAssessment = (type = 'formative') => {
    const newAsmt = { ...createBlankAssessment(type, type === 'summative' ? 'Summative Task' : 'Formative Task'), unitId: '' };
    updateAssessments(list => [...list, newAsmt]);
    setExpandedAssessments(prev => ({ ...prev, [newAsmt.id]: true }));
    setIsAssessmentsExpanded(true);
  };

  const handleUpdateAssessment = (asmtId, patch) => {
    updateAssessments(list => list.map(a => (a.id === asmtId ? { ...a, ...patch } : a)));
  };

  const handleDeleteAssessment = (asmtId) => {
    updateAssessments(list => list.filter(a => a.id !== asmtId));
  };

  // Rubric Matrix Operations
  const DEFAULT_NEW_DESCRIPTORS = [
    'Demonstrates preliminary understanding.',
    'Satisfies primary standards reliably.',
    'Shows comprehensive mastery.',
    'Exceeds benchmark standards.'
  ];

  const updateRubric = (asmtId, updater) => {
    updateAssessments(list => list.map(a => (a.id === asmtId ? { ...a, rubric: updater(Array.isArray(a.rubric) ? a.rubric : []) } : a)));
  };

  // New rows copy the rubric's own level structure (e.g. a 5-band HD/D/C/P/F rubric stays 5-band).
  const handleAddRubricCriterion = (asmtId) => {
    updateRubric(asmtId, rubric => {
      const labels = getRubricTierLabels(rubric);
      const isDefault = labels.length === DEFAULT_RUBRIC_LEVEL_LABELS.length && labels.every((l, i) => l === DEFAULT_RUBRIC_LEVEL_LABELS[i]);
      const points = defaultLevelPoints(labels.length);
      const newCrit = {
        id: generateEntityId('rubric'),
        criterionTitle: 'New Evaluation Criterion',
        weightPercentage: 25,
        levels: labels.map((label, i) => ({ label, points: points[i], descriptor: isDefault ? DEFAULT_NEW_DESCRIPTORS[i] : '' }))
      };
      return [...rubric, newCrit];
    });
  };

  const handleDeleteRubricCriterion = (asmtId, criterionId) => {
    updateRubric(asmtId, rubric => rubric.filter(c => c.id !== criterionId));
  };

  // 📊 Spreadsheet import / ✨ AI build result -> builder (keeps this course's identity)
  const handleApplyImportedCourse = (importedCourse, { message, warnings = [] } = {}) => {
    setCurrentCourse(prev => ({
      ...moveUnitAssessmentsToCourse(importedCourse),
      id: prev.id ?? importedCourse.id,
      authorId: prev.authorId || importedCourse.authorId,
      authorName: prev.authorName || importedCourse.authorName,
      authorEmail: prev.authorEmail || importedCourse.authorEmail,
      createdAt: prev.createdAt ?? importedCourse.createdAt,
      updatedAt: Date.now()
    }));
    setActiveUnitId(importedCourse.units?.[0]?.id || null);
    setActiveTab('curriculum');
    setImportWarnings(Array.isArray(warnings) ? warnings.slice(0, 50) : []);
    setSaveNotice({ type: 'success', message: message || 'Course updated from your spreadsheet.' });
    setIsSpreadsheetOpen(false);
    setIsAiIngestOpen(false);
    setTimeout(() => setSaveNotice(null), 9000);
  };

  // AI Assist: full-course generation guided by the selected Curriculum Standards
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
        targetAqfLevel: aiTargetLevel,
        curriculumStandards: selectedStandardIds,
        skillTexts: SKILL_TEXTS,
        costTokens: aiAssistCost
      });

      // Keep the existing course identity/ownership and standards selection so saves
      // still target the course being edited.
      setCurrentCourse(prev => ({
        ...moveUnitAssessmentsToCourse(res.course),
        id: prev.id ?? res.course.id,
        authorId: prev.authorId ?? res.course.authorId,
        authorName: prev.authorName ?? res.course.authorName,
        curriculumStandards: sanitizeStandardIds(prev.curriculumStandards)
      }));
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
        setAiNotice({ type: 'error', message: err.message || 'AI Assist encountered an error.' });
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

  const handleImportUnit = async (unitToImport, authorId, courseTitle, sourceCourseId) => {
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

      // Clone unit with fresh IDs (units hold lessons & blocks only)
      const blockIdMap = {};
      const { assessments: legacyUnitTasks = [], ...unitContent } = unitToImport;
      let clonedUnit = {
        ...unitContent,
        id: generateEntityId('unit'),
        unitTitle: `${unitToImport.unitTitle} (Imported)`,
        lessons: (unitToImport.lessons || []).map(l => ({
          ...l,
          id: generateEntityId('lesson'),
          blocks: (l.blocks || []).map(b => {
            const id = generateEntityId('block');
            blockIdMap[b.id] = id;
            return { ...b, id };
          })
        }))
      };

      // Quiz answer keys are stored with the source course; bring them along for the new quiz ids.
      let keysNote = '';
      const hasQuizzes = listCourseQuizzes({ units: [clonedUnit] }).length > 0;
      if (hasQuizzes && sourceCourseId) {
        const { keys, ok } = await loadQuizAnswerKeys(sourceCourseId);
        if (ok) clonedUnit = mergeQuizAnswerKeys({ units: [clonedUnit] }, remapQuizAnswerKeys(keys, blockIdMap)).units[0];
        else keysNote = ' The quiz answers could not be copied — tick the correct answers in each quiz.';
      }
      const movedTasks = (Array.isArray(legacyUnitTasks) ? legacyUnitTasks : []).filter(a => a && typeof a === 'object')
        .map(a => ({ ...a, id: generateEntityId('asmt'), unitId: clonedUnit.id }));

      setCurrentCourse(prev => ({
        ...prev,
        units: [...(prev.units || []), clonedUnit],
        assessments: [...(Array.isArray(prev.assessments) ? prev.assessments : []), ...movedTasks]
      }));
      setActiveUnitId(clonedUnit.id);
      setActiveTab('curriculum');
      setImportNotice({ type: keysNote ? 'error' : 'success', message: res.message + keysNote });
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

  // Save Course as Draft
  const handleSave = async () => {
    const draftTags = Array.from(new Set([...(Array.isArray(currentCourse.tags) ? currentCourse.tags : []), 'lms', 'Draft']));
    const draftCourse = {
      ...currentCourse,
      isDraft: true,
      isPublished: false,
      status: 'draft',
      visibility: 'site',
      tag: 'lms',
      tags: draftTags,
      updatedAt: Date.now()
    };
    setCurrentCourse(draftCourse);
    try {
      await onSaveCourse(draftCourse);
      setSaveNotice({ type: 'success', message: '📝 Course saved as Draft (Tag "Draft" added. Hidden from other teachers & students).' });
      setTimeout(() => setSaveNotice(null), 3500);
    } catch (err) {
      console.error('Course save failed:', err);
      setSaveNotice({ type: 'error', message: `⚠️ The course was NOT saved to the cloud (${err?.code || err?.message || 'unknown error'}). Your edits are still here — check your connection and press Save Draft again.` });
    }
  };

  // Publish Course (Removes Draft tag & makes public)
  const handlePublish = async () => {
    // Strip 'Draft' tag when publishing
    const cleanTags = (Array.isArray(currentCourse.tags) ? currentCourse.tags : [])
      .filter(t => t.toLowerCase() !== 'draft');
    if (!cleanTags.includes('lms')) cleanTags.push('lms');

    const publishedCourse = {
      ...currentCourse,
      isDraft: false,
      isPublished: true,
      status: 'published',
      visibility: 'network',
      tag: 'lms',
      tags: cleanTags,
      publishedAt: Date.now(),
      updatedAt: Date.now()
    };
    setCurrentCourse(publishedCourse);
    try {
      await publishCourseToMarketplace(publishedCourse);
      await onSaveCourse(publishedCourse);
      setSaveNotice({ type: 'success', message: '🚀 Published! The course now appears in Global Search for every OzEdu teacher.' });
      setTimeout(() => setSaveNotice(null), 4000);
    } catch (err) {
      console.error('Course publish failed:', err);
      setSaveNotice({ type: 'error', message: `⚠️ The course was NOT published (${err?.code || err?.message || 'unknown error'}). Check your connection and press Publish again.` });
    }
  };

  const currentUnit = currentCourse.units?.find(u => u.id === activeUnitId) || currentCourse.units?.[0];
  const courseAssessments = Array.isArray(currentCourse.assessments) ? currentCourse.assessments.filter(a => a && typeof a === 'object') : [];
  const assessmentWeightTotal = Math.round(courseAssessments.reduce((sum, a) => sum + (Number(a.nominalWeight) || 0), 0) * 100) / 100;
  const quizCount = listCourseQuizzes(currentCourse).length;

  return (
    <div className="aqf-builder-container animate-fade-in-up">
      {/* Top Banner Header */}
      <header className="builder-top-header glass">
        <div className="builder-header-left">
          <button className="nav-btn secondary" onClick={onBack} title="Back to Courses">
            ← Back
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#fef08a' }}>
                Course Builder: {currentCourse.title || 'Untitled Course'}
              </h2>
              <span className="aqf-badge-pill" style={{ background: '#0284c7' }}>
                {selectedAqf.shortTitle}
              </span>
              {currentCourse.isDraft || currentCourse.tags?.includes('Draft') ? (
                <span className="aqf-badge-pill" style={{ background: '#d97706', color: '#fff', border: '1px dashed #fef08a' }}>
                  📝 Draft
                </span>
              ) : (
                <span className="aqf-badge-pill" style={{ background: '#059669', color: '#fff' }}>
                  🌐 Published
                </span>
              )}
            </div>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Australian Qualifications Framework (AQF Levels 1–9) • Every Category is Optional & Customizable
            </p>
          </div>
        </div>

        <div className="builder-header-right">
          {/* Token Indicator */}
          <div className="token-balance-pill" title={isUnlimited ? 'Super Admin: unlimited tokens' : 'Your Token Balance'}>
            <span>🪙 {displayBalance} Tokens</span>
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
            className="nav-btn secondary"
            onClick={() => setIsSpreadsheetOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', borderColor: 'rgba(250, 204, 21, 0.55)', color: '#fef08a' }}
            title="Fill in every part of the course from a spreadsheet (template, worked example, import or ✨ AI build)"
          >
            <span>📊</span> Spreadsheet
          </button>

          <button
            className="nav-btn primary"
            onClick={() => {
              setAiTargetLevel(currentCourse.aqfLevel !== undefined ? currentCourse.aqfLevel : 0);
              setIsAiIngestOpen(true);
              setAiNotice(null);
            }}
            style={{ background: 'linear-gradient(135deg, #a855f7, #6366f1)', border: 'none', fontWeight: 700 }}
            title="AI Assist: build your complete course with AI, guided by your Curriculum Standards"
          >
            <span>✨</span> AI Assist
          </button>

          <button
            className="nav-btn secondary"
            style={{ borderColor: 'rgba(52, 211, 153, 0.5)', color: '#86efac', display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setIsAddPeopleOpen(true)}
            title="Free Teacher Privilege: Add any students, teachers, or colleagues at 0 tokens"
          >
            👥 Add People (0 🪙)
          </button>

          <button
            className="nav-btn secondary"
            onClick={handleSave}
            style={{ borderColor: 'rgba(245, 158, 11, 0.7)', color: '#fef08a', display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Save course as Draft (Tag: Draft • Private to you)"
          >
            <span>📝</span> Save Draft
          </button>

          <button
            className="nav-btn primary"
            onClick={handlePublish}
            style={{ background: 'linear-gradient(135deg, #059669, #10b981)', border: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Publish course (removes Draft tag and makes public to students & teachers)"
          >
            <span>🚀</span> Publish
          </button>
        </div>
      </header>

      {/* Save Notice */}
      {saveNotice && (
        <div className={`builder-notice-bar ${saveNotice.type}`}>
          {saveNotice.message}
        </div>
      )}
      {importWarnings.length > 0 && (
        <details className="builder-import-notes">
          <summary>⚠️ {importWarnings.length} note{importWarnings.length === 1 ? '' : 's'} from the last import — review before saving</summary>
          <ul>{importWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          <button type="button" className="nav-btn secondary" style={{ padding: '4px 10px', fontSize: '0.78rem' }} onClick={() => setImportWarnings([])}>Dismiss</button>
        </details>
      )}

      {/* Main Grid: Left Sidebar (Units/Meta) + Right Editor */}
      <div className="builder-workspace-grid">
        {/* Left Sidebar: Course Config & Unit Navigator */}
        <aside className="builder-sidebar glass">
          <div className="sidebar-section">
            <h4 className="sidebar-heading">Quick Navigator</h4>
            <button
              type="button"
              className={`course-assessments-nav course-specs-nav ${isSpecsExpanded ? 'active' : ''}`}
              onClick={() => {
                setIsSpecsExpanded(true);
                const el = document.getElementById('builder-specs-panel');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              style={{ width: '100%', marginBottom: '8px' }}
              title="Jump to Course Specifications at the top of the right column"
            >
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div className="course-assessments-nav-label">📋 Course Specifications</div>
                <div className="course-assessments-nav-sub">
                  {currentCourse.code ? `${currentCourse.code} • ` : ''}{selectedAqf.shortTitle}
                </div>
              </div>
            </button>
            <button
              type="button"
              className={`course-assessments-nav ${isAssessmentsExpanded ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('assessments');
                setIsAssessmentsExpanded(true);
                const el = document.getElementById('builder-assessments-panel');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              style={{ width: '100%', marginBottom: '12px' }}
              title="Jump to Course Assessments at top of right column"
            >
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div className="course-assessments-nav-label">🎯 Assessments & Rubrics</div>
                <div className="course-assessments-nav-sub">
                  {courseAssessments.length} task{courseAssessments.length === 1 ? '' : 's'} • {quizCount} unit quiz{quizCount === 1 ? '' : 'zes'}
                </div>
              </div>
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fef08a' }}>
                Units of Study ({(currentCourse.units || []).length})
              </span>
              <button className="nav-btn primary icon-only-btn" onClick={handleAddUnit} title="Add Unit">
                + Unit
              </button>
            </div>

            <div className="units-nav-list">
              {(currentCourse.units || []).map((u, idx) => (
                <div
                  key={u.id}
                  className={`unit-nav-item ${u.id === activeUnitId ? 'active' : ''}`}
                  onClick={() => {
                    setActiveUnitId(u.id);
                    setExpandedUnits(prev => ({ ...prev, [u.id]: true }));
                    setIsUnitsSectionExpanded(true);
                    const el = document.getElementById(`unit-panel-${u.id}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
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
          {/* 📋 COURSE SPECIFICATIONS (one collapsible panel, above Course Assessments) */}
          <section id="builder-specs-panel" className="specs-container" aria-label="Course Specifications" style={{ marginBottom: '22px' }}>
            <div
              className="specs-panel-header"
              onClick={() => setIsSpecsExpanded(prev => !prev)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="collapse-toggle-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsSpecsExpanded(prev => !prev);
                  }}
                  aria-expanded={isSpecsExpanded}
                  aria-controls="builder-specs-body"
                  aria-label={isSpecsExpanded ? 'Collapse Course Specifications' : 'Expand Course Specifications'}
                  style={{ background: 'transparent', border: 'none', color: '#fef08a', fontSize: '1rem', cursor: 'pointer' }}
                >
                  {isSpecsExpanded ? '▼' : '►'}
                </button>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>📋 Course Specifications</h3>
                {!isSpecsExpanded && (
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    {currentCourse.title || 'Untitled Course'}{currentCourse.code ? ` • ${currentCourse.code}` : ''} • {selectedAqf.shortTitle}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="nav-btn secondary"
                style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSpecsExpanded(prev => !prev);
                }}
              >
                {isSpecsExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {isSpecsExpanded && (
              <div id="builder-specs-body" className="specs-grid">
                <div className="specs-wide">
                  <label className="field-label" htmlFor="spec-title">Course Title</label>
                  <input
                    id="spec-title"
                    type="text"
                    className="form-input"
                    value={currentCourse.title || ''}
                    onChange={e => handleCourseFieldChange('title', e.target.value)}
                    placeholder="e.g. Diploma of Cyber Security"
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="spec-code">Course Code</label>
                  <input
                    id="spec-code"
                    type="text"
                    className="form-input"
                    value={currentCourse.code || ''}
                    onChange={e => handleCourseFieldChange('code', e.target.value)}
                    placeholder="e.g. ICT50220"
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="spec-level">Level Taxonomy</label>
                  <select
                    id="spec-level"
                    className="form-input"
                    value={currentCourse.aqfLevel !== undefined ? currentCourse.aqfLevel : 0}
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
                </div>

                {/* Curriculum Standards: the AI Assist agent follows the matching /skills/*.md rules */}
                <div className="specs-wide">
                  <label className="field-label">Curriculum Standards (AI Alignment)</label>
                  <div className="standards-chip-grid" role="group" aria-label="Curriculum standards">
                    {CURRICULUM_STANDARDS.map(std => {
                      const isSelected = selectedStandardIds.includes(std.id);
                      const isSkipped = standardsRouting.skipped.some(s => s.id === std.id);
                      return (
                        <label
                          key={std.id}
                          className={`standard-chip ${isSelected ? 'selected' : ''} ${isSkipped ? 'skipped' : ''}`}
                          title={`${std.region} — ${std.description}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleStandard(std.id)}
                          />
                          <span>{std.flag} {std.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  {standardsRouting.advisories.map(msg => (
                    <small key={msg} className="standards-advisory">⚠️ {msg}</small>
                  ))}
                </div>

                <div className="specs-wide">
                  <label className="field-label" htmlFor="spec-description">Course Description</label>
                  <textarea
                    id="spec-description"
                    rows="3"
                    className="form-input"
                    value={currentCourse.description || ''}
                    onChange={e => handleCourseFieldChange('description', e.target.value)}
                    placeholder="Comprehensive industry overview and target learning cohort..."
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="spec-category">Category</label>
                  <input
                    id="spec-category"
                    type="text"
                    className="form-input"
                    value={currentCourse.category || ''}
                    onChange={e => handleCourseFieldChange('category', e.target.value)}
                    placeholder="e.g. Information Technology"
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="spec-year">Year / Semester</label>
                  <input
                    id="spec-year"
                    type="text"
                    className="form-input"
                    value={currentCourse.year || ''}
                    onChange={e => handleCourseFieldChange('year', e.target.value)}
                    placeholder="2026 Semester 1"
                  />
                </div>

                <div>
                  <label className="field-label" htmlFor="spec-start">Start Date</label>
                  <input
                    id="spec-start"
                    type="date"
                    className="form-input"
                    value={currentCourse.startDate || ''}
                    onChange={e => handleCourseFieldChange('startDate', e.target.value)}
                  />
                </div>

                <div className="specs-wide">
                  <label className="field-label" htmlFor="spec-outcomes">Course Learning Outcomes (one per line)</label>
                  <textarea
                    id="spec-outcomes"
                    rows="4"
                    className="form-input"
                    value={listToLines(currentCourse.learningOutcomes)}
                    onChange={e => handleCourseFieldChange('learningOutcomes', linesToList(e.target.value))}
                    placeholder="Analyse…&#10;Apply…&#10;Evaluate…"
                  />
                </div>

                <div className="specs-wide">
                  <label className="field-label" htmlFor="spec-knowledge">Assumed Knowledge / Prerequisites</label>
                  <textarea
                    id="spec-knowledge"
                    rows="2"
                    className="form-input"
                    value={currentCourse.knowledge || ''}
                    onChange={e => handleCourseFieldChange('knowledge', e.target.value)}
                    placeholder="What learners should already know"
                  />
                </div>

                <div className="specs-wide">
                  <label className="field-label" htmlFor="spec-equivalence">Level Equivalence Notes</label>
                  <textarea
                    id="spec-equivalence"
                    rows="2"
                    className="form-input"
                    value={currentCourse.aqfEquivalenceNotes || ''}
                    onChange={e => handleCourseFieldChange('aqfEquivalenceNotes', e.target.value)}
                    placeholder="How this maps to AQF or international frameworks"
                  />
                </div>

                <div className="specs-wide">
                  <label className="field-label" htmlFor="spec-cover">Cover Image URL</label>
                  <input
                    id="spec-cover"
                    type="url"
                    className="form-input"
                    value={currentCourse.thumbnail || ''}
                    onChange={e => handleCourseFieldChange('thumbnail', e.target.value)}
                    placeholder="https://…"
                  />
                </div>
              </div>
            )}
          </section>

          {/* 🎯 COURSE ASSESSMENTS & RUBRICS (below Course Specifications) */}
          <section id="builder-assessments-panel" className="assessments-container" aria-label="Course Assessments and Rubrics" style={{ marginBottom: '28px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
                gap: '10px',
                flexWrap: 'wrap',
                cursor: 'pointer',
                padding: '6px 8px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.03)'
              }}
              onClick={() => setIsAssessmentsExpanded(prev => !prev)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="collapse-toggle-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAssessmentsExpanded(prev => !prev);
                  }}
                  aria-label={isAssessmentsExpanded ? 'Collapse Course Assessments' : 'Expand Course Assessments'}
                  style={{ background: 'transparent', border: 'none', color: '#fef08a', fontSize: '1rem', cursor: 'pointer' }}
                >
                  {isAssessmentsExpanded ? '▼' : '►'}
                </button>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>🎯 Course Assessments & Rubrics</h3>
                <span className="count-badge" style={{ background: '#3b82f6', color: '#fff', fontSize: '0.75rem', fontWeight: 800, padding: '2px 8px', borderRadius: '10px' }}>
                  {courseAssessments.length}
                </span>
                {courseAssessments.length > 0 && (
                  <strong style={{ marginLeft: '6px', fontSize: '0.85rem', color: assessmentWeightTotal === 100 ? '#86efac' : '#fca5a5' }}>
                    (Σ {assessmentWeightTotal}%{assessmentWeightTotal === 100 ? '' : ' — should add up to 100%'})
                  </strong>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                <button className="nav-btn secondary" onClick={() => handleAddAssessment('formative')}>
                  + Formative Task
                </button>
                <button className="nav-btn primary" onClick={() => handleAddAssessment('summative')}>
                  + Summative Task
                </button>
                <button
                  type="button"
                  className="nav-btn secondary"
                  style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                  onClick={() => setIsAssessmentsExpanded(prev => !prev)}
                >
                  {isAssessmentsExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>
            </div>

            <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              One list for the whole course. Weightings are a share of the course grade. Unit quizzes are added as ❓ Quiz & Questions blocks inside lessons.
            </p>

            {isAssessmentsExpanded && (
              <div>
                {courseAssessments.length === 0 ? (
                  <div className="empty-state-card">
                    <p>No assessment tasks yet.</p>
                    <button className="nav-btn primary" onClick={() => handleAddAssessment('summative')}>
                      Add Summative Task
                    </button>
                  </div>
                ) : (
                  courseAssessments.map((asmt) => {
                    const isCardOpen = expandedAssessments[asmt.id] !== false;
                    const rubricRows = Array.isArray(asmt.rubric) ? asmt.rubric : [];
                    const legacyRubricText = typeof asmt.rubric === 'string' ? asmt.rubric.trim() : '';
                    return (
                      <div key={asmt.id} className="assessment-card glass" style={{ marginBottom: '14px' }}>
                        <div className="assessment-header-row">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                            <button
                              type="button"
                              className="collapse-toggle-btn"
                              onClick={() => setExpandedAssessments(prev => ({ ...prev, [asmt.id]: !isCardOpen }))}
                              aria-label={isCardOpen ? "Collapse task" : "Expand task"}
                              style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px 4px' }}
                            >
                              {isCardOpen ? '▼' : '►'}
                            </button>
                            <select
                              className={`asmt-type-pill asmt-type-select ${asmt.type}`}
                              value={asmt.type === 'summative' ? 'summative' : 'formative'}
                              onChange={e => handleUpdateAssessment(asmt.id, { type: e.target.value })}
                              aria-label="Assessment type"
                            >
                              <option value="formative">FORMATIVE</option>
                              <option value="summative">SUMMATIVE</option>
                            </select>
                            <input
                              type="text"
                              className="form-input"
                              style={{ fontWeight: 700 }}
                              value={asmt.title || ''}
                              onChange={e => handleUpdateAssessment(asmt.id, { title: e.target.value })}
                              placeholder="Assessment Title"
                            />
                            {asmt.nominalWeight !== null && asmt.nominalWeight !== undefined && (
                              <span style={{ fontSize: '0.78rem', color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px' }}>
                                {asmt.nominalWeight}%
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              type="button"
                              className="collapse-toggle-btn"
                              style={{ fontSize: '0.78rem', color: '#94a3b8', background: 'transparent', border: 'none', cursor: 'pointer' }}
                              onClick={() => setExpandedAssessments(prev => ({ ...prev, [asmt.id]: !isCardOpen }))}
                            >
                              {isCardOpen ? 'Collapse' : 'Expand'}
                            </button>
                            <button
                              className="delete-icon-btn"
                              onClick={() => handleDeleteAssessment(asmt.id)}
                              title="Delete Assessment"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>

                        {isCardOpen && (
                          <>
                            <textarea
                              rows="2"
                              className="form-input"
                              style={{ marginTop: '10px' }}
                              value={asmt.description || ''}
                              onChange={e => handleUpdateAssessment(asmt.id, { description: e.target.value })}
                              placeholder="Task brief, submission requirements, and evidence portfolio..."
                            />

                            {/* Due date, weighting, units covered & external submission link */}
                            <div className="asmt-meta-grid">
                              <div>
                                <label className="field-label">Due Date</label>
                                <input
                                  type="date"
                                  className="form-input"
                                  value={asmt.dueDate || ''}
                                  onChange={e => handleUpdateAssessment(asmt.id, { dueDate: e.target.value })}
                                />
                              </div>
                              <div>
                                <label className="field-label">Weighting (% of course)</label>
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  className="form-input"
                                  value={asmt.nominalWeight ?? ''}
                                  onChange={e => handleUpdateAssessment(asmt.id, { nominalWeight: e.target.value === '' ? null : Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                                />
                              </div>
                              <div>
                                <label className="field-label">Covers</label>
                                <select
                                  className="form-input"
                                  value={asmt.unitId && (currentCourse.units || []).some(u => u.id === asmt.unitId) ? asmt.unitId : ''}
                                  onChange={e => handleUpdateAssessment(asmt.id, { unitId: e.target.value })}
                                  aria-label="Units covered"
                                >
                                  <option value="">Whole course</option>
                                  {(currentCourse.units || []).map(u => (
                                    <option key={u.id} value={u.id}>{u.unitCode ? `${u.unitCode} — ` : ''}{u.unitTitle || 'Unit'}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="asmt-meta-wide">
                                <label className="field-label">External Submission Link (Google Forms / Canvas / Teams)</label>
                                <input
                                  type="text"
                                  className="form-input"
                                  value={asmt.externalSubmissionLinks?.[0] || ''}
                                  onChange={e => handleUpdateAssessment(asmt.id, { externalSubmissionLinks: [e.target.value] })}
                                  placeholder="https://forms.google.com/... or https://teams.microsoft.com/..."
                                />
                              </div>
                            </div>

                            {/* Interactive Rubric Matrix */}
                            <div className="rubric-matrix-box">
                              {legacyRubricText && (
                                <div className="legacy-rubric-note">
                                  <strong>Marking notes (text):</strong>
                                  <div style={{ whiteSpace: 'pre-wrap', margin: '4px 0 6px' }}>{legacyRubricText}</div>
                                  <button
                                    type="button"
                                    className="nav-btn secondary"
                                    style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                                    onClick={() => handleUpdateAssessment(asmt.id, { rubric: createDefaultRubric(), rubricNotes: legacyRubricText })}
                                  >
                                    Convert to a rubric matrix
                                  </button>
                                </div>
                              )}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <strong style={{ fontSize: '0.9rem', color: '#fef08a' }}>
                                  📊 Assessment Rubric Matrix
                                  <span style={{ marginLeft: '8px', fontSize: '0.75rem', fontWeight: 600, color: rubricWeightTotal(rubricRows) === 100 ? '#86efac' : '#fca5a5' }}>
                                    (Σ {rubricWeightTotal(rubricRows)}%)
                                  </span>
                                </strong>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                  <RubricSpreadsheetImport
                                    assessment={{ ...asmt, rubric: rubricRows }}
                                    onApply={nextRubric => handleUpdateAssessment(asmt.id, { rubric: nextRubric })}
                                  />
                                  <button
                                    className="nav-btn secondary"
                                    style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                                    onClick={() => handleAddRubricCriterion(asmt.id)}
                                  >
                                    + Add Criterion Row
                                  </button>
                                </div>
                              </div>

                              <div className="rubric-table-responsive">
                                <table className="rubric-matrix-table">
                                  <thead>
                                    <tr>
                                      <th style={{ width: '25%' }}>Criterion & Weight</th>
                                      {getRubricTierLabels(rubricRows).map((label, tIdx) => (
                                        <th key={tIdx}>{label}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rubricRows.length === 0 && (
                                      <tr>
                                        <td colSpan={getRubricTierLabels(rubricRows).length + 1} style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '12px' }}>
                                          No criteria yet — use + Add Criterion Row or ⬆ Upload Rubric.
                                        </td>
                                      </tr>
                                    )}
                                    {rubricRows.map((crit) => (
                                      <tr key={crit.id}>
                                        <td>
                                          <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-start' }}>
                                            <input
                                              type="text"
                                              className="form-input matrix-crit-input"
                                              value={crit.criterionTitle || ''}
                                              onChange={e => {
                                                const nextRubric = rubricRows.map(r => r.id === crit.id ? { ...r, criterionTitle: e.target.value } : r);
                                                handleUpdateAssessment(asmt.id, { rubric: nextRubric });
                                              }}
                                              placeholder="Criterion Title"
                                            />
                                            <button
                                              type="button"
                                              className="delete-icon-btn"
                                              onClick={() => handleDeleteRubricCriterion(asmt.id, crit.id)}
                                              title="Remove this criterion row"
                                              aria-label={`Remove criterion ${crit.criterionTitle || ''}`}
                                            >
                                              ×
                                            </button>
                                          </div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                                            <input
                                              type="number"
                                              className="form-input"
                                              style={{ width: '65px', padding: '4px' }}
                                              value={crit.weightPercentage ?? 25}
                                              onChange={e => {
                                                const nextRubric = rubricRows.map(r => r.id === crit.id ? { ...r, weightPercentage: Number(e.target.value) || 0 } : r);
                                                handleUpdateAssessment(asmt.id, { rubric: nextRubric });
                                              }}
                                            />
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>% weight</span>
                                          </div>
                                        </td>
                                        {getRubricTierLabels(rubricRows).map((_, lIdx) => {
                                          const lvl = crit.levels?.[lIdx];
                                          if (!lvl) return <td key={lIdx} className="matrix-empty-cell">—</td>;
                                          return (
                                            <td key={lIdx}>
                                              <textarea
                                                rows="2"
                                                className="form-input matrix-desc-input"
                                                value={lvl.descriptor || ''}
                                                onChange={e => {
                                                  const updatedLevels = crit.levels.map((oldL, i) => i === lIdx ? { ...oldL, descriptor: e.target.value } : oldL);
                                                  const nextRubric = rubricRows.map(r => r.id === crit.id ? { ...r, levels: updatedLevels } : r);
                                                  handleUpdateAssessment(asmt.id, { rubric: nextRubric });
                                                }}
                                              />
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </section>

          {/* 📚 UNITS OF STUDY (In the right column, below Course Assessments) */}
          <section id="builder-units-panel" className="units-container" aria-label="Units of Study">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px',
                gap: '10px',
                flexWrap: 'wrap',
                cursor: 'pointer',
                padding: '6px 8px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.03)',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)'
              }}
              onClick={() => setIsUnitsSectionExpanded(prev => !prev)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="collapse-toggle-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsUnitsSectionExpanded(prev => !prev);
                  }}
                  aria-label={isUnitsSectionExpanded ? 'Collapse Units of Study' : 'Expand Units of Study'}
                  style={{ background: 'transparent', border: 'none', color: '#fef08a', fontSize: '1rem', cursor: 'pointer' }}
                >
                  {isUnitsSectionExpanded ? '▼' : '►'}
                </button>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>📚 Units of Study</h3>
                <span className="count-badge" style={{ background: '#3b82f6', color: '#fff', fontSize: '0.75rem', fontWeight: 800, padding: '2px 8px', borderRadius: '10px' }}>
                  {(currentCourse.units || []).length}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                <button className="nav-btn primary" onClick={handleAddUnit}>
                  + Add Unit
                </button>
                <button
                  type="button"
                  className="nav-btn secondary"
                  style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                  onClick={() => setIsUnitsSectionExpanded(prev => !prev)}
                >
                  {isUnitsSectionExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>
            </div>

            {isUnitsSectionExpanded && (
              <div>
                {(currentCourse.units || []).length === 0 ? (
                  <div className="empty-state-card">
                    <p>No units added yet. Add a unit to build out lessons and quizzes.</p>
                    <button className="nav-btn primary" onClick={handleAddUnit}>
                      + Add Unit
                    </button>
                  </div>
                ) : (
                  (currentCourse.units || []).map((unit, uIdx) => {
                    const isUnitOpen = expandedUnits[unit.id] !== false;
                    const lessons = Array.isArray(unit.lessons) ? unit.lessons : [];
                    const unitQuizCount = lessons.reduce((acc, l) => acc + (l.blocks || []).filter(b => b.type === 'quiz').length, 0);

                    return (
                      <div
                        key={unit.id}
                        id={`unit-panel-${unit.id}`}
                        className="unit-section-card glass"
                        style={{ marginBottom: '20px', borderRadius: '12px', padding: '16px', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                      >
                        {/* Unit Card Summary / Header Bar */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            cursor: 'pointer',
                            padding: '4px 0',
                            marginBottom: isUnitOpen ? '14px' : '0'
                          }}
                          onClick={() => toggleUnitExpand(unit.id)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="collapse-toggle-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleUnitExpand(unit.id);
                              }}
                              aria-label={isUnitOpen ? 'Collapse unit' : 'Expand unit'}
                              style={{ background: 'transparent', border: 'none', color: '#fef08a', fontSize: '1rem', cursor: 'pointer' }}
                            >
                              {isUnitOpen ? '▼' : '►'}
                            </button>
                            <span className="sl-code" style={{ fontWeight: 800, color: '#38bdf8' }}>
                              {unit.unitCode || `UNIT-${uIdx + 1}`}
                            </span>
                            <strong style={{ fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {unit.unitTitle || 'Untitled Unit'}
                            </strong>
                            <span className="sl-muted" style={{ fontSize: '0.8rem' }}>
                              • {unit.nominalHours || 40} hrs • {lessons.length} lesson{lessons.length === 1 ? '' : 's'}
                              {unitQuizCount > 0 ? ` • ${unitQuizCount} quiz${unitQuizCount === 1 ? '' : 'zes'}` : ''}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              className="collapse-toggle-btn"
                              style={{ fontSize: '0.78rem', color: '#94a3b8', background: 'transparent', border: 'none', cursor: 'pointer' }}
                              onClick={() => toggleUnitExpand(unit.id)}
                            >
                              {isUnitOpen ? 'Collapse' : 'Expand'}
                            </button>
                            <button
                              className="delete-icon-btn"
                              onClick={() => handleDeleteUnit(unit.id)}
                              title="Delete Unit"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>

                        {/* Unit Content when expanded */}
                        {isUnitOpen && (
                          <div>
                            {/* Unit Editor Header */}
                            <div className="unit-editor-header">
                              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 120px', gap: '12px', alignItems: 'flex-start' }}>
                                <div>
                                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                                    Unit Code
                                  </label>
                                  <input
                                    type="text"
                                    className="form-input"
                                    value={unit.unitCode || ''}
                                    onChange={e => handleUpdateUnit(unit.id, 'unitCode', e.target.value)}
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
                                    value={unit.unitTitle || ''}
                                    onChange={e => handleUpdateUnit(unit.id, 'unitTitle', e.target.value)}
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
                                      value={unit.nominalHours || 40}
                                      onChange={e => handleUpdateUnit(unit.id, 'nominalHours', Number(e.target.value) || 0)}
                                      placeholder="40"
                                      title="Nominal Guided Learning Hours (guided instructional and study time)"
                                    />
                                    <span style={{ position: 'absolute', right: '10px', fontSize: '0.78rem', color: '#94a3b8', pointerEvents: 'none', fontWeight: 600 }}>
                                      hrs
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <label
                                htmlFor={`unit-performance-criteria-${unit.id}`}
                                style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', margin: '10px 0 4px' }}
                              >
                                Performance Criteria
                              </label>
                              <textarea
                                id={`unit-performance-criteria-${unit.id}`}
                                rows="2"
                                className="form-input"
                                value={unit.description || ''}
                                onChange={e => handleUpdateUnit(unit.id, 'description', e.target.value)}
                                placeholder="What a learner must demonstrate to be competent in this unit…"
                              />
                              <label className="field-label" style={{ marginTop: '8px' }}>Unit Learning Outcomes (one per line)</label>
                              <textarea
                                rows="2"
                                className="form-input"
                                value={listToLines(unit.learningOutcomes)}
                                onChange={e => handleUpdateUnit(unit.id, 'learningOutcomes', linesToList(e.target.value))}
                                placeholder="Explain…&#10;Apply…"
                              />
                            </div>

                            {/* A unit holds lessons & blocks only */}
                            <div className="unit-tabs-row">
                              <span className="tab-btn active" aria-current="true">
                                📚 Lessons & Blocks ({(unit.lessons || []).length})
                              </span>
                            </div>

                            {/* UNIT CURRICULUM (LESSONS & BLOCKS) */}
                            <div className="lessons-container">
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Modular Lesson Stack</h3>
                                <button className="nav-btn primary" onClick={() => handleAddLesson(unit.id)}>
                                  + Add Lesson
                                </button>
                              </div>

                              {(unit.lessons || []).length === 0 ? (
                                <div className="empty-state-card">
                                  <p>No lessons added yet.</p>
                                  <button className="nav-btn primary" onClick={() => handleAddLesson(unit.id)}>
                                    Create First Lesson
                                  </button>
                                </div>
                              ) : (
                                (unit.lessons || []).map((lesson, lIdx) => {
                                  const isLessonOpen = expandedLessons[lesson.id] !== false;
                                  const quizBlocks = (lesson.blocks || []).filter(b => b.type === 'quiz');

                                  return (
                                    <div key={lesson.id} className="lesson-card glass">
                                      {/* Lesson Header */}
                                      <div className="lesson-header-row">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                          <button
                                            type="button"
                                            className="collapse-toggle-btn"
                                            onClick={() => setExpandedLessons(prev => ({ ...prev, [lesson.id]: !isLessonOpen }))}
                                            aria-label={isLessonOpen ? "Collapse lesson" : "Expand lesson"}
                                            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px 4px' }}
                                          >
                                            {isLessonOpen ? '▼' : '►'}
                                          </button>
                                          <span className="lesson-index-badge">#{lIdx + 1}</span>
                                          <input
                                            type="text"
                                            className="form-input lesson-title-input"
                                            value={lesson.title || ''}
                                            onChange={e => handleUpdateLesson(unit.id, lesson.id, 'title', e.target.value)}
                                            placeholder="Lesson Title"
                                          />
                                          {quizBlocks.length > 0 && (
                                            <span style={{ fontSize: '0.72rem', background: 'rgba(167, 139, 250, 0.2)', color: '#c4b5fd', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                              {quizBlocks.length} quiz{quizBlocks.length === 1 ? '' : 'zes'}
                                            </span>
                                          )}
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          <input
                                            type="number"
                                            className="form-input"
                                            style={{ width: '80px', margin: 0 }}
                                            value={lesson.estimatedMinutes || 45}
                                            onChange={e => handleUpdateLesson(unit.id, lesson.id, 'estimatedMinutes', Number(e.target.value))}
                                            title="Estimated duration in minutes"
                                          />
                                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>min</span>
                                          <button
                                            type="button"
                                            className="collapse-toggle-btn"
                                            style={{ fontSize: '0.75rem', color: '#94a3b8', background: 'transparent', border: 'none', cursor: 'pointer' }}
                                            onClick={() => setExpandedLessons(prev => ({ ...prev, [lesson.id]: !isLessonOpen }))}
                                          >
                                            {isLessonOpen ? 'Collapse' : 'Expand'}
                                          </button>
                                          <button
                                            className="delete-icon-btn"
                                            onClick={() => handleDeleteLesson(unit.id, lesson.id)}
                                            title="Delete Lesson"
                                          >
                                            🗑️
                                          </button>
                                        </div>
                                      </div>

                                      {/* Modular Content Blocks Stack */}
                                      {isLessonOpen && (
                                        <>
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
                                                    onClick={() => handleDeleteBlock(unit.id, lesson.id, block.id)}
                                                    title="Remove Block"
                                                  >
                                                    ×
                                                  </button>
                                                </div>

                                                <input
                                                  type="text"
                                                  className="form-input block-title-input"
                                                  value={block.title || ''}
                                                  onChange={e => handleUpdateBlock(unit.id, lesson.id, block.id, { title: e.target.value })}
                                                  placeholder="Block Title or Section Heading"
                                                />

                                                {/* BLOCK TYPE: Text Description */}
                                                {block.type === 'text_description' && (
                                                  <textarea
                                                    rows="3"
                                                    className="form-input"
                                                    value={block.content || ''}
                                                    onChange={e => handleUpdateBlock(unit.id, lesson.id, block.id, { content: e.target.value })}
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
                                                      onChange={e => handleUpdateBlock(unit.id, lesson.id, block.id, { content: e.target.value })}
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
                                                        handleUpdateBlock(unit.id, lesson.id, block.id, {
                                                          content: url,
                                                          metadata: { youtubeUrl: url }
                                                        });
                                                      }}
                                                      placeholder="Paste YouTube Video URL (e.g. https://www.youtube.com/watch?v=...)"
                                                    />
                                                    {youtubeVideoId(block.metadata?.youtubeUrl || block.content) && (
                                                      <div className="video-preview-badge">
                                                        <span>▶️ YouTube Streaming Embed Active</span>
                                                      </div>
                                                    )}
                                                  </div>
                                                )}

                                                {/* BLOCK TYPE: Google Drive Resource */}
                                                {block.type === 'google_drive_link' && (
                                                  <div>
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
                                                        handleUpdateBlock(unit.id, lesson.id, block.id, {
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
                                                        handleUpdateBlock(unit.id, lesson.id, block.id, {
                                                          content: url,
                                                          metadata: { fileUrl: url }
                                                        });
                                                      }}
                                                      placeholder="File Download URL or Cloud Storage Link..."
                                                    />
                                                  </div>
                                                )}

                                                {/* BLOCK TYPE: Gemini Notebook */}
                                                {block.type === 'notebook_link' && (
                                                  <div>
                                                    <input
                                                      type="url"
                                                      className="form-input"
                                                      value={block.metadata?.notebookUrl || block.content || ''}
                                                      onChange={e => {
                                                        const url = e.target.value.trim();
                                                        handleUpdateBlock(unit.id, lesson.id, block.id, {
                                                          content: url,
                                                          metadata: { notebookUrl: url }
                                                        });
                                                      }}
                                                      placeholder="Paste the Gemini Notebook share link (e.g. https://notebooklm.google.com/notebook/...)"
                                                    />
                                                    {(block.metadata?.notebookUrl || block.content) && !isGoogleNotebookUrl(block.metadata?.notebookUrl || block.content) && (
                                                      <div className="notebook-hint">⚠️ This does not look like a Gemini Notebook link. Paste the notebook&apos;s https:// share link (e.g. https://notebooklm.google.com/notebook/…) and share the notebook so students can open it.</div>
                                                    )}
                                                    {isGoogleNotebookUrl(block.metadata?.notebookUrl || block.content) && (
                                                      <div className="video-preview-badge">📓 Gemini Notebook link ready</div>
                                                    )}
                                                  </div>
                                                )}

                                                {/* BLOCK TYPE: Quiz & Questions */}
                                                {block.type === 'quiz' && (
                                                  <QuizBlockEditor
                                                    quiz={block.quiz}
                                                    keysStatus={quizKeysStatus}
                                                    onChange={nextQuiz => handleUpdateBlock(unit.id, lesson.id, block.id, { quiz: nextQuiz })}
                                                  />
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
                                                className={`add-block-btn ${bt.disabled ? 'disabled' : ''}`}
                                                onClick={() => !bt.disabled && handleAddBlock(unit.id, lesson.id, bt.type)}
                                                disabled={Boolean(bt.disabled)}
                                                aria-disabled={Boolean(bt.disabled)}
                                                title={bt.disabled ? bt.disabledReason : bt.description}
                                              >
                                                <span>{bt.icon}</span>
                                                <span>{bt.label}</span>
                                                {bt.disabled && <span className="soon-badge">Soon</span>}
                                              </button>
                                            ))}
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </section>
        </main>
      </div>

      {/* MODAL 1: ✨ AI ASSIST (Gemini) — from syllabus text or from course spreadsheets */}
      {isAiIngestOpen && (
        <div className="builder-modal-overlay" onClick={() => !isAiLoading && !isSpreadsheetBusy && setIsAiIngestOpen(false)}>
          <div
            className="builder-modal-dialog glass"
            style={aiSourceMode === 'spreadsheet' ? { maxWidth: '780px' } : undefined}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-assist-title"
          >
            <div className="modal-header">
              <h3 id="ai-assist-title" style={{ margin: 0, color: '#fef08a' }}>✨ AI Assist: Build Your Complete Course</h3>
              <button className="close-btn" onClick={() => setIsAiIngestOpen(false)} disabled={isAiLoading || isSpreadsheetBusy} aria-label="Close">✕</button>
            </div>

            <div className="ai-token-cost-badge">
              <span>🪙 Cost: <strong>{isAiAssistFree ? '0 Tokens' : `${aiAssistCost} Tokens`}</strong></span>
              {isUnlimited ? (
                <span className="charity-badge">🛡️ Super Admin — UNL tokens</span>
              ) : isCharity ? (
                <span className="charity-badge">🎉 Free for Charity Teachers</span>
              ) : (
                <span>(Your balance: {displayBalance} tokens)</span>
              )}
            </div>

            <div className="ai-source-toggle" role="tablist" aria-label="Build from">
              <button
                type="button"
                role="tab"
                aria-selected={aiSourceMode === 'text'}
                className={aiSourceMode === 'text' ? 'active' : ''}
                onClick={() => !isSpreadsheetBusy && setAiSourceMode('text')}
                disabled={isAiLoading || isSpreadsheetBusy}
              >
                📝 Syllabus text
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={aiSourceMode === 'spreadsheet'}
                className={aiSourceMode === 'spreadsheet' ? 'active' : ''}
                onClick={() => !isAiLoading && setAiSourceMode('spreadsheet')}
                disabled={isAiLoading || isSpreadsheetBusy}
              >
                📊 Spreadsheets
              </button>
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: '8px 0 14px 0' }}>
              {aiSourceMode === 'text'
                ? 'Paste your raw course outline, syllabus file, or lesson notes below. Gemini will automatically structure units, lessons, modular content blocks, assessment tasks, and rubrics mapped to your target level.'
                : 'Upload your completed course spreadsheet(s). Gemini keeps everything you entered exactly as written, builds out every blank lesson, block, assessment and rubric, and never invents links.'}
            </p>

            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>
              Curriculum Standards:{' '}
              <strong style={{ color: '#86efac' }}>
                {selectedStandardIds.length === 0
                  ? 'None selected (choose them in the sidebar)'
                  : CURRICULUM_STANDARDS.filter(s => selectedStandardIds.includes(s.id)).map(s => s.label).join(', ')}
              </strong>
              {aiAssistRouting.advisories.map(msg => (
                <small key={msg} className="standards-advisory">⚠️ {msg}</small>
              ))}
            </div>

            <label className="field-label" htmlFor="ai-target-level">Target Level{aiSourceMode === 'spreadsheet' ? ' (used when the spreadsheet does not set one)' : ''}</label>
            <select
              id="ai-target-level"
              className="form-input"
              value={aiTargetLevel}
              onChange={e => setAiTargetLevel(Number(e.target.value))}
              disabled={isAiLoading || isSpreadsheetBusy}
            >
              {AQF_LEVELS.map(lvl => (
                <option key={lvl.level} value={lvl.level}>
                  {lvl.title}
                </option>
              ))}
            </select>

            {aiSourceMode === 'text' ? (
              <>
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
                    {isAiLoading
                      ? '⚡ AI Assist Generating...'
                      : `Generate Course (${isAiAssistFree ? '0' : aiAssistCost} Tokens)`}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ marginTop: '12px' }}>
                <CourseSpreadsheetPanel
                  course={currentCourse}
                  currentUser={currentUser}
                  userProfile={userProfile}
                  aiAssistCost={aiAssistCost}
                  isAiAssistFree={isAiAssistFree}
                  displayBalance={displayBalance}
                  targetAqfLevel={aiTargetLevel}
                  curriculumStandards={selectedStandardIds}
                  skillTexts={SKILL_TEXTS}
                  primaryAction="ai"
                  onApplyCourse={handleApplyImportedCourse}
                  onBusyChange={setIsSpreadsheetBusy}
                  onRefreshBalance={onRefreshBalance}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 1b: 📊 COURSE SPREADSHEET (template, import, ✨ AI build) */}
      {isSpreadsheetOpen && (
        <div className="builder-modal-overlay" onClick={() => !isSpreadsheetBusy && setIsSpreadsheetOpen(false)}>
          <div
            className="builder-modal-dialog glass"
            style={{ maxWidth: '780px' }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="course-spreadsheet-title"
          >
            <div className="modal-header">
              <h3 id="course-spreadsheet-title" style={{ margin: 0, color: '#fef08a' }}>📊 Course Spreadsheet — every part of your course, A to Z</h3>
              <button className="close-btn" onClick={() => setIsSpreadsheetOpen(false)} disabled={isSpreadsheetBusy} aria-label="Close">✕</button>
            </div>
            <CourseSpreadsheetPanel
              course={currentCourse}
              currentUser={currentUser}
              userProfile={userProfile}
              aiAssistCost={aiAssistCost}
              isAiAssistFree={isAiAssistFree}
              displayBalance={displayBalance}
              targetAqfLevel={currentCourse.aqfLevel}
              curriculumStandards={selectedStandardIds}
              skillTexts={SKILL_TEXTS}
              primaryAction="import"
              onApplyCourse={handleApplyImportedCourse}
              onBusyChange={setIsSpreadsheetBusy}
              onRefreshBalance={onRefreshBalance}
            />
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
                  Cloning costs <strong>1 Token</strong> (author royalty) • <strong>0 Tokens</strong> for Charity Teachers and the Super Admin
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
                            onClick={() => handleImportUnit(u, courseItem.authorId, courseItem.title, courseItem.id)}
                          >
                            {isCharity || isUnlimited ? 'Import (0 Tokens)' : 'Import (1 Token)'}
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
              Your current token balance is <strong>{displayBalance} tokens</strong>. You need 1 token to import <strong>"{requestModalData.unit?.unitTitle}"</strong>.
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
          userProfile={userProfile}
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
        /* ---- Curriculum Standards (AI Alignment) ---- */
        .standards-chip-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .standard-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 9px;
          border-radius: 999px;
          font-size: 0.76rem;
          font-weight: 700;
          cursor: pointer;
          color: var(--text-secondary);
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.14);
          backdrop-filter: blur(6px);
          transition: all 0.15s ease;
          user-select: none;
        }
        .standard-chip input {
          accent-color: #10b981;
          margin: 0;
          width: 13px;
          height: 13px;
        }
        .standard-chip.selected {
          color: #fef08a;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(245, 158, 11, 0.18));
          border-color: rgba(250, 204, 21, 0.55);
        }
        .standard-chip.skipped {
          border-style: dashed;
          opacity: 0.7;
        }
        .standards-advisory {
          display: block;
          margin-top: 3px;
          font-size: 0.72rem;
          color: #fcd34d;
        }
        /* ---- Spreadsheet import, notebook blocks, assessments ---- */
        .builder-import-notes {
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.35);
          border-radius: 10px;
          padding: 8px 14px;
          font-size: 0.82rem;
          color: #fde68a;
        }
        .builder-import-notes summary { cursor: pointer; font-weight: 700; }
        .builder-import-notes ul { margin: 6px 0; padding-left: 18px; max-height: 200px; overflow-y: auto; }
        .course-details-more { margin-top: 10px; }
        .course-details-more > summary { cursor: pointer; font-size: 0.82rem; font-weight: 700; color: #fef08a; }
        .legacy-rubric-note { padding: 8px 10px; border-radius: 8px; background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.35); font-size: 0.82rem; margin-bottom: 8px; }
        .specs-panel-header { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; cursor: pointer; padding: 6px 8px; border-radius: 10px; background: rgba(255, 255, 255, 0.03); margin-bottom: 10px; }
        .specs-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 14px; }
        .specs-grid > div { min-width: 0; }
        .specs-grid .specs-wide { grid-column: 1 / -1; }
        .specs-grid .field-label { margin-top: 0; }
        .course-assessments-nav { display: flex; width: 100%; padding: 10px 12px; border-radius: 10px; background: rgba(56,189,248,0.08); border: 1px solid rgba(56,189,248,0.35); color: inherit; font: inherit; cursor: pointer; text-align: left; }
        .course-assessments-nav:hover { background: rgba(56,189,248,0.16); }
        .course-assessments-nav.active { background: rgba(56,189,248,0.22); border-color: #38bdf8; }
        .course-assessments-nav-label { font-weight: 800; font-size: 0.85rem; color: #7dd3fc; }
        .course-assessments-nav-sub { font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px; }
        .content-block-item.type-quiz { border-color: rgba(167,139,250,0.45); }
        .notebook-hint { margin-top: 6px; font-size: 0.78rem; color: #fcd34d; }
        .add-block-btn.disabled, .add-block-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .add-block-btn:disabled:hover { background: rgba(255, 255, 255, 0.08); }
        .soon-badge {
          font-size: 0.62rem;
          font-weight: 800;
          text-transform: uppercase;
          background: rgba(148, 163, 184, 0.3);
          border-radius: 4px;
          padding: 0 4px;
        }
        .asmt-type-select {
          border: none;
          cursor: pointer;
          font-family: inherit;
        }
        .asmt-type-select option { color: #0f172a; background: #ffffff; }
        .asmt-meta-grid {
          display: grid;
          grid-template-columns: 160px 160px 1fr;
          gap: 8px;
          margin-top: 8px;
        }
        @media (max-width: 760px) {
          .asmt-meta-grid { grid-template-columns: 1fr 1fr; }
          .asmt-meta-wide { grid-column: 1 / -1; }
        }
        .matrix-empty-cell { color: #64748b; text-align: center; }
        .ai-source-toggle {
          display: inline-flex;
          gap: 4px;
          padding: 4px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.12);
          margin-top: 4px;
        }
        .ai-source-toggle button {
          padding: 6px 14px;
          font-size: 0.82rem;
          background: transparent;
          color: var(--text-secondary);
        }
        .ai-source-toggle button.active {
          background: linear-gradient(135deg, #a855f7, #6366f1);
          color: #ffffff;
        }
      `}</style>
    </div>
  );
}
