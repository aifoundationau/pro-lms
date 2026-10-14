import React, { useState, useEffect } from 'react';
import {
  addMemberToCourseFree,
  listCourseMembers,
  removeMemberFromCourse,
  bulkEnrolMembers,
  parseMemberText,
  parseRosterSheets,
  normalizeMemberEmail,
  MAX_BULK_MEMBERS
} from '../../services/courseEnrollmentService.js';
import { listSiteStudents } from '../../services/lmsRepository.js';
import { sendEnrolmentWelcomes } from '../../services/messageService.js';
import { readSpreadsheetFiles, SPREADSHEET_FILE_ACCEPT } from '../../services/spreadsheetReader.js';
import { buildXlsxWorkbook, downloadFile, safeFileStem, XLSX_STYLE } from '../../services/xlsxWriter.js';
import { canEnrolInCourses } from '../../services/rolePrivileges.js';

/** Combines pasted and uploaded lists, removing duplicates. */
function mergeMemberLists(...lists) {
  const seen = new Set();
  const members = [];
  const invalid = [];
  for (const list of lists) {
    for (const m of list?.members || []) {
      if (seen.has(m.email)) continue;
      seen.add(m.email);
      members.push(m);
    }
    invalid.push(...(list?.invalid || []));
  }
  return { members, invalid };
}

export default function CourseAddPeopleModal({
  course,
  currentUser,
  userProfile = null,
  onClose,
  onMemberAdded
}) {
  const [activeTab, setActiveTab] = useState('add-new'); // 'add-new' | 'bulk' | 'pick-existing' | 'roster'

  // Bulk / spreadsheet enrolment state
  const [bulkText, setBulkText] = useState('');
  const [bulkFileResult, setBulkFileResult] = useState(null);
  const [bulkFileName, setBulkFileName] = useState('');
  const [bulkRole, setBulkRole] = useState('student');
  const [isReadingBulkFile, setIsReadingBulkFile] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('student');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  // Roster state
  const [roster, setRoster] = useState([]);
  const [isLoadingRoster, setIsLoadingRoster] = useState(true);

  // Existing system students
  const [existingStudents, setExistingStudents] = useState([]);
  const [searchStudentQuery, setSearchStudentQuery] = useState('');

  useEffect(() => {
    if (!course?.id) return;
    loadRoster();
    loadSystemStudents();
  }, [course]);

  const loadRoster = async () => {
    setIsLoadingRoster(true);
    try {
      const members = await listCourseMembers(course.id);
      setRoster(members || []);
    } catch (err) {
      console.warn('Error loading course roster:', err);
    } finally {
      setIsLoadingRoster(false);
    }
  };

  const loadSystemStudents = async () => {
    try {
      const { students } = await listSiteStudents().catch(() => ({ students: [] }));
      setExistingStudents(students || []);
    } catch (err) {
      console.warn('Error loading system students:', err);
    }
  };

  /** Sends each newly enrolled person a welcome message; returns a sentence for the notice. */
  const welcomeNewMembers = async (members) => {
    const list = (members || []).filter(m => m?.email);
    if (!list.length) return '';
    const { sent, failed } = await sendEnrolmentWelcomes({ sender: currentUser, senderProfile: userProfile, course, members: list });
    if (!failed.length) return `📨 Welcome message sent to ${sent.length === 1 ? sent[0] : `${sent.length} people`}.`;
    if (!sent.length) return '⚠️ The welcome message could not be sent (they can still see the course in their Student Panel).';
    return `📨 Welcome message sent to ${sent.length}; ${failed.length} could not be sent.`;
  };

  const handleAddMember = async (e) => {
    if (e) e.preventDefault();
    if (!name.trim() && !email.trim()) {
      setNotice({ type: 'error', message: 'Please provide a name or an email address.' });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const result = await addMemberToCourseFree({
        courseId: course.id,
        courseTitle: course.title,
        memberName: name.trim(),
        memberEmail: email.trim(),
        memberRole: role,
        addedByUid: currentUser?.uid || 'teacher',
        addedByName: currentUser?.displayName || currentUser?.email || 'Teacher',
        addedByProfile: userProfile
      });

      const welcome = !result.alreadyEnrolled
        ? await welcomeNewMembers([{ email: result.member.memberEmail, name: result.member.memberName, role: result.member.memberRole }])
        : '';
      setNotice({
        type: 'success',
        message: [result.message, welcome].filter(Boolean).join(' ')
      });
      setName('');
      setEmail('');
      await loadRoster();

      if (onMemberAdded) {
        onMemberAdded(course.id);
      }
    } catch (err) {
      setNotice({
        type: 'error',
        message: err.message || 'Failed to enroll member.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickAddExistingStudent = async (student) => {
    setIsSubmitting(true);
    setNotice(null);
    try {
      const fullName = `${student.legalFirstName || ''} ${student.legalFamilyName || ''}`.trim() || student.preferredName || 'Student';
      const studentEmail = student.personalEmail || student.email || '';

      const result = await addMemberToCourseFree({
        courseId: course.id,
        courseTitle: course.title,
        memberName: fullName,
        memberEmail: studentEmail,
        memberRole: 'student',
        addedByUid: currentUser?.uid || 'teacher',
        addedByName: currentUser?.displayName || currentUser?.email || 'Teacher',
        addedByProfile: userProfile
      });

      const welcome = !result.alreadyEnrolled
        ? await welcomeNewMembers([{ email: result.member.memberEmail, name: result.member.memberName, role: 'student' }])
        : '';
      setNotice({
        type: 'success',
        message: [result.alreadyEnrolled ? result.message : `Added ${fullName} to ${course.title}.`, welcome].filter(Boolean).join(' ')
      });
      await loadRoster();
      if (onMemberAdded) onMemberAdded(course.id);
    } catch (err) {
      setNotice({ type: 'error', message: err.message || 'Could not add student.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveMember = async (member) => {
    if (!window.confirm(`Remove ${member.memberName || member.memberEmail} from this course?`)) return;
    try {
      await removeMemberFromCourse({
        courseId: course.id,
        memberId: member.id,
        memberEmail: member.memberEmail
      });
      setNotice({ type: 'info', message: `Removed ${member.memberName} from course.` });
      await loadRoster();
      if (onMemberAdded) onMemberAdded(course.id, -1);
    } catch (err) {
      setNotice({ type: 'error', message: 'Could not remove member.' });
    }
  };

  const bulkPreview = mergeMemberLists(parseMemberText(bulkText), bulkFileResult);
  const enrolledEmails = new Set(roster.map(m => normalizeMemberEmail(m.memberEmail)).filter(Boolean));
  const bulkNew = bulkPreview.members.filter(m => !enrolledEmails.has(m.email));
  const bulkAlready = bulkPreview.members.length - bulkNew.length;

  const handleBulkFile = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setIsReadingBulkFile(true);
    setNotice(null);
    try {
      const { sheets } = await readSpreadsheetFiles(files);
      const result = parseRosterSheets(sheets);
      setBulkFileResult(result);
      setBulkFileName(files.map(f => f.name).join(', '));
      if (!result.members.length) setNotice({ type: 'error', message: 'No email addresses were found in that file. Add an "Email" column.' });
    } catch (err) {
      setNotice({ type: 'error', message: err.message || 'The spreadsheet could not be read.' });
    } finally {
      setIsReadingBulkFile(false);
    }
  };

  const handleDownloadRosterTemplate = () => {
    try {
      const bytes = buildXlsxWorkbook([{
        name: 'Students',
        freezeRows: 1,
        columns: [{ width: 32 }, { width: 40, style: XLSX_STYLE.TEXT }],
        rows: [[{ v: 'Name', s: XLSX_STYLE.HEADER }, { v: 'Email', s: XLSX_STYLE.HEADER }]],
        validations: [{ range: 'B2:B5000', promptTitle: 'Email', prompt: "The student's sign-in (Google) email address." }]
      }]);
      downloadFile(bytes, `${safeFileStem(course.title, 'Course')}_students.xlsx`);
    } catch {
      setNotice({ type: 'error', message: 'The roster template could not be created.' });
    }
  };

  const handleBulkEnrol = async () => {
    if (!bulkNew.length) return;
    setIsSubmitting(true);
    setNotice(null);
    try {
      const result = await bulkEnrolMembers({
        course,
        members: bulkNew,
        memberRole: bulkRole,
        addedByUid: currentUser?.uid || 'teacher',
        addedByName: currentUser?.displayName || currentUser?.email || 'Teacher',
        addedByProfile: userProfile
      });
      const noun = bulkRole === 'student' ? 'student' : bulkRole === 'teacher' ? 'co-teacher' : 'guest';
      const parts = [`✓ Enrolled ${result.added} ${noun}${result.added === 1 ? '' : 's'}.`];
      if (result.alreadyEnrolled.length) parts.push(`${result.alreadyEnrolled.length} already enrolled.`);
      if (result.failed.length) parts.push(`${result.failed.length} could not be saved — try again.`);
      if (!result.persisted) parts.push('(Saved on this device only — the database could not be reached.)');
      const welcome = await welcomeNewMembers(result.addedMembers);
      if (welcome) parts.push(welcome);
      setNotice({ type: result.failed.length ? 'error' : 'success', message: parts.join(' ') });
      if (result.failed.length === 0) {
        setBulkText('');
        setBulkFileResult(null);
        setBulkFileName('');
      }
      await loadRoster();
      if (onMemberAdded && result.added) onMemberAdded(course.id, result.added);
    } catch (err) {
      setNotice({ type: 'error', message: err.message || 'Bulk enrolment failed.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredExistingStudents = existingStudents.filter(s => {
    if (!searchStudentQuery.trim()) return true;
    const q = searchStudentQuery.toLowerCase();
    const fullName = `${s.legalFirstName || ''} ${s.legalFamilyName || ''}`.toLowerCase();
    const emailStr = (s.personalEmail || s.email || '').toLowerCase();
    return fullName.includes(q) || emailStr.includes(q);
  });

  return (
    <div className="modal-overlay" style={{
      position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '16px'
    }}>
      <div className="modal-content glass" style={{
        maxWidth: '680px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
        borderRadius: '24px', padding: '28px', border: '1px solid rgba(255, 255, 255, 0.15)',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95))',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '1.4rem' }}>👥</span>
              <h3 style={{ margin: 0, fontSize: '1.35rem', color: '#fff' }}>
                Add Members to Course
              </h3>
            </div>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.92rem' }}>
              {course.title} {course.code ? `(${course.code})` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="nav-btn secondary"
            style={{ width: '36px', height: '36px', padding: 0, borderRadius: '50%', fontSize: '1.2rem' }}
          >
            ×
          </button>
        </div>

        {/* Free Teacher Privilege Banner */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(52, 211, 153, 0.08))',
          border: '1px solid rgba(52, 211, 153, 0.35)',
          borderRadius: '14px',
          padding: '12px 16px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span style={{ fontSize: '1.5rem' }}>🎓</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#34d399', fontSize: '0.92rem' }}>
              Enrolment Privilege: 0 Tokens Required
            </div>
            <div style={{ fontSize: '0.82rem', color: '#cbd5e1' }}>
              Teachers, admins, superadmins, COOs, and CFOs can add any supporter or student to this course free of charge. No tokens will be deducted.
            </div>
          </div>
          <span style={{
            background: '#065f46',
            color: '#a7f3d0',
            fontSize: '0.78rem',
            fontWeight: 800,
            padding: '4px 10px',
            borderRadius: '999px',
            letterSpacing: '0.5px'
          }}>
            FREE • 0 🪙
          </span>
        </div>

        {userProfile && !canEnrolInCourses(userProfile) && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '12px',
            padding: '12px 16px',
            color: '#fca5a5',
            fontSize: '0.88rem',
            marginBottom: '16px'
          }}>
            🔒 Enrolment Restricted: Only teachers, admin, superadmin, COO, and CFO can add members to courses.
          </div>
        )}

        {/* Notice alert */}
        {notice && (
          <div style={{
            padding: '10px 14px',
            borderRadius: '10px',
            marginBottom: '16px',
            fontSize: '0.88rem',
            background: notice.type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
            border: `1px solid ${notice.type === 'error' ? '#ef4444' : '#10b981'}`,
            color: notice.type === 'error' ? '#fca5a5' : '#86efac'
          }}>
            {notice.message}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '10px', marginBottom: '18px' }}>
          <button
            className={`nav-btn ${activeTab === 'add-new' ? 'primary' : 'secondary'}`}
            style={{ padding: '6px 14px', fontSize: '0.85rem' }}
            onClick={() => setActiveTab('add-new')}
          >
            ➕ Add Person by Name/Email
          </button>
          <button
            className={`nav-btn ${activeTab === 'bulk' ? 'primary' : 'secondary'}`}
            style={{ padding: '6px 14px', fontSize: '0.85rem' }}
            onClick={() => setActiveTab('bulk')}
          >
            📋 Bulk / Spreadsheet
          </button>
          <button
            className={`nav-btn ${activeTab === 'pick-existing' ? 'primary' : 'secondary'}`}
            style={{ padding: '6px 14px', fontSize: '0.85rem' }}
            onClick={() => setActiveTab('pick-existing')}
          >
            📋 Pick Registered Students ({existingStudents.length})
          </button>
          <button
            className={`nav-btn ${activeTab === 'roster' ? 'primary' : 'secondary'}`}
            style={{ padding: '6px 14px', fontSize: '0.85rem' }}
            onClick={() => setActiveTab('roster')}
          >
            👥 Enrolled Roster ({roster.length})
          </button>
        </div>

        {/* Tab 1: Add New */}
        {activeTab === 'add-new' && (
          <form onSubmit={handleAddMember} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                Full Name
              </label>
              <input
                type="text"
                className="form-input"
                style={{ width: '100%' }}
                placeholder="e.g. Liam Johnson"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                Email Address
              </label>
              <input
                type="email"
                className="form-input"
                style={{ width: '100%' }}
                placeholder="e.g. liam.johnson@school.edu.au"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                Role in Course
              </label>
              <select
                className="form-input"
                style={{ width: '100%', appearance: 'auto', backgroundColor: '#0f291e' }}
                value={role}
                onChange={e => setRole(e.target.value)}
              >
                <option value="student">🎓 Student (Enrolled Learner)</option>
                <option value="teacher">👨‍🏫 Teacher (Co-Instructor / Facilitator)</option>
                <option value="guest">👁️ Guest / Observer (Audit Access)</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button
                type="button"
                className="nav-btn secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="nav-btn primary"
                disabled={isSubmitting}
                style={{
                  background: 'linear-gradient(135deg, #059669, #10b981)',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}
              >
                {isSubmitting ? 'Enrolling...' : '✓ Enrol to Course (0 Tokens)'}
              </button>
            </div>
          </form>
        )}

        {/* Tab: Bulk / Spreadsheet enrolment */}
        {activeTab === 'bulk' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8' }} htmlFor="bulk-emails">
              Paste student emails — one per line or separated by commas. Names are optional, e.g. Jane Doe &lt;jane@school.edu&gt;
            </label>
            <textarea
              id="bulk-emails"
              className="form-input"
              rows={6}
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              placeholder={'jane.doe@school.edu.au\nLiam Smith <liam.smith@school.edu.au>\nmia@example.com, Mia Chen'}
            />
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="nav-btn secondary" style={{ padding: '6px 14px', fontSize: '0.85rem', cursor: isReadingBulkFile ? 'wait' : 'pointer' }}>
                {isReadingBulkFile ? 'Reading…' : '⬆ Upload spreadsheet (.xlsx / .csv)'}
                <input type="file" accept={SPREADSHEET_FILE_ACCEPT} multiple style={{ display: 'none' }} disabled={isReadingBulkFile} onChange={e => { handleBulkFile(e.target.files); e.target.value = ''; }} />
              </label>
              <button type="button" className="nav-btn secondary" style={{ padding: '6px 14px', fontSize: '0.85rem' }} onClick={handleDownloadRosterTemplate}>
                ⬇ Roster template
              </button>
              {bulkFileName && (
                <span style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                  {bulkFileName}: {bulkFileResult?.members.length || 0} emails
                  <button type="button" onClick={() => { setBulkFileResult(null); setBulkFileName(''); }} style={{ background: 'none', color: '#f87171', padding: '0 6px', fontSize: '0.8rem' }} aria-label="Remove uploaded file">✕</button>
                </span>
              )}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }} htmlFor="bulk-role">Role in course</label>
              <select id="bulk-role" className="form-input" style={{ width: '100%', appearance: 'auto', backgroundColor: '#0f291e' }} value={bulkRole} onChange={e => setBulkRole(e.target.value)}>
                <option value="student">🎓 Students</option>
                <option value="teacher">👨‍🏫 Co-teachers</option>
                <option value="guest">👁️ Guests / Observers</option>
              </select>
            </div>
            <div style={{ fontSize: '0.85rem', color: '#e2e8f0', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', padding: '10px 12px' }}>
              <strong>{bulkNew.length}</strong> to enrol
              {bulkAlready > 0 && <> • <strong>{bulkAlready}</strong> already enrolled</>}
              {bulkPreview.invalid.length > 0 && (
                <div style={{ color: '#fca5a5', marginTop: '4px' }}>
                  {bulkPreview.invalid.length} invalid: {bulkPreview.invalid.slice(0, 6).join(', ')}{bulkPreview.invalid.length > 6 ? '…' : ''}
                </div>
              )}
              {bulkNew.length > MAX_BULK_MEMBERS && (
                <div style={{ color: '#fca5a5', marginTop: '4px' }}>Enrol at most {MAX_BULK_MEMBERS.toLocaleString()} people at a time.</div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" className="nav-btn secondary" onClick={onClose}>Close</button>
              <button
                type="button"
                className="nav-btn primary"
                disabled={isSubmitting || bulkNew.length === 0 || bulkNew.length > MAX_BULK_MEMBERS}
                onClick={handleBulkEnrol}
                style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}
              >
                {isSubmitting ? 'Enrolling…' : `✓ Enrol ${bulkNew.length} (0 Tokens)`}
              </button>
            </div>
            <p style={{ margin: 0, fontSize: '0.78rem', color: '#94a3b8' }}>
              Students sign in with Google using these emails, and the course appears in their 🎓 Student Panel. Each new person also gets a welcome message.
            </p>
          </div>
        )}

        {/* Tab 2: Pick Existing */}
        {activeTab === 'pick-existing' && (
          <div>
            <input
              type="text"
              className="form-input"
              style={{ width: '100%', marginBottom: '14px' }}
              placeholder="Search registered students by name or email..."
              value={searchStudentQuery}
              onChange={e => setSearchStudentQuery(e.target.value)}
            />

            {filteredExistingStudents.length === 0 ? (
              <p style={{ color: '#94a3b8', textAlign: 'center', padding: '24px 0' }}>
                No registered students found matching your query.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
                {filteredExistingStudents.map(student => {
                  const fullName = `${student.legalFirstName || ''} ${student.legalFamilyName || ''}`.trim() || student.preferredName || 'Student';
                  const isAlreadyEnrolled = roster.some(m => m.memberEmail && m.memberEmail === (student.personalEmail || student.email));

                  return (
                    <div
                      key={student.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        borderRadius: '12px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.92rem' }}>
                          {fullName}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                          {student.personalEmail || student.email || student.id}
                        </div>
                      </div>

                      <button
                        className="nav-btn primary"
                        style={{
                          fontSize: '0.82rem',
                          padding: '6px 12px',
                          background: isAlreadyEnrolled ? 'rgba(52, 211, 153, 0.2)' : 'linear-gradient(135deg, #059669, #10b981)',
                          border: isAlreadyEnrolled ? '1px solid #34d399' : 'none'
                        }}
                        disabled={isSubmitting || isAlreadyEnrolled}
                        onClick={() => handleQuickAddExistingStudent(student)}
                      >
                        {isAlreadyEnrolled ? '✓ Enrolled' : '+ Add (0 🪙)'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Enrolled Roster */}
        {activeTab === 'roster' && (
          <div>
            {isLoadingRoster ? (
              <p style={{ color: '#94a3b8', textAlign: 'center', padding: '24px 0' }}>
                Loading course members...
              </p>
            ) : roster.length === 0 ? (
              <p style={{ color: '#94a3b8', textAlign: 'center', padding: '24px 0' }}>
                No members currently enrolled in this course. You can add students, teachers, or guests above!
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '340px', overflowY: 'auto' }}>
                {roster.map(member => (
                  <div
                    key={member.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 14px',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 600, color: '#f8fafc' }}>
                          {member.memberName || 'Unnamed Participant'}
                        </span>
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                          background: member.memberRole === 'teacher' ? 'rgba(245, 158, 11, 0.2)' : member.memberRole === 'guest' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(52, 211, 153, 0.2)',
                          color: member.memberRole === 'teacher' ? '#fde047' : member.memberRole === 'guest' ? '#cbd5e1' : '#86efac'
                        }}>
                          {member.memberRole || 'Student'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                        {member.memberEmail || 'No email provided'} • Added {member.enrolledAt ? new Date(member.enrolledAt).toLocaleDateString() : 'recently'}
                      </div>
                    </div>

                    <button
                      className="nav-btn secondary"
                      style={{ fontSize: '0.8rem', padding: '4px 10px', color: '#f87171', borderColor: 'rgba(248, 113, 113, 0.3)' }}
                      onClick={() => handleRemoveMember(member)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
