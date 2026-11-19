/**
 * extract-ui-manifest.js
 * 
 * Automated Static Code Extractor that generates machine-readable UI Manifests
 * ("OpenAPI for UI") for all portal pages.
 * 
 * Maps every button, modal, form input, table, filter, and backend API contract
 * directly from source HTML and JavaScript with 100% determinism.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Resolve repository root and directories
const repoRoot = path.resolve(__dirname, '../..');
const frontendCandidates = [
  path.join(repoRoot, 'frontend'),
  path.join(repoRoot, 'VidyaOS/VidyaOS-Frontend-patched/VidyaOS-main')
];
const frontendDir = frontendCandidates.find(d => fs.existsSync(d)) || frontendCandidates[0];
const pagesMdPath = path.join(repoRoot, 'docs/ui-map/pages.md');
const manifestsDir = path.join(repoRoot, 'docs/ui-map/manifests');

if (!fs.existsSync(manifestsDir)) {
  fs.mkdirSync(manifestsDir, { recursive: true });
}

console.log('======================================================');
console.log('🔍 AUTOMATED UI MANIFEST & CONTRACT EXTRACTOR (UIMS)');
console.log('======================================================');
console.log(`Frontend Directory: ${frontendDir}`);
console.log(`Manifests Output:  ${manifestsDir}\n`);

// 1. Parse pages.md for registered Page IDs, Roles, and Routes
const pageRegistry = parsePagesMd(pagesMdPath);
console.log(`✓ Loaded ${pageRegistry.length} page registrations from docs/ui-map/pages.md`);

// 2. Scan and generate manifests
const generatedManifests = [];
let totalButtons = 0;
let totalModals = 0;
let totalInputs = 0;
let totalApis = 0;

for (const reg of pageRegistry) {
  const htmlPath = resolveHtmlPath(frontendDir, reg.pageSource, reg.route);

  if (!htmlPath || !fs.existsSync(htmlPath)) {
    continue;
  }
  const relPath = path.relative(frontendDir, htmlPath);

  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  const fileHash = crypto.createHash('sha256').update(htmlContent).digest('hex').slice(0, 12);

  // Extract linked companion scripts
  const scriptSources = extractScriptSources(htmlContent, path.dirname(htmlPath));
  let jsCombinedContent = '';
  for (const jsPath of scriptSources) {
    if (fs.existsSync(jsPath)) {
      jsCombinedContent += '\n' + fs.readFileSync(jsPath, 'utf8');
    }
  }

  // Extract UI elements from HTML
  const title = extractTitle(htmlContent);
  const toolbars = extractToolbars(htmlContent);
  const buttons = extractButtons(htmlContent);
  const inputs = extractInputs(htmlContent);
  const selects = extractSelects(htmlContent);
  const modals = extractModals(htmlContent);
  const tables = extractTables(htmlContent);

  // Extract API contracts and URL parameters from companion JS
  const apis = extractApiContracts(jsCombinedContent + '\n' + htmlContent);
  const urlParams = extractUrlParameters(jsCombinedContent + '\n' + htmlContent);
  const functions = extractKeyFunctions(jsCombinedContent);

  totalButtons += buttons.length;
  totalModals += modals.length;
  totalInputs += inputs.length + selects.length;
  totalApis += apis.length;

  const manifest = {
    schema_version: '1.0.0',
    page_id: reg.pageId,
    role: reg.role,
    route: reg.route,
    source_file: `frontend/${relPath.replace(/\\/g, '/')}`,
    content_hash: fileHash,
    last_scanned: new Date().toISOString(),
    title: title || reg.purpose,
    purpose: reg.purpose,
    shell: reg.shell,
    states: reg.states,
    url_parameters: urlParams,
    api_contracts: apis,
    layout_structure: {
      toolbars: toolbars.map(t => ({ id: t.id, class: t.class })),
      tables: tables.map(tb => ({ id: tb.id, class: tb.class, headers: tb.headers })),
      modals: modals.map(m => ({ id: m.id, title: m.title, field_count: m.fields.length }))
    },
    ui_elements: {
      action_buttons: buttons,
      input_controls: inputs,
      dropdown_selectors: selects
    },
    modals_catalog: modals,
    companion_scripts: scriptSources.map(s => path.relative(frontendDir, s).replace(/\\/g, '/')),
    exported_functions: functions
  };

  const manifestFilename = `${reg.pageId.toLowerCase()}.json`;
  const manifestPath = path.join(manifestsDir, manifestFilename);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  generatedManifests.push({
    page_id: reg.pageId,
    route: reg.route,
    title: manifest.title,
    manifest_file: `docs/ui-map/manifests/${manifestFilename}`,
    content_hash: fileHash,
    counts: {
      buttons: buttons.length,
      modals: modals.length,
      inputs: inputs.length + selects.length,
      apis: apis.length
    }
  });

  console.log(`  [${reg.pageId}] ${reg.route} -> ${buttons.length} buttons, ${modals.length} modals, ${apis.length} APIs`);
}

// 3. Write Master Manifest Index
const masterIndex = {
  generator: 'UIMS (UI Manifest & Contract Extractor)',
  version: '1.0.0',
  generated_at: new Date().toISOString(),
  total_pages: generatedManifests.length,
  totals: {
    buttons: totalButtons,
    modals: totalModals,
    inputs: totalInputs,
    apis: totalApis
  },
  pages: generatedManifests
};

const masterIndexPath = path.join(manifestsDir, 'manifest-index.json');
fs.writeFileSync(masterIndexPath, JSON.stringify(masterIndex, null, 2), 'utf8');

console.log('\n======================================================');
console.log(`✅ MANIFEST EXTRACTION COMPLETE:`);
console.log(`   • ${generatedManifests.length} Page Manifests Generated`);
console.log(`   • ${totalButtons} Action Buttons Cataloged`);
console.log(`   • ${totalModals} Modals & Forms Documented`);
console.log(`   • ${totalInputs} Input & Select Controls Mapped`);
console.log(`   • ${totalApis} Backend API Contracts Traced`);
console.log(`   • Master Index saved to: docs/ui-map/manifests/manifest-index.json`);
console.log('======================================================\n');

// ─── HELPER PARSING FUNCTIONS ──────────────────────────────────────

function parsePagesMd(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const pages = [];

  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('Page ID') || line.includes('---')) continue;
    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 6) {
      const pageId = parts[0];
      const role = parts[1];
      const rawRoute = parts[2].replace(/[`]/g, '').trim();
      const rawSource = parts[3];

      // Extract frontend path from source column
      const sourceMatch = rawSource.match(/frontend\/([a-zA-Z0-9_\-\/\.]*)/);
      let pageSource = sourceMatch ? sourceMatch[1] : '';

      // If not found in column 3, derive from route
      if (!pageSource) {
        pageSource = rawRoute.replace(/^\//, '');
      }

      pages.push({
        pageId,
        role,
        route: rawRoute,
        pageSource,
        shell: parts[4] || '',
        purpose: parts[5] || '',
        states: parts[8] || 'Active'
      });
    }
  }
  return pages;
}

// Function to resolve HTML file path
function resolveHtmlPath(frontendDir, pageSource, route) {
  const cleanSource = pageSource.replace(/[`]/g, '').replace(/^frontend\//, '').trim();
  const candidates = [
    path.join(frontendDir, cleanSource),
    path.join(frontendDir, cleanSource, 'index.html'),
    path.join(frontendDir, route.replace(/[`]/g, '').replace(/^\//, '')),
    path.join(frontendDir, route.replace(/[`]/g, '').replace(/\.html$/, ''), 'index.html')
  ];

  return candidates.find(c => fs.existsSync(c) && fs.statSync(c).isFile());
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : '';
}

function extractScriptSources(html, baseDir) {
  const scripts = [];
  const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = scriptRegex.exec(html)) !== null) {
    let src = m[1].split('?')[0]; // Remove query params
    if (src.startsWith('/')) {
      scripts.push(path.join(frontendDir, src.slice(1)));
    } else {
      scripts.push(path.resolve(baseDir, src));
    }
  }
  return scripts;
}

function extractToolbars(html) {
  const toolbars = [];
  const regex = /<div\s+[^>]*?(?:class=["'][^"']*(?:studio-bar|toolbar|action-bar|command-bar|filter-toolbar)[^"']*["']|id=["'][^"']*(?:bar|toolbar)[^"']*["'])[^>]*>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const tag = m[0];
    const id = (tag.match(/id=["']([^"']+)["']/i) || [])[1] || '';
    const cls = (tag.match(/class=["']([^"']+)["']/i) || [])[1] || '';
    if (id || cls) {
      toolbars.push({ id, class: cls });
    }
  }
  return toolbars;
}

function extractButtons(html) {
  const buttons = [];
  const regex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let m;
  const seenIds = new Set();

  while ((m = regex.exec(html)) !== null) {
    const attrs = m[1];
    const innerText = m[2].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
    const id = (attrs.match(/id=["']([^"']+)["']/i) || [])[1] || '';
    const cls = (attrs.match(/class=["']([^"']+)["']/i) || [])[1] || '';
    const onclick = (attrs.match(/onclick=["']([^"']+)["']/i) || [])[1] || '';
    const title = (attrs.match(/title=["']([^"']+)["']/i) || [])[1] || '';
    const dataUi = (attrs.match(/data-ui=["']([^"']+)["']/i) || [])[1] || '';
    const dataAction = (attrs.match(/data-action=["']([^"']+)["']/i) || [])[1] || '';

    // De-duplicate if identical
    const key = id || `${onclick}_${innerText}`;
    if (key && seenIds.has(key)) continue;
    if (key) seenIds.add(key);

    buttons.push({
      id: id || null,
      label: innerText || title || 'Icon Button',
      action: onclick || dataAction || null,
      class: cls || null,
      data_ui: dataUi || null,
      title: title || null
    });
  }
  return buttons;
}

function extractInputs(html) {
  const inputs = [];
  const regex = /<input\b([^>]*)\/?>/gi;
  let m;

  while ((m = regex.exec(html)) !== null) {
    const attrs = m[1];
    const id = (attrs.match(/id=["']([^"']+)["']/i) || [])[1] || '';
    const type = (attrs.match(/type=["']([^"']+)["']/i) || [])[1] || 'text';
    const name = (attrs.match(/name=["']([^"']+)["']/i) || [])[1] || '';
    const placeholder = (attrs.match(/placeholder=["']([^"']+)["']/i) || [])[1] || '';
    const onchange = (attrs.match(/on(?:input|change)=["']([^"']+)["']/i) || [])[1] || '';
    const cls = (attrs.match(/class=["']([^"']+)["']/i) || [])[1] || '';

    if (id || name || placeholder) {
      inputs.push({
        id: id || null,
        type: type.toLowerCase(),
        name: name || null,
        placeholder: placeholder || null,
        handler: onchange || null,
        class: cls || null
      });
    }
  }
  return inputs;
}

function extractSelects(html) {
  const selects = [];
  const regex = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  let m;

  while ((m = regex.exec(html)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const id = (attrs.match(/id=["']([^"']+)["']/i) || [])[1] || '';
    const onchange = (attrs.match(/onchange=["']([^"']+)["']/i) || [])[1] || '';
    const title = (attrs.match(/title=["']([^"']+)["']/i) || [])[1] || '';
    const cls = (attrs.match(/class=["']([^"']+)["']/i) || [])[1] || '';

    // Count options
    const optionMatches = body.match(/<option\b[^>]*>([^<]*)<\/option>/gi) || [];
    const options = optionMatches.slice(0, 8).map(opt => {
      const val = (opt.match(/value=["']([^"']*)["']/i) || [])[1] || '';
      const text = opt.replace(/<[^>]+>/g, '').trim();
      return { value: val, text };
    });

    selects.push({
      id: id || null,
      title: title || null,
      onchange: onchange || null,
      class: cls || null,
      options_count: optionMatches.length,
      sample_options: options
    });
  }
  return selects;
}

function extractModals(html) {
  const modals = [];
  // Find modal containers by class or id
  const regex = /<(?:div|dialog)\s+[^>]*?(?:class=["'][^"']*(?:modal|dialog|studio-modal)[^"']*["']|id=["']modal-[^"']*["'])[^>]*>([\s\S]*?)(?:<\/div>|<\/dialog>)/gi;
  let m;

  while ((m = regex.exec(html)) !== null) {
    const outerTag = m[0];
    const body = m[1];

    const id = (outerTag.match(/id=["']([^"']+)["']/i) || [])[1] || '';
    if (!id || id.includes('backdrop') && !id.startsWith('modal-')) {
      if (!outerTag.includes('studio-modal-backdrop') && !outerTag.includes('modal-container')) continue;
    }

    // Modal title
    const titleMatch = body.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i) || body.match(/class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Modal Dialog';

    // Inputs inside modal
    const inputMatches = body.match(/<input\b[^>]*id=["']([^"']+)["'][^>]*>/gi) || [];
    const fields = inputMatches.map(inp => (inp.match(/id=["']([^"']+)["']/i) || [])[1]).filter(Boolean);

    // Primary submit button
    const submitMatch = body.match(/<button\b[^>]*onclick=["']([^"']+)["'][^>]*>[\s\S]*?(?:Save|Submit|Create|Confirm|Export|Apply|Download)[\s\S]*?<\/button>/i);
    const submitAction = submitMatch ? (submitMatch[0].match(/onclick=["']([^"']+)["']/i) || [])[1] : null;

    modals.push({
      id: id || 'modal-unnamed',
      title: title,
      fields: fields,
      submit_action: submitAction
    });
  }
  return modals;
}

function extractTables(html) {
  const tables = [];
  const regex = /<table\b([^>]*)>([\s\S]*?)<\/table>/gi;
  let m;

  while ((m = regex.exec(html)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const id = (attrs.match(/id=["']([^"']+)["']/i) || [])[1] || '';
    const cls = (attrs.match(/class=["']([^"']+)["']/i) || [])[1] || '';

    // Extract headers
    const thMatches = body.match(/<th\b[^>]*>([\s\S]*?)<\/th>/gi) || [];
    const headers = thMatches.slice(0, 15).map(th => th.replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ')).filter(Boolean);

    tables.push({
      id: id || 'unnamed-table',
      class: cls || null,
      headers: headers
    });
  }
  return tables;
}

function extractApiContracts(code) {
  const apis = [];
  const seen = new Set();

  // Pattern matching apiFetch('...'), apiFetch(`...`), fetch('...'), etc.
  const apiRegex = /(?:apiFetch|fetch|axios\.(?:get|post|put|delete|patch))\s*\(\s*([`'"])([^`'"\?]+)(?:\?[^`'"]*)?\1/gi;
  let m;

  while ((m = apiRegex.exec(code)) !== null) {
    let endpoint = m[2].trim();
    if (!endpoint.startsWith('/') && !endpoint.startsWith('http') && !endpoint.includes('api')) continue;

    // Check if subsequent snippet has method: 'POST' etc.
    const sliceAfter = code.slice(m.index, m.index + 250);
    const methodMatch = sliceAfter.match(/method\s*:\s*['"](GET|POST|PUT|DELETE|PATCH)['"]/i);
    let method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';

    // Normalize endpoint (replace ${...} or numbers with :param)
    endpoint = endpoint.replace(/\$\{[^}]+\}/g, ':id').replace(/\/(\d+)(\/|$)/g, '/:id$2');

    const key = `${method} ${endpoint}`;
    if (seen.has(key)) continue;
    seen.add(key);

    apis.push({
      method: method,
      endpoint: endpoint,
      type: endpoint.startsWith('/api') || endpoint.startsWith('/teaching-groups') || endpoint.startsWith('/faculty') ? 'REST' : 'INTERNAL'
    });
  }

  return apis;
}

function extractUrlParameters(code) {
  const params = new Set();
  const regex = /(?:params|urlParams|searchParams)\.get\(\s*['"]([^'"]+)['"]\s*\)/gi;
  let m;

  while ((m = regex.exec(code)) !== null) {
    params.add(m[1].trim());
  }

  return Array.from(params);
}

function extractKeyFunctions(jsCode) {
  const functions = [];
  const regex = /(?:async\s+)?function\s+([a-zA-Z0-9_]+)\s*\(/g;
  let m;

  while ((m = regex.exec(jsCode)) !== null) {
    const fnName = m[1];
    if (fnName.startsWith('open') || fnName.startsWith('close') || fnName.startsWith('toggle') || fnName.startsWith('load') || fnName.startsWith('render') || fnName.startsWith('switch') || fnName.startsWith('export')) {
      functions.push(fnName);
    }
  }

  return Array.from(new Set(functions)).slice(0, 25);
}
