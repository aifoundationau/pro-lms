// src/services/globalCoursesData.js

const SUBJECT_TEMPLATES = [
  // 1. Artificial Intelligence & Data Science
  {
    category: 'Artificial Intelligence & Data Science',
    authors: [
      'Prof. Eleanor Vance, PhD', 'Dr. Marcus Thorne', 'Prof. Priya Sharma', 
      'Dr. Kenji Takahashi', 'A/Prof. David Chen', 'Dr. Elena Rostova',
      'Prof. Alan Turing Fellow Sarah Jenkins', 'Dr. Tariq Al-Hassan'
    ],
    titles: [
      'Deep Learning & Convolutional Neural Architectures',
      'Natural Language Processing with Large Language Models',
      'Reinforcement Learning & Autonomous Decision Systems',
      'Computer Vision & Real-Time Object Detection',
      'Bayesian Statistics & Probabilistic Machine Learning',
      'Generative AI: Diffusion Models & Transformer Foundations',
      'Big Data Engineering with Apache Spark & Iceberg',
      'AI Ethics, Algorithmic Bias & Regulatory Compliance',
      'Time Series Forecasting & Quantitative Financial Analytics',
      'Graph Neural Networks & Relational Knowledge Graphs',
      'Explainable AI (XAI) for Medical Diagnostics',
      'MLOps: Automated CI/CD Pipelines for Production Machine Learning',
      'Edge AI & TinyML for IoT Sensor Networks',
      'Vector Databases & Retrieval Augmented Generation (RAG)',
      'Data Mining & High-Dimensional Feature Engineering'
    ]
  },
  // 2. Software Engineering & Cloud
  {
    category: 'Computer Science & Software Systems',
    authors: [
      'Prof. Michael Stonebraker Institute', 'Dr. Clara Oswald', 'A/Prof. Brendan Eich Lab',
      'Dr. Samuel Okonjo', 'Prof. Hannah Lindqvist', 'Dr. Carlos Mendoza'
    ],
    titles: [
      'Advanced React 19 Patterns & Concurrent Architectures',
      'Microservices Orchestration with Kubernetes & Istio',
      'Full-Stack TypeScript & Enterprise System Design',
      'Distributed Consensus Algorithms & Fault-Tolerant Systems',
      'Compiler Design & Abstract Syntax Tree Optimisations',
      'High-Performance Rust for System Programming',
      'Cloud-Native Architecture on AWS, GCP & Azure',
      'Database Internals: Storage Engines & Query Planners',
      'API Design: GraphQL, gRPC & Event-Driven WebSockets',
      'DevOps Engineering & Immutable Infrastructure as Code',
      'Serverless Architectures & Edge Function Workflows',
      'WebAssembly & High-Performance In-Browser Computing',
      'Software Testing Automation & Mutation Testing Rigour',
      'Modern Linux Kernel Internals & Network Sockets',
      'Mobile Application Architecture with Flutter & React Native'
    ]
  },
  // 3. Cybersecurity & Information Systems
  {
    category: 'Cybersecurity & InfoSec',
    authors: [
      'Dr. Alexander Vance (CISSP)', 'Prof. Rachel Sterling', 'A/Prof. Kevin Mitnick Chair',
      'Dr. Naomi Nagata', 'Prof. Julian Assange Fellow Linus Becker'
    ],
    titles: [
      'Offensive Penetration Testing & Red Teaming Tactics',
      'Zero Trust Network Architecture & Identity Governance',
      'Cloud Security Posture Management & DevSecOps',
      'Applied Cryptography: Elliptic Curves & Post-Quantum Algorithms',
      'Digital Forensics, Memory Analysis & Incident Response',
      'Malware Reverse Engineering & Binary Exploitation',
      'Secure Software Lifecycle: Threat Modeling & Static Analysis',
      'Defensive SIEM, SOAR & Autonomous Threat Hunting',
      'Hardware Security: Side-Channel Attacks & Hardware Trojans',
      'SCADA & Industrial Control Systems (ICS) Cybersecurity',
      'Privacy-Preserving Computation & Differential Privacy',
      'Dark Web Intelligence & Global Cyber Crime Investigation',
      'Identity & Access Management (IAM) at Scale',
      'Web Application Security: OWASP Top 10 Exploitation & Defense'
    ]
  },
  // 4. Medicine, Nursing & Healthcare
  {
    category: 'Medicine & Health Sciences',
    authors: [
      'Prof. Jonathan Hayes, MBBS MD', 'Dr. Beatrice Campbell (FRACP)', 
      'A/Prof. Arvind Swaminathan', 'Dr. Claire Beauchamp', 'Prof. Mei-Ling Zhou'
    ],
    titles: [
      'Clinical Epidemiology & Global Pandemic Preparedness',
      'Molecular Genetics & Precision Oncology',
      'Advanced Human Anatomy & Cadaveric Dissection',
      'Emergency Medicine & Trauma Resuscitation Protocols',
      'Neurobiology of Cognitive Disorders & Dementia Care',
      'Pharmacokinetics & Rational Antimicrobial Therapeutics',
      'Cardiology: Hemodynamics, ECG Interpretation & Heart Failure',
      'Pediatric Critical Care & Neonatal Management',
      'Public Health Policy & Health Economics Evaluation',
      'Immunology: Vaccines, Autoimmunity & Immunotherapy',
      'Surgical Skills & Minimally Invasive Laparoscopy',
      'Medical Ethics, Bio-Law & Palliative Patient Autonomy',
      'Telehealth Infrastructure & AI-Driven Clinical Triage',
      'Mental Health Clinical Assessment & Evidence-Based Psychotherapy'
    ]
  },
  // 5. Business, Leadership & Management
  {
    category: 'Business & Management',
    authors: [
      'Prof. Warren Sterling (Harvard Fellow)', 'Dr. Vivienne Westwood', 
      'A/Prof. Liam Montgomery', 'Dr. Farah Al-Sayed', 'Prof. Donald McKinnon'
    ],
    titles: [
      'Strategic Management & Global Corporate Governance',
      'Venture Capital, Private Equity & Startup Valuation',
      'Executive Leadership & Organizational Transformation',
      'International Supply Chain Logistics & Port Operations',
      'Consumer Behavior, Neuromarketing & Brand Equity',
      'Financial Accounting & International IFRS Standards',
      'Product Management: Agile Frameworks & Market Fit',
      'Digital Transformation & Business Model Innovation',
      'Negotiation Dynamics & High-Stakes Deal Structuring',
      'Sustainable Corporate ESG Strategy & Green Accounting',
      'Human Resource Talent Strategy & Workforce Analytics',
      'Operations Research & Queuing Theory in Business',
      'Global Mergers, Acquisitions & Hostile Takeovers',
      'Corporate Risk Management & Economic Hedging'
    ]
  },
  // 6. Finance & Economics
  {
    category: 'Finance & Economics',
    authors: [
      'Prof. Robert Shiller Chair', 'Dr. Amartya Sen Institute', 
      'A/Prof. Christine Lagarde Fellow', 'Dr. Nigel Farrington', 'Prof. Yulia Petrova'
    ],
    titles: [
      'Microeconomic Theory: General Equilibrium & Welfare',
      'Macroeconomic Policy, Inflation & Central Bank Mandates',
      'Derivatives, Options Pricing & Stochastic Calculus',
      'Corporate Finance: Capital Structure & Dividend Policy',
      'Econometrics: Instrumental Variables & Panel Data',
      'Algorithmic Trading & High-Frequency Market Microstructure',
      'Behavioral Finance: Market Bubbles & Heuristic Bias',
      'Development Economics & Poverty Alleviation Programs',
      'International Trade Agreements & Currency Exchange Dynamics',
      'Decentralized Finance (DeFi) & Smart Contract Auditing',
      'Real Estate Investment Trusts & Commercial Property Modeling',
      'Sovereign Debt Crises & IMF Structural Adjustment'
    ]
  },
  // 7. Law, Governance & Politics
  {
    category: 'Law & Governance',
    authors: [
      'Justice Rosalind Higgins Chair', 'Prof. Alistair Finch (KC)', 
      'Dr. Fatima Zahra', 'A/Prof. William Blackstone Fellow', 'Dr. Thabo Mbeki'
    ],
    titles: [
      'Constitutional Law & Separation of Powers in Democracies',
      'International Humanitarian Law & Geneva Conventions',
      'Intellectual Property, Patents & Trade Secret Law',
      'Commercial Contract Drafting & International Arbitration',
      'Environmental Law & Global Climate Litigation',
      'Criminal Law, Jurisprudence & Criminal Procedure',
      'Cyber Law, Digital Copyright & Data Sovereignty',
      'Human Rights Law & International Court Jurisdictions',
      'Administrative Law, Judicial Review & Statutory Interpretation',
      'Maritime Law & Law of the Sea (UNCLOS)',
      'Corporate Insolvency & Creditor Rights Protection',
      'Geopolitics & Multilateral Foreign Policy Formulation'
    ]
  },
  // 8. Engineering & Physics
  {
    category: 'Engineering & Applied Physics',
    authors: [
      'Prof. Nikola Tesla Chair', 'Dr. Richard Feynman Fellow', 
      'A/Prof. Hiroshi Tanaka', 'Dr. Marie Curie Institute', 'Prof. Duncan MacLeod'
    ],
    titles: [
      'Thermodynamics & Heat Transfer in Industrial Systems',
      'Quantum Mechanics: Wavefunctions & Entanglement',
      'Aerospace Propulsion & Supersonic Aerodynamics',
      'Structural Mechanics & Finite Element Analysis (FEA)',
      'Semiconductor Physics & VLSI Microchip Fabrication',
      'Robotics Kinematics, Dynamics & Inverse Manipulators',
      'Astrophysics: Stellar Evolution & Gravitational Waves',
      'Renewable Energy Systems: Solar Photovoltaics & Wind Turbines',
      'Fluid Dynamics & Computational Navier-Stokes Modeling',
      'Nanotechnology: Carbon Nanotubes & Quantum Dots',
      'Civil Geotechnical Engineering & Tunneling Mechanics',
      'Nuclear Engineering: Fission Reactors & Fusion Tokamaks'
    ]
  },
  // 9. Environmental Sciences & Sustainability
  {
    category: 'Environmental Science',
    authors: [
      'Prof. David Attenborough Fellow', 'Dr. Jane Goodall Chair', 
      'Dr. Ananya Roy', 'A/Prof. Lars Olofsson', 'Prof. Sheila Watt-Cloutier'
    ],
    titles: [
      'Climate Modeling & Greenhouse Gas Feedback Loops',
      'Marine Biology & Coral Reef Conservation Ecology',
      'Soil Science, Regenerative Agriculture & Carbon Sinks',
      'Hydrology, Watershed Management & Freshwater Ecology',
      'Forest Ecology, Wildfire Dynamics & Reforestation',
      'Urban Ecology & Sustainable Smart City Infrastructure',
      'Toxicology, Ecotoxicology & Industrial Pollutants',
      'Biodiversity Conservation & Endangered Species Genetics',
      'Circular Economy, Waste Valorisation & Zero-Carbon Supply',
      'Arctic & Antarctic Glaciology & Ice Sheet Dynamics'
    ]
  },
  // 10. Psychology & Cognitive Science
  {
    category: 'Psychology & Behavioural Sciences',
    authors: [
      'Prof. Carl Jung Chair', 'Dr. Daniel Kahneman Fellow', 
      'A/Prof. Elizabeth Loftus', 'Dr. Oliver Sacks Institute', 'Prof. Maya Angelou'
    ],
    titles: [
      'Cognitive Psychology: Memory, Perception & Attention',
      'Neuropsychology of Traumatic Brain Injury & Recovery',
      'Developmental Psychology from Infancy through Adolescence',
      'Social Psychology: Conformity, Obedience & In-Group Bias',
      'Clinical Psychopathology & Diagnostic DSM-5 Criteria',
      'Positive Psychology, Resilience & Human Flourishing',
      'Behavioral Genetics & Environmental Epigenetics',
      'Forensic Psychology: Criminal Profiling & Eyewitness Testimony',
      'Addiction Science: Neurochemistry & Behavioral Rehabilitation'
    ]
  },
  // 11. Design, Architecture & Fine Arts
  {
    category: 'Design & Architecture',
    authors: [
      'Prof. Zaha Hadid Foundation', 'Dr. Walter Gropius Institute', 
      'A/Prof. Renzo Piano Chair', 'Dr. Maya Lin', 'Prof. Antoni Gaudí Fellow'
    ],
    titles: [
      'Parametric Architecture & Computational Form Generation',
      'Modernist Architectural History & Urban Typography',
      'User Experience (UX) Research & Human-Computer Interaction',
      'Design Thinking & Rapid Prototyping Methodologies',
      'Typography, Grid Systems & Editorial Graphic Design',
      'Sustainable Passive Solar Architectural Engineering',
      'Interior Architecture, Ergonomics & Spatial Psychology',
      '3D Rendering, Photorealistic Lighting & Ray-Tracing',
      'Historic Heritage Preservation & Structural Retrofitting'
    ]
  },
  // 12. Humanities, Philosophy & Languages
  {
    category: 'Humanities & Languages',
    authors: [
      'Prof. Noam Chomsky Chair', 'Dr. Jacques Derrida Institute', 
      'A/Prof. Chinua Achebe Fellow', 'Dr. Simone de Beauvoir', 'Prof. Umberto Eco'
    ],
    titles: [
      'Classical Greek & Roman Philosophy: Plato to Marcus Aurelius',
      'Epistemology & Philosophy of Scientific Knowledge',
      'Post-Colonial Literature & Decolonial Discourse',
      'Computational Linguistics & Phonological Analysis',
      'Ancient History: Mediterranean & Near Eastern Civilizations',
      'Ethics in Technology, Bioethics & Existential Risk',
      'Creative Writing: Advanced Fiction & Narrative Structure',
      'Comparative World Religions & Sacred Texts',
      'Applied Translation Theory & Cross-Cultural Semiotics'
    ]
  }
];

// Sub-levels / Specialisation prefixes to multiply into 900+ unique courses
const LEVEL_VARIANTS = [
  'Foundations of',
  'Advanced Topics in',
  'Principles of',
  'Applied',
  'Masterclass in',
  'Contemporary Issues in'
];

/**
 * Builds at least 900 distinct, realistic courses with subjects and authors
 */
export function generate900GlobalCourses() {
  const initialBaseCourses = [
    { id: 101, title: 'Advanced React Patterns', author: 'Jane Doe', students: 304, category: 'Computer Science & Software Systems', tag: 'lms', tags: ['lms', 'Computer Science & Software Systems'] },
    { id: 102, title: 'Data Structures in Python', author: 'Alan Smith', students: 890, category: 'Computer Science & Software Systems', tag: 'lms', tags: ['lms', 'Computer Science & Software Systems'] },
    { id: 103, title: 'Machine Learning Basics', author: 'AI Foundation', students: 1200, category: 'Artificial Intelligence & Data Science', tag: 'lms', tags: ['lms', 'Artificial Intelligence & Data Science'] },
    { id: 104, title: 'UI/UX Masterclass', author: 'Design Co.', students: 450, category: 'Design & Architecture', tag: 'lms', tags: ['lms', 'Design & Architecture'] },
  ];

  const generated = [...initialBaseCourses];
  let currentId = 105;

  // Generate systematic combinations to reach >= 900 items
  for (let round = 0; round < 8; round++) {
    for (const group of SUBJECT_TEMPLATES) {
      for (let tIdx = 0; tIdx < group.titles.length; tIdx++) {
        if (generated.length >= 936) break; // 936 is 26 full pages of 36 courses!

        const baseTitle = group.titles[tIdx];
        const prefix = LEVEL_VARIANTS[(round + tIdx) % LEVEL_VARIANTS.length];
        const author = group.authors[(round + tIdx) % group.authors.length];

        // Format unique title
        let finalTitle = '';
        if (round === 0) {
          finalTitle = baseTitle;
        } else if (round === 1) {
          finalTitle = `${prefix} ${baseTitle}`;
        } else if (round === 2) {
          finalTitle = `${baseTitle} (Level II)`;
        } else if (round === 3) {
          finalTitle = `${prefix} ${baseTitle}: Global Perspectives`;
        } else if (round === 4) {
          finalTitle = `${baseTitle} & Industry Case Studies`;
        } else {
          finalTitle = `Specialised Research Seminar in ${baseTitle}`;
        }

        // Random realistic student count between 120 and 4200
        const students = Math.floor(120 + ((currentId * 37) % 3980));
        
        // Staggered start dates in 2026
        const month = String(1 + ((currentId % 12))).padStart(2, '0');
        const day = String(1 + ((currentId * 7) % 28)).padStart(2, '0');
        const startDate = `2026-${month}-${day}`;

        generated.push({
          id: currentId,
          title: finalTitle,
          author: author,
          students: students,
          category: group.category,
          startDate: startDate,
          tag: 'lms',
          tags: ['lms', group.category]
        });

        currentId++;
      }
    }
  }

  return generated;
}

export const ALL_GLOBAL_COURSES = generate900GlobalCourses();

/**
 * Standard LMS categories tagged with 'lms' for cross-app sharing
 */
export const LMS_CATEGORIES = SUBJECT_TEMPLATES.map((tmpl, idx) => {
  const slug = tmpl.category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    id: `cat-${slug}`,
    slug,
    name: tmpl.category,
    description: `Comprehensive academic and vocational curriculum in ${tmpl.category}.`,
    aqfLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    tag: 'lms',
    tags: ['lms', 'category', slug],
    sampleAuthors: tmpl.authors.slice(0, 3),
    courseCount: ALL_GLOBAL_COURSES.filter(c => c.category === tmpl.category).length || 78
  };
});
