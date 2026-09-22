/**
 * Local ESLint plugin enforcing the app-code invariants.
 * Applied to apps/** and templates/** only (see eslint.config.mjs).
 * Every message ends with "See AGENTS.md §Invariants".
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const SUFFIX = ' See AGENTS.md §Invariants.';

// --- Global sensitive-field names, extracted from the policy source of truth ---
function sensitiveNames() {
  try {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'policy', 'sensitive-fields.ts'),
      'utf8',
    );
    const m = src.match(/'([^']+)'/g) ?? [];
    return new Set(m.map((s) => s.slice(1, -1)));
  } catch {
    return new Set();
  }
}

const toSnake = (s) => s.replace(/([A-Z])/g, '_$1').toLowerCase();
const isSensitiveName = (names, s) => names.has(s) || names.has(toSnake(s));

/** Absolute import allowlist for app code. Referenced by AGENTS.md. */
const ALLOWED_IMPORTS = [
  '@platform/ui',
  '@platform/actions/define',
  '@platform/approvals',
  '@platform/workflow',
  '@platform/data/read',
  '@platform/data/schema-helpers',
  '@platform/actions/run-action',
  'zod',
  'react',
];

/** Client components ('use client' files) get a strictly smaller surface —
 *  server-only APIs like getReadCtx can never be imported there. */
const ALLOWED_CLIENT_IMPORTS = [
  '@platform/ui',
  '@platform/actions/run-action',
  'react',
];

const ALLOWED_DRIZZLE_OPS = new Set([
  'eq', 'and', 'or', 'gt', 'lt', 'inArray', 'isNull', 'desc', 'asc',
]);

const BANNED_HTTP_IMPORTS = new Set([
  'http', 'https', 'node:http', 'node:https', 'axios', 'node-fetch', 'undici',
  'child_process', 'node:child_process', 'fs', 'node:fs', 'net', 'node:net',
]);

/** Dangerous globals — app code has no business touching any of these. */
const BANNED_GLOBALS = new Set([
  'process', 'console', 'fetch', 'globalThis', 'Reflect', 'require', 'eval',
  'Function', 'XMLHttpRequest', 'WebSocket', 'Buffer',
]);

function literalSource(node) {
  if (!node || node.type !== 'Literal' || typeof node.value !== 'string') return null;
  return node.value;
}

/** Normalize a specifier — defeats '..' traversal and case tricks in imports. */
function normalizeSpec(source) {
  const posix = source.replace(/\\/g, '/');
  return source.startsWith('.') ? path.posix.normalize(posix) : posix;
}

function fileHasUseClient(context) {
  const src = context.sourceCode ? context.sourceCode.getText() : context.getSourceCode().getText();
  return /^['"]use client['"]/.test(src.trimStart());
}

/** Visit every node that can pull in a module: static imports, dynamic
 *  import(), re-exports with a source, and require() calls. */
function moduleVisitors(context, check) {
  return {
    ImportDeclaration(node) {
      const src = literalSource(node.source);
      if (src) check(normalizeSpec(src), node, src);
    },
    ImportExpression(node) {
      const src = literalSource(node.source);
      if (src) {
        check(normalizeSpec(src), node, src);
      } else {
        context.report({ node, message: `Dynamic import() with a non-literal specifier is not allowed.${SUFFIX}` });
      }
    },
    ExportNamedDeclaration(node) {
      const src = node.source && literalSource(node.source);
      if (src) check(normalizeSpec(src), node, src);
    },
    ExportAllDeclaration(node) {
      const src = literalSource(node.source);
      if (src) check(normalizeSpec(src), node, src);
    },
    CallExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
        const arg = node.arguments[0];
        const src = arg && literalSource(arg);
        context.report({ node, message: `require() is not allowed in app code.${SUFFIX}` });
        if (src) check(normalizeSpec(src), node, src);
      }
    },
  };
}

const rules = {
  'no-raw-db': {
    create(context) {
      const filename = context.filename ?? context.getFilename();
      const check = (source, n) => {
        if (source === '@platform/data/client') {
          context.report({ node: n, message: `App code may not open a database connection; reads go through getReadCtx/query, writes through defineAction.${SUFFIX}` });
          return;
        }
        if (source === 'drizzle-orm/pg-core') {
          if (!/(^|\/)schema\.ts$/.test(filename)) {
            context.report({ node: n, message: `drizzle-orm/pg-core may only be imported in schema.ts.${SUFFIX}` });
          }
          return;
        }
        if (source === 'drizzle-orm' || source.startsWith('drizzle-orm/')) {
          if (n.importKind === 'type') return;
          if (source !== 'drizzle-orm') {
            context.report({ node: n, message: `Only query operators may be imported from 'drizzle-orm'; no other drizzle module is allowed.${SUFFIX}` });
            return;
          }
          for (const s of n.specifiers ?? []) {
            if (s.type === 'ImportSpecifier') {
              if (s.importKind === 'type') continue;
              if (!ALLOWED_DRIZZLE_OPS.has(s.imported.name)) {
                context.report({ node: s, message: `'${s.imported.name}' is not an allowed drizzle import; only where-clause operators (${[...ALLOWED_DRIZZLE_OPS].join(', ')}) are permitted.${SUFFIX}` });
              }
            } else {
              context.report({ node: s, message: `Namespace/default drizzle imports are not allowed.${SUFFIX}` });
            }
          }
        }
      };
      return {
        ImportDeclaration(node) { const s = literalSource(node.source); if (s) check(normalizeSpec(s), node, s); },
        ImportExpression(node) { const s = literalSource(node.source); if (s) check(normalizeSpec(s), node, s); },
        ExportNamedDeclaration(node) { const s = node.source && literalSource(node.source); if (s) check(normalizeSpec(s), node, s); },
        ExportAllDeclaration(node) { const s = literalSource(node.source); if (s) check(normalizeSpec(s), node, s); },
        CallExpression(node) {
          if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
            const arg = node.arguments[0];
            const s = arg && literalSource(arg);
            if (s) check(normalizeSpec(s), node, s);
          }
        },
      };
    },
  },

  'no-raw-sql': {
    create(context) {
      return {
        ImportDeclaration(node) {
          for (const s of node.specifiers) {
            if (s.type === 'ImportSpecifier' && s.imported.name === 'sql') {
              context.report({ node: s, message: `Raw SQL fragments are not allowed in app code.${SUFFIX}` });
            }
          }
        },
        TaggedTemplateExpression(node) {
          if (node.tag.type === 'Identifier' && node.tag.name === 'sql') {
            context.report({ node, message: `Raw SQL fragments are not allowed in app code.${SUFFIX}` });
          }
        },
      };
    },
  },

  'no-http': {
    create(context) {
      const check = (source, n) => {
        if (BANNED_HTTP_IMPORTS.has(source)) {
          context.report({ node: n, message: `'${source}' is not allowed in app code; external calls go through platform integrations.${SUFFIX}` });
        }
      };
      return {
        ...moduleVisitors(context, check),
        CallExpression(node) {
          if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
            context.report({ node, message: `fetch() is not allowed in app code; external calls go through platform integrations.${SUFFIX}` });
          }
          if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
            const arg = node.arguments[0];
            const s = arg && literalSource(arg);
            if (s) check(normalizeSpec(s), node);
          }
        },
        NewExpression(node) {
          if (node.callee.type === 'Identifier' && node.callee.name === 'XMLHttpRequest') {
            context.report({ node, message: `XMLHttpRequest is not allowed in app code.${SUFFIX}` });
          }
        },
      };
    },
  },

  'no-server-directives': {
    create(context) {
      const filename = context.filename ?? context.getFilename();
      const bannedFile = /(^|\/)route\.tsx?$/.test(filename) || /(^|\/)api\//.test(filename) || /(^|\/)middleware\.tsx?$/.test(filename);
      return {
        Program(node) {
          if (bannedFile) {
            context.report({ node, message: `App code may not define route handlers, api dirs, or middleware.${SUFFIX}` });
          }
          const src = context.sourceCode ? context.sourceCode.getText() : context.getSourceCode().getText();
          if (/^['"]use server['"]/.test(src.trimStart())) {
            context.report({ node, message: `'use server' directives are not allowed in app code; the only server entry is runAction.${SUFFIX}` });
          }
        },
        // 'use server' inside a function body marks a server action — banned
        // anywhere it appears, not just at the top of the file.
        ExpressionStatement(node) {
          if (
            node.expression.type === 'Literal' &&
            node.expression.value === 'use server' &&
            node.parent &&
            (node.parent.type === 'BlockStatement' || node.parent.type === 'FunctionBody' || node.parent.type === 'StaticBlock')
          ) {
            context.report({ node, message: `'use server' directives are not allowed in app code, including inside functions.${SUFFIX}` });
          }
        },
      };
    },
  },

  'no-dangerous-globals': {
    create(context) {
      return {
        Identifier(node) {
          if (!BANNED_GLOBALS.has(node.name)) return;
          // Skip non-computed property names (obj.fetch is a name on someone
          // else's object; fetch/globalThis themselves are banned).
          const p = node.parent;
          if (
            p && p.type === 'MemberExpression' && p.property === node && !p.computed
          ) return;
          if (p && p.type === 'Property' && p.key === node && !p.computed) return;
          if (p && p.type === 'ImportSpecifier') return;
          context.report({ node, message: `'${node.name}' is not allowed in app code.${SUFFIX}` });
        },
        MemberExpression(node) {
          // Computed access to a banned global by string literal:
          // globalThis['fetch'], obj['process'], Reflect['get'] etc.
          if (
            node.computed &&
            node.property.type === 'Literal' &&
            typeof node.property.value === 'string' &&
            BANNED_GLOBALS.has(node.property.value)
          ) {
            context.report({ node, message: `'${node.property.value}' is not allowed in app code.${SUFFIX}` });
          }
        },
        MetaProperty(node) {
          if (node.meta.name === 'import' && node.property.name === 'meta') {
            context.report({ node, message: `import.meta is not allowed in app code.${SUFFIX}` });
          }
        },
      };
    },
  },

  'no-console': {
    create(context) {
      return {
        MemberExpression(node) {
          if (node.object.type === 'Identifier' && node.object.name === 'console') {
            context.report({ node, message: `console.* is not allowed in app code (it can leak PII); rely on audit + platform logs.${SUFFIX}` });
          }
        },
      };
    },
  },

  'no-env': {
    create(context) {
      return {
        MemberExpression(node) {
          if (
            node.object.type === 'MemberExpression' &&
            node.object.object.type === 'Identifier' &&
            node.object.object.name === 'process' &&
            node.object.property.type === 'Identifier' &&
            node.object.property.name === 'env'
          ) {
            context.report({ node, message: `process.env is not allowed in app code; configuration belongs in the manifest/policy.${SUFFIX}` });
          }
        },
      };
    },
  },

  'only-platform-imports': {
    create(context) {
      const filename = context.filename ?? context.getFilename();
      const appMatch = filename.match(/(^|\/)apps\/([^/]+)\//);
      const templateMatch = filename.match(/(^|\/)templates\//);
      const isClient = fileHasUseClient(context);
      const check = (source, n, raw) => {
        // Relative-ness is judged on the RAW specifier (normalize('./x') -> 'x'
        // would strip the marker). Traversal is judged on the normalized path:
        // '..' that resolves outside the app/template dir is an escape.
        const isRelative = raw.startsWith('.');
        // 'use client' files get a strictly smaller surface.
        if (isClient) {
          if (source === 'next/link' || source === 'next/navigation') return;
          if (ALLOWED_CLIENT_IMPORTS.some((a) => source === a || source.startsWith(a + '/'))) return;
          if (isRelative) {
            // still enforce no-escape for client files
          } else {
            context.report({ node: n, message: `Client components may only import ${[...ALLOWED_CLIENT_IMPORTS, 'next/link', 'next/navigation'].join(', ')} (got '${source}').${SUFFIX}` });
            return;
          }
        }
        if (isRelative) {
          const resolved = path.normalize(path.join(path.dirname(filename), raw));
          if (appMatch && !resolved.includes(`${path.sep}apps${path.sep}${appMatch[2]}${path.sep}`)) {
            context.report({ node: n, message: `Relative imports may not leave the app's own directory.${SUFFIX}` });
            return;
          }
          if (templateMatch && !resolved.includes(`${path.sep}templates${path.sep}`)) {
            context.report({ node: n, message: `Relative imports may not leave the template directory.${SUFFIX}` });
            return;
          }
          if (!appMatch && !templateMatch && /(^|\/)\.\.(\/|$)/.test(raw)) {
            context.report({ node: n, message: `'..' import paths are not allowed.${SUFFIX}` });
            return;
          }
          return;
        }
        if (source.startsWith('node:')) {
          context.report({ node: n, message: `Node builtins are not allowed in app code.${SUFFIX}` });
          return;
        }
        if (source === 'next/link') return;
        if (source === 'next/navigation') {
          for (const s of n.specifiers ?? []) {
            if (s.type === 'ImportSpecifier') {
              if (!['redirect', 'notFound', 'useRouter'].includes(s.imported.name)) {
                context.report({ node: s, message: `Only { redirect, notFound, useRouter } may be imported from next/navigation.${SUFFIX}` });
              }
            } else {
              context.report({ node: s, message: `Only named imports { redirect, notFound, useRouter } may be used from next/navigation.${SUFFIX}` });
            }
          }
          return;
        }
        if (source === '@platform/registry') {
          if (n.importKind !== 'type' && !(n.specifiers ?? []).every((s) => s.importKind === 'type')) {
            context.report({ node: n, message: `@platform/registry may only be imported as types.${SUFFIX}` });
          }
          return;
        }
        // drizzle imports are policed by no-raw-db (operator allowlist; pg-core only in schema.ts)
        if (source === 'drizzle-orm' || source === 'drizzle-orm/pg-core') return;
        if (ALLOWED_IMPORTS.some((a) => source === a || source.startsWith(a + '/'))) return;
        context.report({ node: n, message: `Import '${source}' is not on the app allowlist (${ALLOWED_IMPORTS.join(', ')}, next/link, next/navigation{redirect,notFound}).${SUFFIX}` });
      };
      return moduleVisitors(context, check);
    },
  },

  'sensitive-must-be-declared': {
    create(context) {
      const filename = context.filename ?? context.getFilename();
      if (!/(^|\/)schema\.ts$/.test(filename)) return {};
      const names = sensitiveNames();
      const sensitiveWrapped = (v) =>
        v.type === 'CallExpression' &&
        v.callee.type === 'Identifier' &&
        v.callee.name === 'sensitive';
      // The first string arg of a column call is the DB column name —
      // card_last4 must be caught even when the JS key is cardLast4.
      const dbNameArg = (v) => {
        if (v.type === 'CallExpression' && v.arguments.length > 0) {
          const arg = v.arguments[0];
          if (arg.type === 'Literal' && typeof arg.value === 'string') return arg.value;
        }
        return null;
      };
      const inPlatformTable = (node) => {
        let cur = node.parent;
        while (cur) {
          if (
            cur.type === 'CallExpression' &&
            cur.callee.type === 'Identifier' &&
            cur.callee.name === 'platformTable'
          ) return true;
          cur = cur.parent;
        }
        return false;
      };
      return {
        Property(node) {
          // Forbid computed keys — the linter can't see them, so they could
          // smuggle an undeclared sensitive column past this rule.
          if (node.computed && inPlatformTable(node)) {
            context.report({ node, message: `Computed keys are not allowed inside platformTable column maps.${SUFFIX}` });
            return;
          }
          const key =
            node.key.type === 'Identifier' ? node.key.name
            : node.key.type === 'Literal' ? String(node.key.value)
            : null;
          if (!key || !inPlatformTable(node)) return;
          const dbName = dbNameArg(node.value);
          const sensitive = isSensitiveName(names, key) || (dbName && isSensitiveName(names, dbName));
          if (sensitive && !sensitiveWrapped(node.value)) {
            context.report({ node, message: `Column '${key}'${dbName ? ` ('${dbName}')` : ''} is on the global sensitive-field list and must be wrapped in sensitive().${SUFFIX}` });
          }
        },
      };
    },
  },

  // internal:/largeInputFields: opts would smuggle the raw-tx ctx into run().
  'no-internal-action-opts': {
    create(context) {
      const BANNED_KEYS = new Set(['internal', 'largeInputFields']);
      return {
        Property(node) {
          const key = node.key;
          const name = key && key.type === 'Identifier' ? key.name
            : key && key.type === 'Literal' ? String(key.value) : null;
          if (name && BANNED_KEYS.has(name)) {
            context.report({ node: key, message: `'${name}' is a platform-internal action option; app code may not request the internal ctx.${SUFFIX}` });
          }
        },
      };
    },
  },
};

module.exports = {
  rules,
  ALLOWED_IMPORTS,
};
