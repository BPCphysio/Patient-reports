/* detect.js — reads the session notes (any mix of Thai and English) and
   proposes a line for every section of the note.

   Nothing here invents a number. A value written in the notes verbatim
   (a VAS "7/10", "12 x 3 sets", "grade 4/5", "treatment times 5") is carried
   across as written; every other measurement stays ___ for the physio. */

window.DETECT = (function () {
  const V = window.VOCAB, BLANK = V.BLANK;
  const isAscii = (s) => /^[\x00-\x7F]*$/.test(s);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const norm = (s) => (s || "").toLowerCase().replace(/[’‘]/g, "'");

  // ---------- matching primitives ----------
  function findAll(needle, low) {
    const out = []; needle = norm(needle).trim(); if (!needle) return out;
    if (isAscii(needle)) {
      const re = new RegExp("\\b" + esc(needle) + "\\b", "g"); let m;
      while ((m = re.exec(low))) out.push([m.index, m[0].length]);
    } else {
      let i = 0; while ((i = low.indexOf(needle, i)) >= 0) { out.push([i, needle.length]); i += needle.length; }
    }
    return out;
  }
  const ctx = (low, i, len, w) => low.slice(Math.max(0, i - (w || 60)), i + len + (w || 60));
  // the clause a hit sits in: from the previous punctuation mark to the next one (capped)
  const BREAK = /[\n.,;:()\/]/;
  function clauseSpan(low, i, len) {
    let s = i, e = i + len;
    while (s > 0 && i - s < 80 && !BREAK.test(low[s - 1])) s--;
    while (e < low.length && e - (i + len) < 80 && !BREAK.test(low[e])) e++;
    return [s, e];
  }
  const clause = (low, i, len) => { const [s, e] = clauseSpan(low, i, len); return low.slice(s, e); };
  const clauseAfter = (low, i, len) => { const [, e] = clauseSpan(low, i, len); return low.slice(i + len, e); };
  const overlaps = (h, list) => list.some((k) => h.i < k.i + k.len && k.i < h.i + h.len);
  // "no swelling", "not tender", "ไม่บวม": the finding is denied, not present
  const negated = (low, i) => /(\b(no|not|without|denies|denied|nil|don't|dont|doesn't|never|any)\b[^.,;\n]{0,14}|ไม่มี|ไม่)$/.test(low.slice(Math.max(0, i - 24), i)) && !/\b(no|not)\s+only\b/.test(low.slice(Math.max(0, i - 24), i));
  // entries: [[term, [aliases]]] -> hits [{term,i,len}]
  function scan(entries, low) {
    const hits = [];
    entries.forEach(([term, aliases]) => aliases.forEach((a) => findAll(a, low).forEach(([i, len]) => hits.push({ term, i, len }))));
    return hits;
  }
  // longest span wins where two hits overlap ("single leg squat" beats "squat")
  function pick(hits) {
    hits.sort((a, b) => b.len - a.len || a.i - b.i);
    const kept = [];
    hits.forEach((h) => { if (!kept.some((k) => h.i < k.i + k.len && k.i < h.i + h.len)) kept.push(h); });
    return kept.sort((a, b) => a.i - b.i);
  }
  const uniqTerms = (hits) => [...new Set(hits.map((h) => h.term))];

  // ---------- alias tables ----------
  const ALIAS = {};
  const NUMWORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const numberWords = (t) => t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -](one|two|three|four|five|six|seven|eight|nine)\b/g, (m, a, b) => String(NUMWORDS[a] + NUMWORDS[b]))
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g, (m) => String(NUMWORDS[m]))
    .replace(/\b(?:a|1|one)\s+hundred(?:\s+and)?\s+(\d{1,2})\b/g, (m, n) => String(100 + +n)).replace(/\b(?:a|1|one)\s+hundred\b/g, "100")
    .replace(/(\d)\s*point\s*(\d)/g, "$1.$2")
    .replace(/(^|[^\d.]\s*)\bpoint\s+(\d)(?=\s*(?:watts?|w\b|mhz|megahertz|volts?|kg|kilo|mm|cm|sec|mins?|minutes|hz|joules?|bar|degrees))/g, "$10.$2")
    .replace(/\b([0-5])\s+(minus|plus)\b/g, (m, d, w) => d + (w === "minus" ? "-" : "+"))
    .replace(/(สิบเอ็ด|สิบสอง|สิบสาม|สิบสี่|สิบห้า|สิบหก|สิบเจ็ด|สิบแปด|สิบเก้า|ยี่สิบ|สิบ|ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)(?![ก-๙])/g, (m) => ({ "สิบเอ็ด": 11, "สิบสอง": 12, "สิบสาม": 13, "สิบสี่": 14, "สิบห้า": 15, "สิบหก": 16, "สิบเจ็ด": 17, "สิบแปด": 18, "สิบเก้า": 19, "ยี่สิบ": 20, "สิบ": 10, "ศูนย์": 0, "หนึ่ง": 1, "สอง": 2, "สาม": 3, "สี่": 4, "ห้า": 5, "หก": 6, "เจ็ด": 7, "แปด": 8, "เก้า": 9 })[m])
    .replace(/(สิบเอ็ด|สิบสอง|สิบสาม|สิบสี่|สิบห้า|สิบหก|สิบเจ็ด|สิบแปด|สิบเก้า|ยี่สิบ|สิบ|ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)(?=\s*(\/|เต็ม|จาก|ครั้ง|เซ็ต|วินาที|นาที|องศา|ใน))/g, (m) => ({ "สิบเอ็ด": 11, "สิบสอง": 12, "สิบสาม": 13, "สิบสี่": 14, "สิบห้า": 15, "สิบหก": 16, "สิบเจ็ด": 17, "สิบแปด": 18, "สิบเก้า": 19, "ยี่สิบ": 20, "สิบ": 10, "ศูนย์": 0, "หนึ่ง": 1, "สอง": 2, "สาม": 3, "สี่": 4, "ห้า": 5, "หก": 6, "เจ็ด": 7, "แปด": 8, "เก้า": 9 })[m]);
  const add = (term, ...al) => { (ALIAS[term] = ALIAS[term] || []).push(...al); };
  const ALIAS_NUM = () => { Object.keys(ALIAS).forEach((t) => { ALIAS[t] = [...new Set(ALIAS[t].flatMap((a) => [a, numberWords(norm(a))]))]; }); };
  const BAD_ALIAS = new Set(["knee", "ankle", "us", "general", "other", "slr", "rdl", "tke", "apt", "ppt"]);
  const BARE_EXCLUDE = new Set(["Normal", "WNL", "Intact", "MMT", "Same plan", "Muscle tension", "Muscle strain", "Sitting", "Standing"]);
  // A physio's question ("Sharp or dull?") is not a finding. Dialogue lines that
  // start with a speaker label or end in "?" are skipped for complaints.
  const isQuestion = (c) => /\?/.test(c) || /^\s*(physio|therapist|pt|dr|doctor|นักกายภาพ|หมอ|นักกายภาพบำบัด)[^:\n]{0,24}:/i.test(c) || /ไหม|มั้ย|แค่ไหน|เมื่อไหร่|เท่าไหร่|อะไร|แบบไหน|ที่ไหน|ตรงไหน|หรือเปล่า|หรือยัง/.test(c.slice(0, 120));
  const hasSpeakers = (low) => /^\s*(patient|physio|therapist|pt|ผู้ป่วย|คนไข้|นักกายภาพ)[^:\n]{0,24}:/im.test(low);
  const isPatientLine = (c) => /^\s*(patient|pt\.?|ผู้ป่วย|คนไข้)[^:\n]{0,20}:/i.test(c);
  const sameLine = (low, a, b) => !low.slice(Math.min(a, b), Math.max(a, b)).includes("\n");
  // the side word nearest the term: just after it, then just before it, then anywhere in the clause
  function sideNear(low, i, len, beforeLen, fallback, afterLen) {
    const after = low.slice(i + len, i + len + (afterLen === undefined ? 16 : afterLen));
    const bl = beforeLen === undefined ? 16 : beforeLen, wide = low.slice(Math.max(0, i - 48), i);
    const inWindow = (re) => { const g = new RegExp(re.source, "g"); let m, last = null; while ((m = g.exec(wide))) last = m; return last && last.index >= wide.length - bl; };
    const before = SIDE_B.test(low.slice(Math.max(0, i - bl), i)) ? "Both" : inWindow(SIDE_R) && inWindow(SIDE_L) ? "Both" : inWindow(SIDE_R) ? "Rt." : inWindow(SIDE_L) ? "Lt." : "";
    return side(after) || before || (fallback === false ? "" : side(clause(low, i, len)));
  }
  // exam and treatment lines describe findings, not complaints
  const EXAM_WORDS = /\b(observation|palpation|palpat\w*|a?rom|prom|range of motion|muscle power|mmt|strength|special test|functional|neuro\w*|treatment(?!\s+times?)|plan|diagnosis|analysis|gym|home program|exercise|tenderness|trigger point)\b|ตรวจร่างกาย|การตรวจ|กดเจ็บ|คลำ/i;
  const isExamLine = (line) => line.length <= 220 ? (/^\s*(observation|palpation|active|passive|a?rom|prom|range of|muscle power|mmt|strength|special|functional|neuro|treatment|plan|diagnosis|analysis|gym|home program|exercise|ตรวจร่างกาย|การตรวจ)/i.test(line) || /palpat|กดเจ็บ|trigger point|tenderness|คลำ/i.test(line)) : false;
  // in a long dictated line, the exam section starts where the first exam word appears
  const inExamPart = (low, i) => { const line = speakerLine(low, i); if (line.length <= 220) return isExamLine(line); const start = low.lastIndexOf("\n", i) + 1; const m = EXAM_WORDS.exec(low.slice(start, i + 1)); return !!m; };
  const speakerLine = (low, i) => { const s = low.lastIndexOf("\n", i) + 1; const e = low.indexOf("\n", i); return low.slice(s, e < 0 ? low.length : e); };
  const prevText = (low, i, n) => low.slice(Math.max(0, i - (n || 90)), i);
  function aliasesOf(term) {
    const set = new Set(BARE_EXCLUDE.has(term) ? [] : [norm(term)]);
    const m = term.match(/^(.*?)\s*\((.*?)\)\s*(.*)$/);
    if (m) {
      const a = norm((m[1] + " " + (m[3] || "")).trim()); if (a) set.add(a);
      const b = norm(m[2]); if (b && !BAD_ALIAS.has(b)) set.add(b);
    }
    (ALIAS[term] || []).forEach((a) => set.add(norm(a)));
    return [...set].filter((a) => a.length >= 2);
  }
  const entries = (terms) => terms.map((t) => [t, aliasesOf(t)]);

  // Pain / subjective
  const ADJ = new Set(["Dull", "Sharp", "Radiating", "Throbbing", "Shooting", "Burning", "Aching"]);
  add("Dull", "dull", "ตื้อ", "ปวดตื้อ", "หนึบ"); add("Sharp", "sharp", "แปลบ", "จี๊ด", "ปวดแปลบ");
  add("Radiating", "radiating", "radiate", "radiates", "refer", "referred", "ร้าว", "ปวดร้าว", "ร้าวลง", "ล้าว", "ล้าวลง", "ปวดล้าว", "shooting down"); add("Sharp", "จี๊ด", "จี๊ดๆ", "จี๊ดจี๊ด", "แปลบ", "เสียว");
  add("Throbbing", "throbbing", "throb", "ตุบ", "ตุ๊บ"); add("Stiffness", "stiff", "stiffness", "ฝืด", "ขยับยาก", "ข้อแข็ง");
  add("Numbness", "numb", "numbness", "ชา"); add("Shooting", "shooting", "แล่น", "ปวดแล่น");
  add("Tingling", "tingling", "tingle", "pins and needles", "เหน็บ", "ซ่า", "ยิบ"); add("Burning", "burning", "burn", "แสบ", "แสบร้อน");
  add("Aching", "aching", "ache", "เมื่อย", "ปวดเมื่อย", "ระบม"); add("Clicking", "clicking", "click", "clicks", "cracking", "crack", "cracks", "popping", "pops", "เสียงคลิก", "เสียงดัง", "กึก");
  add("Locking", "locking", "locks", "locked", "ล็อค", "ล็อก"); add("Giving way", "giving way", "gives way", "gave way", "buckle", "buckling", "ทรุด", "เข่าทรุด", "เข่าอ่อน");
  const AGG_AL = {
    "Worse on walking": ["walking", "walk", "walks", "เดิน"], "Worse on stairs": ["stairs", "stair", "บันได", "ขึ้นลงบันได"],
    "Worse on sitting": ["sitting", "sit", "sits", "นั่ง", "นั่งนาน"], "Worse on standing": ["standing", "stand", "stands", "ยืน", "ยืนนาน"],
    "Worse in the morning": ["morning", "wake", "waking", "เช้า", "ตอนเช้า", "ตื่นนอน", "ตื่น"], "Worse at night": ["night", "at night", "sleep", "sleeping", "กลางคืน", "ตอนกลางคืน", "นอนไม่หลับ", "ตื่นกลางดึก"],
    "Worse on lifting": ["lifting", "lift", "lifts", "carry", "carrying", "ยกของ", "ยกของหนัก", "แบก"], "Worse on overhead activity": ["overhead", "reach up", "reaching up", "เหนือศีรษะ", "เหนือหัว", "ยกแขน"],
    "Worse on squatting": ["squatting", "when squatting", "นั่งยอง", "ยอง"], "Worse after exercise": ["after exercise", "after running", "after sport", "after training", "หลังออกกำลัง", "หลังวิ่ง", "หลังเล่นกีฬา", "หลังซ้อม"],
    "Worse on driving": ["driving", "drive", "ขับรถ"],
  };
  const EASE_AL = {
    "Better with rest": ["rest", "resting", "พัก", "นอนพัก"], "Better with movement": ["movement", "moving", "move", "walking", "walk", "ขยับ", "เคลื่อนไหว", "เดิน"],
    "Better with heat": ["heat", "hot", "warm", "ร้อน", "อุ่น", "ประคบร้อน"], "Better with stretching": ["stretching", "stretch", "ยืด"],
    "Better after treatment": ["after treatment", "after physio", "after the session", "after last session", "หลังกายภาพ", "หลังทำกายภาพ"], "Better with medication": ["medication", "medicine", "painkiller", "painkillers", "tablets", "กินยา", "ทานยา", "ยาแก้ปวด", "ยาคลายกล้ามเนื้อ"],
  };
  const WORSE = /\b(worse|worsens|hurt|hurts|pain|painful|aggravat\w*|increase[sd]?|sore|stiff)\b|ปวด|เจ็บ|มากขึ้น|แย่ลง|ตึง|เมื่อย/;
  const BETTER = /\b(better|relie[fv]\w*|eas(e|es|ed|ing)|improve[sd]?|reduce[sd]?|less|help[s]?|settles?)\b|ดีขึ้น|ทุเลา|บรรเทา|หาย|ลดลง|เบาลง/;
  const PAIN = /\b(pain|painful|ache|aching|sore|soreness|hurt|hurts|discomfort)\b|ปวด|เจ็บ|เมื่อย|ตึง|ระบม/;

  // Body parts -> region
  const BODY = [
    ["neck", "Neck / cervical", ["neck", "cervical", "ต้นคอ", "ปวดคอ", "ตึงคอ", "เมื่อยคอ", "ที่คอ", "บริเวณคอ", "คอบ่า", "คอด้าน", "คอซ้าย", "คอขวา", "คอและ", "ก้มคอ", "หมุนคอ", "เอียงคอ", "เงยคอ", "บ่า"]],
    ["head", "Neck / cervical", ["head", "headache", "headaches", "ศีรษะ", "ปวดหัว", "หัว"]],
    ["upper back", "Thoracic spine", ["upper back", "mid back", "thoracic", "between the shoulder blades", "shoulder blade", "scapula", "หลังส่วนบน", "สะบัก", "กลางหลัง"]],
    ["shoulder", "Shoulder", ["shoulder", "shoulders", "ไหล่", "หัวไหล่", "ข้อไหล่"]],
    ["elbow", "Elbow, wrist & hand", ["elbow", "elbows", "ข้อศอก", "ศอก"]],
    ["wrist", "Elbow, wrist & hand", ["wrist", "wrists", "ข้อมือ"]],
    ["hand", "Elbow, wrist & hand", ["hand", "hands", "finger", "fingers", "thumb", "ฝ่ามือ", "นิ้วมือ", "นิ้วโป้งมือ", "ปวดมือ", "ที่มือ"]],
    ["low back", "Trunk / lumbar", ["low back", "lower back", "lumbar", "back pain", "backache", "ปวดหลัง", "หลังส่วนล่าง", "หลังล่าง", "เอว", "บั้นเอว", "ปวดเอว"]],
    ["hip", "Hip", ["hip", "hips", "groin", "buttock", "buttocks", "glute", "glutes", "สะโพก", "ขาหนีบ", "ก้น"]],
    ["thigh", "Hip", ["thigh", "thighs", "ต้นขา"]],
    ["knee", "Knee", ["knee", "knees", "kneecap", "เข่า", "หัวเข่า"]],
    ["calf", "Ankle & foot", ["calf", "calves", "shin", "shins", "น่อง", "หน้าแข้ง"]],
    ["ankle", "Ankle & foot", ["ankle", "ankles", "ข้อเท้า"]],
    ["foot", "Ankle & foot", ["foot", "feet", "heel", "heels", "toe", "toes", "sole", "arch", "เท้า", "ส้นเท้า", "ฝ่าเท้า", "นิ้วเท้า"]],
  ];
  const BODY_ENTRIES = BODY.map((b) => [b[0], b[2]]);
  const REGION_OF = Object.fromEntries(BODY.map((b) => [b[0], b[1]]));

  // Sides
  const SIDE_R = /(?<!compared to the |compared with the |than the |compare with the |than your |than on the )\b(right|rt)\b(?!\s+(?:at|there|here|now|away|after|before|in front|behind|through|down|up|onto|next|beside|then|on time|angle))|ขวา/, SIDE_L = /(?<!compared to the |compared with the |than the |compare with the |than your |than on the )\b(left|lt)\b(?!\s+(?:over|behind|off))|ซ้าย/, SIDE_B = /\b(both|bilateral|bilaterally)\b|ทั้งสองข้าง|สองข้าง|ทั้ง 2 ข้าง|2 ข้าง/;
  function side(c) { const r = SIDE_R.test(c), l = SIDE_L.test(c); if (SIDE_B.test(c) || (r && l)) return "Both"; if (r) return "Rt."; if (l) return "Lt."; return ""; }
  const withSide = (s, what) => (s ? s + " " : "") + what;

  // Observation
  add("Forward head", "forward head", "poking chin", "คอยื่น", "หัวยื่น");
  add("Round shoulder", "round shoulder", "rounded shoulder", "rounded shoulders", "round shoulders", "ไหล่ห่อ", "ไหล่งุ้ม");
  add("Scapular protraction", "scapular protraction", "protracted scapula"); add("Scapular winging", "scapular winging", "winging", "winged scapula", "สะบักปีก");
  add("Shoulder level Rt.>Lt.", "right shoulder higher", "rt shoulder higher", "ไหล่ขวาสูงกว่า"); add("Shoulder level Lt.>Rt.", "left shoulder higher", "lt shoulder higher", "ไหล่ซ้ายสูงกว่า");
  add("Thoracic hyperkyphosis", "kyphosis", "hyperkyphosis", "hunched", "หลังค่อม", "หลังโก่ง"); add("Flatback", "flat back", "flatback");
  add("Lumbar hyperlordosis", "hyperlordosis", "lordosis", "sway back", "หลังแอ่น"); add("Anterior pelvic tilt", "anterior pelvic tilt", "apt", "เชิงกรานเอียงหน้า");
  add("Posterior pelvic tilt", "posterior pelvic tilt", "ppt", "เชิงกรานเอียงหลัง"); add("Pelvic asymmetry", "pelvic asymmetry", "pelvis asymmetric", "เชิงกรานไม่เท่ากัน");
  add("Hip elevation Rt.", "right hip higher", "rt hip elevated", "สะโพกขวาสูง"); add("Hip elevation Lt.", "left hip higher", "lt hip elevated", "สะโพกซ้ายสูง");
  add("Scoliosis", "scoliosis", "กระดูกสันหลังคด", "กระดูกสันคด", "สันหลังโค้ง", "หลังโค้งไปทาง", "หลังคด", "สันหลังคด"); add("No scoliosis", "no scoliosis", "ไม่มีหลังคด");
  add("Genu valgum (knock knee)", "knock knees", "เข่าฉิ่ง", "เข่าชนกัน", "เข่าชิด"); add("Genu varum (bow leg)", "bow legs", "bowleg", "bowlegs", "varus knee", "ขาโก่ง");
  add("Genu recurvatum", "recurvatum", "hyperextended knee", "เข่าแอ่น"); add("Patella alta", "patella alta"); add("Patellar lateral shift", "lateral patellar shift", "patella shifted laterally", "patella lateral");
  add("Flat feet", "flat foot", "flat feet", "flatfoot", "pes planus", "เท้าแบน"); add("No flat feet", "no flat feet", "arches normal", "ไม่มีเท้าแบน"); add("Pes cavus", "pes cavus", "high arch", "high arches", "อุ้งเท้าสูง");
  add("Swelling", "swelling", "swollen", "swell", "oedema", "edema", "puffy", "บวม"); add("Muscle atrophy", "atrophy", "wasting", "wasted", "atrophied", "กล้ามเนื้อลีบ", "ลีบ");
  add("Bruising", "bruise", "bruising", "bruised", "ช้ำ", "รอยช้ำ", "เขียว"); add("Scar", "scar", "scars", "แผลเป็น", "รอยแผล"); add("Redness", "redness", "red", "erythema", "แดง");
  add("Increased skin temperature", "warm to touch", "hot to touch", "increased temperature", "ผิวอุ่น", "ร้อนกว่า"); add("Antalgic gait", "antalgic", "limp", "limping", "limps", "เดินกะเผลก", "เดินเป๋", "กะเผลก");
  add("Non-weight bearing (NWB)", "non weight bearing", "non-weight bearing", "nwb", "ลงน้ำหนักไม่ได้"); add("Partial weight bearing", "partial weight bearing", "pwb", "ลงน้ำหนักบางส่วน");
  add("On crutches", "crutches", "crutch", "ไม้ค้ำ", "ไม้เท้า"); add("In moon boot", "moon boot", "walking boot", "cam boot", "รองเท้าบูท", "บูท");
  add("Normal posture", "normal posture", "posture normal", "good posture", "ท่าทางปกติ");
  const SITE_OBS = new Set(["Swelling", "Muscle atrophy", "Bruising", "Scar", "Redness", "Increased skin temperature"]);

  // Palpation
  add("Tenderness", "tenderness", "tender", "กดเจ็บ", "กดแล้วเจ็บ"); add("Tightness", "tightness", "tight", "ตึง");
  add("Trigger point", "trigger point", "trigger points", "trigger", "จุดกดเจ็บ", "ทริกเกอร์", "ทริกเกอร์พอยท์"); add("Muscle spasm", "spasm", "spasms", "spasming", "guarding", "กล้ามเนื้อเกร็ง", "เกร็งตัว");
  add("Warmth", "warmth", "warm", "ผิวอุ่น", "ผิวร้อน", "อุ่นกว่า", "ร้อนกว่า"); add("Joint stiffness", "joint stiffness", "stiff joint", "ข้อฝืด", "ข้อติด"); add("Crepitus", "crepitus", "crepitation", "grinding", "กรอบแกรบ", "เสียงกรอบแกรบ");
  add("Hypomobility", "hypomobile", "hypomobility", "ขยับได้น้อย"); add("Hypermobility", "hypermobile", "hypermobility", "ข้อหลวม");
  const EXAM = /\b(palpat\w*|tender\w*|trigger|spasm|feel|feels|felt|found|finding|findings|on examination|o\/e|noted|note)\b|คลำ|กด|พบ|ตรวจ|เจอ/;
  add("upper trapezius", "upper trap", "upper traps", "trapezius", "traps", "บ่า", "กล้ามเนื้อบ่า"); add("levator scapulae", "levator", "lev scap");
  add("sub-occipital", "suboccipital", "sub occipital", "ท้ายทอย"); add("cervical paraspinal", "neck paraspinal", "cervical paraspinals"); add("sternocleidomastoid", "scm"); add("scalene", "scalenes");
  add("rhomboid", "rhomboids", "ระหว่างสะบัก"); add("pectoralis major", "pec major", "pecs", "pectorals", "กล้ามเนื้ออก", "กล้ามเนื้อหน้าอก"); add("pectoralis minor", "pec minor"); add("serratus anterior", "serratus"); add("latissimus dorsi", "lats", "latissimus");
  add("supraspinatus", "supraspinatus tendon"); add("infraspinatus"); add("subscapularis", "subscap"); add("anterior deltoid", "front deltoid"); add("middle deltoid", "mid deltoid"); add("posterior deltoid", "rear deltoid");
  add("biceps", "bicep", "ต้นแขนด้านหน้า"); add("triceps", "tricep", "ต้นแขนด้านหลัง"); add("long head of biceps", "lhb", "biceps long head");
  add("erector spinae", "erectors", "back extensors", "กล้ามเนื้อหลัง"); add("quadratus lumborum (QL)", "quadratus lumborum", "ql"); add("lumbar paraspinal", "lumbar paraspinals", "paraspinal", "paraspinals", "ข้างกระดูกสันหลัง");
  add("thoracic paraspinal", "thoracic paraspinals"); add("multifidus"); add("transversus abdominis", "tva", "transverse abdominis"); add("rectus abdominis", "abs", "abdominals", "หน้าท้อง"); add("oblique", "obliques"); add("diaphragm", "กระบังลม");
  add("gluteus maximus", "glute max", "gluteus max", "ก้น", "กล้ามเนื้อก้น"); add("gluteus medius", "glute med", "gluteus med", "สะโพกด้านข้าง"); add("gluteus minimus", "glute min");
  add("tensor fasciae latae (TFL)", "tensor fascia lata", "tfl"); add("piriformis", "พิริฟอร์มิส"); add("iliopsoas", "psoas", "hip flexor", "hip flexors", "สะโพกด้านหน้า");
  add("hip adductor", "adductor", "adductors", "groin muscle", "ขาหนีบ", "ต้นขาด้านใน"); add("quadriceps", "quads", "quad", "ต้นขาด้านหน้า", "ควอด"); add("vastus medialis", "vmo", "vastus medialis oblique"); add("vastus lateralis");
  add("rectus femoris"); add("hamstring", "hamstrings", "แฮมสตริง", "ต้นขาด้านหลัง"); add("biceps femoris"); add("semitendinosus"); add("ITB", "iliotibial band", "it band", "ไอทีแบนด์"); add("sartorius");
  add("popliteus", "ข้อพับเข่า"); add("gastrocnemius", "gastroc", "gastrocs", "calf muscle", "น่อง", "กล้ามเนื้อน่อง"); add("soleus"); add("tibialis anterior", "tib ant", "หน้าแข้ง"); add("tibialis posterior", "tib post");
  add("peroneus longus", "peroneals", "peroneal"); add("peroneus brevis"); add("patellar tendon", "เอ็นสะบ้า", "เอ็นใต้สะบ้า"); add("achilles tendon", "achilles", "เอ็นร้อยหวาย"); add("plantar fascia", "plantar", "ฝ่าเท้า", "พังผืดฝ่าเท้า");
  add("flexor hallucis longus", "fhl"); add("extensor digitorum", "edl", "toe extensors");
  add("wrist extensor group", "wrist extensors", "wrist extensor", "extensor group", "กล้ามเนื้อกระดกข้อมือ"); add("wrist flexor group", "wrist flexors", "wrist flexor", "flexor group");
  add("common extensor origin", "ceo", "lateral epicondyle"); add("common flexor origin", "cfo", "medial epicondyle"); add("thenar", "thenar eminence", "โคนนิ้วโป้ง"); add("hypothenar"); add("pronator teres"); add("supinator"); add("first dorsal interosseous", "1st dorsal interosseous", "fdi");
  const ALL_MUSCLES = Object.values(V.MUSCLES).flat();

  // Range of motion
  const MOVE = {
    "flexion": ["flexion", "flex", "flexing", "ก้ม", "งอ", "ก้มคอ"], "extension": ["extension", "extend", "extending", "เหยียด", "แอ่น", "เงย"],
    "abduction": ["abduction", "abduct", "กาง", "กางแขน", "กางขา"], "adduction": ["adduction", "adduct", "หุบ"],
    "er": ["er", "external rotation", "externally rotate", "หมุนออก"], "ir": ["ir", "internal rotation", "internally rotate", "หมุนเข้า"],
    "rotation": ["rotation", "rotate", "rotating", "turn", "turning", "หมุน", "หัน", "บิด"], "lateral flexion": ["lateral flexion", "side bend", "side bending", "side flexion", "เอียง", "เอียงคอ"],
    "dorsiflexion": ["dorsiflexion", "dorsiflex", "df", "กระดก", "กระดกข้อเท้า", "กระดกเท้า"], "plantarflexion": ["plantarflexion", "plantar flexion", "plantarflex", "pf", "จิกปลายเท้า", "เหยียดปลายเท้า", "ถีบ"],
    "supination": ["supination", "supinate", "หงายมือ"], "pronation": ["pronation", "pronate", "คว่ำมือ"],
    "radial deviation": ["radial deviation"], "ulnar deviation": ["ulnar deviation"], "inversion": ["inversion", "invert", "บิดเข้า"], "eversion": ["eversion", "evert", "บิดออก"],
    "hand behind back": ["hand behind back", "hbb", "behind the back", "ไขว้หลัง", "เอามือไขว้หลัง"], "hallux dorsiflexion": ["hallux dorsiflexion", "big toe extension", "กระดกนิ้วโป้งเท้า"],
  };
  const MOVE_PREFIX = /^(neck|shoulder|elbow|wrist|thoracic|trunk|hip|knee|ankle|subtalar|hallux)\s+/;
  const ROMCTX = /\brom\b|range|degree|degrees|°|องศา|limit\w*|restrict\w*|\bfull\b|จำกัด|เต็ม|ไม่สุด|ได้ไม่|ติด|stiff\w*|ฝืด|ขยับ|motion|เคลื่อนไหว|reduced|decreased|ลดลง|น้อยลง|ทำได้|ไม่ได้|painful arc|end range|end of range|ช่วงสุด/;
  const LIMITED = /\b(limited|limit|restricted|restriction|decreased|reduced|unable|can't|cannot)\b|จำกัด|ไม่สุด|ได้ไม่|ติด|ลดลง|น้อยลง|ไม่ได้/;
  const FULL = /\bfull\b|\bnormal\b|\bwnl\b|เต็ม|สุด|ปกติ|ครบ/;
  const NOPAIN = /\b(without pain|no pain|painless|pain free|pain-free)\b|ไม่ปวด|ไม่เจ็บ|ไม่มีอาการปวด/;
  const PASSIVE = /\bpassive\b|\bprom\b|พาสซีฟ|ช่วยขยับ|จับขยับ/;
  const FUTURE = /\b(we'?ll (?:start|add|move|progress|talk|do)|we will (?:start|add|progress)|next (?:week|session|time|visit)|later on|once the|when the|before you go back|in a few weeks|not yet|eventually|when you're ready|when it settles)\b|สัปดาห์หน้า|ครั้งหน้า|ค่อย/;
  const EXCTX = /\b(exercise|exercises|home program|home programme|programme|program|hep|sets?|reps?|repetitions?|prescrib\w*|teach|taught|gave|give|given|train\w*|strengthen\w*|hold)\b|ท่า|ออกกำลัง|บริหาร|ให้ทำ|สอน|ฝึก|เซ็ต|ครั้ง|ทำที่บ้าน/;
  const TESTCTX = /\b(test|tests|testing|tested|assess\w*|check\w*|screen\w*|observ\w*|unable|able|pain on|painful|performs?|performed)\b|ทดสอบ|ตรวจ|ประเมิน|ลอง|ทำไม่ได้|ทำได้/;
  add("full ROM without pain"); add("full ROM with pain at end range");

  // Strength, function, tests, neuro
  add("Weakness", "weakness", "weak", "อ่อนแรง", "ไม่มีแรง", "แรงน้อย"); add("Good muscle power", "good muscle power", "good strength", "strong", "แรงดี", "กำลังดี");
  add("UE grossly 5/5", "ue grossly 5/5", "upper limb 5/5", "upper limbs 5/5"); add("LE grossly 5/5", "le grossly 5/5", "lower limb 5/5", "lower limbs 5/5");
  add("UE limited", "ue limited", "upper limb limited"); add("LE limited", "le limited", "lower limb limited");
  add("Sit to stand double legs", "sit to stand", "sts", "ลุกนั่ง", "ลุกจากเก้าอี้"); add("Sit to stand single leg", "single leg sit to stand", "sit to stand single leg", "ลุกนั่งขาเดียว");
  add("Squat", "squat", "squats", "สควอท", "สควอต"); add("Single leg squat", "single leg squat", "single-leg squat", "one leg squat", "pistol squat", "สควอทขาเดียว");
  add("Deep squat", "deep squat", "full squat"); add("Overhead squat", "overhead squat", "ohs"); add("Step down test", "step down", "step-down", "ก้าวลง"); add("Step up test", "step up test", "ก้าวขึ้น");
  add("Hop test", "hop test", "hopping test", "hop on one leg", "single leg hop", "single-leg hop", "กระโดดขาเดียว"); add("Double balance", "double leg balance", "two leg balance", "ยืนสองขา");
  add("Single leg balance", "single leg balance", "single leg stance", "one leg balance", "one leg stand", "stand on one leg", "ยืนขาเดียว", "ทรงตัวขาเดียว"); add("Gait analysis", "gait", "walking pattern", "ท่าเดิน", "การเดิน");
  add("Stair climbing", "stair climbing", "climbing stairs"); add("Heel raise", "heel raise", "heel raises", "calf raise", "calf raises", "เขย่ง", "เขย่งส้น", "เขย่งปลายเท้า"); add("Bulgarian split squat", "bulgarian split squat", "bulgarian", "rear foot elevated split squat");
  add("Double leg squats", "double leg squat"); add("Single leg squats");
  const KEEP_TEST_WORD = new Set(["Squeeze test", "Speed's test", "Sulcus sign", "Empty can test", "Full can test", "Windlass test", "Compression test", "Distraction test"]);
  V.SPECIAL_TESTS.forEach((t) => { if (KEEP_TEST_WORD.has(t)) return; const s = t.replace(/\s+(test|sign)$/i, ""); if (s !== t && s.length >= 4) add(t, s, s.replace(/'s$/, "")); });
  add("Valgus stress test", "valgus stress", "valgus test"); add("Varus stress test", "varus stress", "varus test"); add("Compression test", "compression test", "cervical compression", "neck compression"); add("Distraction test", "distraction test", "cervical distraction", "neck distraction");
  add("Lachman test", "lachman's"); add("Slump test", "slump"); add("SLR", "straight leg raise test", "straight leg raise", "straight leg raising", "lasegue"); add("Hawkins-Kennedy", "hawkins kennedy", "hawkins-kennedy");
  add("Anterior drawer (knee)", "anterior drawer"); add("Anterior drawer (ankle)", "anterior drawer"); add("Thompson test", "thompson", "calf squeeze"); add("Windlass test", "windlass"); add("Craniocervical flexion test", "ccft", "craniocervical flexion");
  add("Adam's forward bend test", "adams", "adam's", "forward bend test"); add("Sacroiliac compression", "sacroiliac compression test"); add("Trendelenburg", "trendelenburg sign", "trendelenberg");
  add("Patellar grind", "clarke's", "clarke test", "clarkes"); add("Empty can test", "empty can", "jobe", "jobe's"); add("Full can test", "full can test"); add("Speed's test", "speeds", "speed's"); add("Yergason test", "yergason's", "yergasons");
  const POS = /\b(positive|\+ve|\+)\s*$|\b(positive|\+ve|pos)\b|บวก|พอสิทีฟ|โพสิทีฟ|โพซิทีฟ|โพสต์สิทีฟ|โพสต์ทีฟ|โพสิทิฟ|โพสิตีฟ|เป็นบวก/, NEG = /\b(negative|-ve|neg)\b|ลบ|เนกาทีฟ|เนกกาทีฟ|เป็นลบ/;
  add("No neurological deficit", "no neurological deficit", "no neuro deficit", "neuro intact", "neurologically intact", "neuro normal", "neurological examination normal", "ไม่มีอาการทางระบบประสาท", "ระบบประสาทปกติ");
  add("Dermatomes: WNLs sensory screening bilateral UE and LEs", "dermatomes normal", "dermatomes intact", "dermatome normal", "dermatome intact", "sensation intact", "sensation normal", "sensory intact", "ความรู้สึกปกติ");
  add("Myotomes: Key muscle groups grossly equal bilaterally", "myotomes normal", "myotomes intact", "myotome normal", "myotome intact", "myotomes equal");
  const NEUROCTX = /myotome|dermatome|reflex|sensation|sensory|numb|ชา/;

  // Diagnoses (English names match themselves; these add short forms and Thai)
  add("Myofascial pain syndrome (MPS)", "mps", "myofascial pain", "myofascial", "ปวดกล้ามเนื้อเรื้อรัง"); add("MPS at upper trapezius", "mps upper trap", "mps upper trapezius", "upper trap mps");
  add("Upper cross syndrome", "upper cross", "ucs"); add("Cervical radiculopathy", "cervical radiculopathy", "c-spine radiculopathy", "neck radiculopathy", "รากประสาทคอ", "ปวดคอร้าวลงแขน");
  add("Cervical spondylosis", "spondylosis", "กระดูกคอเสื่อม"); add("Cervical disc herniation", "cervical disc", "cervical hnp", "neck disc", "หมอนรองกระดูกคอ");
  add("Whiplash-associated disorder", "whiplash", "wad"); add("Tension-type headache", "tension headache", "tension type headache", "tth", "ปวดหัวจากความเครียด", "ปวดศีรษะจากความเครียด");
  add("Cervicogenic headache", "cervicogenic", "headache from the neck", "ปวดหัวจากคอ", "ปวดศีรษะจากคอ"); add("Postural neck pain", "postural neck pain", "ปวดคอจากท่าทาง");
  add("Text neck", "text neck", "phone neck"); add("Thoracic outlet syndrome", "thoracic outlet", "tos"); add("Scapular dyskinesis", "scapular dyskinesis", "scapular dyskinesia", "dyskinesis");
  add("Acute torticollis", "torticollis", "wry neck", "คอเคล็ด", "ตกหมอน"); add("Neck muscle tightness", "neck tightness", "tight neck", "กล้ามเนื้อคอตึง", "คอตึง"); add("Muscle tightness", "muscle tightness", "กล้ามเนื้อตึง");
  add("Frozen shoulder (adhesive capsulitis)", "frozen shoulder", "adhesive capsulitis", "ไหล่ติด", "ข้อไหล่ติด"); add("Left frozen shoulder", "left frozen shoulder", "lt frozen shoulder", "ไหล่ติดซ้าย");
  add("Supraspinatus tendinopathy", "supraspinatus tendinopathy", "supraspinatus tendinitis", "supraspinatus tendonitis"); add("Supraspinatus tear", "supraspinatus tear"); add("Rotator cuff tear", "rotator cuff tear", "cuff tear", "เอ็นไหล่ฉีก", "เอ็นหัวไหล่ฉีก");
  add("Rotator cuff tendinitis", "rotator cuff tendinitis", "rotator cuff tendinopathy", "rotator cuff tendonitis", "cuff tendinopathy", "เอ็นไหล่อักเสบ", "เอ็นหัวไหล่อักเสบ");
  add("Subacromial impingement", "subacromial impingement", "impingement", "ไหล่หนีบ", "เอ็นไหล่หนีบ"); add("Shoulder impingement syndrome", "shoulder impingement", "impingement syndrome");
  add("Subacromial bursitis", "subacromial bursitis", "shoulder bursitis", "ถุงน้ำไหล่อักเสบ"); add("Shoulder instability", "shoulder instability", "unstable shoulder", "ไหล่หลวม", "ไหล่หลุด");
  add("AC joint sprain", "ac joint sprain", "acj sprain", "ac joint injury", "acj"); add("Labral tear", "labral tear", "labrum tear", "slap tear", "slap lesion"); add("Biceps tendinopathy", "biceps tendinopathy", "biceps tendinitis", "biceps tendonitis", "เอ็นไบเซ็บอักเสบ");
  add("Post-operative shoulder rehabilitation", "post op shoulder", "post-op shoulder", "shoulder surgery", "หลังผ่าตัดไหล่"); add("Calcific tendinitis", "calcific tendinitis", "calcific tendinopathy", "calcification", "หินปูนเกาะเอ็น");
  add("Lateral epicondylitis (tennis elbow)", "lateral epicondylitis", "lateral epicondylalgia", "tennis elbow", "เทนนิสเอลโบว์", "ข้อศอกด้านนอกอักเสบ"); add("Medial epicondylitis (golfer's elbow)", "medial epicondylitis", "golfer's elbow", "golfers elbow", "golfer elbow", "ข้อศอกด้านในอักเสบ");
  add("De Quervain's tenosynovitis", "de quervain", "de quervain's", "dequervain", "เดอเกอร์แวง", "เอ็นข้อมืออักเสบ"); add("Carpal tunnel syndrome", "carpal tunnel", "cts", "พังผืดทับเส้นประสาท", "พังผืดข้อมือ");
  add("Cubital tunnel syndrome", "cubital tunnel", "ulnar nerve entrapment"); add("Trigger finger", "trigger finger", "trigger thumb", "นิ้วล็อค", "นิ้วล็อก"); add("TFCC injury", "tfcc", "tfcc tear"); add("Wrist sprain", "wrist sprain", "sprained wrist", "ข้อมือแพลง", "ข้อมือเคล็ด");
  add("Ganglion", "ganglion", "ganglion cyst", "ถุงน้ำข้อมือ"); add("Dupuytren's contracture", "dupuytren", "dupuytren's"); add("Post-fracture wrist rehabilitation", "wrist fracture", "distal radius fracture", "colles", "ข้อมือหัก");
  add("Lumbar muscle tightness", "lumbar tightness", "tight low back", "หลังตึง", "กล้ามเนื้อหลังตึง"); add("Acute back muscle strain", "back strain", "back muscle strain", "lumbar strain", "หลังเคล็ด", "กล้ามเนื้อหลังอักเสบ");
  add("Sacroiliac joint dysfunction", "sij dysfunction", "sij", "sacroiliac", "si joint", "ข้อต่อกระเบนเหน็บ", "ข้อเอสไอ"); add("Lumbar disc bulging", "disc bulge", "disc bulging", "bulging disc", "หมอนรองกระดูกโป่ง", "หมอนรองกระดูกปูด");
  add("Lumbar disc herniation", "disc herniation", "herniated disc", "disc prolapse", "prolapsed disc", "slipped disc", "หมอนรองกระดูกทับเส้น", "หมอนรองกระดูกทับเส้นประสาท", "หมอนรองกระดูกปลิ้น", "หมอนรองกระดูกเคลื่อน");
  add("Sciatica", "sciatica", "sciatic pain"); add("Sciatic nerve irritation", "sciatic nerve irritation", "sciatic irritation", "เส้นประสาทไซแอติก");
  add("Lumbar facet joint dysfunction", "facet joint", "facet dysfunction", "facet syndrome", "ข้อฟาเซ็ท"); add("Lumbar instability", "lumbar instability", "core instability", "หลังไม่มั่นคง");
  add("Spondylolisthesis", "spondylolisthesis", "listhesis", "กระดูกสันหลังเคลื่อน"); add("Spondylolysis", "spondylolysis", "pars defect"); add("Lumbar spinal stenosis", "spinal stenosis", "stenosis", "โพรงกระดูกสันหลังตีบ", "โพรงประสาทตีบ");
  add("Postural low back pain", "postural low back pain", "postural back pain", "ปวดหลังจากท่าทาง"); add("Degenerative disc disease", "degenerative disc", "ddd", "หมอนรองกระดูกเสื่อม");
  add("Pregnancy-related pelvic girdle pain", "pelvic girdle pain", "pgp", "pregnancy back pain", "ปวดหลังตั้งครรภ์", "ปวดเชิงกรานตั้งครรภ์"); add("Postpartum pelvic floor weakness", "pelvic floor weakness", "pelvic floor", "อุ้งเชิงกรานอ่อนแรง");
  add("Coccydynia", "coccydynia", "coccyx pain", "tailbone pain", "ปวดก้นกบ"); add("Piriformis syndrome", "piriformis syndrome", "พิริฟอร์มิสซินโดรม"); add("Gluteal muscle strain", "gluteal strain", "glute strain", "กล้ามเนื้อก้นอักเสบ");
  add("ITB tightness", "itb tightness", "tight itb", "tight it band", "ไอทีแบนด์ตึง"); add("ITB syndrome", "itb syndrome", "itbs", "it band syndrome", "iliotibial band syndrome"); add("Gluteal tendinopathy", "gluteal tendinopathy", "glute med tendinopathy", "เอ็นสะโพกอักเสบ");
  add("Hip impingement (FAI)", "hip impingement", "fai", "femoroacetabular impingement", "ข้อสะโพกหนีบ"); add("Hip osteoarthritis", "hip oa", "oa hip", "hip osteoarthritis", "hip arthritis", "ข้อสะโพกเสื่อม", "สะโพกเสื่อม");
  add("Hip labral tear", "hip labral tear", "hip labrum"); add("Hamstring strain", "hamstring strain", "hamstring tear", "pulled hamstring", "hamstring injury", "แฮมสตริงฉีก", "แฮมสตริงอักเสบ", "กล้ามเนื้อต้นขาด้านหลังฉีก");
  add("Adductor strain", "adductor strain", "groin strain", "groin pull", "adductor tear", "ขาหนีบอักเสบ", "กล้ามเนื้อขาหนีบฉีก"); add("Quadriceps strain", "quad strain", "quadriceps strain", "quad tear", "ต้นขาด้านหน้าฉีก");
  add("Trochanteric bursitis", "trochanteric bursitis", "hip bursitis", "ถุงน้ำสะโพกอักเสบ"); add("Snapping hip syndrome", "snapping hip", "สะโพกดีด"); add("Hip flexor tightness", "hip flexor tightness", "tight hip flexors", "tight hip flexor", "สะโพกด้านหน้าตึง");
  add("Post hip replacement rehabilitation", "hip replacement", "thr", "tha", "หลังผ่าตัดเปลี่ยนข้อสะโพก", "เปลี่ยนข้อสะโพก"); add("Sports hernia / athletic groin pain", "sports hernia", "athletic groin pain", "athletic pubalgia");
  add("Patellofemoral pain syndrome", "patellofemoral pain", "patellofemoral", "pfps", "pfp", "anterior knee pain", "ปวดหน้าเข่า", "ปวดสะบ้า"); add("Patellar tendinopathy", "patellar tendinopathy", "patellar tendinitis", "patellar tendonitis", "jumper's knee", "jumpers knee", "เอ็นสะบ้าอักเสบ");
  add("Patellar tendinosis", "patellar tendinosis"); add("ACL tear", "acl tear", "acl rupture", "acl injury", "torn acl", "acl", "เอ็นไขว้หน้าขาด", "เอ็นไขว้หน้าฉีก", "เอ็นไขว้หน้า"); add("Post ACL reconstruction rehabilitation", "acl reconstruction", "aclr", "post aclr", "หลังผ่าตัดเอ็นไขว้หน้า", "ผ่าเอ็นไขว้หน้า");
  add("PCL injury", "pcl", "pcl injury", "pcl tear", "เอ็นไขว้หลัง"); add("Meniscus tear", "meniscus tear", "meniscal tear", "torn meniscus", "meniscus injury", "หมอนรองเข่าฉีก", "หมอนรองกระดูกเข่าฉีก");
  add("MCL sprain", "mcl sprain", "mcl", "mcl injury", "เอ็นเข่าด้านใน"); add("LCL sprain", "lcl sprain", "lcl", "lcl injury", "เอ็นเข่าด้านนอก"); add("Knee osteoarthritis", "knee oa", "oa knee", "knee osteoarthritis", "knee arthritis", "เข่าเสื่อม", "ข้อเข่าเสื่อม");
  add("Osgood-Schlatter disease", "osgood", "osgood schlatter", "osgood-schlatter"); add("Quadriceps weakness / atrophy", "quad weakness", "quadriceps weakness", "quad atrophy", "quadriceps atrophy", "ต้นขาลีบ", "ต้นขาอ่อนแรง");
  add("Iliotibial band friction syndrome", "itb friction", "iliotibial band friction"); add("Pes anserine bursitis", "pes anserine", "pes anserinus"); add("Prepatellar bursitis", "prepatellar bursitis", "housemaid's knee");
  add("Post total knee replacement rehabilitation", "knee replacement", "tkr", "tka", "total knee", "หลังผ่าตัดเปลี่ยนข้อเข่า", "เปลี่ยนข้อเข่า"); add("Runner's knee", "runner's knee", "runners knee");
  add("Ankle sprain", "ankle sprain", "sprained ankle", "rolled ankle", "rolled my ankle", "twisted ankle", "inversion injury", "ข้อเท้าแพลง", "เท้าแพลง", "ข้อเท้าพลิก", "เท้าพลิก"); add("Lateral ligament ankle sprain", "lateral ligament sprain", "atfl sprain", "atfl", "lateral ankle sprain");
  add("Achilles tendinitis", "achilles tendinitis", "achilles tendonitis", "เอ็นร้อยหวายอักเสบ"); add("Achilles tendinopathy", "achilles tendinopathy"); add("Plantar fasciitis", "plantar fasciitis", "plantar fasciopathy", "plantar fascitis", "รองช้ำ", "พังผืดฝ่าเท้าอักเสบ", "ปวดส้นเท้า");
  add("Post-operative ankle rehabilitation", "post op ankle", "post-op ankle", "ankle surgery", "หลังผ่าตัดข้อเท้า"); add("Ankle instability", "ankle instability", "unstable ankle", "chronic ankle instability", "cai", "ข้อเท้าหลวม");
  add("Bone contusion", "bone bruise", "bone contusion", "กระดูกช้ำ"); add("Metatarsalgia", "metatarsalgia", "ปวดฝ่าเท้าด้านหน้า"); add("Tibialis posterior dysfunction", "tib post dysfunction", "tibialis posterior dysfunction", "pttd");
  add("Shin splints", "shin splints", "shin splint", "ปวดหน้าแข้ง"); add("Medial tibial stress syndrome", "medial tibial stress", "mtss"); add("Morton's neuroma", "morton", "morton's", "mortons neuroma"); add("Hallux valgus", "hallux valgus", "bunion", "bunions", "นิ้วโป้งเท้าเอียง", "นิ้วหัวแม่เท้าเอียง");
  add("Peroneal tendinopathy", "peroneal tendinopathy", "peroneal tendinitis"); add("Heel spur", "heel spur", "calcaneal spur", "กระดูกงอกส้นเท้า", "ส้นเท้างอก"); add("Post ankle fracture rehabilitation", "ankle fracture", "broken ankle", "ข้อเท้าหัก");
  add("General muscle tightness", "general tightness", "tight all over", "ตึงทั้งตัว"); add("Muscle spasm", "muscle spasm"); add("Postural dysfunction", "postural dysfunction");
  add("Deconditioning", "deconditioning", "deconditioned", "unfit"); add("Sports overuse injury", "overuse injury", "sports overuse"); add("Running-related injury", "running injury", "running-related", "บาดเจ็บจากการวิ่ง");
  add("Delayed onset muscle soreness", "doms", "delayed onset"); add("Sedentary lifestyle-related pain", "sedentary", "นั่งนานเกิน"); add("Fibromyalgia", "fibromyalgia", "ไฟโบรมัยอัลเจีย");
  add("Generalised hypermobility", "generalised hypermobility", "generalized hypermobility", "hypermobility syndrome", "ข้อหลวมทั่วตัว"); add("Work-related musculoskeletal disorder", "work related", "work-related", "wmsd", "บาดเจ็บจากการทำงาน");
  add("Office syndrome", "office syndrome", "ออฟฟิศซินโดรม", "ออฟฟิตซินโดรม"); add("Muscle tightness from hormonal changes during pregnancy", "pregnancy tightness", "ตึงจากตั้งครรภ์");
  add("Scoliosis", "scoliosis", "scoriosis", "secoliosis", "scoliose", "หลังคด", "กระดูกสันหลังคด");
  add("Sacroiliac joint dysfunction", "si joint dysfunction", "s i joint", "si toy", "si joy", "your joy dysfunction", "sacro iliac", "sacroiliac dysfunction", "si joint problem", "เอสไอจอย", "เอสไอจอยดิสฟังก์ชัน", "ข้อต่อเอสไอ", "sij problem");
  add("Muscle imbalance", "มัสเซลอินบาลานซ์", "มัสเซิลอิมบาลานซ์", "มัสเซิลอินบาลานซ์", "muscle in balance", "muscle imbalanced", "kinetic imbalance");
  add("Office syndrome", "ออฟฟิศซินโดม", "ออฟฟิสซินโดม", "office syndrom");
  add("Degenerative disc disease", "degenerative of your low back", "degenerative of your low", "degenerative of the low back", "degeneration in your lower back", "degenerative low back", "degeneration of your low back", "degenerative change", "degenerative changes", "wear and tear of the spine", "หมอนรองกระดูกเสื่อม", "กระดูกสันหลังเสื่อม");
  add("Cervical spondylosis", "narrowing at c6 c7", "narrowing around c6", "c6 and c7 is narrowing", "cervical narrowing");
  const GENERIC_DX = new Set(["Muscle tightness", "Muscle spasm", "General muscle tightness", "Scoliosis", "Swelling", "Poor posture", "Muscle tension", "Muscle strain", "Overuse"]);
  const DXCTX = /\b(diagnos\w*|dx|impression|analysis|assessment|condition|suspect\w*|likely|consistent with)\b|วินิจฉัย|น่าจะเป็น|สงสัย|เป็นโรค/;
  const ALL_DX = Object.values(V.DIAGNOSES).flat();

  // Plan goals
  add("Reduce pain", "reduce pain", "ลดปวด", "ลดอาการปวด"); add("Pain control", "pain control", "control pain", "ควบคุมอาการปวด", "คุมปวด");
  add("Inflammation control", "inflammation control", "reduce inflammation", "control inflammation", "anti-inflammatory", "ลดอักเสบ", "ลดการอักเสบ"); add("Reduce swelling", "reduce swelling", "decrease swelling", "ลดบวม");
  add("Reduce tenderness", "reduce tenderness", "ลดกดเจ็บ"); add("Reduce muscle tension", "reduce muscle tension", "reduce tension", "reduce tightness", "ลดตึง", "ลดความตึง"); add("Release muscle tension", "release muscle tension", "release tension", "release the muscle", "คลายกล้ามเนื้อ", "คลายตึง");
  add("Maintain ROM and muscle strength", "maintain rom", "maintain range", "maintain strength", "คงองศา", "คงความแข็งแรง"); add("Maintain muscle and joint mobility", "maintain mobility", "คงการเคลื่อนไหว");
  add("Increase ROM", "increase rom", "improve rom", "increase range", "regain range", "restore range", "เพิ่มองศา", "เพิ่มช่วงการเคลื่อนไหว"); add("Improve muscle power", "improve muscle power", "increase power", "เพิ่มกำลัง");
  add("Improve muscle strength", "improve strength", "increase strength", "strengthening", "build strength", "get stronger", "เพิ่มความแข็งแรง", "เสริมความแข็งแรง", "เพิ่มแรง"); add("Improve posture", "improve posture", "correct posture", "posture correction", "ปรับท่าทาง", "แก้ท่าทาง", "ปรับบุคลิก");
  add("Improve balance and proprioception", "improve balance", "balance training", "proprioception", "ทรงตัว", "ฝึกการทรงตัว"); add("Improve scapular control", "scapular control", "scapular stability", "คุมสะบัก");
  add("Improve core stability", "core stability", "core strength", "core strengthening", "แกนกลาง", "คอร์"); add("Correct movement pattern", "movement pattern", "movement correction", "retrain movement", "ปรับการเคลื่อนไหว", "แก้รูปแบบการเคลื่อนไหว");
  add("Return to sport", "return to sport", "back to sport", "return to play", "rts", "กลับไปเล่นกีฬา", "กลับไปวิ่ง"); add("Return to work", "return to work", "rtw", "กลับไปทำงาน");
  add("Home programme progression", "home programme progression", "home program progression", "progress home program", "progress the home programme"); add("Patient education", "education", "educate", "educated", "explain", "explained", "ให้ความรู้", "อธิบาย");
  add("Education and empowerment", "empowerment", "self management", "self-management", "ดูแลตัวเอง"); add("Prevent recurrence", "prevent recurrence", "prevention", "avoid recurrence", "stop it coming back", "ป้องกันการกลับมาเป็นซ้ำ", "ป้องกันการเป็นซ้ำ", "ไม่ให้เป็นซ้ำ");

  // Treatment modalities (closed list) — aliases extend the existing ones
  add("Ultrasound (US)", "ultrasound", "u/s", "อัลตร้า", "อัลตรา"); add("US combined with stim", "us combine", "us combined", "combine", "combined with stim", "ultrasound combined with stim", "ultrasound combined", "ultrasound combine", "ultrasound with stim", "us with stim", "คอมบาย", "อัลตร้าซาวด์ร่วมกับกระตุ้นไฟฟ้า", "อัลตราซาวด์ร่วมกับกระตุ้นไฟฟ้า", "ร่วมกับกระตุ้นไฟฟ้า", "อัลตร้าซาวด์คอมบาย");
  add("US + IFC", "us + ifc", "us and ifc", "us with ifc", "ultrasound and ifc"); add("IFC (interferential current)", "ifc", "interferential", "ไอเอฟซี"); add("TENS", "tens", "เทนส์");
  add("Electrical stimulation", "electrical stimulation", "electrical stim", "e-stim", "estim", "nmes", "ems", "กระตุ้นไฟฟ้า", "ไฟฟ้ากระตุ้น"); add("High power LASER (HPLT)", "laser", "hplt", "high power laser", "เลเซอร์");
  add("Ultrasound (US)", "untrasound", "ultra sound", "อัลตร้าซาวด์", "อัลตราซาวด์"); add("Massage", "samassar", "manual release", "release the muscle by hand", "คลายกล้ามเนื้อด้วยมือ");
  add("Spinal mobilization", "mobilize your spine", "mobilise your spine", "mobilize your spy", "open the canal", "ขยับข้อต่อกระดูกสันหลัง");
  add("Shockwave therapy", "shockwave", "shock wave", "eswt", "ช็อคเวฟ", "ช็อกเวฟ", "คลื่นกระแทก"); add("Peripheral magnetic stimulation (PMS)", "pms", "magnetic stimulation", "peripheral magnetic", "แม่เหล็ก", "คลื่นแม่เหล็ก");
  add("Neck traction", "neck traction", "cervical traction", "ดึงคอ"); add("Pelvic traction", "pelvic traction", "lumbar traction", "ดึงหลัง", "ดึงเอว");
  add("Hot pack", "hot pack", "hotpack", "hot packs", "heat pack", "ประคบร้อน", "แผ่นร้อน", "ฮอตแพค", "ฮอทแพค"); add("Cold pack", "cold pack", "ice pack", "cold packs", "cryotherapy", "ประคบเย็น", "แผ่นเย็น");
  add("Massage", "massage", "massaged", "deep friction", "soft tissue release", "soft tissue", "release the knots", "release the knots by hand", "release the muscles by hand", "release by hand", "work on the knots", "work into the muscle", "trigger point release", "myofascial release", "press on the knot", "นวด", "กดจุด", "คลายกล้ามเนื้อ"); add("Stretching", "stretching", "stretch", "stretched", "ยืด", "ยืดกล้ามเนื้อ"); add("Passive stretch", "passive stretch", "passive stretching", "ยืดแบบพาสซีฟ");
  add("Joint mobilization", "joint mobilization", "joint mobilisation", "mobilization", "mobilisation", "mobs", "mobilized", "mobilised", "move the joint for you", "gently move the ankle joint", "gently move the joint", "small movements to keep it from stiffening", "glide the joint", "loosen the joint", "ขยับข้อ", "ดัดข้อ", "โมบิไลซ์", "โมบิไลเซชั่น"); add("Spinal mobilization", "spinal mobilization", "spinal mobilisation", "spinal mobs", "lumbar mobilization", "lumbar mobilisation", "cervical mobilization", "cervical mobilisation", "ขยับกระดูกสันหลัง");
  add("Cupping", "cupping", "ครอบแก้ว", "คัพปิ้ง"); add("Taping", "taping", "taped", "tape the", "tape your", "tape it", "put tape on", "kinesio", "kinesiotape", "k-tape", "เทปปิ้ง", "ติดเทป", "แปะเทป");
  add("Home advice", "home advice", "advice", "advise", "advised", "advice given", "แนะนำ", "ให้คำแนะนำ", "คำแนะนำ");
  add("Refer for MRI", "recommend you to do mri", "recommend mri", "recommend an mri", "refer for mri", "refer you for an mri", "send you for an mri", "mri of your low back", "do mri", "ส่งตรวจ mri", "ทำ mri", "แนะนำให้ทำ mri");
  add("Refer for X-ray", "recommend x-ray", "recommend an x-ray", "refer for x-ray", "need an x-ray", "send you for an x-ray", "แนะนำให้เอ็กซเรย์", "ส่งเอ็กซเรย์", "ต้องเอ็กซเรย์"); add("Refer to doctor", "refer you to the doctor", "see the doctor", "refer to a doctor", "ส่งพบแพทย์", "แนะนำให้พบแพทย์");
  add("Forward head posture", "head sits forward", "head forward of your shoulders", "head is forward", "head pokes forward", "head sits a little forward", "head sits in front");
  add("Round shoulder", "shoulders are rounded forward", "shoulders round forward", "shoulders roll forward", "rounded shoulders", "brow shoulder", "grab of shoulder", "round of shoulder", "ไหล่มุ้ม", "ไหล่งุ้มไปข้างหน้า");
  add("Forward head", "หน้ายื่น", "หัวยื่นไปข้างหน้า", "forward head posture", "head forward");
  add("Scoliosis", "scoriosis", "secoliosis", "scoliosi", "coliosi", "scoliose", "กระดูกสันหลังคดนิดหน่อย", "หลังคดนิดหน่อย", "สันหลังคดเล็กน้อย");
  add("Knee valgus", "collapsed knee", "knee collapse", "knee is collapsed", "knees collapse in", "เข่าเข้าใน", "เข่าหมุนเข้า", "เข่าเข้าไปข้างใน", "เข่าบิดเข้าใน");
  add("Genu recurvatum", "เข่าล็อก", "เข่าล็อกเข้ามา", "knee locks back", "hyperextension of your knee", "hyper extension of your knee", "knee hyperextension", "hyper a tension of your knee", "knees lock back", "เข่าแอ่นไปข้างหลัง");
  add("Hip elevation Rt.", "สะโพกขวาสูงกว่า", "สะโพกขวามันดูสูงกว่า", "right hip is higher", "right hip higher", "right hip sits higher", "pelvis higher on the right"); add("Hip elevation Lt.", "สะโพกซ้ายสูงกว่า", "สะโพกซ้ายมันดูสูงกว่า", "left hip is higher", "left hip higher", "left hip sits higher", "pelvis higher on the left");
  add("Shoulder level Rt.>Lt.", "ไหล่ขวาสูงกว่า", "ไหล่ขวาสูงกว่าซ้าย", "right shoulder higher"); add("Shoulder level Lt.>Rt.", "ไหล่ซ้ายสูงกว่า", "ไหล่ซ้ายสูงกว่าขวา", "ไหล่ทางด้านซ้ายของเราจะสูง", "left shoulder higher", "left shoulder is higher than the right");
  add("Lumbar hyperlordosis", "หลังแอ่น", "หลังล่างแอ่น", "เอวแอ่น", "lower back is arched", "increased lumbar curve"); add("Clavicle asymmetry", "clavicle is higher", "clavicle one side higher", "collarbone is higher", "collarbone higher on", "ไหปลาร้าสูงไม่เท่ากัน");
  add("Scapular winging", "shoulder blade sticks out", "shoulder blade wings", "สะบักปีก", "สะบักเหิม"); add("Flat feet", "feet are flat", "flat foot a bit", "เท้าแบนนิดหน่อย", "เท้าแบนกว่า");
  add("Thoracic hyperkyphosis", "upper back is rounded", "upper back is a little rounded", "rounded upper back", "hunched upper back", "hunched over");
  add("Shoulder level Rt.>Lt.", "right shoulder is higher", "right shoulder is slightly higher", "right shoulder sits higher", "left shoulder is lower", "left shoulder is a little lower", "left shoulder sits lower");
  add("Shoulder level Lt.>Rt.", "left shoulder is higher", "left shoulder is slightly higher", "left shoulder sits higher", "right shoulder is lower", "right shoulder is a little lower", "right shoulder sits lower");
  add("Scapular protraction", "shoulder blade sits further out", "shoulder blade sits out", "shoulder blade is further out", "shoulder blade sits a little further out", "shoulder blade sits forward");
  add("Lumbar shift to Rt.", "leaning to the right", "leaning a little to the right", "shifted to the right", "leaning over to the right"); add("Lumbar shift to Lt.", "leaning to the left", "leaning a little to the left", "shifted to the left", "leaning over to the left");
  add("Flatback", "lower back is quite flat", "lost the normal curve", "lower back is flat", "back is flat", "flat lower back", "lost the curve in your lower back");
  add("Lumbar hyperlordosis", "arch in your lower back", "bit of an arch in your lower back", "lower back arches", "increased arch");
  add("Anterior pelvic tilt", "pelvis tips forward", "pelvis tilts forward", "pelvis tipped forward");
  add("Knee valgus", "knees turn in", "knee drifts inwards", "knee drifts in", "knee falls in", "knees fall in", "knee collapses inwards", "knee goes inwards");
  add("Patellar lateral shift", "kneecap sits a little more to the outside", "kneecap sits to the outside", "kneecap sits outwards", "kneecap is pulled to the outside");
  add("Antalgic gait", "you're limping", "you are limping", "limping", "with a limp", "not putting full weight", "walking a little stiffly", "short step on the", "favouring the");
  add("Swelling", "swollen", "puffy", "swelled up"); add("Bruising", "bruised", "bruise", "bruising coming through");
  const TRACTION = ["traction"];
  const MODALITIES = Object.keys(V.TREATMENT_MODALITIES);

  // Positions and session
  add("Supine lying", "supine", "supine lying", "lying on the back", "on their back", "นอนหงาย"); add("Prone lying", "prone", "prone lying", "lying on the front", "face down", "นอนคว่ำ");
  add("Side lying to Rt.", "side lying to rt", "side lying right", "side lying to right", "side lying to the right", "right side lying", "right side-lying", "sidelying right", "lying on the right", "นอนตะแคงขวา", "ตะแคงขวา"); add("Side lying to Lt.", "side lying to lt", "side lying left", "side lying to left", "side lying to the left", "left side lying", "left side-lying", "sidelying left", "lying on the left", "นอนตะแคงซ้าย", "ตะแคงซ้าย");
  add("Sitting", "in sitting", "sitting position", "seated", "position sitting"); add("Standing", "in standing", "standing position", "ท่ายืน"); add("Long sitting", "long sitting", "นั่งเหยียดขา");
  add("Half lying", "half lying", "semi-recumbent", "นอนกึ่งนั่ง"); add("Four point kneeling", "four point kneeling", "4 point kneeling", "quadruped", "all fours", "on all fours", "คลาน", "ท่าคลาน");
  const SESSION = /\b(60|90|45)\s*(?:min|mins|minutes|นาที)\b|\b(1|one)\s*(?:hour|hr|ชั่วโมง)\b|ชั่วโมงครึ่ง|\b1\.5\s*(?:hour|hours|hr|hrs|ชั่วโมง)\b/g;
  const SESSIONCTX = /session|cpg|treatment (?:time|for|today)|treated for|treat you for|today'?s treatment|รักษา|ทรีตเมนต์|ครั้งนี้/;
  const WORKCTX = /\b(work|working|per day|a day|job|desk|computer|drive|driving|sleep|sitting|sit)\b|ทำงาน|ต่อวัน|นั่ง/;
  const TT = /treatment times?\s*[:#]?\s*(\d+)|(\d+)(?:st|nd|rd|th)\s*(?:visit|session|treatment)|(?:visit\s*(?:no\.?|number|#)?|session\s*(?:no\.?|number|#))\s*(\d+)\b(?!\s*(?:min|นาที|%|\/))|ครั้งที่\s*(\d+)/;

  // Exercises
  add("Straight leg raise (SLR)", "straight leg raise exercise", "straight leg raises", "slr exercise", "slr exercises", "ยกขาตรง"); add("Romanian deadlift (RDL)", "romanian deadlift", "rdl", "rdls"); add("Terminal knee extension (TKE)", "terminal knee extension", "tke");
  add("Quad set", "quad set", "quad sets", "quads set", "static quads", "เกร็งต้นขา", "เกร็งเข่า"); add("Heel slide", "heel slide", "heel slides", "ไถส้นเท้า"); add("Mini squat", "mini squat", "mini squats", "half squat", "สควอทเตี้ย");
  add("Wall sit", "wall sit", "wall sits", "นั่งพิงกำแพง"); add("Glute bridge", "glute bridge", "bridge", "bridging", "bridges", "สะพาน", "บริดจ์", "ยกสะโพก"); add("Single leg glute bridge", "single leg bridge", "single leg glute bridge", "one leg bridge", "สะพานขาเดียว");
  add("Plank", "plank", "planks", "planking", "แพลงก์", "แพลงค์"); add("Side plank", "side plank", "side planks", "แพลงก์ข้าง"); add("Dead bug", "dead bug", "dead bugs", "deadbug"); add("Bird dog", "bird dog", "bird dogs", "birddog");
  add("Clamshell", "clamshell", "clamshells", "clam", "clams", "หอย", "ท่าหอย"); add("Clamshell with band", "clamshell with band", "banded clamshell", "หอยกับยาง"); add("Side-lying hip abduction", "side lying hip abduction", "side-lying hip abduction", "side lying abduction", "นอนตะแคงกางขา", "ตะแคงยกขา");
  add("Standing hip abduction with band", "standing hip abduction", "standing abduction", "ยืนกางขา"); add("Monster walk", "monster walk", "monster walks"); add("Lateral band walk", "lateral band walk", "band walk", "crab walk", "เดินข้างกับยาง", "เดินปู");
  add("Hip flexor stretch", "hip flexor stretch", "ยืดสะโพกด้านหน้า"); add("Piriformis stretch", "piriformis stretch", "ยืดพิริฟอร์มิส", "ยืดก้น"); add("ITB stretch", "itb stretch", "it band stretch", "ยืดไอทีแบนด์"); add("Adductor stretch", "adductor stretch", "groin stretch", "ยืดขาหนีบ");
  add("90/90 hip rotation", "90/90", "90 90 hip", "ninety ninety"); add("Hip hinge", "hip hinge", "hinge", "ฮิปฮินจ์"); add("Single leg RDL", "single leg rdl", "single leg deadlift", "single-leg rdl"); add("Split squat hold", "split squat hold", "split squat");
  add("Step up", "step up", "step ups", "step-up", "step-ups", "ก้าวขึ้นกล่อง"); add("Lateral step down", "lateral step down", "lateral step-down"); add("Copenhagen plank", "copenhagen", "copenhagen plank");
  add("Chin tuck", "chin tuck", "chin tucks", "chin in", "เก็บคาง"); add("Chin tuck with lift", "chin tuck with lift", "chin tuck lift"); add("Cervical retraction", "cervical retraction", "neck retraction", "retraction"); add("Deep neck flexor activation", "deep neck flexor activation", "dnf activation", "deep neck flexor exercise", "deep neck flexor training");
  add("Upper trapezius stretch", "upper trapezius stretch", "upper trap stretch", "trap stretch", "ยืดบ่า"); add("Levator scapulae stretch", "levator scapulae stretch", "levator stretch"); add("Sub-occipital release", "suboccipital release", "sub-occipital release", "sub occipital release");
  add("Scapular retraction", "scapular retraction", "shoulder blade squeeze", "หนีบสะบัก", "บีบสะบัก"); add("Scapular squeeze", "scapular squeeze", "scap squeeze"); add("Wall angel", "wall angel", "wall angels"); add("Prone Y raise", "prone y", "y raise", "y raises");
  add("Prone T raise", "prone t", "t raise", "t raises"); add("Prone W raise", "prone w", "w raise", "w raises"); add("Serratus wall slide", "serratus wall slide", "serratus slide"); add("Thoracic extension over foam roller", "thoracic extension", "foam roller extension", "foam roll thoracic", "แอ่นหลังบนโฟม");
  add("Thoracic rotation open book", "open book", "open books", "thoracic rotation exercise", "หมุนอกเปิดหนังสือ"); add("Cat camel", "cat camel", "cat cow", "cat-cow", "cat-camel", "ท่าแมว"); add("Band row", "band row", "band rows", "row with band", "rowing with band", "seated row", "ดึงยาง");
  add("Face pull", "face pull", "face pulls"); add("Doorway pec stretch", "doorway stretch", "pec stretch", "doorway pec stretch", "ยืดอก"); add("Pendulum", "pendulum", "pendulums", "codman", "แกว่งแขน");
  add("Wall slide", "wall slide", "wall slides", "ไต่กำแพง", "ไต่ผนัง"); add("Shoulder flexion AAROM with stick", "aarom flexion", "stick flexion", "flexion with stick", "ยกไม้"); add("Shoulder abduction AAROM with stick", "aarom abduction", "stick abduction", "abduction with stick");
  add("External rotation with band", "external rotation with band", "er with band", "banded er", "band er", "หมุนออกกับยาง"); add("Internal rotation with band", "internal rotation with band", "ir with band", "banded ir", "band ir", "หมุนเข้ากับยาง");
  add("Isometric ER", "isometric er", "isometric external rotation"); add("Isometric IR", "isometric ir", "isometric internal rotation"); add("Isometric abduction", "isometric abduction"); add("Sleeper stretch", "sleeper stretch", "sleeper");
  add("Cross-body stretch", "cross body stretch", "cross-body stretch", "posterior capsule stretch", "ยืดไหล่ด้านหลัง"); add("Side-lying ER", "side lying er", "side-lying er", "side lying external rotation"); add("Full can raise", "full can raise", "full can exercise");
  add("Scaption raise", "scaption", "scaption raise"); add("Push-up plus", "push up plus", "push-up plus", "pushup plus"); add("Bear crawl hold", "bear crawl", "bear hold"); add("Overhead press", "overhead press", "shoulder press", "ดันเหนือหัว");
  add("Landmine press", "landmine press", "landmine"); add("Rhythmic stabilisation", "rhythmic stabilisation", "rhythmic stabilization", "perturbation");
  add("Wrist extensor eccentric", "wrist extensor eccentric", "eccentric wrist extension", "eccentric wrist extensor"); add("Wrist flexor eccentric", "wrist flexor eccentric", "eccentric wrist flexion"); add("Tyler twist", "tyler twist", "flexbar");
  add("Grip strengthening with ball", "grip strengthening", "grip strength", "squeeze ball", "squeeze a ball", "ball squeeze", "บีบลูกบอล", "บีบบอล"); add("Wrist extension with band", "wrist extension with band", "banded wrist extension"); add("Supination / pronation with weight", "supination pronation", "pronation supination", "hammer rotation");
  add("Nerve glide — radial", "radial nerve glide", "radial nerve glides", "radial glide"); add("Nerve glide — median", "median nerve glide", "median nerve glides", "median glide"); add("Nerve glide — ulnar", "ulnar nerve glide", "ulnar nerve glides", "ulnar glide");
  add("Tendon glide", "tendon glide", "tendon glides", "tendon gliding"); add("Thumb opposition", "thumb opposition", "opposition"); add("Putty exercises", "putty", "theraputty");
  add("Transversus abdominis activation", "transversus abdominis activation", "tva activation", "core activation", "draw in", "drawing in", "เกร็งหน้าท้อง", "แขม่วท้อง"); add("Plank with shoulder tap", "shoulder tap", "shoulder taps", "plank shoulder tap");
  add("Pallof press", "pallof press", "pallof"); add("Hip thrust", "hip thrust", "hip thrusts"); add("Curl up", "curl up", "curl ups", "curl-up", "crunch", "crunches", "ซิทอัพ"); add("Bicycle crunch", "bicycle crunch", "bicycle crunches", "bicycles");
  add("Hollow hold", "hollow hold", "hollow body"); add("Diaphragmatic breathing", "diaphragmatic breathing", "belly breathing", "breathing exercise", "breathing exercises", "ฝึกหายใจ", "หายใจด้วยกระบังลม"); add("Pelvic tilt", "pelvic tilt", "pelvic tilts", "เอียงเชิงกราน");
  add("McGill big three", "mcgill", "big three", "big 3"); add("Suitcase carry", "suitcase carry"); add("Farmer carry", "farmer carry", "farmers carry", "farmer's carry", "farmer walk");
  add("Squat", "squat"); add("Goblet squat", "goblet squat", "goblet squats"); add("Leg press", "leg press"); add("Leg extension", "leg extension", "leg extensions", "knee extension machine"); add("Hamstring curl", "hamstring curl", "hamstring curls", "leg curl", "leg curls", "งอเข่ากับยาง");
  add("Nordic hamstring curl", "nordic", "nordics", "nordic curl", "nordic hamstring"); add("Step down", "step down", "step downs", "step-down"); add("Spanish squat", "spanish squat", "spanish squats"); add("VMO activation", "vmo activation", "vmo exercise", "vmo");
  add("Isometric knee extension hold", "isometric knee extension", "isometric quad", "isometric quads"); add("Cycling", "cycling", "cycle", "bike", "ปั่นจักรยาน", "จักรยาน"); add("Treadmill walking", "treadmill walking", "walk on the treadmill", "เดินลู่", "เดินบนลู่"); add("Return-to-run progression", "return to run", "return to running", "run progression", "โปรแกรมกลับไปวิ่ง");
  add("Ankle pump", "ankle pump", "ankle pumps", "ankle pumping", "กระดกข้อเท้าขึ้นลง", "ปั๊มข้อเท้า"); add("Alphabet ankle ROM", "ankle alphabet", "alphabet", "abc ankle", "เขียนตัวอักษรด้วยเท้า"); add("Dorsiflexion stretch", "dorsiflexion stretch", "knee to wall stretch");
  add("Calf stretch — gastrocnemius", "calf stretch", "gastroc stretch", "gastrocnemius stretch", "ยืดน่อง"); add("Calf stretch — soleus", "soleus stretch", "bent knee calf stretch"); add("Heel raise double leg", "double leg heel raise", "double leg calf raise", "two leg heel raise", "เขย่งสองขา");
  add("Heel raise single leg", "single leg heel raise", "single leg calf raise", "one leg heel raise", "เขย่งขาเดียว"); add("Eccentric heel drop", "heel drop", "heel drops", "eccentric heel drop", "eccentric calf", "alfredson"); add("Inversion with band", "inversion with band", "banded inversion");
  add("Eversion with band", "eversion with band", "banded eversion"); add("Towel scrunch", "towel scrunch", "towel scrunches", "towel curl", "towel curls", "ขยำผ้า"); add("Toe spread", "toe spread", "toe spreading", "แยกนิ้วเท้า"); add("Short foot exercise", "short foot", "short foot exercise", "arch lift");
  add("Single leg balance on foam", "single leg balance on foam", "balance on foam", "foam balance", "ยืนขาเดียวบนโฟม"); add("Wobble board", "wobble board", "balance board", "บอร์ดทรงตัว"); add("Hop and hold", "hop and hold", "hop hold"); add("Lateral hop", "lateral hop", "lateral hops", "side hop", "side hops", "กระโดดข้าง");
  add("Single leg balance eyes open", "single leg balance eyes open", "eyes open balance"); add("Single leg balance eyes closed", "single leg balance eyes closed", "eyes closed balance", "หลับตายืนขาเดียว"); add("Balance on bosu", "bosu", "bosu balance", "on the bosu", "โบซู");
  add("Land and hold single leg", "land and hold", "land and hold single leg", "single leg landing", "landing"); add("Land and hold with ball throw", "ball throw", "land and hold with ball throw", "landing with ball throw"); add("Vertical jump", "vertical jump", "vertical jumps", "กระโดดขึ้น");
  add("Vertical jump with split leg on bosu", "split leg jump on bosu", "split jump on bosu"); add("Box jump", "box jump", "box jumps", "กระโดดกล่อง"); add("Drop jump", "drop jump", "drop jumps", "depth jump"); add("Broad jump", "broad jump", "broad jumps", "กระโดดไกล");
  add("Lateral bound", "lateral bound", "lateral bounds", "skater", "skaters", "skater jumps"); add("Agility ladder", "agility ladder", "ladder drill", "ladder drills", "บันไดลิง"); add("Change of direction drill", "change of direction", "cod drill", "cutting drill", "cutting");
  add("Sprint progression", "sprint", "sprints", "sprinting", "วิ่งเร็ว"); add("Plyometric progression", "plyometric", "plyometrics", "plyo", "พลัยโอเมตริก"); add("Sport-specific drill", "sport specific", "sport-specific", "sports specific");
  add("Pilates reformer — footwork", "footwork", "reformer footwork"); add("Pilates reformer — leg circles", "leg circles"); add("Pilates mat — hundred", "the hundred", "pilates hundred"); add("Pilates mat — roll up", "roll up", "roll ups", "roll-up");
  add("Pilates — spine stretch", "spine stretch"); add("Pilates — swan", "swan"); add("Stationary bike", "stationary bike", "exercise bike", "spin bike", "จักรยานอยู่กับที่"); add("Treadmill", "treadmill", "ลู่วิ่ง"); add("Cross trainer", "cross trainer", "elliptical");
  add("Rowing machine", "rowing machine", "rower", "เครื่องพาย"); add("General mobility circuit", "mobility circuit", "mobility work", "mobility drills");
  // the same exercises in the words physios use with patients (no anatomy)
  add("Lateral band walk", "walk sideways", "walking sideways", "side steps with the band", "side step with the band", "sidestep with the band", "band around the ankles, walk", "band around your ankles, walk");
  add("Quad set", "squeeze the front of the thigh", "squeeze the front of your thigh", "squeeze your thigh", "tighten the front of your thigh", "push the back of your knee down");
  add("Step down", "step down slowly from", "slow step down", "step-down exercise", "step down exercise", "step down from the small step", "step down from the step", "step down from the box");
  add("Glute bridge", "squeeze your bottom at the top", "lift your hips off the floor", "lift your bottom off the floor", "bridge on the floor");
  add("ITB stretch", "cross the leg over and lean", "cross your leg over and lean", "cross the leg over and lean away");
  add("Quadriceps stretch", "pull the heel back", "pull your heel back", "stretch the front of your thigh", "thigh stretch", "the thigh stretch");
  add("Hip flexor stretch", "stretch the front of your hip", "stretch for the front of your hip", "front of your hip stretch", "front of the hip stretch");
  add("Hamstring stretch", "stretch the back of your thigh", "back of your thigh stretch", "hamstring stretch");
  add("Calf stretch", "stretch your calf", "stretch the calf", "calf stretch", "heel down and lean into the wall");
  add("Side-lying ER", "rotate the arm up and down", "rotate your arm up and down", "small weight, rotate the arm");
  add("External rotation with band", "pull the hands apart", "pull your hands apart", "rotate out against the band", "elbows at your sides, pull the hands", "elbows at your sides, pull your hands");
  add("Wall slide", "forearms on the wall", "slide them up and down", "slide your arms up the wall", "slide your forearms up");
  add("Prone Y raise", "arms out in a y", "arms in a y", "make a y with your arms"); add("Prone T raise", "arms out in a t", "arms in a t", "and a t,", "and a t "); add("Prone W raise", "arms in a w", "and a w", "make a w");
  add("Doorway pec stretch", "in the doorway", "arm on the frame", "arms on the frame", "lean through the doorway");
  add("Sleeper stretch", "arm forward, i'll press the hand down", "arm forward, i will press the hand down", "press the hand down towards the bed", "press your hand down towards the bed");
  add("Prone press-up", "push up onto your elbows", "up onto your elbows", "press up on your elbows", "prone press up", "prone press-up", "press-ups on your elbows", "push up on your hands and let your hips sag");
  add("Prone on elbows", "lying on your front on elbows", "front on elbows", "prone on elbows", "on your front on your elbows");
  add("Transversus abdominis activation", "pull your tummy in", "draw your tummy in", "pull your belly in", "belly button in", "tummy in gently", "draw your belly button");
  add("Lower trunk rotation", "rock your knees side to side", "knees side to side", "knees from side to side", "lower trunk rotation", "rock the knees");
  add("Standing back extension", "lean back gently", "standing lean back", "hands on your hips, lean back", "standing back extension", "back extension in standing", "lean back ten times", "lean back 10 times");
  add("Walking program", "walking program", "walking programme", "short walks", "walk 15 minutes", "walk 10 minutes", "walk 20 minutes", "walk 30 minutes", "walk for 15 minutes", "walk for 10 minutes", "walk for 20 minutes", "walk for 30 minutes", "เดินออกกำลัง");
  add("Ankle pump", "pump your foot", "pump the foot", "foot pumps", "foot up and down", "ankle pumps", "กระดกข้อเท้า");
  add("Alphabet ankle ROM", "the alphabet", "draw the alphabet", "write the alphabet", "เขียนตัวอักษร");
  add("Eversion with band", "pull the foot outwards against the band", "foot outwards against the band", "outwards against the band", "turn the foot out against the band", "push the foot out against the band");
  add("Inversion with band", "inwards against the band", "foot inwards against the band", "inwards gently", "turn the foot in against the band");
  add("Heel raise", "up onto your toes", "go up onto your toes", "rise up on your toes", "up on your toes and down", "heel raises", "calf raises", "calf raise", "เขย่งปลายเท้า");
  add("Single leg balance", "try to balance", "balance on one leg", "balance on one foot", "stand on one leg", "stand on one foot", "one leg balance", "ยืนขาเดียว");
  add("Chin tuck", "double chin", "chin straight back", "pull your chin back", "pull your chin straight back", "ทำคางสองชั้น");
  add("Scapular retraction", "shoulder blades back and down", "squeeze your shoulder blades back", "shoulder blade squeeze", "squeeze the shoulder blades back");
  add("Wall angel", "goal post", "goalpost", "arms up like a goal post", "back against the wall, arms up");
  add("Band row", "pull it towards you, elbows back", "pull the band towards you", "elbows back, squeeze the shoulder blades", "row with the band", "pull the band back");
  add("Upper trapezius stretch", "press your right shoulder down", "press your left shoulder down", "press your shoulder down", "ear to shoulder stretch", "ear towards your shoulder and hold");
  add("Levator scapulae stretch", "turn your head to the left and look down", "turn your head to the right and look down", "look down towards your armpit", "nose to armpit", "nose towards your armpit");
  ALIAS_NUM();
  const ALL_EX = Object.values(V.EXERCISES).flat();
  const FUNC_SET = new Set([...V.FUNCTIONAL, ...Object.values(V.FUNCTIONAL_BY_REGION).flat()]);
  const EX_SET = new Set(ALL_EX);
  const DOSE1 = /(\d+)\s*(?:x|×|\*|times|reps?|steps?|holds?|ครั้ง)[^\d\n]{0,16}?(\d+)\s*(?:sets?|เซ็ต|เซต|รอบ)/, DOSE2 = /(\d+)\s*(?:sec|secs|seconds|วินาที|วิ)\s*(?:hold)?[^\d\n]{0,10}?(?:x|×|\*|times)\s*(\d+)/, DOSE3 = /(\d+)\s*(?:reps?|repetitions?|ครั้ง)\b/, DOSE2B = /(\d+)\s*(?:sec|secs|seconds|วินาที|วิ)[^\d\n]{0,8}?(\d+)\s*(?:times|x|×|reps?|ครั้ง|รอบ)/;
  const DAILY = /\b(daily|every day|each day)\b|ทุกวัน/, TWICE = /\b(twice daily|twice a day|two times a day|2x\/day|bid)\b|วันละ 2 ครั้ง|วันละสองครั้ง/;
  function dose(c) {
    let m;
    if ((m = DOSE1.exec(c))) return `${m[1]} x ${m[2]} sets`;
    if ((m = DOSE2.exec(c))) return `${m[1]} sec hold x ${m[2]}`;
    if ((m = DOSE2B.exec(c))) return `${m[1]} sec hold x ${m[2]}`;
    if ((m = DOSE3.exec(c))) return `${m[1]} reps`;
    if (TWICE.test(c)) return "twice daily"; if (DAILY.test(c)) return "daily";
    return BLANK;
  }
  const VAS = /(?:\bvas\b|\bnprs\b|pain score|pain scale|pain level|pain\b|ปวด|คะแนน)[^0-9]{0,14}(\d{1,2})\s*(?:\/|out of|จาก|เต็ม)\s*10\b|\b(\d{1,2})\s*\/\s*10\b|\bvas\s*(\d{1,2})\b/;
  const GRADE = /(?:\b(?:grade|mmt|power|strength|กำลัง|แรง)?\s*([0-5](?:\+|-)?)\s*(?:\/|out of|over|เต็ม)\s*5\b)|(?:\bgrade\s*([0-5](?:\+|-)?)(?![\d\/.]))/g;


  // ---- added 2026-09-05 from the tally of 56,777 chart entries ----
  add("Poor posture", "poor posture", "bad posture", "posture poor", "ท่าทางไม่ดี", "บุคลิกไม่ดี"); add("Forward head posture", "forward head posture", "fhp");
  add("Chin out", "chin out", "chin poke", "chin poking", "คางยื่น"); add("Uneven shoulder", "uneven shoulder", "uneven shoulders", "asymmetrical shoulder", "asymmetrical shoulder level", "shoulder level uneven", "ไหล่ไม่เท่ากัน", "ไหล่สูงต่ำไม่เท่ากัน");
  add("Mild flat feet", "mild flat feet", "mild flat foot", "เท้าแบนเล็กน้อย"); add("Thoracic hypokyphosis (flat back)", "hypokyphosis", "thoracic hypokyphosis", "flat thoracic");
  add("Head shift to left", "head shift to left", "head shifted to the left", "head shift left"); add("Head shift to right", "head shift to right", "head shifted to the right", "head shift right");
  add("Knee valgus", "knee valgus", "valgus knee", "valgus knees", "dynamic valgus"); add("Knee varus", "knee varus", "varus knee");
  add("No palpable warmth", "no palpable warmth", "no warmth", "ไม่ร้อน", "ไม่มีความร้อน"); add("Normal skin temperature", "normal skin temperature", "normal temperature", "skin temperature normal", "อุณหภูมิผิวปกติ");
  add("No swelling", "no swelling", "not swollen", "no oedema", "no edema", "ไม่บวม"); add("No atrophy", "no atrophy", "no muscle atrophy", "no wasting", "ไม่ลีบ");
  add("No tenderness", "no tenderness", "not tender", "non-tender", "ไม่กดเจ็บ"); add("No trigger point", "no trigger point", "no trigger points", "ไม่มีจุดกดเจ็บ");
  add("Normal", "muscle power normal", "power normal", "strength normal", "mmt normal", "normal strength", "normal power", "กำลังกล้ามเนื้อปกติ", "แรงปกติ"); add("WNL", "power wnl", "strength wnl", "muscle power wnl");
  add("Intact", "strength intact", "power intact", "muscle power intact"); add("Isometric test", "isometric test", "isometric testing"); add("MMT", "mmt", "manual muscle test", "manual muscle testing");
  add("N/A due to severity of pain", "not tested due to pain", "n/a due to pain", "unable to test due to pain", "ทดสอบไม่ได้เพราะปวด");
  add("Middle and lower trapezius weakness", "middle and lower trapezius weakness", "mid and lower trap weakness", "lower trapezius weakness", "middle trapezius weakness"); add("Rhomboid muscle weakness", "rhomboid weakness", "rhomboid muscle weakness", "rhomboids weak");
  add("Weakness of core muscle", "core weakness", "weak core", "core muscle weakness", "weakness of core", "แกนกลางอ่อนแรง"); add("Gluteus medius weakness", "gluteus medius weakness", "glute med weakness", "gluteus medius weak", "glute med weak");
  add("Neck flexor weakness", "neck flexor weakness", "deep neck flexor weakness", "weak neck flexors", "dnf weakness");
  add("Knee to wall", "knee to wall", "knee-to-wall", "ktw"); add("Hand behind neck", "hand behind neck", "hbn", "เอามือไว้หลังคอ"); add("Overhead deep squat", "overhead deep squat", "ohds", "ovh squat", "ovh deep squat");
  add("Single leg stand", "single leg stand", "single leg standing", "sls"); add("Pogos", "pogo", "pogos", "pogo jumps", "pogo hops"); add("Balance test", "balance test", "balance testing", "ทดสอบการทรงตัว");
  add("Arm raise", "arm raise test", "arm raising test"); add("Multisegmental rotation", "multisegmental rotation", "multi-segmental rotation", "msr"); add("Multisegmental flexion", "multisegmental flexion", "multi-segmental flexion", "msf"); add("Multisegmental extension", "multisegmental extension", "multi-segmental extension", "mse");

  add("PKB (prone knee bend)", "pkb", "prone knee bend", "femoral nerve stretch"); add("Adam's forward bend test", "adam haz", "adam has", "adams test", "adam's test", "adam test", "adam's forward bend", "adam forward bending", "อดัมเทส");
  add("SLR", "เอสเอลอาร์", "เอส แอล อาร์", "straight leg raising", "s l r"); add("SIJ distraction", "sij distraction", "si distraction", "sacroiliac distraction"); add("SIJ compression", "sij compression", "si compression", "sacroiliac compression");
  add("Kemp test", "kemp", "kemp's", "kemps", "quadrant test"); add("Ely test", "ely test", "ely's", "elys"); add("Hawkins test", "hawkins test", "hawkins");
  add("Gym", "gym", "gym exercise", "gym program", "gym session", "ยิม", "เข้ายิม", "ฟิตเนส", "เล่นเวท"); add("Home program", "home program", "home programme", "hep", "home exercise", "home exercises", "โปรแกรมที่บ้าน", "ท่าบริหารที่บ้าน", "การบ้าน");
  add("Stretching exercise", "stretching exercise", "stretching exercises", "ยืดเหยียด", "ท่ายืด");
  add("After treatment no complication", "no complication", "no complications", "without complication", "ไม่มีภาวะแทรกซ้อน", "ไม่มีผลข้างเคียง"); add("Post treatment: feels relief", "feels relief", "feel relief", "felt relief", "relief after treatment", "รู้สึกดีขึ้น", "เบาลง", "สบายขึ้น");
  add("Post treatment: pain decreased", "pain decreased after treatment", "pain reduced after treatment", "less pain after treatment", "post treatment pain decreased", "post treatment: pain decreased", "ปวดลดลงหลังรักษา", "หลังรักษาปวดลดลง", "หลังรักษา ปวดลดลง", "หลังรักษาไม่มีภาวะแทรกซ้อน ปวดลดลง"); add("Post treatment: ROM improved", "rom improved after treatment", "range improved after treatment", "ขยับได้ดีขึ้นหลังรักษา");
  add("E: Tension release, no complications after treatment", "tension release, no complication", "tension released, no complication"); add("Re-assessment: No complication after treatment", "re-assessment no complication", "reassessment no complication");
  add("Decrease pain", "decrease pain", "decreased pain", "pain decrease"); add("Relieve pain", "relieve pain", "pain relief", "relief pain", "release pain", "บรรเทาปวด", "บรรเทาอาการปวด");
  add("Improve joint mobility", "improve joint mobility", "joint mobility", "เพิ่มการเคลื่อนไหวของข้อ"); add("Improve mobility", "improve mobility", "increase mobility", "เพิ่มความคล่องตัว"); add("Improve range of motion", "improve range of motion", "improve range", "increase range of motion", "เพิ่มการเคลื่อนไหว");
  add("Improve muscle flexibility", "improve flexibility", "muscle flexibility", "flexibility", "improve muscle flexibility", "เพิ่มความยืดหยุ่น"); add("Continue as same plan", "continue as same plan", "continue plan", "continue the plan", "same plan as before", "แผนเดิม", "ต่อเนื่องตามแผนเดิม"); add("Same plan", "same plan");
  add("Muscle imbalance", "muscle imbalance", "muscle imbalances", "กล้ามเนื้อไม่สมดุล"); add("Muscle strain", "muscle strain", "strain", "กล้ามเนื้ออักเสบ"); add("Muscle tension", "muscle tension", "tension");
  add("Overuse", "overuse", "overused", "overuse syndrome", "ใช้งานหนักเกิน", "ใช้งานมากเกินไป"); add("Lower cross syndrome", "lower cross", "lower crossed syndrome", "lcs"); add("Restless legs syndrome", "restless leg", "restless legs", "rls", "ขาอยู่ไม่สุข");
  add("Hip necrosis (AVN)", "hip necrosis", "avn", "avascular necrosis", "osteonecrosis", "หัวกระดูกสะโพกตาย", "หัวสะโพกตาย"); add("HNP (herniated nucleus pulposus)", "hnp", "herniated nucleus pulposus", "herniated nucleus");
  add("Neck muscle strain", "neck strain", "neck muscle strain", "strained neck", "กล้ามเนื้อคออักเสบ"); add("Neck muscle spasm", "neck spasm", "neck muscle spasm", "คอเกร็ง", "กล้ามเนื้อคอเกร็ง"); add("MPS with muscle tightness", "mps with muscle tightness", "mps with tightness");
  add("Pain less but need to continue treatment", "pain less but need to continue", "pain is less but", "ปวดน้อยลงแต่ต้องรักษาต่อ"); add("Patient feels better after the last treatment", "feels better", "feel better", "better after last treatment", "better since last", "ดีขึ้นหลังรักษา");
  add("Same symptoms as last visit", "same symptoms", "same as last visit", "same as last time", "no change since last", "อาการเท่าเดิม", "อาการเหมือนเดิม"); add("มารักษาต่อเนื่อง", "มาต่อเนื่อง", "continue treatment", "for continued treatment"); add("ปวดตึงคอบ่าลดลง", "คอบ่าลดลง"); add("อาการดีขึ้นจากครั้งก่อน", "ดีขึ้นจากครั้งก่อน");

  // ---- plain-language key (lay.js): body talk -> muscle, explanation -> diagnosis ----
  const LAY = window.LAY || { BODY: [], MOVE: [], TESTS: [], MMT: [], DX: [], POSITIVE: /x^/, NEGATIVE: /x^/ };
  const LAY_GATE = {};   // matched phrase -> regions it belongs to (null = anywhere)
  // every phrase with "your X" / "the X" also matches "your right X" / "the left X"
  const sided = (ph) => { const m = /\b(your|the|my|both) (?=[a-z])/.exec(ph); if (!m || /\b(right|left)\b/.test(ph)) return [ph]; const ins = (w) => ph.slice(0, m.index) + m[1] + " " + w + " " + ph.slice(m.index + m[0].length); return [ph, ins("right"), ins("left")]; };
  const sidedAll = (phrases) => [...new Set(phrases.flatMap((p) => sided(norm(p))).flatMap((p) => [p, numberWords(p)]))];
  LAY.BODY.forEach(([phrases, muscle, regions]) => sidedAll(phrases).forEach((ph) => { add(muscle, ph); LAY_GATE[ph] = regions; }));
  LAY.DX.forEach(([phrases, dx, regions]) => sidedAll(phrases).forEach((ph) => { add(dx, ph); LAY_GATE[ph] = regions; }));
  const LAY_MOVE = {}; LAY.MOVE.forEach(([phrases, movement]) => { (LAY_MOVE[movement] = LAY_MOVE[movement] || []).push(...sidedAll(phrases)); });
  const LAY_MOVE_SET = new Set(LAY.MOVE.flatMap(([phrases]) => sidedAll(phrases)));
  const gated = (low, h, R) => { const g = LAY_GATE[low.substr(h.i, h.len)]; return !(g && !g.includes(R)); };

  // ---------- line builders ----------
  const romLine = (m) => `${m}; Rt. ${BLANK}°/${BLANK}°/${BLANK}° Lt. ${BLANK}°/${BLANK}°/${BLANK}°`;
  const palpLine = (f, m, s) => `${f} at ${s ? s + " " : ""}${m} m.`;
  const exLine = (e, d) => `${e} — ${d || BLANK}`;

  // ---------- main ----------
  const HISTORY = /\b(previous\w*|history|years? ago|months? ago|weeks? ago|before|used to|old|childhood)\b|เคย|มาก่อน|ปีก่อน|ปีที่แล้ว|เดือนก่อน/;

  function run(text, region) {
    text = String(text || "")
      .replace(/^[ \t]*\[\d{1,2}:\d{2}(?::\d{2})?\][ \t]*/gm, "")        // "[03:22] " at the start of a line
      .replace(/^Transcript:[^\n]*$/m, "")                                 // the transcriber's header line
      .replace(/[๐-๙]/g, (d) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(d)));           // Thai numerals
    const low = numberWords(norm(text));
    const labelled = hasSpeakers(low);
    const sentEnd = (i) => { const cands = [". ", "? ", "! ", "\n"].map((p) => low.indexOf(p, i)).filter((x) => x >= 0); return cands.length ? Math.min(...cands) : low.length; };
    const sentStart = (i) => { const cands = [". ", "? ", "! ", "\n"].map((p) => low.lastIndexOf(p, i)).filter((x) => x >= 0); return cands.length ? Math.max(...cands) + 1 : 0; };
    const sentenceOf = (i) => { const cands = [". ", "? ", "! ", "\n"]; const st = Math.max(...cands.map((p) => low.lastIndexOf(p, i)).filter((x) => x >= 0), -1) + 1; const en = Math.min(...cands.map((p) => low.indexOf(p, i)).filter((x) => x >= 0), low.length); return low.slice(st, Math.min(low.length, en + 1)); };
    const nextLineStarts = (i, n) => { const o = []; let e = low.indexOf("\n", i); while (e >= 0 && o.length < (n || 3)) { const e2 = low.indexOf("\n", e + 1); const line = low.slice(e + 1, e2 < 0 ? low.length : e2); if (line.trim()) o.push([e + 1, line]); e = e2 < 0 ? -1 : e2; } return o; };
    const OTHER = /^\s*(?:[^:\n]{0,24}:)?\s*(?:and |now |okay,? |good,? |ok,? )*(?:the |on the |your |do the )?(left|right|other side|other leg|other one|other arm|other knee|other foot|other shoulder)\b[^\n]{0,12}$/;
    const out = { lines: [], region: null, heard: new Set(), tt: "", vas: "", side: "" };
    if (!low.trim()) return out;
    // family: the same test / movement / exercise / finding must not appear twice; the more specific line wins
    const famOf = (heading, line, sec) => {
      const noSide = (t) => t.replace(/\b(Rt\.|Lt\.|Both)\s*/g, "").replace(/\s+/g, " ").trim();
      if (heading === "Special test") return "T:" + line.replace(/\s*(Rt\.|Lt\.|Both)?\s*:\s*(\+ve|-ve|___ve)$/, "").replace(/\s*(Rt\.|Lt\.|Both)$/, "").toLowerCase();
      if (/range of motions$/.test(heading)) return "R:" + heading + ":" + noSide(line.replace(/[:;].*$/, "")).toLowerCase();
      if (heading === "Exercise") return "X:" + line.replace(/ — .*$/, "").replace(/ with band$/, "").toLowerCase();
      if (heading === "Functional test") return "F:" + noSide(line.replace(/ with pain| — poor control/g, "")).toLowerCase();
      if (heading === "Muscle power") { const m = line.match(/^(?:weakness at (?:rt\. |lt\. |both )?(.+?)(?:,.*)?|(.+?) weakness.*|(?:rt\. |lt\. |both )?(.+?) grade [0-5].*)$/i); if (m) return "W:" + (m[1] || m[2] || m[3]).toLowerCase(); }
      if (heading === "Palpation") return "P:" + noSide(line).toLowerCase();
      if (sec === "subjective" && /^(pain at|dull|sharp|radiating|throbbing|stiffness|numbness|shooting|tingling|burning|aching|clicking|locking|giving way)/i.test(line)) return "S:" + noSide(line).toLowerCase();
      return null;
    };
    const specificity = (line) => (/___ve$/.test(line) ? 0 : 1) + (/(Rt\.|Lt\.|Both)/.test(line) ? 1 : 0) + (/___/.test(line) ? 0 : 1) + (/ — (?!___)/.test(line) ? 1 : 0) + (/with pain|by pain|by tightness|full ROM|limited|at end range|painful arc|\d+°/.test(line) ? 1 : 0) + (/, Grade/.test(line) ? 1 : 0);
    const push = (sec, heading, line) => {
      if (out.lines.some((l) => l.sec === sec && l.heading === heading && l.line === line)) return;
      const fam = famOf(heading, line, sec);
      if (fam) {
        const sideOf = (t) => (t.match(/(Rt\.|Lt\.|Both)/) || [""])[0];
        const idx = out.lines.findIndex((l) => l.sec === sec && famOf(l.heading, l.line, l.sec) === fam && !((heading === "Palpation" || heading === "Special test" || heading === "Muscle power" || sec === "subjective" || /range of motions$/.test(heading)) && sideOf(l.line) && sideOf(line) && sideOf(l.line) !== sideOf(line) && sideOf(l.line) !== "Both" && sideOf(line) !== "Both"));
        if (idx >= 0) { if (specificity(line) > specificity(out.lines[idx].line)) out.lines[idx] = { sec, heading, line }; return; }
      }
      out.lines.push({ sec, heading, line });
    };
    const heard = (hits) => hits.forEach((h) => out.heard.add(h.term));

    // which side the conversation is about: "right knee" said again and again
    // (decided below, once the body parts are known)
    // the patient's answer to an instruction: the next spoken line(s)
    const replyAfter = (i) => {
      let e = low.indexOf("\n", i); if (e < 0) return "";
      let txt = ""; for (let k = 0; k < 3 && e >= 0 && e < low.length; k++) {
        const e2 = low.indexOf("\n", e + 1); const line = low.slice(e + 1, e2 < 0 ? low.length : e2);
        if (line.trim()) { txt += " " + line; if (!labelled || isPatientLine(line)) break; }
        e = e2;
      }
      return txt.slice(0, 160);
    };
    const nextLines = (i, n) => { const out = []; let e = low.indexOf("\n", i); while (e >= 0 && out.length < (n || 3)) { const e2 = low.indexOf("\n", e + 1); const line = low.slice(e + 1, e2 < 0 ? low.length : e2); if (line.trim()) out.push(line); e = e2 < 0 ? -1 : e2; } return out; };
    const replyResult = (i, name) => {
      const r = replyAfter(i).replace(/^\s*(patient|pt|ผู้ป่วย|คนไข้)[^:\n]{0,20}:/i, "");
      const cues = LAY.TEST_CUES && LAY.TEST_CUES[name];
      if (cues) { const around = low.slice(i, i + 220) + " " + nextLines(i, 3).join(" "); if (cues[0].test(around)) return "+ve"; if (cues[1].test(around)) return "-ve"; }
      if (!r.trim()) return "";
      const pn = r.search(LAY.POSITIVE), ng = r.search(LAY.NEGATIVE); if (pn < 0 && ng < 0) return ""; if (ng < 0 || (pn >= 0 && pn < ng)) return "+ve"; return "-ve";
    };

    // body parts and region
    const body = pick(scan(BODY_ENTRIES, low)).filter((h) => !/behind\s*$/.test(low.slice(Math.max(0, h.i - 8), h.i)) && !/\bby\s*$/.test(low.slice(Math.max(0, h.i - 4), h.i)) && !/^headache/.test(low.slice(h.i, h.i + 8)));
    // which side the conversation is about: the patient's own "my right knee" counts most; the physio's
    // comparisons ("compare with the left", "left is fine", "other side") and old injuries count for nothing
    {
      const CMP = /\b(compare|compared|comparison|other side|other leg|other arm|other knee|the other|than the|is fine|is nothing|is easier|is much easier|goes (?:a bit )?further|goes much higher|lies flat|one lies|leading with|for comparison|side lying|lie on your|onto your|roll onto|hug your|hold your)\b|เทียบ|อีกข้าง|ข้างอื่น/;
      let r = 0, l = 0, m, bothSaid = false; const re = /\b(right|left|rt|lt)\b|ขวา|ซ้าย/g;
      const BOTH_RE = /\b(both (?:knees|shoulders|sides|legs|arms|hips|ankles|feet|hands|elbows|wrists)|bilateral)\b|ทั้งสองข้าง|สองข้าง|ทั้ง 2 ข้าง/g;
      while ((m = BOTH_RE.exec(low))) { const ln = speakerLine(low, m.index); if (!labelled || isPatientLine(ln)) bothSaid = true; }
      while ((m = re.exec(low))) {
        if (/^(right|rt)$/.test(m[0]) && /^\s+(at|there|here|now|away|after|before|in front|behind|through|down|up|onto|next|beside|then|angle)\b/.test(low.slice(m.index + m[0].length, m.index + m[0].length + 12))) continue;
        const ln = speakerLine(low, m.index);
        if (HISTORY.test(ln) && (!labelled || isPatientLine(ln))) continue;
        if (CMP.test(ctx(low, m.index, m[0].length, 30))) continue;
        const isR = /^(right|rt|ขวา)$/.test(m[0]);
        let w = labelled && isPatientLine(ln) ? 3 : 1;
        if (body.some((b) => b.i > m.index && b.i - m.index <= 14) || /^(?:ด้าน)?(?:ขวา|ซ้าย)/.test(low.slice(m.index)) && body.some((b) => b.i < m.index && m.index - (b.i + b.len) <= 6)) w += 1;
        if (isR) r += w; else l += w;
      }
      // a recording has no speaker labels, so "my right knee" said twice with no "left" anywhere is enough
      out.side = (r >= 3 && r >= 1.5 * l) || (r >= 2 && l === 0) ? "Rt." : (l >= 3 && l >= 1.5 * r) || (l >= 2 && r === 0) ? "Lt." : (bothSaid && r >= 2 && l >= 2) ? "Both" : "";
    }
    const SPINE = new Set(["Neck / cervical", "Thoracic spine", "Trunk / lumbar"]);
    const sideOfHit = (h, beforeLen, afterLen) => side(low.substr(h.i, h.len)) || sideNear(low, h.i, h.len, beforeLen === undefined ? 8 : beforeLen, false, afterLen);
    const fallbackSide = (term) => (out.side === "Both" ? "" : out.side);
    const partNear = (i, w) => { let best = null; body.forEach((b) => { const d = Math.abs(b.i - i); if (d <= (w || 40) && sameLine(low, b.i, i) && (!best || d < best.d)) best = { d, part: b.term }; }); return best ? best.part : ""; };
    const patientSaid = (i) => labelled && isPatientLine(speakerLine(low, i));
    // Thai speech comes out of the recorder as one long line: "…ไหมคะ" then the finding. For a question
    // check, look only at the clause around the hit (between polite particles), not the whole line.
    const TH_END = /ค่ะ|คะ|ครับ|นะคะ|นะ|เนอะ|โอเค|ใช่ไหม|ไหม/g;
    const qLine = (i) => {
      const ln = speakerLine(low, i);
      if (ln.length <= 160 || !/[ก-๙]/.test(ln)) return ln;
      const st = low.lastIndexOf("\n", i) + 1;
      let a = st, m; TH_END.lastIndex = 0;
      const before = low.slice(st, i); while ((m = TH_END.exec(before))) a = st + m.index + m[0].length;
      const rest = low.slice(i); TH_END.lastIndex = 0; const m2 = TH_END.exec(rest);
      const b = m2 ? i + m2.index + m2[0].length : Math.min(low.length, i + 160);
      return low.slice(a, b);
    };
    const counts = {}; body.forEach((b) => { const r = REGION_OF[b.term]; counts[r] = (counts[r] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top) out.region = top[0];
    // the first body part the patient complains of ("lower back pain, mostly on the left") outranks how often
    // the foot or the leg get mentioned later during the examination
    {
      const firstComplaint = body.find((b) => { const ln = speakerLine(low, b.i); return (!labelled || isPatientLine(ln)) && !HISTORY.test(ln) && !isQuestion(ln) && /\b(pain|ache|aching|sore|hurts?|problem|stiff|numb)\b|ปวด|เจ็บ|ตึง|ชา/.test(ln); });
      if (firstComplaint && REGION_OF[firstComplaint.term] && (counts[REGION_OF[firstComplaint.term]] || 0) >= 2) out.region = REGION_OF[firstComplaint.term];
    }
    const R = (region && region !== V.REGIONS[0]) ? region : (out.region || V.REGIONS[0]);

    // Subjective: set phrases first, then pain description, plain pain at a part, aggravating, easing
    const phraseHitsAll = pick(scan(entries(V.SUBJECTIVE_PHRASES || []), low)).filter((h) => !/better|relief|improv/i.test(h.term) || /\b(treatment|session|last (?:time|visit)|since|after)\b|หลังจาก|หลังรักษา|ครั้งก่อน|ครั้งที่แล้ว|จากครั้ง/.test(sentenceOf(h.i)));
    const phraseHits = phraseHitsAll.filter((h) => !hasSpeakers(low) || isPatientLine(speakerLine(low, h.i)) || speakerLine(low, h.i).length > 220);
    phraseHits.forEach((h) => { out.heard.add(h.term); push("subjective", "", h.term); });
    const modEarly = pick(scan(entries(MODALITIES), low));
    const prevNonEmptyLine = (i) => { let e = low.lastIndexOf("\n", i) - 1; while (e >= 0) { const st = low.lastIndexOf("\n", e) + 1; const ln = low.slice(st, e + 1); if (ln.trim()) return ln; e = st - 2; } return ""; };
    const EXAM_INSTR = /\b(don'?t let me|do not let me|hold it|against my hand|i'?ll (?:lift|move|bend|press|push|pull|squeeze|turn|tilt|rotate|stretch)|i'?m going to|let me (?:move|bend|check|press|feel)|tell me if|tell me where|does it hurt|is that sore|for me[.,]|now (?:lift|bend|turn|tilt|push|pull|straighten|slide|lean|look|squeeze))\b|กด|ตรงนี้|อย่าให้|เจ็บไหม/;
    const examReply = (i) => { const ln = speakerLine(low, i); if (!labelled || !isPatientLine(ln)) return false; const pv = prevNonEmptyLine(i); return !isPatientLine(pv) && (EXAM_INSTR.test(pv) || LAY.MMT_CONTEXT.test(pv) || LAY.TESTS.some(([ph]) => ph.some((p) => pv.includes(norm(p)))) || LAY.MOVE.some(([ph]) => ph.some((p) => pv.includes(norm(p)))) || LAY.FUNC.some(([ph]) => ph.some((p) => pv.includes(norm(p))))); };
    const complaintOk = (i) => (!labelled || patientSaid(i) || speakerLine(low, i).length > 220) && !examReply(i);
    const painHits = pick(scan(entries(V.PAIN_TYPE), low)).filter((h) => !overlaps(h, phraseHits) && !negated(low, h.i) && !isQuestion(qLine(h.i)) && !inExamPart(low, h.i) && complaintOk(h.i) && !HISTORY.test(sentenceOf(h.i)) && !(h.term === "Numbness" && /^ชา(ร์|ว|ย|ม)/.test(low.slice(h.i, h.i + 4)))); heard(painHits);
    const partsUsed = new Set();
    { const hm = /\bheadaches?\b|ปวดหัว|ปวดศีรษะ|ไมเกรน/g; let m; while ((m = hm.exec(low))) { if (!isQuestion(speakerLine(low, m.index)) && complaintOk(m.index) && !negated(low, m.index) && !HISTORY.test(speakerLine(low, m.index))) { push("subjective", "", "Headache"); break; } } }
    painHits.forEach((h) => {
      const c = clause(low, h.i, h.len);
      if (h.term === "Stiffness" && EXAM.test(c) && !PAIN.test(c)) return;
      const p = partNear(h.i), s = sideNear(low, h.i, h.len);
      if (p) partsUsed.add(p);
      push("subjective", "", (ADJ.has(h.term) ? h.term + " pain" : h.term) + (p ? " at " + withSide(s, p) : ""));
    });
    body.forEach((h) => {
      const c = ctx(low, h.i, h.len, 25);
      if (!PAIN.test(c) || partsUsed.has(h.term) || overlaps(h, phraseHits) || inExamPart(low, h.i) || isQuestion(qLine(h.i)) || !complaintOk(h.i)) return;
      if (painHits.some((d) => Math.abs(d.i - h.i) < 50)) return;
      partsUsed.add(h.term);
      push("subjective", "", "Pain at " + withSide(sideNear(low, h.i, h.len), h.term));
    });
    // "What makes it worse?" / "What helps?" followed by the answer: the cue may sit in the previous line
    const prevLine = (i) => { const s = low.lastIndexOf("\n", i); if (s <= 0) return ""; const e = s; const s2 = low.lastIndexOf("\n", e - 1) + 1; return low.slice(s2, e); };
    const cueNear = (re, h) => {
      const line = speakerLine(low, h.i); if (isQuestion(line) || inExamPart(low, h.i) || !complaintOk(h.i)) return false;
      if (/\b(not|no|never)\b[^.,;\n]{0,20}$|ไม่[^\s]{0,10}$/.test(low.slice(Math.max(0, h.i - 26), h.i))) return false;
      if (re.test(clause(low, h.i, h.len))) return true;
      const q = prevLine(h.i); return isQuestion(q) && re.test(q);
    };
    const modToday = modEarly.filter((h) => !patientSaid(h.i));
    const justAfter = (h, n) => low.slice(h.i + h.len, h.i + h.len + (n || 14));
    const aggHits = pick(scan(Object.entries(AGG_AL), low)).filter((h) => !overlaps(h, modToday) && !overlaps(h, phraseHits) && cueNear(WORSE, h) && !BETTER.test(justAfter(h)));
    aggHits.forEach((h) => { push("subjective", "", h.term); out.heard.add(h.term); });
    pick(scan(Object.entries(EASE_AL), low)).filter((h) => !overlaps(h, modToday) && !overlaps(h, phraseHits) && cueNear(BETTER, h) && !/มากขึ้น|แย่ลง|\bworse\b/.test(justAfter(h))).forEach((h) => { push("subjective", "", h.term); out.heard.add(h.term); });

    // Past history — "no underlying disease, no accident, no surgery" (or one actually named).
    // "No underlying disease" is a normal, complete past history — it must land in the Past
    // history box on its own, not get silently dropped because nothing else was said.
    {
      const PH_ITEMS = [
        ["underlying disease", /\bunderlying disease(?:s)?\b|\bknown disease\b|\bchronic (?:illness|disease|condition)\b|โรคประจำตัว/gi],
        ["accident", /\baccidents?\b|\btrauma\b|อุบัติเหตุ/gi],
        ["surgery", /\bsurger(?:y|ies)\b|\boperations?\b|ผ่าตัด/gi],
        ["regular medication", /\bregular medications?\b|\bmedications? (?:he|she|they|patient) (?:takes?|is on)\b|ยาที่กินประจำ|ยาประจำ/gi],
      ];
      const phSeen = new Set(); const neg = []; const pos = [];
      PH_ITEMS.forEach(([label, re]) => {
        let m; re.lastIndex = 0;
        while ((m = re.exec(low))) {
          if (phSeen.has(label)) break;
          if (isQuestion(qLine(m.index)) || patientSaid(m.index)) { continue; }
          if (negated(low, m.index)) { neg.push(label); phSeen.add(label); break; }
          const tail = low.slice(m.index + m[0].length, m.index + m[0].length + 40).match(/^\s*(?:is|of|:|คือ)?\s*([a-zก-๙][^.,;\n]{2,38})/);
          pos.push(tail ? `${label[0].toUpperCase()}${label.slice(1)}: ${tail[1].trim()}` : `${label[0].toUpperCase()}${label.slice(1)} present`);
          phSeen.add(label); break;
        }
      });
      if (neg.length) push("subjective", "PastHistory", "No " + neg.join(", no "));
      pos.forEach((line) => push("subjective", "PastHistory", line));
    }

    // VAS — only a value written as n/10
    const vm = VAS.exec(low); if (vm) { const n = vm[1] || vm[2] || vm[3]; if (n && +n <= 10) { out.vas = n; push("objective", "", `VAS ${n}/10`); } }
    if (!out.vas && !labelled) {
      const q = /\b(?:zero to ten|0 to 10|out of ten|out of 10|scale of|nought to ten)\b|ศูนย์ถึงสิบ|0 ถึง 10/g; let qm;
      while ((qm = q.exec(low))) {
        const after = low.slice(qm.index + qm[0].length, qm.index + qm[0].length + 90);
        const m = /\b(\d{1,2})\b/.exec(after); if (!m || +m[1] > 10) continue;
        const worst = /worst|most of the pain|มากที่สุด/.test(low.slice(Math.max(0, qm.index - 40), qm.index + qm[0].length + 60));
        out.vas = m[1]; push("objective", "", worst ? `VAS worst ${m[1]}/10` : `VAS ${m[1]}/10`); break;
      }
    }
    if (!out.vas && labelled) {
      const q = /\b(?:zero to ten|0 to 10|out of ten|out of 10|pain scale|scale of|nought to ten|zero being no pain)\b|ศูนย์ถึงสิบ|0 ถึง 10|คะแนน/g; let qm;
      while ((qm = q.exec(low))) {
        const ln = speakerLine(low, qm.index); if (labelled && isPatientLine(ln)) continue;
        const r = replyAfter(qm.index).replace(/^\s*(patient|pt|ผู้ป่วย|คนไข้)[^:\n]{0,20}:/i, "");
        const nums = [...r.matchAll(/\b(\d{1,2})\b/g)].map((m) => +m[1]).filter((n) => n <= 10);
        if (!nums.length) continue;
        const worst = /worst|at its worst|when i|on the stairs|at the end of the day|with the headache/.test(r) && nums.length > 1 ? nums[nums.length - 1] : "";
        out.vas = String(nums[0]); push("objective", "", `VAS ${nums[0]}/10${worst !== "" ? ` (worst ${worst}/10)` : ""}`); break;
      }
    }

    // Observation
    const obsTerms = [...V.OBSERVATION, ...(V.OBSERVATION_BY_REGION[R] || [])];
    const IMPROVING = /^\s*(ลดลง|น้อยลง|ดีขึ้น|หาย|decreas\w*|reduc\w*|less|better|improv\w*|resolv\w*|gone)/i;
    const GOALISH = /(ลด|เพิ่ม|reduce|decrease|improve|increase|prevent)\s*$/;
    const obs = pick(scan(entries(obsTerms), low)).filter((h) => !negated(low, h.i) && !isQuestion(qLine(h.i)) && !IMPROVING.test(low.slice(h.i + h.len, h.i + h.len + 14)) && !GOALISH.test(low.slice(Math.max(0, h.i - 10), h.i)) && !patientSaid(h.i) && !/^\s*(plan|treatment(?!\s+times?)|gym|home)/i.test(speakerLine(low, h.i).slice(0, 18))); heard(obs);
    obs.forEach((h) => {
      const c = ctx(low, h.i, h.len, 40);
      if (h.term === "Redness" && !/\b(skin|red|redness|erythema)\b|แดง/.test(c)) return;
      const p = SITE_OBS.has(h.term) ? partNear(h.i) : "";
      push("objective", "Observation", h.term + (p ? " at " + withSide(side(c), p) : ""));
    });

    // Palpation: finding + nearest muscle (or body part)
    const muscles = pick(scan(entries(ALL_MUSCLES), low)).filter((h) => gated(low, h, R)); heard(muscles);
    const findingsAll = pick(scan(entries(V.PALPATION_FINDINGS), low));
    const findings = findingsAll.filter((h) => !negated(low, h.i));
    const STRUCTURES = new Set((V.MUSCLES["Ligaments & structures"] || []).map((x) => x.toLowerCase()));
    const palpLine2 = (f, m, s) => STRUCTURES.has(m.toLowerCase()) ? `${f} at ${s ? s + " " : ""}${m}` : palpLine(f, m, s);
    findings.forEach((h) => {
      const [cs, ce] = clauseSpan(low, h.i, h.len); const c = low.slice(cs, ce);
      // every muscle named in the same clause gets its own line; else the nearest within 50 chars
      const nextF = findingsAll.filter((f) => f.i > h.i).map((f) => f.i).sort((a, b) => a - b)[0];
      const stop = Math.min(ce, nextF === undefined ? ce : nextF, h.i + h.len + 120);
      const deniedAfter = (m) => findingsAll.some((f) => negated(low, f.i) && f.i > m.i + m.len && f.i - (m.i + m.len) <= 14) || /^\s*(no|not|ไม่)/.test(low.slice(m.i + m.len, m.i + m.len + 6));
      let ms = muscles.filter((m) => m.i > h.i && m.i < stop && sameLine(low, h.i, m.i) && !deniedAfter(m));
      if (!ms.length) { let best = null; muscles.forEach((m) => { const d = h.i - m.i; if (d > 0 && d <= 30 && sameLine(low, m.i, h.i) && (!best || d < best.d)) best = m; }); if (best) ms = [best]; }
      if (!ms.length && !EXAM.test(ctx(low, h.i, h.len, 50))) return;
      if (isQuestion(qLine(h.i))) return;
      if (h.term === "Warmth" && !ms.length) return;
      if (h.term === "Swelling" && !ms.length) return; // already an observation line
      out.heard.add(h.term);
      if (ms.length) ms.forEach((m) => push("objective", "Palpation", palpLine2(h.term, m.term, sideNear(low, m.i, m.len) || sideNear(low, h.i, h.len))));
      else if (!labelled) { const s = sideNear(low, h.i, h.len, 8, false), p = partNear(h.i, 22); if (p) push("objective", "Palpation", `${h.term} at ${withSide(s, p)}`); }
    });

    pick(scan(entries(V.PALPATION_NORMALS || []), low)).forEach((h) => {
      out.heard.add(h.term);
      const before = muscles.filter((m) => m.i + m.len <= h.i && h.i - (m.i + m.len) <= 4 && sameLine(low, m.i, h.i) && !/[,.;:]/.test(low.slice(m.i + m.len, h.i))).sort((a, b) => b.i - a.i)[0];
      push("objective", "Palpation", before ? `${h.term} at ${withSide(sideNear(low, before.i, before.len, 8, false), before.term)}` : h.term);
    });

    // Range of motion for the region in play
    let moves = V.ROM_BY_REGION[R] || V.ROM_GENERAL;
    {
      const extra = [];
      Object.entries(V.ROM_BY_REGION).forEach(([reg, list]) => {
        if (reg === R) return;
        const names = new Set(list.map((m) => m.replace(/ (Rt\.|Lt\.)$/, "")));
        let hits = 0;
        LAY.MOVE.forEach(([phrases, movement]) => { if (!names.has(movement)) return; if (sidedAll(phrases).some((p) => low.includes(p))) hits++; });
        if (hits >= 3) extra.push(...list);
      });
      if (extra.length) moves = [...new Set([...moves, ...extra])];
    }
    const bases = [...new Set(moves.map((m) => m.replace(/ (Rt\.|Lt\.)$/, "")))];
    const moveEntries = bases.map((b) => { const tok = norm(b).replace(MOVE_PREFIX, ""); return [b, [...new Set([norm(b), ...(MOVE[tok] || [tok]), ...(LAY_MOVE[b] || [])])]]; });
    const moveHits = pick(scan(moveEntries, low)); const movesSeen = new Set();
    // "flexion and extension full range of motion, no limited range of motion": the qualifier
    // sits after the LAST movement in a short and/,-joined list, not after each one — stopping
    // each movement's own context window at the very next movement hit left every movement but
    // the last with no qualifier text at all (blank template instead of the finding actually said).
    const moveStartsSorted = moveHits.map((m) => m.i).sort((a, b) => a - b);
    function groupBoundary(i, len) {
      let cursor = i + len;
      for (const mi of moveStartsSorted) {
        if (mi <= cursor) continue;
        const gap = low.slice(cursor, mi);
        if (gap.length <= 15 && /^[\s,\/]*(and|&)?[\s,\/]*$/i.test(gap)) {
          const mh = moveHits.find((m) => m.i === mi);
          cursor = mi + (mh ? mh.len : 0);
          continue;
        }
        return mi;
      }
      return low.length;
    }
    moveHits.forEach((h) => {
      const lineKey = h.term + "|" + sideNear(low, h.i, h.len, 10, false, 7) + "@" + low.lastIndexOf("\n", h.i); if (movesSeen.has(lineKey)) return; movesSeen.add(lineKey);
      const prefix = (h.term.split(" ")[0] || "").toLowerCase(); const preWord = (low.slice(Math.max(0, h.i - 16), h.i).match(/(hip|shoulder|knee|neck|cervical|trunk|lumbar|back|ankle|elbow|wrist|thoracic)\s*$/) || [])[1];
      if (preWord && prefix && preWord !== prefix && !(prefix === "trunk" && /lumbar|back/.test(preWord)) && !(prefix === "neck" && preWord === "cervical")) return;
      const wide = ctx(low, h.i, h.len, 60);
      const nextM = groupBoundary(h.i, h.len);
      const segEnd = Math.min(nextM === undefined ? low.length : nextM, h.i + h.len + 60, (low.indexOf("\n", h.i) < 0 ? low.length : low.indexOf("\n", h.i)));
      const seg = low.slice(h.i + h.len, segEnd);
      const layMove = LAY_MOVE_SET.has(low.substr(h.i, h.len));
      if (layMove && LAY.MMT_CONTEXT.test(speakerLine(low, h.i))) return;
      if (layMove && /\b(because|that's why|which is why|what we call|the reason|explain|that means|this means|the tendon that|the muscle that|the disc)\b/.test(sentenceOf(h.i))) return;
      if (layMove && EXCTX.test(speakerLine(low, h.i)) && !ROMCTX.test(seg)) return;
      const c = /limit|full|เต็ม|จำกัด|ไม่สุด|ได้ไม่|ปวด|pain|ติด|ตึง|tight|normal|wnl/.test(seg) ? seg : (layMove ? replyAfter(h.i) : "");
      if (layMove && isQuestion(qLine(h.i)) === false && patientSaid(h.i)) return;
      const lineStart = low.lastIndexOf("\n", h.i) + 1, beforeOnLine = low.slice(lineStart, h.i);
      if (/muscle power|mmt|strength|กำลัง|grade|weak/.test(beforeOnLine) && !ROMCTX.test(seg)) return;
      if (/^\s*(treatment(?!\s+times?)|gym|home|exercise|plan)/i.test(low.slice(lineStart, lineStart + 18))) return;
      if (EXCTX.test(c) && !ROMCTX.test(c)) return;
      if (!ROMCTX.test(wide) && h.len < 6) return;
      out.heard.add(h.term);
      const heading = PASSIVE.test(wide) ? "Passive range of motions" : "Active range of motions";
      let line;
      const noSideMove = SPINE.has(R) && /\b(flexion|extension)$/.test(h.term) && !/lateral/.test(h.term);
      let sd = noSideMove ? "" : (sideOfHit(h, 10, 7) || fallbackSide()); if (sd === "Both" && /\bboth\b/.test(low.substr(h.i, h.len))) sd = fallbackSide(); const nm = sd && !/ (Rt\.|Lt\.)$/.test(h.term) ? `${h.term} ${sd}` : h.term;
      const PAIN_ONLY = /\b(pain|painful|ache|hurts?|ouch|ow)\b|ปวด|เจ็บ/, TIGHT = /tight|ตึง|stiff|ฝืด/;
      if (layMove && labelled && !patientSaid(h.i)) {
        const sdL = sd; const nmL = nm;
        const reply = replyAfter(h.i);
        // "look up, look down, turn right, left, tilt to each side" — one reply for several movements:
        // "all fine" is full range for each; anything else belongs only to the last movement named
        const laterOnLine = moveHits.some((o) => o.i > h.i && o.term !== h.term && sameLine(low, o.i, h.i) && LAY_MOVE_SET.has(low.substr(o.i, o.len)));
        if (laterOnLine) { if (/\ball (?:fine|good|okay|ok|normal)\b|ปกติทั้งหมด|ได้หมด/.test(reply)) { push("objective", heading, `${nmL}: full ROM without pain`); } return; }
        const follow = nextLines(h.i, 3).filter((l) => !isPatientLine(l))[0] || "";
        const followHead = follow.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");   // before the next instruction
        const dm = /(?<!arc[^.]{0,30})\b(\d{2,3})\s*(?:degrees?|°|องศา)/.exec(followHead);
        const followHeadNoDeny = followHead.replace(/\b(no|not|without|isn'?t|wasn'?t)\s+(?:any\s+)?(limit(?:ed|ation)?s?|restrict(?:ed|ion)?s?)\b/gi, "").replace(/ไม่\s*(จำกัด|ติด)/g, "");
        const lim = /\b(limited|restricted)\b|จำกัด/.test(followHeadNoDeny) || /\b(half ?way|three quarters|a quarter|can't (?:turn|go|get) far|not far)\b|ได้ครึ่ง/.test(followHead) || /\b(can't (?:turn|go|get) (?:far|very far|any further|further)|not far|only (?:half|a little)|as far as i (?:get|go|can)|that's about as far|to (?:about )?my (?:knees|shins)|half ?way down|halfway)\b/.test(reply);
        const rPain = /\b(pain|painful|ache|hurts?|ouch|ow|catch|catches|pinch|pinches|sharp)\b|ปวด|เจ็บ/.test(reply.replace(/(\bno|\bwithout|\bnot)\s*(pain\w*)/g, "")), rTight = /tight|ตึง|stiff|ฝืด|pulls?\b/.test(reply);
        if (dm || lim) { push("objective", heading, `${nmL}: ${dm ? dm[1] + "°" : "limited"}${rPain ? " with pain" : rTight ? " with tightness" : ""}`); return; }
        // "full range of motion, no limited range of motion" said outright — this is a genuine,
        // complete finding on its own; it must not fall through and leave the box's own unfilled
        // default text (which reads "Limited ..." until a real chip/line replaces it) looking like
        // an actual finding.
        const full = /\b(full|all the way|no problem|fine|okay|ok|good|normal)\b|เต็มที่|ได้สุด|ปกติ|เต็มที|เต็ม/.test(reply) || /\b(full|normal)\b|เต็ม|ปกติ/.test(followHead);
        if (full) { push("objective", heading, `${nmL}: full ROM${rPain ? " with pain at end range" : rTight ? " with tightness at end range" : ""}`); return; }
      }
      if (layMove && c && !/limit|full|เต็ม|จำกัด|ไม่สุด|ได้ไม่|normal|wnl/.test(c)) {
        const sdL = sd; const nmL = nm;
        const cPL = c.replace(/(ไม่|\bno|\bwithout|\bnot)\s*(?:มี)?\s*(?:\w+\s+){0,2}(ปวด|เจ็บ|pain\w*|hurt\w*)/g, "");
        if (/\b(catch|catches|catching|pinch|pinches)\b/.test(cPL)) { push("objective", heading, /Shoulder (flexion|abduction)/.test(h.term) ? `${nmL}: painful arc` : `${nmL}: pain at end range`); return; }
        if (PAIN_ONLY.test(cPL)) { push("objective", heading, `${nmL}: pain at end range`); return; }
        if (TIGHT.test(c) || /\bpulls?\b/.test(c)) { push("objective", heading, `${nmL}: tightness at end range`); return; }
        if (LAY.NEGATIVE.test(c)) { push("objective", heading, `${nmL}: full ROM without pain`); return; }
      }
      const cP = c.replace(/(ไม่|\bno|\bwithout|\bnot)\s*(?:มี)?\s*(?:\w+\s+){0,2}(ปวด|เจ็บ|pain\w*|hurt\w*)/g, "");
      // "no limited range of motion" / "not limited" / "ไม่จำกัด": LIMITED matches the bare word
      // "limited" with no regard for a "no"/"not" right in front of it — that reads a denial of
      // limitation as the finding itself. Strip those denials before testing for LIMITED so a
      // negated "limited" falls through to the FULL check instead.
      const cNoDeny = c.replace(/\b(no|not|without|isn'?t|wasn'?t|aren'?t|denies?)\s+(?:any\s+)?(limit(?:ed|ation)?s?|restrict(?:ed|ion)?s?)\b/gi, "").replace(/ไม่\s*(จำกัด|ติด)/g, "");
      if (LIMITED.test(cNoDeny)) line = `${nm}: limited` + (TIGHT.test(c) && !PAIN_ONLY.test(cP) ? " by tightness" : PAIN_ONLY.test(cP) ? " by pain" : TIGHT.test(c) ? " by tightness" : "");
      else if (FULL.test(c) || LIMITED.test(c)) line = `${nm}: full ROM` + (NOPAIN.test(c) && !PAIN_ONLY.test(cP) ? " without pain" : PAIN_ONLY.test(cP) ? " with pain at end range" : TIGHT.test(c) ? " with tightness at end range" : "");
      else line = romLine(nm);
      push("objective", heading, line);
    });
    V.ROM_QUALIFIERS.forEach((q) => findAll(q, low).forEach(([i, len]) => {
      if (moveHits.some((m) => Math.abs(m.i - i) < 80)) return;
      out.heard.add(q); push("objective", "Active range of motions", q);
    }));
    pick(scan(entries(V.ACCESSORY_BY_REGION[R] || []), low)).filter((h) => !/^\s*(treatment|gym|home|plan)/i.test(speakerLine(low, h.i).slice(0, 12)) && !/mobili[sz]ation\s*$/.test(low.slice(Math.max(0, h.i - 20), h.i))).forEach((h) => { out.heard.add(h.term); push("objective", "Accessory movement", h.term + (LIMITED.test(ctx(low, h.i, h.len, 40)) ? ": hypomobile" : "")); });

    // Muscle power
    const grades = []; let gm; GRADE.lastIndex = 0;
    while ((gm = GRADE.exec(low))) grades.push({ i: gm.index, len: gm[0].length, g: gm[1] || gm[2], used: false });
    const strHits = pick(scan(entries(V.STRENGTH.filter((s) => !/^Grade/.test(s))), low)).filter((h) => !negated(low, h.i) && !isQuestion(qLine(h.i)) && !patientSaid(h.i));
    strHits.forEach((h) => {
      out.heard.add(h.term);
      let where = ""; muscles.forEach((m) => { if (Math.abs(m.i - h.i) <= 40 && sameLine(low, m.i, h.i)) where = where || m.term; });
      if (!where) { where = partNear(h.i, 30); if (where && h.term === "Weakness" && strHits.some((o) => o !== h && o.term !== "Weakness" && sameLine(low, o.i, h.i))) return; }
      // a grade belongs to the nearest strength phrase before it, if it is close
      const g = grades.find((x) => !x.used && x.i > h.i && x.i - (h.i + h.len) <= 45 && sameLine(low, h.i, x.i) && !strHits.some((o) => o.i > h.i && o.i < x.i));
      if (g) g.used = true;
      const B2M = { calf: "gastrocnemius", calves: "gastrocnemius", thigh: "quadriceps", shin: "tibialis anterior", buttock: "gluteus maximus", bottom: "gluteus maximus", "upper arm": "biceps", forearm: "wrist extensor group" };
      if (where && B2M[where]) where = B2M[where];
      push("objective", "Muscle power", h.term + (where && h.term === "Weakness" ? " at " + withSide(sideNear(low, h.i, h.len), where) : "") + (g ? `, Grade ${g.g}/5` : ""));
    });
    grades.filter((g) => !g.used).forEach((g) => {
      const c = clause(low, g.i, g.len);
      let where = ""; muscles.forEach((m) => { if (Math.abs(m.i - g.i) <= 45) where = where || m.term; });
      if (!where) where = partNear(g.i, 35);
      push("objective", "Muscle power", (where ? withSide(side(c), where) + " " : "") + `Grade ${g.g}/5`);
    });

    // Functional tests vs exercises
    const funcTerms = [...V.FUNCTIONAL, ...(V.FUNCTIONAL_BY_REGION[R] || [])];
    const testHitsEarly = pick(scan(entries(V.SPECIAL_TESTS), low));
    const fx = pick(scan([...entries(funcTerms), ...entries(ALL_EX)], low)).filter((h) => !overlaps(h, aggHits) && !overlaps(h, obs) && !overlaps(h, testHitsEarly) && !patientSaid(h.i));
    const exHits = [];
    const exPending = []; // {h, dose} — pushed after the shared-dose backfill pass below
    fx.forEach((h) => {
      const c = ctx(low, h.i, h.len, 60), cl = clause(low, h.i, h.len);
      const isEx = EXCTX.test(c) || DOSE1.test(sentenceOf(h.i)) || DOSE3.test(sentenceOf(h.i)) || /\b\d+\s*times\b/.test(sentenceOf(h.i)), isTest = TESTCTX.test(c) && !DOSE1.test(sentenceOf(h.i));
      const inF = FUNC_SET.has(h.term), inE = EX_SET.has(h.term);
      out.heard.add(h.term);
      if (/^\s*(onto|on the|on this|off|from)\b/.test(low.slice(h.i + h.len, h.i + h.len + 9)) || /\b(poor|weak|reduced|good|delayed)\s*$/.test(low.slice(Math.max(0, h.i - 10), h.i))) return;
      const examCue = /\b(don'?t let me|do not let me|tell me if|tell me where|does it hurt|any pain|painful\?|for me\b[^\n]{0,30}\?|compare|the other side|now the other|other leg)\b|บอกด้วย|เจ็บไหม|อย่าให้/.test(speakerLine(low, h.i));
      if (inE && examCue && !isEx && !inF) return;
      if (FUTURE.test(sentenceOf(h.i)) && !DOSE1.test(sentenceOf(h.i))) return;
      if (inE && /\b(i do|i did|i was doing|i've been doing|i tried|he gave me|she gave me|gave me some|used to do|i played|i play)\b|เคยทำ|เคยเล่น/.test(sentenceOf(h.i)) && !DOSE1.test(sentenceOf(h.i))) return;
      if (inE && (!inF || isEx) && !(inF && isTest && !isEx) && !(inF && /\b(show me|can you do|do a|for me)\b/.test(low.slice(Math.max(0, h.i - 30), h.i)))) {
        exHits.push(h);
        const nextX = fx.filter((o) => o.i > h.i).map((o) => o.i).sort((a, b) => a - b)[0];
        const after = low.slice(h.i + h.len, Math.min(nextX === undefined ? low.length : nextX, h.i + h.len + 130, (low.indexOf("\n", h.i) < 0 ? low.length : low.indexOf("\n", h.i))));
        const d = dose(after);
        exPending.push({ h, term: h.term, dose: d });
      }
      else if (inF && !overlaps(h, moveHits)) push("objective", "Functional test", h.term + (/\b(pain|painful)\b|ปวด|เจ็บ/.test(low.slice(h.i + h.len, h.i + h.len + 30)) ? " with pain" : ""));
    });
    // "single leg knee extension, wall sit, and fire hydrant — every exercise, 10 reps 3 sets":
    // the dose only lands right after the LAST exercise named, so earlier exercises in the same
    // sentence/list get nothing from their own "after" slice. Back-fill blank doses from the next
    // dose found later in the same sentence, once — this is the one dose the physio actually said
    // for the whole list, not a guess.
    exPending.forEach((p, idx) => {
      if (p.dose !== BLANK) return;
      const sent = sentenceOf(p.h.i);
      for (let j = idx + 1; j < exPending.length; j++) {
        if (sentenceOf(exPending[j].h.i) !== sent) break;
        if (exPending[j].dose !== BLANK) { p.dose = exPending[j].dose; break; }
      }
    });
    exPending.forEach((p) => push("exercise", "Exercise", exLine(p.term, p.dose)));

    // Special tests
    const testHits = pick(scan(entries(V.SPECIAL_TESTS), low));
    testHits.forEach((h) => {
      const c = ctx(low, h.i, h.len, 45); let name = h.term;
      if (/^Anterior drawer/.test(name)) name = (partNear(h.i, 60) === "ankle" || R === "Ankle & foot") ? "Anterior drawer (ankle)" : "Anterior drawer (knee)";
      if (/^(Full can|Empty can)/.test(name) && /raise|exercise/.test(c)) return;
      out.heard.add(name);
      const cl = clause(low, h.i, h.len);
      const nextT = testHits.filter((t) => t.i > h.i).map((t) => t.i).sort((a, b) => a - b)[0];
      const after = low.slice(h.i + h.len, Math.min(nextT === undefined ? low.length : nextT, h.i + h.len + 60, (low.indexOf("\n", h.i) < 0 ? low.length : low.indexOf("\n", h.i))));
      const first = (t) => { const p = t.search(POS), n = t.search(NEG); if (p < 0 && n < 0) return ""; if (n < 0 || (p >= 0 && p < n)) return "+ve"; return "-ve"; };
      const res = first(after) || first(cl) || (labelled && !patientSaid(h.i) ? replyResult(h.i, name) : "") || BLANK + "ve";
      const s = sideOfHit(h) || fallbackSide();
      push("objective", "Special test", `${name}${s ? " " + s : ""}: ${res}`);
      otherSideRepeat(h.i, name, s);
    });

    // Special tests described in plain words ("press your kneecap down and tighten your thigh")
    const doneTests = new Set(testHits.map((t) => t.term));
    function otherSideRepeat(i, name, s) {
      if (!labelled) return;
      for (const [st, ln] of nextLineStarts(i, 4)) {
        if (isPatientLine(ln)) continue;
        const m = OTHER.exec(ln); if (!m) return;
        const side2 = /^left/.test(m[1]) ? "Lt." : /^right/.test(m[1]) ? "Rt." : s === "Rt." ? "Lt." : s === "Lt." ? "Rt." : "";
        if (!side2 || side2 === s) return;
        const res2 = replyResult(st, name) || BLANK + "ve";
        push("objective", "Special test", `${name} ${side2}: ${res2}`);
        return;
      }
    }
    LAY.TESTS.forEach(([phrases, name, regions]) => {
      if (regions && !regions.includes(R)) return;
      if (doneTests.has(name)) return;
      const hit = pick(scan([[name, sidedAll(phrases)]], low)).find((h) => !patientSaid(h.i) && !FUTURE.test(sentenceOf(h.i)));
      if (!hit) return;
      doneTests.add(name); out.heard.add(name);
      const res = replyResult(hit.i, name) || BLANK + "ve";
      let s = sideOfHit(hit) || fallbackSide();
      if (name === "Thomas test" && /hug/.test(low.substr(hit.i, hit.len)) && /^(Rt\.|Lt\.)$/.test(s)) s = s === "Rt." ? "Lt." : "Rt.";
      if (s === "Both") s = fallbackSide();
      push("objective", "Special test", `${name}${s && s !== "Both" ? " " + s : ""}: ${res}`);
      otherSideRepeat(hit.i, name, s && s !== "Both" ? s : "");
    });

    // Functional tests said plainly ("do a squat for me", "stand on your right leg and do a small dip")
    const funcSeen = new Set();
    const funcHitsLay = pick(scan((LAY.FUNC || []).map(([phrases, name]) => [name, sidedAll(phrases)]), low)).filter((h) => !patientSaid(h.i) && !FUTURE.test(sentenceOf(h.i)) && !(EXCTX.test(speakerLine(low, h.i)) && !TESTCTX.test(speakerLine(low, h.i))));
    funcHitsLay.forEach((hit) => {
      if (funcHitsLay.some((o) => o.i > hit.i && o.term !== hit.term && sameLine(low, o.i, hit.i))) return;
      const name = hit.term; if (funcSeen.has(name)) return; funcSeen.add(name);
      out.heard.add(name);
      const r = replyAfter(hit.i);
      const pain = /\b(pain|hurts|ouch|ow|sore|pulls|catch|sharp)\b|ปวด|เจ็บ/.test(r), wobble = /\b(wobbly|shaky|shaking|unsteady|lose my balance|wobble)\b|โคลง|เซ/.test(r) || /\b(collapses|drifts in|knee drops in|hip drops|valgus)\b/.test(low.slice(hit.i, hit.i + 200));
      const s = sideOfHit(hit) || fallbackSide();
      push("objective", "Functional test", `${name}${s && s !== "Both" ? " " + s : ""}${pain ? " with pain" : ""}${wobble ? " — poor control" : ""}`);
    });

    // Palpation as a conversation: the physio names the place, the patient says what it feels like
    if (labelled) muscles.forEach((m) => {
      const line = speakerLine(low, m.i); if (isPatientLine(line)) return;
      const PALP_VERB = /\b(press|pressing|push on|touch|feel|here|this point|this spot|this area|tender|palpat\w*)\b|กด|ตรงนี้|คลำ/i;
      const inPalpRun = () => { const back = low.slice(Math.max(0, m.i - 900), m.i).split("\n").filter((l) => l.trim() && !isPatientLine(l)).slice(-4); return back.some((l) => /\b(press|pressing|palpat\w*|tell me where it'?s sore|tell me if anything is sore|tell me if it hurts|where it hurts)\b|กด|คลำ/i.test(l)); };
      const shortQ = line.replace(/^[^:\n]{0,24}:/, "").trim().length <= 90 && !LAY.MMT_CONTEXT.test(line) && !LAY.MOVE.some(([ph]) => ph.some((p) => line.includes(norm(p))));
      if (!PALP_VERB.test(line) && !(shortQ && inPalpRun())) return;
      if (EXCTX.test(line) && !/\b(press|pressing|palpat\w*|tender)\b|กด|คลำ/.test(line)) return;
      if (LAY.TESTS.some(([phrases]) => phrases.some((p) => line.includes(norm(p))))) return;
      if (LAY.MMT_CONTEXT.test(line)) return;
      let r = replyAfter(m.i).replace(/^\s*(patient|pt|ผู้ป่วย|คนไข้)[^:\n]{0,20}:/i, "");
      if (!r.trim()) return;
      const s = sideOfHit(m) || fallbackSide();
      const nm = withSide(s, m.term);
      const tight = /\b(tight|tightness|stiff)\b|ตึง/.test(r);
      r = r.replace(/\b(not|no|without|isn't|never|not really)\s+(?:\w+\s+){0,2}(painful|sore|tender|pain|hurt\w*)\b/g, "");
      const tender = (tight ? /\b(tender|sore|hurts|painful|pain)\b|เจ็บ|ปวด/ : /\b(tender|sore|hurts|ouch|ow|yes|painful|pain|that's it|that's the spot|there)\b|เจ็บ|ปวด|ใช่/).test(r);
      const no = LAY.NEGATIVE.test(r) && !tender && !tight;
      const STRUCT = new Set((V.MUSCLES["Ligaments & structures"] || []).map((x) => x.toLowerCase()));
      const suffix = STRUCT.has(m.term.toLowerCase()) ? "" : " m.";
      if (tight) push("objective", "Palpation", `Tightness at ${nm}${suffix}`);
      if (tender) push("objective", "Palpation", `Tenderness at ${nm}${suffix}`);
      const followUp = nextLines(m.i, 3).filter((l) => !isPatientLine(l))[0] || "";
      if ((tender || tight) && /\b(knot|knots|trigger point|taut band|hard band|tight band|hard lump)\b|จุดกด|ก้อน/.test(followUp + " " + line)) push("objective", "Palpation", `Trigger point at ${nm}${suffix}`);
      if (no) push("objective", "Palpation", `No tenderness at ${nm}`);
    });

    // Strength tests described in plain words ("hold your leg straight, don't let me push it down")
    const posBefore = (i) => {
      const back = low.slice(Math.max(0, i - 700), i); let best = ["", -1];
      [[/(roll|lie|lying|turn) (over )?onto your (front|stomach|tummy)|on your (front|stomach|tummy)|face down|prone|นอนคว่ำ/g, "prone"], [/lie (back )?(down )?on your back|onto your back|on your back|lie back|supine|นอนหงาย/g, "supine"], [/lie on your (left |right )?side|onto your (left |right )?side|side lying|นอนตะแคง/g, "side"], [/sit on the edge|sitting on the edge|sit up|in sitting|นั่ง/g, "sit"], [/stand(ing)? (up|normally|for me)|in standing|ยืน/g, "stand"]].forEach(([re, name]) => { let m; while ((m = re.exec(back))) if (m.index > best[1]) best = [name, m.index]; });
      return best[0];
    };
    LAY.MMT.forEach(([phrases, muscle0]) => {
      const hit = pick(scan([[muscle0, sidedAll(phrases)]], low)).find((h) => !patientSaid(h.i) && LAY.MMT_CONTEXT.test(speakerLine(low, h.i)));
      if (!hit) return;
      let muscle = muscle0; const pos = posBefore(hit.i);
      if (muscle0 === "quadriceps" && /leg straight|lift your leg|leg up/.test(low.substr(hit.i, hit.len)) && pos === "prone") muscle = "gluteus maximus";
      if (muscle0 === "quadriceps" && /leg straight|lift your leg|leg up/.test(low.substr(hit.i, hit.len)) && pos === "side") muscle = "gluteus medius";
      if (muscle0 === "gluteus maximus" && /on your front|on your stomach/.test(low.substr(hit.i, hit.len)) && !/leg|hip/.test(speakerLine(low, hit.i))) return;
      const after = (low.slice(hit.i + hit.len, hit.i + hit.len + 80) + " " + replyAfter(hit.i));
      const g = after.match(/([0-5](?:\+|-)?)\s*(?:\/|out of|over)\s*5|grade\s*([0-5](?:\+|-)?)/);
      const weak = /\b(weak|weaker|shaking|shaky|gives way|can't hold|cannot hold|hard|struggle|difficult)\b|อ่อนแรง|สั่น|สู้ไม่ได้|ยาก/.test(after);
      const strong = /\b(strong|good|fine|easy|no problem|equal|same as the other)\b|แข็งแรง|ดี|เท่ากัน/.test(after) && !weak;
      const s = sideOfHit(hit) || fallbackSide();
      const grade = g ? `Grade ${g[1] || g[2]}/5` : weak ? "weakness" : strong ? "Grade 5/5" : "";
      if (!grade) return;
      out.heard.add(muscle);
      push("objective", "Muscle power", grade === "weakness" ? `Weakness at ${withSide(s, muscle)}` : `${withSide(s, muscle)} ${grade}`);
    });

    // "this is the hip flexor testing — the right side is good and the left side is weak"
    {
      const re = /\b(hip flexor|hip abductor|hip extensor|quadriceps|quad|hamstring|gluteus medius|glute|calf|core|rotator cuff|deltoid|biceps|triceps|neck flexor|deep neck flexor)s?\b[^\n]{0,25}\b(?:testing|test|strength|power)\b[^\n]{0,70}?\b(right|left) side is (?:the )?(good|strong|fine|normal|okay|weak|weaker)\b(?:[\s\S]{0,40}?\b(left|right) side is (?:the )?(weak|weaker|good|strong|fine)\b)?/g; let m;
      const NAME = { "hip flexor": "iliopsoas", "hip abductor": "gluteus medius", "hip extensor": "gluteus maximus", quad: "quadriceps", glute: "gluteus maximus", calf: "gastrocnemius", core: "transversus abdominis", "neck flexor": "deep neck flexor" };
      while ((m = re.exec(low))) {
        const muscle = NAME[m[1]] || m[1];
        const sides = [[m[2], m[3]], [m[4], m[5]]].filter((x) => x[0]);
        sides.forEach(([sd, q]) => { const S2 = sd === "right" ? "Rt." : "Lt."; if (/weak/.test(q)) push("objective", "Muscle power", `Weakness at ${S2} ${muscle}`); else push("objective", "Muscle power", `${S2} ${muscle} Grade 5/5`); });
        out.heard.add(muscle);
      }
    }

    // Neurological
    pick(scan(entries(V.NEURO_PHRASES), low)).forEach((h) => { out.heard.add(h.term); push("objective", "Neurological examination", h.term); });
    if (NEUROCTX.test(low)) pick(scan(entries(V.MYOTOMES), low)).forEach((h) => { if (NEUROCTX.test(ctx(low, h.i, h.len, 40))) { out.heard.add(h.term); push("objective", "Myotome", h.term); } });

    // Diagnoses
    const dxSeen = new Set();
    pick(scan(entries(ALL_DX), low)).forEach((h) => {
      const c = ctx(low, h.i, h.len, 80);
      if (GENERIC_DX.has(h.term) && !DXCTX.test(c)) return;
      if (!gated(low, h, R)) return;
      if (patientSaid(h.i) || isQuestion(qLine(h.i))) return;
      if (HISTORY.test(clause(low, h.i, h.len)) && !/^\s*(analysis|diagnosis|impression|dx)/i.test(speakerLine(low, h.i))) return;
      if (dxSeen.has(h.term)) return; dxSeen.add(h.term);
      out.heard.add(h.term);
      const s = sideNear(low, h.i, h.len);
      push("analysis", "", s && s !== "Both" && !/^(Left|Right) /.test(h.term) ? `${s} ${h.term}` : h.term);
    });

    // Plan
    pick(scan(entries(V.PLAN_GOALS), low)).forEach((h) => { out.heard.add(h.term); push("plan", "", h.term); });

    // Treatment: modalities, position, session
    // numbers and areas for a modality come from the physio's line and the next physio line only, verbatim
    // the area a modality was applied to: the body talk after it up to the end of the sentence or the next
    // modality ("the ultrasound on the outside of the kneecap. Then massage on the thigh"), else just before it
    const areaIn = (a, b) => {
      const seg = low.slice(a, b); const found = [];
      (LAY.BODY || []).forEach(([phrases, muscle, regions]) => { if (regions && !regions.includes(R)) return; if (phrases.some((p) => seg.includes(norm(p)))) found.push(muscle); });
      muscles.filter((m) => m.i >= a && m.i < b).forEach((m) => found.push(m.term));
      if (!found.length) body.filter((x) => x.i >= a && x.i < b).forEach((x) => found.push(x.term));
      return found;
    };
    const areaFor = (h, all) => {
      const nextMod = all.filter((o) => o.i > h.i && o.term !== h.term && sameLine(low, o.i, h.i)).map((o) => o.i).sort((a, b) => a - b)[0];
      const prevMod = all.filter((o) => o.i < h.i && o.term !== h.term && sameLine(low, o.i, h.i)).map((o) => o.i + o.len).sort((a, b) => b - a)[0];
      let f = areaIn(h.i + h.len, Math.min(sentEnd(h.i + h.len), nextMod === undefined ? Infinity : nextMod));
      if (!f.length) f = areaIn(Math.max(sentStart(h.i), prevMod === undefined ? 0 : prevMod), h.i);
      return f;
    };
    const fillParams = (tpl, hits, all) => {
      if (!Array.isArray(hits)) hits = [hits];
      const segsOf = (h) => { const ln = speakerLine(low, h.i), st = low.lastIndexOf("\n", h.i) + 1; return [low.slice(h.i, st + ln.length), ln, nextLines(h.i, 3).filter((l) => !(labelled && isPatientLine(l))).slice(0, 1).join(" ")]; };
      const UNIT = /\d\s*(?:mhz|megahertz|w\/cm2|watts?|volts?|\bv\b|kg|kilo|hz|hertz|bar|joules?)/;
      const segs = [0, 1, 2].flatMap((k) => hits.map((h) => segsOf(h)[k])).sort((a, b) => (UNIT.test(b) ? 1 : 0) - (UNIT.test(a) ? 1 : 0));
      const num = (re) => { for (const seg of segs) { const m = re.exec(seg); if (m) return m[1]; } return ""; };
      const h = hits[0];
      if (/^(Home program|Gym): ___/.test(tpl)) { const names = [...new Set(exHits.filter((x) => hits.some((hh) => sameLine(low, x.i, hh.i))).map((x) => x.term))]; return names.length ? tpl.replace("___", names.join(", ")) : tpl; }
      const mhz = num(/(\d+(?:\.\d+)?)\s*(?:mhz|megahertz|เมกะเฮิรตซ์|เมกะเฮิร์ต)/), w = num(/(\d+(?:\.\d+)?)\s*(?:w\/cm2|w\/cm²|watts?(?: per (?:square )?centimet(?:re|er)s?(?: squared)?)?|วัตต์)/), mins = num(/(\d+)\s*(?:mins?|minutes?|นาที)\b/), v = num(/(\d+(?:\.\d+)?)\s*(?:volts?|v)\b/), kg = num(/(\d+)\s*(?:kg|kilos?|kilograms?|กิโล(?:กรัม)?)/), hz = num(/(\d+)\s*(?:hz|hertz)\b/);
      const s = sideNear(low, h.i, h.len, 12, false, 40) || (out.side !== "Both" ? out.side : "");
      const found = [...new Set(hits.flatMap((hh) => areaFor(hh, all || hits)))]; const bodyNames = new Set(body.map((b) => b.term));
      const musc = found.filter((x) => !bodyNames.has(x)); const area = (musc.length ? musc : found).slice(0, 3).map((x) => withSide(s, x)).join(", ");
      let o = tpl;
      if (mhz) o = o.replace("___ MHz", mhz + " MHz"); if (w) o = o.replace("___ w/cm2", w + " w/cm2");
      if (v) o = o.replace(/Stim ___ V|___ V\b/, (m) => m.replace("___", v)); if (hz) o = o.replace("___ Hz", hz + " Hz"); if (kg) o = o.replace("___ kg", kg + " kg");
      if (mins) o = o.replace(/___ mins?(?: per point)?\b|___ min\b/, (m) => m.replace("___", mins));
      if (area) { o = o.replace("Area: ___", "Area: " + area).replace(/\bon ___/, "on " + area).replace(/^(Massage|Stretching|Passive stretch|Stretching exercise): ___/, "$1: " + area); }
      return o;
    };
    const HIST_SENT = /\b(tried|i did|i had|they did|last time|before|used to|went for|went to|previous|ago|at the hospital|the doctor (?:did|gave)|she did|he did|they put)\b|เคย|ก่อนหน้านี้|ที่ผ่านมา|หมอให้/;
    const modHits = pick(scan(entries(MODALITIES), low)).filter((h) => !overlaps(h, exHits) && !patientSaid(h.i) && !isQuestion(sentenceOf(h.i)) && !HIST_SENT.test(sentenceOf(h.i)));
    const hasCombined = modHits.some((h) => h.term === "US combined with stim" || h.term === "US + IFC");
    const byTerm = {};
    modHits.forEach((h) => {
      if ((h.term === "Ultrasound (US)" || h.term === "Electrical stimulation") && hasCombined) { (byTerm["US combined with stim"] = byTerm["US combined with stim"] || []).push(h); return; }
      const c = ctx(low, h.i, h.len, 25);
      if ((h.term === "Stretching" || h.term === "Hot pack") && (BETTER.test(c) || WORSE.test(c)) && !/\b(did|gave|given|applied|apply|treated|treatment|tx)\b|ทำ|ให้|ใช้/.test(c)) return;
      if (h.term === "Home advice" && /\bno advice\b/.test(c)) return;
      if (h.term === "Stretching" && (/\b(feel|feels|felt|just|only|bit of|a little)\s+(a|the)?\s*$/.test(low.slice(Math.max(0, h.i - 14), h.i)) || /^\s+(in|behind|at|across|down|on|through)\b/.test(low.slice(h.i + h.len, h.i + h.len + 10)))) return;
      (byTerm[h.term] = byTerm[h.term] || []).push(h);
    });
    Object.keys(byTerm).forEach((term) => { if (!V.TREATMENT_MODALITIES[term]) return; byTerm[term].sort((a, b) => a.i - b.i); out.heard.add(term); push("treatment", "", fillParams(V.TREATMENT_MODALITIES[term], byTerm[term], modHits)); });
    if (!modHits.some((h) => /traction/.test(h.term))) {
      const th = scan([["t", TRACTION]], low).filter((h) => !patientSaid(h.i) && !isQuestion(sentenceOf(h.i)));
      if (th.length) { const t = R === "Neck / cervical" ? "Neck traction" : "Pelvic traction"; out.heard.add(t); push("treatment", "", fillParams(V.TREATMENT_MODALITIES[t], th.map((h) => ({ term: t, i: h.i, len: h.len })), modHits)); }
    }
    pick(scan(entries(V.POSITIONS), low)).forEach((h) => { out.heard.add(h.term); push("treatment", "", h.term); });
    pick(scan(entries(V.POST_TREATMENT || []), low)).filter((h) => /\b(after|post|treatment|session|now)\b|หลัง|ตอนนี้|หลังจาก/.test(sentenceOf(h.i)) && !HIST_SENT.test(sentenceOf(h.i))).forEach((h) => { out.heard.add(h.term); push("treatment", "", h.term); });
    let sm; SESSION.lastIndex = 0;
    while ((sm = SESSION.exec(low))) {
      const c = ctx(low, sm.index, sm[0].length, 30); if (!SESSIONCTX.test(c) || WORKCTX.test(sentenceOf(sm.index))) continue;
      const mins = sm[1] ? sm[1] : /1\.5|ครึ่ง/.test(sm[0]) ? "90" : "60";
      const t = mins === "45" ? "CPG 45 mins" : `Session ${mins} minutes`;
      if (V.SESSION_LENGTHS.includes(t)) { out.heard.add(t); push("treatment", "", t); }
    }

    // Problem list (new-patient form)
    {
      const L = out.lines;
      const has = (fn) => L.some(fn);
      // was matching bare "°" and "at end range" too, so a fully-normal "full ROM ... with pain at
      // end range" line (or any line that simply carries a degree number) wrongly added "Limited
      // ROM" to the problem list even when the physio explicitly found full range of motion.
      if (has((l) => /range of motions$/.test(l.heading) && /\blimited\b|\brestricted\b/.test(l.line))) push("problem", "", "Limited ROM");
      if (has((l) => l.heading === "Palpation" && /^(Tightness|Trigger point|Muscle spasm)/.test(l.line)) || has((l) => l.sec === "analysis" && /tightness|tight|myofascial|mps/i.test(l.line))) push("problem", "", "Muscle tightness");
      if (has((l) => l.heading === "Muscle power" && /weak|grade [0-4]/i.test(l.line))) push("problem", "", "Muscle weakness");
      if (has((l) => l.heading === "Observation" && /swelling|increased skin temperature|redness|bruising/i.test(l.line) && !/^no /i.test(l.line))) push("problem", "", "Inflammation");
    }
    pick(scan(entries(V.IMPAIRMENTS.filter((x) => x !== "Pain")), low)).forEach((h) => push("problem", "", h.term));
    if (painHits.length || body.some((h) => PAIN.test(ctx(low, h.i, h.len, 25)))) push("problem", "", "Pain");

    // Treatment times
    const tm = TT.exec(low); if (tm) out.tt = tm[1] || tm[2] || tm[3] || tm[4] || "";

    // tidy ROM: a blank, unsided template gives way to any sided or qualified line for the same movement
    out.lines = out.lines.filter((l) => {
      if (!/range of motions$/.test(l.heading) || !/; Rt\. ___/.test(l.line)) return true;
      const mv = l.line.replace(/;.*$/, "").toLowerCase();
      return !out.lines.some((o) => o !== l && /range of motions$/.test(o.heading) && o.line.toLowerCase().replace(/ (rt\.|lt\.|both)(?=[:;])/, "").startsWith(mv) && o.line !== l.line);
    });
    // tidy Muscle power: "Weakness at neck" is redundant next to "Neck flexor weakness"; bare "Weakness" next to anything
    const power = out.lines.filter((l) => l.heading === "Muscle power");
    if (power.length > 1) {
      out.lines = out.lines.filter((l) => {
        if (l.heading !== "Muscle power") return true;
        if (l.line === "Weakness") return false;
        const m = l.line.match(/^Weakness at (?:Rt\. |Lt\. |Both )?([a-z ]+?)(?:,.*)?$/i);
        if (m && BODY.some((b) => b[0] === m[1].toLowerCase())) return !power.some((o) => o !== l && o.line.toLowerCase().includes(m[1].toLowerCase()));
        return true;
      });
    }
    return out;
  }

  // For chip highlighting: which of these terms are mentioned?
  function hits(terms, text) {
    const low = norm(text); if (!low.trim()) return new Set();
    return new Set(uniqTerms(scan(entries(terms), low)));
  }

  // which regions a line belongs to, from its body words and muscle names (empty = no clue)
  const MUSCLE_REGION = {};
  Object.entries(V.REGION_PROFILE || {}).forEach(([reg, P]) => { (P.muscle_groups || []).forEach((g) => (V.MUSCLES[g] || []).forEach((m) => { (MUSCLE_REGION[m.toLowerCase()] = MUSCLE_REGION[m.toLowerCase()] || new Set()).add(reg); })); });
  function regionsOf(text) {
    const low = norm(String(text || "")); const out = new Set();
    pick(scan(BODY_ENTRIES, low)).forEach((b) => { if (REGION_OF[b.term]) out.add(REGION_OF[b.term]); });
    pick(scan(entries(ALL_MUSCLES), low)).forEach((m) => { const regs = MUSCLE_REGION[m.term.toLowerCase()]; if (regs) regs.forEach((r) => out.add(r)); });
    return out;
  }
  return { run, hits, aliasesOf, regionsOf };
})();
