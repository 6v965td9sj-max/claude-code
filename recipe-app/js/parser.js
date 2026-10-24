// Erkennt in eingefügtem Freitext (Webseite, PDF, Notiz) Titel, Infos,
// Zutaten, Zubereitung und Tipps.

const H_ING = /^(zutaten|ingredients?|einkaufsliste|(was )?du brauchst|das brauchst du|man braucht)\b/i;
const H_STEP = /^(zubereitung|anleitung|so geht'?s|so wird'?s gemacht|arbeitsschritte|schritte|instructions?|directions?|method|preparation|steps)\b/i;
const H_NOTE = /^(tipps?|tip|notiz(en)?|hinweis(e)?|anmerkung(en)?|notes?|variante(n)?)\b/i;
const INFO = /\b(portion(en)?|personen|stück|servings?|serves|zeit|arbeitszeit|kochzeit|backzeit|gesamtzeit|ruhezeit|min\.?|minuten|stunden?|std\.?|schwierigkeit|kcal|kalorien|prep|cook|total)\b/i;
const QTY = /^(ca\.?\s*)?[\d½¼¾⅓⅔⅛]/;
const BULLET = /^[\-–—•*·▢☐□◦‣○●✓✔▪︎]+\s*/;

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
function joinWrapped(lines) {
  const out = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev !== '' && line !== '' && !/[.!?:)]$/.test(prev) && /^[a-zäöüß(,]/.test(line)) {
      out[out.length - 1] = `${prev} ${line}`;
    } else out.push(line);
  }
  return out;
}

function stripStepNo(line) {
  return line.replace(/^(schritt|step)\s*\d+\s*[.):]?\s*/i, '').replace(/^\d{1,2}\s*[.)]\s+/, '');
}

export function parseRecipe(text, hints = {}) {
  let lines = text.replace(/\r/g, '').split('\n').map(clean);
  const sections = { ingredients: [], steps: [], notes: [] };
  const info = [];
  let title = hints.title ? clean(hints.title) : '';
  let current = null;
  let sawHeading = false;
  const pre = [];

  // Leerzeilen am Anfang weg
  while (lines.length && !lines[0]) lines.shift();

  for (const line of lines) {
    const kind = headingKind(line);
    if (kind) {
      sawHeading = true;
      current = kind;
      // "Zutaten für 4 Personen" → Info
      const rest = line.replace(kind === 'ingredients' ? H_ING : kind === 'steps' ? H_STEP : H_NOTE, '').replace(/^[\s:–-]+/, '').trim();
      if (rest && INFO.test(rest)) info.push(rest.replace(/^für\s+/i, 'Für '));
      continue;
    }
    if (!current) pre.push(line);
    else sections[current].push(line);
  }

  // Bereich vor der ersten Überschrift: Titel + Infozeilen
  const preLines = pre.filter(Boolean);
  if (!sawHeading) {
    // Keine Überschriften: Zeilen anhand ihrer Form einordnen.
    if (!title && preLines.length) title = preLines.shift();
    let mode = 'ingredients';
    for (const line of preLines) {
      if (mode === 'ingredients' && !QTY.test(line) && (line.length > 60 || /[.!]$/.test(line))) mode = 'steps';
      if (mode === 'ingredients' && INFO.test(line) && line.length < 40 && !QTY.test(line)) {
        info.push(line);
        continue;
      }
      sections[mode].push(line);
    }
  } else {
    if (title && preLines[0] === title) preLines.shift();
    if (!title && preLines.length) title = preLines.shift();
    for (const line of preLines) {
      if (line.length < 60 && INFO.test(line)) info.push(line);
      else if (line.length >= 60) sections.notes.unshift(line); // Einleitungstext
    }
  }

  const ingredients = sections.ingredients.filter(Boolean);
  let steps = joinWrapped(sections.steps.map(stripStepNo)).filter((l) => l && !/^\d{1,2}$/.test(l));
  // Nummern ohne Punkt ("1 Zwiebel schälen …"), wie sie aus PDFs kommen –
  // nur entfernen, wenn sie fortlaufend 1, 2, 3 … sind.
  if (steps.length > 1 && steps.every((l, i) => l.startsWith(`${i + 1} `))) steps = steps.map((l, i) => l.slice(String(i + 1).length + 1));
  const notes = joinWrapped(sections.notes).filter(Boolean);

  return {
    title: title || '',
    info: info.join(' · '),
    ingredients: ingredients.join('\n'),
    steps: steps.join('\n'),
    notes: notes.join('\n'),
  };
}
