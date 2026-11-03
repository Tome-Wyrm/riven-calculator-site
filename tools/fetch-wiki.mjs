// Keeps wiki pages in the local cache (tools/lib/cache.mjs: tools/data/cache/, not in git) for
// research and for the builders that read them. Prints where each landed.
//   node tools/fetch-wiki.mjs [--offline] "Module:Ability/data" "Toxic Lash" …

import { cachedText } from './lib/cache.mjs';

for (const page of process.argv.slice(2).filter(a => !a.startsWith('--'))) {
  // "Damage/Calculation" and "Damage Calculation" are different pages: keep the slash apart.
  const slug = page.split('/').map(p => p.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')).join('--').toLowerCase();
  const ext = page.startsWith('Module:') ? 'lua' : 'wiki';
  const url = `https://wiki.warframe.com/w/${encodeURIComponent(page.replace(/ /g, '_')).replace(/%3A/g, ':').replace(/%2F/g, '/')}?action=raw`;
  try {
    const { data } = await cachedText(`wiki-${slug}`, ext, url, { validate: text => (text.length > 50 ? null : 'empty page') });
    console.log(`${page}: ${data.length} chars → tools/data/cache/wiki-${slug}.${ext}`);
  } catch (e) { console.log(`${page}: not found (${e instanceof Error ? e.message.split('\n')[0] : e})`); }
}
