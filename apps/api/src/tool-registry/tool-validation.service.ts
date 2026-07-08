import { Injectable, Logger } from '@nestjs/common';
import { createRequire } from 'node:module';
import * as ts from 'typescript';
import Ajv, { ErrorObject } from 'ajv';

const requireFromCjs = createRequire(__filename);

@Injectable()
export class ToolValidationService {
  private readonly logger = new Logger(ToolValidationService.name);
  private readonly ajv: Ajv;

  constructor() {
    // Disable schema validation to avoid meta-schema resolution errors with $ref
    // We validate the structure using validateTypeScript instead
    this.ajv = new Ajv({
      validateSchema: false,
    });
    // ajv-formats targets newer AJV major versions; this service currently uses AJV v6.
    const ajvPackage = requireFromCjs('ajv/package.json') as {
      version?: string;
    };
    const ajvMajorVersion = Number.parseInt(
      (ajvPackage.version ?? '').split('.')[0] ?? '0',
      10,
    );
    if (ajvMajorVersion >= 7) {
      try {
        const addFormatsModule = requireFromCjs('ajv-formats') as
          | ((ajv: unknown) => void)
          | { default: (ajv: unknown) => void };
        const addFormats =
          typeof addFormatsModule === 'function'
            ? addFormatsModule
            : addFormatsModule.default;
        addFormats(this.ajv);
      } catch (e) {
        const error = e as Error;
        this.logger.warn(`Failed to load ajv-formats: ${error.message}`);
      }
    }
  }

  validateTypeScript(code: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const sourceFile = ts.createSourceFile(
      'tool.ts',
      code,
      ts.ScriptTarget.Latest,
      true,
    );
    const diagnostics: ts.Diagnostic[] = (
      sourceFile as unknown as { parseDiagnostics: ts.Diagnostic[] }
    ).parseDiagnostics;

    diagnostics.forEach((d) => {
      const start = d.start ?? 0;
      const { line, character } =
        sourceFile.getLineAndCharacterOfPosition(start);
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      errors.push(
        `Syntax error at line ${(line + 1).toString()}, col ${(character + 1).toString()}: ${message}`,
      );
    });

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    const checkNode = (node: ts.Node) => {
      this.checkForbiddenFunctionCall(node, errors);
      this.checkForbiddenRequireImport(node, errors);
      this.checkForbiddenProcessProperty(node, errors);
      ts.forEachChild(node, checkNode);
    };

    checkNode(sourceFile);

    const isValid = errors.length === 0;
    return {
      valid: isValid,
      errors,
    };
  }

  private checkForbiddenFunctionCall(node: ts.Node, errors: string[]): void {
    if (!ts.isCallExpression(node)) {
      return;
    }

    const expression = node.expression;
    if (!ts.isIdentifier(expression)) {
      return;
    }

    if (expression.text === 'eval' || expression.text === 'Function') {
      errors.push(`Forbidden function call: ${expression.text}`);
    }
  }

  private checkForbiddenRequireImport(node: ts.Node, errors: string[]): void {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== 'require'
    ) {
      return;
    }

    const arg = node.arguments[0];
    if (!arg || !ts.isStringLiteral(arg)) {
      return;
    }

    const forbidden = [
      'fs',
      'child_process',
      'http',
      'https',
      'net',
      'os',
      'cluster',
      'worker_threads',
    ];
    if (forbidden.includes(arg.text) || arg.text.startsWith('node:')) {
      errors.push(`Forbidden module import: ${arg.text}`);
    }
  }

  private checkForbiddenProcessProperty(node: ts.Node, errors: string[]): void {
    if (!ts.isPropertyAccessExpression(node)) {
      return;
    }

    if (
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== 'process'
    ) {
      return;
    }

    if (!ts.isIdentifier(node.name)) {
      return;
    }

    const forbiddenProps = ['exit', 'env', 'kill', 'disconnect'];
    if (forbiddenProps.includes(node.name.text)) {
      errors.push(`Forbidden access to process.${node.name.text}`);
    }
  }

  validateSchema(schema: unknown): { valid: boolean; errors: string[] } {
    try {
      if (typeof schema !== 'object' || schema === null) {
        return { valid: false, errors: ['Schema must be an object'] };
      }

      const rootTypeError = this.validateRootIsObjectType(
        schema as Record<string, unknown>,
      );
      if (rootTypeError) {
        return { valid: false, errors: [rootTypeError] };
      }

      const isValid = this.ajv.validateSchema(schema);
      if (!isValid) {
        const ajvErrors = this.ajv.errors;
        if (ajvErrors) {
          return {
            valid: false,
            errors: ajvErrors.map((error) => this.formatAjvError(error)),
          };
        }
        return { valid: false, errors: ['Invalid JSON Schema'] };
      }
      return { valid: true, errors: [] };
    } catch (e) {
      const error = e as Error;
      return { valid: false, errors: [error.message] };
    }
  }

  /**
   * Tool/capability schemas are dispatched to LLM providers as function
   * parameter schemas. Strict providers (e.g. DeepSeek) reject any root that is
   * not `type: "object"` — notably a root `z.union`, which serializes to a
   * `{ anyOf: [...] }` root with no `type` and surfaces provider-side as
   * `type: null`. Fail fast at registration so the authoring bug never reaches
   * an agent's first turn. Returns an error message, or null when the root is a
   * valid object (or omits `type` without a union, which we leave lenient).
   */
  private validateRootIsObjectType(
    schema: Record<string, unknown>,
  ): string | null {
    const guidance =
      'strict providers reject non-object tool-schema roots. If accepting multiple shapes, use one z.object with optional fields + superRefine, not a root z.union.';

    if ('anyOf' in schema || 'oneOf' in schema || 'allOf' in schema) {
      return `Tool schema root must be type:"object", not a union (anyOf/oneOf/allOf); ${guidance}`;
    }

    const rootType = schema.type;
    if (rootType !== undefined && rootType !== 'object') {
      return `Tool schema root must be type:"object" (got ${JSON.stringify(rootType)}); ${guidance}`;
    }

    return null;
  }

  private formatAjvError(error: ErrorObject): string {
    const errorRecord = error as unknown as Record<string, unknown>;
    const instancePath =
      typeof errorRecord.instancePath === 'string'
        ? errorRecord.instancePath
        : '';
    const dataPath =
      typeof errorRecord.dataPath === 'string' ? errorRecord.dataPath : '';
    const message =
      typeof errorRecord.message === 'string'
        ? errorRecord.message
        : 'Unknown error';
    const path = instancePath || dataPath;
    return `${path} ${message}`.trim();
  }
}
