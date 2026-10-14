import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  listSiteCourses, saveCourse, newCourseId, setCourseArchived,
  copyCourseForTeacher, listNetworkCourses,
  incrementCourseEnrolments, isDbAvailable, subscribeToSiteCourses
} from './services/lmsRepository';
import { parseCourseSheetWithAI, SAMPLE_SHEET_CSV, DEFAULT_GEMINI_KEY, formatLocalizedDate } from './services/geminiCourseService';
import StudentRegistration from './components/StudentRegistration';
import UserRoleManagementModal from './components/UserRoleManagementModal';
import DonationModal from './components/DonationModal';
import TeacherApplicationPostcard from './components/TeacherApplicationPostcard';
import SuperAdminTokenPanel from './components/SuperAdminTokenPanel';
import AQFCourseBuilder from './components/courseBuilder/AQFCourseBuilder';
import CourseAddPeopleModal from './components/course/CourseAddPeopleModal';
import CourseSubmissionsModal from './components/course/CourseSubmissionsModal';
import TokenFundModal from './components/TokenFundModal';
import MessageDock from './components/messaging/MessageDock';
import StudentLearningPanel from './components/student/StudentLearningPanel';
import { HEADER_MENU_ID, MobileAccountButton, MobileRoleStatus, MobileSignInButton } from './components/HeaderAccountMenu';
import { createBlankCourse, generateEntityId, createBlankUnit } from './types/courseBuilderTypes';
import { confirmCheckoutSession } from './services/stripeService';
import { getUserTokenBalance } from './services/tokenService';
import { subscribeToEnrolledCourses } from './services/enrolledCourses';
import { sendMessage, SUPERADMIN_INBOX } from './services/messageService';
import { formatTokenBalance } from './services/rolePrivileges';
import { ALL_GLOBAL_COURSES } from './services/globalCoursesData';
import {
  signInWithGoogle,
  handleAuthRedirect,
  logoutUser,
  subscribeToAuth,
  resolvePrivileges,
  updateUserToStudentRole
} from './services/authService';
import './App.css';

const IMGBB_API_KEY = import.meta.env.VITE_IMGBB_API_KEY || '';

// Tabs only staff (teachers, admins, Super Admin) can open.
const STAFF_TABS = ['my-courses', 'students'];

async function uploadToImgbb(file) {
  if (!IMGBB_API_KEY) throw new Error('Image uploads are not configured (VITE_IMGBB_API_KEY missing).');
  const formData = new FormData();
  formData.append('image', file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(IMGBB_API_KEY)}`, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success || !data?.data?.url) {
      throw new Error(data?.error?.message || `Upload failed (HTTP ${response.status})`);
    }
    return data.data.url;
  } finally {
    clearTimeout(timer);
  }
}

function App() {
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [isAboutDavidOpen, setIsAboutDavidOpen] = useState(false);
  // Set when "Message the Super Admin" is pressed on the front page: the admin panel opens, then the composer.
  const [pendingSuperadminMessage, setPendingSuperadminMessage] = useState(false);

  // AI Course Import State
  const [isAiImportOpen, setIsAiImportOpen] = useState(false);
  const [sheetText, setSheetText] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiApiKey, setAiApiKey] = useState(DEFAULT_GEMINI_KEY);
  const [showKeyConfig, setShowKeyConfig] = useState(false);

  // Google Auth & Dynamic RBAC state
  const [authUser, setAuthUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [isUserRolesOpen, setIsUserRolesOpen] = useState(false);
  const [isSuperAdminPanelOpen, setIsSuperAdminPanelOpen] = useState(false);
  const [userTokenBalance, setUserTokenBalance] = useState(0);
  const [showFrontPage, setShowFrontPage] = useState(false);
  // Android / iPhone: the role menu opened from the Google button at the top right of the header.
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const accountButtonRef = useRef(null);

  // Student panel: courses this account is enrolled in (found by sign-in email)
  const [enrolledCourses, setEnrolledCourses] = useState([]);
  const [isLoadingEnrolments, setIsLoadingEnrolments] = useState(false);
  const [enrolmentsError, setEnrolmentsError] = useState('');
  const [enrolmentsVersion, setEnrolmentsVersion] = useState(0);

  const privileges = resolvePrivileges(
    userProfile || (authUser ? { email: authUser.email } : null),
    enrolledCourses.length
  );
  const isLoggedIn = !!authUser;
  const tokenBalanceLabel = formatTokenBalance(userTokenBalance, userProfile || (authUser ? { email: authUser.email } : null));

  // Token Fund (sponsor a student / emergency fund) — available after sign-in
  const [isTokenFundOpen, setIsTokenFundOpen] = useState(false);

  // Message board: other panels can ask the dock to start a message
  const messageDockRef = useRef(null);
  const requestCompose = (to, extra = {}) => messageDockRef.current?.compose({ to, ...extra });

  // Teacher tools
  const [submissionsCourse, setSubmissionsCourse] = useState(null);
  const [builderInitialPanel, setBuilderInitialPanel] = useState(null);
  const [globalNotice, setGlobalNotice] = useState(null);

  // Real-time Auth subscription & redirect handler on mount
  useEffect(() => {
    handleAuthRedirect().catch(err => console.warn('Redirect auth notice:', err));
    const unsubscribe = subscribeToAuth((firebaseUser, profile) => {
      setAuthUser(firebaseUser);
      setUserProfile(profile);
      setIsAuthLoading(false);
      if (!firebaseUser) setIsMobileMenuOpen(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (authUser?.uid) {
      getUserTokenBalance(authUser.uid).then(bal => {
        setUserTokenBalance(bal || 0);
      }).catch(err => console.warn('Could not fetch token balance:', err));
    } else {
      setUserTokenBalance(0);
    }
  }, [authUser]);

  const handleSignIn = async () => {
    setAuthError('');
    setIsAuthLoading(true);
    try {
      const res = await signInWithGoogle();
      if (res?.user) {
        setAuthUser(res.user);
        setUserProfile(res.profile);
        setShowFrontPage(false);
      }
    } catch (err) {
      console.error('Google Sign-In failed:', err);
      setAuthError(err?.message || 'Google sign-in could not be completed.');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      setAuthUser(null);
      setUserProfile(null);
      setEditingCourse(null);
      setShowFrontPage(false);
      setEnrolledCourses([]);
      setActiveTab('my-courses');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  // Stripe Donation state
  const [isDonationModalOpen, setIsDonationModalOpen] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState(null);

  // Stripe redirect: the payment is verified on the server, then the Super Admin is notified to
  // credit it (tokens are never added from the browser — that would let anyone mint tokens).
  useEffect(() => {
    if (typeof window === 'undefined' || isAuthLoading) return undefined;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('payment')) return undefined;
    const outcome = params.get('payment');
    const sessionId = params.get('session_id') || '';
    window.history.replaceState({}, document.title, window.location.pathname);
    if (outcome !== 'success' && outcome !== 'cancelled') return undefined;

    let cancelled = false;
    (async () => {
      if (outcome === 'cancelled') {
        setPaymentNotice({ type: 'info', message: 'Stripe checkout was cancelled.' });
        return;
      }
      setPaymentNotice({ type: 'info', message: 'Verifying your payment with Stripe…' });
      let verified;
      try {
        verified = await confirmCheckoutSession(sessionId);
      } catch (err) {
        if (!cancelled) setPaymentNotice({ type: 'info', message: `Thank you! We could not verify the payment automatically (${err.message}). If you were charged, message the Super Admin with your receipt.` });
        return;
      }
      if (cancelled) return;
      if (!verified.paid) {
        setPaymentNotice({ type: 'info', message: 'Stripe has not confirmed this payment yet. If you were charged, message the Super Admin with your receipt.' });
        return;
      }

      const reportedKey = `ozedu_reported_${verified.sessionId}`;
      let alreadyReported = false;
      try {
        alreadyReported = Boolean(localStorage.getItem(reportedKey));
      } catch {
        alreadyReported = false;
      }
      const paid = verified.amountTotal !== null ? `${verified.currency} $${Number(verified.amountTotal).toFixed(2)}` : 'payment';

      let body = '';
      let meta = { stripeSessionId: verified.sessionId, amountPaid: verified.amountTotal, currency: verified.currency };
      let category = 'support';
      let thanks = '';
      if (verified.type === 'token_purchase') {
        category = 'token_request';
        meta = { ...meta, tokensPurchased: verified.tokens, requesterEmail: (authUser?.email || '').toLowerCase(), requesterUid: authUser?.uid || '' };
        body = `Stripe payment received (${paid}) for ${verified.tokens} tokens. Please credit my account.\nSession: ${verified.sessionId}`;
        thanks = `🎉 Payment received for ${verified.tokens} tokens. The Super Admin has been notified and will add them to your balance shortly.`;
      } else if (verified.type === 'student_sponsorship') {
        meta = { ...meta, sponsorshipStudentEmail: verified.studentEmail };
        body = `Stripe payment received (${paid}) to sponsor a year of access for ${verified.studentEmail || 'a student'}.\nSession: ${verified.sessionId}`;
        thanks = `🎉 Thank you for sponsoring ${verified.studentEmail || 'a student'}! The Super Admin has been notified.`;
      } else {
        meta = { ...meta, donationTokens: verified.tokens };
        body = `Stripe donation received (${paid}): ${verified.tokens} tokens for the Emergency Token Fund.\nSession: ${verified.sessionId}`;
        thanks = `🎉 Thank you! Your donation of ${verified.tokens} tokens to the Emergency Token Fund has been received.`;
      }

      if (authUser && !alreadyReported) {
        try {
          await sendMessage({
            sender: authUser,
            senderProfile: userProfile || { email: authUser.email },
            to: SUPERADMIN_INBOX,
            category,
            subject: verified.type === 'token_purchase' ? `Token purchase: ${verified.tokens} tokens` : 'Payment received',
            body,
            meta
          });
          try {
            localStorage.setItem(reportedKey, '1');
          } catch {
            // private mode: the Super Admin may see a duplicate notice, never a duplicate credit
          }
        } catch (err) {
          console.warn('Payment notice to Super Admin failed:', err);
          thanks += ` (Please message the Super Admin with session ${verified.sessionId} — the automatic notice could not be sent.)`;
        }
      } else if (!authUser && verified.type === 'token_purchase') {
        thanks += ' Sign in, then message the Super Admin with your receipt to have the tokens credited.';
      }
      if (!cancelled) setPaymentNotice({ type: 'success', message: thanks });
    })();
    return () => {
      cancelled = true;
    };
  }, [authUser, isAuthLoading, userProfile]);

  const [activeTab, setActiveTab] = useState('my-courses');
  const [searchQuery, setSearchQuery] = useState('');
  const [managingPeopleCourse, setManagingPeopleCourse] = useState(null);

  // While the phone menu is open: Escape closes it (focus back on the Google button), and it
  // closes if the window widens to the desktop layout.
  useEffect(() => {
    if (!isMobileMenuOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      setIsMobileMenuOpen(false);
      accountButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    const desktop = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 769px)') : null;
    const onWidthChange = (e) => {
      if (e.matches) setIsMobileMenuOpen(false);
    };
    desktop?.addEventListener?.('change', onWidthChange);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      desktop?.removeEventListener?.('change', onWidthChange);
    };
  }, [isMobileMenuOpen]);
  
  const [myCourses, setMyCourses] = useState([
    { id: 1, title: 'Introduction to AI', students: 42, startDate: '2026-03-02' },
    { id: 2, title: 'Web Development Bootcamp', students: 118, startDate: '2026-03-16' },
  ]);
  
  const [archivedCourses, setArchivedCourses] = useState([]);
  const [showArchive, setShowArchive] = useState(false);

  useEffect(() => {
    if (!authUser || !userProfile) return;
    if (!privileges.isStaff && STAFF_TABS.includes(activeTab)) setActiveTab('learning');
  }, [authUser, userProfile, privileges.isStaff, activeTab]);

  // Enrolled courses, live: the enrolment list and every enrolled course document are followed, so a
  // teacher's saved changes reach the Student Panel (and "message my teacher") without a reload.
  // Refs keep the listener from restarting when these values change.
  const myCoursesRef = useRef(myCourses);
  const profileRoleRef = useRef(userProfile?.role);
  useEffect(() => {
    myCoursesRef.current = myCourses;
  }, [myCourses]);
  useEffect(() => {
    profileRoleRef.current = userProfile?.role;
  }, [userProfile?.role]);

  useEffect(() => {
    if (!authUser?.email) return undefined;
    let cancelled = false;
    const uid = authUser.uid;
    setIsLoadingEnrolments(true);
    setEnrolmentsError('');

    const unsubscribe = subscribeToEnrolledCourses(
      authUser.email,
      (activeCourses) => {
        if (cancelled) return;
        setEnrolledCourses(activeCourses);
        setEnrolmentsError('');
        setIsLoadingEnrolments(false);

        // If the logged in person has supporter status, upgrade to student as soon as they are enrolled!
        if (activeCourses.length > 0) {
          setUserProfile(prev => {
            if (prev && String(prev.role || '').toLowerCase() === 'supporter') {
              return { ...prev, role: 'student', classification: 'student' };
            }
            return prev;
          });
          if (uid && String(profileRoleRef.current || '').toLowerCase() === 'supporter') {
            updateUserToStudentRole(uid).catch(() => {});
          }
        }
      },
      {
        // Courses created in this browser (not yet saved) still open for their teacher.
        localCourse: (courseId) => myCoursesRef.current.find(c => String(c.id) === String(courseId)) || null,
        onError: (err) => {
          console.warn('Real-time enrolment listener notice:', err);
          if (cancelled) return;
          setEnrolmentsError('Your courses could not be loaded. Check your connection.');
          setIsLoadingEnrolments(false);
        }
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [authUser?.email, authUser?.uid, enrolmentsVersion]);

  // Courses this person may manage: their own (plus unowned legacy courses); the Super Admin sees all.
  const visibleMyCourses = privileges.isSuperadmin
    ? myCourses
    : myCourses.filter(c => !c.authorId || c.authorId === authUser?.uid);

  // Student-visible courses:
  // Registered students (or staff previewing the student panel) see active enrolled courses
  // PLUS courses currently in draft mode created on the platform, so registered students see live updates as teachers start creating courses.
  const studentVisibleCourses = useMemo(() => {
    const map = new Map();

    // 1. If user is a registered student or staff, include draft site courses so they see courses being created in real time
    if (privileges.isStudent || privileges.isStaff || privileges.canViewDraftCourses) {
      for (const c of myCourses) {
        if (!c || !c.id || c.archived) continue;
        const isDraft = Boolean(c.isDraft || c.status === 'draft' || (Array.isArray(c.tags) && c.tags.includes('Draft')));
        if (isDraft) {
          map.set(String(c.id), c);
        }
      }
    }

    // 2. Merge all enrolled courses (which take precedence for student state / submissions)
    for (const c of enrolledCourses) {
      if (!c || !c.id || c.archived) continue;
      const existing = map.get(String(c.id));
      map.set(String(c.id), existing ? { ...existing, ...c } : c);
    }

    return Array.from(map.values());
  }, [myCourses, enrolledCourses, privileges.isStudent, privileges.isStaff, privileges.canViewDraftCourses]);

  // Synchronize courses from Cloud Firestore (lms_courses + unmigrated legacy) on mount and live updates
  useEffect(() => {
    let cancelled = false;
    const loadCourses = async () => {
      if (!isDbAvailable()) return;
      try {
        const { courses } = await listSiteCourses();
        if (cancelled || !courses.length) return;
        const active = courses.filter(c => !c.archived);
        const archived = courses.filter(c => c.archived);
        if (active.length > 0) setMyCourses(active);
        setArchivedCourses(archived);
      } catch (err) {
        console.warn("Firestore sync note:", err);
      }
    };
    loadCourses();

    let unsubscribeCourses = () => {};
    if (isDbAvailable()) {
      try {
        unsubscribeCourses = subscribeToSiteCourses(
          (liveCourses) => {
            if (cancelled || !Array.isArray(liveCourses)) return;
            const active = liveCourses.filter(c => !c.archived);
            if (active.length > 0) {
              setMyCourses(prev => {
                const map = new Map();
                for (const c of prev) {
                  if (c && c.id) map.set(String(c.id), c);
                }
                for (const c of active) {
                  if (c && c.id) map.set(String(c.id), c);
                }
                return Array.from(map.values());
              });
            }
          },
          (err) => {
            console.warn("Real-time site courses listener note:", err?.message || err);
          }
        );
      } catch (err) {
        console.warn("Real-time site courses setup note:", err);
      }
    }

    return () => {
      cancelled = true;
      unsubscribeCourses();
    };
  }, []);

  const handleDeleteCourse = (course) => {
    setMyCourses(prev => prev.filter(c => c.id !== course.id));
    setArchivedCourses(prev => [{ ...course, archived: true, archivedAt: Date.now() }, ...prev]);
    setCourseArchived(course, true).catch(err => console.warn("Archive save note:", err));
  };

  const handleRestoreCourse = (course) => {
    setArchivedCourses(prev => prev.filter(c => c.id !== course.id));
    setMyCourses(prev => [{ ...course, archived: false, archivedAt: undefined }, ...prev]);
    setCourseArchived(course, false).catch(err => console.warn("Restore save note:", err));
  };

  // Receives only NEWLY added course IDs for a student; counts are incremented atomically in Firestore.
  const handleUpdateCourseEnrollments = (enrolledCourseIds) => {
    if (!enrolledCourseIds || !enrolledCourseIds.length) return;
    const ids = enrolledCourseIds.map(String);
    setMyCourses(prev => prev.map(c =>
      ids.includes(String(c.id)) ? { ...c, students: (Number(c.students) || 0) + 1 } : c
    ));
    incrementCourseEnrolments(ids, 1).catch(err => console.warn("Course student update note:", err));
  };
  const [editingCourse, setEditingCourse] = useState(null);
  const [courseModules, setCourseModules] = useState([]);
  const [courseAssessments, setCourseAssessments] = useState([]);
  const [editingDescription, setEditingDescription] = useState('');
  const [editingThumbnail, setEditingThumbnail] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [editingStartDate, setEditingStartDate] = useState('');
  const [editingYear, setEditingYear] = useState('');
  const [editingOutcomes, setEditingOutcomes] = useState('');
  const [editingKnowledge, setEditingKnowledge] = useState('');
  const [isUploadingThumbnail, setIsUploadingThumbnail] = useState(false);
  const [uploadingAssessments, setUploadingAssessments] = useState({});
  const [expandedCards, setExpandedCards] = useState({ info: true, assessments: true, modules: true });

  const toggleCard = (cardName) => {
    setExpandedCards(prev => ({ ...prev, [cardName]: !prev[cardName] }));
  };

  useEffect(() => {
    if (editingCourse) {
      setCourseModules(editingCourse.modules || []);
      setCourseAssessments(editingCourse.assessments || []);
      setEditingDescription(editingCourse.description || '');
      setEditingThumbnail(editingCourse.thumbnail || '');
      setEditingTitle(editingCourse.title || '');
      setEditingStartDate(editingCourse.startDate || new Date().toISOString().split('T')[0]);
      setEditingYear(editingCourse.year || '');
      setEditingOutcomes(editingCourse.outcomes || '');
      setEditingKnowledge(editingCourse.knowledge || '');
    }
  }, [editingCourse]);

  const handleThumbnailUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploadingThumbnail(true);
    try {
      const url = await uploadToImgbb(file);
      setEditingThumbnail(url);
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload thumbnail: ' + error.message);
    } finally {
      setIsUploadingThumbnail(false);
    }
  };

  const handleAssessmentUpload = async (e, id, fieldName) => {
    const file = e.target.files[0];
    if (!file) return;

    const uploadKey = `${id}_${fieldName}`;
    setUploadingAssessments(prev => ({ ...prev, [uploadKey]: true }));

    try {
      const url = await uploadToImgbb(file);
      handleUpdateAssessment(id, fieldName, url);
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Failed to upload file: ' + error.message);
    } finally {
      setUploadingAssessments(prev => ({ ...prev, [uploadKey]: false }));
    }
  };

  const handleAddModule = () => {
    setCourseModules([...courseModules, { 
      id: Date.now(), 
      unitName: '', 
      startDate: editingStartDate || new Date().toISOString().split('T')[0],
      description: '', 
      presentationUrl: '', 
      multipleChoice: '', 
      shortAnswer: '' 
    }]);
  };

  const handleUpdateModule = (id, field, value) => {
    setCourseModules(courseModules.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const handleDeleteModule = (id) => {
    setCourseModules(courseModules.filter(m => m.id !== id));
  };

  const handleAddAssessment = () => {
    setCourseAssessments([...courseAssessments, { 
      id: Date.now(), 
      title: '', 
      dueDate: editingStartDate || new Date().toISOString().split('T')[0],
      description: '', 
      descriptionUrl: '', 
      rubric: '', 
      rubricUrl: '', 
      type: 'essay', 
      typeText: '', 
      typeUrl: '' 
    }]);
  };

  const handleUpdateAssessment = (id, field, value) => {
    setCourseAssessments(courseAssessments.map(a => a.id === id ? { ...a, [field]: value } : a));
  };

  const handleDeleteAssessment = (id) => {
    setCourseAssessments(courseAssessments.filter(a => a.id !== id));
  };

  const handleSaveCourse = async () => {
    const isPub = Boolean(editingCourse.isPublished || editingCourse.status === 'published');
    const cleanTags = isPub
      ? Array.from(new Set([...(Array.isArray(editingCourse.tags) ? editingCourse.tags.filter(t => t.toLowerCase() !== 'draft') : []), 'lms']))
      : Array.from(new Set([...(Array.isArray(editingCourse.tags) ? editingCourse.tags : []), 'lms', 'Draft']));

    const courseData = {
      modules: courseModules,
      assessments: courseAssessments,
      description: editingDescription,
      thumbnail: editingThumbnail,
      title: editingTitle,
      startDate: editingStartDate,
      year: editingYear,
      outcomes: editingOutcomes,
      knowledge: editingKnowledge,
      isDraft: !isPub,
      isPublished: isPub,
      status: isPub ? 'published' : 'draft',
      visibility: isPub ? 'network' : 'site',
      tag: 'lms',
      tags: cleanTags
    };
    setMyCourses(prev => prev.map(c => c.id === editingCourse.id ? { ...c, ...courseData } : c));

    // Persist complete course document to lms_courses (same ID as local state)
    try {
      await saveCourse(editingCourse.id, { ...editingCourse, ...courseData });
      alert(isPub ? 'Course updated successfully!' : 'Course saved as Draft with tag "Draft"!');
    } catch (err) {
      console.warn("Firestore save note:", err);
      alert('Course updated locally, but saving to the cloud failed. Please try again.\n\n' + (err?.message || ''));
    }
  };

  const buildBlankCourse = () => {
    const todayIso = new Date().toISOString().split('T')[0];
    const base = createBlankCourse(authUser?.uid || 'anonymous', authUser?.displayName || 'Educator');
    return {
      ...base,
      authorEmail: (authUser?.email || '').toLowerCase(),
      id: newCourseId(),
      startDate: todayIso,
      students: 0,
      isDraft: true,
      isPublished: false,
      status: 'draft',
      visibility: 'site',
      tag: 'lms',
      tags: ['lms', 'Draft', 'OzEdu', 'AQF']
    };
  };

  const openCourseInBuilder = (newCourse) => {
    setMyCourses(prev => [newCourse, ...prev]);
    setEditingCourse(newCourse);
    setEditingTitle(newCourse.title);
    setEditingStartDate(newCourse.startDate);
    setEditingYear(newCourse.year);
    setEditingDescription('');
    setEditingOutcomes('');
    setEditingKnowledge('');
    setCourseModules([]);
    setCourseAssessments([]);
  };

  const handleCreateBlankCourse = () => {
    const newCourse = buildBlankCourse();
    openCourseInBuilder(newCourse);
  };

  const handleUploadSheetClick = () => {
    const newCourse = buildBlankCourse();
    setBuilderInitialPanel('spreadsheet');
    openCourseInBuilder(newCourse);
  };



  const handleSheetFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setSheetText(event.target.result || '');
      setAiError('');
    };
    reader.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([SAMPLE_SHEET_CSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'OzEdu_Course_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleLoadSample = () => {
    setSheetText(SAMPLE_SHEET_CSV);
    setAiError('');
  };

  const handleGenerateCourseWithAI = async () => {
    if (!sheetText.trim()) {
      alert('Please upload a Google Sheet file or paste spreadsheet data first.');
      return;
    }

    setIsAiProcessing(true);
    setAiError('');

    try {
      const parsed = await parseCourseSheetWithAI(sheetText, aiApiKey);

      if (editingCourse) {
        // If already in Course Builder, update current course fields
        if (parsed.title) setEditingTitle(parsed.title);
        if (parsed.startDate) setEditingStartDate(parsed.startDate);
        if (parsed.year) setEditingYear(parsed.year);
        if (parsed.description) setEditingDescription(parsed.description);
        if (parsed.outcomes) setEditingOutcomes(parsed.outcomes);
        if (parsed.knowledge) setEditingKnowledge(parsed.knowledge);
        if (parsed.modules?.length) setCourseModules(parsed.modules);
        if (parsed.assessments?.length) setCourseAssessments(parsed.assessments);

        const updatedTitle = parsed.title || editingTitle || editingCourse.title;
        const mergedCourse = {
          ...editingCourse,
          title: updatedTitle,
          startDate: parsed.startDate || editingStartDate || editingCourse.startDate,
          year: parsed.year || editingYear || editingCourse.year,
          description: parsed.description || editingDescription,
          outcomes: parsed.outcomes || editingOutcomes,
          knowledge: parsed.knowledge || editingKnowledge,
          thumbnail: editingThumbnail,
          modules: parsed.modules?.length ? parsed.modules : courseModules,
          assessments: parsed.assessments?.length ? parsed.assessments : courseAssessments
        };
        setMyCourses(prev => prev.map(c => c.id === editingCourse.id ? { ...c, ...mergedCourse } : c));

        // Persist the full AI-generated content so it survives a reload
        saveCourse(editingCourse.id, mergedCourse).catch(err => console.warn("AI import save note:", err));

        setIsAiImportOpen(false);
        setSheetText('');
        alert(`Course "${updatedTitle}" updated with AI!\n\n• ${parsed.modules?.length || 0} Modules loaded\n• ${parsed.assessments?.length || 0} Assessments loaded\n\nYou can now review the details and complete any missing information manually.`);
      } else {
        // Creating brand new course from My Courses
        const newCourse = {
          id: newCourseId(),
          title: parsed.title || 'Untitled Course',
          startDate: parsed.startDate || new Date().toISOString().split('T')[0],
          year: parsed.year || '2026 Semester 1',
          description: parsed.description || '',
          outcomes: parsed.outcomes || '',
          knowledge: parsed.knowledge || '',
          thumbnail: '',
          modules: parsed.modules || [],
          assessments: parsed.assessments || [],
          students: 0,
          createdAt: Date.now()
        };

        setMyCourses([newCourse, ...myCourses]);
        setEditingCourse(newCourse);
        setEditingStartDate(newCourse.startDate);
        setIsAiImportOpen(false);
        setSheetText('');

        saveCourse(newCourse.id, newCourse, { isNew: true }).catch(error => {
          console.error("Error adding course to Firebase: ", error);
        });

        alert(`Course "${newCourse.title}" created with AI!\n\n• ${newCourse.modules.length} Modules parsed\n• ${newCourse.assessments.length} Assessments parsed\n\nYou can now review and complete any missing information manually.`);
      }
    } catch (err) {
      console.error('AI generation error:', err);
      setAiError(err.message || 'Error parsing sheet with AI.');
    } finally {
      setIsAiProcessing(false);
    }
  };

  
  const [uploadedImages, setUploadedImages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const url = await uploadToImgbb(file);
      setUploadedImages(prev => [url, ...prev]);
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };
  
  // Global Course Search State (4 across × 6 rows = 24 courses per page)
  const [globalPage, setGlobalPage] = useState(1);
  const [globalCategory, setGlobalCategory] = useState('ALL');
  const COURSES_PER_PAGE = 24;

  const [copyingCourseIds, setCopyingCourseIds] = useState({});

  // Published courses from every OzEdu teacher (shown first in Global Search).
  const [networkCourses, setNetworkCourses] = useState([]);
  const [isLoadingNetwork, setIsLoadingNetwork] = useState(false);
  const [networkError, setNetworkError] = useState('');
  const [networkLoadedAt, setNetworkLoadedAt] = useState(0);

  const loadNetworkCourses = async () => {
    if (!isDbAvailable()) {
      setNetworkError('Published OzEdu courses could not be loaded right now.');
      return;
    }
    setIsLoadingNetwork(true);
    setNetworkError('');
    try {
      const list = await listNetworkCourses();
      setNetworkCourses(list.filter(c => !c.archived));
      setNetworkLoadedAt(Date.now());
    } catch (err) {
      console.warn('Published courses could not be loaded:', err);
      setNetworkError('Published OzEdu courses could not be loaded right now.');
    } finally {
      setIsLoadingNetwork(false);
    }
  };

  const openGlobalSearch = () => {
    setActiveTab('global');
    if (Date.now() - networkLoadedAt > 60000) loadNetworkCourses();
  };

  const isCopiedByMe = (course) => myCourses.some(c =>
    String(c.sourceCourseId) === String(course.id) && (!c.authorId || c.authorId === authUser?.uid)
  ) || String(course.authorId || '') === String(authUser?.uid || '_');

  // Global Search -> a private Draft copy for this teacher; /course_copies records teacher, copy and date.
  const handleCopyCourse = async (course) => {
    const key = String(course.id);
    if (copyingCourseIds[key] || isCopiedByMe(course)) return;

    setCopyingCourseIds(prev => ({ ...prev, [key]: true }));
    try {
      const { course: copied } = await copyCourseForTeacher(course, authUser);
      setMyCourses(prev => [copied, ...prev]);
      setGlobalNotice({ type: 'success', message: `📋 "${copied.title}" was copied to My Courses as a private Draft. The copy, your name and the date were recorded.` });
    } catch (err) {
      console.warn("Course copy save note:", err);
      setGlobalNotice({ type: 'error', message: `The course could not be copied: ${err.message || 'please try again'}.` });
    } finally {
      setCopyingCourseIds(prev => ({ ...prev, [key]: false }));
    }
  };

  const networkQuery = searchQuery.toLowerCase().trim();
  const filteredNetworkCourses = networkCourses.filter(c => {
    const matchesSearch = !networkQuery ||
      String(c.title || '').toLowerCase().includes(networkQuery) ||
      String(c.authorName || '').toLowerCase().includes(networkQuery) ||
      String(c.category || '').toLowerCase().includes(networkQuery) ||
      String(c.code || '').toLowerCase().includes(networkQuery);
    const matchesCategory = globalCategory === 'ALL' || c.category === globalCategory;
    return matchesSearch && matchesCategory;
  });

  const filteredGlobalCourses = ALL_GLOBAL_COURSES.filter(c => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q || 
      c.title.toLowerCase().includes(q) || 
      (c.author && c.author.toLowerCase().includes(q)) || 
      (c.category && c.category.toLowerCase().includes(q));
    const matchesCategory = globalCategory === 'ALL' || c.category === globalCategory;
    return matchesSearch && matchesCategory;
  });

  const totalGlobalPages = Math.ceil(filteredGlobalCourses.length / COURSES_PER_PAGE) || 1;
  const currentGlobalPage = Math.min(Math.max(globalPage, 1), totalGlobalPages);
  const paginatedGlobalCourses = filteredGlobalCourses.slice(
    (currentGlobalPage - 1) * COURSES_PER_PAGE,
    currentGlobalPage * COURSES_PER_PAGE
  );

  const globalCategoriesList = Array.from(new Set(ALL_GLOBAL_COURSES.map(c => c.category).filter(Boolean)));

  // Contact: signed-in people go to their admin panel and message the Super Admin there.
  const handleContactMessageSuperadmin = () => {
    setIsContactOpen(false);
    setShowFrontPage(false);
    setPendingSuperadminMessage(true);
  };

  useEffect(() => {
    if (!pendingSuperadminMessage || showFrontPage || !authUser) return undefined;
    // Wait one tick for the admin panel (and its message dock) to mount.
    const timer = setTimeout(() => {
      requestCompose(SUPERADMIN_INBOX);
      setPendingSuperadminMessage(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingSuperadminMessage, showFrontPage, authUser]);
  const cards = [
    {
      title: "Mission & Ecosystem",
      icon: "🌍",
      content: "OzEdu bridges world-class tertiary education to under-resourced classrooms via a lightweight, mobile-responsive architecture. Easily embed modules into Google Workspace, Classroom, and Calendar using simple snippets."
    },
    {
      title: "Autonomous AI Layer",
      icon: "🤖",
      content: "An always-on academic concierge guides learners with localized, plain-language explanations. Real-time telemetry automates credential triage and event RSVPs with near-zero administrative overhead."
    },
    {
      title: "Economic Architecture",
      icon: "💡",
      content: "Our system utilizes the TokenPulse Community Emergency Fund for transparent funding students. Remote students access metropolitan-quality academics via Australian university integrations and more."
    },
    {
      title: "Self-Sustaining Model",
      icon: "⚙️",
      content: "Local Southeast Asian students are trained to maintain the system APIs. The LMS becomes a living technical classroom, providing verified industry experience and community resilience."
    }
  ];

  const renderAiModal = () => (
    <div className="modal-overlay" onClick={() => !isAiProcessing && setIsAiImportOpen(false)}>
      <div className="glass modal-content ai-modal-content animate-fade-in-up" onClick={e => e.stopPropagation()}>
        <button className="close-btn" disabled={isAiProcessing} onClick={() => setIsAiImportOpen(false)}>✕</button>
        
        <div style={{display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap'}}>
          <h2 style={{margin: 0, textAlign: 'left'}}>Import Course from Google Sheet</h2>
          <span className="ai-badge">🤖 Gemini 3.8 Flash AI</span>
        </div>
        
        <p style={{color: 'var(--text-secondary)', fontSize: '0.95rem', margin: '0 0 20px 0', lineHeight: '1.5'}}>
          Upload an exported Google Sheet (.csv, .xlsx, .tsv) or paste your course data. AI automatically builds the complete course syllabus, learning outcomes, weekly modules with lecture descriptions, quizzes, and assessment rubrics. Teachers can review and manually adjust any details.
        </p>

        {/* Quick Actions & Templates */}
        <div style={{display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap'}}>
          <button 
            type="button" 
            className="nav-btn secondary" 
            style={{padding: '6px 14px', fontSize: '0.85rem'}}
            onClick={handleDownloadTemplate}
          >
            📥 Download CSV Template
          </button>
          <button 
            type="button" 
            className="nav-btn secondary" 
            style={{padding: '6px 14px', fontSize: '0.85rem', borderColor: 'rgba(250, 204, 21, 0.4)'}}
            onClick={handleLoadSample}
          >
            📋 Load Example Course (Marine Biology)
          </button>
        </div>

        {/* File Upload Dropzone */}
        <label className="sheet-dropzone" style={{display: 'block', marginBottom: '16px'}}>
          <div style={{fontSize: '2rem', marginBottom: '8px'}}>📊</div>
          <div style={{fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px'}}>
            Click to upload Google Sheet (.csv, .xlsx, .tsv, .txt)
          </div>
          <div style={{fontSize: '0.85rem', color: 'var(--text-secondary)'}}>
            Export from Google Sheets: <em>File → Download → Comma Separated Values (.csv)</em>
          </div>
          <input 
            type="file" 
            accept=".csv,.tsv,.xlsx,.txt" 
            style={{display: 'none'}} 
            onChange={handleSheetFileUpload} 
            disabled={isAiProcessing}
          />
        </label>

        {/* Direct Paste Textarea */}
        <label style={{fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px'}}>
          Or Paste Spreadsheet Data (select cells in Google Sheets, copy & paste here):
        </label>
        <textarea 
          placeholder="Paste table or CSV content here (Course Title, Modules, Lecture content, Quizzes, Rubrics)..." 
          className="form-input" 
          style={{
            width: '100%', 
            minHeight: '140px', 
            fontFamily: 'monospace', 
            fontSize: '0.85rem', 
            marginBottom: '16px',
            background: 'rgba(0,0,0,0.35)'
          }}
          value={sheetText}
          onChange={(e) => setSheetText(e.target.value)}
          disabled={isAiProcessing}
        ></textarea>

        {/* Gemini API Info and Configuration toggle */}
        <div style={{background: 'rgba(0,0,0,0.25)', padding: '14px 18px', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.1)'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <span style={{fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px'}}>
              🔑 Gemini API Key
            </span>
            <button 
              type="button" 
              className="nav-btn secondary" 
              style={{padding: '6px 14px', fontSize: '0.85rem', cursor: 'pointer'}}
              onClick={() => setShowKeyConfig(!showKeyConfig)}
            >
              ⚙️ {showKeyConfig ? 'Hide Settings' : 'API Key Settings'}
            </button>
          </div>
          {showKeyConfig && (
            <div style={{marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)'}}>
              <label style={{fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px'}}>
                Gemini API Key (Google Cloud AI Platform):
              </label>
              <div style={{display: 'flex', gap: '8px'}}>
                <input 
                  type="text" 
                  placeholder="Enter Gemini API Key..." 
                  className="form-input" 
                  style={{flex: 1, fontSize: '0.9rem', padding: '10px 14px', fontFamily: 'monospace'}}
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                />
              </div>
              <small style={{color: 'var(--text-secondary)', display: 'block', marginTop: '6px'}}>
                Default key from project <code style={{color: '#34d399'}}>gen-lang-client-0551298781</code> is configured. You can update this key anytime.
              </small>
            </div>
          )}
        </div>

        {/* Processing State */}
        {isAiProcessing && (
          <div style={{textAlign: 'center', padding: '20px 0'}}>
            <div className="ai-spinner"></div>
            <h4 style={{margin: '0 0 6px 0', color: 'var(--text-primary)'}}>Gemini AI is parsing course...</h4>
            <p style={{margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)'}}>
              Auto-filling Course Information, Modules, Lecture notes, Assessments, and Quizzes.
            </p>
          </div>
        )}

        {aiError && (
          <div style={{background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '10px', padding: '12px', marginBottom: '16px', color: '#fca5a5', fontSize: '0.9rem'}}>
            <strong>Note:</strong> {aiError}
          </div>
        )}

        {/* Action Buttons */}
        {!isAiProcessing && (
          <div style={{display: 'flex', gap: '12px', justifyContent: 'flex-end'}}>
            <button 
              type="button" 
              className="nav-btn secondary" 
              onClick={() => setIsAiImportOpen(false)}
            >
              Cancel
            </button>
            <button 
              type="button" 
              className="nav-btn primary" 
              style={{padding: '12px 24px', fontSize: '1rem', fontWeight: '700', minWidth: '220px'}}
              onClick={handleGenerateCourseWithAI}
              disabled={!sheetText.trim()}
            >
              ⚡ Auto-Fill Course with AI
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (isLoggedIn && !showFrontPage) {
    if (editingCourse) {
      const normalizedCourse = {
        ...editingCourse,
        aqfLevel: editingCourse.aqfLevel !== undefined ? editingCourse.aqfLevel : 0,
        units: Array.isArray(editingCourse.units) ? editingCourse.units : (
          editingCourse.modules?.length ? editingCourse.modules.map((m, mIdx) => ({
            id: m.id || generateEntityId('unit'),
            unitCode: m.code || `UNIT-${mIdx + 1}01`,
            unitTitle: m.unitName || m.title || `Unit ${mIdx + 1}`,
            nominalHours: m.nominalHours !== undefined && m.nominalHours !== null ? m.nominalHours : '',
            description: m.description || '',
            learningOutcomes: [],
            content: '',
            blocks: []
          })) : []
        ),
        // One Assessments & Rubrics section per course (never copied into each unit).
        assessments: Array.isArray(editingCourse.assessments) ? editingCourse.assessments : []
      };

      return (
        <div className="app-container">
          <div className="background-shapes">
            <div className="shape shape-1"></div>
            <div className="shape shape-2"></div>
            <div className="shape shape-3"></div>
          </div>
          <main className="main-content animate-fade-in-up" style={{ padding: '16px 20px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
            <AQFCourseBuilder
              course={normalizedCourse}
              initialPanel={builderInitialPanel}
              onSaveCourse={async (updated) => {
                // Legacy courses without an owner are claimed by the teacher who saves them.
                const owned = !updated.authorId && authUser?.uid && !privileges.isSuperadmin
                  ? { ...updated, authorId: authUser.uid, authorName: authUser.displayName || '', authorEmail: (authUser.email || '').toLowerCase() }
                  : updated;
                setMyCourses(prev => {
                  const exists = prev.some(c => String(c.id) === String(owned.id));
                  return exists ? prev.map(c => String(c.id) === String(owned.id) ? owned : c) : [owned, ...prev];
                });
                setEditingCourse(owned);
                await saveCourse(owned.id, owned);
              }}
              onBack={() => {
                setEditingCourse(null);
                setBuilderInitialPanel(null);
              }}
              currentUser={authUser}
              userProfile={userProfile}
              userTokenBalance={userTokenBalance}
              onRefreshBalance={() => {
                if (authUser?.uid) {
                  getUserTokenBalance(authUser.uid).then(bal => setUserTokenBalance(bal || 0));
                }
              }}
            />
            <div className="message-dock-spacer" aria-hidden="true" />
          </main>
          <MessageDock
            currentUser={authUser}
            userProfile={userProfile}
            teachingCourses={visibleMyCourses}
            enrolledCourses={enrolledCourses}
            networkCourses={networkCourses}
            ref={messageDockRef}
            onBalanceChanged={() => authUser?.uid && getUserTokenBalance(authUser.uid).then(bal => setUserTokenBalance(bal || 0))}
          />
        </div>
      );
    }

    if (false && editingCourse) {
      return (
        <div className="app-container">
          <div className="background-shapes">
            <div className="shape shape-1"></div>
            <div className="shape shape-2"></div>
            <div className="shape shape-3"></div>
          </div>
          <header className="glass header animate-fade-in">
            <button className="logo-btn" onClick={() => { setEditingCourse(null); setShowFrontPage(true); }} title="Go to Front Page">
              <h1>OzEdu Admin</h1>
            </button>
            <nav style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button className="nav-btn secondary" onClick={() => setEditingCourse(null)}>Back to My Courses</button>
              <button className="nav-btn secondary" onClick={handleLogout}>Logout</button>
            </nav>
          </header>
          <main className="main-content animate-fade-in-up">
            <div className="admin-section" style={{maxWidth: '800px', margin: '0 auto', width: '100%'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '20px', flexWrap: 'wrap', gap: '12px'}}>
                <h2 className="section-title" style={{margin: 0}}>Course Builder: {editingTitle || editingCourse.title}</h2>
                <button 
                  className="nav-btn primary" 
                  style={{display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem', padding: '10px 18px', fontWeight: 'bold'}}
                  onClick={() => { setAiError(''); setIsAiImportOpen(true); }}
                >
                  ⚡ AI Fill from Google Sheet
                </button>
              </div>
              <div className="glass card" style={{width: '100%', marginBottom: '24px'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'}} onClick={() => toggleCard('info')}>
                  <h3 style={{margin: 0}}>Course Info</h3>
                  <button className="nav-btn secondary" style={{padding: '4px 12px', fontSize: '1.2rem', background: 'transparent', border: 'none', color: 'var(--text-secondary)'}}>
                    {expandedCards.info ? '−' : '+'}
                  </button>
                </div>
                {expandedCards.info && (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px'}}>
                  <input 
                    type="text" 
                    placeholder="Course Title" 
                    className="form-input" 
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                  />
                  <div>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px'}}>
                      <label style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Course Start Date (ISO 8601)</label>
                      {editingStartDate && (
                        <span style={{color: 'var(--accent-hover)', fontWeight: '600', fontSize: '0.85rem'}}>
                          📅 Localized: {formatLocalizedDate(editingStartDate)}
                        </span>
                      )}
                    </div>
                    <input 
                      type="date" 
                      className="form-input" 
                      style={{width: '100%', appearance: 'auto', backgroundColor: '#0f291e'}}
                      value={editingStartDate}
                      onChange={(e) => setEditingStartDate(e.target.value)}
                    />
                  </div>
                  <input 
                    type="text" 
                    placeholder="Course Year / Semester (e.g., 2026 Semester 1)" 
                    className="form-input" 
                    value={editingYear}
                    onChange={(e) => setEditingYear(e.target.value)}
                  />
                  <textarea 
                    placeholder="Course Description..." 
                    className="form-input" 
                    style={{resize: 'vertical', minHeight: '80px'}}
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                  ></textarea>
                  <textarea 
                    placeholder="Learning Outcomes..." 
                    className="form-input" 
                    style={{resize: 'vertical', minHeight: '80px'}}
                    value={editingOutcomes}
                    onChange={(e) => setEditingOutcomes(e.target.value)}
                  ></textarea>
                  <textarea 
                    placeholder="Assumed Knowledge..." 
                    className="form-input" 
                    style={{resize: 'vertical', minHeight: '80px'}}
                    value={editingKnowledge}
                    onChange={(e) => setEditingKnowledge(e.target.value)}
                  ></textarea>

                  <div style={{display: 'flex', gap: '12px', alignItems: 'center'}}>
                    <input 
                      type="text" 
                      placeholder="Thumbnail Image URL..." 
                      className="form-input" 
                      style={{flex: 1}}
                      value={editingThumbnail}
                      onChange={(e) => setEditingThumbnail(e.target.value)}
                    />
                    <span style={{color: 'var(--text-secondary)'}}>OR</span>
                    <label className="upload-btn" style={{cursor: isUploadingThumbnail ? 'not-allowed' : 'pointer', opacity: isUploadingThumbnail ? 0.7 : 1, margin: 0}}>
                      {isUploadingThumbnail ? 'Uploading...' : 'Upload Image'}
                      <input 
                        type="file" 
                        accept="image/*" 
                        style={{display: 'none'}} 
                        onChange={handleThumbnailUpload}
                        disabled={isUploadingThumbnail}
                      />
                    </label>
                  </div>
                  
                  <button className="nav-btn primary" style={{alignSelf: 'flex-start'}} onClick={handleSaveCourse}>Save Course Info</button>
                </div>
                )}
              </div>
              
              <div className="glass card" style={{width: '100%', marginBottom: '24px'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'}} onClick={() => toggleCard('assessments')}>
                  <h3 style={{margin: 0}}>Course Assessments</h3>
                  <button className="nav-btn secondary" style={{padding: '4px 12px', fontSize: '1.2rem', background: 'transparent', border: 'none', color: 'var(--text-secondary)'}}>
                    {expandedCards.assessments ? '−' : '+'}
                  </button>
                </div>
                
                {expandedCards.assessments && (
                  <>
                {courseAssessments.length === 0 ? (
                  <p style={{margin: '16px 0', color: 'var(--text-secondary)'}}>No assessments added yet.</p>
                ) : (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px'}}>
                    {courseAssessments.map((assmnt, index) => (
                      <div key={assmnt.id} style={{background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center'}}>
                          <h4 style={{margin: 0}}>Assessment {index + 1}</h4>
                          <button className="nav-btn secondary" style={{padding: '4px 12px', fontSize: '0.8rem'}} onClick={() => handleDeleteAssessment(assmnt.id)}>Remove</button>
                        </div>
                        
                        <label style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Assessment Title</label>
                        <input type="text" placeholder="Title" className="form-input" style={{marginBottom: '12px'}} value={assmnt.title || ''} onChange={(e) => handleUpdateAssessment(assmnt.id, 'title', e.target.value)} />
                        
                        <div style={{marginBottom: '12px'}}>
                          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px'}}>
                            <label style={{fontSize: '0.85rem', color: 'var(--text-secondary)'}}>Due Date (ISO 8601)</label>
                            {assmnt.dueDate && (
                              <span style={{color: 'var(--accent-hover)', fontWeight: '600', fontSize: '0.85rem'}}>
                                📅 Localized: {formatLocalizedDate(assmnt.dueDate)}
                              </span>
                            )}
                          </div>
                          <input 
                            type="date" 
                            className="form-input" 
                            style={{width: '100%', appearance: 'auto', backgroundColor: '#0f291e'}} 
                            value={assmnt.dueDate || ''} 
                            onChange={(e) => handleUpdateAssessment(assmnt.id, 'dueDate', e.target.value)} 
                          />
                        </div>
                        
                        <label style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Assessment Description</label>
                        <textarea placeholder="Text description..." className="form-input" style={{resize: 'vertical', minHeight: '60px', marginBottom: '8px'}} value={assmnt.description || ''} onChange={(e) => handleUpdateAssessment(assmnt.id, 'description', e.target.value)}></textarea>
                        <div style={{display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px'}}>
                          <input type="text" placeholder="Description File URL (optional)..." className="form-input" style={{flex: 1}} value={assmnt.descriptionUrl || ''} onChange={(e) => handleUpdateAssessment(assmnt.id, 'descriptionUrl', e.target.value)} />
                          <span style={{color: 'var(--text-secondary)'}}>OR</span>
                          <label className="upload-btn" style={{cursor: uploadingAssessments[`${assmnt.id}_descriptionUrl`] ? 'not-allowed' : 'pointer', opacity: uploadingAssessments[`${assmnt.id}_descriptionUrl`] ? 0.7 : 1, margin: 0}}>
                            {uploadingAssessments[`${assmnt.id}_descriptionUrl`] ? 'Uploading...' : 'Upload File'}
                            <input type="file" style={{display: 'none'}} onChange={(e) => handleAssessmentUpload(e, assmnt.id, 'descriptionUrl')} disabled={uploadingAssessments[`${assmnt.id}_descriptionUrl`]} />
                          </label>
                        </div>
                        
                        <label style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Rubric</label>
                        <textarea placeholder="Rubric details..." className="form-input" style={{resize: 'vertical', minHeight: '60px', marginBottom: '8px'}} value={assmnt.rubric || ''} onChange={(e) => handleUpdateAssessment(assmnt.id, 'rubric', e.target.value)}></textarea>
                        <div style={{display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '24px'}}>
                          <input type="text" placeholder="Rubric File URL (optional)..." className="form-input" style={{flex: 1}} value={assmnt.rubricUrl || ''} onChange={(e) => handleUpdateAssessment(assmnt.id, 'rubricUrl', e.target.value)} />
                          <span style={{color: 'var(--text-secondary)'}}>OR</span>
                          <label className="upload-btn" style={{cursor: uploadingAssessments[`${assmnt.id}_rubricUrl`] ? 'not-allowed' : 'pointer', opacity: uploadingAssessments[`${assmnt.id}_rubricUrl`] ? 0.7 : 1, margin: 0}}>
                            {uploadingAssessments[`${assmnt.id}_rubricUrl`] ? 'Uploading...' : 'Upload File'}
                            <input type="file" style={{display: 'none'}} onChange={(e) => handleAssessmentUpload(e, assmnt.id, 'rubricUrl')} disabled={uploadingAssessments[`${assmnt.id}_rubricUrl`]} />
                          </label>
                        </div>
                        
                        <label style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Type of Assessment</label>
                        <select className="form-input" style={{marginBottom: '12px', appearance: 'auto', backgroundColor: '#0f291e'}} value={assmnt.type || 'essay'} onChange={(e) => handleUpdateAssessment(assmnt.id, 'type', e.target.value)}>
                          <option value="essay">Essay</option>
                          <option value="multipleChoice">Multiple Choice</option>
                          <option value="shortAnswer">Short Answer questions</option>
                          <option value="exam">Exam</option>
                        </select>
                        
                        <label style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>{assmnt.type === 'essay' ? 'Essay Details' : assmnt.type === 'multipleChoice' ? 'Multiple Choice Details' : assmnt.type === 'shortAnswer' ? 'Short Answer Details' : 'Exam Details'}</label>
                        
                        {assmnt.type === 'multipleChoice' && (
                          <p style={{fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px', background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', fontStyle: 'italic', lineHeight: '1.4'}}>
                            <strong>Format requirement:</strong><br />
                            1. What is the capital of France?<br />
                            Choices: A. Denmark B. Africa C. Guinea D. Sydney E. Paris. Correct: Paris
                          </p>
                        )}
                        {assmnt.type === 'shortAnswer' && (
                          <p style={{fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px', background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', fontStyle: 'italic', lineHeight: '1.4'}}>
                            <strong>Format requirement:</strong><br />
                            Question: Where is Paris Located?<br />
                            Sample: Paris is located in north-central France along the Seine River.<br />
                            Sample Answer: It is situated in Western Europe.
                          </p>
                        )}
                        
                        <textarea placeholder="Enter questions or details here..." className="form-input" style={{resize: 'vertical', minHeight: '80px', marginBottom: '8px'}} value={assmnt.typeText || ''} onChange={(e) => handleUpdateAssessment(assmnt.id, 'typeText', e.target.value)}></textarea>
                        <div style={{display: 'flex', gap: '12px', alignItems: 'center'}}>
                          <input type="text" placeholder="Attachment/File URL (optional)..." className="form-input" style={{flex: 1}} value={assmnt.typeUrl || ''} onChange={(e) => handleUpdateAssessment(assmnt.id, 'typeUrl', e.target.value)} />
                          <span style={{color: 'var(--text-secondary)'}}>OR</span>
                          <label className="upload-btn" style={{cursor: uploadingAssessments[`${assmnt.id}_typeUrl`] ? 'not-allowed' : 'pointer', opacity: uploadingAssessments[`${assmnt.id}_typeUrl`] ? 0.7 : 1, margin: 0}}>
                            {uploadingAssessments[`${assmnt.id}_typeUrl`] ? 'Uploading...' : 'Upload File'}
                            <input type="file" style={{display: 'none'}} onChange={(e) => handleAssessmentUpload(e, assmnt.id, 'typeUrl')} disabled={uploadingAssessments[`${assmnt.id}_typeUrl`]} />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div style={{marginTop: '24px', display: 'flex', justifyContent: 'space-between'}}>
                  <button className="nav-btn secondary" onClick={handleAddAssessment}>+ Add Assessment</button>
                  <button className="nav-btn primary" onClick={handleSaveCourse}>Save Course Info</button>
                </div>
                  </>
                )}
              </div>

              <div className="glass card" style={{width: '100%'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'}} onClick={() => toggleCard('modules')}>
                  <h3 style={{margin: 0}}>Course Modules</h3>
                  <button className="nav-btn secondary" style={{padding: '4px 12px', fontSize: '1.2rem', background: 'transparent', border: 'none', color: 'var(--text-secondary)'}}>
                    {expandedCards.modules ? '−' : '+'}
                  </button>
                </div>
                
                {expandedCards.modules && (
                  <>
                {courseModules.length === 0 ? (
                  <p style={{margin: '16px 0', color: 'var(--text-secondary)'}}>No modules added yet.</p>
                ) : (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px'}}>
                    {courseModules.map((mod, index) => (
                      <div key={mod.id} style={{background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center'}}>
                          <h4 style={{margin: 0}}>Module {index + 1}</h4>
                          <button className="nav-btn secondary" style={{padding: '4px 12px', fontSize: '0.8rem'}} onClick={() => handleDeleteModule(mod.id)}>Remove</button>
                        </div>
                        
                        <label style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Unit / Week Number</label>
                        <input type="text" placeholder="e.g., Week 1, Module 1, or Unit 1" className="form-input" style={{marginBottom: '12px'}} value={mod.unitName || ''} onChange={(e) => handleUpdateModule(mod.id, 'unitName', e.target.value)} />
                        
                        <div style={{marginBottom: '12px'}}>
                          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px'}}>
                            <label style={{fontSize: '0.85rem', color: 'var(--text-secondary)'}}>Module Start Date (ISO 8601)</label>
                            {mod.startDate && (
                              <span style={{color: 'var(--accent-hover)', fontWeight: '600', fontSize: '0.85rem'}}>
                                📅 Localized: {formatLocalizedDate(mod.startDate)}
                              </span>
                            )}
                          </div>
                          <input 
                            type="date" 
                            className="form-input" 
                            style={{width: '100%', appearance: 'auto', backgroundColor: '#0f291e'}} 
                            value={mod.startDate || ''} 
                            onChange={(e) => handleUpdateModule(mod.id, 'startDate', e.target.value)} 
                          />
                        </div>
                        
                        <label style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Description / Lecture</label>
                        <textarea placeholder="Write the lecture content or description here..." className="form-input" style={{resize: 'vertical', minHeight: '80px', marginBottom: '12px'}} value={mod.description || ''} onChange={(e) => handleUpdateModule(mod.id, 'description', e.target.value)}></textarea>
                        
                        <label style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Presentation URL</label>
                        <input type="url" placeholder="Link to slides or presentation..." className="form-input" style={{marginBottom: '24px'}} value={mod.presentationUrl || ''} onChange={(e) => handleUpdateModule(mod.id, 'presentationUrl', e.target.value)} />
                        
                        <h5 style={{marginTop: '16px', marginBottom: '8px', color: 'var(--accent-color)'}}>Multiple Choice Exam (Optional)</h5>
                        <p style={{fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px', background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', fontStyle: 'italic', lineHeight: '1.4'}}>
                          <strong>Format requirement:</strong><br />
                          1. What is the capital of France?<br />
                          Choices: A. Denmark B. Africa C. Guinea D. Sydney E. Paris. Correct: Paris
                        </p>
                        <textarea placeholder="Paste multiple choice questions using the required format..." className="form-input" style={{resize: 'vertical', minHeight: '100px', marginBottom: '24px'}} value={mod.multipleChoice || ''} onChange={(e) => handleUpdateModule(mod.id, 'multipleChoice', e.target.value)}></textarea>
                        
                        <h5 style={{marginTop: '16px', marginBottom: '8px', color: 'var(--accent-color)'}}>Short Answer Quiz (Optional)</h5>
                        <p style={{fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px', background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', fontStyle: 'italic', lineHeight: '1.4'}}>
                          <strong>Format requirement:</strong><br />
                          Question: Where is Paris Located?<br />
                          Sample: Paris is located in north-central France along the Seine River.<br />
                          Sample Answer: It is situated in Western Europe.
                        </p>
                        <textarea placeholder="Paste short answer questions using the required format..." className="form-input" style={{resize: 'vertical', minHeight: '100px', marginBottom: '12px'}} value={mod.shortAnswer || ''} onChange={(e) => handleUpdateModule(mod.id, 'shortAnswer', e.target.value)}></textarea>
                      </div>
                    ))}
                  </div>
                )}
                
                <div style={{marginTop: '24px', display: 'flex', justifyContent: 'space-between'}}>
                  <button className="nav-btn secondary" onClick={handleAddModule}>+ Add Module</button>
                  <button className="nav-btn primary" onClick={handleSaveCourse}>Save Course</button>
                </div>
                  </>
                )}
              </div>
              
              <div className="glass card" style={{width: '100%', marginTop: '24px', border: '1px solid rgba(52, 211, 153, 0.4)'}}>
                <h3 style={{color: 'var(--accent-hover)', marginTop: 0}}>Publish Course</h3>
                <p style={{color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '24px'}}>
                  Declare the Course is ready for upload to the Global Search Database.
                  <br /><br />
                  If not ready, it can be saved as a Draft for up to 28 days. If after 28 days it is not uploaded to the Global Search, it will be automatically deleted.
                </p>
                <div style={{display: 'flex', gap: '16px', flexWrap: 'wrap'}}>
                  <button className="nav-btn primary" onClick={async () => {
                    const cleanTags = (Array.isArray(editingCourse?.tags) ? editingCourse.tags : [])
                      .filter(t => t.toLowerCase() !== 'draft');
                    if (!cleanTags.includes('lms')) cleanTags.push('lms');
                    const pub = {
                      ...editingCourse,
                      isDraft: false,
                      isPublished: true,
                      status: 'published',
                      visibility: 'network',
                      tag: 'lms',
                      tags: cleanTags,
                      publishedAt: Date.now()
                    };
                    setMyCourses(prev => prev.map(c => c.id === pub.id ? pub : c));
                    await saveCourse(pub.id, pub).catch(() => {});
                    setEditingCourse(null);
                    alert('🚀 Course Published to Global Search! Draft tag and messaging removed.');
                  }} style={{flex: 1, minWidth: '200px', fontSize: '1.1rem', padding: '12px 24px'}}>Publish to Global Search</button>
                  <button className="nav-btn secondary" onClick={async () => {
                    const draftTags = Array.from(new Set([...(Array.isArray(editingCourse?.tags) ? editingCourse.tags : []), 'lms', 'Draft']));
                    const draft = {
                      ...editingCourse,
                      isDraft: true,
                      isPublished: false,
                      status: 'draft',
                      visibility: 'site',
                      tag: 'lms',
                      tags: draftTags
                    };
                    setMyCourses(prev => prev.map(c => c.id === draft.id ? draft : c));
                    await saveCourse(draft.id, draft).catch(() => {});
                    setEditingCourse(null);
                    alert('📝 Course Saved as Draft! Tag "Draft" added.');
                  }} style={{flex: 1, minWidth: '200px', fontSize: '1.1rem', padding: '12px 24px'}}>Save as Draft (Tag: Draft)</button>
                </div>
              </div>
            </div>
          </main>
          {isAiImportOpen && renderAiModal()}
        </div>
      );
    }

    return (
      <div className="app-container">
        <div className="background-shapes">
          <div className="shape shape-1"></div>
          <div className="shape shape-2"></div>
          <div className="shape shape-3"></div>
        </div>

        <header className="glass header animate-fade-in">
          <button className="logo-btn" onClick={() => { setShowFrontPage(true); setIsMobileMenuOpen(false); }} title="Go to Front Page">
            <h1>OzEdu Admin</h1>
          </button>

          {/* Android / iPhone: the Google button at the top right opens the role menu (desktop shows the nav inline) */}
          <MobileAccountButton
            ref={accountButtonRef}
            user={authUser}
            role={privileges.role}
            open={isMobileMenuOpen}
            onToggle={() => setIsMobileMenuOpen(prev => !prev)}
          />

          {/* Collapsible Backdrop on Mobile */}
          {isMobileMenuOpen && (
            <div className="mobile-nav-backdrop" onClick={() => setIsMobileMenuOpen(false)} />
          )}

          <nav id={HEADER_MENU_ID} className={`header-nav ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
            {/* Phones: the first item is always the role status */}
            <MobileRoleStatus user={authUser} privileges={privileges} />
            {privileges.isStaff && (
              <button className={`nav-btn ${activeTab === 'my-courses' ? 'primary' : 'secondary'}`} onClick={() => { setActiveTab('my-courses'); setIsMobileMenuOpen(false); }}>My Courses</button>
            )}
            {(!privileges.isStaff || enrolledCourses.length > 0 || studentVisibleCourses.length > 0) && (
              <button className={`nav-btn ${activeTab === 'learning' ? 'primary' : 'secondary'}`} onClick={() => { setActiveTab('learning'); setIsMobileMenuOpen(false); }}>
                🎓 Student Panel{studentVisibleCourses.length ? ` (${studentVisibleCourses.length})` : ''}
              </button>
            )}
            {privileges.canEnrolStudents && (
              <button className={`nav-btn ${activeTab === 'students' ? 'primary' : 'secondary'}`} onClick={() => { setActiveTab('students'); setIsMobileMenuOpen(false); }}>Student Registration</button>
            )}
            {(privileges.isStaff || privileges.canViewGlobalCourses) && (
              <button className={`nav-btn ${activeTab === 'global' ? 'primary' : 'secondary'}`} onClick={() => { openGlobalSearch(); setIsMobileMenuOpen(false); }}>Global Search</button>
            )}

            {/* Teacher Postcard Registration Tab (not needed once someone is a teacher) */}
            {!privileges.isStaff && (
              <button
                className={`nav-btn ${activeTab === 'teacher-app' ? 'primary' : 'secondary'}`}
                onClick={() => { setActiveTab('teacher-app'); setIsMobileMenuOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                title="Postcard Application to join the OzEdu Faculty as a Teacher"
              >
                📮 Join as Teacher
              </button>
            )}

            {/* Token Fund: sponsor a student or donate to the emergency fund */}
            <button
              className="nav-btn secondary"
              onClick={() => { setIsTokenFundOpen(true); setIsMobileMenuOpen(false); }}
              style={{ borderColor: 'rgba(250, 204, 21, 0.6)', color: '#fef08a', display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Sponsor a student's year of access or donate to the Emergency Token Fund"
            >
              💛 Token Fund
            </button>

            {/* Token balance: UNL (unlimited) for the Super Admin; others can buy tokens */}
            <button
              className="nav-btn secondary token-badge-btn"
              onClick={() => {
                if (privileges.isSuperadmin) setIsSuperAdminPanelOpen(true);
                else setIsDonationModalOpen(true);
                setIsMobileMenuOpen(false);
              }}
              style={{
                borderColor: '#f59e0b', color: '#fef08a', display: 'flex', alignItems: 'center', gap: '6px',
                background: 'rgba(245, 158, 11, 0.15)', cursor: 'pointer'
              }}
              title={privileges.isSuperadmin ? 'Super Admin: unlimited tokens — open the Give Tokens panel' : 'Buy tokens (minimum 50), or ask the Super Admin in 💬 Messages'}
            >
              <span>🪙 {tokenBalanceLabel} Tokens</span>
              {!privileges.isSuperadmin && (
                <span style={{ fontSize: '0.72rem', background: '#d97706', color: '#fff', padding: '1px 6px', borderRadius: '6px', fontWeight: 700 }}>
                  +Buy
                </span>
              )}
            </button>

            {/* Super Admin Control Panel */}
            {privileges.isSuperadmin && (
              <button 
                className="nav-btn secondary" 
                onClick={() => { setIsSuperAdminPanelOpen(true); setIsMobileMenuOpen(false); }}
                style={{ borderColor: '#f59e0b', color: '#fef08a', display: 'flex', alignItems: 'center', gap: '6px' }}
                title="Super Admin: Set token value, redistribute fund, approve teachers, manage roles"
              >
                🛡️ Super Admin Control
              </button>
            )}

            {/* Authenticated user profile badge */}
            <div className="user-profile-badge">
              {authUser?.photoURL ? (
                <img src={authUser.photoURL} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />
              ) : (
                <div style={{
                  width: '24px', height: '24px', borderRadius: '50%', background: '#6366f1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold'
                }}>
                  {(authUser?.displayName || authUser?.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                {authUser?.displayName || authUser?.email?.split('@')[0]}
              </span>
              <span style={{
                fontSize: '0.7rem', padding: '2px 8px', borderRadius: '8px',
                background: privileges.isSuperadmin ? '#b45309' : privileges.isStaff ? '#065f46' : '#1e3a8a',
                color: '#ffffff', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px'
              }}>
                {privileges.role}
              </span>
            </div>

            <button className="nav-btn secondary" onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}>Logout</button>
          </nav>
        </header>

        <main className="main-content animate-fade-in-up">
          {globalNotice && (
            <div className={`app-global-notice ${globalNotice.type}`} role="status">
              <span>{globalNotice.message}</span>
              <button onClick={() => setGlobalNotice(null)} aria-label="Dismiss">×</button>
            </div>
          )}

          {activeTab === 'learning' && (
            <StudentLearningPanel
              currentUser={authUser}
              courses={studentVisibleCourses}
              loading={isLoadingEnrolments}
              error={enrolmentsError}
              onRetry={() => setEnrolmentsVersion(v => v + 1)}
              tokenBalanceLabel={tokenBalanceLabel}
              onBrowseGlobalCourses={openGlobalSearch}
              onContactTeacher={(email) => requestCompose(email || SUPERADMIN_INBOX)}
              onMessageTeacher={(course) => requestCompose(course.authorEmail, {
                toName: course.authorName,
                courseId: course.id,
                courseTitle: course.title,
                subject: course.title
              })}
            />
          )}

          {activeTab === 'my-courses' && privileges.isStaff && (
            <div className="admin-section">
              <h2 className="section-title">My Courses</h2>
              
              <div className="cards-grid">
                {/* Square block: Create Course is ALWAYS first block */}
                <div className="glass card create-course-card">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div className="card-icon card-icon-gradient" style={{ margin: 0 }}>✨</div>
                      <h3 style={{ color: '#fef08a', margin: 0, fontSize: '0.98rem' }}>Create Course</h3>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
                      Start a blank course or upload a Google Sheet to auto-fill modules & assessments with AI.
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto', width: '100%' }}>
                    <button 
                      className="nav-btn primary" 
                      style={{ width: '100%', fontWeight: '700', padding: '8px 12px', fontSize: '0.84rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      onClick={handleUploadSheetClick}
                    >
                      ⚡ Upload Sheet (AI)
                    </button>
                    <button 
                      className="nav-btn secondary" 
                      style={{ width: '100%', fontWeight: '600', padding: '8px 12px', fontSize: '0.84rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      onClick={handleCreateBlankCourse}
                    >
                      + Create Course
                    </button>
                  </div>
                </div>

                {visibleMyCourses.map(course => {
                  const isDraft = Boolean(course.isDraft || course.status === 'draft' || (Array.isArray(course.tags) && course.tags.includes('Draft')));

                  return (
                    <div key={course.id} className={`glass card ${isDraft ? 'course-card-draft' : 'course-card-published'}`}>
                      {/* Top Status Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        {isDraft ? (
                          <span className="course-status-badge draft" style={{ fontSize: '0.72rem', padding: '2px 7px' }}>
                            📝 Draft
                          </span>
                        ) : (
                          <span className="course-status-badge published" style={{ fontSize: '0.72rem', padding: '2px 7px' }}>
                            🌐 Published
                          </span>
                        )}
                        {course.category && (
                          <span style={{
                            fontSize: '0.7rem',
                            color: isDraft ? '#fde68a' : 'var(--text-secondary)',
                            background: isDraft ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.08)',
                            padding: '2px 6px',
                            borderRadius: '6px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '120px'
                          }}>
                            {course.category}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <div className="card-icon" style={{ margin: 0 }}>{isDraft ? '📝' : '📚'}</div>
                        <h3 style={{ color: isDraft ? '#fef08a' : '#e2e8f0', margin: 0, flex: 1 }}>{course.title}</h3>
                      </div>

                      {course.startDate && (
                        <p style={{fontSize: '0.75rem', color: isDraft ? '#fbbf24' : 'var(--accent-hover)', margin: '0 0 2px 0', fontWeight: '500'}}>
                          📅 Starts: {formatLocalizedDate(course.startDate)}
                        </p>
                      )}
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '2px 0 6px 0'}}>
                        <p style={{margin: 0, fontSize: '0.76rem'}}>{isDraft ? 'Draft Status (Private)' : `Students: ${course.students}`}</p>
                      </div>

                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '6px',
                        marginTop: 'auto',
                        width: '100%'
                      }}>
                        {course.sourceCourseId && (
                          <span style={{ gridColumn: 'span 2', fontSize: '0.7rem', color: '#a5b4fc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            📋 Copied{course.copiedAt ? ` on ${formatLocalizedDate(String(course.copiedAt).slice(0, 10))}` : ''}
                          </span>
                        )}
                        {!course.authorId && (
                          <span style={{ gridColumn: 'span 2', fontSize: '0.7rem', color: '#fcd34d', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title="Created before course ownership was recorded. Saving it makes you the owner.">
                            ⚠️ Unassigned course
                          </span>
                        )}
                        {privileges.canEnrolStudents && (
                          <button
                            className="nav-btn primary"
                            style={{
                              background: 'linear-gradient(135deg, #059669, #10b981)',
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              fontSize: '0.76rem',
                              padding: '6px 4px',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                            onClick={() => setManagingPeopleCourse(course)}
                            title="Add students by email (Students & People)"
                          >
                            👥 Students & People
                          </button>
                        )}
                        <button
                          className="nav-btn secondary"
                          style={{ fontSize: '0.76rem', padding: '6px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          onClick={() => setSubmissionsCourse(course)}
                          title="View and grade students' assessment submissions"
                        >
                          📥 Submissions
                        </button>
                        <button 
                          className="nav-btn secondary" 
                          style={{
                            fontSize: '0.76rem',
                            padding: '6px 4px',
                            borderColor: isDraft ? 'rgba(245, 158, 11, 0.5)' : undefined,
                            color: isDraft ? '#fef08a' : undefined,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }} 
                          onClick={() => setEditingCourse(course)}
                        >
                          {isDraft ? '✏️ Edit Draft' : 'Manage'}
                        </button>
                        <button
                          className="nav-btn primary"
                          style={{
                            background: '#e11d48',
                            border: 'none',
                            color: 'white',
                            padding: '6px 4px',
                            fontSize: '0.76rem',
                            whiteSpace: 'nowrap'
                          }}
                          onClick={() => handleDeleteCourse(course)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{marginTop: '32px', width: '100%', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '24px', textAlign: 'center'}}>
                <button className="nav-btn secondary" onClick={() => setShowArchive(!showArchive)}>
                  {showArchive ? 'Hide Archive' : `View Archive (${archivedCourses.length})`}
                </button>
              </div>

              {showArchive && (
                <div style={{width: '100%', marginTop: '24px'}}>
                  <h3 style={{color: 'var(--text-secondary)', marginBottom: '16px', textAlign: 'center'}}>Archived Courses (Kept for 28 days)</h3>
                  <div className="cards-grid">
                    {archivedCourses.length === 0 ? (
                      <p style={{color: 'white', textAlign: 'center', width: '100%'}}>Archive is empty.</p>
                    ) : (
                      archivedCourses.map(course => {
                        const daysLeft = 28 - Math.floor((Date.now() - course.archivedAt) / (1000 * 60 * 60 * 24));
                        return (
                          <div key={course.id} className="glass card" style={{ opacity: 0.85, justifyContent: 'space-between' }}>
                            <div>
                              <div className="card-icon" style={{ filter: 'grayscale(1)', marginBottom: '6px' }}>🗑️</div>
                              <h3 style={{ textDecoration: 'line-through', fontSize: '0.92rem' }}>{course.title}</h3>
                              <p style={{ color: '#f87171', fontWeight: 'bold', fontSize: '0.78rem' }}>Deletes in {daysLeft} days</p>
                            </div>
                            <button className="nav-btn secondary" style={{ marginTop: 'auto', width: '100%', padding: '7px 10px', fontSize: '0.8rem' }} onClick={() => handleRestoreCourse(course)}>Restore Course</button>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'students' && privileges.canEnrolStudents && (
            <StudentRegistration
              myCourses={visibleMyCourses}
              onUpdateCourses={handleUpdateCourseEnrollments}
            />
          )}

          {activeTab === 'global' && (privileges.isStaff || privileges.canViewGlobalCourses) && (
            <div className="admin-section">
              <div className="global-search-header-bar">
                <div>
                  <h2 className="section-title" style={{ margin: 0 }}>Global Course Search</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', margin: '4px 0 0 0' }}>
                    Explore 900+ curated university courses across all academic disciplines.
                  </p>
                </div>

                <div className="global-filter-row">
                  <input 
                    type="text" 
                    placeholder="Search by title, author, or subject..." 
                    className="form-input search-input"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setGlobalPage(1);
                    }}
                    style={{ width: '280px' }}
                  />

                  <select 
                    value={globalCategory} 
                    onChange={(e) => {
                      setGlobalCategory(e.target.value);
                      setGlobalPage(1);
                    }}
                    className="filter-select"
                    style={{ minWidth: '220px' }}
                  >
                    <option value="ALL">All Subjects ({ALL_GLOBAL_COURSES.length})</option>
                    {globalCategoriesList.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Network error notice if published courses failed to load */}
              {networkError && (
                <div className="network-error-notice" style={{ margin: '16px 0', padding: '10px 14px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.25)' }}>
                  <p style={{ color: '#fca5a5', fontSize: '0.85rem', margin: 0 }}>{networkError}</p>
                </div>
              )}

              {/* Published OzEdu courses (live from the database) - only shown when courses exist */}
              {filteredNetworkCourses.length > 0 && (
                <div className="network-courses-block">
                  <div className="network-courses-head">
                    <h3>🌏 Published by OzEdu teachers ({filteredNetworkCourses.length})</h3>
                    <button className="nav-btn secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={loadNetworkCourses} disabled={isLoadingNetwork}>
                      {isLoadingNetwork ? 'Loading…' : '↻ Refresh'}
                    </button>
                  </div>
                  <div className="global-cards-grid-4x6">
                    {filteredNetworkCourses.map(course => {
                      const copied = isCopiedByMe(course);
                      const own = String(course.authorId || '') === String(authUser?.uid || '_');
                      return (
                        <div key={`net-${course.id}`} className="glass global-course-card network-course-card">
                          <div>
                            <div className="global-category-tag" title={course.category}>{course.category || 'General Academic'}</div>
                            <h4 className="global-course-title" title={course.title}>{course.title}</h4>
                            <p className="global-course-author"><span>✍️</span><strong>{course.authorName || 'OzEdu teacher'}</strong></p>
                            <p className="global-course-students">📚 {(course.units || []).length} units • 👥 {Number(course.students) || 0} enrolled</p>
                          </div>
                          {privileges.isStaff ? (
                            <button
                              className="nav-btn primary"
                              style={{ width: '100%', fontSize: '0.82rem', padding: '8px 10px', marginTop: 'auto', background: copied ? 'rgba(52, 211, 153, 0.25)' : undefined }}
                              onClick={() => handleCopyCourse(course)}
                              disabled={copied || own || Boolean(copyingCourseIds[String(course.id)])}
                            >
                              {own ? 'Your course' : copied ? '✓ In My Courses' : copyingCourseIds[String(course.id)] ? 'Copying…' : '+ Copy to My Courses'}
                            </button>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: 'auto' }}>
                              <div className="sl-enrol-badge" style={{ fontSize: '0.74rem', textAlign: 'center', padding: '3px 6px', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)' }}>
                                🔒 Enrolment by Teacher Only
                              </div>
                              <button
                                type="button"
                                className="nav-btn primary"
                                style={{ width: '100%', fontSize: '0.8rem', padding: '7px 10px' }}
                                onClick={() => {
                                  requestCompose(course.authorEmail || SUPERADMIN_INBOX, {
                                    toName: course.authorName || 'Teacher',
                                    courseId: course.id,
                                    courseTitle: course.title,
                                    subject: `Enrolment request: ${course.title}`,
                                    body: `Hi ${course.authorName || 'Teacher'},\n\nI am interested in taking "${course.title}" and would like to be enrolled in your course.\n\nThank you!\n${authUser?.displayName || authUser?.email || ''}`
                                  });
                                }}
                              >
                                💬 Contact Teacher to Enrol
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <h3 className="catalog-heading" style={{ textAlign: 'center' }}>📖 Curated Course Catalog</h3>

              {/* 4 Courses Across × 6 Rows Down (24 Per Page) - Centered */}
              <div className="global-cards-grid-4x6">
                {paginatedGlobalCourses.map(course => (
                  <div key={course.id} className="glass global-course-card">
                    <div>
                      <div className="global-category-tag" title={course.category}>
                        {course.category || 'General Academic'}
                      </div>
                      <h4 className="global-course-title" title={course.title}>
                        {course.title}
                      </h4>
                      <p className="global-course-author">
                        <span>✍️</span>
                        <strong>{course.author}</strong>
                      </p>
                      <p className="global-course-students">
                        👥 {course.students?.toLocaleString() || 0} enrolled
                      </p>
                    </div>

                    {privileges.isStaff ? (
                      <button
                        className="nav-btn primary"
                        style={{
                          width: '100%',
                          fontSize: '0.82rem',
                          padding: '8px 10px',
                          marginTop: 'auto',
                          background: isCopiedByMe(course) ? 'rgba(52, 211, 153, 0.25)' : undefined
                        }}
                        onClick={() => handleCopyCourse(course)}
                        disabled={isCopiedByMe(course) || Boolean(copyingCourseIds[String(course.id)])}
                      >
                        {isCopiedByMe(course) ? '✓ In My Courses' : copyingCourseIds[String(course.id)] ? 'Copying…' : '+ Copy to My Courses'}
                      </button>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: 'auto' }}>
                        <div className="sl-enrol-badge" style={{ fontSize: '0.74rem', textAlign: 'center', padding: '3px 6px', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)' }}>
                          🔒 Enrolment by Teacher Only
                        </div>
                        <button
                          type="button"
                          className="nav-btn secondary"
                          style={{ width: '100%', fontSize: '0.8rem', padding: '7px 10px' }}
                          onClick={() => {
                            requestCompose(SUPERADMIN_INBOX, {
                              toName: 'Super Admin',
                              courseId: course.id,
                              courseTitle: course.title,
                              subject: `Course inquiry: ${course.title}`,
                              body: `Hi,\n\nI am interested in taking the catalog course "${course.title}". Could a teacher offer this course or enrol me?\n\nThank you!\n${authUser?.displayName || authUser?.email || ''}`
                            });
                          }}
                        >
                          💬 Inquire About Course
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Pagination at the bottom with Right Arrow to flip through more courses */}
              <div className="global-pagination-bar">
                <div className="pagination-info">
                  Showing <strong>{(currentGlobalPage - 1) * COURSES_PER_PAGE + 1}–{Math.min(currentGlobalPage * COURSES_PER_PAGE, filteredGlobalCourses.length)}</strong> of <strong>{filteredGlobalCourses.length}</strong> courses (4 × 6 Grid)
                </div>

                <div className="pagination-actions">
                  <button 
                    className="nav-btn secondary pagination-arrow-btn" 
                    onClick={() => setGlobalPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentGlobalPage === 1}
                    title="Previous page"
                  >
                    ← Previous
                  </button>

                  <div className="pagination-page-indicator">
                    Page <strong>{currentGlobalPage}</strong> of <strong>{totalGlobalPages}</strong>
                  </div>

                  <button 
                    className="nav-btn primary pagination-arrow-btn pagination-right-arrow" 
                    onClick={() => setGlobalPage(prev => Math.min(prev + 1, totalGlobalPages))}
                    disabled={currentGlobalPage === totalGlobalPages}
                    title="Flip to next 24 courses"
                  >
                    <span>Next 24 Courses</span>
                    <span className="arrow-icon">➔</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'media' && (
            <div className="admin-section">
              <h2 className="section-title">Media Library</h2>
              <div className="glass card" style={{marginBottom: '24px', width: '100%', maxWidth: '500px', textAlign: 'center'}}>
                <h3>Upload Image</h3>
                <p style={{marginBottom: '16px'}}>Upload images to use in your courses. Hosted by ImgBB.</p>
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleImageUpload} 
                  disabled={isUploading}
                  style={{display: 'none'}}
                  id="image-upload"
                />
                <label htmlFor="image-upload" className="nav-btn primary" style={{display: 'inline-block', cursor: isUploading ? 'not-allowed' : 'pointer', opacity: isUploading ? 0.7 : 1}}>
                  {isUploading ? 'Uploading...' : 'Choose Image'}
                </label>
              </div>

              <div className="cards-grid">
                {uploadedImages.length === 0 ? (
                  <p style={{color: 'white'}}>No images uploaded yet.</p>
                ) : (
                  uploadedImages.map((url, index) => (
                    <div key={index} className="glass card" style={{padding: '16px'}}>
                      <img src={url} alt={`Uploaded ${index}`} style={{width: '100%', borderRadius: '12px', marginBottom: '12px'}} />
                      <input type="text" value={url} readOnly className="form-input" style={{width: '100%'}} onClick={(e) => e.target.select()} title="Click to copy URL" />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'teacher-app' && (
            <TeacherApplicationPostcard
              currentUser={authUser}
              userProfile={userProfile}
              onSubmitted={() => {}}
            />
          )}
          <div className="message-dock-spacer" aria-hidden="true" />
        </main>
        {isUserRolesOpen && (
          <UserRoleManagementModal
            currentUser={authUser}
            isOpen={isUserRolesOpen}
            onClose={() => setIsUserRolesOpen(false)}
          />
        )}
        {isSuperAdminPanelOpen && (
          <SuperAdminTokenPanel
            currentUser={authUser}
            userProfile={userProfile}
            isOpen={isSuperAdminPanelOpen}
            onClose={() => {
              setIsSuperAdminPanelOpen(false);
              if (authUser?.uid) {
                getUserTokenBalance(authUser.uid).then(bal => setUserTokenBalance(bal || 0));
              }
            }}
          />
        )}
        {isDonationModalOpen && (
          <DonationModal
            currentUser={authUser}
            isOpen={isDonationModalOpen}
            onClose={() => {
              setIsDonationModalOpen(false);
              if (authUser?.uid) {
                getUserTokenBalance(authUser.uid).then(bal => setUserTokenBalance(bal || 0));
              }
            }}
          />
        )}
        {isTokenFundOpen && (
          <TokenFundModal
            isOpen={isTokenFundOpen}
            currentUser={authUser}
            onClose={() => setIsTokenFundOpen(false)}
            onOpenDonation={() => {
              setIsTokenFundOpen(false);
              setIsDonationModalOpen(true);
            }}
          />
        )}
        {managingPeopleCourse && (
          <CourseAddPeopleModal
            course={managingPeopleCourse}
            currentUser={authUser}
            userProfile={userProfile}
            onClose={() => setManagingPeopleCourse(null)}
            onMemberAdded={(courseId, delta = 1) => {
              setMyCourses(prev => prev.map(c => c.id === courseId ? { ...c, students: Math.max(0, (Number(c.students) || 0) + delta) } : c));
            }}
          />
        )}
        {submissionsCourse && (
          <CourseSubmissionsModal
            course={submissionsCourse}
            currentUser={authUser}
            onClose={() => setSubmissionsCourse(null)}
            onMessageStudent={(submission) => {
              setSubmissionsCourse(null);
              requestCompose(submission.studentEmail, {
                toName: submission.studentName,
                courseId: submission.courseId,
                courseTitle: submission.courseTitle,
                subject: submission.assessmentTitle
              });
            }}
          />
        )}
        <MessageDock
          currentUser={authUser}
          userProfile={userProfile}
          teachingCourses={privileges.isStaff ? visibleMyCourses : []}
          enrolledCourses={enrolledCourses}
          networkCourses={networkCourses}
          ref={messageDockRef}
          onBalanceChanged={() => authUser?.uid && getUserTokenBalance(authUser.uid).then(bal => setUserTokenBalance(bal || 0))}
        />
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="background-shapes">
        <div className="shape shape-1"></div>
        <div className="shape shape-2"></div>
        <div className="shape shape-3"></div>
      </div>

      <header className="glass header animate-fade-in">
        <button className="logo-btn" onClick={() => { setShowFrontPage(true); setIsMobileMenuOpen(false); }} title="OzEdu Learning Platform">
          <h1>OzEdu</h1>
        </button>

        {/* Android / iPhone: the Google button at the top right — sign in, or open the role menu once signed in */}
        {isLoggedIn ? (
          <MobileAccountButton
            ref={accountButtonRef}
            user={authUser}
            role={privileges.role}
            open={isMobileMenuOpen}
            onToggle={() => setIsMobileMenuOpen(prev => !prev)}
          />
        ) : (
          <MobileSignInButton onClick={handleSignIn} busy={isAuthLoading} />
        )}

        {/* Collapsible Backdrop on Mobile */}
        {isLoggedIn && isMobileMenuOpen && (
          <div className="mobile-nav-backdrop" onClick={() => setIsMobileMenuOpen(false)} />
        )}

        <nav id={HEADER_MENU_ID} className={`header-nav ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
          {/* Phones: the first item is always the role status */}
          {isLoggedIn && <MobileRoleStatus user={authUser} privileges={privileges} />}
          <button className="nav-btn secondary" onClick={() => { setIsContactOpen(true); setIsMobileMenuOpen(false); }}>Contact</button>
          {isLoggedIn ? (
            <>
              <button
                className="nav-btn primary"
                onClick={() => { setShowFrontPage(false); setIsMobileMenuOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                title="Return to OzEdu Admin Dashboard"
              >
                <span>🛡️ Go to Admin</span>
              </button>
              <button
                className="nav-btn secondary"
                onClick={() => { setIsTokenFundOpen(true); setIsMobileMenuOpen(false); }}
                style={{ borderColor: 'rgba(250, 204, 21, 0.6)', color: '#fef08a' }}
                title="Sponsor a student's year of access or donate to the Emergency Token Fund"
              >
                💛 Token Fund
              </button>
              <div className="user-profile-badge">
                {authUser?.photoURL ? (
                  <img src={authUser.photoURL} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />
                ) : (
                  <div style={{
                    width: '24px', height: '24px', borderRadius: '50%', background: '#6366f1',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold'
                  }}>
                    {(authUser?.displayName || authUser?.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                  {authUser?.displayName || authUser?.email?.split('@')[0]}
                </span>
                <span style={{
                  fontSize: '0.7rem', padding: '2px 8px', borderRadius: '8px',
                  background: privileges.isSuperadmin ? '#b45309' : privileges.isStaff ? '#065f46' : '#1e3a8a',
                  color: '#ffffff', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px'
                }}>
                  {privileges.role}
                </span>
              </div>
              <button className="nav-btn secondary" onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}>Logout</button>
            </>
          ) : (
            <button 
              className="nav-btn primary google-signin-btn" 
              onClick={handleSignIn}
              disabled={isAuthLoading}
              title="Sign in with your Google account"
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span>{isAuthLoading ? 'Connecting...' : 'Sign in with Google'}</span>
            </button>
          )}
        </nav>
      </header>
      {authError && (
        <div className="auth-error-banner animate-fade-in">
          <span>⚠️ {authError}</span>
          <button onClick={() => setAuthError('')} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
        </div>
      )}
      {paymentNotice && (
        <div style={{
          background: paymentNotice.type === 'success' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(148, 163, 184, 0.2)',
          border: paymentNotice.type === 'success' ? '1px solid rgba(34, 197, 94, 0.5)' : '1px solid rgba(148, 163, 184, 0.4)',
          color: paymentNotice.type === 'success' ? '#86efac' : '#cbd5e1',
          padding: '12px 18px', borderRadius: '10px', margin: '12px auto', maxWidth: '800px', width: '90%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }} className="animate-fade-in">
          <span>{paymentNotice.message}</span>
          <button onClick={() => setPaymentNotice(null)} style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
        </div>
      )}

      <main className="main-content">
        <div className="hero-text animate-fade-in-up">
          <h2>Transforming Education Through AI & Community</h2>
          <p>
            Bridging the gap between world-class tertiary education and under-resourced classrooms across Southeast Asia with a self-sustaining, ultra-lightweight ecosystem.
          </p>
        </div>

        <div className="cards-grid front-cards-grid">
          {cards.map((card, index) => (
            <div 
              key={index} 
              className={`glass card front-card animate-fade-in-up delay-${index + 1}`}
            >
              <div className="card-icon">{card.icon}</div>
              <h3>{card.title}</h3>
              <p>{card.content}</p>
            </div>
          ))}
        </div>

      </main>

      <footer className="footer glass animate-fade-in-up delay-5">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <span>© {new Date().getFullYear()} AI Foundation Australia</span>
          <span style={{ opacity: 0.35 }}>•</span>
          <button 
            type="button" 
            className="nav-btn secondary" 
            style={{ padding: '4px 14px', fontSize: '0.82rem', borderRadius: '20px', cursor: 'pointer' }}
            onClick={() => setIsAboutDavidOpen(true)}
          >
            About David
          </button>
          {/* Phones: Contact (the header only has room for the Google button) */}
          <button
            type="button"
            className="nav-btn secondary mobile-footer-contact"
            style={{ padding: '4px 14px', fontSize: '0.82rem', borderRadius: '20px', cursor: 'pointer' }}
            onClick={() => setIsContactOpen(true)}
          >
            Contact
          </button>
        </div>
      </footer>

      {isContactOpen && (
        <div className="modal-overlay" onClick={() => setIsContactOpen(false)}>
          <div className="glass modal-content animate-fade-in-up" onClick={e => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setIsContactOpen(false)}>✕</button>
            <h2>Contact Us</h2>
            <div className="contact-info-boxes">
              <details className="info-box">
                <summary>If you are a remote school, from anywhere, and want to know how to onboard</summary>
                <div className="dropdown-content">
                  We provide an ultra-lightweight integration process. Simply reach out to our team with your school's details, and we'll provide the snippet and onboarding guide to get you up and running in a day.
                </div>
              </details>
              <details className="info-box">
                <summary>If you are a teacher and want to share materials</summary>
                <div className="dropdown-content">
                  Our platform thrives on community-contributed content. Register with Google, then message the Super Admin with links to your syllabus or modules (for example on Google Drive). Our academic team will review and integrate your work.
                </div>
              </details>
              <details className="info-box">
                <summary>If you are a donor and want to know how to sponsor students</summary>
                <div className="dropdown-content">
                  Sign in with Google and press the 💛 Token Fund button to sponsor a specific student or donate to the Emergency Token Fund, or contact us to sponsor larger groups and entire classrooms.
                </div>
              </details>
            </div>
            <div className="contact-steps">
              <p className="contact-welcome">
                Welcome! To message our team, register with Google first. New accounts start as <strong>Supporters</strong>,
                and every Supporter can message the Super Admin from the 💬 Messages panel at the bottom of their admin panel.
              </p>
              <ol className="contact-step-list">
                <li><strong>Register with Google</strong>: one click, no forms.</li>
                <li><strong>You become a Supporter</strong> and your admin panel opens.</li>
                <li><strong>Open 💬 Messages</strong> and write to the 🛡️ Super Admin. Replies arrive in the same place.</li>
              </ol>
              {isLoggedIn ? (
                <button type="button" className="nav-btn primary contact-cta" onClick={handleContactMessageSuperadmin}>
                  💬 Message the Super Admin
                </button>
              ) : (
                <button type="button" className="nav-btn primary contact-cta" onClick={() => { setIsContactOpen(false); handleSignIn(); }} disabled={isAuthLoading}>
                  {isAuthLoading ? 'Connecting...' : 'Register with Google'}
                </button>
              )}
              <p className="contact-email-note">
                You can also email us at <a href="mailto:support@aifoundation.net.au">support@aifoundation.net.au</a>.
              </p>
            </div>
          </div>
        </div>
      )}

      {isAboutDavidOpen && (
        <div className="modal-overlay" onClick={() => setIsAboutDavidOpen(false)}>
          <div 
            className="glass modal-content animate-fade-in-up" 
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '860px', width: '94%', maxHeight: '92vh', overflowY: 'auto', padding: '32px 38px' }}
          >
            <button className="close-btn" onClick={() => setIsAboutDavidOpen(false)}>✕</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '22px', marginBottom: '18px', flexWrap: 'wrap' }}>
              <img 
                src="/david-photo.jpg" 
                alt="David" 
                style={{ 
                  width: '92px', 
                  height: '92px', 
                  borderRadius: '50%', 
                  objectFit: 'cover',
                  border: '3px solid rgba(52, 211, 153, 0.6)',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)'
                }} 
              />
              <div style={{ flex: '1', minWidth: '240px' }}>
                <h2 style={{ margin: '0 0 6px 0', fontSize: '1.55rem', color: '#fef08a' }}>About David</h2>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', background: 'rgba(52, 211, 153, 0.15)', color: '#34d399', padding: '3px 10px', borderRadius: '12px', border: '1px solid rgba(52, 211, 153, 0.3)' }}>
                    AI Researcher & HDR Doctoral Candidate
                  </span>
                  <span style={{ fontSize: '0.8rem', background: 'rgba(250, 204, 21, 0.15)', color: '#fef08a', padding: '3px 10px', borderRadius: '12px', border: '1px solid rgba(250, 204, 21, 0.3)' }}>
                    Griffith University
                  </span>
                </div>
              </div>
            </div>

            <div style={{ color: 'var(--text-secondary)', fontSize: '0.94rem', lineHeight: '1.6', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ margin: 0 }}>
                As an AI researcher, digital transformation specialist, and educator, I lead Higher Degree by Research (HDR) doctoral studies at Griffith University examining the organizational and human adoption of AI agent frameworks.
              </p>
              <p style={{ margin: 0 }}>
                Holding an MBA in Digital Transformation, a Master of Applied Linguistics, and a Bachelor of International Relations, I leverage an extensive academic background lecturing across Southeast Asia—where I deployed curricula in digital agility, communication ecosystems, and AI prompt engineering—to develop resilient educational technologies for low-resource environments.
              </p>
              <p style={{ margin: 0 }}>
                Through AI Foundation Australia, I architect offline-first, token-supported learning management systems like HealthPulse and OzEdu to deliver critical AI-driven training to remote frontline healthcare workers globally, while actively designing practical AI training programs for Australian small-to-medium businesses.
              </p>
            </div>

            <div style={{ 
              marginTop: '18px', 
              padding: '14px 18px', 
              background: 'rgba(255, 255, 255, 0.05)', 
              borderRadius: '16px', 
              border: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <p style={{ margin: 0, fontSize: '0.92rem', color: '#e2e8f0', lineHeight: '1.5' }}>
                To get in touch, become a supporter by registering today, or contact me directly by sending a message through our message panel.
              </p>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                {isLoggedIn ? (
                  <button 
                    type="button" 
                    className="nav-btn primary" 
                    style={{ padding: '8px 18px', fontSize: '0.88rem' }}
                    onClick={() => {
                      setIsAboutDavidOpen(false);
                      handleContactMessageSuperadmin();
                    }}
                  >
                    💬 Send Message to David
                  </button>
                ) : (
                  <>
                    <button 
                      type="button" 
                      className="nav-btn primary" 
                      style={{ padding: '8px 18px', fontSize: '0.88rem' }}
                      onClick={() => {
                        setIsAboutDavidOpen(false);
                        handleSignIn();
                      }}
                      disabled={isAuthLoading}
                    >
                      {isAuthLoading ? 'Connecting...' : '✨ Register as Supporter'}
                    </button>
                    <button 
                      type="button" 
                      className="nav-btn secondary" 
                      style={{ padding: '8px 14px', fontSize: '0.85rem' }}
                      onClick={() => {
                        setIsAboutDavidOpen(false);
                        setIsContactOpen(true);
                      }}
                    >
                      ✉️ Contact Options
                    </button>
                  </>
                )}
                <button 
                  type="button" 
                  className="nav-btn secondary" 
                  style={{ padding: '8px 16px', fontSize: '0.85rem', marginLeft: 'auto' }}
                  onClick={() => setIsAboutDavidOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {isAiImportOpen && renderAiModal()}
      {isDonationModalOpen && isLoggedIn && (
        <DonationModal
          currentUser={authUser}
          isOpen={isDonationModalOpen}
          onClose={() => setIsDonationModalOpen(false)}
        />
      )}
      {isTokenFundOpen && isLoggedIn && (
        <TokenFundModal
          isOpen={isTokenFundOpen}
          currentUser={authUser}
          onClose={() => setIsTokenFundOpen(false)}
          onOpenDonation={() => {
            setIsTokenFundOpen(false);
            setIsDonationModalOpen(true);
          }}
        />
      )}
    </div>
  );
}

export default App;
