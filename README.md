# OzEdu LMS (pro-lms)

React + Vite learning platform on Firebase (Firestore, Google sign-in), Stripe and Gemini.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server (also serves `/api/stripe/*`) |
| `npm run build` | Production build into `dist/` |
| `npm run lint` | oxlint |
| `npm test` | Unit + UI interaction tests (spreadsheets, Gemini AI Assist, messaging, enrolment, tokens, screens) — no network |
| `npm run test:rules` | Firestore security rules on the local emulator (needs Java 11+) |
| `npm run test:e2e` | The app's services as signed-in users against the Firestore + Auth emulators (needs Java 11+) |

## Course spreadsheets

Course Builder → **📊 Spreadsheet** downloads the A-to-Z template (Course, Learning Outcomes, Units,
Lessons, Content Blocks, Assessments, Rubrics), a worked example, or the current course. Uploads can be
imported as-is (free) or built out by **✨ AI Assist** with Gemini (teacher values are kept, blanks are
filled, links are never invented). Each assessment's Rubric Matrix also has **⬆ Upload Rubric** for any
number of criterion rows.

Links: the Lessons tab has **YouTube Video Links**, **Google Drive Resource Links** and **Gemini Notebook
Links** columns. Each cell takes any number of links, one per line, optionally written as `Title | link`.
Every link becomes its own block after the lesson's Content Blocks rows. On the Content Blocks tab, text
goes in **Text** and links in **Link URL**, which places a link between other blocks. Exports put links back
in the same columns, so a downloaded course re-imports unchanged.

## Deploying Firestore rules

See `FIRESTORE_RULES_DEPLOY_LOG.txt` (back up live rules first — other apps share the project).

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
