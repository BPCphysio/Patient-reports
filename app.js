/* BPC Charting Assistant — runs entirely in the browser.
   Nothing here is sent anywhere. The note lives in memory until it is copied
   into Jane, and disappears when the tab closes.

   Numbers are never filled in automatically. Every measurement lands as ___. */

(function () {
  const V = window.VOCAB;
  const BLANK = V.BLANK;
  const $ = (id) => document.getElementById(id);

  // ---------- state ----------
  const S = {
    format: "SOAP with treatment",
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
  const romLine = (m) => `${m}; Rt. ${BLANK}°/${BLANK}°/${BLANK}° Lt. ${BLANK}°/${BLANK}°/${BLANK}°`;
  const circLine = () => `Circumference ${BLANK}; Rt. ${BLANK} cm, Lt. ${BLANK} cm`;
  const forceLine = (m) => `${m}; Max force Rt. ${BLANK} N, Lt. ${BLANK} N`;
  const vasLine = () => `VAS ${BLANK}/10`;
  const testLine = (n) => `${n}: ${BLANK}ve`;
  const palpLine = (f, m, s) => `${f} at ${s ? s + " " : ""}${m} m.`;
  const exLine = (e, d) => `${e} — ${d || BLANK}`;

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
    if (heading === "PastHistory" && f !== "New patient's record") heading = "";
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
      return { subjective: ["Chief complaint", ""], analysis: ["Diagnosis", ""], plan: null, treatment: ["Treatment", ""], exercise: ["Treatment", "Exercise"], problem: ["Problem list", ""] }[sec];
    }
    if (f === "Physiotherapy Report") {
      return { subjective: ["Chief Complaint", ""], objective: ["Physical Examinations", heading], analysis: ["Diagnosis", ""], plan: ["Recommendation", ""],
        treatment: ["Physiotherapy Treatments", ""], exercise: ["Physiotherapy Treatments", "Exercise"], problem: null }[sec];
    }
    return { subjective: ["Chief complaint", ""], objective: ["Physical examinations", heading], analysis: ["Diagnosis", ""], plan: ["Physician's recommendations", ""],
      treatment: ["Treatments", ""], exercise: ["Treatments", "Exercise"], problem: null }[sec];
  }
  function autoFill() {
    const text = $("transcript").value || "";
    let res = DETECT.run(text, S.region);
    if (res.side && !S.sideManual && res.side !== S.side) { setSide(res.side, true); renderCondTag(); }
    S.sideAuto = !!res.side;   // a side heard in the notes ("my left leg") survives a spine condition
    // the region the notes are about changes what counts as a movement, a test or an exercise: read them again with it
    if (res.region && !S.regionManual && res.region !== S.region) { S.region = res.region; $("region").value = res.region; renderBuilder(); prefillTests(); res = DETECT.run(text, S.region); }
    if (res.tt && !$("tt").value.trim()) $("tt").value = res.tt;
    // adopt the first diagnosis heard as the condition before placing lines, so it is not added twice
    // the condition is the first specific diagnosis heard; a generic one (muscle imbalance, poor posture)
    // only when nothing more specific was said
    const GENERIC = /^(?:rt\.|lt\.|both)?\s*(muscle imbalance|poor posture|postural dysfunction|muscle tightness|general muscle tightness|muscle tension|muscle spasm|muscle strain|overuse|swelling|scoliosis|itb tightness)$/i;
    const dxLines = res.lines.filter((l) => l.sec === "analysis");
    const heardDx0 = dxLines.find((l) => !GENERIC.test(l.line)) || dxLines[0];
    if (heardDx0 && (!S.condition || S.conditionAuto)) { const nm = heardDx0.line.replace(/^(Rt\.|Lt\.|Both) /, ""); if (nm !== S.condition) setCondition(nm, true); }
    else if (!heardDx0 && S.condition && S.conditionAuto && !S.conditionGuess) { S.condition = ""; S.conditionAuto = false; renderCondTag(); }
    let guessed = null;
    if (!heardDx0 && (!S.condition || S.conditionGuess)) {
      const g = guessCondition(res);
      if (g && g.name !== S.condition) { setCondition(g.name, true); S.conditionGuess = true; guessed = g; }
      else if (!g && S.conditionGuess) { S.condition = ""; S.conditionAuto = false; S.conditionGuess = false; renderCondTag(); }
      else if (g) guessed = g;
    } else if (heardDx0) S.conditionGuess = false;
    const wanted = {};
    res.lines.forEach((l) => {
      const t = target(l.sec, l.heading); if (!t || !t[0]) return;
      let line = l.line;
      // the chosen condition is already in the box; do not add it again with a side
      if (l.sec === "analysis" && S.condition && line.replace(/^(Rt\.|Lt\.|Both) /, "").toLowerCase() === S.condition.toLowerCase()) return;
      if (S.format === "New patient's record" && t[0] === "Pain scale") line = res.vas || line;
      if (l.sec === "treatment" && !t[1]) line = fillTreatmentBlanks(line, res);
      (wanted[t[0]] = wanted[t[0]] || []).push({ heading: t[1] || "", line });
    });
    const key = (x) => x.heading + "" + x.line;
    let count = 0;
    new Set([...Object.keys(S.auto), ...Object.keys(wanted)]).forEach((field) => {
      const prev = S.auto[field] || [], next = wanted[field] || [];
      const nextKeys = new Set(next.map(key)), prevKeys = new Set(prev.map(key));
      prev.filter((p) => !nextKeys.has(key(p))).forEach((p) => removeLine(field, p.line));
      next.filter((w) => !prevKeys.has(key(w))).forEach((w) => {
        if (/(\+ve|-ve|___ve)\s*$/.test(w.line)) removeBlankTest(field, w.line); // a read result replaces the prefilled blank
        if (!hasLine(field, w.line)) append(field, w.line, w.heading, true);
      });
      S.auto[field] = next; count += next.length;
    });
    renderOutput(); scheduleSuggest(); syncChips();
    const st = $("fillstate");
    if (st) st.textContent = !text.trim() ? "" : count ? `${count} line${count > 1 ? "s" : ""} filled into section 2 from these notes — check each one, then edit or delete freely.${guessed ? ` No diagnosis was said, so the condition is the clinic's closest match to these findings: ${guessed.name} (${guessed.matched} findings in common with ${guessed.n} charts) — remove it if that is not what you found.` : ""}` : "Nothing recognised yet — keep going, or use the options in section 2.";
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
  }
  function chips(terms, field, heading, transform) {
    const wrap = document.createElement("div"); wrap.className = "chips";
    const { ordered, heard } = orderByTranscript(terms);
    ordered.forEach((t) => {
      const b = document.createElement("button"); b.type = "button";
      const line = transform ? transform(t) : t;
      b.className = "chip" + (heard.has(t) ? " heard" : ""); b.textContent = t; b.dataset.field = field; b.dataset.line = line;
      if (heard.has(t)) b.title = "Heard in the transcript";
      if (lineInField(field, line)) b.classList.add("on");
      b.onclick = () => {
        const current = transform ? transform(t) : t; b.dataset.line = current;
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
    const w = document.createElement("div"); w.className = "fld";
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
    const w = document.createElement("div"); w.className = "fld";
    const head = document.createElement("div"); head.className = "head";
    const b = document.createElement("b"); b.textContent = "Pain scale"; head.appendChild(b);
    w.appendChild(head);
    const row = document.createElement("div"); row.className = "chips";
    const paint = () => { const cur = val("Pain scale"); row.querySelectorAll("button").forEach((btn) => btn.classList.toggle("on", btn.dataset.line === cur)); };
    for (let n = 0; n <= 10; n++) {
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "chip sel";
      btn.textContent = String(n); btn.dataset.line = String(n); btn.dataset.pain = "1";
      btn.onclick = () => { const line = String(n); S.fields["Pain scale"] = val("Pain scale") === line ? "" : line; paint(); renderOutput(); };
      row.appendChild(btn);
    }
    paint();
    w.appendChild(row);
    return w;
  }

  // ---------- the condition in play ----------
  // Chosen from the search box (or adopted from the notes). It stays in the
  // Analysis/Diagnosis box, sets the body region, and drives the suggestions.
  const GROUP_REGION = { "Neck & upper back": "Neck / cervical", "Shoulder": "Shoulder", "Elbow, wrist & hand": "Elbow, wrist & hand",
    "Low back & pelvis": "Trunk / lumbar", "Hip & thigh": "Hip", "Knee": "Knee", "Ankle & foot": "Ankle & foot" };
  const dxField = () => (S.format === "SOAP with treatment" ? "Analysis" : "Diagnosis");
  const CONDITION_REGION = [
    [/\b(acl|pcl|mcl|lcl|aclr)\b|meniscus|meniscal|patell|knee|itb|runner'?s|jumper'?s|osgood|chondromalacia|baker|genu|tibial plateau/i, "Knee"],
    [/ankle|atfl|cfl|achilles|plantar|heel|shin|foot|toe|hallux|calf|gastroc|soleus|peroneal|tibialis|bunion|morton/i, "Ankle & foot"],
    [/shoulder|rotator|supraspinatus|infraspinatus|subscap|impingement|frozen|adhesive|labr|slap|ac joint|biceps tend|bursitis of the shoulder|glenohumeral|scapul/i, "Shoulder"],
    [/\bhip\b|gluteal|glute|trochanter|femoroacetabular|\bfai\b|hamstring|groin|adductor|quadriceps strain|thigh/i, "Hip"],
    [/elbow|epicondyl|tennis|golfer|wrist|carpal|de quervain|trigger finger|hand|finger|thumb|tfcc|forearm|cubital/i, "Elbow, wrist & hand"],
    [/scoliosis|kyphosis|thoracic|rib|costo/i, "Thoracic spine"],
    [/office syndrome|upper cross|myofascial|mps|text neck|headache|torticollis|whiplash|cervical|neck/i, "Neck / cervical"],
    [/lower cross|low back|lumbar|disc|hnp|sciatic|spondyl|stenosis|sij|sacroiliac|coccy|pelvic|piriformis/i, "Trunk / lumbar"],
    [/postur/i, "Thoracic spine"],
  ];
  function regionForCondition(name) {
    const lc = name.toLowerCase();
    for (const [group, list] of Object.entries(V.DIAGNOSES)) if (list.some((d) => d.toLowerCase() === lc) && GROUP_REGION[group]) return GROUP_REGION[group];
    for (const [re, region] of CONDITION_REGION) if (re.test(name)) return region;
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
  function setCondition(name, auto) {
    name = (name || "").trim(); if (!name) return;
    const f = dxField();
    if (S.condition && S.condition !== name && S.conditionAuto !== false) removeLine(f, S.condition);
    S.condition = name; S.conditionAuto = !!auto;
    if (!hasLine(f, name)) append(f, name, "", true);
    const r = regionForCondition(name);
    if (r && r !== S.region && (r !== "General / other" || !S.region || S.region === "General / other")) { S.region = r; $("region").value = r; }
    // spine, posture and whole-body conditions have no side: scoliosis, low back, neck, MPS…
    if ((MIDLINE.has(S.region) || /scoliosis|posture|spine|spinal|lumbar|cervical|thoracic|core|pelvic|coccy/i.test(name)) && !S.sideManual && !S.sideAuto) setSide("", true);
    S.showAll = false;
    renderBuilder(); prefillTests(); applyPack(); renderOutput(); renderCondTag(); renderSuggest();
  }
  // The usual special tests for this region appear in Objective with the result blank.
  // The physio deletes the ones not done and marks the rest + or -. A result read from
  // the notes replaces the blank line for that test (see autoFill).
  const testName = (line) => line.replace(/\s*(Rt\.|Lt\.|Both)?\s*:\s*(\+ve|-ve|___ve)\s*$/, "").trim();
  // scoliosis, ACL, frozen shoulder…: the lines a BPC new-patient record carries for them.
  // Two sources, merged: the hand-written routine (V.CONDITION_PACKS) for conditions whose
  // charts are mostly prose, and the measurement templates read straight from this
  // condition's own charts (suggest.js "p" — numbers blanked, only lines repeated
  // across 3+ charts). Both can fire together; lines already in the box are skipped.
  function applyPack() {
    if (!S.condition) return;
    const handKey = V.CONDITION_PACKS ? Object.keys(V.CONDITION_PACKS).find((re) => new RegExp(re, "i").test(S.condition)) : null;
    const hit = SG ? findCondition(currentCondition()) : null;
    const chartPack = hit && hit[1].p ? hit[1].p : null;
    if (!handKey && !chartPack) return;
    const packKey = (handKey || "") + "|" + (hit ? hit[0] : "");
    if (S.packApplied === packKey) return; S.packApplied = packKey;
    const merged = {};
    if (chartPack) Object.entries(chartPack).forEach(([heading, lines]) => { merged[heading] = (merged[heading] || []).concat(lines); });
    if (handKey) Object.entries(V.CONDITION_PACKS[handKey]).forEach(([heading, lines]) => { merged[heading] = (merged[heading] || []).concat(lines); });
    Object.entries(merged).forEach(([heading, lines]) => {
      const sec = heading === "Exercise" ? "exercise" : "objective";
      const t = target(sec, heading); if (!t || !t[0]) return;
      lines.forEach((line) => { if (!hasLine(t[0], line)) append(t[0], line, t[1] || "", true); });
    });
    renderOutput();
  }
  function prefillTests() {
    const P = V.REGION_PROFILE[S.region]; if (!P || S.region === "General / other") return;
    const t = target("objective", "Special test"); if (!t || !t[0]) return;
    const field = t[0], heading = t[1] || "";
    const hit = S.condition && SG ? findCondition(currentCondition()) : null;
    const known = new Set(V.SPECIAL_TESTS);
    // the tests physios record for this condition go first; the rest of the region's usual tests follow
    const fix = (n) => (S.region === "Ankle & foot" && n === "Anterior drawer (knee)" ? "Anterior drawer (ankle)" : n);
    const condTests = hit && hit[1].t ? hit[1].t.map(fix).filter((n) => known.has(n) && P.tests.includes(n)) : [];
    const testList = [...condTests, ...P.tests.filter((n) => !condTests.includes(n))];
    const have = new Set(val(field).split("\n").map((l) => l.trim()).filter((l) => /(\+ve|-ve|___ve)\s*$/.test(l)).map(testName));
    S.prefilled = S.prefilled || new Set();
    testList.forEach((name) => { if (have.has(name)) return; append(field, `${name}${S.side && S.side !== "Both" ? " " + S.side : ""}: ${BLANK}ve`, heading, true); S.prefilled.add(name); });
    renderOutput();
  }
  function removeBlankTest(field, line) {
    const name = testName(line);
    val(field).split("\n").forEach((l) => { if (testName(l.trim()) === name && /___ve\s*$/.test(l) && l.trim() !== line.trim()) removeLine(field, l.trim()); });
  }
  function clearPrefilledTests() {
    if (!S.prefilled) return;
    V.OUTPUT_FORMATS[S.format].forEach((field) => val(field).split("\n").forEach((l) => { if (/___ve\s*$/.test(l) && S.prefilled.has(testName(l.trim()))) removeLine(field, l.trim()); }));
    S.prefilled = new Set();
  }
  const MIDLINE = new Set(["Neck / cervical", "Thoracic spine", "Trunk / lumbar", "General / other"]);
  function clearCondition() {
    if (S.condition) removeLine(dxField(), S.condition);
    S.condition = ""; S.conditionAuto = false;
    clearPrefilledTests();
    renderCondTag(); renderOutput(); renderSuggest();
  }
  function renderCondTag() {
    const host = $("dxsel"); host.innerHTML = "";
    if (!S.condition) { host.hidden = true; $("dxq").placeholder = "Type what you found — plantar, MPS, ACL, frozen shoulder…"; return; }
    host.hidden = false; $("dxq").placeholder = "Add another condition…";
    const tag = document.createElement("span"); tag.className = "tag";
    tag.innerHTML = `<span>${escapeHtml(S.condition)}</span><small>${escapeHtml(S.region)}${S.side ? " · " + escapeHtml(S.side) : " · no side"}${S.conditionGuess ? " · closest match in the charts" : ""}</small>`;
    const x = document.createElement("button"); x.type = "button"; x.title = "Remove this condition"; x.textContent = "×"; x.onclick = clearCondition;
    tag.appendChild(x); host.appendChild(tag);
  }
  function setSide(s, quiet) {
    S.side = s; $("sides").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.s === s));
    // blank prefilled tests take the new side
    const t = target("objective", "Special test");
    if (t && t[0] && S.prefilled && S.prefilled.size) {
      const lines = val(t[0]).split("\n"); let changed = false;
      const next = lines.map((l) => { const tl = l.trim(); if (!/___ve\s*$/.test(tl) || !S.prefilled.has(testName(tl))) return l; const nl = `${testName(tl)}${s && s !== "Both" ? " " + s : ""}: ${BLANK}ve`; if (nl !== tl) changed = true; return l.replace(tl, nl); });
      if (changed) { S.fields[t[0]] = next.join("\n"); updateTa(t[0]); renderOutput(); }
    }
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
    return s.replace(/\s+/g, " ").replace(/\s+([,.;:)])/g, "$1").replace(/\(\s+/g, "(").trim();
  }
  // Lines that already exist as standard options below the box are not repeated as suggestions.
  // a line about another part of the body has no place in this note (a neck case does not get the hamstrings)
  function offRegion(text) {
    if (isGeneral() || !DETECT.regionsOf) return false;
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
    if (!SG) return;
    const q = currentCondition(); const hit = q ? findCondition(q) : null;
    document.querySelectorAll(".sugg").forEach((box) => {
      box.innerHTML = ""; const field = box.dataset.for;
      if (!hit) return; // nothing until a condition is chosen
      const labels = EQUIV[field] || [field];
      let lines = [];
      for (const l of labels) { if (hit[1].s[l] && hit[1].s[l].length) { lines = hit[1].s[l]; break; } }
      if (!lines.length) return;
      const seen = new Set();
      const shown = lines.map(([line]) => withSide(line)).filter((t) => {
        const k = t.toLowerCase(); if (!t || seen.has(k) || hasLine(field, t)) return false;
        if (S.condition && k === S.condition.toLowerCase()) return false;
        if (field === "Analysis" || field === "Diagnosis") { const same = findCondition(t.toLowerCase()); if (same && same[0] === hit[0]) return false; }   // the condition itself under another spelling
        if (/^dx:?\s/i.test(t)) return false;
        if (offRegion(t)) return false;
        seen.add(k); return true;
      }).slice(0, 12);
      if (!shown.length) return;
      const p = document.createElement("p"); p.className = "sub";
      p.textContent = `For ${hit[0]} (${hit[1].n} BPC charts) — tap to add` + (S.side ? `, side ${S.side}` : "");
      box.appendChild(p);
      const wrap = document.createElement("div"); wrap.className = "chips";
      shown.forEach((t) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip sg"; b.textContent = t; b.onclick = () => { append(field, t, ""); renderSuggest(); }; wrap.appendChild(b); });
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
  function objectiveExtras(host, field) {
    const region = S.region, P = profile();
    let [d, b] = details("Observation");
    b.appendChild(chips([...P.observation, ...(V.OBSERVATION_BY_REGION[region] || [])], field, "Observation")); showAllLink(b); host.appendChild(d);

    [d, b] = details(isGeneral() ? "Palpation — pick the finding, then the muscle" : `Palpation — pick the finding, then the muscle (${S.region.toLowerCase()})`);
    const groups = P.muscle_groups.filter((g) => V.MUSCLES[g]);
    let finding = V.PALPATION_FINDINGS[1] || V.PALPATION_FINDINGS[0], side = S.side || "";
    const musclesHere = [...new Set(groups.flatMap((g) => V.MUSCLES[g]))];
    const findRow = document.createElement("div"); findRow.className = "chips";
    const musWrap = document.createElement("div");
    const palpLineX = (f, m, s) => (V.MUSCLES["Ligaments & structures"] || []).includes(m) ? `${f} at ${s ? s + " " : ""}${m}` : palpLine(f, m, s);
    const redraw = () => { musWrap.innerHTML = ""; musWrap.appendChild(sub(`${finding}${side ? " · " + side : ""} — at which muscle?`)); musWrap.appendChild(chips(musclesHere, field, "Palpation", (m) => palpLineX(finding, m, side))); };
    V.PALPATION_FINDINGS.forEach((f) => { const fb = document.createElement("button"); fb.type = "button"; fb.className = "chip sel" + (f === finding ? " on" : ""); fb.textContent = f; fb.onclick = () => { finding = f; findRow.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === fb)); redraw(); }; findRow.appendChild(fb); });
    const sideRow = document.createElement("div"); sideRow.className = "row3";
    const sideSel = selectEl(["", ...V.SIDES], (e) => { side = e.target.value; redraw(); }); sideSel.value = side; sideRow.appendChild(sideSel);
    b.appendChild(findRow); b.appendChild(sideRow); b.appendChild(musWrap); redraw();
    if (V.PALPATION_NORMALS) { b.appendChild(sub("Nothing found")); b.appendChild(chips(V.PALPATION_NORMALS, field, "Palpation")); }
    const circ = document.createElement("button"); circ.type = "button"; circ.className = "chip"; circ.textContent = "+ Circumference line";
    circ.onclick = () => append(field, circLine(), "Palpation"); b.appendChild(circ);
    host.appendChild(d);

    [d, b] = details("Range of motion");
    const moves = V.ROM_BY_REGION[region] || V.ROM_GENERAL;
    const r2 = document.createElement("div"); r2.className = "row2";
    const c1 = document.createElement("div"); c1.appendChild(sub("Active")); c1.appendChild(chips(moves, field, "Active range of motions", romLine));
    const c2 = document.createElement("div"); c2.appendChild(sub("Passive")); c2.appendChild(chips(moves, field, "Passive range of motions", romLine));
    r2.appendChild(c1); r2.appendChild(c2); b.appendChild(r2);
    b.appendChild(sub("In words instead")); b.appendChild(chips(V.ROM_QUALIFIERS, field, "Active range of motions"));
    if (V.ACCESSORY_BY_REGION[region]) { b.appendChild(sub("Accessory movement")); b.appendChild(chips(V.ACCESSORY_BY_REGION[region], field, "Accessory movement")); }
    host.appendChild(d);

    [d, b] = details("Muscle power & function");
    b.appendChild(chips(V.STRENGTH, field, "Muscle power"));
    b.appendChild(sub("Dynamometer force")); b.appendChild(chips(moves, field, "Muscle power", forceLine));
    b.appendChild(sub("Functional tests")); b.appendChild(chips([...new Set([...P.functional, ...(V.FUNCTIONAL_BY_REGION[region] || [])])], field, "Functional test"));
    if (P.functional.includes("Overhead squat") || isGeneral()) { b.appendChild(sub("Overhead squat")); b.appendChild(chips(V.OVERHEAD_SQUAT, field, "Functional test")); }
    if (P.neuro) b.appendChild(chips(V.PAIVMS, field, "PAIVMS"));
    host.appendChild(d);

    [d, b] = details(P.neuro ? "Special tests & neurological" : "Special tests", true);
    const testChips = chips(P.tests, field, "Special test", (n) => `${n}${S.side && S.side !== "Both" ? " " + S.side : ""}: ${BLANK}ve`);
    b.appendChild(testChips);
    if (P.neuro) { b.appendChild(chips(V.NEURO_PHRASES, field, "Neurological examination")); b.appendChild(chips(V.MYOTOMES, field, "Myotome")); }
    showAllLink(b);
    host.appendChild(d);

    [d, b] = details("Pain score");
    const vas = document.createElement("button"); vas.type = "button"; vas.className = "chip"; vas.textContent = "+ VAS ___/10";
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

  const CHIPS_FOR = {
    "Observation": () => profile().observation, "Palpation": () => V.PALPATION_FINDINGS,
    "Muscle power": () => V.STRENGTH, "PAIVMS": () => V.PAIVMS, "Functional test": () => profile().functional,
    "Special test": () => profile().tests.map((n) => `${n}${S.side && S.side !== "Both" ? " " + S.side : ""}: ${BLANK}ve`), "Neurological examination": () => V.NEURO_PHRASES,
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
    const host = $("builder"); host.innerHTML = "";
    setTimeout(renderSuggest, 0);
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
        b.appendChild(chips(moves, f, "", romLine));
        b.appendChild(sub("In words instead")); b.appendChild(chips(V.ROM_QUALIFIERS, f, ""));
        if (f === "Active range of motions" && V.ACCESSORY_BY_REGION[S.region]) { b.appendChild(sub("Accessory movement")); b.appendChild(chips(V.ACCESSORY_BY_REGION[S.region], f, "")); }
        host.appendChild(d);
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
    renderSections();
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
  async function readPhotos(files) {
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
      setTimeout(() => ocrState(""), 6000);
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
      // cannot start WebAssembly on the same page any more
      let gpu = false;
      try { gpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { gpu = false; }
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
      asrState("Reading the recording…");
      const samples = await decodeAudio(file);
      const total = samples.length / 16000;
      if (total < 0.5) throw new Error("That file has no sound in it");
      asrState("Loading the speech model…");
      const pipe = await getAsr(lang);
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
      console.error(err); asrState("");
      toast(/decod/i.test(String(err && err.message)) ? "That file could not be opened as audio — try an .m4a, .mp3 or .wav" : (err && err.message) || "The recording could not be transcribed");
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
  function renderDx() {
    const q = ($("dxq").value || "").trim().toLowerCase(); const host = $("dxhits"); host.innerHTML = "";
    if (!q) return;
    const toks = q.split(/\s+/).filter(Boolean);
    const matches = (d) => { const l = d.toLowerCase(); return toks.every((t) => l.includes(t)); };
    const seen = new Set(); const hits = [];
    const addHit = (d, n) => { const l = d.toLowerCase(); if (seen.has(l)) return; seen.add(l); hits.push([d, n]); };
    // the library first (a name that starts with what was typed before one that merely contains it), then the clinic's charts by how often they wrote it
    ALL_DX.filter(matches).sort((x, y) => (y.toLowerCase().startsWith(q) ? 1 : 0) - (x.toLowerCase().startsWith(q) ? 1 : 0)).forEach((d) => addHit(d, 0));
    CHART_DX.filter(([d]) => matches(d)).sort((x, y) => y[2] - x[2]).forEach(([d, k, n]) => addHit(d, n));
    const target = S.format === "SOAP with treatment" ? "Analysis" : "Diagnosis";
    if (!hits.length) { host.innerHTML = `<span class="hint">Not in the library — type it straight into ${target}. That is always allowed.</span>`; return; }
    hits.slice(0, 14).forEach(([h, n]) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = h; if (n) b.title = `Written in ${n} BPC charts`; b.onclick = () => { setCondition(h); $("dxq").value = ""; renderDx(); }; host.appendChild(b); });
  }

  // ---------- init ----------
  const CAPTIONS = { "SOAP with treatment": "Every follow-up visit", "New patient's record": "First visit or a consultation",
    "Physiotherapy Report": "Report for the patient, employer or insurer" };
  Object.keys(V.OUTPUT_FORMATS).forEach((f, i) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="fmt" value="${f}" ${i === 0 ? "checked" : ""}><b>${f}</b><small>${CAPTIONS[f] || ""}</small>`;
    l.querySelector("input").onchange = () => {
      S.format = f; S.auto = {}; $("tt").disabled = f !== "SOAP with treatment";
      $("lastbox").hidden = f === "New patient's record"; // a new patient has no last note
      if (S.condition && !hasLine(dxField(), S.condition)) append(dxField(), S.condition, "", true);
      renderBuilder(); renderOutput(); renderDx(); autoFill(); renderCondTag();
    };
    $("formats").appendChild(l);
  });
  V.REGIONS.forEach((r) => { const o = document.createElement("option"); o.value = r; o.textContent = r; $("region").appendChild(o); });
  $("region").onchange = (e) => { S.region = e.target.value; S.regionManual = true; renderBuilder(); autoFill(); };
  $("tt").oninput = renderOutput; $("patient").oninput = renderOutput;
  $("dxq").oninput = renderDx;
  $("dxq").onkeydown = (e) => {
    if (e.key !== "Enter") return; e.preventDefault();
    const q = ($("dxq").value || "").trim(); if (!q) return;
    const first = $("dxhits").querySelector("button");
    setCondition(first ? first.textContent : q); $("dxq").value = ""; renderDx();
  };
  $("sides").querySelectorAll("button").forEach((b) => b.onclick = () => { S.sideManual = true; setSide(b.dataset.s); renderCondTag(); renderBuilder(); });
  $("region").addEventListener("change", () => { S.showAll = false; prefillTests(); });
  $("transcript").oninput = () => { renderNums(); renderBuilder(); scheduleFill(); };
  const langName = () => (S.lang === "en-US" ? "English" : "Thai");
  const micLabel = () => { document.querySelectorAll("button.mic[data-target]").forEach((b) => { if (!b.classList.contains("on")) b.textContent = `🎙 Dictate (${langName()})`; }); };
  $("langs").querySelectorAll("button").forEach((b) => b.onclick = () => {
    S.lang = b.dataset.l; $("langs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    micLabel();
    if (active) { const btn = active.btn; stopMic(); btn.click(); toast(`Now listening in ${langName()}`); }   // switch mid-dictation
  });
  micLabel();
  wireMic($("trmic"));
  $("photo").onchange = (e) => { const files = [...e.target.files]; e.target.value = ""; if (files.length) readPhotos(files); };
  $("audio").onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) transcribeAudio(f); };
  $("lastnote").addEventListener("paste", () => setTimeout(useLastNote, 50));
  $("uselast").onclick = useLastNote;
  $("clearlast").onclick = () => { $("lastnote").value = ""; $("laststate").textContent = ""; };
  $("copy").onclick = copyNote;
  $("clear").onclick = () => { if (!confirm("Clear the whole draft? Nothing was saved anyway.")) return; S.fields = {}; S.auto = {}; S.regionManual = false; S.sideAuto = false; S.conditionGuess = false; S.packApplied = ""; S.ttSuffix = ""; S.condition = ""; S.conditionAuto = false; S.sideManual = false; S.showAll = false; S.prefilled = new Set(); renderCondTag(); setSide(""); $("lastnote").value = ""; $("laststate").textContent = ""; $("transcript").value = ""; $("tt").value = ""; $("patient").value = ""; $("dxq").value = ""; $("fillstate").textContent = ""; renderNums(); renderBuilder(); renderOutput(); renderDx(); };
  window.addEventListener("beforeunload", stopMic);

  renderBuilder(); renderOutput(); renderNums();
})();
