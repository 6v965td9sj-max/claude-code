// Erkennt in eingefügtem Freitext (Webseite wie Chefkoch, PDF, Notiz) Titel,
// Beschreibung, Zeiten, Portionen, Schwierigkeit, Zutaten, Anleitung und Tipps.

const H_ING = /^(zutaten|ingredients?|einkaufsliste|(was )?du brauchst|das brauchst du|man braucht)\b/i;
const H_STEP = /^(zubereitung|anleitung|so geht'?s|so wird'?s gemacht|arbeitsschritte|schritte|instructions?|directions?|method|preparation|steps)\b/i;
const H_NOTE = /^(tipps?|tip|notiz(en)?|hinweis(e)?|anmerkung(en)?|notes?|variante(n)?)\b/i;
const META_LABEL = 'Gesamtzeit|Arbeitszeit|Zubereitungszeit|Vorbereitungszeit|Koch-?\\s*\\/\\s*Backzeit|Kochzeit|Backzeit|Garzeit|Schwierigkeitsgrad|Schwierigkeit|Portionen|Personen';
const META = new RegExp(`^(${META_LABEL})\\s*:?\\s*(.*)$`, 'i');
const DIFFICULTY = /^(simpel|normal|pfiffig|einfach|mittel|schwer|leicht|anspruchsvoll)$/i;
const QTY = /^(ca\.?\s*)?[\d½¼¾⅓⅔⅛]/;
const AMOUNT_ONLY = /^(ca\.?\s*)?[\d½¼¾⅓⅔⅛][\d½¼¾⅓⅔⅛.,/\-–\s]*(kg|g|mg|ml|cl|dl|l|Liter|Gramm|EL|TL|Msp\.?|Prisen?|Pck\.?|Päckchen|Packung|Stk\.?|Stück|Bund|Dosen?|Becher|Tassen?|Glas|Scheiben?|Zehen?|Handvoll|Spritzer|Schuss|Zweige?|Würfel|Tropfen)?\.?$/i;
const BULLET = /^[\-–—•*·▢☐□◦‣○●✓✔▪]+\s*/;

function clean(line) {
  let l = line.replace(BULLET, '').replace(/\s+/g, ' ').trim();
  // Gesperrte Überschriften ("Z U T A T E N") wieder zusammenziehen
  if (/^(\S ){2,}\S$/.test(l)) l = l.replace(/ /g, '');
  return l;
}

function headingKind(line) {
  if (line.length > 50) return null;
  if (H_ING.test(line)) return 'ingredients';
  if (H_STEP.test(line)) return 'steps';
  if (H_NOTE.test(line)) return 'notes';
  return null;
}

// Zeilenumbrüche mitten im Satz (typisch für PDF-Text) wieder zusammenfügen.
export function joinWrapped(lines) {
  const out = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && line && /[a-zäöüß]-$/.test(prev) && /^[a-zäöüß]/.test(line)) out[out.length - 1] = prev.slice(0, -1) + line;
    else if (prev && line && !/[.!?:)]$/.test(prev) && /^[a-zäöüß(,]/.test(line)) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

function stripStepNo(line) {
  return line.replace(/^(schritt|step)\s*\d+\s*[.):]?\s*/i, '').replace(/^\d{1,2}\s*[.)]\s+/, '');
}

const tidyTime = (v) => v.replace(/^ca\.?\s*/i, 'ca. ').replace(/\bMin\.?$/i, 'Minuten').replace(/\bStd\.?$/i, 'Stunden').trim();

function setMeta(out, label, value) {
  const v = (value || '').trim().replace(/[,;]$/, '');
  if (!v) return;
  const l = label.toLowerCase();
  if (l.startsWith('gesamt')) out.totalTime ??= tidyTime(v);
  else if (/^(arbeit|zubereit|vorbereit)/.test(l)) out.workTime ??= tidyTime(v);
  else if (/^(koch|back|gar)/.test(l)) out.cookTime ??= tidyTime(v);
  else if (l.startsWith('schwierig')) out.difficulty ??= v;
  else if (/^(portion|person)/.test(l)) out.servings ??= v.replace(/\s*(portionen|personen)$/i, '');
}

// Wertet eine Infozeile aus, auch mit mehreren Angaben in einer Zeile wie in
// der Kochkartei-Vorlage: "Gesamtzeit: ca. 30 Minuten Arbeitszeit: … 4 Portionen …"
export function parseMeta(text) {
  const out = {};
  const stop = `(?=\\s+(?:${META_LABEL}|\\d+\\s*(?:Portionen|Personen|Stück)\\b)|$)`;
  const re = new RegExp(`(Gesamtzeit|Arbeitszeit|Zubereitungszeit|Vorbereitungszeit|Koch-?\\s*\\/\\s*Backzeit|Kochzeit|Backzeit|Garzeit|Schwierigkeitsgrad|Schwierigkeit)\\s*:?\\s*(.+?)${stop}`, 'gi');
  for (const m of text.matchAll(re)) setMeta(out, m[1], m[2]);
  const s = text.match(/(\d+(?:[.,]\d+)?)\s*(Portionen|Personen|Stück)\b/i);
  if (s) out.servings ??= /stück/i.test(s[2]) ? `${s[1]} Stück` : s[1];
  return out;
}

export function parseRecipe(text, hints = {}) {
  const lines = text.replace(/\r/g, '').replace(/\t/g, ' ').split('\n').map(clean);
  const sections = { ingredients: [], steps: [], notes: [] };
  const meta = {};
  const desc = [];
  let title = hints.title ? clean(hints.title) : '';
  let current = null;
  let sawHeading = false;
  const pre = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (current !== 'steps' && current !== 'notes') {
      // Zeiten, Portionen, Schwierigkeit – auch Label und Wert in zwei Zeilen
      const m = line.length < 120 && line.match(META);
      if (m) {
        if (m[2]) Object.entries(parseMeta(line)).forEach(([k, v]) => (meta[k] ??= v));
        else if (lines[i + 1] && lines[i + 1].length < 40 && !headingKind(lines[i + 1])) setMeta(meta, m[1], lines[++i]);
        continue;
      }
      if (DIFFICULTY.test(line)) {
        meta.difficulty ??= line;
        continue;
      }
    }
    const kind = headingKind(line);
    if (kind) {
      sawHeading = true;
      current = kind;
      // "Zutaten für 4 Personen"
      const s = line.match(/(\d+)\s*(portionen|personen|stück)/i);
      if (s) meta.servings ??= /stück/i.test(s[2]) ? `${s[1]} Stück` : s[1];
      continue;
    }
    if (!current) pre.push(line);
    else sections[current].push(line);
  }

  const preLines = pre.filter(Boolean);
  if (title && preLines[0] && preLines[0].toLowerCase() === title.toLowerCase()) preLines.shift();
  if (!title && preLines.length) title = preLines.shift();
  if (!sawHeading) {
    // Keine Überschriften: Zeilen anhand ihrer Form einordnen.
    let mode = 'ingredients';
    for (const line of preLines) {
      if (mode === 'ingredients' && !QTY.test(line) && (line.length > 60 || /[.!]$/.test(line))) mode = 'steps';
      sections[mode].push(line);
    }
  } else {
    for (const line of preLines) {
      const found = parseMeta(line);
      if (Object.keys(found).length && line.length < 160) Object.entries(found).forEach(([k, v]) => (meta[k] ??= v));
      else desc.push(line);
    }
  }

  // Zutaten: "400 g" und "Spaghetti" in zwei Zeilen (Tabellen) zusammenführen
  const ingredients = [];
  const ingLines = sections.ingredients.filter(Boolean);
  for (let i = 0; i < ingLines.length; i++) {
    const l = ingLines[i];
    if (AMOUNT_ONLY.test(l) && ingLines[i + 1] && !AMOUNT_ONLY.test(ingLines[i + 1])) ingredients.push(`${l} ${ingLines[++i]}`);
    else ingredients.push(l);
  }

  let steps = joinWrapped(sections.steps.map(stripStepNo)).filter((l) => l && !/^\d{1,2}$/.test(l));
  // Nummern ohne Punkt ("1 Zwiebel schälen …") nur entfernen, wenn fortlaufend
  if (steps.length > 1 && steps.every((l, i) => l.startsWith(`${i + 1} `))) steps = steps.map((l, i) => l.slice(String(i + 1).length + 1));
  const notes = joinWrapped(sections.notes).filter(Boolean);

  // Kurzer Einleitungstext → Beschreibung, längerer → Tipps
  const description = desc.join(' ');
  const short = description.length <= 180;

  return {
    title: title || '',
    description: short ? description : '',
    totalTime: meta.totalTime || '',
    workTime: meta.workTime || '',
    cookTime: meta.cookTime || '',
    servings: meta.servings || '',
    difficulty: meta.difficulty || '',
    ingredients: ingredients.join('\n'),
    steps: steps.join('\n'),
    notes: [...(short ? [] : [description]), ...notes].join('\n'),
  };
}
