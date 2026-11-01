import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '@scalar/openapi-parser';
import { buildOpenApi } from '../../api/src/openapi.ts';

/**
 * Builds the API reference into `dist/`: the OpenAPI document drawn from the server's own routes,
 * Scalar's browser files, and the small page that starts it. Nothing is fetched from anywhere at
 * run time, so the site works on a machine with no network and under a policy that allows nothing
 * from outside it.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const apiPackage = JSON.parse(readFileSync(join(root, '..', 'api', 'package.json'), 'utf8')) as {
  version: string;
};

const spec = buildOpenApi({ version: apiPackage.version });

// The same parser Scalar reads the document with: if it finds anything wrong, so would a reader.
const checked = await validate(spec);
if (!checked.valid) {
  const errors = (checked.errors ?? []).map((e) => `  ${e.message}`).join('\n');
  throw new Error(`The OpenAPI document is not valid:\n${errors}`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'public'), dist, { recursive: true });
cpSync(join(root, '..', 'web', 'public', 'favicon.svg'), join(dist, 'favicon.svg'));
writeFileSync(join(dist, 'openapi.json'), `${JSON.stringify(spec, null, 2)}\n`);

// Scalar's browser build is the package's `dist/browser`: the page's script and the pieces it loads
// when they are needed. The source maps are for debugging Scalar, not this site.
const entry = fileURLToPath(import.meta.resolve('@scalar/api-reference'));
const browser = join(dirname(entry), 'browser');
if (!existsSync(join(browser, 'standalone.js')))
  throw new Error(`Scalar's browser build is not at ${browser}`);
cpSync(browser, join(dist, 'scalar'), {
  recursive: true,
  filter: (from) => !from.endsWith('.map'),
});

const operations = Object.values(spec.paths as Record<string, object>).reduce(
  (n, methods) => n + Object.keys(methods).length,
  0,
);
console.log(
  `reference: ${operations} operations, version ${apiPackage.version}, written to ${dist}`,
);
