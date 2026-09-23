/* BPC Charting Assistant — runs entirely in the browser.
   Nothing here is sent anywhere. The note lives in memory until it is copied
   into Jane, and disappears when the tab closes.

   Numbers are never invented: a measurement is written only when it was said or typed;
   otherwise the line stops at its label ("Knee flexion:") for the physio to complete. */

(function () {
  const V = window.VOCAB;
  const BLANK = V.BLANK;
  const $ = (id) => document.getElementById(id);

  // ---------- state ----------
  const S = {
    format: "New patient's record",   // owner 2026-09-19: the site is mostly used for new patients, so that form opens first
    region: V.REGIONS[0],
    fields: {},
    lang: "th-TH",
    auto: {},           // lines that auto-fill put into each field, so it can retract them
    regionManual: false, // true once the physio picks a region themselves
  };
  const val = (name) => S.fields[name] || "";

  // ---------- transcript matching (detect.js knows the Thai and English words) ----------
  function orderByTranscript(terms) {
    const tr = $("transcript").value || "";
    if (!tr.trim()) return { ordered: terms, heard: new Set() };
    const heard = DETECT.hits(terms, tr);
    return { ordered: [...terms.filter((t) => heard.has(t)), ...terms.filter((t) => !heard.has(t))], heard };
  }
  const UNIT = "(?:°|degrees?|องศา|cm|centimet(?:er|re)s?|ซม|mm|kg|กก|m?hz|mhz|hz|watt/?cm2|w/?cm2|watts?|j/?cm2|bar|min(?:ute)?s?|นาที|sets?|reps?|ครั้ง|เซ็ต|/10)";
  function numbersHeard(text) {
    const re = new RegExp("(\\d+(?:[.,]\\d+)?)\\s*(" + UNIT + ")(?![a-z])", "gi");
    const out = [], seen = new Set(); let m;
    while ((m = re.exec(text))) {
      const v = (m[1] + " " + m[2]).trim();
      const ctx = text.slice(Math.max(0, m.index - 45), Math.min(text.length, m.index + m[0].length + 45)).replace(/\s+/g, " ");
      const k = v.toLowerCase() + ctx.slice(0, 30);
      if (seen.has(k)) continue; seen.add(k); out.push([v, ctx]);
    }
    return out;
  }

  // ---------- line builders (clinic notation) ----------
  // Owner decision 2026-09-16: no line in a box ever carries a ___ blank. Everything up to
  // the first blank is kept ("Knee flexion: ___° Rt. / ___° Lt." -> "Knee flexion:",
  // "Wall sit — ___" -> "Wall sit"); the physio writes the value after it, or says it and
  // detect.js writes it. Applied to every tapped chip, every pack line and every detected line.
  function noBlanks(line) {
    const s = String(line || ""); if (!s.includes(BLANK)) return s;
    // comma-separated parts that still hold a blank are dropped ("1 MHz, ___ w/cm2, 8 mins" ->
    // "1 MHz, 8 mins"); the first part is cut at its blank so the label survives
    const parts = s.split(/,\s*/);
    const out = [];
    parts.forEach((p, i) => {
      if (!p.includes(BLANK)) { out.push(p); return; }
      if (i === 0) { const h = p.slice(0, p.indexOf(BLANK)).replace(/[\s,;\/(\-—–=]+$/, ""); if (h) out.push(h); }
    });
    let t = out.join(", ").replace(/[\s,;\/(\-—–=<>]+$/, "");
    // "Trigger point at ___" -> "Trigger point:", "Anterior view: head tilt to ___ side" ->
    // "Anterior view: head tilt": a word left dangling by the cut goes too
    let dangled = false;
    for (;;) { const m = /\s+(?:at|to|of|with|by|and|in|on|for|or|the|a|an|upper|middle|lower|from|per|than)$/i.exec(t); if (!m) break; t = t.slice(0, m.index); dangled = true; }
    t = t.replace(/[\s,;\/(\-—–=<>]+$/, "");
    if (dangled && t && !t.includes(":")) t += ":";
    return t;
  }
  // A chart-derived template that is only a stub once its numbers are gone ("LSI >", "Gr",
  // "Extension; feel tightness at") is not something to offer; a label ("Q angle:") or a real
  // phrase is.
  function usableStub(t) {
    if (!t || t.length < 6) return false;
    if (/\(\s*\)/.test(t)) return false;
    if (/^\(/.test(t) && !/\)/.test(t)) return false;                        // an opened bracket that never closes: a cut sentence
    if (/\b(at|to|of|with|by|and|in|on|for|or|the|a|are|is|was|were|be|that|which)$/i.test(t)) return false;
    if (!/:/.test(t) && t.trim().split(/\s+/).length < 3) return false;
    // what is left of "Carry heavy things pain VAS 6/10" or "able to do 10 reps" once the number is gone says nothing
    // (owner, 2026-09-21: "able to do — I don't know what that means")
    if (/\b(?:vas|nrs|pain scale|pain score)\s*:?\s*$/i.test(t) || /^(?:un)?able to (?:do|perform)\b.{0,12}$/i.test(t.trim())) return false;
    // "Knee flexion grade", "Hip adductor grade", "…Hamtring limit": the measurement word is left with nothing
    // to measure once the physio's own number is gone
    if (!/\d/.test(t) && /\b(grade|grades|limit|index|level|degree|degrees|score)\s*:?\s*$/i.test(t)) return false;
    return true;
  }
  const romLine = (m) => `${m}:`;
  const circLine = () => `Circumference:`;
  const forceLine = (m) => `${m}; Max force:`;
  const vasLine = () => `VAS:`;
  const testLine = (n) => `${n}:`;
  const palpLine = (f, m, s) => `${f} at ${s ? s + " " : ""}${m} m.`;
  const exLine = (e, d) => (d ? `${e} — ${d}` : e);

  // ---------- append / remove ----------
  const HEADINGS = new Set(["Observation", "Palpation", "Active range of motions", "Passive range of motions",
    "Accessory movement", "Muscle power", "Functional test", "PAIVMS", "Special test", "Neurological examination", "Myotome", "Exercise"]);
  function updateTa(field) {
    const ta = document.querySelector(`textarea[data-field="${CSS.escape(field)}"]`);
    if (ta) { ta.value = S.fields[field] || ""; ta.scrollTop = ta.scrollHeight; }
  }
  function append(field, item, heading, silent) {
    let cur = val(field).replace(/\s+$/, "");
    if (heading) {
      const lines = cur.split("\n");
      const at = lines.findIndex((l) => l.trim() === heading && !l.startsWith(" "));
      if (at < 0) { cur = (cur ? cur + "\n\n" : "") + heading + "\n  " + item; }
      else {
        let end = at + 1; while (end < lines.length && lines[end].startsWith("  ")) end++;
        lines.splice(end, 0, "  " + item); cur = lines.join("\n");
      }
    } else {
      cur = (cur ? cur + "\n" : "") + item;
    }
    S.fields[field] = cur.replace(/^\n+/, "");
    updateTa(field);
    if (!silent) renderOutput();
  }
  const hasLine = (field, item) => val(field).split("\n").some((l) => l.trim() === item.trim());
  function removeLine(field, item) {
    const lines = val(field).split("\n");
    const idx = lines.findIndex((l) => l.trim() === item.trim()); if (idx < 0) return;
    lines.splice(idx, 1);
    const kept = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (HEADINGS.has(l.trim()) && !l.startsWith(" ")) {
        const next = lines.slice(i + 1).find((x) => x.trim() !== "");
        if (!next || !next.startsWith("  ")) continue; // heading with nothing under it
      }
      kept.push(l);
    }
    S.fields[field] = kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
    updateTa(field);
  }

  // ---------- auto-fill from the notes box ----------
  // Where each detected line goes, per form. sec -> [field, keepHeading]
  function target(sec, heading) {
    const f = S.format;
    // "PastHistory" is a New patient's record-only routing hint (a real box there); every other
    // format folds past history into its one subjective/complaint box, same as before.
    if (/^(Past|Present)History$/.test(heading) && f !== "New patient's record") heading = "";
    if (f === "SOAP with treatment") {
      if (sec === "problem") return null;
      return [{ subjective: "Subjective", objective: "Objective", analysis: "Analysis", plan: "Plan", treatment: "Treatment", exercise: "Treatment" }[sec], heading];
    }
    if (f === "New patient's record") {
      if (sec === "objective") {
        const map = { "Observation": "Observation", "Palpation": "Palpation", "Accessory movement": "Palpation",
          "Active range of motions": "Active range of motions", "Passive range of motions": "Passive range of motions",
          "Muscle power": "Muscle power", "Functional test": "Functional test", "Special test": "Special test",
          "Neurological examination": "Neurological examination", "Myotome": "Neurological examination", "PAIVMS": "PAIVMS" };
        return heading ? [map[heading] || "Observation", ""] : ["Pain scale", ""];
      }
      if (sec === "subjective" && heading === "PastHistory") return ["Past history", ""];
      if (sec === "subjective" && heading === "PresentHistory") return ["Present history", ""];
      return { subjective: ["Chief complaint", ""], analysis: ["Diagnosis", ""], plan: null, treatment: ["Treatment", ""], exercise: ["Treatment", "Exercise"], problem: ["Problem list", ""] }[sec];
    }
    if (f === "Physiotherapy Report") {
      return { subjective: ["Chief Complaint", ""], objective: ["Physical Examinations", heading], analysis: ["Diagnosis", ""], plan: ["Recommendation", ""],
        treatment: ["Physiotherapy Treatments", ""], exercise: ["Physiotherapy Treatments", "Exercise"], problem: null }[sec];
    }
    return { subjective: ["Chief complaint", ""], objective: ["Physical examinations", heading], analysis: ["Diagnosis", ""], plan: ["Physician's recommendations", ""],
      treatment: ["Treatments", ""], exercise: ["Treatments", "Exercise"], problem: null }[sec];
  }
  // the same notes, give or take a few characters (a typo fixed, a space added): not worth a new read
  const sameNotes = (a, b) => !!a && !!b && (a === b || (Math.abs(a.length - b.length) < 30 && a.slice(0, 120) === b.slice(0, 120)));
  function autoFill() {
    const text = $("transcript").value || "";
    let res = DETECT.run(text, S.region);
    if (res.side && !S.sideManual && res.side !== S.side) { setSide(res.side, true); renderCondTag(); }
    S.sideAuto = !!res.side;   // a side heard in the notes ("my left leg") survives a spine condition
    // the region the notes are about changes what counts as a movement, a test or an exercise: read them again with it
    if (res.region && !S.regionManual && res.region !== S.region) { S.region = res.region; $("region").value = res.region; renderBuilder(); prefillTests(); applyPack(); res = DETECT.run(text, S.region); }
    if (res.tt && !$("tt").value.trim()) $("tt").value = res.tt;
    // adopt the first diagnosis heard as the condition before placing lines, so it is not added twice
    // the condition is the first specific diagnosis heard; a generic one (muscle imbalance, poor posture)
    // only when nothing more specific was said
    // Draft 36: once Claude has read these very notes, its reading IS the note — the rules' lines come out and
    // stay out until the notes change (they were the source of "Radiating pain" when the physio said there was
    // none, of a PMS area nobody said, of a cause cut in half). Region and side still come from the rules at once.
    const aiOwns = sameNotes(S.aiFor, text.trim());
    if (S.aiFor && !aiOwns) { S.aiFor = ""; retractSmart(); applyPack(); }   // these are no longer the notes Claude read
    const GENERIC = /^(?:rt\.|lt\.|both)?\s*(muscle imbalance|poor posture|postural dysfunction|muscle tightness|general muscle tightness|muscle tension|muscle spasm|muscle strain|overuse|swelling|scoliosis|itb tightness)$/i;
    const dxLines = res.lines.filter((l) => l.sec === "analysis");
    const heardDx0 = dxLines.find((l) => !GENERIC.test(l.line)) || dxLines[0];
    let guessed = null;
    if (aiOwns && (S.aiConds || []).length) { /* the diagnoses Claude read are on the tag: no second guess from the rules */ }
    else {
    if (heardDx0 && (!S.condition || S.conditionAuto)) { const nm = heardDx0.line.replace(/^(Rt\.|Lt\.|Both) /, ""); if (nm !== S.condition) setCondition(nm, true); }
    else if (!heardDx0 && S.condition && S.conditionAuto && !S.conditionGuess) { S.condition = ""; S.conditionAuto = false; renderCondTag(); }
    if (!heardDx0 && (!S.condition || S.conditionGuess)) {
      const g = guessCondition(res);
      if (g && g.name !== S.condition) { setCondition(g.name, true); S.conditionGuess = true; guessed = g; }
      else if (!g && S.conditionGuess) { S.condition = ""; S.conditionAuto = false; S.conditionGuess = false; renderCondTag(); }
      else if (g) guessed = g;
    } else if (heardDx0) S.conditionGuess = false;
    }
    const wanted = {};
    if (!aiOwns) res.lines.forEach((l) => {
      const t = target(l.sec, l.heading); if (!t || !t[0]) return;
      let line = l.line;
      // the chosen condition is already in the box; do not add it again with a side
      if (l.sec === "analysis" && S.condition && line.replace(/^(Rt\.|Lt\.|Both) /, "").toLowerCase() === S.condition.toLowerCase()) return;
      if (S.format === "New patient's record" && t[0] === "Pain scale") line = res.vas || line;
      if (l.sec === "treatment" && !t[1]) line = fillTreatmentBlanks(line, res);
      line = noBlanks(line); if (!line) return;
      (wanted[t[0]] = wanted[t[0]] || []).push({ heading: t[1] || "", line });
    });
    const key = (x) => x.heading + "" + x.line;
    let count = 0;
    new Set([...Object.keys(S.auto), ...Object.keys(wanted)]).forEach((field) => {
      const prev = S.auto[field] || [], next = wanted[field] || [];
      const nextKeys = new Set(next.map(key)), prevKeys = new Set(prev.map(key));
      prev.filter((p) => !nextKeys.has(key(p))).forEach((p) => removeLine(field, p.line));
      next.filter((w) => !prevKeys.has(key(w))).forEach((w) => {
        if (/(\+ve|-ve)\s*$/.test(w.line)) removeBlankTest(field, w.line); // a read result replaces the pre-listed "Name:" line
        if (!hasLine(field, w.line)) append(field, w.line, w.heading, true);
      });
      S.auto[field] = next; count += next.length;
    });
    renderOutput(); scheduleSuggest(); syncChips();
    const st = $("fillstate");
    if (st) st.textContent = !text.trim() || aiOwns ? "" : count ? `${count} line${count > 1 ? "s" : ""} filled into section 2 from these notes — check each one, then edit or delete freely.${guessed ? ` No diagnosis was said, so the condition is the clinic's closest match to these findings: ${guessed.name} (${guessed.matched} findings in common with ${guessed.n} charts) — remove it if that is not what you found.` : ""}` : "Nothing recognised yet — keep going, or use the options in section 2.";
    return count;
  }
  let fillT; const scheduleFill = () => { clearTimeout(fillT); fillT = setTimeout(autoFill, 350); };

  // ---------- start from the last note (follow-up visits) ----------
  // Jane renders an entry as label lines ("Subjective", "Objective", …) each
  // followed by its text; copied text may also carry "Label: text". Any form's
  // labels are understood and mapped onto the form being written now.
  const SEC_OF = { "subjective": "subjective", "chief complaint": "subjective", "objective": "objective", "physical examinations": "objective",
    "physical examination": "objective", "assessment": "analysis", "analysis": "analysis", "diagnosis": "analysis", "plan": "plan",
    "recommendation": "plan", "recommendations": "plan", "physician's recommendations": "plan", "treatment": "treatment", "treatments": "treatment",
    "physiotherapy treatments": "treatment", "physiotherapy treatment": "treatment" };
  const SUB_LABELS = ["Present history", "Past history", "Pain scale", "Observation", "Palpation", "Active range of motions", "Active range of motion",
    "Passive range of motions", "Passive range of motion", "Muscle power", "PAIVMS", "Functional test", "Special test", "Neurological examination", "Problem list", "Exercise"];
  const SKIP_LABELS = /^(physiotherapist'?s? (name|signature)|signature|physiotherapy report|soap.*|chart entry options|signed|survey)/i;
  const NOISE = /^(viewable by |amend title|close$|duplicate$|\w+ \d{1,2}, \d{4} – )/i;
  const SEC_FIELD = {
    "SOAP with treatment": { subjective: "Subjective", objective: "Objective", analysis: "Analysis", plan: "Plan", treatment: "Treatment" },
    "Physiotherapy Report": { subjective: "Chief Complaint", objective: "Physical Examinations", analysis: "Diagnosis", plan: "Recommendation", treatment: "Physiotherapy Treatments" },
    "New patient's record": { subjective: "Chief complaint", objective: "Observation", analysis: "Diagnosis", plan: "Treatment", treatment: "Treatment" },
  };
  function parseLastNote(text) {
    const fmtFields = V.OUTPUT_FORMATS[S.format];
    const fieldByLower = Object.fromEntries(fmtFields.map((f) => [f.toLowerCase(), f]));
    const subByLower = Object.fromEntries(SUB_LABELS.map((f) => [f.toLowerCase(), f]));
    const out = {}; let cur = null;
    const put = (field, line) => { if (!field) return; out[field] = (out[field] ? out[field] + "\n" : "") + line; };
    const fieldFor = (sec) => (SEC_FIELD[S.format] || SEC_FIELD["SOAP with treatment"])[sec];
    text.split(/\r?\n/).forEach((raw) => {
      let line = raw.replace(/\s+$/, ""); if (!line.trim()) { if (cur) put(cur, ""); return; } if (NOISE.test(line.trim())) return;
      const m = line.trim().match(/^([A-Za-z' ]{3,60}?)\s*\*?\s*(?::\s*(.*))?$/);
      const key = m ? m[1].trim().toLowerCase().replace(/\*$/, "") : "";
      if (key && SKIP_LABELS.test(key)) { cur = null; return; }
      if (key && (SEC_OF[key] || fieldByLower[key] || subByLower[key])) {
        if (fieldByLower[key]) cur = fieldByLower[key];
        else if (SEC_OF[key]) cur = fieldFor(SEC_OF[key]);
        else { // a sub-heading (Observation, Palpation…) inside another form: keep it as a heading line in the objective box
          const objField = fieldFor("objective"); if (cur !== objField) cur = objField; put(cur, subByLower[key]); return;
        }
        if (m[2] && m[2].trim()) put(cur, m[2].trim());
        return;
      }
      if (!cur) return;
      put(cur, /^\s/.test(raw) ? raw.replace(/^\s{3,}/, "  ") : line.trim());
    });
    return out;
  }
  function useLastNote() {
    const text = $("lastnote").value || ""; if (!text.trim()) { $("laststate").textContent = ""; return; }
    const parsed = parseLastNote(text);
    let tt = "", suffix = "";
    Object.keys(parsed).forEach((f) => {
      parsed[f] = parsed[f].split("\n").filter((l) => {
        const m = l.match(/^\*?\s*treatment times?\s*:?\s*(\d+)\s*(\([^)]*\))?/i);
        if (m) { tt = String(+m[1] + 1); suffix = m[2] || ""; return false; }
        return true;
      }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    });
    const filled = Object.keys(parsed).filter((f) => parsed[f]);
    if (!filled.length) { $("laststate").textContent = "No section headings found — paste the whole entry as Jane shows it (Subjective, Objective, …)."; return; }
    filled.forEach((f) => { S.fields[f] = parsed[f]; });
    S.auto = {}; S.ttSuffix = suffix;
    if (tt) $("tt").value = tt;
    renderBuilder(); renderOutput(); autoFill();
    $("laststate").textContent = `${filled.length} section${filled.length > 1 ? "s" : ""} filled from the last note` + (tt ? `, treatment times set to ${tt}` : "") + ". Change what is different today — for example the numbers, post-treatment result and any new finding.";
    toast("Filled from the last note");
  }

  // ---------- chip rendering ----------
  // the part of a line that identifies it, whatever numbers or areas were filled in after
  const lineHead = (t) => String(t).replace(/\s*(?:  |: |: ___| — |; Rt\.).*$/, "").replace(/\s*___.*$/, "").trim();
  function lineInField(field, line) {
    const head = lineHead(line).toLowerCase(); if (!head) return "";
    const exact = val(field).split("\n").map((l) => l.trim()).find((l) => l === line.trim());
    if (exact) return exact;
    return val(field).split("\n").map((l) => l.trim()).find((l) => l.toLowerCase().startsWith(head) && (l.length === head.length || /[\s:;—(]/.test(l.charAt(head.length)))) || "";
  }
  function syncChips() {
    document.querySelectorAll("#builder button.chip[data-field]").forEach((b) => { const inBox = lineInField(b.dataset.field, b.dataset.line); b.classList.toggle("on", !!inBox); b.title = inBox ? "In the box — tap to take it out" : (b.classList.contains("heard") ? "Heard in the transcript" : ""); });
    const painCur = val("Pain scale");
    document.querySelectorAll("#builder button.chip[data-pain]").forEach((b) => b.classList.toggle("on", b.dataset.line === painCur));
    customSync.forEach((fn) => fn());
  }
  const customSync = [];   // pickers below keep their own buttons in step with the boxes; reset by renderBuilder

  // ---------- pickers built from physio feedback (bua, 2026-09-19) ----------
  // the lines of one heading inside a field (SOAP keeps every Objective heading in one box);
  // no heading = the whole field
  function scopeLines(field, heading) {
    const lines = val(field).split("\n");
    if (!heading) return { lines, from: 0, to: lines.length };
    const at = lines.findIndex((l) => l.trim() === heading && !l.startsWith(" "));
    if (at < 0) return { lines, from: 0, to: 0 };
    let end = at + 1; while (end < lines.length && lines[end].startsWith("  ")) end++;
    return { lines, from: at + 1, to: end };
  }
  function writeLines(field, lines) { S.fields[field] = lines.join("\n"); updateTa(field); renderOutput(); syncChips(); }
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const valueOf = (l) => (l.indexOf(":") < 0 ? "" : l.slice(l.indexOf(":") + 1).trim());
  const setValue = (l, v) => { const c = l.indexOf(":"); return (c < 0 ? l.replace(/\s+$/, "") : l.slice(0, c)) + ":" + (v ? " " + v : ""); };
  const mkChip = (text, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip" + (cls ? " " + cls : ""); b.textContent = text; return b; };

  // Observation, grouped by the view posture is read from (V.OBSERVATION_VIEWS)
  function observationPicker(b, field, heading, terms) {
    const left = new Set(terms);
    Object.entries(V.OBSERVATION_VIEWS || {}).forEach(([view, list]) => {
      const here = list.filter((t) => left.has(t)); if (!here.length) return;
      b.appendChild(sub(view)); b.appendChild(chips(here, field, heading)); here.forEach((t) => left.delete(t));
    });
    if (left.size) { b.appendChild(sub("Other")); b.appendChild(chips([...left], field, heading)); }
  }

  // Range of motion: a finding ("full ROM without pain") belongs to a movement. Tapping one
  // fills every movement line still empty; tap a movement first to set just that one.
  // (Before: the finding landed as its own line under the movements, and a second tap removed it.)
  function romPicker(b, field, heading, moves) {
    let focus = "";
    const moveRe = (m) => new RegExp("^\\s*" + reEsc(m) + "(?:\\s+(?:Rt\\.|Lt\\.|Both))?\\s*(?::|$)", "i");
    const lineOf = (m) => { const { lines, from, to } = scopeLines(field, heading); for (let i = from; i < to; i++) if (moveRe(m).test(lines[i])) return i; return -1; };
    const hint = sub(""); const moveRow = document.createElement("div"); moveRow.className = "chips";
    const qRow = document.createElement("div"); qRow.className = "chips";
    const moveBtns = moves.map((m) => {
      const mb = mkChip(m);
      mb.onclick = () => {
        const i = lineOf(m);
        if (i < 0) { append(field, romLine(m), heading); focus = ""; }   // adding never singles a movement out: "flexion, extension, full ROM" must fill both
        else if (focus === m) { removeLine(field, scopeLines(field, heading).lines[i].trim()); focus = ""; }
        else focus = m;
        renderOutput(); syncChips();
      };
      moveRow.appendChild(mb); return [m, mb];
    });
    const qBtns = V.ROM_QUALIFIERS.map((q) => {
      const qb = mkChip(q);
      qb.onclick = () => {
        const { lines, from, to } = scopeLines(field, heading);
        const all = []; for (let i = from; i < to; i++) if (moves.some((m) => moveRe(m).test(lines[i]))) all.push(i);
        let targets;
        const fi = focus ? lineOf(focus) : -1;
        if (fi >= 0) targets = [fi];
        else { const empty = all.filter((i) => !valueOf(lines[i])); targets = empty.length ? empty : all; }
        if (!targets.length) {   // no movement in the box: the finding stands on its own, as before
          const inBox = lineInField(field, q); if (inBox) removeLine(field, inBox); else append(field, q, heading);
          renderOutput(); syncChips(); return;
        }
        const same = targets.every((i) => valueOf(lines[i]) === q);
        targets.forEach((i) => { lines[i] = setValue(lines[i], same ? "" : q); });
        focus = "";
        writeLines(field, lines);
      };
      qRow.appendChild(qb); return [q, qb];
    });
    const sync = () => {
      const { lines, from, to } = scopeLines(field, heading); const scope = lines.slice(from, to);
      if (focus && lineOf(focus) < 0) focus = "";
      moveBtns.forEach(([m, mb]) => { mb.classList.toggle("on", lineOf(m) >= 0); mb.style.boxShadow = focus === m ? "0 0 0 3px #38C2CD" : ""; });
      qBtns.forEach(([q, qb]) => qb.classList.toggle("on", scope.some((l) => valueOf(l) === q || l.trim() === q)));
      hint.textContent = focus ? `${focus} — now tap what you found (or tap it again to remove it)` :"What you found — fills every movement still empty. Tap a movement first to set just that one.";
    };
    customSync.push(sync);
    b.appendChild(moveRow); b.appendChild(hint); b.appendChild(qRow); sync();
  }

  // Muscle power: grade first, then the muscle, muscles grouped the way the region lists them
  function musclePowerPicker(b, field, heading) {
    const groups = profile().muscle_groups.filter((g) => V.MUSCLES[g] && g !== "Ligaments & structures");
    const grades = V.MMT_GRADES || ["Grade 5/5", "Grade 4/5", "Grade 3/5"];
    let grade = grades[2] || grades[0], side = S.side && S.side !== "Both" ? S.side : "";
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const lineRe = (m) => new RegExp("^\\s*" + reEsc(m) + "(?:\\s+(?:Rt\\.|Lt\\.|Both))?\\s*:", "i");
    const gradeRow = document.createElement("div"); gradeRow.className = "chips";
    grades.forEach((g) => { const gb = mkChip(g, "sel" + (g === grade ? " on" : "")); gb.onclick = () => { grade = g; gradeRow.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === gb)); hint.textContent = hintText(); }; gradeRow.appendChild(gb); });
    const hintText = () => `${grade}${side ? " · " + side : ""} — for which muscle?`;
    const hint = sub(hintText());
    const sideRow = document.createElement("div"); sideRow.className = "row3";
    const sideSel = selectEl(["", ...V.SIDES], (e) => { side = e.target.value; hint.textContent = hintText(); }); sideSel.value = side; sideRow.appendChild(sideSel);
    b.appendChild(gradeRow); b.appendChild(sideRow); b.appendChild(hint);
    const btns = [];
    groups.forEach((g) => {
      b.appendChild(sub(g)); const row = document.createElement("div"); row.className = "chips";
      [...new Set(V.MUSCLES[g])].forEach((m) => {
        const name = cap(m); const mb = mkChip(name);
        mb.onclick = () => {
          const { lines, from, to } = scopeLines(field, heading);
          const want = `${name}${side ? " " + side : ""}`;
          let at = -1; for (let i = from; i < to; i++) if (new RegExp("^\\s*" + reEsc(want) + "\\s*:", "i").test(lines[i])) { at = i; break; }
          if (at < 0) { append(field, `${want}: ${grade}`, heading); renderOutput(); syncChips(); return; }
          if (valueOf(lines[at]) === grade) { removeLine(field, lines[at].trim()); renderOutput(); syncChips(); return; }
          lines[at] = setValue(lines[at], grade); writeLines(field, lines);
        };
        row.appendChild(mb); btns.push([name, mb]);
      });
      b.appendChild(row);
    });
    customSync.push(() => { const { lines, from, to } = scopeLines(field, heading); const scope = lines.slice(from, to); btns.forEach(([name, mb]) => { const l = scope.find((x) => lineRe(name).test(x)); mb.classList.toggle("on", !!l); mb.title = l ? l.trim() : ""; }); });
    b.appendChild(sub("Overall")); b.appendChild(chips(V.STRENGTH.filter((s) => !/^Grade \d/.test(s)), field, heading));
    syncChips();
  }
  function chips(terms, field, heading, transform) {
    const wrap = document.createElement("div"); wrap.className = "chips";
    const { ordered, heard } = orderByTranscript(terms);
    ordered.forEach((t) => {
      const b = document.createElement("button"); b.type = "button";
      const line = noBlanks(transform ? transform(t) : t);
      b.className = "chip" + (heard.has(t) ? " heard" : ""); b.textContent = t; b.dataset.field = field; b.dataset.line = line;
      if (heard.has(t)) b.title = "Heard in the transcript";
      if (lineInField(field, line)) b.classList.add("on");
      b.onclick = () => {
        const current = noBlanks(transform ? transform(t) : t); b.dataset.line = current;
        const inBox = lineInField(field, current);
        if (inBox) removeLine(field, inBox); else append(field, current, heading);
        renderOutput(); syncChips();
      };
      wrap.appendChild(b);
    });
    return wrap;
  }
  function details(title, open) {
    const d = document.createElement("details"); if (open) d.open = true;
    const s = document.createElement("summary"); s.textContent = title; d.appendChild(s);
    const body = document.createElement("div"); body.className = "body"; d.appendChild(body);
    return [d, body];
  }
  const sub = (t) => { const p = document.createElement("p"); p.className = "sub"; p.textContent = t; return p; };
  function selectEl(opts, onchange, id) {
    const s = document.createElement("select"); if (id) s.id = id;
    opts.forEach((o) => { const op = document.createElement("option"); op.value = o; op.textContent = o || "—"; s.appendChild(op); });
    s.onchange = onchange; return s;
  }

  // ---------- field textarea ----------
  function fieldBox(name, rows, placeholder, withMic) {
    const w = document.createElement("div"); w.className = "fld"; w.dataset.jump = name;
    const head = document.createElement("div"); head.className = "head";
    const b = document.createElement("b"); b.textContent = name; head.appendChild(b);
    if (withMic) {
      const m = document.createElement("button"); m.type = "button"; m.className = "mic";
      m.textContent = "🎙 Dictate"; m.dataset.target = "f:" + name; head.appendChild(m);
      wireMic(m);
    }
    w.appendChild(head);
    const ta = document.createElement("textarea"); ta.rows = rows; ta.placeholder = placeholder || "";
    ta.dataset.field = name; ta.value = val(name);
    ta.oninput = () => { S.fields[name] = ta.value; renderOutput(); if (/^(Analysis|Diagnosis)$/.test(name)) scheduleSuggest(); };
    w.appendChild(ta);
    const sg = document.createElement("div"); sg.className = "sugg"; sg.dataset.for = name; w.appendChild(sg);
    return w;
  }

  // Jane's pain scale is a 0-10 slider, not a paragraph — one tap sets it,
  // tapping the same number again clears it. No mic, no textarea: this is
  // the "little tiny marker" the field actually is in a real chart.
  function painScaleBox() {
    const w = document.createElement("div"); w.className = "fld"; w.dataset.jump = "Pain scale";
    const head = document.createElement("div"); head.className = "head";
    const b = document.createElement("b"); b.textContent = "Pain scale"; head.appendChild(b);
    w.appendChild(head);
    const row = document.createElement("div"); row.className = "chips";
    // two painful areas have two scores (physio feedback 2026-09-21: "4/10 for the arm, 7/10 for the low back —
    // the pain scale needs to come up twice"): the line under the buttons holds them as written
    const more = document.createElement("input"); more.type = "text"; more.placeholder = "More than one area? Write them here — Low back 7/10, Lt. elbow 4/10"; more.style.marginTop = "8px";
    const paint = () => { const cur = val("Pain scale"); row.querySelectorAll("button").forEach((btn) => btn.classList.toggle("on", btn.dataset.line === cur)); more.value = /^\d{1,2}$/.test(cur) ? "" : cur.replace(/\n+/g, ", "); };
    for (let n = 0; n <= 10; n++) {
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "chip sel";
      btn.textContent = String(n); btn.dataset.line = String(n); btn.dataset.pain = "1";
      btn.onclick = () => { const line = String(n); S.fields["Pain scale"] = val("Pain scale") === line ? "" : line; paint(); renderOutput(); };
      row.appendChild(btn);
    }
    more.oninput = () => { S.fields["Pain scale"] = more.value.trim(); row.querySelectorAll("button").forEach((btn) => btn.classList.remove("on")); renderOutput(); };
    paint();
    w.appendChild(row); w.appendChild(more);
    return w;
  }

  // ---------- the condition in play ----------
  // Chosen from the search box (or adopted from the notes). It stays in the
  // Analysis/Diagnosis box, sets the body region, and drives the suggestions.
  const GROUP_REGION = { "Neck & upper back": "Neck / cervical", "Shoulder": "Shoulder", "Elbow, wrist & hand": "Elbow, wrist & hand",
    "Low back & pelvis": "Trunk / lumbar", "Hip & thigh": "Hip", "Knee": "Knee", "Ankle & foot": "Ankle & foot" };
  const dxField = () => (S.format === "SOAP with treatment" ? "Analysis" : "Diagnosis");
  const CONDITION_REGION = [
    // --- abbreviations first: a physio types "PFPS", "LBP", "CTS", not the long name ---
    [/\b(pfps|pfs|pfp|pfoa|aclr?|pcl|mcl|lcl|plc|mpfl|tka|tkr|uka|itbs|itbfs|oa knee|knee oa|pes anserin\w*|hoffa|plica|osd|sinding)\b/i, "Knee"],
    [/\b(atfl|cfl|ptfl|las|cai|mtss|pttd|hav|fhl|tts|at rupture|plantar fasc\w*|pf heel|sever|lisfranc|syndesmosis|high ankle)\b/i, "Ankle & foot"],
    [/\b(rc|rct|rcr|rtc|sis|sais|sasd|acj|gird|lhb|lhbt|hags|tsa|rtsa|bankart|hill.?sachs|fs shoulder)\b/i, "Shoulder"],
    [/\b(fai|gtps|tha|thr|oa hip|hip oa|avn|snapping hip|tfl|pghd)\b/i, "Hip"],
    [/\b(cts|dq|dqt|tfcc|ucl|le elbow|tennis elbow|golfer'?s elbow|cubts|ecu|ecrb|cmc|mallet|dupuytren|ganglion|colles|scaphoid|tcl)\b/i, "Elbow, wrist & hand"],
    [/\b(ais|t4 syndrome|costochond\w*|scheuermann)\b|\bt(?:1[0-2]|[1-9])\b(?!\s*(?:weeks?|wks?|months?))/i, "Thoracic spine"],
    [/\b(wad|tos|tmj|tmd|cgh|tth|c-?spine|cs spondylosis|cervical)\b|\bc[1-7]\b/i, "Neck / cervical"],
    [/\b(lbp|clbp|nslbp|hivd|pid|ddd|lss|fbss|ls spine|l-?spine|sijd|si joint|spondylo\w*|cauda)\b|\bl[1-5]\b|\bs1\b/i, "Trunk / lumbar"],
    [/\b(acl|pcl|mcl|lcl|aclr)\b|meniscus|meniscal|patell|knee|itb|runner'?s|jumper'?s|osgood|chondromalacia|baker|genu|tibial plateau/i, "Knee"],
    [/ankle|atfl|cfl|achilles|plantar|heel|shin|foot|toe|hallux|calf|gastroc|soleus|peroneal|tibialis|bunion|morton/i, "Ankle & foot"],
    [/shoulder|rotator|supraspinatus|infraspinatus|subscap|impingement|frozen|adhesive|labr|slap|ac joint|biceps tend|bursitis of the shoulder|glenohumeral|scapul/i, "Shoulder"],
    [/\bhip\b|gluteal|glute|trochanter|femoroacetabular|\bfai\b|hamstring|groin|adductor|quadriceps strain|thigh/i, "Hip"],
    [/elbow|epicondyl|tennis|golfer|wrist|carpal|de quervain|trigger finger|hand|finger|thumb|tfcc|forearm|cubital/i, "Elbow, wrist & hand"],
    [/scoliosis|kyphosis|thoracic|rib|costo/i, "Thoracic spine"],
    // "myofascial" / "mps" alone say nothing about where: the clinic files MPS for neck, low-back, hip
    // and knee patients alike, so a bare MPS stays "General / other" until a place is named or heard
    [/office syndrome|upper cross|text neck|headache|torticollis|whiplash|cervical|neck|trapezius|levator|scalene|sub-?occipital|cranio|sternocleidomastoid/i, "Neck / cervical"],
    [/lower cross|low back|lumbar|disc|hnp|sciatic|spondyl|stenosis|sij|sacroiliac|coccy|pelvic|piriformis|quadratus lumborum|\bql\b|erector|multifidus/i, "Trunk / lumbar"],
    [/postur/i, "Thoracic spine"],
    // --- the clinic's own wordings and misspellings that matched nothing above (checked against all 2,496 condition names) ---
    [/\bback (?:muscles?|pain|strain|spasm|ache)|herniated nucleus|nucleus pulposus|\blumbo|paraspinal|\btrunk control/i, "Trunk / lumbar"],
    [/talofibular|calcaneofibular|deltoid ligament|\bmtp\b|metatars|achil+es+|\bta tend|tarsal|navicular|cuboid|fibula(?!r head)|lower legs?\b/i, "Ankle & foot"],
    [/\bbicep\b|acromio|clavic|serratus|deltoid(?! ligament)|shoul|pectoral|\bpec\b|teres|latissimus|humer/i, "Shoulder"],
    [/popliteus|iliotibial|tibial fracture|proximal tibia|tibial osteotomy|\bhto\b|quadriceps tend|quad tend|pes anser|fabella|\b4cl\b/i, "Knee"],
    [/rectus femoris|retus femoris|iliopsoas|psoas|hip flexor|ischial|sartorius|femoral neck|pubalgia|osteitis pubis/i, "Hip"],
    [/median nerve|ulnar nerve|radial nerve|metacarp|phalan|scapholunate|olecranon|brachioradialis|pronator/i, "Elbow, wrist & hand"],
    [/c-?spin|spondylosis of the neck|cervico|occipit|\bscm\b|jaw/i, "Neck / cervical"],
    [/sco[il]{2,3}osis|rib cage|intercostal|thoraco/i, "Thoracic spine"],
  ];
  function regionForCondition(name) {
    const lc = name.toLowerCase();
    // owner decision: MPS never opens a region by itself. The vocabulary files "Myofascial pain syndrome (MPS)" under
    // "Neck & upper back", so a myofascial name skips that list lookup: only a PLACE in the name ("at upper trapezius",
    // "sub-occipital", "cranio-cervical") or the notes decide the region.
    if (!/^\s*(?:mps\b|myofas?cial)/i.test(name))
    for (const [group, list] of Object.entries(V.DIAGNOSES)) if (list.some((d) => d.toLowerCase() === lc) && GROUP_REGION[group]) return GROUP_REGION[group];
    // a disc, stenosis or radiculopathy with a cervical marker is a neck patient wherever the words sit ("HNP C5-6")
    if (/\bc[1-7]\b|cervic|\bneck\b/i.test(name) && /hernia|\bhnp\b|disc|radicul|spondyl|stenosis/i.test(name)) return "Neck / cervical";
    let best = null;
    for (const [re, region] of CONDITION_REGION) { const m = re.exec(name); if (m && (!best || m.index < best.i)) best = { i: m.index, region }; }
    if (best) return best.region;
    return DETECT.run(name, S.region).region || "General / other";
  }
  // Which of the clinic's conditions do these findings look like? Every condition in
  // suggest.js carries the lines physios wrote for it; the one sharing the most
  // lines with what was just read from the notes (same region) is the guess.
  const COND_REGION = {};
  const condRegion = (k) => (COND_REGION[k] = COND_REGION[k] || regionForCondition(dxDisplay(k)));
  const normLine = (t) => String(t).toLowerCase().replace(SIDE_TOKEN, " ").replace(/\b(rt\.|lt\.|both|right|left|bilateral)\s*/g, "").replace(/\bm\.$/, "").replace(/[^a-z0-9ก-๙ ]+/g, " ").replace(/\s+/g, " ").trim();
  function guessCondition(res) {
    if (!SG || !res || !res.lines) return null;
    const seen = new Set();
    res.lines.forEach((l) => { if (l.sec !== "problem" && !/___/.test(l.line)) { const t = normLine(l.line); if (t.length >= 4) seen.add(t); } });
    res.heard.forEach((h) => { const t = normLine(h); if (t.length >= 4) seen.add(t); });
    if (seen.size < 3) return null;
    const region = res.region || "";
    let best = null;
    Object.entries(SG.conditions).forEach(([k, v]) => {
      const r = condRegion(k);
      if (region && r !== region && r !== "General / other") return;
      let score = 0, matched = 0; const hitLines = [];
      Object.values(v.s).forEach((lines) => lines.forEach(([line, n]) => { const t = normLine(line); if (t.length >= 4 && seen.has(t)) { matched++; score += Math.min(n, 30) + (r === region ? 5 : 0); hitLines.push(t); } }));
      if (matched >= 2 && (!best || score > best.score)) best = { name: dxDisplay(k), key: k, score, matched, n: v.n, hitLines };
    });
    return best;
  }
  // "Left PFPS", "PFPS at lt. knee", "Rt. biceps tendinitis and both PFPS", "OA knee Lt.>Rt.", "ซ้าย": the first side named wins
  function sideForCondition(name) {
    const m = /\b(both|bilateral|bilat|bil)\b|\b(lt|left)\b\.?|\b(rt|right)\b\.?|(ทั้งสองข้าง|สองข้าง)|(ซ้าย)|(ขวา)/i.exec(String(name || ""));
    if (!m) return "";
    if (/(lt|left)\.?\s*[>=<&\/]\s*(rt|right)|(rt|right)\.?\s*[>=<&\/]\s*(lt|left)/i.test(name)) return "Both";
    return m[1] || m[4] ? "Both" : m[2] || m[5] ? "Lt." : "Rt.";
  }
  function setCondition(name, auto) {
    name = (name || "").trim(); if (!name) return;
    const f = dxField();
    if (S.condition && S.condition !== name && S.conditionAuto !== false) removeLine(f, S.condition);
    if (!auto && S.condition && S.condition !== name && S.conditionAuto === false && !(S.moreConditions || []).includes(S.condition)) (S.moreConditions = S.moreConditions || []).push(S.condition);
    S.moreConditions = (S.moreConditions || []).filter((c) => c !== name);
    S.condition = name; S.conditionAuto = !!auto;
    if (!auto) S.conditionGuess = false;   // a condition the physio picked is not "the closest match in the charts" (the tag kept saying so)
    // (a fuller line for the same diagnosis may already be in the box: "Mechanical low back pain, Rt. > Lt.")
    if (!hasLine(f, name) && !val(f).split("\n").some((l) => l.trim().toLowerCase().startsWith(name.toLowerCase()))) append(f, name, "", true);
    const r = regionForCondition(name);
    if (r && r !== S.region && (r !== "General / other" || !S.region || S.region === "General / other")) { S.region = r; $("region").value = r; S.regionFromCond = r !== "General / other"; }
    // spine, posture and whole-body conditions have no side: scoliosis, low back, neck, MPS…
    if ((MIDLINE.has(S.region) || /scoliosis|posture|spine|spinal|lumbar|cervical|thoracic|core|pelvic|coccy/i.test(name)) && !S.sideManual && !S.sideAuto) setSide("", true);
    // a side in the name sets the side, unless the physio has already pressed a side button
    { const sd = sideForCondition(name); if (sd && !S.sideManual && sd !== S.side && !MIDLINE.has(S.region)) { setSide(sd, true); S.sideFromCond = true; } }
    S.showAll = false;
    renderBuilder(); prefillTests(); applyPack(); renderOutput(); renderCondTag(); renderSuggest();
  }
  // The usual special tests for this region appear in Objective with the result blank.
  // The physio deletes the ones not done and marks the rest + or -. A result read from
  // the notes replaces the blank line for that test (see autoFill).
  const testName = (line) => line.replace(/\s*(Rt\.|Lt\.|Both)?\s*:\s*(\+ve|-ve|___ve)?\s*$/, "").trim();
  // scoliosis, ACL, frozen shoulder…: the lines a BPC new-patient record carries for them.
  // Two sources, merged: the hand-written routine (V.CONDITION_PACKS) for conditions whose
  // charts are mostly prose, and the measurement templates read straight from this
  // condition's own charts (suggest.js "p" — numbers blanked, only lines repeated
  // across 3+ charts). Both can fire together; lines already in the box are skipped.
  // Vertebral levels ("L___-L___", "C5-C6") are the one region clue DETECT.regionsOf cannot
  // see (it reads body words and muscle names), so the guard below checks them too.
  const LEVEL_REGION = [[/\bc\s?(?:___|\d)/i, "Neck / cervical"], [/\bt\s?(?:___|\d{1,2})\b/i, "Thoracic spine"], [/\bl\s?(?:___|\d)|\bs\s?(?:___|[12])\b/i, "Trunk / lumbar"]];
  function packLineFitsRegion(line) {
    if (wholeBodyLine(line)) return false;
    if (S.region === "General / other") return true;   // export already keeps region-free lines only in "p"
    const regs = DETECT.regionsOf ? DETECT.regionsOf(line) : new Set();
    LEVEL_REGION.forEach(([re, r]) => { if (re.test(line.replace(SIDE_TOKEN, " "))) regs.add(r); });
    // the physios' own misspellings and loose wording in chart lines ("Hamtring", "back rotation", "lateral back flexion")
    if (/ham\w{0,2}tr\w*|quadr?i?cep|\bcalf\b|gastroc/i.test(line)) { regs.add("Knee"); regs.add("Hip"); regs.add("Ankle & foot"); }
    if (/\b(?:lateral |low(?:er)? )?back (?:flexion|extension|rotation|bending)\b|\blumba\w*/i.test(line)) regs.add("Trunk / lumbar");
    if (/\bneck\b|\bcervi\w*/i.test(line)) regs.add("Neck / cervical");
    if (/\bshoulder|\bscapul\w*/i.test(line)) regs.add("Shoulder");
    return !regs.size || regs.has(S.region);
  }
  // chart lines often end mid-thought where the physio's own numbers followed ("…7 min/point,"): trim the
  // dangling punctuation so the box does not show a line that reads as if something were missing
  // "E:Tension release after treatment" — the physios' SOAP shorthand at the head of a chart line is noise
  // in a box that is already labelled (owner, 2026-09-23). Single letter + colon only, so "Rt.:" is untouched.
  const packSide = (line) => noBlanks(withSide(String(line).replace(/^\s*[A-Za-z]\s*:\s*/, ""))).replace(/[\s,;:+\-–—/]+$/, (m) => (/:/.test(m) ? ":" : ""));
  function applyPack() {
    // A condition's usual lines (what is normally observed, palpated, measured, tested) go into
    // the boxes so the physio sees the routine — but never with a ___ blank (owner, 2026-09-16:
    // "Knee flexion:" and the physio fills it in, or says it). Region-aware, re-applied whenever
    // the condition, region or side changes; lines it added before that no longer belong are
    // taken back out (only while still untouched). The same lines are also offered as chips.
    const prev = S.packLines || {};
    const wanted = {};   // everything the condition normally brings, into the boxes (owner, 2026-09-16:
                         // "whenever I put in a condition, everything would come up" — the hand-written
                         // routine AND the lines read from this condition's own charts, minus blanks)
    const chips = {};
    // Draft 36 (owner + physio, 2026-09-21: "when did we ever mention a dynamometer?", "able to do — what does that
    // mean?"): the condition's usual lines are the starting point when the physio begins from a condition. Once
    // Claude has written the note from the session notes, the note holds what was said; the usual lines step back
    // (they are still one tap away under each box) and return if the notes are cleared.
    const notesOwnTheNote = !!S.aiFor || !!S.photoRead;
    // vetted = the export (or the hand-written pack) already filed these lines under this exact
    // region; the guard is for the region-free lines only ("above knee level" is a lumbar
    // fingertip measure, and the body-word guard would misread it as a knee line)
    const add = (heading, lines, vetted, fromCharts) => {
      const sec = heading === "Exercise" ? "exercise" : "objective";
      const t = target(sec, heading); if (!t || !t[0]) return;
      lines.forEach((raw) => {
        const line = packSide(raw); if (!line) return;
        if (fromCharts && !usableStub(line)) return;   // "LSI >", "Gr": nothing left once the numbers are gone
        // whatever region the export filed it under, a line naming the whole body is not this patient's
        if (wholeBodyLine(line)) return;
        if (!vetted && !packLineFitsRegion(withSide(raw))) return;
        if ((wanted[t[0]] || []).some((w) => sameLine(w.line, line))) return;
        (wanted[t[0]] = wanted[t[0]] || []).push({ line, heading: t[1] || "" });
      });
    };
    if (S.condition && !notesOwnTheNote) {
      const handKey = V.CONDITION_PACKS ? Object.keys(V.CONDITION_PACKS).find((re) => new RegExp(re, "i").test(S.condition)) : null;
      const hit = SG ? findCondition(currentCondition()) : null;
      // No region chosen ("General / other" — MPS, muscle imbalance, poor posture…): the region
      // gate is fully open and the condition brings everything its charts carry, every region
      // (owner, 2026-09-16: "put in MPS and everything comes up"). Once a region is set, only
      // that region's lines — that is the actual fix for knee lines in a neck patient's note.
      const general = S.region === "General / other";
      const wantRegion = (r) => general || r === S.region;
      if (handKey) Object.entries(V.CONDITION_PACKS[handKey]).forEach(([k, v]) => {
        // hand-written packs are curated for their condition (scoliosis reads the whole body:
        // head tilt, shoulder level, heels): never region-filtered
        if (k.startsWith("@")) { if (wantRegion(k.slice(1))) Object.entries(v).forEach(([h, lines]) => add(h, lines, true, false)); }
        else add(k, v, true, false);
      });
      if (hit && hit[1].p) Object.entries(hit[1].p).forEach(([h, lines]) => add(h, lines, false, true));
      if (hit && hit[1].pr) Object.entries(hit[1].pr).forEach(([r, hs]) => { if (wantRegion(r)) Object.entries(hs).forEach(([h, lines]) => add(h, lines, true, true)); });
      // A section the packs left empty still gets what this condition's charts most often say
      // there (the same lines the tap-to-add rows offer), so no condition comes up bare.
      if (hit && hit[1].s) {
        ["Observation", "Palpation", "Active range of motions", "Passive range of motions", "Muscle power", "PAIVMS", "Functional test", "Special test", "Neurological examination", "Treatment"].forEach((label) => {
          const t = target(label === "Treatment" ? "treatment" : "objective", label); if (!t || !t[0]) return;
          const already = (wanted[t[0]] || []).some((w) => !t[1] || w.heading === t[1]);
          if (already) return;
          // These are raw chart lines, and unlike the "p" pack their numbers were never blanked — so a grade,
          // a degree or a centimetre in one is ANOTHER PATIENT'S measurement ("Knee flexion grade 5").
          // Never put one in an assessment box. Treatment keeps its numbers: those are the clinic's own usual
          // parameters, which the owner decided on 2026-09-06.
          const lines = (hit[1].s[label] || []).map(([line]) => packSide(String(line).replace(/^\s*\d+[.)]\s*/, "")))
            .filter((l) => usableStub(l) && !offRegion(l) && !/^dx:?\s/i.test(l) && (label === "Treatment" || !/\d/.test(l))).slice(0, 3);
          lines.forEach((line) => { if (!(wanted[t[0]] || []).some((w) => sameLine(w.line, line))) (wanted[t[0]] = wanted[t[0]] || []).push({ line, heading: t[1] || "" }); });
        });
      }
    }
    const key = (x) => x.heading + "" + x.line;
    new Set([...Object.keys(prev), ...Object.keys(wanted)]).forEach((field) => {
      const before = prev[field] || [], next = wanted[field] || [];
      const nextKeys = new Set(next.map(key)), beforeKeys = new Set(before.map(key));
      before.filter((p) => !nextKeys.has(key(p))).forEach((p) => removeLine(field, p.line));
      // exact match only: "Anterior view: head tilt" and "Anterior view: ASIS level" share a label
      next.filter((w) => !beforeKeys.has(key(w))).forEach((w) => { if (!hasLine(field, w.line)) append(field, w.line, w.heading, true); });
    });
    S.packLines = wanted; S.packChips = chips;
    renderOutput(); renderSuggest();
  }
  // The region's usual special tests are pre-listed as "Name:" (no blank) so the physio sees
  // what is normally checked; a result said in the notes fills the line, an unused one is deleted.
  function prefillTests() {
    const general = S.region === "General / other";
    const P = V.REGION_PROFILE[S.region]; if (!P && !general) return;
    const t = target("objective", "Special test"); if (!t || !t[0]) return;
    const field = t[0], heading = t[1] || "";
    const hit = S.condition && SG ? findCondition(currentCondition()) : null;
    const known = new Set(V.SPECIAL_TESTS);
    // the tests physios record for this condition go first; the rest of the region's usual tests follow.
    // With no region chosen, the condition's own recorded tests are listed on their own.
    const fix = (n) => (S.region === "Ankle & foot" && n === "Anterior drawer (knee)" ? "Anterior drawer (ankle)" : n);
    const condTests = hit && hit[1].t ? hit[1].t.map(fix).filter((n) => known.has(n) && (general || P.tests.includes(n))) : [];
    if (general && !condTests.length) return;
    const testList = general ? condTests : [...condTests, ...P.tests.filter((n) => !condTests.includes(n))];
    // the region has just become known (or changed): tests this function listed earlier that are still
    // empty and do not belong to this region come back out — "Thomas test:" has no place in a neck note
    if (S.prefilled && S.prefilled.size) {
      const keep = new Set(testList);
      val(field).split("\n").forEach((l) => { const tl = l.trim(), n = testName(tl); if (BLANK_TEST.test(tl) && S.prefilled.has(n) && !keep.has(n)) { removeLine(field, tl); S.prefilled.delete(n); } });
    }
    // any line already written for a test counts, whatever follows the colon ("SLR: no numbness down the leg")
    const have = new Set(val(field).split("\n").map((l) => l.trim()).filter((l) => /:/.test(l)).map((l) => testName(l.slice(0, l.indexOf(":") + 1))));
    S.prefilled = S.prefilled || new Set();
    testList.forEach((name) => { if (have.has(name)) return; append(field, `${name}${S.side && S.side !== "Both" ? " " + S.side : ""}:`, heading, true); S.prefilled.add(name); });
    renderOutput();
  }
  const BLANK_TEST = /:\s*(?:___ve)?\s*$/;   // a pre-listed test with no result yet
  function removeBlankTest(field, line) {
    const name = testName(line);
    val(field).split("\n").forEach((l) => { if (testName(l.trim()) === name && BLANK_TEST.test(l) && l.trim() !== line.trim()) removeLine(field, l.trim()); });
  }
  function clearPrefilledTests() {
    if (!S.prefilled) return;
    V.OUTPUT_FORMATS[S.format].forEach((field) => val(field).split("\n").forEach((l) => { if (BLANK_TEST.test(l) && S.prefilled.has(testName(l.trim()))) removeLine(field, l.trim()); }));
    S.prefilled = new Set();
  }
  const MIDLINE = new Set(["Neck / cervical", "Thoracic spine", "Trunk / lumbar", "General / other"]);
  function clearCondition() {
    if (S.condition) removeLine(dxField(), S.condition);
    (S.moreConditions || []).forEach((c) => removeLine(dxField(), c)); S.moreConditions = [];
    S.condition = ""; S.conditionAuto = false;
    // the region and side that the condition's own name had set go with it ("Left PFPS" cleared, then "MPS":
    // MPS must not inherit Knee / Lt.). A region or side the physio chose, or one heard in the notes, stays.
    if (S.sideFromCond && !S.sideManual) { S.sideFromCond = false; setSide("", true); }
    if (S.regionFromCond && !S.regionManual) { S.regionFromCond = false; S.region = "General / other"; $("region").value = S.region; renderBuilder(); }
    clearPrefilledTests(); applyPack();   // no condition -> its pack lines go too
    renderCondTag(); renderOutput(); renderSuggest();
  }
  function renderCondTag() {
    const host = $("dxsel"); host.innerHTML = "";
    if (!S.condition) { host.hidden = true; $("dxq").placeholder = "Type what you found — plantar, MPS, ACL, frozen shoulder…"; return; }
    host.hidden = false; $("dxq").placeholder = "Add another condition…";
    const tag = document.createElement("span"); tag.className = "tag";
    tag.innerHTML = `<span>${escapeHtml([...(S.moreConditions || []), S.condition].join(" + "))}</span><small>${escapeHtml(S.region)}${S.side ? " · " + escapeHtml(S.side) : " · no side"}${S.conditionGuess ? " · closest match in the charts" : ""}</small>`;
    const x = document.createElement("button"); x.type = "button"; x.title = "Remove this condition"; x.textContent = "×"; x.onclick = clearCondition;
    tag.appendChild(x); host.appendChild(tag);
  }
  function setSide(s, quiet) {
    S.side = s; $("sides").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.s === s));
    // blank prefilled tests take the new side
    const t = target("objective", "Special test");
    if (t && t[0] && S.prefilled && S.prefilled.size) {
      const lines = val(t[0]).split("\n"); let changed = false;
      const next = lines.map((l) => { const tl = l.trim(); if (!BLANK_TEST.test(tl) || !S.prefilled.has(testName(tl))) return l; const nl = `${testName(tl)}${s && s !== "Both" ? " " + s : ""}:`; if (nl !== tl) changed = true; return l.replace(tl, nl); });
      if (changed) { S.fields[t[0]] = next.join("\n"); updateTa(t[0]); renderOutput(); }
    }
    if (S.packLines) applyPack();   // pack lines carry the side too
    if (!quiet) renderSuggest();
  }

  // ---------- what BPC physios usually write for this condition ----------
  // suggest.js (built from the clinic's own charts; only phrases that recur
  // across many charts) maps a diagnosis to the most common lines per box.
  // Side words were stripped out of every line: the physio picks Rt./Lt./Both.
  const SG = window.SUGGEST || null;
  const SIDE_TOKEN = (SG && SG.side) || "⟨side⟩";
  function withSide(line) {
    if (!line.includes(SIDE_TOKEN)) return line;
    let s = S.side ? line.split(SIDE_TOKEN).join(S.side) : line.split(SIDE_TOKEN).join("");
    // "to ⟨side⟩/⟨side⟩ ;" with no side chosen leaves "to /;" — drop the orphaned slash too
    return s.replace(/\(\s*\)/g, "").replace(/\s*\/\s*(?=[\s,;:.)]|$)/g, "").replace(/\s+/g, " ").replace(/\s+([,.;:)])/g, "$1").replace(/\(\s+/g, "(").trim();
  }
  // Lines that already exist as standard options below the box are not repeated as suggestions.
  // a line about another part of the body has no place in this note (a neck case does not get the hamstrings)
  // A chart line that lists four or more body parts is a whole-body session, not a finding about this
  // patient: "Hot pack: คอ บ่า หลัง น่อง ไหล่ 2 ข้าง", "Release muscle (neck shoulder chest back hip thigh
  // and calf)". Those came from charts where the physio treated everything, and the region guard let them
  // through because one of the parts they name happens to be the region in play (owner, 2026-09-23:
  // "how the **** has that got to do with MPS at the upper trapezius?").
  const BODY_PARTS = [
    /\bneck\b|คอ/i, /\b(shoulder|scapula\w*|trapezius)\b|ไหล่|บ่า|สะบัก/i, /\bchest\b|หน้าอก/i,
    /\b(back|lumbar|thoracic|spine)\b|หลัง|เอว/i, /\b(hip|glute\w*|buttock)\b|สะโพก|ก้น/i,
    /\b(thigh|quadriceps|hamstring)\b|ต้นขา/i, /\bcalf\b|น่อง/i, /\bknee\b|เข่า/i,
    /\b(ankle|foot|feet|heel)\b|ข้อเท้า|เท้า|ส้นเท้า/i, /\b(arm|elbow)\b|แขน|ศอก/i,
    /\b(wrist|hand|finger)\b|ข้อมือ|นิ้ว/i, /\bhead\b|ศีรษะ/i,
  ];
  const bodyPartCount = (t) => BODY_PARTS.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);
  // the same line twice in the clinic's own charts, once with a typo ("After treatment no complication" /
  // "after treat ment no complication"): compare with the spaces and punctuation taken out
  const sameLine = (a, b) => String(a).toLowerCase().replace(/[^a-z0-9ก-๙]/g, "") === String(b).toLowerCase().replace(/[^a-z0-9ก-๙]/g, "");
  const wholeBodyLine = (t) => !isGeneral() && bodyPartCount(t) >= 4;
  function offRegion(text) {
    if (isGeneral() || !DETECT.regionsOf) return false;
    if (wholeBodyLine(text)) return true;
    const regs = DETECT.regionsOf(text); if (!regs.size) return false;
    if (regs.has(S.region)) return false;
    const NEAR = { "Neck / cervical": ["Shoulder", "Thoracic spine"], "Shoulder": ["Neck / cervical", "Thoracic spine"], "Thoracic spine": ["Neck / cervical", "Shoulder", "Trunk / lumbar"], "Trunk / lumbar": ["Hip", "Thoracic spine"], "Hip": ["Trunk / lumbar", "Knee"], "Knee": ["Hip", "Ankle & foot"], "Ankle & foot": ["Knee"], "Elbow, wrist & hand": ["Shoulder"] };
    return ![...regs].some((r) => (NEAR[S.region] || []).includes(r));
  }
  const VOCAB_TERMS = new Set([...V.OBSERVATION, ...V.PALPATION_FINDINGS, ...(V.PALPATION_NORMALS || []), ...V.STRENGTH, ...V.FUNCTIONAL,
    ...V.SPECIAL_TESTS, ...V.PLAN_GOALS, ...V.POSITIONS, ...(V.POST_TREATMENT || []), ...(V.SUBJECTIVE_PHRASES || []), ...V.SESSION_LENGTHS,
    ...Object.keys(V.TREATMENT_MODALITIES), ...Object.values(V.DIAGNOSES).flat(), ...V.ROM_QUALIFIERS].map((t) => t.toLowerCase()));
  const EQUIV = { "Subjective": ["Subjective", "Chief Complaint", "Chief complaint"], "Chief Complaint": ["Chief Complaint", "Chief complaint", "Subjective"], "Chief complaint": ["Chief complaint", "Chief Complaint", "Subjective"],
    "Objective": ["Objective", "Physical Examinations"], "Physical Examinations": ["Physical Examinations", "Objective"],
    "Analysis": ["Analysis", "Diagnosis"], "Diagnosis": ["Diagnosis", "Analysis"], "Plan": ["Plan", "Recommendation"], "Recommendation": ["Recommendation", "Plan"],
    "Treatment": ["Treatment", "Physiotherapy Treatments"], "Physiotherapy Treatments": ["Physiotherapy Treatments", "Treatment"] };
  const dxNorm = (t) => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean)[0] ? String(t).split("\n").map((x) => x.trim()).filter(Boolean)[0].toLowerCase()
    .replace(/\b(dx\.?|diagnosis|impression|rt\.?|lt\.?|right|left|both|bilateral|side)\b/g, " ").replace(/[^a-z0-9฀-๿ ()\/+-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70) : "";
  function currentCondition() {
    const f = S.format === "SOAP with treatment" ? "Analysis" : "Diagnosis";
    return dxNorm(S.condition || val(f) || "");
  }
  function findCondition(q) {
    if (!SG || !q) return null;
    const direct = SG_NAME[String(q).toLowerCase()]; if (direct && SG.conditions[direct]) return [direct, SG.conditions[direct]];
    // try the name as typed, without its bracket, and the bracket's own contents ("(MPS)")
    const forms = [q, q.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim()];
    const inside = q.match(/\(([^)]+)\)/); if (inside) forms.push(inside[1].trim());
    const AL = SG.aliases || {}; forms.slice().forEach((f) => { if (AL[f]) forms.push(AL[f]); });
    let best = null;
    const consider = (k, v) => { if (!best || v.n > best[1].n) best = [k, v]; };
    forms.filter(Boolean).forEach((f) => { if (SG.conditions[f]) consider(f, SG.conditions[f]); });
    if (best) return best;
    Object.entries(SG.conditions).forEach(([k, v]) => {
      forms.forEach((f) => {
        if (!f) return;
        if (k.includes(f) || f.includes(k) || (f.length > 8 && k.split(" ").filter((w) => w.length > 3).every((w) => f.includes(w)))) consider(k, v);
      });
    });
    return best;
  }
  function renderSuggest() {
    const q = currentCondition(); const hit = q && SG ? findCondition(q) : null;
    document.querySelectorAll(".sugg").forEach((box) => {
      box.innerHTML = ""; const field = box.dataset.for;
      // the condition's own measurement templates first (applyPack, region-gated), then the
      // lines physios most often wrote for it
      const packed = ((S.packChips || {})[field] || []).map((x) => ({ t: x.line, heading: x.heading }));
      let lines = [];
      if (hit) { const labels = EQUIV[field] || [field]; for (const l of labels) { if (hit[1].s[l] && hit[1].s[l].length) { lines = hit[1].s[l]; break; } } }
      const cands = [...packed, ...lines.map(([line]) => ({ t: noBlanks(withSide(line)), heading: "" }))].filter((c) => usableStub(c.t));
      if (!cands.length) return;
      const seen = new Set();
      const shown = cands.filter(({ t }) => {
        const k = t.toLowerCase(); if (!t || seen.has(k) || hasLine(field, t)) return false;
        if (S.condition && k === S.condition.toLowerCase()) return false;
        if (hit && (field === "Analysis" || field === "Diagnosis")) { const same = findCondition(t.toLowerCase()); if (same && same[0] === hit[0]) return false; }   // the condition itself under another spelling
        if (/^dx:?\s/i.test(t)) return false;
        if (offRegion(t)) return false;
        seen.add(k); return true;
      }).slice(0, 12 + packed.length);
      if (!shown.length) return;
      const p = document.createElement("p"); p.className = "sub";
      p.textContent = (hit ? `For ${hit[0]} (${hit[1].n} BPC charts) — tap to add` : `For ${S.condition} — tap to add`) + (S.side ? `, side ${S.side}` : "");
      box.appendChild(p);
      const wrap = document.createElement("div"); wrap.className = "chips";
      shown.forEach(({ t, heading }) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip sg"; b.textContent = t; b.onclick = () => { append(field, t, heading || ""); renderSuggest(); }; wrap.appendChild(b); });
      box.appendChild(wrap);
    });
  }
  let sgT; const scheduleSuggest = () => { clearTimeout(sgT); sgT = setTimeout(renderSuggest, 250); };

  // ---------- builder ----------
  // Everything below the boxes follows the region: knee tests for a knee, no neck traction for an ankle.
  const profile = () => (S.showAll ? V.REGION_PROFILE["General / other"] : (V.REGION_PROFILE[S.region] || V.REGION_PROFILE["General / other"]));
  const isGeneral = () => S.showAll || !V.REGION_PROFILE[S.region] || S.region === "General / other";
  function showAllLink(host) {
    if (isGeneral() && !S.showAll) return;
    const a = document.createElement("button"); a.type = "button"; a.className = "chip"; a.style.borderStyle = "dotted";
    a.textContent = S.showAll ? `Back to ${S.region} only` : `Show all regions`;
    a.onclick = () => { S.showAll = !S.showAll; renderBuilder(); };
    host.appendChild(a);
  }
  // Palpation: the finding first, then every muscle of the region to tap ("Trigger point" — but where?).
  // Used by the SOAP note and, since draft 36, by the New patient's record too (physio feedback 2026-09-21:
  // "you just click on trigger point but where? … the muscles are there for muscle power, they should be here as well")
  function palpationPicker(b, field, heading) {
    const P = profile();
    const groups = P.muscle_groups.filter((g) => V.MUSCLES[g]);
    let finding = V.PALPATION_FINDINGS[1] || V.PALPATION_FINDINGS[0], side = S.side || "";
    const findRow = document.createElement("div"); findRow.className = "chips";
    const musWrap = document.createElement("div");
    const palpLineX = (f, m, s) => (V.MUSCLES["Ligaments & structures"] || []).includes(m) ? `${f} at ${s ? s + " " : ""}${m}` : palpLine(f, m, s);
    const redraw = () => {
      musWrap.innerHTML = ""; musWrap.appendChild(sub(`${finding}${side ? " · " + side : ""} — at which muscle?`));
      groups.forEach((g) => { if (groups.length > 1) musWrap.appendChild(sub(g)); musWrap.appendChild(chips(V.MUSCLES[g], field, heading, (m) => palpLineX(finding, m, side))); });
    };
    V.PALPATION_FINDINGS.forEach((f) => { const fb = document.createElement("button"); fb.type = "button"; fb.className = "chip sel" + (f === finding ? " on" : ""); fb.textContent = f; fb.onclick = () => { finding = f; findRow.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === fb)); redraw(); }; findRow.appendChild(fb); });
    const sideRow = document.createElement("div"); sideRow.className = "row3";
    const sideSel = selectEl(["", ...V.SIDES], (e) => { side = e.target.value; redraw(); }); sideSel.value = side; sideRow.appendChild(sideSel);
    b.appendChild(findRow); b.appendChild(sideRow); b.appendChild(musWrap); redraw();
    if (V.PALPATION_NORMALS) { b.appendChild(sub("Nothing found")); b.appendChild(chips(V.PALPATION_NORMALS, field, heading)); }
    const circ = document.createElement("button"); circ.type = "button"; circ.className = "chip"; circ.textContent = "+ Circumference line";
    circ.onclick = () => append(field, circLine(), heading); b.appendChild(circ);
  }
  function objectiveExtras(host, field) {
    const region = S.region, P = profile();
    let [d, b] = details("Observation");
    observationPicker(b, field, "Observation", [...P.observation, ...(V.OBSERVATION_BY_REGION[region] || [])]); showAllLink(b); host.appendChild(d);

    [d, b] = details(isGeneral() ? "Palpation — pick the finding, then the muscle" : `Palpation — pick the finding, then the muscle (${S.region.toLowerCase()})`);
    palpationPicker(b, field, "Palpation");
    host.appendChild(d);

    [d, b] = details("Range of motion");
    const moves = V.ROM_BY_REGION[region] || V.ROM_GENERAL;
    const r2 = document.createElement("div"); r2.className = "row2";
    const c1 = document.createElement("div"); c1.appendChild(sub("Active")); romPicker(c1, field, "Active range of motions", moves);
    const c2 = document.createElement("div"); c2.appendChild(sub("Passive")); romPicker(c2, field, "Passive range of motions", moves);
    r2.appendChild(c1); r2.appendChild(c2); b.appendChild(r2);
    if (V.ACCESSORY_BY_REGION[region]) { b.appendChild(sub("Accessory movement")); b.appendChild(chips(V.ACCESSORY_BY_REGION[region], field, "Accessory movement")); }
    host.appendChild(d);

    [d, b] = details("Muscle power & function");
    musclePowerPicker(b, field, "Muscle power");
    b.appendChild(sub("Dynamometer force")); b.appendChild(chips(moves, field, "Muscle power", forceLine));
    b.appendChild(sub("Functional tests")); b.appendChild(chips([...new Set([...P.functional, ...(V.FUNCTIONAL_BY_REGION[region] || [])])], field, "Functional test"));
    if (P.functional.includes("Overhead squat") || isGeneral()) { b.appendChild(sub("Overhead squat")); b.appendChild(chips(V.OVERHEAD_SQUAT, field, "Functional test")); }
    if (P.neuro) b.appendChild(chips(V.PAIVMS, field, "PAIVMS"));
    host.appendChild(d);

    [d, b] = details(P.neuro ? "Special tests & neurological" : "Special tests", true);
    const testChips = chips(P.tests, field, "Special test", (n) => `${n}${S.side && S.side !== "Both" ? " " + S.side : ""}:`);
    b.appendChild(testChips);
    if (P.neuro) { b.appendChild(chips(V.NEURO_PHRASES, field, "Neurological examination")); b.appendChild(chips(V.MYOTOMES, field, "Myotome")); }
    showAllLink(b);
    host.appendChild(d);

    [d, b] = details("Pain score");
    const vas = document.createElement("button"); vas.type = "button"; vas.className = "chip"; vas.textContent = "+ VAS /10";
    vas.onclick = () => append(field, vasLine(), ""); b.appendChild(vas); host.appendChild(d);
  }

  // ---------- what BPC physios usually write for a modality ----------
  // suggest.js carries, per condition, the most common MHz / w/cm2 / V / mins /
  // kg / Hz and area written in the Treatment box for each modality, plus the
  // clinic-wide norm. A modality line is filled from the condition first, then
  // from every condition of the same region, then from the clinic as a whole.
  const REGION_USUAL = {};
  function regionUsual(region) {
    if (!SG || REGION_USUAL[region]) return REGION_USUAL[region] || {};
    const acc = {};
    Object.entries(SG.conditions).forEach(([k, v]) => {
      if (!v.m || regionForCondition(dxDisplay(k)) !== region) return;
      Object.entries(v.m).forEach(([mod, fields]) => {
        if (mod === "position") { const p = acc.position = acc.position || {}; p[fields] = (p[fields] || 0) + v.n; return; }
        const slot = acc[mod] = acc[mod] || {};
        Object.entries(fields).forEach(([f, val]) => { const c = slot[f] = slot[f] || {}; c[val] = (c[val] || 0) + v.n; });
      });
    });
    const out = {};
    Object.entries(acc).forEach(([mod, fields]) => {
      if (mod === "position") { out.position = Object.entries(fields).sort((x, y) => y[1] - x[1])[0][0]; return; }
      out[mod] = {}; Object.entries(fields).forEach(([f, counts]) => { out[mod][f] = Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0]; });
    });
    return (REGION_USUAL[region] = out);
  }
  function usualFor(modality) {
    if (!SG) return {};
    const hit = S.condition ? findCondition(currentCondition()) : null;
    const ownRegion = hit ? condRegion(hit[0]) : "";
    const sameRegion = hit && (isGeneral() || ownRegion === S.region);
    const own = hit && hit[1].m && sameRegion ? hit[1].m : {};
    const reg = isGeneral() ? {} : regionUsual(S.region);
    const all = isGeneral() ? (SG.usual || {}) : {};   // clinic-wide areas belong to other regions; numbers below
    const nums = SG.usual || {};
    const pickArea = (src) => (src && src[modality] && src[modality].area && !offRegion(src[modality].area) ? src[modality].area : "");
    const f = Object.assign({}, all[modality] || {}, reg[modality] || {}, own[modality] || {});
    f.area = pickArea(own) || pickArea(reg) || pickArea(all) || "";
    ["mhz", "w", "v", "min", "hz", "kg", "j", "grade"].forEach((k) => { if (!f[k] && nums[modality] && nums[modality][k]) f[k] = nums[modality][k]; });
    f.position = own.position || reg.position || (SG.usual && SG.usual.position) || "";
    return f;
  }
  const POSITION_NAME = { supine: "Supine lying", prone: "Prone lying", "side lying": "Side lying", sitting: "Sitting", standing: "Standing", "half lying": "Half lying", "long sitting": "Long sitting" };
  // fill the ___ slots of a modality template with the usual values; slots with no data stay ___
  function fillUsual(line, modality) {
    const u = usualFor(modality); if (!u || !Object.keys(u).length) return line;
    let o = line;
    const put = (re, val, fmt) => { if (val && re.test(o) && /___/.test(o.match(re)[0])) o = o.replace(re, (m) => m.replace("___", fmt ? fmt(val) : val)); };
    put(/___ MHz/, u.mhz); put(/___ w\/cm2/, u.w); put(/Stim ___ V|___ V\b/, u.v); put(/___ Hz/, u.hz); put(/___ kg/, u.kg); put(/___ J\/cm2/, u.j);
    put(/___ mins? per point|___ mins?\b|___ min\b/, u.min);
    put(/grade ___/, u.grade);
    const area = u.area ? withSide(u.area) : "";
    if (area) { o = o.replace(/Area: ___/, "Area: " + area).replace(/\bon ___/, "on " + area).replace(/^(Massage|Stretching|Passive stretch|Stretching exercise|Cupping|Taping): ___/, "$1: " + area).replace(/\bat ___/, "at " + area); }
    if (u.position && /Position: ___/.test(o)) o = o.replace("Position: ___", "Position: " + (POSITION_NAME[u.position] || u.position));
    return o;
  }
  const modalityLine = (name) => fillUsual(V.TREATMENT_MODALITIES[name], name);
  // a line the detector wrote from the notes keeps every number it heard; only the blanks left are filled
  function sessionMuscles(res) {
    const out = []; const take = (l) => { const m = /^\s*(?:Tightness|Tenderness|Trigger point) at (.+?)(?: m\.)?\s*$/.exec(l); if (m && !out.includes(m[1])) out.push(m[1]); };
    if (res && res.lines) res.lines.filter((l) => l.heading === "Palpation").forEach((l) => take(l.line));   // the notes being read right now
    const t = target("objective", "Palpation"); if (t && t[0]) val(t[0]).split("\n").forEach(take);
    return out;
  }
  function fillTreatmentBlanks(line, res) {
    if (!/___/.test(line)) return line;
    for (const [name, tpl] of Object.entries(V.TREATMENT_MODALITIES)) {
      const head = tpl.split(/  |: /)[0];
      if (!line.startsWith(head)) continue;
      // massage and stretching go to the muscles this session found tight or tender, before the clinic's usual
      let o = line;
      if (/^(Massage|Stretching|Passive stretch|Stretching exercise): ___/.test(o)) { const ms = sessionMuscles(res).slice(0, 3).join(", "); if (ms) o = o.replace(/^(Massage|Stretching|Passive stretch|Stretching exercise): ___/, "$1: " + ms); }
      o = fillUsual(o, name);
      // still no area: the muscles this very session found tight or tender are where the hands went
      if (/(Stretching|Massage|Passive stretch|Stretching exercise): ___|Hot pack \(large \/ small\) on ___|Cold pack on ___|Area: ___/.test(o)) {
        const ms = sessionMuscles(res).slice(0, 3).join(", ");
        if (ms) o = o.replace(/^(Stretching|Massage|Passive stretch|Stretching exercise): ___/, "$1: " + ms).replace(/\bon ___/, "on " + ms).replace(/Area: ___/, "Area: " + ms);
      }
      return o;
    }
    return line;
  }
  function treatmentExtras(host, field) {
    const P = profile();
    let [d, b] = details(isGeneral() ? "Modality — only what BPC has" : `Modality — for the ${S.region.toLowerCase()}`, true);
    const names = P.modalities.filter((n) => V.TREATMENT_MODALITIES[n]);
    b.appendChild(chips(names, field, "", (n) => modalityLine(n)));
    if (SG) { const p = document.createElement("p"); p.className = "sub"; p.textContent = S.condition ? `Filled with what BPC physios usually write for ${S.condition} — change anything that differed today.` : "Numbers and areas are the clinic's usual for this region — change anything that differed today."; b.appendChild(p); }
    showAllLink(b); host.appendChild(d);

    [d, b] = details(isGeneral() ? "Exercise" : `Exercise — ${S.region.toLowerCase()}`, !isGeneral());
    const exGroups = P.exercise_groups.filter((g) => V.EXERCISES[g]);
    // the group that fits the condition opens first: an ACL tear opens the ligament rehab list, not the neck
    const wantGroup = !S.condition ? "" : /\b(acl|pcl|mcl|lcl|aclr)\b|ligament|meniscus|meniscal|reconstruction|post.?op|arthroscop/i.test(S.condition) ? "Knee — ACL & ligament rehab" : /scoliosis|kyphos|posture|postural/i.test(S.condition) ? "Scoliosis — Schroth & posture" : "";
    const condHit = S.condition && SG ? findCondition(currentCondition()) : null;
    const usualDose = condHit && condHit[1].m && condHit[1].m.dose ? condHit[1].m.dose : "";
    const doses = usualDose && !V.EX_DOSAGE.includes(usualDose) ? [usualDose, ...V.EX_DOSAGE] : V.EX_DOSAGE;
    let group = exGroups.includes(wantGroup) ? wantGroup : exGroups[0], dose = usualDose || V.EX_DOSAGE[0];
    const row = document.createElement("div"); row.className = "row2";
    const exWrap = document.createElement("div");
    const redraw = () => { exWrap.innerHTML = ""; exWrap.appendChild(chips(V.EXERCISES[group], field, "Exercise", (e) => exLine(e, dose))); };
    const groupSel = selectEl(exGroups, (e) => { group = e.target.value; redraw(); }); groupSel.value = group; row.appendChild(groupSel);
    const doseSel = selectEl(doses, (e) => { dose = e.target.value; redraw(); }); doseSel.value = dose; row.appendChild(doseSel);
    b.appendChild(row); b.appendChild(exWrap); redraw(); host.appendChild(d);

    [d, b] = details("Session & position");
    b.appendChild(chips(V.SESSION_LENGTHS, field, "")); b.appendChild(chips(V.POSITIONS, field, "")); host.appendChild(d);
    if (V.POST_TREATMENT) { [d, b] = details("After treatment"); b.appendChild(chips(V.POST_TREATMENT, field, "")); host.appendChild(d); }
  }

  // ---------- jump bar ----------
  // A physio on a phone was scrolling the whole page to reach Palpation or Treatment (videos, 2026-09-21).
  // One row of chips, sticky at the top: tap one and the page goes to that box. A chip is marked when its
  // box has something in it, so what is still empty is visible without scrolling at all.
  const SHORT_NAME = { "Chief complaint": "Complaint", "Chief Complaint": "Complaint", "Active range of motions": "Active ROM",
    "Passive range of motions": "Passive ROM", "Neurological examination": "Neuro", "Physical examinations": "Findings",
    "Physical Examinations": "Findings", "Physiotherapy Treatments": "Treatment", "Physician's recommendations": "Plan",
    "Functional limitation": "Limitation", "Present history": "Present hx", "Past history": "Past hx" };
  function jumpTo(el) {
    if (!el) return;
    for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === "DETAILS" && !p.open) p.open = true;
    // plain, instant scroll: "smooth" is silently ignored by some browsers (measured 2026-09-22) and a
    // tap that appears to do nothing is worse than a jump
    el.scrollIntoView({ block: "start" });
  }
  function renderJump() {
    const host = $("jump"); if (!host) return;
    const boxes = [...document.querySelectorAll("#builder .fld[data-jump]")];
    host.hidden = !boxes.length; host.innerHTML = "";
    if (!boxes.length) return;
    const add = (label, go) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = () => jumpTo(go()); host.appendChild(b); return b; };
    add("↑ Notes", () => $("trbox"));
    // look the box up when it is tapped, never hold the element: renderBuilder replaces these nodes
    boxes.forEach((box) => {
      const name = box.dataset.jump;
      const b = add(SHORT_NAME[name] || name, () => document.querySelector(`#builder .fld[data-jump="${CSS.escape(name)}"]`));
      b.dataset.field = name;
    });
    add("Copy →", () => $("sections"));
    paintJump();
    sizeJump();
  }
  // The bar is one scrolling row on a phone and wraps on a laptop, so everything that has to clear it
  // (the scroll target of a tap, the sticky Copy panel) is sized from its real height, not a guess.
  // Set straight away, never inside requestAnimationFrame: that does not fire while the tab is in the
  // background, and the boxes would then land underneath the bar (measured 2026-09-22).
  function sizeJump() {
    const host = $("jump"); if (!host) return;
    document.documentElement.style.setProperty("--jumph", (host.hidden ? 0 : host.offsetHeight) + "px");
  }
  addEventListener("resize", sizeJump);
  // a chip is "filled" when its box has a real line in it — a pre-listed empty test does not count
  function paintJump() {
    document.querySelectorAll("#jump button[data-field]").forEach((b) => {
      const lines = val(b.dataset.field).split("\n").map((l) => l.trim()).filter(Boolean);
      b.classList.toggle("filled", lines.some((l) => !BLANK_TEST.test(l) && !HEADINGS.has(l)));
    });
  }
  // highlight the section the physio is looking at, and keep its chip in view on a phone
  let jumpTick = 0;
  function markHere() {
    const host = $("jump"); if (!host || host.hidden) return;
    const boxes = [...document.querySelectorAll("#builder .fld[data-jump]")];
    const top = host.getBoundingClientRect().bottom + 4;
    let cur = null;
    boxes.forEach((box) => { const r = box.getBoundingClientRect(); if (r.top <= top + 40) cur = box.dataset.jump; });
    host.querySelectorAll("button").forEach((b) => b.classList.remove("here"));
    if (!cur) return;
    const b = host.querySelector(`button[data-field="${CSS.escape(cur)}"]`);
    if (b) { b.classList.add("here"); const br = b.getBoundingClientRect(), hr = host.getBoundingClientRect();
      if (br.left < hr.left + 8 || br.right > hr.right - 8) host.scrollLeft = b.offsetLeft - host.clientWidth / 2 + b.offsetWidth / 2; }
  }
  addEventListener("scroll", () => { if (jumpTick) return; jumpTick = requestAnimationFrame(() => { jumpTick = 0; markHere(); }); }, { passive: true });

  const CHIPS_FOR = {
    "Observation": () => profile().observation, "Palpation": () => V.PALPATION_FINDINGS,
    "Muscle power": () => V.STRENGTH, "PAIVMS": () => V.PAIVMS, "Functional test": () => profile().functional,
    "Special test": () => profile().tests.map((n) => `${n}${S.side && S.side !== "Both" ? " " + S.side : ""}:`), "Neurological examination": () => V.NEURO_PHRASES,
    "Vital signs": () => V.VITAL_SIGNS_LINES,
    "Problem list": () => [...V.IMPAIRMENTS, ...V.PARTICIPATION_RESTRICTION],
    "Drug allergy": () => ["No", "Yes"], "Recommendation": () => V.PLAN_GOALS,
    "Physician's recommendations": () => V.PLAN_GOALS,
    "Physiotherapy Treatments": () => Object.keys(V.TREATMENT_MODALITIES),
    "Chief Complaint": () => [...V.PAIN_TYPE.map((t) => t + " pain"), ...V.AGGRAVATING, ...V.EASING],
    "Chief complaint": () => [...V.PAIN_TYPE.map((t) => t + " pain"), ...V.AGGRAVATING, ...V.EASING],
    "Treatments": () => Object.keys(V.TREATMENT_MODALITIES),
  };

  function renderBuilder() {
    const host = $("builder"); host.innerHTML = ""; customSync.length = 0;
    setTimeout(renderSuggest, 0);
    setTimeout(renderJump, 0);   // after the boxes exist
    const fmt = S.format;
    if (fmt === "SOAP with treatment") {
      host.appendChild(fieldBox("Subjective", 4, "What the patient reports — any language.", true));
      if (V.SUBJECTIVE_PHRASES) { let [ds, bs] = details("Follow-up openers"); bs.appendChild(chips([...V.SUBJECTIVE_PHRASES, ...V.PAIN_TYPE.map((t) => t + " pain"), ...V.AGGRAVATING, ...V.EASING], "Subjective", "")); host.appendChild(ds); }
      host.appendChild(fieldBox("Objective", 7, "Findings. Use the rows below to add lines, or just type.", true));
      objectiveExtras(host, "Objective");
      host.appendChild(fieldBox("Analysis", 2, "e.g. Rt. achilles tendinitis, Lt. plantar fasciitis", true));
      host.appendChild(fieldBox("Plan", 3, "", true));
      let [d, b] = details("Goals"); b.appendChild(chips(V.PLAN_GOALS, "Plan", "")); host.appendChild(d);
      host.appendChild(fieldBox("Treatment", 6, "Position, modality with parameters, then Area.", true));
      treatmentExtras(host, "Treatment");
      return;
    }
    const core = V.CORE_FIELDS[fmt], all = V.OUTPUT_FORMATS[fmt];
    all.filter((f) => core.includes(f)).forEach((f) => {
      if (f === "Pain scale") { host.appendChild(painScaleBox()); return; }
      host.appendChild(fieldBox(f, /history|xamination/i.test(f) ? 5 : 3, "", true));
      if (f === "Active range of motions" || f === "Passive range of motions") {
        const moves = V.ROM_BY_REGION[S.region] || V.ROM_GENERAL;
        const [d, b] = details("Options for " + f);
        romPicker(b, f, "", moves);
        if (f === "Active range of motions" && V.ACCESSORY_BY_REGION[S.region]) { b.appendChild(sub("Accessory movement")); b.appendChild(chips(V.ACCESSORY_BY_REGION[S.region], f, "")); }
        host.appendChild(d);
      } else if (f === "Observation") {
        const [d, b] = details("Options for " + f);
        observationPicker(b, f, "", [...profile().observation, ...(V.OBSERVATION_BY_REGION[S.region] || [])]); host.appendChild(d);
      } else if (f === "Muscle power") {
        const [d, b] = details("Options for " + f); musclePowerPicker(b, f, ""); host.appendChild(d);
      } else if (f === "Palpation") {
        const [d, b] = details("Options for " + f + " — pick the finding, then the muscle"); palpationPicker(b, f, ""); host.appendChild(d);
      } else if (CHIPS_FOR[f]) { const [d, b] = details("Options for " + f); b.appendChild(chips(CHIPS_FOR[f](), f, "")); host.appendChild(d); }
      if (f === "Treatment" || f === "Treatments" || f === "Physiotherapy Treatments") treatmentExtras(host, f);
    });
    const optional = all.filter((f) => !core.includes(f));
    if (optional.length) {
      const [d, b] = details(`Optional detail — ${optional.length} more fields`);
      const p = document.createElement("p"); p.className = "hint"; p.textContent = "Leave any of these blank and they will not appear in the note."; b.appendChild(p);
      optional.forEach((f) => { b.appendChild(fieldBox(f, 2, "", false)); if (CHIPS_FOR[f]) b.appendChild(chips(CHIPS_FOR[f](), f, "")); });
      host.appendChild(d);
    }
  }

  // ---------- output ----------
  function buildNote() {
    const fmt = S.format, fields = V.OUTPUT_FORMATS[fmt];
    if (fmt === "SOAP with treatment") {
      const out = []; const tt = ($("tt").value || "").trim(); const subj = val("Subjective").trim();
      if (tt || subj) { out.push(tt ? `Subjective: *Treatment times: ${tt}${S.ttSuffix ? " " + S.ttSuffix : ""}` : "Subjective:"); if (subj) out.push(subj); out.push(""); }
      const obj = val("Objective").trim(); if (obj) out.push("Objective:", obj, "");
      ["Analysis", "Plan", "Treatment"].forEach((l) => { const b = val(l).trim(); if (b) out.push(l + ":", b, ""); });
      return out.join("\n").trim();
    }
    const out = [];
    fields.forEach((f) => { const b = val(f).trim(); if (b) out.push(b.includes("\n") ? `${f}:\n${b}` : `${f}: ${b}`, ""); });
    return out.join("\n").trim();
  }
  // Jane's forms have one box per section. Each section gets its own copy
  // button, holding exactly what goes in that box - no heading, because the
  // box already has one. Subjective carries the *Treatment times line, since
  // that is where the clinic writes it.
  function sectionText(f) {
    let body = val(f).trim();
    if (S.format === "SOAP with treatment" && f === "Subjective") {
      const tt = ($("tt").value || "").trim();
      if (tt) body = `*Treatment times: ${tt}${S.ttSuffix ? " " + S.ttSuffix : ""}` + (body ? "\n" + body : "");
    }
    return body;
  }
  async function copyText(text, btn, label) {
    try { await navigator.clipboard.writeText(text); }
    catch { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
    if (btn) { btn.textContent = "Copied ✓"; btn.classList.add("done"); setTimeout(() => { btn.textContent = label; btn.classList.remove("done"); }, 1800); }
    toast("Copied — paste into Jane's " + (label.replace(/^Copy /, "") || "box"));
  }
  function renderSections() {
    const host = $("sections"); host.innerHTML = "";
    const fields = V.OUTPUT_FORMATS[S.format];
    let any = false;
    fields.forEach((f) => {
      const text = sectionText(f);
      if (!text) return;
      any = true;
      const row = document.createElement("div"); row.className = "secrow";
      const left = document.createElement("div");
      left.innerHTML = `<div class="lbl">${escapeHtml(f)}</div><pre>${escapeHtml(text)}</pre>`;
      const b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.textContent = "Copy";
      b.onclick = () => copyText(text, b, "Copy");
      row.appendChild(left); row.appendChild(b); host.appendChild(row);
    });
    if (!any) host.innerHTML = '<div class="empty">Fill in the fields and each section appears here with its own Copy button — one for each box in Jane.</div>';
  }
  function renderOutput() {
    renderSections(); paintJump();
    const note = buildNote(); const o = $("output"); const v = $("verdict");
    const who = ($("patient").value || "").trim();
    if (!note) { o.innerHTML = ""; v.innerHTML = ""; return; }
    o.innerHTML = (who ? `<p class="hint">Draft for ${escapeHtml(who)} — not saved anywhere.</p>` : "") + `<pre class="note">${escapeHtml(note)}</pre>`;
    v.innerHTML = note.includes(BLANK)
      ? `<div class="note-warn">This draft still has <b>${BLANK}</b> placeholders. Fill in every measurement before pasting. If something was not assessed write <b>${V.NOT_ASSESSED}</b> — never guess a number.</div>`
      : `<div class="note-ok">No placeholders left — ready to paste.</div>`;
  }
  const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  async function copyNote() {
    const note = buildNote(); if (!note) return toast("Nothing to copy yet");
    try { await navigator.clipboard.writeText(note); toast("Copied — now paste into Jane"); }
    catch { const ta = document.createElement("textarea"); ta.value = note; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("Copied — now paste into Jane"); }
  }
  let toastT; function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2200); }

  // ---------- dictation ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let active = null;
  function targetTextarea(spec) { return spec.startsWith("f:") ? document.querySelector(`textarea[data-field="${CSS.escape(spec.slice(2))}"]`) : $(spec); }
  function wireMic(btn) {
    if (!SR) { btn.disabled = true; btn.textContent = "No dictation in this browser"; return; }
    btn.onclick = () => {
      if (active && active.btn === btn) { stopMic(); return; }
      if (active) stopMic();
      const ta = targetTextarea(btn.dataset.target); if (!ta) return;
      const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = S.lang;
      const base = ta.value.replace(/\s+$/, ""); let finalText = "";
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += t + " "; else interim += t; }
        ta.value = (base ? base + "\n" : "") + (finalText + interim).trim();
        ta.dispatchEvent(new Event("input"));
      };
      r.onerror = (e) => { toast(e.error === "not-allowed" ? "Microphone blocked — allow it in the browser" : "Dictation stopped: " + e.error); stopMic(); };
      r.onend = () => { if (active && active.r === r) { try { r.start(); } catch { stopMic(); } } };
      r.start(); active = { r, btn }; btn.classList.add("on"); btn.textContent = `⏹ Stop (${S.lang === "en-US" ? "English" : "Thai"})`;
    };
  }
  function stopMic() { if (!active) return; const { r, btn } = active; active = null; r.onend = null; try { r.stop(); } catch {} btn.classList.remove("on"); btn.textContent = `🎙 Dictate (${S.lang === "en-US" ? "English" : "Thai"})`; }

  // ---------- photo of the patient's chart -> text ----------
  // Runs Tesseract inside this browser. The photo never leaves the phone or PC;
  // the reader and its Thai + English language files download once and are
  // cached by the browser. Printed text reads well; handwriting is hit-and-miss.
  let ocrWorker = null, ocrLib = null;
  const ocrState = (msg) => { const s = $("ocrstate"); if (s) s.textContent = msg || ""; };
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (ocrLib) return ocrLib;
    ocrLib = new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = ok; s.onerror = () => { ocrLib = null; fail(new Error("Could not download the photo reader — check the internet connection")); };
      document.head.appendChild(s);
    });
    return ocrLib;
  }
  async function getWorker() {
    if (ocrWorker) return ocrWorker;
    await loadTesseract();
    ocrState("Preparing the photo reader (first time only, about 3 MB)…");
    ocrWorker = await Tesseract.createWorker(["tha", "eng"], 1, {
      langPath: "https://tessdata.projectnaptha.com/4.0.0_fast",
      logger: (m) => { if (m.status === "recognizing text") ocrState(`Reading the photo… ${Math.round((m.progress || 0) * 100)}%`); },
    });
    await ocrWorker.setParameters({ preserve_interword_spaces: "1" });
    return ocrWorker;
  }
  async function prepImage(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
    const max = 2000, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext("2d"); g.drawImage(bmp, 0, 0, c.width, c.height);
    // greyscale + contrast stretch: cheap, and it helps phone photos of paper
    const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; d[i] = y; if (y < lo) lo = y; if (y > hi) hi = y; }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) { const y = Math.max(0, Math.min(255, ((d[i] - lo) / span) * 255)); d[i] = d[i + 1] = d[i + 2] = y; }
    g.putImageData(img, 0, 0);
    return c;
  }
  // Intake forms are mostly printed boilerplate a physio never wants pasted
  // into the note: contact fields (name/tel/DOB/emergency contact/e-mail),
  // "how did you hear about us", desired massage pressure. Keep only what's
  // actually clinical: pain area, period of injury, chief complaint,
  // underlying disease, past history — the questions themselves get
  // stripped off, the handwritten answer after them is kept.
  const OCR_DROP = /\bfirst name\b|\blast name\b|\bnickname\b|\btel\.?\)|\bdate of birth\b|\bemergency contact\b|\be-?mail\)|\bheight\b[^a-z]{0,6}cm|\bweight\b[^a-z]{0,6}kg|\binstagram\b|\bfacebook\b|\bwebsite\b|friend referred|desired massage|massage pressure|\bhard\b[^a-z]{0,20}\bmedium\b[^a-z]{0,20}\bsoft\b|treated for this condition before|how did you hear about us|date of assessment|new patient registration|patient registration form|ชื่อ.{0,3}first name|นามสกุล|ชื่อเล่น|โทร.{0,4}tel|วัน.เดือน.ปี.*เกิด|เบอร์ญาติ|อีเมล|ส่วนสูง|น้ำหนัก\s*\(|รู้จักเราได้อย่างไร|ผู้แนะนำ|น้ำหนักในการกด|เคยรับการรักษาอาการนี้/i;
  const OCR_FIELD_LABELS = [
    [/^.*?pain area\)?\s*[:.]?\s*/i, "Pain area: "],
    [/^.*?บริเวณที่ปวด[^)]*\)?\s*/, "Pain area: "],
    [/^.*?period of injury\)?\s*[:.]?\s*/i, "Period of injury: "],
    [/^.*?ระยะเวลาที่ปวด[^)]*\)?\s*/, "Period of injury: "],
    [/^.*?chief complaint or condition\)?\s*[:.]?\s*/i, "Chief complaint: "],
    [/^.*?อาการสำคัญ[^)]*\)?\s*/, "Chief complaint: "],
    [/^.*?underlying disease\)?\s*[:.]?\s*/i, "Underlying disease: "],
    [/^.*?โรคประจำตัว[^)]*\)?\s*/, "Underlying disease: "],
    [/^.*?past history including[^)]*\)?\s*/i, "Past history: "],
    [/^.*?ประวัติการเจ็บป่วยในอดีต[^)]*\)?\s*/, "Past history: "],
  ];
  function cleanOcr(text) {
    const lines = text.split("\n").map((l) => l.replace(/[_|]{2,}/g, " ").replace(/\s+/g, " ").trim())
      .filter((l) => /[A-Za-z0-9฀-๿]{2,}/.test(l));
    const out = [];
    for (const line of lines) {
      if (/^\d\.?\s*$/.test(line)) continue;
      const hit = OCR_FIELD_LABELS.find(([re]) => re.test(line));
      if (hit) { const rest = line.replace(hit[0], "").trim(); if (rest) out.push(hit[1] + rest); continue; }
      if (OCR_DROP.test(line)) continue;
      out.push(line);
    }
    return out.join("\n");
  }
  // ---------- handwriting: the photo is read by Google's Gemini (owner decision 2026-09-19) ----------
  // Tesseract cannot read handwriting, and the form is mostly handwritten Thai. With a Gemini API
  // key saved on this device (never in the repo — it is typed into the page once per device and
  // kept in this browser's storage) the photo is sent to Google to be read; without one the
  // on-device reader above is used and nothing leaves the device. The page says which is in force.
  const AI_MODELS = ["gemini-flash-latest", "gemini-2.5-flash"];
  // Owner decision 2026-09-19: no physio ever sets anything up. The key cannot sit in these public
  // files (Google switches off keys it finds in public code), so it lives in ONE hidden place: a free
  // Google Apps Script web app under the clinic's own Google account (Downloads/BPC-handwriting-relay/
  // Code.gs, key in its Script properties). The page posts the photo there and gets the reading back.
  // The address below is not a secret. While it is empty, the per-device key box is the fallback.
  const AI_RELAY_URL = "https://script.google.com/macros/s/AKfycbw2r3bTJBpzAskXxN-aKSK2YsbjWoWpD9pz7bXVFgJ6hcmieDYfd_lGSDs5RQqH1E0/exec";
  const AI_KEY_SLOT = "bpc.aiReaderKey";
  const aiKey = () => { try { return (localStorage.getItem(AI_KEY_SLOT) || "").trim(); } catch { return ""; } };
  // The four real charts the owner supplied (2026-09-19) show physios do NOT keep to the printed
  // lines: ROM numbers circled beside the body diagram, squat/deadlift loads in a bubble, knee-to-wall
  // and heel-raise counts under the form, palpation written in the Muscle power area, a plan list in
  // the bottom corner. So the reader sorts every piece of handwriting by what it MEANS, never by
  // where it sits on the page.
  const AI_PROMPT = `This is a photo of a Bangkok Physiotherapy Center "New Patient Registration Form" used as a working sheet. The patient fills in the left side. The physiotherapist then writes notes ANYWHERE on the page: inside the "PT assessment only" column, across the printed labels, around the body diagram, in the margins, in circles and bubbles, and in the empty space at the top and bottom. The handwriting is Thai, English, or both mixed, with physiotherapy shorthand.

TASK: read ALL the handwriting on the whole page, then sort each piece by its CLINICAL MEANING into the sections below. IGNORE which printed label it happens to sit next to: a palpation finding written beside "Muscle power" is still palpation; range-of-motion numbers written at the bottom of the page are still range of motion.

RULES
- Read only what was written, drawn or ticked by hand. Never copy the printed questions, labels or instructions.
- USE the printed question to understand what each handwritten answer means, then write only the answer with a short label of your own: "Pain area: neck", "Duration: 1 week", "Treated before: yes - ultrasound", "Underlying disease: none" (a dash or N/A means none). A mark on the body diagram becomes "Pain marked: back of upper neck". Pain area and duration belong in chief_complaint and present_history.
- Do NOT return the patient's name, nickname, phone, e-mail, address, date of birth, age, height, weight, emergency contact, insurance, medical-certificate or "how did you hear about us" answers, massage pressure, the Bangkok questions, or the therapist's signature.
- Write every fact as ONE short, clear chart line in English that a colleague can understand at a glance (translate Thai into plain English; keep standard abbreviations such as Rt, Lt, ROM, UT, ITB, MRI). Copy every number, unit and side exactly as written.
- If you cannot read a phrase well enough to be sure what it means, LEAVE IT OUT. Never output scraps, half words, single letters, a label with nothing after it ("ass:", "art,") or text that does not make sense. [?] is only for one unreadable word inside a line that is otherwise clear. Never guess a word or a number and never add anything that is not on the paper.
- Read slowly, stroke by stroke, the way a colleague deciphers a doctor's handwriting. This is a physiotherapy clinic, so a scrawled word is most likely one of these (accept one ONLY when the pen strokes really fit it): trigger point, tenderness, tightness, tight, spasm, swelling, muscle guarding, weakness, weak, dull pain, sharp pain, radiating, numbness, local pain, full ROM, limit, flexion, extension, lateral flexion, rotation, abduction, adduction, IR, ER, upper trapezius (UT), levator, scalene, pectoral, rhomboid, lower trapezius, QL, paraspinal, gluteus, piriformis, hamstring, quadriceps, VMO, ITB, gastrocnemius, soleus, peroneus, PFPS, ITB syndrome, MPS, HNP, L4-L5, L5-S1, SLR, FABER, Ober, Thomas, McMurray, drawer, Adson, Spurling, single leg, heel raise, knee to wall, squat, run, gym, yoga, pilates, ultrasound, MRI, X-ray, BP, HR. Thai words that are common here: ปวด, ตึง, ร้าว, ชา, บวม, คอ, บ่า, ไหล่, สะบัก, หลัง, เอว, สะโพก, เข่า, น่อง, ข้อเท้า, ซ้าย, ขวา, เดือน, สัปดาห์, ปี, วัน, ผ่าตัด, ล้ม, เคย, ไม่เคย, กายภาพ, นวด, ทำงาน, นั่งนาน, ยกของ, วิ่ง.
- The chief complaint must come from words that are actually written. NEVER make one up from the body diagram or from the rest of the page; if the complaint is unreadable write what you can and [?] for the rest.
- Questions the physio jotted down as a reminder to ask ("describe about your pain?", "how many scale 0-10?") are NOT findings: leave them out.
- Vital signs (BP 122/70, HR 68) go in observation. Medical conditions the patient lists (e.g. rheumatoid, high cholesterol) go in past_history as "Underlying disease: ...".
- One finding per line. Keep things that were written together on one line ("F 30 (40)", "DL: 40 kg 10/3").
- Marks on the body diagram: describe where ("X at Rt. lateral knee", "circle around upper back") together with any words written beside them.

HOW TO SORT (examples of shorthand)
- chief_complaint: ONLY the main problem, in one or two lines: where it hurts and for how long ("Rt hip pain, 4-5 years"; "Low back pain, a couple of weeks"). Nothing else goes here.
- present_history: how this episode behaves: what makes it worse or better (stairs, sitting, walking, running), the quality of the pain (dull, tense, sharp, radiating or local), cause unknown, sport / work / training load ("run 3-4 d/wk 15 km", "DL 40 kg 10/3").
- past_history: anything that happened BEFORE: accidents and old injuries with when ("Ski accident 4 years ago"), surgery or "no surgery", earlier treatment for this problem (massage, physiotherapy, doctor), underlying disease, regular medicine, imaging results ("X-ray normal", "MRI L5-S1").
- pain_score: ONLY if a rating out of ten is actually handwritten ("6/10", "rest 2/10"). A reminder such as "scale 0-10?" is not a score. If no score is written return "".
- observation: posture, alignment, swelling, gait, what the physio saw.
- palpation: tenderness, tightness, trigger points, spasm, temperature, muscles listed with a finding, circumference measurements.
- active_rom / passive_rom: movements with degrees, "full", "limit by ...", F / E / Lat flex / Rot with numbers. If it does not say passive, it is active.
- muscle_power: grades (4/5, 3+), "weak", muscle strength findings.
- special_test: named tests with a result (+ve / -ve / neg / pos / norm), e.g. "-ve McMurray", "drawer -ve", SLR, FABER.
- functional_test: balance, knee to wall ("K to W 5.6 / 9 cm"), single leg heel raise counts, squat, hop, step down, sit to stand.
- neurological: sensation, reflexes, myotomes, numbness testing.
- diagnosis: the physio's impression or the condition named (e.g. "PFPS", "ITB syndrome", "MPS").
- plan: goals, focus list, advice, things to do next ("thoracic mobility", "posture training", "core stabilize").
- treatment: modalities or manual treatment given. exercise: exercises prescribed, with their dose.
- A mark, circle, arrow or hatching on the body diagram is an observation of the pain area: put it in observation ("Pain marked: circle on Rt buttock"), and name the area itself in chief_complaint.
- Do not write the same fact in two sections, and do not write the date of the assessment, the therapist's initials or the form's own headings.
- other: handwriting you could read but could not place. Nothing readable may be dropped.

Return JSON only, with exactly these keys (all strings; separate lines with \\n; empty string when nothing was written):
{"chief_complaint":"","present_history":"","past_history":"","pain_score":"","observation":"","palpation":"","active_rom":"","passive_rom":"","muscle_power":"","special_test":"","functional_test":"","neurological":"","diagnosis":"","plan":"","treatment":"","exercise":"","other":""}`;
  async function photoToJpegBase64(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
    const max = 2000, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88).split(",")[1];
  }
  // Model names change (2026-09-19: both built-in names came back 404 on the owner's key), so the
  // page asks Google which models this key can use and tries the newest "flash" ones first. A model
  // that is refused (not found, or no free quota — free quotas are per model) just means "try the next".
  const AI_BASE = "https://generativelanguage.googleapis.com/v1beta";
  let aiModelList = null;
  async function aiModels() {
    if (aiModelList) return aiModelList;
    let names = [];
    try {
      const res = await fetch(`${AI_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": aiKey() } });
      if (res.ok) {
        const j = await res.json();
        names = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => String(m.name || "").replace(/^models\//, ""))
          .filter((n) => /^gemini/.test(n) && !/image|tts|audio|live|embedding|robotics|computer|learnlm|gemma|aqa/i.test(n));
      }
    } catch { /* fall through to the built-in list */ }
    const ver = (n) => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? parseFloat(m[1]) : 0; };
    const rank = (n) => (/latest/.test(n) ? 1000 : 0) + (/flash/.test(n) ? 100 : 0) - (/lite/.test(n) ? 30 : 0) - (/preview|exp/.test(n) ? 20 : 0) + ver(n);
    names.sort((x, y) => rank(y) - rank(x));
    aiModelList = [...new Set([...names.slice(0, 5), ...AI_MODELS, "gemini-2.5-flash-lite"])];
    return aiModelList;
  }
  const relayBusy = (j) => !j.text && (j.busy || /\b(503|429)\b|high demand|quota/i.test(String(j.error || "") + " " + JSON.stringify(j.skipped || [])));
  async function askRelay(b64, attempt) {
    let res;
    // text/plain keeps this a "simple" request: Apps Script web apps do not answer CORS preflights
    try { res = await fetch(AI_RELAY_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ image: b64, prompt: AI_PROMPT, strict: true }), redirect: "follow" }); }
    catch { throw new Error("Could not reach the handwriting reader — check the internet connection"); }
    // Apps Script's /exec answers an occasional 404 or 5xx that has nothing to do with the request —
    // the very next try succeeds (measured 2026-09-23, after a physio's photo failed with 404 while the
    // relay was healthy and a 2 MB photo went through seconds later). Never give up on the first one.
    if (!res.ok && (attempt || 0) < 2) { ocrState(`The handwriting reader did not answer (${res.status}) — trying again…`); await new Promise((r) => setTimeout(r, 4000)); return askRelay(b64, (attempt || 0) + 1); }
    if (!res.ok) throw new Error("The handwriting reader answered with an error (" + res.status + ") — try Photo of chart again in a moment.");
    let j; try { j = await res.json(); } catch { throw new Error("The handwriting reader sent an answer this page could not use"); }
    if (relayBusy(j) && (attempt || 0) < 2) { ocrState("The handwriting reader is busy — trying the next one…"); await new Promise((r) => setTimeout(r, 5000)); return askRelay(b64, (attempt || 0) + 1); }
    // the good free model is sometimes "busy"; the weak one is never used for handwriting, so say so and let the physio try again
    // "busy" also when the good models were refused for today's free allowance (429 quota) and the last error is about some other model
    if (!j.text && (j.busy || /\b(503|429)\b|high demand|quota/i.test(String(j.error || "") + " " + JSON.stringify(j.skipped || [])))) { const e = new Error("Google's free handwriting reader is busy or has used up today's free reads — try Photo of chart again in a few minutes."); e.busy = true; throw e; }
    // an empty answer with no reason at all (measured: 1 chart in 21) is worth one more try before giving up
    if (!j.text && !j.error && (attempt || 0) < 2) { ocrState("The handwriting reader gave no answer — trying again…"); await new Promise((r) => setTimeout(r, 4000)); return askRelay(b64, (attempt || 0) + 1); }
    if (j.error || !j.text) throw new Error("The handwriting reader did not answer (" + String(j.error || "empty").slice(0, 180) + ")");
    try { return JSON.parse(String(j.text).replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { throw new Error("The handwriting reader sent an answer this page could not use"); }
  }
  async function askGemini(b64) {
    if (AI_RELAY_URL) return askRelay(b64);
    const body = JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: "image/jpeg", data: b64 } }, { text: AI_PROMPT }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } });
    let lastMsg = "";
    const models = await aiModels();
    for (const model of models.slice(0, 7)) {
      let res;
      try { res = await fetch(`${AI_BASE}/models/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": aiKey() }, body }); }
      catch { throw new Error("Could not reach the handwriting reader — check the internet connection"); }
      if (!res.ok) {
        let gm = ""; try { gm = ((await res.json()).error || {}).message || ""; } catch {}
        lastMsg = `${res.status} ${gm}`.trim().slice(0, 180);
        if (res.status === 401 || res.status === 403) throw new Error("Google refused the reader key (" + lastMsg + ")");
        continue;   // 404 unknown model, 429 no free quota on this model, 400 / 5xx: try the next model
      }
      const j = await res.json();
      const parts = ((((j.candidates || [])[0] || {}).content || {}).parts) || [];
      const txt = parts.map((p) => p.text || "").join("");
      if (!txt) { lastMsg = "empty answer from " + model; continue; }
      try { aiModelList = [model, ...models.filter((m) => m !== model)]; return JSON.parse(txt.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { lastMsg = "unreadable answer from " + model; continue; }
    }
    throw new Error("The handwriting reader did not answer (" + (lastMsg || "no model available") + ")");
  }
  // What was read goes straight into the boxes, word for word; nothing is interpreted here.
  // Whatever the model returns is cleaned HERE, by rule, before it touches a box — the weaker free
  // model ignores parts of its instructions (2026-09-19: it copied a nickname and a phone number, filed
  // "F 30 (40)" under Palpation and padded lines with labels of its own).
  const PHOTO_PII = /(?:\+?\d[\d\s-]{7,}\d)|[\w.+-]+@[\w-]+\.[\w.]+|^\s*(?:k\.|khun|คุณ|mr\.?|mrs\.?|ms\.?|miss)\s*\S+\s*$/i;
  const PHOTO_FILLER = /^(?:observation|palpation|range of motion|rom|muscle power|special test|posture|postural\/alignment|work\/activity|activity|sitting position|past history|chief complaint)\s*(?:notes?)?\s*:\s*/i;
  const PHOTO_ROM = /^(?:\(?[LR]\)?\s*)?(?:F|E|Flex\w*|Ext\w*|Lat\.?\s*\w*|Rot\w*|Abd\w*|Add\w*|IR|ER)\b[^A-Za-zก-๙]{0,4}\d/;
  const PHOTO_ADMIN = /insurance|ประกัน|certificate|ใบรับรอง|instagram|facebook|website|chatgpt|banner|friend referred|ผู้แนะนำ|massage pressure|\b(?:hard|medium|soft)\b.*\b(?:hard|medium|soft)\b|live in bangkok|staying in bangkok|emergency|date of birth|e-?mail|\bheight\b|\bweight\b(?! ?bearing)|therapist'?s name/i;
  const PHOTO_PAST = /accident|อุบัติเหตุ|surger|operat|ผ่าตัด|\bago\b|ปีก่อน|ปีที่แล้ว|\bmri\b|x-?ray|ultrasound scan|\bct\b|fracture|กระดูกหัก|previous|treated before|เคยรักษา|เคยทำกายภาพ|underlying|โรคประจำตัว|medication|medicine|painkiller/i;
  const PHOTO_BEHAVE = /stairs?|บันได|sitting|นั่ง|walking|เดิน|running|วิ่ง|standing|ยืน|worse|better|aggravat|eas(?:e|ing)|\brest\b|cause unknown|don'?t know (?:the )?cause|ไม่รู้สาเหตุ|\btense\b|\btight\b|\bdull\b|\bsharp\b|radiat|numb|ชา|ร้าว|morning|night|กลางคืน/i;
  const PHOTO_BODY = /\b(hip|knee|back|neck|shoulder|ankle|foot|heel|elbow|wrist|hand|finger|thumb|leg|arm|thigh|calf|shin|spine|head|jaw|rib|chest|groin|glute|hamstring|lumbar|cervical|thoracic)s?\b|คอ|บ่า|ไหล่|สะบัก|หลัง|เอว|เข่า|สะโพก|ข้อเท้า|เท้า|ขา|แขน|ศอก|ข้อมือ|น่อง/i;
  // a mark on the body diagram is an observation of the pain area, not a complaint and not history
  // (21 real charts, 2026-09-22: "Pain marked: circle on Rt buttock" landed in three different boxes)
  const PHOTO_MARK = /^pain (?:marked|area marked)\b|^(?:mark|marked|circle|circled|x marked|arrow|scribble|hatching)\b.{0,12}\bon\b|on (?:the )?(?:body |posterior |anterior |side-view )?diagram/i;
  // the date of the visit, the form's own headings and the therapist's initials are not findings
  const PHOTO_META = /^(?:assessment |visit )?date\b|^\d{1,2}[ \/-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?[ \/-]?\d{2,4}\.?$|^(?:pt|physio(?:therapist)?)'?s? (?:name|initials|signature)/i;
  function cleanPhotoReading(r, fromNotes) {
    const o = {}; const moved = { active_rom: [], pain_score: [], past_history: [], present_history: [], observation: [] };
    Object.keys(r || {}).forEach((k) => {
      const lines = String(r[k] == null ? "" : r[k]).split(/\n+/).map((l) => l.replace(PHOTO_FILLER, "").trim())
        .map((l) => l.replace(/^[-–•·*]\s*(?!ve\b)/i, "").replace(/\s*[;,]\s*$/, "").trim())
        .filter((l) => l && !PHOTO_PII.test(l) && (fromNotes || !PHOTO_ADMIN.test(l)) && !/^(?:\[\?\]|\.{2,}|…|-|n\/?a|no|yes|now)$/i.test(l) && /[A-Za-z0-9ก-๙]/.test(l.replace(/\[\?\]/g, "")))
        // a reminder the physio jotted down ("describe about your pain?") is not a finding; a scrap is not a line
        // "7/10", "E 10", "4/5" are short but complete: the 4-letter scrap rule is for the wordy boxes only (it silently dropped every pain score in drafts 27-29)
        .filter((l) => !/\?\s*$/.test(l) && !/:\s*$/.test(l) && l.replace(/\[\?\]|[^A-Za-z0-9ก-๙]/g, "").length >= (/^(chief_complaint|present_history|past_history|observation|diagnosis|plan|other|functional_limitation)$/.test(k) ? 4 : 2) && (l.match(/\[\?\]/g) || []).length <= 1);
      o[k] = lines.filter((l) => {
        if (PHOTO_META.test(l)) return false;
        if (k !== "observation" && PHOTO_MARK.test(l)) { moved.observation.push(l); return false; }
        if (k !== "active_rom" && k !== "passive_rom" && PHOTO_ROM.test(l)) { moved.active_rom.push(l); return false; }
        if (k !== "pain_score" && /^\d{1,2}\s*\/\s*10$/.test(l)) { moved.pain_score.push(l); return false; }
        if (k === "pain_score" && !/\d{1,2}\s*\/\s*10/.test(l)) return false;   // only a score really written as n/10
        // the chief complaint is the main problem only: history and behaviour have their own boxes
        if (k === "chief_complaint" && PHOTO_PAST.test(l)) { moved.past_history.push(l); return false; }
        // "Low back pain radiating down Lt leg, 3 months" IS the complaint even though it says "radiating": a line that names
        // a body part stays; only behaviour with no body part ("pain with prolonged sitting") moves to the history of the episode
        if (k === "chief_complaint" && PHOTO_BEHAVE.test(l) && !/^pain area/i.test(l) && !PHOTO_BODY.test(l)) { moved.present_history.push(l); return false; }
        // (notes read by Claude are already sorted by meaning: "tried massage before, no change" belongs to this episode)
        if (k === "present_history" && !fromNotes && PHOTO_PAST.test(l)) { moved.past_history.push(l); return false; }
        // a chief complaint names a body part or a pain; anything else the model left there is a note about the episode
        if (k === "chief_complaint" && !/pain|ปวด|เจ็บ|ache|sore|stiff|ตึง|numb|ชา|injur|sprain|strain|hip|knee|back|neck|shoulder|ankle|foot|heel|elbow|wrist|hand|finger|leg|arm|thigh|calf|shin|spine|head|jaw|rib|chest|groin|glute|hamstring|คอ|บ่า|ไหล่|สะบัก|หลัง|เอว|เข่า|สะโพก|ข้อเท้า|เท้า|ขา|แขน|ศอก|ข้อมือ|น่อง|area/i.test(l)) { moved.present_history.push(l); return false; }
        // one unreadable word in a line with almost nothing else says nothing
        if (/\[\?\]/.test(l) && l.replace(/\[\?\]|[^A-Za-z0-9ก-๙]/g, "").length < 10) return false;
        if (k === "other") return false;                                           // what could not be placed is not shown at all
        return true;
      });
    });
    o.observation = [...(o.observation || []), ...moved.observation];
    o.active_rom = [...(o.active_rom || []), ...moved.active_rom];
    o.pain_score = [...(o.pain_score || []), ...moved.pain_score];
    o.past_history = [...(o.past_history || []), ...moved.past_history];
    o.present_history = [...(o.present_history || []), ...moved.present_history];
    // more than two lines of "chief complaint" means the model dumped its notes there: the rest is history of this episode
    const ccMax = fromNotes ? 3 : 2;   // a session can be about two or three problems; a paper form has one complaint box
    if ((o.chief_complaint || []).length > ccMax) { o.present_history = [...o.chief_complaint.slice(ccMax), ...o.present_history]; o.chief_complaint = o.chief_complaint.slice(0, ccMax); }
    // one plain score is the pain scale; several are kept as written
    const out = {}; Object.keys(o).forEach((k) => { out[k] = [...new Set(o[k])].join("\n"); });
    return out;
  }
  function placePhotoFields(r, rec, keepScraps) {
    r = cleanPhotoReading(r, keepScraps);
    const str = (k) => String(r[k] == null ? "" : r[k]).trim();
    const put = (sec, heading, text) => {
      if (!text) return 0;
      const t = target(sec, heading); if (!t || !t[0]) return 0;
      let n = 0;
      text.split(/\n+/).map((l) => l.replace(/^(?:[•·*]|-(?!\s*ve\b))\s*/i, "").trim())   /* a list dash goes, the minus of "-ve" stays */.filter(Boolean).forEach((line) => { if (heading === "Special test" && /(\+ve|-ve)\s*$/.test(line)) removeBlankTest(t[0], line); dropStubFor(t[0], line); if (!hasLine(t[0], line)) { append(t[0], line, t[1] || ""); if (rec) rec.push([t[0], line]); n++; } });
      return n;
    };
    // "Trunk rotation Lt.: more pain than Rt." makes the empty "Trunk rotation:" above it pointless
    // (physio feedback 2026-09-21: "why do you come up with trunk rotation as a blank one again?")
    function dropStubFor(field, line) {
      const m = /^([^:]{3,60}?)(?:\s+(?:Rt\.|Lt\.|Both))?\s*:\s*\S/.exec(line); if (!m) return;
      const head = m[1].trim().toLowerCase();
      val(field).split("\n").forEach((l) => { const tl = l.trim(); const s = /^([^:]+?)(?:\s+(?:Rt\.|Lt\.|Both))?\s*:\s*$/.exec(tl); if (s && s[1].trim().toLowerCase() === head) removeLine(field, tl); });
    }
    // a box of the form being written that has no section of its own in target()
    const putField = (field, text) => {
      if (!text || !V.OUTPUT_FORMATS[S.format].includes(field)) return 0;
      let k = 0; text.split(/\n+/).map((l) => l.trim()).filter(Boolean).forEach((line) => { if (!hasLine(field, line)) { append(field, line, ""); if (rec) rec.push([field, line]); k++; } });
      return k;
    };
    let n = 0;
    n += put("subjective", "", str("chief_complaint"));
    n += put("subjective", "PresentHistory", str("present_history"));
    n += put("subjective", "PastHistory", str("past_history"));
    // a single plain score goes on the New patient's record pain scale; anything richer ("rest 2/10, run 6/10") is kept as written
    const ps = str("pain_score"), pm = /^(?:vas\s*)?(\d{1,2})\s*\/\s*10$/i.exec(ps);
    if (ps) {
      if (pm && +pm[1] <= 10 && S.format === "New patient's record") { S.fields["Pain scale"] = pm[1]; if (rec) rec.push(["Pain scale", pm[1]]); n++; }
      else if (pm && +pm[1] <= 10) n += put("objective", "", `VAS ${pm[1]}/10`);
      // several scores ("Low back 7/10", "Lt. elbow 4/10"): written out on the line under the pain-scale buttons
      else if (S.format === "New patient's record") { const all = ps.split(/\n+/).map((l) => l.trim()).filter(Boolean).join(", "); S.fields["Pain scale"] = all; if (rec) rec.push(["Pain scale", all]); n++; }
      else n += put("objective", "", ps.split(/\n+/).map((l) => (/vas|pain/i.test(l) ? l : "Pain score: " + l)).join("\n"));
    }
    n += put("objective", "Observation", str("observation"));
    n += put("objective", "Palpation", str("palpation"));
    n += put("objective", "Active range of motions", str("active_rom"));
    n += put("objective", "Passive range of motions", str("passive_rom"));
    n += put("objective", "Muscle power", str("muscle_power"));
    n += put("objective", "PAIVMS", str("paivms"));
    n += putField("Functional limitation", str("functional_limitation")) || put("subjective", "PresentHistory", str("functional_limitation"));
    { const opts = new Set([...(V.IMPAIRMENTS || []), ...(V.PARTICIPATION_RESTRICTION || [])].map((x) => x.toLowerCase()));   // the clinic's own tick-box wording only
      n += putField("Problem list", str("problem_list").split(/\n+/).filter((l) => opts.has(l.trim().toLowerCase())).join("\n")); }
    n += put("objective", "Special test", str("special_test"));
    n += put("objective", "Functional test", str("functional_test"));
    n += put("objective", "Neurological examination", str("neurological"));
    n += put("analysis", "", str("diagnosis"));
    n += put("plan", "", str("plan")) || (S.format === "New patient's record" && str("plan") ? put("treatment", "", str("plan").split(/\n+/).map((l) => (/^plan\b/i.test(l) ? l : "Plan: " + l)).join("\n")) : 0);
    n += put("treatment", "", str("treatment"));
    n += put("exercise", "Exercise", str("exercise"));
    return n;
  }
  async function readPhotosAI(files) {
    const btn = $("photobtn"); btn.classList.add("busy");
    try {
      let placed = 0;
      for (let n = 0; n < files.length; n++) {
        ocrState(files.length > 1 ? `Reading the handwriting — photo ${n + 1} of ${files.length}…` : "Reading the handwriting…");
        const r = cleanPhotoReading(await askGemini(await photoToJpegBase64(files[n])));
        placed += placePhotoFields(r);
        // The body region and the side come from what was read. Until draft 36 the complaint was pasted into the
        // notes box to get them, but then the rules read it again and wrote a second copy of the complaint
        // ("Pain at Lt. shoulder" under "Lt shoulder pain with limited ROM") — measured on 21 real charts,
        // 2026-09-22. Read it here instead and leave the notes box for what the physio says.
        const hintText = [r.chief_complaint, r.present_history].filter(Boolean).join("\n");
        if (hintText) {
          const d = DETECT.run(hintText, S.region);
          if (d.side && !S.sideManual && d.side !== S.side) { setSide(d.side, true); S.sideAuto = true; }
          if (d.region && !S.regionManual && d.region !== S.region) { S.region = d.region; $("region").value = d.region; renderBuilder(); prefillTests(); }
        }
      }
      // what the photo says is the note: a condition guessed from it must not add a treatment prescription,
      // measurements or tests nobody wrote (owner + physio, 2026-09-21; seen again on the real charts)
      S.photoRead = true; applyPack();
      // a test the physio wrote by hand ("-ve McMurray") makes the pre-listed empty line for it pointless
      const tidyTests = () => { const t = target("objective", "Special test");
      if (!(t && t[0] && S.prefilled)) return;
        const written = val(t[0]).split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l && !BLANK_TEST.test(l));
        val(t[0]).split("\n").forEach((l) => { const tl = l.trim(); if (!BLANK_TEST.test(tl) || !S.prefilled.has(testName(tl))) return; const key = testName(tl).toLowerCase().split(/[\s('-]/)[0]; if (key.length >= 4 && written.some((w) => w.includes(key))) removeLine(t[0], tl); });
      }; tidyTests(); setTimeout(() => { tidyTests(); renderOutput(); }, 1600);   // again once the region's tests have been pre-listed
      renderBuilder(); renderOutput();
      ocrState(placed ? `Photo read — ${placed} line${placed === 1 ? "" : "s"} of handwriting put into the boxes below. Check every word against the paper; [?] marks a word that could not be read.` : "Google's reader found no handwriting it could read in that photo — try a straighter, brighter shot.");
    } catch (err) {
      console.error(err);
      btn.classList.remove("busy");
      if (!$("trbox").open) $("trbox").open = true;
      const why = err.message || "The handwriting reader failed";
      toast(why);
      // No falling back to the built-in reader for a chart photo. It cannot read handwriting, so all it
      // returns is the blank form's own printed labels ("If yes, you have reached the end of the survey"),
      // which lands in the notes box as noise and is then read as if it were the session (seen 2026-09-23).
      ocrState(why);
      return;
    } finally { btn.classList.remove("busy"); }
  }
  function paintAiBox() {
    const on = !!(AI_RELAY_URL || aiKey());
    const st = $("aistate"); if (st) st.textContent = on ? "On — a reader key is saved on this device. Handwriting on chart photos is read." : "Off — no key on this device. Only printed text is read from photos.";
    // owner decision 2026-09-19: no notice per photo. The "never uploaded" sentence is only shown while it is true.
    const pv = $("photoprivacy"); if (pv) pv.textContent = on ? "" : "Photos are read on this device and never uploaded.";
    const rm = $("aikeyremove"); if (rm) rm.hidden = !on;
    // once a device is set up the box is gone for good — a physio using the page never sees it
    const box = $("aibox"); if (box) box.hidden = on;
  }
  function initAiBox() {
    // a key pasted into the old per-device box (drafts 23-24) is not used any more: the relay holds the key
    if (AI_RELAY_URL) { try { localStorage.removeItem(AI_KEY_SLOT); } catch {} }
    paintAiBox();
    if (!$("aibox")) return;   // the set-up box was removed from the page on the owner's instruction (2026-09-19)
    $("aikeysave").onclick = () => { const v = $("aikey").value.trim(); if (!v) { toast("Paste the key first"); return; } try { localStorage.setItem(AI_KEY_SLOT, v); } catch { toast("This browser would not save the key (private window?)"); return; } $("aikey").value = ""; paintAiBox(); toast("Handwriting reader is on for this device"); };
    $("aikeyremove").onclick = () => { try { localStorage.removeItem(AI_KEY_SLOT); } catch {} paintAiBox(); toast("Handwriting reader is off for this device"); };
    paintAiBox();
  }

  // ---------- the notes box, read by meaning (owner: "that box needs to be really smart", 2026-09-19) ----------
  // The on-device rules (detect.js) fill the boxes at once. A few seconds after the physio stops typing,
  // dictating or pasting, the same notes also go through the relay to Gemini, which reads them the way a
  // colleague would and returns ONLY what the rules missed. Those lines are added, remembered, and taken
  // back out if the notes change. If the free allowance is used up or Google is busy, nothing happens:
  // the rules' result simply stands.
  const NOTES_PROMPT = `You are helping a physiotherapist at Bangkok Physiotherapy Center write a patient chart. Below are their session NOTES: a dictation, typed notes, or a transcript of the whole session (Thai, English or mixed). A transcript may have no speaker labels and misheard words ("the right hit" = right hip, "SI joy" = SI joint).
Write the COMPLETE new-patient chart from these notes, the way a careful senior physiotherapist would after listening to the whole session. You are the author of the note: everything clinically relevant that was said must be in it, in the right section, and nothing that was not said.

RULES
- Only what is stated. Never add, infer, average or tidy a number: degrees, grades, n/10, sets and reps, minutes, MHz, Hz, w/cm2, cm are copied exactly or left out. Never write a test, a measurement, a device or a treatment that the notes do not mention.
- A negative is a negative: "no radiating pain", "ไม่มีอาการปวดร้าวลงขา" must never become "Radiating pain". Write it as the negative finding it is.
- A physio's question is not a finding; the patient's answer is. What the physio explains to the patient about the problem is the diagnosis / analysis. Small talk, scheduling, prices and packages are nothing.
- Speech recognition mishears. Thai dictation often writes the number seven "เจ็ด" as "เจ็บ": "ปวดเจ็บเต็ม 10" is 7/10. English recorders mishear body parts ("the right hit" = right hip). Read for meaning.
- A patient can have more than one problem (for example low back pain AND an old elbow problem). Keep them apart: say which area every complaint, score, finding and treatment belongs to. The treatment area is the area the physio said it was applied to, never a guess.
- Write short chart lines in English in the clinic's style: "Rt." / "Lt."; "Tenderness at Rt. upper trapezius"; "Tightness at both lumbar paraspinals, Rt. > Lt."; "Knee flexion Rt.: 120° with pain"; "Trunk extension: pain at initial range"; "full ROM" ONLY if the physio said the range was full; "Quadriceps Rt.: Grade 4/5"; special tests as "SLR Rt.: -ve"; exercises as "Wall sit — 10 x 3 sets"; treatment as the modality, its area, and only the parameters that were said ("PMS: low back").
- chief_complaint: the main problem(s) only, one line each: where it hurts and for how long ("Low back pain both sides, 6 months"). At most three lines.
- present_history: a full account, one fact per line: onset and how it started, the course since then, what makes it worse and better, the quality of the pain, whether it radiates, sleep / morning stiffness, work, sport and training load, what the patient has already tried for it, and the patient's goal. A ten-minute interview gives eight to fifteen lines, not two.
- past_history: underlying disease, surgery, accidents, old injuries and other long-standing problems with their current state ("Lt. elbow pain, long-standing: same pain and weakness"), earlier treatment, imaging, regular medicine ("No surgery" when the patient says none).
- pain_score: every score that was said, with its area or activity when there is more than one ("Low back 7/10 on movement", "Lt. elbow 4/10"). Only scores really said.
- muscle_power: what was tested and how, as said ("Isometric biceps curl Lt.: weak with pain", "Hip flexor Lt.: weak"). functional_test: the movements or tasks the physio watched (squat, sit to stand, single leg stance) with what was seen.
- functional_limitation: what the patient cannot do or has trouble doing in daily life, work or sport because of the problem ("Pain on standing up after sitting", "Cannot continue squat training").
- diagnosis: ONLY a diagnosis the physio named or explained in the notes — if none was said, leave it "" (the physio decides the diagnosis, not you). The clinical name only, the main problem first, one per line, six words at most, with the side when it has one ("Mechanical low back pain", "Lt. lateral epicondylitis"). No sentences, no contributing findings (they have their own sections), and what was ruled out is not a diagnosis.
- problem_list: only items from the PROBLEM LIST OPTIONS given at the end, copied exactly, that the findings support.
- No names, phone numbers or other identifying details. Never "he/she": leave the subject out or write "Pt.".
- One fact per line, each fact once, in the single best section.

Return JSON only, with exactly these keys (strings; lines separated by \\n; "" when nothing):
{"chief_complaint":"","present_history":"","past_history":"","pain_score":"","observation":"","palpation":"","active_rom":"","passive_rom":"","muscle_power":"","paivms":"","special_test":"","functional_test":"","neurological":"","diagnosis":"","plan":"","treatment":"","exercise":"","functional_limitation":"","problem_list":""}`;
  const smart = { timer: null, last: "", busy: false, at: 0, quietUntil: 0, tries: 0 };
  const smartState = (t) => { const el = $("smartstate"); if (el) el.textContent = t || ""; };
  function scheduleSmart() {
    if (!AI_RELAY_URL) return;
    clearTimeout(smart.timer);
    smart.timer = setTimeout(runSmart, 3000);
  }
  function retractSmart() {
    (S.aiLines || []).forEach(([f, l]) => { if (hasLine(f, l)) removeLine(f, l); updateTa(f); });
    S.aiLines = [];
    if ((S.aiConds || []).length) { S.moreConditions = (S.moreConditions || []).filter((c) => !S.aiConds.includes(c)); S.aiConds = []; renderCondTag(); }
  }
  // The diagnoses Claude read go on the condition tag as well as in the Diagnosis box (physio, 2026-09-21: "it puts
  // the diagnosis in the box but not on the top thing", "we can't put in two conditions"). The main one drives the
  // region; a condition the physio picked by hand always stays the main one.
  function adoptAiDiagnoses(dxText, rec) {
    // the tag carries the name only: "Mechanical low back pain both sides, Rt. > Lt., with L4-L5 stiffness" -> its first part;
    // "No indication of disc involvement" is not a condition
    const names = [...new Set(String(dxText || "").split(/\n+/).map((l) => l.trim().split(/\s*[,;(]\s*|\s+(?:with|due to|secondary to|from)\s+/i)[0].trim())
      .filter((l) => l && l.length <= 60 && !/^(?:no|not|nil|without|r\/o|rule[ds]? out|negative|unlikely)\b/i.test(l)))].slice(0, 3);
    S.aiConds = []; if (!names.length) return;
    const words = (t) => new Set(String(t).toLowerCase().replace(/[^a-zก-๙ ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !/^(pain|with|from|left|right|both|side|syndrome|chronic|acute)$/.test(w)));
    const same = (a, b) => { const A = words(a), B = words(b); return [...A].some((w) => B.has(w)); };
    const manual = S.condition && !S.conditionAuto;
    S.moreConditions = S.moreConditions || [];
    names.forEach((nm, i) => {
      if (manual && same(nm, S.condition)) {   // the physio already chose this one, in the clinic's own wording: no second line for it
        const at = rec.findIndex(([f, l]) => f === dxField() && l.startsWith(nm)); if (at >= 0) { removeLine(dxField(), rec[at][1]); rec.splice(at, 1); }
        return;
      }
      if (!manual && i === 0) { setCondition(nm, true); S.conditionGuess = false; S.aiConds.push(nm); return; }
      if (nm !== S.condition && !S.moreConditions.some((c) => same(c, nm))) { S.moreConditions.push(nm); S.aiConds.push(nm); }
    });
    renderCondTag();
  }
  async function runSmart() {
    const text = $("transcript").value.trim();
    if (!text) { if ((S.aiLines || []).length) { retractSmart(); renderOutput(); } smart.last = ""; smartState(""); return; }
    // the one-line hint a chart photo leaves in the notes box ("[From photo] Chief complaint: …") is not session notes:
    // the photo has been read already, and a second read of its own summary would only repeat it
    if (text.replace(/\[From photo\]\s*\n?Chief complaint:[^\n]*/g, "").trim().length < 40) return;
    if (text.length < 40 || smart.busy || text === smart.last || Date.now() < smart.quietUntil) return;
    // a few characters changed since the last read: not worth another read
    if (sameNotes(smart.last, text)) return;
    const wait = 20000 - (Date.now() - smart.at); if (wait > 0) { smart.timer = setTimeout(runSmart, wait); return; }
    smart.busy = true; smart.at = Date.now(); const sent = text;
    smartState(sent.length > 6000 ? "Reading the whole session — the note below is being written from it (a long transcript takes up to a minute)…" : "Reading the notes — the note below is being written from them…");
    try {
      const res = await fetch(AI_RELAY_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow",
        body: JSON.stringify({ notes: sent.slice(0, 60000), prompt: NOTES_PROMPT + "\n\nPROBLEM LIST OPTIONS: " + [...(V.IMPAIRMENTS || []), ...(V.PARTICIPATION_RESTRICTION || [])].join(" | ") }) });
      // same occasional 404/5xx from Apps Script as the photo path: try again rather than losing the read
      if (!res.ok) {
        window.__bpcSmart = { at: new Date().toISOString(), http: res.status };
        if (smart.tries < 2) { smart.tries++; smart.at = 0; smartState("The reader did not answer — trying again…"); clearTimeout(smart.timer); smart.timer = setTimeout(runSmart, 6000); return; }
        smart.tries = 0; smart.quietUntil = Date.now() + 2 * 60000; smartState(""); return;
      }
      const j = await res.json();
      window.__bpcSmart = { at: new Date().toISOString(), model: j.model || "", error: j.error || "", skipped: j.skipped || [] };   // for troubleshooting only
      if (!j.text) {
        if (relayBusy(j) && smart.tries < 2) { smart.tries++; smart.at = 0; smartState("The smart reader is busy — trying the next one…"); clearTimeout(smart.timer); smart.timer = setTimeout(runSmart, 6000); return; }
        if (relayBusy(j)) smart.quietUntil = Date.now() + 2 * 60000;
        smart.tries = 0; smartState(""); return;
      }
      smart.tries = 0;
      if ($("transcript").value.trim() !== sent) { smartState(""); return; }          // the notes changed while Google was reading: this answer is stale
      const raw = String(j.text), a = raw.indexOf("{"), z = raw.lastIndexOf("}");
      const r = JSON.parse(a >= 0 && z > a ? raw.slice(a, z + 1) : raw);
      // Claude's reading is the note: its earlier lines, the rules' lines and the condition's usual lines step back first
      retractSmart();
      S.aiFor = sent; autoFill(); applyPack();
      const rec = []; const n = placePhotoFields(r, rec, true); S.aiLines = rec; smart.last = sent;
      adoptAiDiagnoses(cleanPhotoReading(r, true).diagnosis, rec);
      renderBuilder(); renderOutput();
      smartState(n ? `Note written from these notes — ${n} line${n === 1 ? "" : "s"}. Check each one against what was said, then edit or delete freely.` : "");
    } catch (err) { console.error(err); smartState(""); }
    finally { smart.busy = false; }
  }

  async function readPhotos(files, builtInOnly) {
    if ((AI_RELAY_URL || aiKey()) && !builtInOnly) return readPhotosAI(files);
    const btn = $("photobtn"); btn.classList.add("busy");
    try {
      const w = await getWorker();
      for (let n = 0; n < files.length; n++) {
        ocrState(files.length > 1 ? `Reading photo ${n + 1} of ${files.length}…` : "Reading the photo…");
        const canvas = await prepImage(files[n]);
        const { data } = await w.recognize(canvas);
        const text = cleanOcr(data.text || "");
        const ta = $("transcript");
        if (!text) { toast("Could not read any text in that photo — try a straighter, brighter shot"); continue; }
        ta.value = (ta.value.replace(/\s+$/, "") ? ta.value.replace(/\s+$/, "") + "\n\n" : "") + "[From photo]\n" + text;
        ta.dispatchEvent(new Event("input"));
        if (!$("trbox").open) $("trbox").open = true;
      }
      ocrState("Photo read — check the words below; the reader guesses at handwriting.");
      if (!builtInOnly) setTimeout(() => ocrState(""), 6000);   // after a failed handwriting read the reason stays on screen
    } catch (err) {
      console.error(err); ocrState(""); toast(err.message || "The photo could not be read");
    } finally { btn.classList.remove("busy"); }
  }

  // ---------- a recording of the session -> text, on this device ----------
  // Whisper runs inside the browser (transformers.js). The model is fetched once
  // from the Hugging Face CDN and cached by the browser; the audio never leaves
  // the device. English: whisper-base.en (about 75 MB). Thai or mixed:
  // whisper-small, multilingual (about 250 MB). WebGPU when the device has it,
  // otherwise plain WebAssembly.
  const ASR_LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";
  const ASR_MODELS = { "en-US": "onnx-community/whisper-base.en", "th-TH": "onnx-community/whisper-small" };
  const asr = { model: "", pipe: null, loading: null, busy: false };
  const ASR_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  const asrState = (t) => { const el = $("asrstate"); if (el) el.textContent = t; };
  async function getAsr(lang) {
    const model = ASR_MODELS[lang] || ASR_MODELS["en-US"];
    if (asr.pipe && asr.model === model) return asr.pipe;
    if (asr.loading && asr.model === model) return asr.loading;
    asr.model = model; asr.pipe = null;
    asr.loading = (async () => {
      const T = await import(ASR_LIB);
      T.env.allowLocalModels = false;
      const seen = {};
      const progress_callback = (p) => {
        if (p.status !== "progress" || !p.file) return;
        seen[p.file] = [p.loaded || 0, p.total || 0];
        const l = Object.values(seen).reduce((s, x) => s + x[0], 0), t = Object.values(seen).reduce((s, x) => s + x[1], 0);
        if (t) asrState(`Downloading the speech model — ${Math.min(99, Math.round(l / t * 100))}% (once only; it stays on this device)`);
      };
      // decide the device before the first load: once a WebGPU attempt fails, the runtime
      // cannot start WebAssembly on the same page any more. WebGPU only on desktop Chrome/Edge,
      // where it is known to work; phones, iPads and Safari take the plain WebAssembly path
      // (2026-09-15: a physio's English recording failed outright, most likely this)
      let gpu = false;
      const desktopChromium = /Chrome\//.test(navigator.userAgent) && !ASR_MOBILE;
      try { gpu = desktopChromium && !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { gpu = false; }
      if (gpu) return await T.pipeline("automatic-speech-recognition", model, { device: "webgpu", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" }, progress_callback });
      return await T.pipeline("automatic-speech-recognition", model, { device: "wasm", dtype: "q8", progress_callback });
    })();
    try { asr.pipe = await asr.loading; } finally { asr.loading = null; }
    return asr.pipe;
  }
  // any audio the browser can play -> mono samples at 16 kHz, which is what Whisper listens to
  async function decodeAudio(file) {
    const buf = await file.arrayBuffer();
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const probe = new Ctx(1, 16000, 16000);
    const audio = await probe.decodeAudioData(buf);
    if (audio.sampleRate === 16000 && audio.numberOfChannels === 1) return audio.getChannelData(0);
    const off = new Ctx(1, Math.ceil(audio.duration * 16000), 16000);
    const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start(0);
    const out = await off.startRendering();
    return out.getChannelData(0);
  }
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  async function transcribeAudio(file) {
    if (asr.busy) { toast("Still working on the last recording — one at a time"); return; }
    const btn = $("audiobtn"); btn.classList.add("busy"); asr.busy = true;
    const lang = S.lang || "th-TH";
    try {
      // a phone holds the whole recording decoded in memory: a long session can be too much for it
      if (ASR_MOBILE && file.size > 12 * 1024 * 1024) asrState("Long recording on a phone — if this fails, use a laptop, or open the memo in Voice Memos, copy its transcript and paste it above.");
      else asrState("Reading the recording…");
      let samples;
      try { samples = await decodeAudio(file); }
      catch (e) { throw new Error("That file could not be opened as audio — try an .m4a, .mp3 or .wav (" + (e && e.message ? String(e.message).slice(0, 80) : "decode failed") + ")"); }
      const total = samples.length / 16000;
      if (total < 0.5) throw new Error("That file has no sound in it");
      asrState(`Loading the speech model (${lang === "th-TH" ? "Thai, about 250 MB the first time" : "English, about 75 MB the first time"})…`);
      let pipe;
      try { pipe = await getAsr(lang); }
      catch (e) {
        const m = e && e.message ? String(e.message).slice(0, 140) : "";
        throw new Error(/fetch|network|load|import|Failed/i.test(m) ? "Could not download the speech engine — check the internet connection and try again (" + m + ")" : "The speech engine could not start on this device (" + m + "). Try a laptop, or paste the transcript from Voice Memos instead.");
      }
      const ta = $("transcript");
      const header = `[From recording — ${file.name}${lang === "th-TH" ? ", Thai" : ", English"}]`;
      ta.value = (ta.value.replace(/\s+$/, "") ? ta.value.replace(/\s+$/, "") + "\n\n" : "") + header + "\n";
      if (!$("trbox").open) $("trbox").open = true;
      const SEG = 240 * 16000;   // four minutes at a time, so the text appears as it goes
      // timestamps on: that is the mode where the 30-second pieces are stitched together correctly,
      // and each piece becomes its own line so the reader can work sentence by sentence
      const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true };
      if (!/\.en$/.test(asr.model)) { opts.language = lang === "th-TH" ? "thai" : "english"; opts.task = "transcribe"; }
      const t0 = Date.now();
      for (let start = 0; start < samples.length; start += SEG) {
        const done = start / 16000;
        asrState(`Transcribing… ${mmss(done)} of ${mmss(total)}${done ? ` (about ${mmss(Math.max(0, (Date.now() - t0) / 1000 / done * (total - done)))} left)` : ""}`);
        const seg = samples.subarray(start, Math.min(samples.length, start + SEG));
        const res = await pipe(seg, opts);
        const parts = ((res && res.chunks) || []).map((c) => (c.text || "").trim()).filter(Boolean);
        const text = parts.length ? parts.join("\n") : ((res && res.text) || "").trim();
        if (text) { ta.value = ta.value.replace(/\s+$/, "") + "\n" + text; ta.dispatchEvent(new Event("input")); }
        await new Promise((r) => setTimeout(r, 0));
      }
      asrState(`Recording transcribed (${mmss(total)}) — read it through; speech recognition mishears names, numbers and Thai-English switches.`);
      setTimeout(() => asrState(""), 12000);
      toast("Recording transcribed");
    } catch (err) {
      console.error(err);
      const msg = (err && err.message) || "The recording could not be transcribed";
      asrState(msg + " — you can still open the memo in Voice Memos, copy its transcript and paste it above.");   // stays on screen, so it can be screenshotted
      toast(msg.slice(0, 120));
    } finally { btn.classList.remove("busy"); asr.busy = false; }
  }

  // ---------- transcript panel ----------
  function renderNums() {
    const nums = numbersHeard($("transcript").value || ""); const host = $("nums");
    const words = ($("transcript").value || "").trim().split(/\s+/).filter(Boolean).length;
    $("trsum").textContent = words ? `Session notes — ${words} words` : "Session notes — paste, speak, or photograph the patient's chart";
    if (!nums.length) { host.innerHTML = ""; return; }
    host.innerHTML = `<p class="sub">${nums.length} number${nums.length > 1 ? "s" : ""} heard — check each, then type it in yourself</p>` +
      `<div class="nums">${nums.slice(0, 25).map(([v, c]) => `<div><b>${escapeHtml(v)}</b> <span>…${escapeHtml(c)}…</span></div>`).join("")}</div>`;
  }

  // ---------- condition search ----------
  const ALL_DX = Object.values(V.DIAGNOSES).flat();
  // the conditions BPC physios actually wrote in Jane (suggest.js), shown the way they wrote them
  const ACRONYM = /\b(acl|aclr|pcl|mcl|lcl|mpfl|plc|sij|hnp|mps|itb|tmj|oa|ra|ddd|slap|dvt|tfcc|pfps|cts|ue|le|rom|mri|c[1-7]|t[1-9]|t1[0-2]|l[1-5]|s[1-2]|c-spine|l-spine|t-spine)\b/gi;
  const dxDisplay = (k) => { let s = String(k).replace(/\s*\([^)]*$/, "").replace(/^[\s\-–•.]+/, "").replace(/\s+/g, " ").trim(); if (!s) return ""; s = s.charAt(0).toUpperCase() + s.slice(1); return s.replace(ACRONYM, (m) => m.toUpperCase()); };
  const SG_NAME = {};   // shown name -> suggest.js key
  const CHART_DX = SG ? Object.entries(SG.conditions).map(([k, v]) => [dxDisplay(k), k, v.n]).filter(([d]) => d.length >= 3) : [];
  CHART_DX.forEach(([d, k]) => { SG_NAME[d.toLowerCase()] = k; });
  // The crawl of the clinic's charts scraped a diagnosis field that physios also use as a scratch pad, so the
  // condition list carries 54 entries that are not conditions: a bare side ("Left", "Right", "Both", "N/a"),
  // force-plate printouts ("May: 293, 312, 363 n → avg ≈ 323 n", "👉 +35 n improvement", "30%=46.95mmhg"),
  // and notes to self ("** need more investigation; MRI, x-rays"). Typing "left" offered "Left" as a
  // diagnosis. They are hidden from the search here rather than regenerated, because the tally that built
  // suggest.js is not in the repo (found by the 2026-09-23 sweep of all 2,496 names).
  // …and 117 more are a sentence of analysis, not a diagnosis ("Due to the exercise make the muscle tensions",
  // "Knee ROM acully better, still need to work on his strength") — one physio's habit of writing prose there.
  const JUNK_DX = /[👉✅→≈]|^\s*(?:left|right|both|lt\.?|rt\.?|yes|no|n\/a|nil|none|-+)\s*$|avg\b|\bimprovement\b|^\s*\d+\s*[.)%]|=\s*\d|\bmmhg\b|^\s*\*{2,}|need more investigation|^\s*due to\b|\bmake the\b|\b(?:her|his|she|he|they|them)\b|\bgetting (?:better|worse)\b|\bfeels?\b|\bcomplain/i;
  const junkCondition = (d) => JUNK_DX.test(String(d).trim());
  function renderDx() {
    const q = ($("dxq").value || "").trim().toLowerCase(); const host = $("dxhits"); host.innerHTML = "";
    if (!q) return;
    const toks = q.split(/\s+/).filter(Boolean);
    const matches = (d) => { const l = d.toLowerCase(); return toks.every((t) => l.includes(t)); };
    const seen = new Set(); const hits = [];
    const addHit = (d, n) => { const l = d.toLowerCase(); if (seen.has(l)) return; seen.add(l); hits.push([d, n]); };
    // the library first (a name that starts with what was typed before one that merely contains it), then the clinic's charts by how often they wrote it
    ALL_DX.filter(matches).sort((x, y) => (y.toLowerCase().startsWith(q) ? 1 : 0) - (x.toLowerCase().startsWith(q) ? 1 : 0)).forEach((d) => addHit(d, 0));
    CHART_DX.filter(([d]) => matches(d) && !junkCondition(d)).sort((x, y) => y[2] - x[2]).forEach(([d, k, n]) => addHit(d, n));
    const target = S.format === "SOAP with treatment" ? "Analysis" : "Diagnosis";
    if (!hits.length) { host.innerHTML = `<span class="hint">Not in the library — type it straight into ${target}. That is always allowed.</span>`; return; }
    hits.slice(0, 14).forEach(([h, n]) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = h; if (n) b.title = `Written in ${n} BPC charts`; b.onclick = () => { setCondition(h); $("dxq").value = ""; renderDx(); }; host.appendChild(b); });
  }

  // ---------- init ----------
  const CAPTIONS = { "SOAP with treatment": "Every follow-up visit", "New patient's record": "First visit or a consultation",
    "Physiotherapy Report": "Report for the patient, employer or insurer" };
  // New patient's record first (and selected), SOAP with treatment second, then the rest in their own order
  const FORMAT_ORDER = ["New patient's record", "SOAP with treatment"].filter((f) => V.OUTPUT_FORMATS[f]);
  Object.keys(V.OUTPUT_FORMATS).forEach((f) => { if (!FORMAT_ORDER.includes(f)) FORMAT_ORDER.push(f); });
  if (!V.OUTPUT_FORMATS[S.format]) S.format = FORMAT_ORDER[0];
  FORMAT_ORDER.forEach((f) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="fmt" value="${f}" ${f === S.format ? "checked" : ""}><b>${f}</b><small>${CAPTIONS[f] || ""}</small>`;
    l.querySelector("input").onchange = () => {
      S.format = f; S.auto = {}; $("tt").disabled = f !== "SOAP with treatment";
      $("lastbox").hidden = f === "New patient's record"; // a new patient has no last note
      if (S.condition && !hasLine(dxField(), S.condition)) append(dxField(), S.condition, "", true);
      renderBuilder(); renderOutput(); renderDx(); autoFill(); renderCondTag();
    };
    $("formats").appendChild(l);
  });
  // the page opens on the New patient's record: no treatment count, no "last note" box
  $("tt").disabled = S.format !== "SOAP with treatment"; $("lastbox").hidden = S.format === "New patient's record";
  V.REGIONS.forEach((r) => { const o = document.createElement("option"); o.value = r; o.textContent = r; $("region").appendChild(o); });
  $("region").onchange = (e) => { S.region = e.target.value; S.regionManual = true; S.regionFromCond = false; renderBuilder(); prefillTests(); applyPack(); autoFill(); };
  $("tt").oninput = renderOutput; $("patient").oninput = renderOutput;
  $("dxq").oninput = renderDx;
  $("dxq").onkeydown = (e) => {
    if (e.key !== "Enter") return; e.preventDefault();
    const q = ($("dxq").value || "").trim(); if (!q) return;
    // Enter takes what the physio typed when that is a condition in its own right: an exact match among the
    // suggestions, or an abbreviation / a name with a side ("MPS", "PFPS", "Lt. CTS"). Typing "MPS" + Enter used
    // to pick the first suggestion, "MPS at upper trapezius", and open the neck. Otherwise: the first suggestion.
    const hits = [...$("dxhits").querySelectorAll("button")];
    const exact = hits.find((b) => b.textContent.trim().toLowerCase() === q.toLowerCase());
    const isAbbrev = /^[A-Za-z]{2,6}$/.test(q) && (q === q.toUpperCase() || /^(mps|oa|ra|doms)$/i.test(q) || CONDITION_REGION.slice(0, 8).some(([re]) => re.test(q)));   // "PFPS", "lbp", "MPS" — not "frozen"
    const ownName = isAbbrev ||/\b(lt|rt|left|right|both|bilateral)\b/i.test(q) || q.split(/\s+/).length >= 3;
    setCondition(exact ? exact.textContent : isAbbrev ? q.toUpperCase() : ownName || !hits.length ? q : hits[0].textContent); $("dxq").value = ""; renderDx();
  };
  $("sides").querySelectorAll("button").forEach((b) => b.onclick = () => { S.sideManual = true; setSide(b.dataset.s); renderCondTag(); renderBuilder(); });
  $("region").addEventListener("change", () => { S.showAll = false; prefillTests(); });
  $("transcript").oninput = () => { renderNums(); renderBuilder(); scheduleFill(); scheduleSmart(); };
  const langName = () => (S.lang === "en-US" ? "English" : "Thai");
  const micLabel = () => { document.querySelectorAll("button.mic[data-target]").forEach((b) => { if (!b.classList.contains("on")) b.textContent = `🎙 Dictate (${langName()})`; }); };
  $("langs").querySelectorAll("button").forEach((b) => b.onclick = () => {
    S.lang = b.dataset.l; $("langs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    micLabel();
    if (active) { const btn = active.btn; stopMic(); btn.click(); toast(`Now listening in ${langName()}`); }   // switch mid-dictation
  });
  micLabel();
  wireMic($("trmic"));
  initAiBox();
  $("photo").onchange = (e) => { const files = [...e.target.files]; e.target.value = ""; if (files.length) readPhotos(files); };
  $("audio").onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) transcribeAudio(f); };
  $("lastnote").addEventListener("paste", () => setTimeout(useLastNote, 50));
  $("uselast").onclick = useLastNote;
  $("clearlast").onclick = () => { $("lastnote").value = ""; $("laststate").textContent = ""; };
  $("copy").onclick = copyNote;
  $("clear").onclick = () => { if (!confirm("Clear the whole draft? Nothing was saved anyway.")) return; S.fields = {}; S.auto = {}; S.aiFor = ""; S.photoRead = false; S.aiLines = []; S.aiConds = []; S.moreConditions = []; smart.last = ""; smartState(""); S.regionManual = false; S.sideAuto = false; S.conditionGuess = false; S.regionFromCond = false; S.sideFromCond = false;
    // the next patient is not the last patient: the region went with the draft, or the region's usual
    // tests were never re-listed for them (found 2026-09-22 while checking draft 37)
    S.region = "General / other"; $("region").value = S.region; S.packChips = {}; S.packLines = {}; S.ttSuffix = ""; S.condition = ""; S.conditionAuto = false; S.sideManual = false; S.showAll = false; S.prefilled = new Set(); renderCondTag(); setSide(""); $("lastnote").value = ""; $("laststate").textContent = ""; $("transcript").value = ""; $("tt").value = ""; $("patient").value = ""; $("dxq").value = ""; $("fillstate").textContent = ""; renderNums(); renderBuilder(); renderOutput(); renderDx(); };
  window.addEventListener("beforeunload", stopMic);

  renderBuilder(); renderOutput(); renderNums();
  // read-only hooks for testing: the condition -> region / side tables, and the photo/notes sorting
  // (cleanPhotoReading + placePhotoFields replay a saved batch of readings without calling the reader again)
  window.__bpcDebug = { regionForCondition, sideForCondition, cleanPhotoReading, placePhotoFields, val, setCondition, clearCondition,
    conditionNames: () => (SG ? Object.keys(SG.conditions).map(dxDisplay) : []),
    fields: () => Object.fromEntries([...document.querySelectorAll("#builder textarea[data-field]")].filter((t) => t.value.trim()).map((t) => [t.dataset.field, t.value])) };
})();
