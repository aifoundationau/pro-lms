import React, { useState, useEffect } from 'react';
import { analyzeIdentificationDocument } from '../services/idVerificationService';
import { submitTeacherApplication, getUserTeacherApplication } from '../services/teacherApplicationService';

export default function TeacherApplicationPostcard({ currentUser, onApplicationSuccess, onSubmitted }) {
  const [existingApp, setExistingApp] = useState(null);
  const [loadingExisting, setLoadingExisting] = useState(true);

  // Form State
  const [subjectSpecialty, setSubjectSpecialty] = useState('');
  const [teachingBio, setTeachingBio] = useState('');
  const [proposedCourseTitle, setProposedCourseTitle] = useState('');
  const [proposedTokenRate, setProposedTokenRate] = useState(10);
  const [idDocumentPreview, setIdDocumentPreview] = useState('');
  const [isAiScanning, setIsAiScanning] = useState(false);
  const [aiVerification, setAiVerification] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);

  useEffect(() => {
    if (currentUser?.uid) {
      getUserTeacherApplication(currentUser.uid).then(app => {
        if (app) setExistingApp(app);
        setLoadingExisting(false);
      }).catch(() => setLoadingExisting(false));
    } else {
      setLoadingExisting(false);
    }
  }, [currentUser]);

  // Handle ID image upload & trigger AI Reader
  const handleIdFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSubmitError('');
    setIsAiScanning(true);
    setAiVerification(null);

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setIdDocumentPreview(dataUrl);

      try {
        const aiResult = await analyzeIdentificationDocument(dataUrl, {
          name: currentUser?.displayName || 'Applicant',
          email: currentUser?.email || ''
        });
        setAiVerification(aiResult);
      } catch (err) {
        console.warn('AI ID reading note:', err);
        setSubmitError('AI document reader encountered a temporary delay, but image is attached.');
      } finally {
        setIsAiScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!idDocumentPreview) {
      setSubmitError('Please upload a valid form of identification (Passport, Driver License, or Teacher ID).');
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    try {
      const payload = {
        applicant_uid: currentUser?.uid || 'supporter',
        applicant_name: currentUser.displayName || currentUser.email?.split('@')[0] || 'Teacher Candidate',
        applicant_email: currentUser.email || '',
        subject_specialty: subjectSpecialty.trim(),
        teaching_bio: teachingBio.trim(),
        proposed_course_title: proposedCourseTitle.trim(),
        proposed_token_rate: Number(proposedTokenRate) || 10,
        postal_address_text: 'OzEdu Academic Secretariat, 100 University Avenue, Sydney NSW 2000',
        id_document_preview: idDocumentPreview,
        ai_id_verification: aiVerification
      };

      const result = await submitTeacherApplication(payload);
      setExistingApp(result);
      setSubmitSuccess(true);
      if (onApplicationSuccess) onApplicationSuccess(result);
      if (onSubmitted) onSubmitted(result);
    } catch (err) {
      setSubmitError(err?.message || 'Failed to submit application. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingExisting) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
        Loading teacher registration status...
      </div>
    );
  }

  // If user already applied and is pending or approved
  if (existingApp && !submitSuccess) {
    return (
      <div className="postcard-container animate-fade-in-up" style={{ maxWidth: '960px', margin: '2rem auto' }}>
        <div style={{
          background: '#fdfbf7', borderRadius: '16px', overflow: 'hidden',
          boxShadow: '0 20px 40px -15px rgba(0,0,0,0.4)', border: '8px solid #ffffff',
          position: 'relative'
        }}>
          {/* Airmail Border */}
          <div style={{
            height: '14px', width: '100%',
            background: 'repeating-linear-gradient(135deg, #ef4444 0, #ef4444 18px, transparent 18px, transparent 24px, #3b82f6 24px, #3b82f6 42px, transparent 42px, transparent 48px)'
          }} />

          <div style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '2px dashed #cbd5e1', paddingBottom: '1rem' }}>
              <div>
                <span style={{
                  padding: '6px 14px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase',
                  background: existingApp.status === 'approved' ? '#dcfce7' : '#fef3c7',
                  color: existingApp.status === 'approved' ? '#15803d' : '#b45309',
                  border: existingApp.status === 'approved' ? '1px solid #86efac' : '1px solid #fde68a'
                }}>
                  {existingApp.status === 'approved' ? '✅ Certified Teacher Active' : '📮 Application Postmarked & Under Review'}
                </span>
                <h3 style={{ margin: '10px 0 0 0', fontSize: '1.6rem', color: '#1e293b', fontFamily: 'Georgia, serif' }}>
                  Official OzEdu Teacher Postcard Application
                </h3>
              </div>

              {/* Postal Stamp Badge */}
              <div style={{
                border: '2px solid #b91c1c', borderRadius: '50%', width: '90px', height: '90px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: '#b91c1c', transform: 'rotate(-10deg)', fontSize: '0.68rem', fontWeight: 800,
                textAlign: 'center', textTransform: 'uppercase', lineHeight: '1.2'
              }}>
                <div>OZEDU</div>
                <div style={{ fontSize: '0.9rem' }}>★ AI ★</div>
                <div>SYDNEY</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem' }}>
              {/* Left Column: Postcard Message */}
              <div style={{ borderRight: '1px solid #e2e8f0', paddingRight: '1.5rem' }}>
                <p style={{ fontStyle: 'italic', color: '#64748b', fontSize: '0.9rem', margin: '0 0 12px 0' }}>
                  Postmarked: {new Date(existingApp.submitted_at || Date.now()).toLocaleDateString(undefined, { dateStyle: 'long' })}
                </p>
                <div style={{ marginBottom: '14px' }}>
                  <strong style={{ color: '#334155' }}>Applicant:</strong> {existingApp.applicant_name} ({existingApp.applicant_email})
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <strong style={{ color: '#334155' }}>Subject Specialty:</strong> {existingApp.subject_specialty}
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <strong style={{ color: '#334155' }}>Proposed Course:</strong> {existingApp.proposed_course_title || 'N/A'} (🪙 {existingApp.proposed_token_rate} Tokens)
                </div>
                <div style={{ marginBottom: '14px', background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Teaching Statement & Bio:</div>
                  <div style={{ fontSize: '0.92rem', color: '#1e293b', whiteSpace: 'pre-wrap' }}>{existingApp.teaching_bio}</div>
                </div>
              </div>

              {/* Right Column: AI Verification Record */}
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '1.05rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🛡️</span> AI ID Verification Record
                </h4>
                {existingApp.ai_id_verification ? (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '14px', fontSize: '0.88rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600, color: '#166534' }}>Document Type:</span>
                      <span style={{ color: '#14532d', fontWeight: 700 }}>{existingApp.ai_id_verification.document_type}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600, color: '#166534' }}>Detected Name:</span>
                      <span style={{ color: '#14532d' }}>{existingApp.ai_id_verification.full_name}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600, color: '#166534' }}>Masked ID:</span>
                      <span style={{ color: '#14532d' }}>{existingApp.ai_id_verification.id_number_masked}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600, color: '#166534' }}>Authenticity:</span>
                      <span style={{ color: '#15803d', fontWeight: 700 }}>{existingApp.ai_id_verification.authenticity_assessment}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600, color: '#166534' }}>Confidence:</span>
                      <span style={{ color: '#15803d', fontWeight: 800 }}>{existingApp.ai_id_verification.confidence_score}%</span>
                    </div>
                    <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed #bbf7d0', fontSize: '0.82rem', color: '#166534', fontStyle: 'italic' }}>
                      "{existingApp.ai_id_verification.verification_notes}"
                    </div>
                  </div>
                ) : (
                  <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', color: '#64748b', fontSize: '0.85rem' }}>
                    ID Document logged in database.
                  </div>
                )}

                {existingApp.id_document_preview && (
                  <div style={{ marginTop: '14px' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '4px' }}>Submitted Credential Image:</div>
                    <img
                      src={existingApp.id_document_preview}
                      alt="ID Preview"
                      style={{ maxHeight: '110px', maxWidth: '100%', borderRadius: '8px', border: '1px solid #cbd5e1', objectFit: 'contain' }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="postcard-container animate-fade-in-up" style={{ maxWidth: '980px', margin: '2rem auto' }}>
      {/* Intro Hero */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#ffffff', margin: 0 }}>
          Join the Faculty as an OzEdu Teacher
        </h2>
        <p style={{ color: '#cbd5e1', margin: '8px 0 0 0', fontSize: '1rem' }}>
          Create your own courses, choose your own token pricing, and educate students worldwide.
        </p>
      </div>

      {/* Postcard Body */}
      <div style={{
        background: '#fdfbf7', borderRadius: '20px', overflow: 'hidden',
        boxShadow: '0 25px 50px -15px rgba(0,0,0,0.5)', border: '10px solid #ffffff',
        position: 'relative'
      }}>
        {/* Airmail Border Header */}
        <div style={{
          height: '16px', width: '100%',
          background: 'repeating-linear-gradient(135deg, #ef4444 0, #ef4444 20px, transparent 20px, transparent 26px, #3b82f6 26px, #3b82f6 46px, transparent 46px, transparent 52px)'
        }} />

        <form onSubmit={handleSubmit} style={{ padding: '2rem' }}>
          {submitError && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
              padding: '12px 16px', borderRadius: '10px', marginBottom: '1.5rem', fontSize: '0.9rem'
            }}>
              ⚠️ {submitError}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2.5rem' }}>
            {/* LEFT SIDE: POSTCARD MESSAGE (Teacher Application Form) */}
            <div style={{ borderRight: '2px dashed #e2e8f0', paddingRight: '2rem' }}>
              <div style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '16px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#64748b' }}>
                  POSTCARD CORRESPONDENCE • PART 1
                </span>
                <h3 style={{ margin: '4px 0 0 0', color: '#0f172a', fontFamily: 'Georgia, serif', fontSize: '1.4rem' }}>
                  Teacher Statement & Course Proposal
                </h3>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Full Legal Name
                </label>
                <input
                  type="text"
                  readOnly
                  value={currentUser?.displayName || currentUser?.email?.split('@')[0] || ''}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1',
                    background: '#f8fafc', color: '#475569', fontSize: '0.95rem', boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Primary Teaching Specialty / Subject Area *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Applied Machine Learning, Physics, Creative Writing..."
                  value={subjectSpecialty}
                  onChange={(e) => setSubjectSpecialty(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1',
                    fontSize: '0.95rem', boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Proposed First Course Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Practical Deep Learning with Python"
                  value={proposedCourseTitle}
                  onChange={(e) => setProposedCourseTitle(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1',
                    fontSize: '0.95rem', boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Course Token Cost for Students (🪙 Tokens to Enroll)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={proposedTokenRate}
                    onChange={(e) => setProposedTokenRate(e.target.value)}
                    style={{
                      width: '120px', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1',
                      fontSize: '1rem', fontWeight: 700, boxSizing: 'border-box'
                    }}
                  />
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                    🪙 Teachers choose their course token price (0 = free)
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Teaching Philosophy & Academic Bio *
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Write a postcard message detailing your teaching background, credentials, and passion for accessible education..."
                  value={teachingBio}
                  onChange={(e) => setTeachingBio(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1',
                    fontSize: '0.92rem', fontFamily: 'Georgia, serif', lineHeight: '1.5', boxSizing: 'border-box',
                    resize: 'vertical'
                  }}
                />
              </div>
            </div>

            {/* RIGHT SIDE: RECIPIENT, POSTAL STAMP & AI ID READER */}
            <div>
              {/* Postal Stamp & Cancellation Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
                {/* Circular Postmark */}
                <div style={{
                  border: '2px solid #b91c1c', borderRadius: '50%', width: '85px', height: '85px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  color: '#b91c1c', transform: 'rotate(-8deg)', fontSize: '0.65rem', fontWeight: 800,
                  textAlign: 'center', textTransform: 'uppercase', lineHeight: '1.2'
                }}>
                  <div>OZEDU</div>
                  <div style={{ fontSize: '0.85rem' }}>★ 2026 ★</div>
                  <div>SYDNEY NSW</div>
                </div>

                {/* Airmail Postage Stamp */}
                <div style={{
                  width: '90px', height: '110px', background: '#e0e7ff', border: '3px dashed #4338ca',
                  borderRadius: '6px', padding: '6px', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'space-between', textAlign: 'center',
                  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#312e81', letterSpacing: '0.5px' }}>
                    OZEDU AIR MAIL
                  </div>
                  <div style={{ fontSize: '1.8rem' }}>🏛️</div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#3730a3' }}>
                    50🪙 RATE
                  </div>
                </div>
              </div>

              {/* Recipient Address Lines */}
              <div style={{ marginBottom: '20px', paddingBottom: '14px', borderBottom: '1px solid #cbd5e1' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Delivered To:
                </div>
                <div style={{ fontFamily: 'Courier New, monospace', fontSize: '0.9rem', color: '#334155', lineHeight: '1.4' }}>
                  <div>Academic Dean & Registry</div>
                  <div>OzEdu Global Learning Platform</div>
                  <div>100 University Ave, Sydney NSW 2000</div>
                  <div>AUSTRALIA</div>
                </div>
              </div>

              {/* ID Document Upload & AI Reader */}
              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', fontSize: '0.88rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                  Identification Document Verification *
                </label>
                <p style={{ margin: '0 0 10px 0', fontSize: '0.8rem', color: '#64748b' }}>
                  Must attach photo/scan of ID (Passport, Driver License, or Teacher Card). AI analyzes it in real-time.
                </p>

                <input
                  type="file"
                  accept="image/*"
                  onChange={handleIdFileUpload}
                  id="id-file-upload"
                  style={{ display: 'none' }}
                />
                <label
                  htmlFor="id-file-upload"
                  style={{
                    display: 'block', padding: '14px', border: '2px dashed #6366f1', borderRadius: '10px',
                    textAlign: 'center', cursor: 'pointer', background: idDocumentPreview ? '#f8fafc' : '#eff6ff',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <span style={{ fontSize: '1.4rem', display: 'block', marginBottom: '4px' }}>📷</span>
                  <span style={{ fontWeight: 600, color: '#4338ca', fontSize: '0.9rem' }}>
                    {idDocumentPreview ? 'Change Uploaded ID Document' : 'Upload Identification Document'}
                  </span>
                </label>
              </div>

              {/* AI Processing Status */}
              {isAiScanning && (
                <div style={{
                  background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px',
                  padding: '12px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px'
                }}>
                  <div className="spinner" style={{
                    width: '20px', height: '20px', border: '3px solid #f59e0b', borderTopColor: 'transparent',
                    borderRadius: '50%', animation: 'spin 1s linear infinite'
                  }} />
                  <span style={{ fontSize: '0.85rem', color: '#b45309', fontWeight: 600 }}>
                    🤖 Gemini Vision is analyzing your ID document...
                  </span>
                </div>
              )}

              {/* Extracted AI ID Details */}
              {aiVerification && (
                <div style={{
                  background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px',
                  padding: '14px', marginBottom: '18px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 800, color: '#166534', fontSize: '0.85rem' }}>
                      ✅ AI Extracted Information
                    </span>
                    <span style={{
                      background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '10px',
                      fontSize: '0.75rem', fontWeight: 700
                    }}>
                      Confidence: {aiVerification.confidence_score}%
                    </span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#14532d', lineHeight: '1.4' }}>
                    <div><strong>Document:</strong> {aiVerification.document_type}</div>
                    <div><strong>Name on ID:</strong> {aiVerification.full_name}</div>
                    <div><strong>Masked ID:</strong> {aiVerification.id_number_masked}</div>
                    <div><strong>Authenticity:</strong> {aiVerification.authenticity_assessment}</div>
                  </div>
                </div>
              )}

              {/* Submit Postcard Action */}
              <button
                type="submit"
                disabled={submitting || !idDocumentPreview || isAiScanning}
                style={{
                  width: '100%', padding: '14px', borderRadius: '10px',
                  background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                  color: '#ffffff', border: 'none', fontSize: '1rem', fontWeight: 700,
                  cursor: submitting || !idDocumentPreview ? 'not-allowed' : 'pointer',
                  opacity: submitting || !idDocumentPreview ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  boxShadow: '0 4px 6px -1px rgba(15, 23, 42, 0.4)'
                }}
              >
                {submitting ? 'Posting Application...' : 'Post Teacher Application 📮'}
              </button>
            </div>
          </div>
        </form>

        {/* Airmail Border Footer */}
        <div style={{
          height: '16px', width: '100%',
          background: 'repeating-linear-gradient(135deg, #ef4444 0, #ef4444 20px, transparent 20px, transparent 26px, #3b82f6 26px, #3b82f6 46px, transparent 46px, transparent 52px)'
        }} />
      </div>
    </div>
  );
}
