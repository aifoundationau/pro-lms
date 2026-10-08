import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, addDoc, getDocs, doc, setDoc } from 'firebase/firestore';
import { parseCourseSheetWithAI, SAMPLE_SHEET_CSV, DEFAULT_GEMINI_KEY, formatLocalizedDate } from './services/geminiCourseService';
import StudentRegistration from './components/StudentRegistration';
import { ALL_GLOBAL_COURSES } from './services/globalCoursesData';
import './App.css';

function App() {
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [mathA, setMathA] = useState(0);
  const [mathB, setMathB] = useState(0);
  const [userMathAnswer, setUserMathAnswer] = useState('');
  
  // AI Course Import State
  const [isAiImportOpen, setIsAiImportOpen] = useState(false);
  const [sheetText, setSheetText] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiApiKey, setAiApiKey] = useState(DEFAULT_GEMINI_KEY);
  const [showKeyConfig, setShowKeyConfig] = useState(false);
  
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    phone: '',
    message: ''
  });

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState('my-courses');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [myCourses, setMyCourses] = useState([
    { id: 1, title: 'Introduction to AI', students: 42, startDate: '2026-03-02' },
    { id: 2, title: 'Web Development Bootcamp', students: 118, startDate: '2026-03-16' },
  ]);
  
  const [archivedCourses, setArchivedCourses] = useState([]);
  const [showArchive, setShowArchive] = useState(false);

  // Synchronize courses from Cloud Firestore on mount
  useEffect(() => {
    const loadCoursesFromFirestore = async () => {
      try {
        const snap = await getDocs(collection(db, "courses"));
        if (!snap.empty) {
          const loaded = [];
          snap.forEach(d => {
            const data = d.data();
            if (!data.archived) {
              loaded.push({ id: d.id, ...data });
            }
          });
          if (loaded.length > 0) {
            setMyCourses(loaded);
          }
        }
      } catch (err) {
        console.warn("Firestore sync note:", err);
      }
    };
    loadCoursesFromFirestore();
  }, []);

  const handleDeleteCourse = (course) => {
    setMyCourses(myCourses.filter(c => c.id !== course.id));
    setArchivedCourses([{ ...course, archivedAt: Date.now() }, ...archivedCourses]);
  };

  const handleRestoreCourse = (course) => {
    setArchivedCourses(archivedCourses.filter(c => c.id !== course.id));
    setMyCourses([{ ...course, archivedAt: undefined }, ...myCourses]);
  };

  const handleUpdateCourseEnrollments = (enrolledCourseIds) => {
    if (!enrolledCourseIds || !enrolledCourseIds.length) return;
    setMyCourses(prev => prev.map(c => {
      if (enrolledCourseIds.includes(c.id)) {
        const updated = { ...c, students: (c.students || 0) + 1 };
        try {
          setDoc(doc(db, "courses", String(c.id)), updated, { merge: true });
        } catch (e) {
          console.warn("Course student update note:", e);
        }
        return updated;
      }
      return c;
    }));
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
    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch('https://api.imgbb.com/1/upload?key=6d7007353630f7eaf44016384dd9761e', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        setEditingThumbnail(data.data.url);
      } else {
        alert('Upload failed: ' + data.error.message);
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload thumbnail.');
    } finally {
      setIsUploadingThumbnail(false);
    }
  };

  const handleAssessmentUpload = async (e, id, fieldName) => {
    const file = e.target.files[0];
    if (!file) return;

    const uploadKey = `${id}_${fieldName}`;
    setUploadingAssessments(prev => ({ ...prev, [uploadKey]: true }));
    
    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch('https://api.imgbb.com/1/upload?key=6d7007353630f7eaf44016384dd9761e', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        handleUpdateAssessment(id, fieldName, data.data.url);
      } else {
        alert('Upload failed: ' + data.error.message);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Failed to upload file.');
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

  const handleSaveCourse = () => {
    setMyCourses(myCourses.map(c => 
      c.id === editingCourse.id 
        ? { 
            ...c, 
            modules: courseModules, 
            assessments: courseAssessments,
            description: editingDescription, 
            thumbnail: editingThumbnail,
            title: editingTitle,
            startDate: editingStartDate,
            year: editingYear,
            outcomes: editingOutcomes,
            knowledge: editingKnowledge
          } 
        : c
    ));

    // Persist complete course document to Cloud Firestore
    setDoc(doc(db, "courses", String(editingCourse.id)), {
      title: editingTitle,
      startDate: editingStartDate,
      year: editingYear,
      description: editingDescription,
      thumbnail: editingThumbnail,
      outcomes: editingOutcomes,
      knowledge: editingKnowledge,
      modules: courseModules,
      assessments: courseAssessments,
      updatedAt: Date.now()
    }, { merge: true }).catch(err => {
      console.warn("Firestore save note:", err);
    });

    alert('Course saved successfully!');
  };

  const handleCreateBlankCourse = () => {
    const todayIso = new Date().toISOString().split('T')[0];
    const newCourse = { 
      id: Date.now().toString(), 
      title: 'New Course', 
      startDate: todayIso,
      students: 0,
      year: new Date().getFullYear() + ' Semester 1',
      description: '',
      outcomes: '',
      knowledge: '',
      modules: [],
      assessments: [],
      createdAt: Date.now() 
    };
    setMyCourses([newCourse, ...myCourses]);
    setEditingCourse(newCourse);
    setEditingTitle('New Course');
    setEditingStartDate(todayIso);
    setEditingYear(newCourse.year);
    setEditingDescription('');
    setEditingOutcomes('');
    setEditingKnowledge('');
    setCourseModules([]);
    setCourseAssessments([]);
    
    addDoc(collection(db, "courses"), {
      title: 'New Course',
      startDate: todayIso,
      students: 0,
      createdAt: Date.now()
    }).catch(error => {
      console.error("Error adding document to Firebase: ", error);
    });
  };

  const handleUploadSheetClick = () => {
    const todayIso = new Date().toISOString().split('T')[0];
    const newCourse = { 
      id: Date.now().toString(), 
      title: 'New Course', 
      startDate: todayIso,
      students: 0,
      year: new Date().getFullYear() + ' Semester 1',
      description: '',
      outcomes: '',
      knowledge: '',
      modules: [],
      assessments: [],
      createdAt: Date.now() 
    };
    setMyCourses([newCourse, ...myCourses]);
    setEditingCourse(newCourse);
    setEditingTitle('New Course');
    setEditingStartDate(todayIso);
    setEditingYear(newCourse.year);
    setEditingDescription('');
    setEditingOutcomes('');
    setEditingKnowledge('');
    setCourseModules([]);
    setCourseAssessments([]);
    
    setAiError('');
    setIsAiImportOpen(true);
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
        setMyCourses(prev => prev.map(c => c.id === editingCourse.id ? {
          ...c,
          title: updatedTitle,
          startDate: parsed.startDate || editingStartDate || c.startDate,
          year: parsed.year || c.year,
          description: parsed.description || c.description,
          outcomes: parsed.outcomes || c.outcomes,
          knowledge: parsed.knowledge || c.knowledge,
          modules: parsed.modules?.length ? parsed.modules : c.modules,
          assessments: parsed.assessments?.length ? parsed.assessments : c.assessments
        } : c));

        setIsAiImportOpen(false);
        setSheetText('');
        alert(`Course "${updatedTitle}" updated with AI!\n\n• ${parsed.modules?.length || 0} Modules loaded\n• ${parsed.assessments?.length || 0} Assessments loaded\n\nYou can now review the details and complete any missing information manually.`);
      } else {
        // Creating brand new course from My Courses
        const newCourse = {
          id: Date.now().toString(),
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

        addDoc(collection(db, "courses"), {
          title: newCourse.title,
          startDate: newCourse.startDate,
          students: 0,
          createdAt: Date.now()
        }).catch(error => {
          console.error("Error adding document to Firebase: ", error);
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
    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch('https://api.imgbb.com/1/upload?key=6d7007353630f7eaf44016384dd9761e', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        setUploadedImages(prev => [data.data.url, ...prev]);
      } else {
        alert('Upload failed: ' + data.error.message);
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image.');
    } finally {
      setIsUploading(false);
    }
  };
  
  // Global Course Search State (4 across × 6 rows = 24 courses per page)
  const [globalPage, setGlobalPage] = useState(1);
  const [globalCategory, setGlobalCategory] = useState('ALL');
  const COURSES_PER_PAGE = 24;

  const handleCopyCourse = (course) => {
    if (!myCourses.find(c => c.id === course.id)) {
      setMyCourses([...myCourses, { ...course, students: 0 }]);
    }
  };

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

  useEffect(() => {
    if (isContactOpen) {
      setMathA(Math.floor(Math.random() * 10) + 1);
      setMathB(Math.floor(Math.random() * 10) + 1);
      setUserMathAnswer('');
      setContactForm({ name: '', email: '', phone: '', message: '' });
    }
  }, [isContactOpen]);

  const isMathCorrect = parseInt(userMathAnswer) === (mathA + mathB);
  
  const handleContactSubmit = (e) => {
    e.preventDefault();
    if (!isMathCorrect) return;
    
    const subject = encodeURIComponent(`Contact from ${contactForm.name}`);
    const body = encodeURIComponent(
      `Name: ${contactForm.name}\n` +
      `Email: ${contactForm.email}\n` +
      `Phone: ${contactForm.phone}\n\n` +
      `Message:\n${contactForm.message}`
    );
    window.location.href = `mailto:support@aifoundation.net.au?subject=${subject}&body=${body}`;
    setIsContactOpen(false);
  };
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
      content: "Operating at ~US$1.00/student monthly, it utilizes the TokenPulse Community Emergency Fund for transparent funding. Remote students access metropolitan-quality academics via Australian university integrations."
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

  if (isLoggedIn) {
    if (editingCourse) {
      return (
        <div className="app-container">
          <div className="background-shapes">
            <div className="shape shape-1"></div>
            <div className="shape shape-2"></div>
            <div className="shape shape-3"></div>
          </div>
          <header className="glass header animate-fade-in">
            <button className="logo-btn" onClick={() => { setEditingCourse(null); setIsLoggedIn(false); }} title="Go to Home">
              <h1>OzEdu Admin</h1>
            </button>
            <nav>
              <button className="nav-btn secondary" onClick={() => setEditingCourse(null)}>Back to My Courses</button>
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
                  <button className="nav-btn primary" onClick={() => { handleSaveCourse(); setEditingCourse(null); alert('Course Published to Global Search!'); }} style={{flex: 1, minWidth: '200px', fontSize: '1.1rem', padding: '12px 24px'}}>Publish to Global Search</button>
                  <button className="nav-btn secondary" onClick={() => { handleSaveCourse(); setEditingCourse(null); alert('Course Saved as Draft (28 Days)'); }} style={{flex: 1, minWidth: '200px', fontSize: '1.1rem', padding: '12px 24px'}}>Save as Draft (28 Days)</button>
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
          <button className="logo-btn" onClick={() => setIsLoggedIn(false)} title="Go to Home">
            <h1>OzEdu Admin</h1>
          </button>
          <nav>
            <button className={`nav-btn ${activeTab === 'my-courses' ? 'primary' : 'secondary'}`} onClick={() => setActiveTab('my-courses')}>My Courses</button>
            <button className={`nav-btn ${activeTab === 'students' ? 'primary' : 'secondary'}`} onClick={() => setActiveTab('students')}>Student Registration</button>
            <button className={`nav-btn ${activeTab === 'global' ? 'primary' : 'secondary'}`} onClick={() => setActiveTab('global')}>Global Search</button>
            <button className="nav-btn secondary" onClick={() => setIsLoggedIn(false)}>Logout</button>
          </nav>
        </header>

        <main className="main-content animate-fade-in-up">
          {activeTab === 'my-courses' && (
            <div className="admin-section">
              <h2 className="section-title">My Courses</h2>
              
              <div className="cards-grid">
                {/* Square block: Create Course is ALWAYS first block */}
                <div className="glass card create-course-card">
                  <div>
                    <div className="card-icon card-icon-gradient">✨</div>
                    <h3 style={{color: '#fef08a', margin: '0 0 10px 0'}}>Create Course</h3>
                    <p style={{fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0}}>
                      Start a blank course or upload a Google Sheet to auto-fill modules & assessments with AI.
                    </p>
                  </div>
                  <div style={{display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px'}}>
                    <button 
                      className="nav-btn primary" 
                      style={{width: '100%', fontWeight: '700', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'}}
                      onClick={handleUploadSheetClick}
                    >
                      ⚡ Upload Sheet (AI)
                    </button>
                    <button 
                      className="nav-btn secondary" 
                      style={{width: '100%', fontWeight: '600', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'}}
                      onClick={handleCreateBlankCourse}
                    >
                      + Create Course
                    </button>
                  </div>
                </div>

                {myCourses.map(course => (
                  <div key={course.id} className="glass card">
                    <div className="card-icon">📚</div>
                    <h3>{course.title}</h3>
                    {course.startDate && (
                      <p style={{fontSize: '0.85rem', color: 'var(--accent-hover)', margin: '0 0 6px 0', fontWeight: '500'}}>
                        📅 Starts: {formatLocalizedDate(course.startDate)}
                      </p>
                    )}
                    <p>Active Students: {course.students}</p>
                    <div style={{display: 'flex', gap: '8px', marginTop: '16px'}}>
                      <button className="nav-btn secondary" style={{flex: 1}} onClick={() => setEditingCourse(course)}>Manage</button>
                      <button className="nav-btn primary" style={{background: '#e11d48', border: 'none', color: 'white'}} onClick={() => handleDeleteCourse(course)}>Delete</button>
                    </div>
                  </div>
                ))}
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
                          <div key={course.id} className="glass card" style={{opacity: 0.8}}>
                            <div className="card-icon" style={{filter: 'grayscale(1)'}}>🗑️</div>
                            <h3 style={{textDecoration: 'line-through'}}>{course.title}</h3>
                            <p style={{color: '#f87171', fontWeight: 'bold'}}>Deletes in {daysLeft} days</p>
                            <button className="nav-btn secondary" style={{marginTop: '16px', width: '100%'}} onClick={() => handleRestoreCourse(course)}>Restore Course</button>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'students' && (
            <StudentRegistration 
              myCourses={myCourses} 
              onUpdateCourses={handleUpdateCourseEnrollments} 
            />
          )}

          {activeTab === 'global' && (
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

                    <button 
                      className="nav-btn primary" 
                      style={{ 
                        width: '100%', 
                        fontSize: '0.88rem', 
                        padding: '10px 14px',
                        background: myCourses.some(c => c.id === course.id) ? 'rgba(52, 211, 153, 0.25)' : undefined 
                      }}
                      onClick={() => handleCopyCourse(course)}
                      disabled={myCourses.some(c => c.id === course.id)}
                    >
                      {myCourses.some(c => c.id === course.id) ? '✓ Added to My Courses' : '+ Copy to My Courses'}
                    </button>
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
        </main>
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
        <button className="logo-btn" onClick={() => setIsLoggedIn(false)} title="Go to Home">
          <h1>OzEdu</h1>
        </button>
        <nav>
          <button className="nav-btn secondary" onClick={() => setIsContactOpen(true)}>Contact</button>
          <button className="nav-btn secondary" onClick={() => setIsLoggedIn(true)}>Login</button>
          <button className="nav-btn primary">Get Started</button>
        </nav>
      </header>

      <main className="main-content">
        <div className="hero-text animate-fade-in-up">
          <h2>Transforming Education Through AI & Community</h2>
          <p>
            Bridging the gap between world-class tertiary education and under-resourced classrooms across Southeast Asia with a self-sustaining, ultra-lightweight ecosystem.
          </p>
        </div>

        <div className="cards-grid">
          {cards.map((card, index) => (
            <div 
              key={index} 
              className={`glass card animate-fade-in-up delay-${index + 1}`}
            >
              <div className="card-icon">{card.icon}</div>
              <h3>{card.title}</h3>
              <p>{card.content}</p>
            </div>
          ))}
        </div>

        <div className="twin-panels animate-fade-in-up delay-5">
          <div className="glass twin-panel">
            <h3>Sponsor a Student</h3>
            <p>Donate $12 to fully fund a specific student's access for a year.</p>
            <div className="input-group">
              <input type="email" placeholder="Student's Email Address" className="email-input" />
              <button className="nav-btn primary">Fund Account ($12)</button>
            </div>
          </div>
          <div className="glass twin-panel">
            <h3>Emergency Token Fund</h3>
            <p>Contribute to the general pool. Your funds will automatically go to the next student in need.</p>
            <button className="nav-btn primary">Donate to Token Fund</button>
          </div>
        </div>
      </main>

      <footer className="footer glass animate-fade-in-up delay-5">
        <p>© {new Date().getFullYear()} AI Foundation Australia</p>
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
                  Our platform thrives on community-contributed content. Send us a message and attach your syllabus or modules. Our academic team will review and integrate your work.
                </div>
              </details>
              <details className="info-box">
                <summary>If you are a donor and want to know how to sponsor students</summary>
                <div className="dropdown-content">
                  Sponsoring a student costs just $12/year. You can fund specific students using the panel on the main page, or contact us to sponsor larger groups and entire classrooms.
                </div>
              </details>
            </div>
            <form onSubmit={handleContactSubmit} className="contact-form">
              <input 
                type="text" 
                placeholder="Name" 
                required 
                className="form-input"
                value={contactForm.name}
                onChange={e => setContactForm({...contactForm, name: e.target.value})}
              />
              <input 
                type="email" 
                placeholder="Email" 
                required 
                className="form-input"
                value={contactForm.email}
                onChange={e => setContactForm({...contactForm, email: e.target.value})}
              />
              <input 
                type="tel" 
                placeholder="Phone Number" 
                required 
                className="form-input"
                value={contactForm.phone}
                onChange={e => setContactForm({...contactForm, phone: e.target.value})}
              />
              <textarea 
                placeholder="Message" 
                required 
                rows="4"
                className="form-input"
                value={contactForm.message}
                onChange={e => setContactForm({...contactForm, message: e.target.value})}
              ></textarea>
              
              <div className="math-verification">
                <label>What is {mathA} + {mathB}?</label>
                <input 
                  type="number" 
                  required 
                  className="form-input math-input"
                  value={userMathAnswer}
                  onChange={e => setUserMathAnswer(e.target.value)}
                />
              </div>

              <button 
                type="submit" 
                className="nav-btn primary" 
                disabled={!isMathCorrect || !userMathAnswer}
                style={{ opacity: (!isMathCorrect || !userMathAnswer) ? 0.5 : 1, cursor: (!isMathCorrect || !userMathAnswer) ? 'not-allowed' : 'pointer' }}
              >
                Send Message
              </button>
            </form>
          </div>
        </div>
      )}
      {isAiImportOpen && renderAiModal()}
    </div>
  );
}

export default App;
