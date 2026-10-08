---
name: data-to-ai-audit
description: Data-to-AI Form Audit & LMS Retrofit. Use when the user says "Run the Data-to-AI Form Audit" or asks to audit forms/data entry points, retrofit the database to the lms namespace, or generate AI intake questions.
---

# Skill: Data-to-AI Form Audit & LMS Retrofit

**Trigger:** "Run the Data-to-AI Form Audit"

**Architecture & Context:**
- **Global Tag:** All database architecture, queries, and data points assessed in this audit must be tagged, categorized, or nested under the `lms` namespace. 
- **Legacy Retrofit:** Any previous database development, legacy schemas, or existing tables must be audited and modified to suit this new `lms` categorization. 
- **Shared Ecosystem:** This database is shared across multiple education-oriented websites. The data flow must support cross-referencing so that new courses can dynamically draw and recall content, modules, and information from other courses within the network.

**Objective:** 
Act as an expert data-mapping and integration auditor. Retrofit existing database architecture to the `lms` structure, map every customer-facing data entry point to this schema, verify perfect data storage/recall across the shared network, and generate conversational logic for external AI intake agents (Voiceflow, Retell AI, Vapi, etc.).

**Execution Steps:**
1. **Audit & Retrofit Legacy Database:** Scan existing database schemas, models, and migrations. Propose the necessary modifications and migration scripts to categorize all previous development under the new `lms` structure.
2. **Identify Entry Points:** Scan the frontend components and API routes to locate every form, input field, and data collection point intended for students, creators, or administrators.
3. **Verify Database Linkage & Recall:** Trace each entry point through the backend to its exact database table and column. Verify that the data flow allows for successful storage and retrieval within the `lms` ecosystem. Specifically check that the query structure permits pulling shared course data across different sites. 
4. **Generate AI Intake Elicitations:** For every successfully mapped field, draft 1-2 natural, conversational questions an AI agent should ask to collect this data.
5. **Create a Master Ledger:** Output an Artifact containing a Markdown table with the following columns:
   - UI Field / Data Point
   - Frontend File Path
   - Database Table & Column
   - LMS Categorization (Compliant / Needs Retrofit)
   - Storage/Recall Status (Verified / Broken)
   - Cross-Course Capability (Can this be pulled by other courses?)
   - Proposed AI Intake Question(s)
6. **Propose Fixes & Migrations:** After presenting the ledger, wait for user confirmation. Once approved, provide the exact code updates and safe database migration scripts required to fix broken connections and complete the `lms` retrofitting.

**Guardrails:**
- Always present the master ledger and migration plans for review before altering code or database structures.
- Do NOT execute any breaking database schema changes automatically; rely on safe migration scripts to avoid data loss during the retrofit.
- Ensure all queries and endpoints respect the multi-site shared database structure.
- Ensure the AI Intake Questions are formatted simply so they can be copy-pasted directly into conversational node structures.
