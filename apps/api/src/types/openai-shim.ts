/**
 * Type declaration shim for the `openai` package.
 *
 * In the CI merge gate container, the published `openai@6.42.0` tarball ships
 * its own `index.d.ts`, but the `node_modules` install in the gate image only
 * contains the runtime `index.js` (the bundled `index.d.ts` is missing from
 * disk). The TypeScript compiler therefore reports
 * `TS7016: Could not find a declaration file for module 'openai'` for every
 * importer in `apps/api`.
 *
 * Because the openai package publishes an `exports` field in its
 * `package.json`, the regular `declare module "openai" { ... }` shim pattern
 * is interpreted by TypeScript as a forbidden augmentation of an existing
 * untyped module (TS2665). To work around this, `apps/api/tsconfig.json`
 * maps the bare specifier `openai` to this file via the `paths` compiler
 * option, so the package's untyped JS entry point is bypassed entirely.
 *
 * When the real `index.d.ts` is present on disk in a healthy install, the
 * `paths` mapping is no longer required and TypeScript resolves `openai` to
 * the package's bundled types directly.
 */

// `openai` is consumed by `apps/api/src/memory/llm.service.ts` as
//   `import OpenAI from 'openai'; new OpenAI({...}); openai.chat.completions.create({...})`
// The official `index.d.ts` exposes hundreds of nested types that we don't
// need to recreate here. Instead, we declare only the surface that the
// codebase actually touches and let everything else fall back to permissive
// shapes so the build can pass.

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
  content: string;
}

interface OpenAIChatCompletionChoice {
  message: { role: 'assistant'; content: string };
}

interface OpenAIChatCompletion {
  choices: ReadonlyArray<OpenAIChatCompletionChoice>;
}

interface OpenAIChatCompletionsAPI {
  create(
    params: {
      model: string;
      messages: ReadonlyArray<OpenAIChatMessage>;
    } & Record<string, unknown>,
  ): Promise<OpenAIChatCompletion>;
}

interface OpenAIClient {
  chat: { completions: OpenAIChatCompletionsAPI };
}

interface OpenAIConstructorOptions {
  apiKey?: string;
  baseURL?: string;
  organization?: string;
  timeout?: number;
}

interface OpenAIConstructor {
  new (options?: OpenAIConstructorOptions): OpenAIClient;
}

declare const OpenAI: OpenAIConstructor;
export default OpenAI;
