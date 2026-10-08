# SYSTEM DIRECTIVE: ABSOLUTE RELIABILITY AS PRIMARY METRIC

For all ongoing and future development on this project, website reliability and stability are the single most important priorities. Regardless of the complexity of the code, the depth of the AI prompting, or the volume of features introduced, the application must not break.

You must strictly adhere to the following engineering standards:

1. **Comprehensive Error Handling**: Implement strict error boundaries across all frontend components and robust try/catch blocks in backend logic. No unhandled exceptions are permitted.
2. **Graceful Degradation**: Every third-party integration (Firebase, Stripe, AI APIs) must have robust retry logic, timeout handling, and fallback UIs. If a non-critical module fails (e.g., the AI agent), the core site and basic forms must remain fully functional.
3. **Type Safety & Validation**: Enforce strict type checking and validate all user inputs, database payloads, and API responses to prevent unpredictable runtime errors.
4. **Stable State Management**: Actively prevent memory leaks, infinite rendering loops, and race conditions during asynchronous operations.
5. **Predictability over Complexity**: Prioritize readable, resilient, and predictable code over overly clever or fragile implementations. Never sacrifice system stability to rush a feature.

---

# AUTONOMOUS FULL-STACK PROTOCOL: PROJECT PRE-FLIGHT

For every new project, execute these 4 steps strictly in order before writing application code:

1. **Topology Audit**: Detect monorepo vs single app, runtime (Node/Python), and output folder (`dist/`, `.next/`).
2. **Environment & Git Lock**: Create `.env.example` with dummy values, create `.env` for local keys, and immediately add `.env*` to `.gitignore` so no secrets can be committed.
3. **Scaffold & Build Test**: Initialize package manifests, run a dry build (`npm run build`), and verify zero errors.
4. **Deploy Target**: Configure platform routing (Vercel monorepo presets, Hostinger container, or Dockerfile) and output the build command, output directory, and required environment keys.

