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

/** Absolute import allowlist for app code. Referenced by AGENTS.md. */
const ALLOWED_IMPORTS = [
  '@platform/ui',
  '@platform/actions/define',
  '@platform/approvals',
  '@platform/workflow',
  '@platform/data/read',
  '@platform/data/schema-helpers',
  'zod',
  'react',
];

const ALLOWED_DRIZZLE_OPS = new Set([
  'eq', 'and', 'or', 'gt', 'lt', 'inArray', 'isNull', 'desc', 'asc',
]);

const BANNED_HTTP_IMPORTS = new Set([
  'http', 'https', 'node:http', 'node:https', 'axios', 'node-fetch', 'undici',
  'child_process', 'node:child_process', 'fs', 'node:fs', 'net', 'node:net',
]);

function importCheck(context, node, test) {
  const source = node.source.value;
  if (typeof source !== 'string') return;
  test(source, node);
}

const rules = {
  'no-raw-db': {
    create(context) {
      const filename = context.filename ?? context.getFilename();
      return {
        ImportDeclaration(node) {
          importCheck(context, node, (source, n) => {
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
              for (const s of n.specifiers) {
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
          });
        },
      };
    },
  },

  'no-raw-sql': {
    create(context) {
      return {
        ImportDeclaration(node) {
          importCheck(context, node, (_s, n) => {
            for (const s of n.specifiers) {
              if (s.type === 'ImportSpecifier' && s.imported.name === 'sql') {
                context.report({ node: s, message: `Raw SQL fragments are not allowed in app code.${SUFFIX}` });
              }
            }
          });
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
      return {
        ImportDeclaration(node) {
          importCheck(context, node, (source, n) => {
            if (BANNED_HTTP_IMPORTS.has(source)) {
              context.report({ node: n, message: `'${source}' is not allowed in app code; external calls go through platform integrations.${SUFFIX}` });
            }
          });
        },
        CallExpression(node) {
          if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
            context.report({ node, message: `fetch() is not allowed in app code; external calls go through platform integrations.${SUFFIX}` });
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
      return {
        Program(node) {
          if (/(^|\/)route\.tsx?$/.test(filename) || /(^|\/)api\//.test(filename) || /(^|\/)middleware\.tsx?$/.test(filename)) {
            context.report({ node, message: `App code may not define route handlers, api dirs, or middleware.${SUFFIX}` });
          }
          const src = context.sourceCode ? context.sourceCode.getText() : context.getSourceCode().getText();
          if (/^['"]use server['"]/.test(src.trimStart())) {
            context.report({ node, message: `'use server' directives are not allowed in app code; the only server entry is runAction.${SUFFIX}` });
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
      return {
        ImportDeclaration(node) {
          importCheck(context, node, (source, n) => {
            if (source.startsWith('.')) {
              const resolved = path.normalize(path.join(path.dirname(filename), source));
              if (appMatch && !resolved.includes(`${path.sep}apps${path.sep}${appMatch[2]}${path.sep}`)) {
                context.report({ node: n, message: `Relative imports may not leave the app's own directory.${SUFFIX}` });
              }
              if (templateMatch && !resolved.includes(`${path.sep}templates${path.sep}`)) {
                context.report({ node: n, message: `Relative imports may not leave the template directory.${SUFFIX}` });
              }
              return;
            }
            if (source.startsWith('node:')) {
              context.report({ node: n, message: `Node builtins are not allowed in app code.${SUFFIX}` });
              return;
            }
            if (source === 'next/link') return;
            if (source === 'next/navigation') {
              for (const s of n.specifiers) {
                if (s.type === 'ImportSpecifier') {
                  if (!['redirect', 'notFound'].includes(s.imported.name)) {
                    context.report({ node: s, message: `Only { redirect, notFound } may be imported from next/navigation.${SUFFIX}` });
                  }
                } else {
                  context.report({ node: s, message: `Only named imports { redirect, notFound } may be used from next/navigation.${SUFFIX}` });
                }
              }
              return;
            }
            if (source === '@platform/registry') {
              if (n.importKind !== 'type' && !n.specifiers.every((s) => s.importKind === 'type')) {
                context.report({ node: n, message: `@platform/registry may only be imported as types.${SUFFIX}` });
              }
              return;
            }
            if (ALLOWED_IMPORTS.some((a) => source === a || source.startsWith(a + '/'))) return;
            context.report({ node: n, message: `Import '${source}' is not on the app allowlist (${ALLOWED_IMPORTS.join(', ')}, next/link, next/navigation{redirect,notFound}).${SUFFIX}` });
          });
        },
      };
    },
  },

  'sensitive-must-be-declared': {
    create(context) {
      const filename = context.filename ?? context.getFilename();
      if (!/(^|\/)schema\.ts$/.test(filename)) return {};
      const names = sensitiveNames();
      return {
        Property(node) {
          const key =
            node.key.type === 'Identifier' ? node.key.name
            : node.key.type === 'Literal' ? String(node.key.value)
            : null;
          if (!key || !names.has(key)) return;
          const v = node.value;
          const wrapped =
            v.type === 'CallExpression' &&
            v.callee.type === 'Identifier' &&
            v.callee.name === 'sensitive';
          if (!wrapped) {
            context.report({ node, message: `Column '${key}' is on the global sensitive-field list and must be wrapped in sensitive().${SUFFIX}` });
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
