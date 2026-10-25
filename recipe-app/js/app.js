import { db, newId } from './db.js';
import { LAYOUT, FIELDS, loadFonts, cardPdf, sheetsPdf, duplexTestPdf, pageCount, planSheets, fitRecipe, newDoc, metaItems } from './layout.js';
import { parseRecipe } from './parser.js';
import { importPdf, renderPdf } from './pdfimport.js';

const app = document.getElementById('app');
const state = {
  recipes: [],
  query: '',
  tags: new Set(),
  onlyUnprinted: false,
  selected: null, // Auswahl in der Druckansicht
  settings: { swapSlots: false, rotateBack: false, cutMarks: true },
};

// ---------------------------------------------------------------------------
// Hilfsfunktionen

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function fileName(str) {
  return (str || 'Rezept').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Rezept';
}

// Teilen-Menü (iOS: Drucken, In Dateien sichern, AirDrop …) – sonst Download.
async function shareFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

function allTags() {
  const counts = new Map();
  for (const r of state.recipes) for (const t of r.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'de'));
}

const fold = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function matches(r) {
  if (state.onlyUnprinted && r.printedAt) return false;
  for (const t of state.tags) if (!(r.tags || []).includes(t)) return false;
  if (!state.query.trim()) return true;
  const hay = fold([...FIELDS.filter((k) => k !== 'tags').map((k) => r[k]), ...(r.tags || [])].join('\n'));
  return fold(state.query).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function blankRecipe() {
  return { ...Object.fromEntries(FIELDS.map((k) => [k, ''])), tags: [] };
}

const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', 'de');

async function save(r) {
  r.updatedAt = Date.now();
  const pc = pageCount(r);
  r.pages = pc.pages;
  r.scale = pc.scale;
  r.overflow = pc.overflow;
  await db.put(r);
  const i = state.recipes.findIndex((x) => x.id === r.id);
  if (i >= 0) state.recipes[i] = r;
  else state.recipes.push(r);
}

function header(title, { back, actions = [] } = {}) {
  return h(
    'header',
    { class: 'bar' },
    back ? h('button', { class: 'ghost back', onclick: () => (location.hash = back) }, '‹ Kartei') : null,
    h('h1', {}, title),
    ...actions,
  );
}

function pagesBadge(r) {
  if (r.overflow) return h('span', { class: 'badge warn' }, 'zu lang');
  return r.pages > 1 ? h('span', { class: 'badge' }, `${r.pages} Seiten`) : null;
}

// ---------------------------------------------------------------------------
// Kartei (Liste)

function renderList() {
  const listEl = h('ul', { class: 'list' });
  const chipsEl = h('div', { class: 'chips' });

  const fill = () => {
    chipsEl.replaceChildren(
      h('button', { class: `chip ${state.onlyUnprinted ? 'on' : ''}`, onclick: () => { state.onlyUnprinted = !state.onlyUnprinted; fill(); } }, 'Ungedruckt'),
      ...allTags().map(([t, n]) =>
        h('button', {
          class: `chip ${state.tags.has(t) ? 'on' : ''}`,
          onclick: () => { state.tags.has(t) ? state.tags.delete(t) : state.tags.add(t); fill(); },
        }, t, h('span', { class: 'count' }, n)),
      ),
    );
    const items = state.recipes.filter(matches).sort(byTitle);
    listEl.replaceChildren(
      ...items.map((r) =>
        h('li', { onclick: () => (location.hash = `#/edit/${r.id}`) },
          h('div', { class: 'main' },
            h('div', { class: 't' }, r.title || 'Ohne Titel'),
            h('div', { class: 'sub' }, [r.description || metaItems(r)[0], (r.tags || []).join(', ')].filter(Boolean).join(' — ') || '\u00a0'),
          ),
          r.needsReview ? h('span', { class: 'badge warn' }, 'prüfen') : null,
          pagesBadge(r),
          !r.printedAt ? h('span', { class: 'badge new', title: 'noch nicht gedruckt' }, 'neu') : null,
        ),
      ),
    );
    if (!items.length) {
      listEl.append(
        h('div', { class: 'empty' },
          state.recipes.length
            ? 'Nichts gefunden.'
            : h('div', {}, h('p', {}, 'Noch keine Rezepte.'), h('p', {}, 'Tippe auf + für ein neues Rezept oder importiere vorhandene PDFs in den Einstellungen.')),
        ),
      );
    }
  };

  const search = h('input', {
    type: 'search', placeholder: 'Suchen (Titel, Zutaten, Stichwörter …)', value: state.query,
    oninput: (e) => { state.query = e.target.value; fill(); },
  });

  app.replaceChildren(
    header('Rezeptkartei', {
      actions: [
        h('button', { class: 'secondary', onclick: () => (location.hash = '#/print') }, 'Drucken'),
        h('button', { class: 'ghost', 'aria-label': 'Einstellungen', onclick: () => (location.hash = '#/settings') }, '⚙︎'),
      ],
    }),
    h('div', { style: 'margin-bottom:10px' }, search),
    chipsEl,
    listEl,
    h('button', { class: 'fab', 'aria-label': 'Neues Rezept', onclick: () => (location.hash = '#/edit/new') }, '+'),
  );
  fill();
}

// ---------------------------------------------------------------------------
// Rezept bearbeiten

async function renderEditor(id) {
  let r = id === 'new' ? null : state.recipes.find((x) => x.id === id) || (await db.get(id));
  const isNew = !r;
  r = r ? { ...r } : { ...blankRecipe(), id: newId(), createdAt: Date.now() };
  let saved = !isNew;
  let lastPdf = null;

  const status = h('div', { class: 'status' });
  const pagesEl = h('div', { class: 'pages' });
  const preview = h('div', { class: 'preview' }, pagesEl, status);

  const refreshPreview = debounce(async () => {
    const { doc, laid } = cardPdf(r);
    lastPdf = doc.output('blob');
    const buf = doc.output('arraybuffer');
    const pct = Math.round(laid.scale * 100);
    const parts = [laid.pages.length === 1 ? 'Passt auf eine Seite' : `Vorder- und Rückseite (${laid.pages.length} Seiten)`];
    if (pct < 100) parts.push(`Schrift ${pct} %`);
    if (laid.overflow) parts.push('Zu lang für eine Karte – bitte kürzen');
    status.textContent = parts.join(' · ');
    status.classList.toggle('warn', !!laid.overflow);
    await renderPdf(pagesEl, buf, { maxWidth: Math.min(preview.clientWidth || 400, 520) || 360 });
  }, 350);

  const persist = debounce(async () => {
    if (!saved && !(r.title || r.ingredients || r.steps)) return;
    await save(r);
    if (!saved) history.replaceState(null, '', `#/edit/${r.id}`);
    saved = true;
  }, 500);

  const changed = () => {
    r.printedAt = null; // Inhalt geändert → neu drucken
    r.needsReview = false;
    persist();
    refreshPreview();
  };

  const field = (key, label, el) => {
    el.value = r[key] || '';
    el.addEventListener('input', () => { r[key] = el.value; changed(); });
    return h('label', { class: 'field' }, h('span', {}, label), el);
  };

  const inputs = {
    title: h('input', { type: 'text', class: 'title-input', placeholder: 'Titel', autocapitalize: 'sentences' }),
    description: h('input', { type: 'text', placeholder: 'Kurze Beschreibung (optional)' }),
    totalTime: h('input', { type: 'text', placeholder: 'ca. 30 Minuten' }),
    workTime: h('input', { type: 'text', placeholder: 'ca. 15 Minuten' }),
    cookTime: h('input', { type: 'text', placeholder: 'ca. 15 Minuten' }),
    servings: h('input', { type: 'text', inputmode: 'numeric', placeholder: '4' }),
    difficulty: h('input', { type: 'text', list: 'difficulties', placeholder: 'simpel' }),
    ingredients: h('textarea', { rows: 8, placeholder: '200 g Mehl\n2 Eier\n1 Prise Salz\nFür die Soße:\n400 ml Sahne' }),
    steps: h('textarea', { rows: 10, placeholder: 'Ein Absatz pro Zeile.' }),
    notes: h('textarea', { rows: 3, placeholder: 'Optional' }),
  };

  // Stichwörter
  const tagChips = h('div', { class: 'chips wrap' });
  const tagInput = h('input', { type: 'text', placeholder: 'Neues Stichwort + Enter', enterkeyhint: 'done', autocapitalize: 'words' });
  const drawTags = () => {
    const known = new Set([...allTags().map(([t]) => t), ...r.tags]);
    tagChips.replaceChildren(
      ...[...known].sort((a, b) => a.localeCompare(b, 'de')).map((t) =>
        h('button', {
          type: 'button', class: `chip ${r.tags.includes(t) ? 'on' : ''}`,
          onclick: () => { r.tags = r.tags.includes(t) ? r.tags.filter((x) => x !== t) : [...r.tags, t]; drawTags(); changed(); },
        }, t),
      ),
    );
  };
  const addTag = () => {
    const vals = tagInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    if (!vals.length) return;
    r.tags = [...new Set([...r.tags, ...vals])];
    tagInput.value = '';
    drawTags();
    changed();
  };
  tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } });
  tagInput.addEventListener('blur', addTag);
  drawTags();

  const fillFrom = (parsed) => {
    for (const k of Object.keys(inputs)) {
      r[k] = parsed[k] || '';
      inputs[k].value = r[k];
    }
    changed();
  };

  const pasteBtn = h('button', {
    type: 'button', class: 'secondary',
    onclick: async () => {
      const text = await askPaste();
      if (!text) return;
      if ((r.ingredients || r.steps) && !confirm('Vorhandenen Text ersetzen?')) return;
      fillFrom(parseRecipe(text));
      toast('Erkannt – bitte kurz prüfen');
    },
  }, 'Text einfügen & erkennen');

  let original = null;
  if (r.originalFileId) {
    original = h('button', {
      type: 'button', class: 'ghost',
      onclick: async () => {
        const f = await db.getFile(r.originalFileId);
        if (f) shareFile(f.blob, f.name);
      },
    }, 'Original-PDF');
  }

  const form = h('div', { class: 'form' },
    h('div', { class: 'row', style: 'margin-bottom:14px' }, pasteBtn, h('span', { class: 'spacer' }), original),
    field('title', 'Titel', inputs.title),
    field('description', 'Beschreibung', inputs.description),
    h('div', { class: 'meta-grid' },
      field('totalTime', 'Gesamtzeit', inputs.totalTime),
      field('workTime', 'Arbeitszeit', inputs.workTime),
      field('cookTime', 'Koch-/Backzeit', inputs.cookTime),
      field('servings', 'Portionen', inputs.servings),
      field('difficulty', 'Schwierigkeit', inputs.difficulty),
      h('datalist', { id: 'difficulties' }, ...['simpel', 'normal', 'pfiffig'].map((v) => h('option', { value: v }))),
    ),
    field('ingredients', 'Zutaten', inputs.ingredients),
    field('steps', 'Anleitung', inputs.steps),
    field('notes', 'Tipps', inputs.notes),
    h('label', { class: 'field' }, h('span', {}, 'Stichwörter'), tagChips, tagInput),
    !isNew
      ? h('button', {
          type: 'button', class: 'danger',
          onclick: async () => {
            if (!confirm(`„${r.title || 'Ohne Titel'}“ wirklich löschen?`)) return;
            await db.delete(r.id);
            if (r.originalFileId) await db.deleteFile(r.originalFileId);
            state.recipes = state.recipes.filter((x) => x.id !== r.id);
            location.hash = '#/';
          },
        }, 'Rezept löschen')
      : null,
  );

  const editor = h('div', { class: 'editor' }, form, preview);
  const segBtns = [
    h('button', { type: 'button', class: 'on', onclick: () => seg(0) }, 'Text'),
    h('button', { type: 'button', onclick: () => seg(1) }, 'Vorschau'),
  ];
  const seg = (i) => {
    segBtns.forEach((b, j) => b.classList.toggle('on', i === j));
    editor.classList.toggle('show-preview', i === 1);
    if (i === 1) refreshPreview();
  };

  app.replaceChildren(
    header(isNew ? 'Neues Rezept' : 'Rezept', {
      back: '#/',
      actions: [
        h('button', {
          class: 'secondary',
          onclick: () => {
            if (!lastPdf) lastPdf = cardPdf(r).doc.output('blob');
            shareFile(lastPdf, `${fileName(r.title)}.pdf`);
          },
        }, 'PDF'),
      ],
    }),
    h('div', { class: 'seg' }, segBtns),
    editor,
  );
  for (const k of Object.keys(inputs)) inputs[k].value = r[k] || '';
  refreshPreview();
  if (isNew) inputs.title.focus();
}

function askPaste() {
  const dlg = document.getElementById('paste-dialog');
  const ta = document.getElementById('paste-text');
  ta.value = '';
  document.getElementById('paste-clipboard').onclick = async () => {
    try {
      ta.value = await navigator.clipboard.readText();
    } catch {
      toast('Zwischenablage nicht lesbar – bitte manuell einfügen');
    }
  };
  dlg.showModal();
  setTimeout(() => ta.focus(), 50);
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? ta.value.trim() : '');
  });
}

// ---------------------------------------------------------------------------
// Drucken (2 Karten auf A4)

function renderPrint() {
  if (!state.selected) state.selected = new Set(state.recipes.filter((r) => !r.printedAt).map((r) => r.id));
  const sel = state.selected;
  let onlyUnprinted = false;
  let pdfBlob = null;

  const listEl = h('ul', { class: 'list' });
  const summary = h('p', { class: 'hint' });
  const pagesEl = h('div', { class: 'pages' });
  const result = h('div', {});

  const chosen = () => state.recipes.filter((r) => sel.has(r.id)).sort(byTitle);

  const updateSummary = () => {
    const rs = chosen();
    if (!rs.length) {
      summary.textContent = 'Wähle die Rezepte aus, die gedruckt werden sollen.';
      return;
    }
    const doc = newDoc({ orientation: 'landscape', format: 'a4' });
    const sheets = planSheets(rs.map((r) => fitRecipe(doc, r)));
    const duplex = sheets.some((s) => s.some((c) => c && c.back !== null));
    summary.textContent = `${rs.length} Rezept${rs.length > 1 ? 'e' : ''} → ${sheets.length} Blatt A4${duplex ? ', doppelseitig' : ''}`;
  };

  const fill = () => {
    const items = state.recipes.filter((r) => !onlyUnprinted || !r.printedAt).sort(byTitle);
    listEl.replaceChildren(
      ...items.map((r) => {
        const cb = h('input', { type: 'checkbox', checked: sel.has(r.id) });
        const toggle = () => {
          sel.has(r.id) ? sel.delete(r.id) : sel.add(r.id);
          cb.checked = sel.has(r.id);
          pdfBlob = null;
          result.replaceChildren();
          updateSummary();
        };
        cb.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
        return h('li', { onclick: toggle },
          cb,
          h('div', { class: 'main' }, h('div', { class: 't' }, r.title || 'Ohne Titel'), h('div', { class: 'sub' }, r.printedAt ? `gedruckt am ${new Date(r.printedAt).toLocaleDateString('de-DE')}` : 'noch nicht gedruckt')),
          pagesBadge(r),
        );
      }),
    );
    updateSummary();
  };

  const build = async () => {
    const rs = chosen();
    if (!rs.length) return toast('Keine Rezepte ausgewählt');
    const { doc, duplex } = sheetsPdf(rs, state.settings);
    pdfBlob = doc.output('blob');
    result.replaceChildren(
      h('section', { class: 'box' },
        h('div', { class: 'row' },
          h('button', { onclick: () => shareFile(pdfBlob, `Rezeptkarten ${new Date().toLocaleDateString('de-DE')}.pdf`) }, 'Teilen / Drucken'),
          h('button', {
            class: 'secondary',
            onclick: async () => {
              const now = Date.now();
              for (const r of rs) await db.put(Object.assign(r, { printedAt: now }));
              toast('Als gedruckt markiert');
              state.selected = new Set();
              renderPrint();
            },
          }, 'Als gedruckt markieren'),
        ),
        h('p', { class: 'hint' }, duplex
          ? 'Im Druckdialog „Doppelseitig“ einschalten. Stimmen die Rückseiten nicht? Einstellungen → Testbogen.'
          : 'Einseitig drucken. Danach in der Mitte durchschneiden.'),
        pagesEl,
      ),
    );
    await renderPdf(pagesEl, doc.output('arraybuffer'), { maxWidth: Math.min(app.clientWidth - 40, 700) });
    result.scrollIntoView({ behavior: 'smooth' });
  };

  app.replaceChildren(
    header('Drucken', { back: '#/' }),
    h('p', { class: 'hint' }, 'Je zwei A5-Karten kommen übereinander auf ein A4-Blatt. Lange Rezepte bekommen automatisch eine Rückseite.'),
    h('div', { class: 'chips' },
      h('button', { class: 'chip', onclick: () => { state.recipes.forEach((r) => sel.add(r.id)); fill(); } }, 'Alle'),
      h('button', { class: 'chip', onclick: () => { sel.clear(); fill(); } }, 'Keine'),
      h('button', { class: 'chip', onclick: (e) => { onlyUnprinted = !onlyUnprinted; e.target.classList.toggle('on', onlyUnprinted); fill(); } }, 'Nur ungedruckte'),
    ),
    listEl,
    h('div', { class: 'row', style: 'margin:16px 0' }, summary, h('span', { class: 'spacer' }), h('button', { onclick: build }, 'Druckbogen erstellen')),
    result,
  );
  fill();
}

// ---------------------------------------------------------------------------
// Einstellungen, Import, Backup

async function importFiles(files) {
  const created = [];
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const found = await importPdf(buf.slice(0));
      let fileId = null;
      if (!found[0]?._embedded) {
        fileId = newId();
        await db.putFile({ id: fileId, name: file.name, blob: new Blob([buf], { type: 'application/pdf' }) });
      }
      for (const f of found) {
        const existing = f._embedded && state.recipes.find((x) => x.title === f.title && x.ingredients === f.ingredients);
        if (existing) continue;
        const r = {
          ...blankRecipe(),
          ...Object.fromEntries(FIELDS.filter((k) => f[k]).map((k) => [k, f[k]])),
          id: newId(), title: f.title || file.name.replace(/\.pdf$/i, ''),
          createdAt: Date.now(), originalFileId: fileId, needsReview: !f._embedded,
        };
        await save(r);
        created.push(r);
      }
    } catch (e) {
      console.error(e);
      toast(`Fehler bei ${file.name}`);
    }
  }
  return created;
}

function exportBackup() {
  const data = { app: 'rezeptkartei', version: 1, exportedAt: new Date().toISOString(), recipes: state.recipes };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  shareFile(blob, `Rezeptkartei-Backup ${new Date().toISOString().slice(0, 10)}.json`);
}

async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'rezeptkartei' || !Array.isArray(data.recipes)) throw new Error('Keine Rezeptkartei-Datei');
  let added = 0;
  let updated = 0;
  for (const r of data.recipes) {
    const mine = state.recipes.find((x) => x.id === r.id);
    if (mine && (mine.updatedAt || 0) >= (r.updatedAt || 0)) continue;
    const merged = { ...r, originalFileId: mine?.originalFileId ?? null };
    await db.put(merged);
    if (mine) {
      Object.assign(mine, merged);
      updated++;
    } else {
      state.recipes.push(merged);
      added++;
    }
  }
  return { added, updated };
}

function renderSettings() {
  const s = state.settings;
  const toggle = (key, label, sub) =>
    h('label', { class: 'toggle' },
      h('span', {}, label, sub ? h('small', {}, sub) : null),
      h('input', { type: 'checkbox', checked: s[key], onchange: (e) => { s[key] = e.target.checked; db.setSetting('print', s); } }),
    );

  const pdfInput = h('input', {
    type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true,
    onchange: async (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      toast(`Importiere ${files.length} Datei${files.length > 1 ? 'en' : ''} …`);
      const created = await importFiles(files);
      e.target.value = '';
      if (created.length === 1) location.hash = `#/edit/${created[0].id}`;
      else {
        toast(`${created.length} Rezepte importiert – bitte prüfen`);
        location.hash = '#/';
      }
    },
  });
  const backupInput = h('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const { added, updated } = await importBackup(f);
        toast(`${added} neu, ${updated} aktualisiert`);
      } catch (err) {
        toast(err.message);
      }
    },
  });

  app.replaceChildren(
    header('Einstellungen', { back: '#/' }),
    h('section', { class: 'box' },
      h('h2', {}, 'Importieren'),
      h('p', { class: 'hint' }, 'Vorhandene Rezept-PDFs auswählen (auch mehrere). Der Text wird übernommen und neu gesetzt, das Original bleibt am Rezept gespeichert.'),
      h('div', { class: 'row' },
        h('button', { onclick: () => pdfInput.click() }, 'PDFs importieren'),
        h('button', { class: 'secondary', onclick: () => backupInput.click() }, 'Backup einlesen'),
      ),
      pdfInput, backupInput,
    ),
    h('section', { class: 'box' },
      h('h2', {}, 'Doppelseitiger Druck'),
      toggle('swapSlots', 'Rückseiten oben/unten tauschen', 'Aus = Wenden an der langen Kante (Standard beim iPhone)'),
      toggle('rotateBack', 'Rückseiten um 180° drehen', 'Einschalten, falls die Rückseiten auf dem Kopf stehen'),
      toggle('cutMarks', 'Schnittmarken', 'Kleine Striche oben und unten in der Mitte'),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'secondary', onclick: () => shareFile(duplexTestPdf(s).output('blob'), 'Duplex-Test.pdf') }, 'Testbogen drucken'),
      ),
      h('p', { class: 'hint' }, 'Testbogen doppelseitig drucken: Hinter „Karte A“ muss „Karte A Rückseite“ stehen, beide mit „OBEN“ oben. Sonst die Schalter oben anpassen.'),
    ),
    h('section', { class: 'box' },
      h('h2', {}, 'Sichern & Teilen'),
      h('p', { class: 'hint' }, 'Die Rezepte liegen nur auf diesem Gerät. Mit einem Backup kannst du sie sichern oder z. B. per AirDrop auf ein anderes iPhone übertragen – beim Einlesen werden Rezepte zusammengeführt (neuere Version gewinnt).'),
      h('button', { onclick: exportBackup }, `Backup erstellen (${state.recipes.length} Rezepte)`),
    ),
    h('section', { class: 'box' },
      h('h2', {}, 'Layout'),
      h('p', { class: 'hint', style: 'margin:0' }, `${LAYOUT.name} · DIN A5 quer (${LAYOUT.page.width} × ${String(LAYOUT.page.height).replace('.', ',')} mm), zwei Karten übereinander auf A4`),
    ),
  );
}

// ---------------------------------------------------------------------------

function route() {
  const [, view, id] = location.hash.replace(/^#/, '').split('/');
  window.scrollTo(0, 0);
  if (view !== 'print') state.selected = null;
  if (view === 'edit') return renderEditor(id || 'new');
  if (view === 'print') return renderPrint();
  if (view === 'settings') return renderSettings();
  return renderList();
}

async function init() {
  await loadFonts();
  state.recipes = await db.all();
  Object.assign(state.settings, (await db.getSetting('print')) || {});
  // Seitenzahl für ältere Einträge nachtragen
  for (const r of state.recipes) {
    if (r.info && !r.description) r.description = r.info; // ältere Einträge
    if (!r.pages) Object.assign(r, pageCount(r));
  }
  window.addEventListener('hashchange', route);
  route();
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
}

init();
