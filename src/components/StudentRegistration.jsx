// src/components/StudentRegistration.jsx
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { listSiteStudents, saveStudent, deleteStudent, validateStudent, isDbAvailable } from '../services/lmsRepository';
import { 
  INITIAL_STUDENT_FORM, 
  INITIAL_SAMPLE_STUDENTS, 
  CSV_STUDENT_TEMPLATE, 
  parseStudentCsv,
  RESIDENCY_TYPES,
  JURISDICTIONS,
  STUDY_MODES,
  ATTENDANCE_LOADS,
  TUITION_METHODS
} from '../services/studentService';
import { formatLocalizedDate } from '../services/geminiCourseService';

export default function StudentRegistration({ myCourses = [], onUpdateCourses }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterResidency, setFilterResidency] = useState('ALL');
  const [filterProgram, setFilterProgram] = useState('ALL');

  // Enrolment Modal State
  const [isEnrolModalOpen, setIsEnrolModalOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(1);
  const [formData, setFormData] = useState(INITIAL_STUDENT_FORM);
  const [isEditingId, setIsEditingId] = useState(null);

  // Bulk Upload Modal State
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkCsvText, setBulkCsvText] = useState('');
  const [bulkParsedStudents, setBulkParsedStudents] = useState([]);
  const [bulkError, setBulkError] = useState('');
  const [bulkSuccessMsg, setBulkSuccessMsg] = useState('');

  // Dossier View Modal State
  const [selectedStudentForDossier, setSelectedStudentForDossier] = useState(null);

  // Load students from Firestore (lms_students + unmigrated legacy) on mount
  useEffect(() => {
    let cancelled = false;
    const loadStudents = async () => {
      setLoading(true);
      try {
        if (!isDbAvailable()) throw new Error('Database unavailable');
        const { students: list } = await listSiteStudents();
        if (cancelled) return;
        // Demo records are shown locally only; they are never auto-written to the shared network DB.
        setStudents(list.length ? list : INITIAL_SAMPLE_STUDENTS);
      } catch (err) {
        console.warn("Firestore load students error, using local state:", err);
        if (!cancelled) setStudents(INITIAL_SAMPLE_STUDENTS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadStudents();
    return () => { cancelled = true; };
  }, []);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleOpenNewEnrolment = () => {
    setFormData({
      ...INITIAL_STUDENT_FORM,
      id: `STU-${new Date().getFullYear()}-${String(students.length + 101).padStart(3, '0')}`
    });
    setIsEditingId(null);
    setActiveStep(1);
    setIsEnrolModalOpen(true);
  };

  const handleEditStudent = (student) => {
    setFormData({ ...student });
    setIsEditingId(student.id);
    setActiveStep(1);
    setIsEnrolModalOpen(true);
  };

  const handleSaveStudent = async () => {
    const validationErrors = validateStudent(formData);
    if (validationErrors.length) {
      alert(validationErrors.join('\n'));
      setActiveStep(1);
      return;
    }

    const studentToSave = {
      ...formData,
      id: isEditingId || formData.id || `STU-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
      lastUpdated: new Date().toISOString()
    };

    // Only courses newly added in this save should bump enrolment counters.
    const previous = isEditingId ? students.find(s => s.id === isEditingId) : null;
    const previousIds = new Set((previous?.enrolledCourseIds || []).map(String));
    const newlyAddedCourseIds = (studentToSave.enrolledCourseIds || []).map(String).filter(id => !previousIds.has(id));

    // Update local state
    setStudents(prev => isEditingId
      ? prev.map(s => s.id === isEditingId ? studentToSave : s)
      : [studentToSave, ...prev]);
    setIsEnrolModalOpen(false);

    // Save to Cloud Firestore (lms_students + private/sensitive)
    try {
      await saveStudent(studentToSave);
    } catch (err) {
      console.error("Error saving student to Firestore:", err);
      alert('Student updated locally, but saving to the cloud failed. Please try again.\n\n' + (err?.message || ''));
      return;
    }

    if (onUpdateCourses && newlyAddedCourseIds.length) {
      onUpdateCourses(newlyAddedCourseIds);
    }
  };

  const handleDeleteStudent = async (studentId) => {
    if (!window.confirm("Are you sure you want to remove this enrolled student record?")) return;
    setStudents(prev => prev.filter(s => s.id !== studentId));
    if (selectedStudentForDossier?.id === studentId) {
      setSelectedStudentForDossier(null);
    }
    try {
      await deleteStudent(studentId);
    } catch (err) {
      console.error("Error deleting student from Firestore:", err);
    }
  };

  // Bulk Upload Handlers
  const handleParseBulkCsv = () => {
    setBulkError('');
    try {
      const parsed = parseStudentCsv(bulkCsvText);
      if (parsed.length === 0) {
        setBulkError("No valid student rows recognized. Please ensure headers match the standard template.");
        return;
      }
      setBulkParsedStudents(parsed);
    } catch (err) {
      setBulkError("CSV Parsing failed: " + err.message);
    }
  };

  const handleCommitBulkEnrolment = async () => {
    if (bulkParsedStudents.length === 0) return;
    
    // Merge with current students
    setStudents(prev => [...bulkParsedStudents, ...prev]);
    setBulkSuccessMsg(`Successfully enrolled ${bulkParsedStudents.length} students!`);

    // Sync each to Firestore (lms_students)
    let failed = 0;
    for (const stu of bulkParsedStudents) {
      try {
        await saveStudent(stu);
      } catch (err) {
        failed++;
        console.warn("Firestore bulk item save note:", err);
      }
    }
    if (failed) {
      setBulkSuccessMsg(`Enrolled ${bulkParsedStudents.length - failed} of ${bulkParsedStudents.length} to the cloud. ${failed} saved locally only.`);
    }

    setTimeout(() => {
      setIsBulkModalOpen(false);
      setBulkCsvText('');
      setBulkParsedStudents([]);
      setBulkSuccessMsg('');
    }, 1500);
  };

  const handleDownloadCsvTemplate = () => {
    const blob = new Blob([CSV_STUDENT_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `University_Student_Enrolment_Template.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered Students
  const filteredStudents = students.filter(s => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = 
      (s.legalFirstName || '').toLowerCase().includes(q) ||
      (s.legalFamilyName || '').toLowerCase().includes(q) ||
      (s.preferredName || '').toLowerCase().includes(q) ||
      (s.personalEmail || '').toLowerCase().includes(q) ||
      (s.id || '').toLowerCase().includes(q) ||
      (s.nationalIdNumber || '').toLowerCase().includes(q) ||
      (s.degreeTitle || '').toLowerCase().includes(q);

    const matchesResidency = 
      filterResidency === 'ALL' ||
      (filterResidency === 'DOMESTIC' && s.residencyStatus?.toLowerCase().includes('domestic')) ||
      (filterResidency === 'INTERNATIONAL' && s.residencyStatus?.toLowerCase().includes('international'));

    const matchesProgram = 
      filterProgram === 'ALL' || s.degreeTitle === filterProgram;

    return matchesSearch && matchesResidency && matchesProgram;
  });

  const domesticCount = students.filter(s => s.residencyStatus?.toLowerCase().includes('domestic')).length;
  const internationalCount = students.filter(s => s.residencyStatus?.toLowerCase().includes('international')).length;
  const uniquePrograms = Array.from(new Set(students.map(s => s.degreeTitle).filter(Boolean)));

  return (
    <div className="student-reg-container animate-fade-in-up">
      {/* Centered Action & Header Hero in the middle of the screen */}
      <div className="glass student-header-card student-centered-hero">
        <div className="badge-row" style={{ justifyContent: 'center' }}>
          <span className="gold-pill">🏛️ Academic Registry</span>
        </div>
        <h2 style={{ fontSize: '2.2rem', margin: '8px 0 6px 0', color: 'var(--text-primary)', textAlign: 'center' }}>
          Student Enrolment & Admissions Registry
        </h2>
        <p style={{ color: 'var(--text-secondary)', margin: '0 auto 20px auto', fontSize: '1rem', maxWidth: '780px', textAlign: 'center', lineHeight: '1.5' }}>
          Comprehensive institutional onboarding satisfying statutory regulatory reporting, 
          academic credentials verification, fee structures, and student welfare declarations.
        </p>

        {/* Action Buttons in the Middle of the Screen */}
        <div className="hero-center-actions">
          <button 
            className="nav-btn primary hero-action-btn" 
            onClick={handleOpenNewEnrolment}
          >
            <span style={{ fontSize: '1.25rem' }}>+</span>
            <span>Enrol Student</span>
          </button>
          <button 
            className="nav-btn secondary hero-action-btn" 
            onClick={() => { setIsBulkModalOpen(true); setBulkSuccessMsg(''); setBulkError(''); }}
          >
            <span style={{ fontSize: '1.15rem' }}>⚡</span>
            <span>Bulk Upload (Sheet / CSV)</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="kpi-grid">
        <div className="glass kpi-card">
          <div className="kpi-icon">🎓</div>
          <div>
            <div className="kpi-label">Total Enrolled</div>
            <div className="kpi-value">{students.length}</div>
          </div>
        </div>
        <div className="glass kpi-card">
          <div className="kpi-icon">🇦🇺</div>
          <div>
            <div className="kpi-label">Domestic Students</div>
            <div className="kpi-value">{domesticCount}</div>
          </div>
        </div>
        <div className="glass kpi-card">
          <div className="kpi-icon">🌏</div>
          <div>
            <div className="kpi-label">International (Visa 500)</div>
            <div className="kpi-value">{internationalCount}</div>
          </div>
        </div>
        <div className="glass kpi-card">
          <div className="kpi-icon">📚</div>
          <div>
            <div className="kpi-label">Active Degree Programs</div>
            <div className="kpi-value">{uniquePrograms.length}</div>
          </div>
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="glass filter-bar">
        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input 
            type="text" 
            placeholder="Search by student name, email, student ID, USI or degree..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="filter-select-group">
          <select 
            value={filterResidency} 
            onChange={(e) => setFilterResidency(e.target.value)}
            className="filter-select"
          >
            <option value="ALL">All Residencies</option>
            <option value="DOMESTIC">Domestic Citizens & PR</option>
            <option value="INTERNATIONAL">International (Visa 500)</option>
          </select>

          <select 
            value={filterProgram} 
            onChange={(e) => setFilterProgram(e.target.value)}
            className="filter-select"
          >
            <option value="ALL">All Degree Programs</option>
            {uniquePrograms.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Students Directory / Roster */}
      <div className="glass roster-card">
        <div className="roster-header">
          <h3>Enrolled Student Dossiers ({filteredStudents.length})</h3>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Showing verified admissions records
          </span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }}></div>
            Loading admissions registry from Cloud Firestore...
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="empty-roster">
            <p>No students match your query. Click <strong>+ Enrol Student</strong> or <strong>⚡ Bulk Upload</strong> to add records.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>Student ID</th>
                  <th>Legal & Preferred Name</th>
                  <th>Residency & ID</th>
                  <th>Degree & Major</th>
                  <th>Mode & Campus</th>
                  <th>Tuition & Health</th>
                  <th>LMS Courses</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map(student => {
                  const isIntl = student.residencyStatus?.toLowerCase().includes('international');
                  return (
                    <tr key={student.id}>
                      <td>
                        <span className="student-id-badge">{student.id}</span>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                          DOB: {formatLocalizedDate(student.dateOfBirth)}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {student.legalFirstName} {student.legalFamilyName}
                        </div>
                        {student.preferredName && student.preferredName !== `${student.legalFirstName} ${student.legalFamilyName}` && (
                          <div style={{ fontSize: '0.8rem', color: '#fef08a' }}>
                            Preferred: {student.preferredName}
                          </div>
                        )}
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {student.personalEmail}
                        </div>
                      </td>
                      <td>
                        <span className={`pill-badge ${isIntl ? 'pill-blue' : 'pill-green'}`}>
                          {isIntl ? '🌏 International' : '🇦🇺 Domestic'}
                        </span>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          {student.jurisdiction === 'Australia' ? `USI: ${student.nationalIdNumber || 'Verified'}` : `ID: ${student.nationalIdNumber || 'Recorded'}`}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{student.degreeTitle}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {student.majorSpecialisation}
                        </div>
                      </td>
                      <td>
                        <div>{student.studyMode}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          {student.campusLocation}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.85rem' }}>{student.tuitionPaymentMethod}</div>
                        <div style={{ fontSize: '0.78rem', color: '#93c5fd' }}>
                          {student.healthCoverProvider || 'Medicare Domestic'}
                        </div>
                      </td>
                      <td>
                        <span className="badge-enrolled-courses">
                          {student.enrolledCourseIds?.length || 0} unit(s)
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="action-buttons-cell">
                          <button 
                            className="btn-action-view" 
                            title="View Full Dossier"
                            onClick={() => setSelectedStudentForDossier(student)}
                          >
                            👁️ Dossier
                          </button>
                          <button 
                            className="btn-action-edit" 
                            title="Edit Record"
                            onClick={() => handleEditStudent(student)}
                          >
                            ✏️
                          </button>
                          <button 
                            className="btn-action-delete" 
                            title="Delete Student"
                            onClick={() => handleDeleteStudent(student.id)}
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: 7-Category Comprehensive Student Enrolment Wizard               */}
      {/* ========================================================================= */}
      {isEnrolModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="modal-overlay" onClick={() => setIsEnrolModalOpen(false)}>
          <div className="modal-content glass student-wizard-modal" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="wizard-modal-header">
              <div>
                <span className="gold-pill">Regulatory Institutional Enrolment</span>
                <h3 style={{ margin: '6px 0 0 0', color: 'var(--text-primary)', fontSize: '1.4rem' }}>
                  {isEditingId ? `Edit Student Record (${formData.id})` : 'New Student Admission & Enrolment'}
                </h3>
              </div>
              <button className="close-btn" onClick={() => setIsEnrolModalOpen(false)}>×</button>
            </div>

            {/* Stepper Tabs */}
            <div className="wizard-stepper">
              {[
                { step: 1, title: '1. Identity & Personal', icon: '👤' },
                { step: 2, title: '2. Contact & Emergency', icon: '📞' },
                { step: 3, title: '3. Academic History', icon: '📜' },
                { step: 4, title: '4. Regulatory & Identifiers', icon: '🏛️' },
                { step: 5, title: '5. Program & Study Load', icon: '🎓' },
                { step: 6, title: '6. Billing & Financial', icon: '💳' },
                { step: 7, title: '7. Equity & Declarations', icon: '⚖️' },
              ].map(s => (
                <button 
                  key={s.step}
                  type="button"
                  className={`step-tab ${activeStep === s.step ? 'active' : ''}`}
                  onClick={() => setActiveStep(s.step)}
                >
                  <span className="step-icon">{s.icon}</span>
                  <span className="step-text">{s.title}</span>
                </button>
              ))}
            </div>

            {/* Wizard Body */}
            <div className="wizard-body">
              {/* STEP 1: Identity & Personal Details */}
              {activeStep === 1 && (
                <div className="wizard-step-pane">
                  <h4 className="pane-title">1. Identity & Personal Details</h4>
                  <p className="pane-desc">Legal name, identification, date of birth, and citizenship/residency documentation.</p>

                  <div className="form-grid-3">
                    <div className="form-group">
                      <label>Legal First Name *</label>
                      <input 
                        type="text" 
                        value={formData.legalFirstName} 
                        onChange={e => handleInputChange('legalFirstName', e.target.value)}
                        placeholder="e.g. Chloe"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Legal Middle Name(s)</label>
                      <input 
                        type="text" 
                        value={formData.legalMiddleName} 
                        onChange={e => handleInputChange('legalMiddleName', e.target.value)}
                        placeholder="e.g. Grace"
                      />
                    </div>
                    <div className="form-group">
                      <label>Legal Family / Surname *</label>
                      <input 
                        type="text" 
                        value={formData.legalFamilyName} 
                        onChange={e => handleInputChange('legalFamilyName', e.target.value)}
                        placeholder="e.g. Campbell"
                        required
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Preferred Name (for class rosters & campus display)</label>
                      <input 
                        type="text" 
                        value={formData.preferredName} 
                        onChange={e => handleInputChange('preferredName', e.target.value)}
                        placeholder="e.g. Chloe Campbell"
                      />
                    </div>
                    <div className="form-group">
                      <label>Gender / Sex</label>
                      <select 
                        value={formData.gender} 
                        onChange={e => handleInputChange('gender', e.target.value)}
                      >
                        <option value="Female">Female</option>
                        <option value="Male">Male</option>
                        <option value="Non-binary">Non-binary</option>
                        <option value="Different identity">Different identity</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Date of Birth (ISO 8601 YYYY-MM-DD)</label>
                      <input 
                        type="date" 
                        value={formData.dateOfBirth} 
                        onChange={e => handleInputChange('dateOfBirth', e.target.value)}
                      />
                      <span className="date-preview-text">
                        📅 Localized: {formatLocalizedDate(formData.dateOfBirth)}
                      </span>
                    </div>

                    <div className="form-group">
                      <label>Residency & Citizenship Status *</label>
                      <select 
                        value={formData.residencyStatus} 
                        onChange={e => handleInputChange('residencyStatus', e.target.value)}
                      >
                        <option value={RESIDENCY_TYPES.DOMESTIC_CITIZEN}>Australian / Domestic Citizen</option>
                        <option value={RESIDENCY_TYPES.DOMESTIC_PR}>Australian Permanent Resident</option>
                        <option value={RESIDENCY_TYPES.INTERNATIONAL_STUDENT}>International Student (Visa 500)</option>
                        <option value={RESIDENCY_TYPES.HUMANITARIAN_REFUGEE}>Humanitarian / Refugee Visa</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-grid-3">
                    <div className="form-group">
                      <label>Proof of Identity Document</label>
                      <select 
                        value={formData.proofOfIdentityType} 
                        onChange={e => handleInputChange('proofOfIdentityType', e.target.value)}
                      >
                        <option value="Driver's Licence">Driver's Licence</option>
                        <option value="Australian Passport">Australian Passport</option>
                        <option value="International Passport">International Passport</option>
                        <option value="National Identity Card">National Identity Card</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>ID / Passport Document Number</label>
                      <input 
                        type="text" 
                        value={formData.proofOfIdentityNumber} 
                        onChange={e => handleInputChange('proofOfIdentityNumber', e.target.value)}
                        placeholder="e.g. N4892104"
                      />
                    </div>
                    <div className="form-group">
                      <label>Confirmation of Enrolment (CoE) / Visa</label>
                      <input 
                        type="text" 
                        value={formData.coeNumber} 
                        onChange={e => handleInputChange('coeNumber', e.target.value)}
                        placeholder="e.g. COE-991204 / Visa Subclass 500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: Contact & Emergency Information */}
              {activeStep === 2 && (
                <div className="wizard-step-pane">
                  <h4 className="pane-title">2. Contact & Emergency Information</h4>
                  <p className="pane-desc">Permanent home address, local term address, primary contacts, and next of kin.</p>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Primary Mobile Phone *</label>
                      <input 
                        type="tel" 
                        value={formData.primaryPhone} 
                        onChange={e => handleInputChange('primaryPhone', e.target.value)}
                        placeholder="+61 412 345 678"
                      />
                    </div>
                    <div className="form-group">
                      <label>Personal Email Address *</label>
                      <input 
                        type="email" 
                        value={formData.personalEmail} 
                        onChange={e => handleInputChange('personalEmail', e.target.value)}
                        placeholder="student.personal@example.com"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Permanent Home Address (Legal Residence)</label>
                    <textarea 
                      rows="2"
                      value={formData.permanentAddress} 
                      onChange={e => handleInputChange('permanentAddress', e.target.value)}
                      placeholder="e.g. 42 Wallaby Way, Sydney NSW 2000, Australia (or overseas home address for international students)"
                    />
                  </div>

                  <div className="form-group">
                    <label>Current / Term Residential Address (Local while studying)</label>
                    <textarea 
                      rows="2"
                      value={formData.currentTermAddress} 
                      onChange={e => handleInputChange('currentTermAddress', e.target.value)}
                      placeholder="e.g. Campus College Residence or local rental apartment"
                    />
                  </div>

                  <h5 style={{ color: '#fef08a', margin: '20px 0 10px 0' }}>Next of Kin / Emergency Contact</h5>
                  <div className="form-grid-4">
                    <div className="form-group">
                      <label>Full Contact Name</label>
                      <input 
                        type="text" 
                        value={formData.emergencyContactName} 
                        onChange={e => handleInputChange('emergencyContactName', e.target.value)}
                        placeholder="e.g. David Campbell"
                      />
                    </div>
                    <div className="form-group">
                      <label>Relationship</label>
                      <input 
                        type="text" 
                        value={formData.emergencyContactRelationship} 
                        onChange={e => handleInputChange('emergencyContactRelationship', e.target.value)}
                        placeholder="e.g. Parent / Guardian"
                      />
                    </div>
                    <div className="form-group">
                      <label>Emergency Phone</label>
                      <input 
                        type="tel" 
                        value={formData.emergencyContactPhone} 
                        onChange={e => handleInputChange('emergencyContactPhone', e.target.value)}
                        placeholder="+61 412 999 888"
                      />
                    </div>
                    <div className="form-group">
                      <label>Location / Country</label>
                      <input 
                        type="text" 
                        value={formData.emergencyContactLocation} 
                        onChange={e => handleInputChange('emergencyContactLocation', e.target.value)}
                        placeholder="e.g. Sydney, Australia"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Academic History & Admissions Verification */}
              {activeStep === 3 && (
                <div className="wizard-step-pane">
                  <h4 className="pane-title">3. Academic History & Admissions Verification</h4>
                  <p className="pane-desc">Prior education credentials, recognition of prior learning (RPL), language proficiency and prerequisites.</p>

                  <div className="form-group">
                    <label>Prior Education Credentials & Qualifications</label>
                    <input 
                      type="text" 
                      value={formData.priorEducation} 
                      onChange={e => handleInputChange('priorEducation', e.target.value)}
                      placeholder="e.g. High School Completion (ATAR 88.50) / Bachelor of Science, Melbourne Uni"
                    />
                  </div>

                  <div className="form-group">
                    <label>Credit Transfer / Recognition of Prior Learning (RPL)</label>
                    <input 
                      type="text" 
                      value={formData.creditTransferRPL} 
                      onChange={e => handleInputChange('creditTransferRPL', e.target.value)}
                      placeholder="e.g. 12 Credit Points approved for Intro to Computing, or 'None requested'"
                    />
                  </div>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Language Proficiency Evidence</label>
                      <select 
                        value={formData.languageProficiencyType} 
                        onChange={e => handleInputChange('languageProficiencyType', e.target.value)}
                      >
                        <option value="Native English / Prior English Medium">Native English / Prior Medium of Instruction</option>
                        <option value="IELTS Academic">IELTS Academic</option>
                        <option value="TOEFL iBT">TOEFL iBT</option>
                        <option value="PTE Academic">PTE Academic</option>
                        <option value="Cambridge C1/C2">Cambridge Advanced (CAE)</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Language Test Score / Verification</label>
                      <input 
                        type="text" 
                        value={formData.languageScore} 
                        onChange={e => handleInputChange('languageScore', e.target.value)}
                        placeholder="e.g. 7.5 Overall (min 7.0 in all bands) or Native"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Prerequisite Compliance Notes</label>
                    <input 
                      type="text" 
                      value={formData.prerequisiteNotes} 
                      onChange={e => handleInputChange('prerequisiteNotes', e.target.value)}
                      placeholder="e.g. Maths Advanced Band 5 met, Chemistry prerequisite verified"
                    />
                  </div>
                </div>
              )}

              {/* STEP 4: Regulatory & Government Identifiers */}
              {activeStep === 4 && (
                <div className="wizard-step-pane">
                  <h4 className="pane-title">4. Regulatory & Government Identifiers</h4>
                  <p className="pane-desc">Mandatory government student identifiers (USI, SSN, ULN) and demographic statistical reporting.</p>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Jurisdiction</label>
                      <select 
                        value={formData.jurisdiction} 
                        onChange={e => handleInputChange('jurisdiction', e.target.value)}
                      >
                        <option value={JURISDICTIONS.AUSTRALIA}>Australia (USI - Unique Student Identifier)</option>
                        <option value={JURISDICTIONS.US}>United States (SSN / ITIN)</option>
                        <option value={JURISDICTIONS.UK}>United Kingdom (ULN - Unique Learner Number)</option>
                        <option value={JURISDICTIONS.OTHER}>Other / International</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>
                        {formData.jurisdiction === JURISDICTIONS.AUSTRALIA 
                          ? 'Australian Unique Student Identifier (USI) *' 
                          : 'National Student Identifier *'}
                      </label>
                      <input 
                        type="text" 
                        value={formData.nationalIdNumber} 
                        onChange={e => handleInputChange('nationalIdNumber', e.target.value)}
                        placeholder={formData.jurisdiction === JURISDICTIONS.AUSTRALIA ? '10-character USI (e.g. 1004928190)' : 'Government ID Number'}
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Indigenous / First Nations Status</label>
                      <select 
                        value={formData.indigenousStatus} 
                        onChange={e => handleInputChange('indigenousStatus', e.target.value)}
                      >
                        <option value="Neither Aboriginal nor Torres Strait Islander">Neither Aboriginal nor Torres Strait Islander</option>
                        <option value="Aboriginal">Aboriginal</option>
                        <option value="Torres Strait Islander">Torres Strait Islander</option>
                        <option value="Both Aboriginal and Torres Strait Islander">Both Aboriginal and Torres Strait Islander</option>
                        <option value="Not Applicable (International)">Not Applicable (International)</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Language Spoken at Home</label>
                      <input 
                        type="text" 
                        value={formData.homeLanguage} 
                        onChange={e => handleInputChange('homeLanguage', e.target.value)}
                        placeholder="e.g. English, Mandarin, Arabic, Vietnamese, Spanish"
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Country of Birth</label>
                      <input 
                        type="text" 
                        value={formData.countryOfBirth} 
                        onChange={e => handleInputChange('countryOfBirth', e.target.value)}
                        placeholder="e.g. Australia, India, China, United Kingdom"
                      />
                    </div>

                    <div className="form-group">
                      <label>Parents' Highest Level of Education</label>
                      <select 
                        value={formData.parentsHighestEducation} 
                        onChange={e => handleInputChange('parentsHighestEducation', e.target.value)}
                      >
                        <option value="Postgraduate Degree">Postgraduate Degree</option>
                        <option value="Bachelor Degree">Bachelor Degree</option>
                        <option value="Vocational / Diploma">Vocational / Diploma (TAFE / College)</option>
                        <option value="Year 12 or equivalent">Year 12 or equivalent</option>
                        <option value="Below Year 12">Below Year 12</option>
                        <option value="Do not wish to disclose">Do not wish to disclose</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 5: Program & Study Load Details */}
              {activeStep === 5 && (
                <div className="wizard-step-pane">
                  <h4 className="pane-title">5. Program & Study Load Details</h4>
                  <p className="pane-desc">Degree program, academic specialisation, study mode, campus location, and LMS course enrolments.</p>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Degree / Award Title *</label>
                      <input 
                        type="text" 
                        value={formData.degreeTitle} 
                        onChange={e => handleInputChange('degreeTitle', e.target.value)}
                        placeholder="e.g. Bachelor of Computer Science, Master of Data Science"
                      />
                    </div>
                    <div className="form-group">
                      <label>Major / Minor Specialisation</label>
                      <input 
                        type="text" 
                        value={formData.majorSpecialisation} 
                        onChange={e => handleInputChange('majorSpecialisation', e.target.value)}
                        placeholder="e.g. Artificial Intelligence & Software Systems"
                      />
                    </div>
                  </div>

                  <div className="form-grid-3">
                    <div className="form-group">
                      <label>Study Mode</label>
                      <select 
                        value={formData.studyMode} 
                        onChange={e => handleInputChange('studyMode', e.target.value)}
                      >
                        {STUDY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Campus Location</label>
                      <input 
                        type="text" 
                        value={formData.campusLocation} 
                        onChange={e => handleInputChange('campusLocation', e.target.value)}
                        placeholder="e.g. Sydney Central, Melbourne Docklands"
                      />
                    </div>
                    <div className="form-group">
                      <label>Attendance Load</label>
                      <select 
                        value={formData.attendanceLoad} 
                        onChange={e => handleInputChange('attendanceLoad', e.target.value)}
                      >
                        {ATTENDANCE_LOADS.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginTop: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                      <label style={{ margin: 0 }}>LMS Unit / Course Enrolments (Select active courses to assign student):</label>
                      <span style={{
                        fontSize: '0.78rem',
                        background: 'rgba(52, 211, 153, 0.15)',
                        border: '1px solid rgba(52, 211, 153, 0.35)',
                        color: '#86efac',
                        padding: '3px 10px',
                        borderRadius: '999px',
                        fontWeight: 700
                      }}>
                        🎓 Teacher Privilege: 0 Tokens Required
                      </span>
                    </div>
                    <div className="course-enrol-checkbox-grid">
                      {myCourses.map(course => {
                        const isEnrolled = formData.enrolledCourseIds?.includes(course.id);
                        return (
                          <label key={course.id} className={`course-checkbox-card ${isEnrolled ? 'selected' : ''}`}>
                            <input 
                              type="checkbox" 
                              checked={isEnrolled}
                              onChange={(e) => {
                                const current = formData.enrolledCourseIds || [];
                                if (e.target.checked) {
                                  handleInputChange('enrolledCourseIds', [...current, course.id]);
                                } else {
                                  handleInputChange('enrolledCourseIds', current.filter(id => id !== course.id));
                                }
                              }}
                            />
                            <div>
                              <strong>{course.title}</strong>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                Starts: {formatLocalizedDate(course.startDate)}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 6: Billing, Fees & Financial Support */}
              {activeStep === 6 && (
                <div className="wizard-step-pane">
                  <h4 className="pane-title">6. Billing, Fees & Financial Support</h4>
                  <p className="pane-desc">Tuition fee payment methods, government support loans (HECS-HELP), sponsorship, and compulsory health insurance.</p>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Tuition Payment Method *</label>
                      <select 
                        value={formData.tuitionPaymentMethod} 
                        onChange={e => handleInputChange('tuitionPaymentMethod', e.target.value)}
                      >
                        {TUITION_METHODS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Government Loan / Subsidy Selection</label>
                      <input 
                        type="text" 
                        value={formData.govLoanType} 
                        onChange={e => handleInputChange('govLoanType', e.target.value)}
                        placeholder="e.g. Commonwealth Supported Place (CSP) with HECS-HELP eCAF"
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Formal Sponsorship / Financial Guarantee</label>
                      <input 
                        type="text" 
                        value={formData.sponsorshipDetails} 
                        onChange={e => handleInputChange('sponsorshipDetails', e.target.value)}
                        placeholder="e.g. N/A or Embassy of France / Employer Direct Billing"
                      />
                    </div>

                    <div className="form-group">
                      <label>Health Cover Provider (OSHC for International, Medicare for Domestic)</label>
                      <input 
                        type="text" 
                        value={formData.healthCoverProvider} 
                        onChange={e => handleInputChange('healthCoverProvider', e.target.value)}
                        placeholder="e.g. Medibank OSHC, Bupa, Allianz, or Medicare Domestic"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Health Cover Policy / Membership Number</label>
                    <input 
                      type="text" 
                      value={formData.healthCoverPolicyNumber} 
                      onChange={e => handleInputChange('healthCoverPolicyNumber', e.target.value)}
                      placeholder="e.g. MB-OSHC-8819203 or Medicare Card Number"
                    />
                  </div>
                </div>
              )}

              {/* STEP 7: Equity, Accessibility & Disclosures */}
              {activeStep === 7 && (
                <div className="wizard-step-pane">
                  <h4 className="pane-title">7. Equity, Accessibility & Mandatory Declarations</h4>
                  <p className="pane-desc">Special considerations, disability support, under-18 arrangements, and mandatory institutional code of conduct.</p>

                  <div className="declaration-card" style={{ marginBottom: '16px' }}>
                    <label className="checkbox-row">
                      <input 
                        type="checkbox" 
                        checked={formData.requiresAccessibilitySupport} 
                        onChange={e => handleInputChange('requiresAccessibilitySupport', e.target.checked)}
                      />
                      <span><strong>Student requests Disability & Accessibility Support Services</strong> (e.g. exam adjustments, hearing loop, campus mobility access).</span>
                    </label>
                    {formData.requiresAccessibilitySupport && (
                      <textarea 
                        rows="2"
                        value={formData.accessibilitySupportDetails} 
                        onChange={e => handleInputChange('accessibilitySupportDetails', e.target.value)}
                        placeholder="Describe required adjustments (e.g. 15 mins extra per hour for written examinations)..."
                        style={{ marginTop: '8px' }}
                      />
                    )}
                  </div>

                  <div className="declaration-card" style={{ marginBottom: '16px' }}>
                    <label className="checkbox-row">
                      <input 
                        type="checkbox" 
                        checked={formData.isMinorUnder18} 
                        onChange={e => handleInputChange('isMinorUnder18', e.target.checked)}
                      />
                      <span><strong>Under-18 Minor Welfare Arrangement Required</strong> (Approved homestay / designated legal guardian).</span>
                    </label>
                    {formData.isMinorUnder18 && (
                      <input 
                        type="text"
                        value={formData.guardianDetails} 
                        onChange={e => handleInputChange('guardianDetails', e.target.value)}
                        placeholder="Guardian Name, Approved Homestay Registration Number & Contact..."
                        style={{ marginTop: '8px' }}
                      />
                    )}
                  </div>

                  <div className="declarations-box glass">
                    <h5 style={{ color: '#fef08a', marginTop: 0 }}>Statutory Institutional Declarations</h5>
                    
                    <label className="checkbox-row">
                      <input 
                        type="checkbox" 
                        checked={formData.declarationConductAgreed} 
                        onChange={e => handleInputChange('declarationConductAgreed', e.target.checked)}
                      />
                      <span>Student agrees to comply with the <strong>University Student Code of Conduct</strong> and Academic Regulations.</span>
                    </label>

                    <label className="checkbox-row">
                      <input 
                        type="checkbox" 
                        checked={formData.declarationPrivacyAgreed} 
                        onChange={e => handleInputChange('declarationPrivacyAgreed', e.target.checked)}
                      />
                      <span>Student consents to the <strong>Privacy and Data Disclosure Policy</strong> for statutory government reporting (HEIMS / TCSI / PRISMS).</span>
                    </label>

                    <label className="checkbox-row">
                      <input 
                        type="checkbox" 
                        checked={formData.declarationIntegrityPledged} 
                        onChange={e => handleInputChange('declarationIntegrityPledged', e.target.checked)}
                      />
                      <span>Student pledges commitment to <strong>Academic Integrity</strong> and ethical conduct in all assessments.</span>
                    </label>

                    <label className="checkbox-row">
                      <input 
                        type="checkbox" 
                        checked={formData.declarationFeeLiabilityAccepted} 
                        onChange={e => handleInputChange('declarationFeeLiabilityAccepted', e.target.checked)}
                      />
                      <span>Student acknowledges official <strong>Census Dates, Tuition Fee Liability</strong>, and refund schedule rules.</span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Wizard Navigation Footer */}
            <div className="wizard-footer">
              <div style={{ display: 'flex', gap: '8px' }}>
                {activeStep > 1 && (
                  <button 
                    type="button" 
                    className="nav-btn secondary" 
                    onClick={() => setActiveStep(activeStep - 1)}
                  >
                    ← Previous Step
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  type="button" 
                  className="nav-btn secondary" 
                  onClick={() => setIsEnrolModalOpen(false)}
                >
                  Cancel
                </button>

                {activeStep < 7 ? (
                  <button 
                    type="button" 
                    className="nav-btn primary" 
                    onClick={() => setActiveStep(activeStep + 1)}
                  >
                    Next Step ({activeStep + 1}/7) →
                  </button>
                ) : (
                  <button 
                    type="button" 
                    className="nav-btn primary" 
                    onClick={handleSaveStudent}
                    style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: '1px solid #34d399' }}
                  >
                    ✓ Complete & Save Enrolment
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: Bulk Upload Students (CSV / Google Sheet)                         */}
      {/* ========================================================================= */}
      {isBulkModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="modal-overlay" onClick={() => setIsBulkModalOpen(false)}>
          <div className="modal-content glass bulk-modal" onClick={e => e.stopPropagation()}>
            <div className="wizard-modal-header">
              <div>
                <span className="gold-pill">⚡ High-Volume Ingestion</span>
                <h3 style={{ margin: '6px 0 0 0', color: 'var(--text-primary)', fontSize: '1.4rem' }}>
                  Bulk Upload Student Enrolments
                </h3>
              </div>
              <button className="close-btn" onClick={() => setIsBulkModalOpen(false)}>×</button>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5' }}>
              Upload or paste student roster data from your institutional Google Sheet or CSV. 
              The system automatically parses all 7 categories including legal names, DOB, USI, residency status, and program details.
            </p>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <button 
                type="button" 
                className="nav-btn secondary" 
                onClick={handleDownloadCsvTemplate}
                style={{ fontSize: '0.85rem', padding: '8px 16px' }}
              >
                📥 Download Official CSV Template
              </button>
              <button 
                type="button" 
                className="nav-btn secondary" 
                onClick={() => setBulkCsvText(CSV_STUDENT_TEMPLATE)}
                style={{ fontSize: '0.85rem', padding: '8px 16px' }}
              >
                📋 Load Sample Data
              </button>
            </div>

            <textarea 
              rows="7"
              value={bulkCsvText}
              onChange={e => setBulkCsvText(e.target.value)}
              placeholder="Paste comma or tab-delimited sheet data here (including header row)..."
              className="bulk-textarea"
            />

            <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button 
                className="nav-btn primary" 
                onClick={handleParseBulkCsv}
                style={{ padding: '10px 20px' }}
              >
                🔍 Parse & Validate Students
              </button>
              {bulkParsedStudents.length > 0 && (
                <span style={{ color: '#34d399', fontWeight: 600 }}>
                  ✓ {bulkParsedStudents.length} Students Ready to Enrol
                </span>
              )}
            </div>

            {bulkError && (
              <div className="alert-error" style={{ marginTop: '12px' }}>
                ⚠️ {bulkError}
              </div>
            )}

            {bulkSuccessMsg && (
              <div className="alert-success" style={{ marginTop: '12px' }}>
                {bulkSuccessMsg}
              </div>
            )}

            {/* Parsed Preview Table */}
            {bulkParsedStudents.length > 0 && (
              <div style={{ marginTop: '18px' }}>
                <h5 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>Preview Parsed Enrolments:</h5>
                <div className="table-responsive" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                  <table className="roster-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Legal Name</th>
                        <th>DOB</th>
                        <th>Residency</th>
                        <th>Degree</th>
                        <th>Tuition</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkParsedStudents.map((s, idx) => (
                        <tr key={idx}>
                          <td>{s.legalFirstName} {s.legalFamilyName}</td>
                          <td>{s.dateOfBirth}</td>
                          <td>{s.residencyStatus}</td>
                          <td>{s.degreeTitle}</td>
                          <td>{s.tuitionPaymentMethod}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button className="nav-btn secondary" onClick={() => setIsBulkModalOpen(false)}>Cancel</button>
                  <button 
                    className="nav-btn primary" 
                    onClick={handleCommitBulkEnrolment}
                    style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: '1px solid #34d399' }}
                  >
                    ✓ Enrol All {bulkParsedStudents.length} Students
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: Official University Student Dossier View                        */}
      {/* ========================================================================= */}
      {selectedStudentForDossier && typeof document !== 'undefined' && createPortal(
        <div className="modal-overlay" onClick={() => setSelectedStudentForDossier(null)}>
          <div className="modal-content glass dossier-modal" onClick={e => e.stopPropagation()}>
            <div className="dossier-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div className="dossier-avatar">
                  {selectedStudentForDossier.legalFirstName?.[0]}{selectedStudentForDossier.legalFamilyName?.[0]}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="student-id-badge">{selectedStudentForDossier.id}</span>
                    <span className="badge-green">Verified Enrolment</span>
                  </div>
                  <h3 style={{ margin: '4px 0 0 0', fontSize: '1.6rem', color: 'var(--text-primary)' }}>
                    {selectedStudentForDossier.legalFirstName} {selectedStudentForDossier.legalMiddleName} {selectedStudentForDossier.legalFamilyName}
                  </h3>
                  <div style={{ color: '#fef08a', fontSize: '0.9rem' }}>
                    Preferred: {selectedStudentForDossier.preferredName} • {selectedStudentForDossier.degreeTitle}
                  </div>
                </div>
              </div>
              <button className="close-btn" onClick={() => setSelectedStudentForDossier(null)}>×</button>
            </div>

            <div className="dossier-body">
              {/* Category 1 */}
              <div className="dossier-section">
                <h4>1. Identity & Personal Details</h4>
                <div className="dossier-grid">
                  <div><strong>Legal Full Name:</strong> {selectedStudentForDossier.legalFirstName} {selectedStudentForDossier.legalMiddleName} {selectedStudentForDossier.legalFamilyName}</div>
                  <div><strong>Date of Birth:</strong> {formatLocalizedDate(selectedStudentForDossier.dateOfBirth)} ({selectedStudentForDossier.dateOfBirth})</div>
                  <div><strong>Gender / Sex:</strong> {selectedStudentForDossier.gender}</div>
                  <div><strong>Residency Status:</strong> {selectedStudentForDossier.residencyStatus}</div>
                  <div><strong>Proof of ID:</strong> {selectedStudentForDossier.proofOfIdentityType} ({selectedStudentForDossier.proofOfIdentityNumber || 'Recorded'})</div>
                  <div><strong>CoE / Visa Subclass:</strong> {selectedStudentForDossier.coeNumber || selectedStudentForDossier.visaSubclass || 'N/A (Domestic)'}</div>
                </div>
              </div>

              {/* Category 2 */}
              <div className="dossier-section">
                <h4>2. Contact & Emergency Information</h4>
                <div className="dossier-grid">
                  <div><strong>Personal Email:</strong> {selectedStudentForDossier.personalEmail}</div>
                  <div><strong>Mobile Phone:</strong> {selectedStudentForDossier.primaryPhone}</div>
                  <div><strong>Permanent Address:</strong> {selectedStudentForDossier.permanentAddress}</div>
                  <div><strong>Current Term Address:</strong> {selectedStudentForDossier.currentTermAddress}</div>
                  <div><strong>Emergency Contact:</strong> {selectedStudentForDossier.emergencyContactName} ({selectedStudentForDossier.emergencyContactRelationship})</div>
                  <div><strong>Emergency Phone:</strong> {selectedStudentForDossier.emergencyContactPhone} ({selectedStudentForDossier.emergencyContactLocation})</div>
                </div>
              </div>

              {/* Category 3 */}
              <div className="dossier-section">
                <h4>3. Academic History & Admissions Verification</h4>
                <div className="dossier-grid">
                  <div><strong>Prior Education:</strong> {selectedStudentForDossier.priorEducation}</div>
                  <div><strong>Credit Transfer / RPL:</strong> {selectedStudentForDossier.creditTransferRPL}</div>
                  <div><strong>Language Proficiency:</strong> {selectedStudentForDossier.languageProficiencyType} ({selectedStudentForDossier.languageScore})</div>
                  <div><strong>Prerequisites:</strong> {selectedStudentForDossier.prerequisiteNotes}</div>
                </div>
              </div>

              {/* Category 4 */}
              <div className="dossier-section">
                <h4>4. Regulatory & Government Identifiers</h4>
                <div className="dossier-grid">
                  <div><strong>Jurisdiction:</strong> {selectedStudentForDossier.jurisdiction}</div>
                  <div><strong>National Student ID (USI/SSN):</strong> {selectedStudentForDossier.nationalIdNumber}</div>
                  <div><strong>First Nations Status:</strong> {selectedStudentForDossier.indigenousStatus}</div>
                  <div><strong>Home Language:</strong> {selectedStudentForDossier.homeLanguage}</div>
                  <div><strong>Country of Birth:</strong> {selectedStudentForDossier.countryOfBirth}</div>
                  <div><strong>Parents' Education:</strong> {selectedStudentForDossier.parentsHighestEducation}</div>
                </div>
              </div>

              {/* Category 5 */}
              <div className="dossier-section">
                <h4>5. Program & Study Load Details</h4>
                <div className="dossier-grid">
                  <div><strong>Degree Program:</strong> {selectedStudentForDossier.degreeTitle}</div>
                  <div><strong>Major / Specialisation:</strong> {selectedStudentForDossier.majorSpecialisation}</div>
                  <div><strong>Study Mode:</strong> {selectedStudentForDossier.studyMode}</div>
                  <div><strong>Campus Location:</strong> {selectedStudentForDossier.campusLocation}</div>
                  <div><strong>Attendance Load:</strong> {selectedStudentForDossier.attendanceLoad}</div>
                  <div>
                    <strong>Enrolled LMS Courses:</strong>{' '}
                    {selectedStudentForDossier.enrolledCourseIds?.length ? (
                      selectedStudentForDossier.enrolledCourseIds.map(id => {
                        const c = myCourses.find(item => item.id === id);
                        return c ? c.title : `Course #${id}`;
                      }).join(', ')
                    ) : 'None currently assigned'}
                  </div>
                </div>
              </div>

              {/* Category 6 */}
              <div className="dossier-section">
                <h4>6. Billing, Fees & Financial Support</h4>
                <div className="dossier-grid">
                  <div><strong>Tuition Method:</strong> {selectedStudentForDossier.tuitionPaymentMethod}</div>
                  <div><strong>Loan / Subsidy:</strong> {selectedStudentForDossier.govLoanType}</div>
                  <div><strong>Sponsorship:</strong> {selectedStudentForDossier.sponsorshipDetails}</div>
                  <div><strong>Health Cover:</strong> {selectedStudentForDossier.healthCoverProvider} ({selectedStudentForDossier.healthCoverPolicyNumber || 'Active'})</div>
                </div>
              </div>

              {/* Category 7 */}
              <div className="dossier-section">
                <h4>7. Equity, Accessibility & Disclosures</h4>
                <div className="dossier-grid">
                  <div><strong>Accessibility Support:</strong> {selectedStudentForDossier.requiresAccessibilitySupport ? selectedStudentForDossier.accessibilitySupportDetails : 'None Requested'}</div>
                  <div><strong>Under-18 Welfare:</strong> {selectedStudentForDossier.isMinorUnder18 ? selectedStudentForDossier.guardianDetails : 'N/A (Adult)'}</div>
                  <div><strong>Code of Conduct:</strong> ✓ Agreed</div>
                  <div><strong>Privacy Consent:</strong> ✓ Consented</div>
                  <div><strong>Academic Integrity:</strong> ✓ Pledged</div>
                  <div><strong>Fee Liability:</strong> ✓ Acknowledged</div>
                </div>
              </div>
            </div>

            <div className="dossier-footer">
              <button 
                className="nav-btn secondary" 
                onClick={() => window.print()}
              >
                🖨️ Print / Save Dossier PDF
              </button>
              <button 
                className="nav-btn primary" 
                onClick={() => setSelectedStudentForDossier(null)}
              >
                Close Dossier
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
