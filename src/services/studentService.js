// src/services/studentService.js

export const JURISDICTIONS = {
  AUSTRALIA: 'Australia',
  US: 'United States',
  UK: 'United Kingdom',
  OTHER: 'Other / International'
};

export const RESIDENCY_TYPES = {
  DOMESTIC_CITIZEN: 'Domestic Citizen',
  DOMESTIC_PR: 'Domestic Permanent Resident',
  INTERNATIONAL_STUDENT: 'International Student (Visa 500)',
  HUMANITARIAN_REFUGEE: 'Humanitarian / Refugee Visa'
};

export const STUDY_MODES = ['On-campus', 'Online / Distance', 'Hybrid / Blended'];
export const ATTENDANCE_LOADS = ['Full-time', 'Part-time'];

export const TUITION_METHODS = [
  'Government Loan (HECS-HELP / FEE-HELP)',
  'Upfront Direct Payment',
  'Institutional Instalment Plan',
  'Employer / Embassy Sponsored',
  'Scholarship'
];

export const INITIAL_STUDENT_FORM = {
  // 1. Identity & Personal Details
  legalFirstName: '',
  legalMiddleName: '',
  legalFamilyName: '',
  preferredName: '',
  dateOfBirth: '2005-04-12', // ISO 8601
  gender: 'Female', // Female, Male, Non-binary, Prefer not to say
  proofOfIdentityType: "Driver's Licence", // Passport, Driver's Licence, National ID
  proofOfIdentityNumber: '',
  residencyStatus: RESIDENCY_TYPES.DOMESTIC_CITIZEN,
  passportNumber: '',
  visaSubclass: '500 - Student',
  coeNumber: '', // Confirmation of Enrolment for international students

  // 2. Contact & Emergency Information
  permanentAddress: '',
  currentTermAddress: '',
  primaryPhone: '',
  personalEmail: '',
  emergencyContactName: '',
  emergencyContactRelationship: '',
  emergencyContactPhone: '',
  emergencyContactLocation: '',

  // 3. Academic History & Admissions Verification
  priorEducation: 'High School Completion / ATAR 88.50',
  creditTransferRPL: 'None requested',
  languageProficiencyType: 'IELTS Academic', // IELTS, TOEFL, PTE, Prior English Instruction
  languageScore: '7.5 Overall',
  prerequisitesSatisfied: true,
  prerequisiteNotes: 'Maths Advanced (Band 5), Physics completed',

  // 4. Regulatory & Government Identifiers
  jurisdiction: JURISDICTIONS.AUSTRALIA,
  nationalIdNumber: '', // USI in Aus, SSN in US, ULN in UK
  indigenousStatus: 'Neither Aboriginal nor Torres Strait Islander',
  homeLanguage: 'English',
  countryOfBirth: 'Australia',
  parentsHighestEducation: 'Bachelor Degree',

  // 5. Program & Study Load Details
  degreeTitle: 'Bachelor of Computer Science',
  majorSpecialisation: 'Artificial Intelligence & Software Systems',
  studyMode: 'On-campus',
  campusLocation: 'Sydney Central Campus',
  attendanceLoad: 'Full-time',
  enrolledCourseIds: [], // IDs of LMS courses

  // 6. Billing, Fees & Financial Support
  tuitionPaymentMethod: 'Government Loan (HECS-HELP / FEE-HELP)',
  govLoanType: 'Commonwealth Supported Place (CSP)',
  taxFileNumberProvided: true,
  sponsorshipDetails: 'N/A - Direct HECS-HELP eCAF',
  healthCoverProvider: 'N/A (Medicare Domestic)',
  healthCoverPolicyNumber: '',

  // 7. Equity, Accessibility & Disclosures
  requiresAccessibilitySupport: false,
  accessibilitySupportDetails: '',
  isMinorUnder18: false,
  guardianDetails: '',
  declarationConductAgreed: true,
  declarationPrivacyAgreed: true,
  declarationIntegrityPledged: true,
  declarationFeeLiabilityAccepted: true,

  enrolmentStatus: 'Active Enrolled',
  enrolledDate: new Date().toISOString().split('T')[0]
};

export const INITIAL_SAMPLE_STUDENTS = [
  {
    id: 'STU-2026-001',
    // 1. Identity & Personal Details
    legalFirstName: 'Chloe',
    legalMiddleName: 'Grace',
    legalFamilyName: 'Campbell',
    preferredName: 'Chloe Campbell',
    dateOfBirth: '2005-06-18',
    gender: 'Female',
    proofOfIdentityType: "Australian Passport",
    proofOfIdentityNumber: 'N4892104',
    residencyStatus: RESIDENCY_TYPES.DOMESTIC_CITIZEN,
    passportNumber: 'N4892104',
    visaSubclass: 'Citizen',
    coeNumber: 'N/A',

    // 2. Contact & Emergency
    permanentAddress: '42 Wallaby Way, Sydney NSW 2000, Australia',
    currentTermAddress: '42 Wallaby Way, Sydney NSW 2000, Australia',
    primaryPhone: '+61 412 345 678',
    personalEmail: 'chloe.campbell@email.com.au',
    emergencyContactName: 'David Campbell',
    emergencyContactRelationship: 'Father',
    emergencyContactPhone: '+61 412 999 888',
    emergencyContactLocation: 'Sydney, Australia',

    // 3. Academic History
    priorEducation: 'NSW HSC / ATAR 92.40 (St Andrew College)',
    creditTransferRPL: '12 Credit Points (Advanced Placement Computing)',
    languageProficiencyType: 'Medium of Instruction (English High School)',
    languageScore: 'Exempt (Native English)',
    prerequisitesSatisfied: true,
    prerequisiteNotes: 'Maths Extension 1 (E3), Physics (Band 6)',

    // 4. Regulatory & Government
    jurisdiction: JURISDICTIONS.AUSTRALIA,
    nationalIdNumber: '1004928190', // Aus USI
    indigenousStatus: 'Neither Aboriginal nor Torres Strait Islander',
    homeLanguage: 'English',
    countryOfBirth: 'Australia',
    parentsHighestEducation: 'Postgraduate Degree',

    // 5. Program & Study Load
    degreeTitle: 'Bachelor of Computer Science',
    majorSpecialisation: 'Artificial Intelligence & Machine Learning',
    studyMode: 'On-campus',
    campusLocation: 'Sydney Central Campus',
    attendanceLoad: 'Full-time',
    enrolledCourseIds: [1, 2], // Intro to AI, Web Development

    // 6. Billing & Fees
    tuitionPaymentMethod: 'Government Loan (HECS-HELP / FEE-HELP)',
    govLoanType: 'Commonwealth Supported Place (CSP) with HECS-HELP eCAF',
    taxFileNumberProvided: true,
    sponsorshipDetails: 'Australian Government Subsidised CSP',
    healthCoverProvider: 'Medicare Domestic',
    healthCoverPolicyNumber: '2938 10294 1',

    // 7. Equity & Declarations
    requiresAccessibilitySupport: false,
    accessibilitySupportDetails: 'None requested',
    isMinorUnder18: false,
    guardianDetails: 'N/A (Adult)',
    declarationConductAgreed: true,
    declarationPrivacyAgreed: true,
    declarationIntegrityPledged: true,
    declarationFeeLiabilityAccepted: true,

    enrolmentStatus: 'Active Enrolled',
    enrolledDate: '2026-02-15'
  },
  {
    id: 'STU-2026-002',
    // 1. Identity & Personal Details
    legalFirstName: 'Aarav',
    legalMiddleName: 'Kumar',
    legalFamilyName: 'Patel',
    preferredName: 'Aarav Patel',
    dateOfBirth: '2004-11-23',
    gender: 'Male',
    proofOfIdentityType: 'International Passport',
    proofOfIdentityNumber: 'Z82910482',
    residencyStatus: RESIDENCY_TYPES.INTERNATIONAL_STUDENT,
    passportNumber: 'Z82910482',
    visaSubclass: '500 - Student Visa (Granted)',
    coeNumber: 'PRV2026-AU-99120',

    // 2. Contact & Emergency
    permanentAddress: '14 MG Road, Indiranagar, Bengaluru 560038, India',
    currentTermAddress: 'Unit 402, 180 City Road, Southbank VIC 3006, Australia',
    primaryPhone: '+61 498 765 432',
    personalEmail: 'aarav.patel.dev@gmail.com',
    emergencyContactName: 'Sanjay Patel',
    emergencyContactRelationship: 'Uncle / Local Custodian',
    emergencyContactPhone: '+61 488 123 456',
    emergencyContactLocation: 'Melbourne, Australia',

    // 3. Academic History
    priorEducation: 'CBSE Senior School Certificate (94.2%), Bengaluru',
    creditTransferRPL: 'Nil',
    languageProficiencyType: 'IELTS Academic',
    languageScore: '8.0 Overall (L:8.5, R:8.0, W:7.5, S:7.5)',
    prerequisitesSatisfied: true,
    prerequisiteNotes: 'Senior Mathematics (95%), Computer Science (96%)',

    // 4. Regulatory & Government
    jurisdiction: JURISDICTIONS.AUSTRALIA,
    nationalIdNumber: '9284710294', // Aus USI
    indigenousStatus: 'Not Applicable',
    homeLanguage: 'Gujarati / English',
    countryOfBirth: 'India',
    parentsHighestEducation: 'Bachelor Degree',

    // 5. Program & Study Load
    degreeTitle: 'Master of Data Science',
    majorSpecialisation: 'Big Data & Cloud Architecture',
    studyMode: 'On-campus',
    campusLocation: 'Melbourne Docklands',
    attendanceLoad: 'Full-time',
    enrolledCourseIds: [1], // Intro to AI

    // 6. Billing & Fees
    tuitionPaymentMethod: 'Upfront Direct Payment',
    govLoanType: 'Not Applicable (International Fee-Paying)',
    taxFileNumberProvided: false,
    sponsorshipDetails: 'Self-Funded / Family Sponsored',
    healthCoverProvider: 'Medibank OSHC (Comprehensive)',
    healthCoverPolicyNumber: 'MB-OSHC-8819203',

    // 7. Equity & Declarations
    requiresAccessibilitySupport: false,
    accessibilitySupportDetails: '',
    isMinorUnder18: false,
    guardianDetails: 'N/A',
    declarationConductAgreed: true,
    declarationPrivacyAgreed: true,
    declarationIntegrityPledged: true,
    declarationFeeLiabilityAccepted: true,

    enrolmentStatus: 'Active Enrolled',
    enrolledDate: '2026-02-18'
  }
];

export const CSV_STUDENT_TEMPLATE = `Legal First Name,Legal Middle Name,Legal Family Name,Preferred Name,Date of Birth (YYYY-MM-DD),Gender,Residency Status,Passport or ID Number,Visa Subclass or CoE,Primary Phone,Personal Email,Permanent Address,Next of Kin Name,Emergency Phone,Prior Education,English Proficiency,National Student ID (USI/SSN/ULN),Country of Birth,Degree Title,Major Specialisation,Campus Location,Study Mode,Tuition Payment Method,Health Insurance (OSHC/Medicare)
Chloe,Grace,Campbell,Chloe Campbell,2005-06-18,Female,Domestic Citizen,N4892104,Citizen,+61 412 345 678,chloe.c@example.com,"42 Wallaby Way, Sydney NSW 2000",David Campbell,+61 412 999 888,NSW HSC ATAR 92.4,Exempt Native,1004928190,Australia,Bachelor of Computer Science,Artificial Intelligence,Sydney Central,On-campus,Government Loan (HECS-HELP),Medicare Domestic
Aarav,Kumar,Patel,Aarav Patel,2004-11-23,Male,International Student (Visa 500),Z82910482,PRV2026-AU-99120,+61 498 765 432,aarav.p@example.com,"14 MG Road, Bengaluru, India",Sanjay Patel,+61 488 123 456,CBSE Senior 94.2%,IELTS 8.0,9284710294,India,Master of Data Science,Big Data & Cloud,Melbourne Docklands,On-campus,Upfront Direct Payment,Medibank OSHC MB-8819203
Liam,James,O'Connor,Liam O'Connor,2005-09-04,Male,Domestic Citizen,D9102834,Citizen,+61 433 881 229,liam.oc@example.com,"15 Barangaroo Ave, Sydney NSW",Mary O'Connor,+61 433 992 110,Victorian VCE ATAR 89.1,Exempt Native,1005928172,Australia,Bachelor of Business,FinTech & Analytics,Sydney Central,Hybrid / Blended,Government Loan (HECS-HELP),Medicare Domestic`;

/**
 * Parses raw CSV or spreadsheet paste containing student records
 */
export function parseStudentCsv(rawText) {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText.trim().split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  // Parse header
  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  
  const students = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length === 0 || !values.some(v => v.trim())) continue;

    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || '').trim();
    });

    const firstName = row['legal first name'] || row['first name'] || row['firstname'] || values[0] || 'Unknown';
    const middleName = row['legal middle name'] || row['middle name'] || values[1] || '';
    const familyName = row['legal family name'] || row['family name'] || row['last name'] || values[2] || '';
    const preferredName = row['preferred name'] || `${firstName} ${familyName}`.trim();
    const dob = row['date of birth (yyyy-mm-dd)'] || row['dob'] || row['date of birth'] || values[4] || '2005-01-01';
    const gender = row['gender'] || row['sex'] || 'Unspecified';
    const residency = row['residency status'] || row['residency'] || 'Domestic Citizen';
    const idNumber = row['passport or id number'] || row['id number'] || row['passport'] || 'VERIFIED-ID';
    const phone = row['primary phone'] || row['phone'] || row['mobile'] || '';
    const email = row['personal email'] || row['email'] || `${firstName.toLowerCase()}.${familyName.toLowerCase()}@ozedu.sample.edu`;
    const degree = row['degree title'] || row['degree'] || row['program'] || 'Bachelor of Science';
    const major = row['major specialisation'] || row['major'] || 'General';
    const nationalId = row['national student id (usi/ssn/uln)'] || row['usi'] || row['national id'] || 'USI-' + Math.floor(1000000000 + Math.random() * 9000000000);
    const campus = row['campus location'] || row['campus'] || 'Sydney Central';
    const studyMode = row['study mode'] || 'On-campus';
    const tuition = row['tuition payment method'] || 'Government Loan (HECS-HELP)';
    const health = row['health insurance (oshc/medicare)'] || 'Medicare Domestic';
    const kinName = row['next of kin name'] || row['emergency contact'] || 'Emergency Contact';
    const kinPhone = row['emergency phone'] || phone;

    students.push({
      id: `STU-${new Date().getFullYear()}-${String(100 + i).padStart(3, '0')}`,
      legalFirstName: firstName,
      legalMiddleName: middleName,
      legalFamilyName: familyName,
      preferredName: preferredName,
      dateOfBirth: dob.match(/^\d{4}-\d{2}-\d{2}$/) ? dob : '2005-01-01',
      gender: gender,
      proofOfIdentityType: residency.toLowerCase().includes('international') ? 'International Passport' : "Australian Driver's Licence",
      proofOfIdentityNumber: idNumber,
      residencyStatus: residency,
      passportNumber: idNumber,
      visaSubclass: residency.toLowerCase().includes('international') ? '500 - Student Visa' : 'Citizen',
      coeNumber: residency.toLowerCase().includes('international') ? `COE-${Math.floor(100000 + Math.random() * 900000)}` : 'N/A',
      permanentAddress: row['permanent address'] || 'Residential Address Recorded',
      currentTermAddress: row['current term address'] || row['permanent address'] || 'Local Address Recorded',
      primaryPhone: phone,
      personalEmail: email,
      emergencyContactName: kinName,
      emergencyContactRelationship: 'Parent / Guardian',
      emergencyContactPhone: kinPhone,
      emergencyContactLocation: 'Registered Address',
      priorEducation: row['prior education'] || 'Secondary Qualification Verified',
      creditTransferRPL: 'Standard Standing',
      languageProficiencyType: row['english proficiency'] || 'Institution Standard Met',
      languageScore: 'Verified',
      prerequisitesSatisfied: true,
      prerequisiteNotes: 'Academic conditions satisfied',
      jurisdiction: JURISDICTIONS.AUSTRALIA,
      nationalIdNumber: nationalId,
      indigenousStatus: 'Neither Aboriginal nor Torres Strait Islander',
      homeLanguage: 'English',
      countryOfBirth: row['country of birth'] || 'Australia',
      parentsHighestEducation: 'Higher Education',
      degreeTitle: degree,
      majorSpecialisation: major,
      studyMode: studyMode,
      campusLocation: campus,
      attendanceLoad: 'Full-time',
      enrolledCourseIds: [],
      tuitionPaymentMethod: tuition,
      govLoanType: tuition.includes('Loan') ? 'HECS-HELP / CSP' : 'Direct Payment',
      taxFileNumberProvided: true,
      sponsorshipDetails: 'Standard Enrolment',
      healthCoverProvider: health,
      healthCoverPolicyNumber: 'POL-' + Math.floor(100000 + Math.random() * 900000),
      requiresAccessibilitySupport: false,
      accessibilitySupportDetails: '',
      isMinorUnder18: false,
      guardianDetails: 'N/A',
      declarationConductAgreed: true,
      declarationPrivacyAgreed: true,
      declarationIntegrityPledged: true,
      declarationFeeLiabilityAccepted: true,
      enrolmentStatus: 'Active Enrolled',
      enrolledDate: new Date().toISOString().split('T')[0]
    });
  }

  return students;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else if (char === '\t' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
