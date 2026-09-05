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
  const add = (term, ...al) => { (ALIAS[term] = ALIAS[term] || []).push(...al); };
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
    const after = low.slice(i + len, i + len + (afterLen === undefined ? 16 : afterLen)), before = low.slice(Math.max(0, i - (beforeLen === undefined ? 16 : beforeLen)), i);
    return side(after) || side(before) || (fallback === false ? "" : side(clause(low, i, len)));
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
  add("Radiating", "radiating", "radiate", "radiates", "refer", "referred", "ร้าว", "ปวดร้าว", "ร้าวลง");
  add("Throbbing", "throbbing", "throb", "ตุบ", "ตุ๊บ"); add("Stiffness", "stiff", "stiffness", "ฝืด", "ขยับยาก", "ข้อแข็ง");
  add("Numbness", "numb", "numbness", "ชา"); add("Shooting", "shooting", "แล่น", "ปวดแล่น");
  add("Tingling", "tingling", "tingle", "pins and needles", "เหน็บ", "ซ่า", "ยิบ"); add("Burning", "burning", "burn", "แสบ", "แสบร้อน");
  add("Aching", "aching", "ache", "เมื่อย", "ปวดเมื่อย", "ระบม"); add("Clicking", "clicking", "click", "clicks", "เสียงคลิก", "เสียงดัง", "กึก");
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
    ["hand", "Elbow, wrist & hand", ["hand", "hands", "finger", "fingers", "thumb", "ฝ่ามือ", "นิ้วมือ", "นิ้วโป้ง", "ปวดมือ", "ที่มือ"]],
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
  const SIDE_R = /\b(right|rt)\b|ขวา/, SIDE_L = /\b(left|lt)\b|ซ้าย/, SIDE_B = /\b(both|bilateral|bilaterally)\b|ทั้งสองข้าง|สองข้าง|ทั้ง 2 ข้าง|2 ข้าง/;
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
  add("Scoliosis", "scoliosis", "กระดูกสันหลังคด", "หลังคด", "สันหลังคด"); add("No scoliosis", "no scoliosis", "ไม่มีหลังคด");
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
  add("Hop test", "hop test", "hop", "hopping", "hops", "กระโดดขาเดียว", "กระโดด"); add("Double balance", "double leg balance", "two leg balance", "ยืนสองขา");
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
  const POS = /\b(positive|\+ve|\+)\s*$|\b(positive|\+ve|pos)\b|บวก|พอสิทีฟ|โพสิทีฟ|โพซิทีฟ|เป็นบวก/, NEG = /\b(negative|-ve|neg)\b|ลบ|เนกาทีฟ|เนกกาทีฟ|เป็นลบ/;
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
  add("Scoliosis", "scoliosis");
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
  add("Return to sport", "return to sport", "back to sport", "return to play", "rts", "กลับไปเล่นกีฬา", "กลับไปวิ่ง"); add("Return to work", "return to work", "back to work", "rtw", "กลับไปทำงาน");
  add("Home programme progression", "home programme progression", "home program progression", "progress home program", "progress the home programme"); add("Patient education", "education", "educate", "educated", "explain", "explained", "ให้ความรู้", "อธิบาย");
  add("Education and empowerment", "empowerment", "self management", "self-management", "ดูแลตัวเอง"); add("Prevent recurrence", "prevent recurrence", "prevention", "avoid recurrence", "stop it coming back", "ป้องกันการกลับมาเป็นซ้ำ", "ป้องกันการเป็นซ้ำ", "ไม่ให้เป็นซ้ำ");

  // Treatment modalities (closed list) — aliases extend the existing ones
  add("Ultrasound (US)", "ultrasound", "u/s", "อัลตร้า", "อัลตรา"); add("US combined with stim", "us combine", "us combined", "combine", "combined with stim", "ultrasound combined with stim", "ultrasound combined", "ultrasound combine", "ultrasound with stim", "us with stim", "คอมบาย", "อัลตร้าซาวด์ร่วมกับกระตุ้นไฟฟ้า", "อัลตราซาวด์ร่วมกับกระตุ้นไฟฟ้า", "ร่วมกับกระตุ้นไฟฟ้า", "อัลตร้าซาวด์คอมบาย");
  add("US + IFC", "us + ifc", "us and ifc", "us with ifc", "ultrasound and ifc"); add("IFC (interferential current)", "ifc", "interferential", "ไอเอฟซี"); add("TENS", "tens", "เทนส์");
  add("Electrical stimulation", "electrical stimulation", "electrical stim", "e-stim", "estim", "nmes", "ems", "กระตุ้นไฟฟ้า", "ไฟฟ้ากระตุ้น"); add("High power LASER (HPLT)", "laser", "hplt", "high power laser", "เลเซอร์");
  add("Shockwave therapy", "shockwave", "shock wave", "eswt", "ช็อคเวฟ", "ช็อกเวฟ", "คลื่นกระแทก"); add("Peripheral magnetic stimulation (PMS)", "pms", "magnetic stimulation", "peripheral magnetic", "แม่เหล็ก", "คลื่นแม่เหล็ก");
  add("Neck traction", "neck traction", "cervical traction", "ดึงคอ"); add("Pelvic traction", "pelvic traction", "lumbar traction", "ดึงหลัง", "ดึงเอว");
  add("Hot pack", "hot pack", "hotpack", "hot packs", "heat pack", "ประคบร้อน", "แผ่นร้อน", "ฮอตแพค", "ฮอทแพค"); add("Cold pack", "cold pack", "ice pack", "cold packs", "cryotherapy", "ประคบเย็น", "แผ่นเย็น");
  add("Massage", "massage", "massaged", "deep friction", "soft tissue release", "soft tissue", "นวด", "กดจุด"); add("Stretching", "stretching", "stretch", "stretched", "ยืด", "ยืดกล้ามเนื้อ"); add("Passive stretch", "passive stretch", "passive stretching", "ยืดแบบพาสซีฟ");
  add("Joint mobilization", "joint mobilization", "joint mobilisation", "mobilization", "mobilisation", "mobs", "mobilized", "mobilised", "ขยับข้อ", "ดัดข้อ", "โมบิไลซ์", "โมบิไลเซชั่น"); add("Spinal mobilization", "spinal mobilization", "spinal mobilisation", "spinal mobs", "lumbar mobilization", "lumbar mobilisation", "cervical mobilization", "cervical mobilisation", "ขยับกระดูกสันหลัง");
  add("Cupping", "cupping", "ครอบแก้ว", "คัพปิ้ง"); add("Taping", "taping", "tape", "taped", "kinesio", "kinesiotape", "k-tape", "เทป", "เทปปิ้ง", "ติดเทป");
  add("Home advice", "home advice", "advice", "advise", "advised", "advice given", "แนะนำ", "ให้คำแนะนำ", "คำแนะนำ");
  const TRACTION = ["traction"];
  const MODALITIES = Object.keys(V.TREATMENT_MODALITIES);

  // Positions and session
  add("Supine lying", "supine", "supine lying", "lying on the back", "on their back", "นอนหงาย"); add("Prone lying", "prone", "prone lying", "lying on the front", "face down", "นอนคว่ำ");
  add("Side lying to Rt.", "side lying to rt", "side lying right", "side lying to right", "side lying to the right", "right side lying", "right side-lying", "sidelying right", "lying on the right", "นอนตะแคงขวา", "ตะแคงขวา"); add("Side lying to Lt.", "side lying to lt", "side lying left", "side lying to left", "side lying to the left", "left side lying", "left side-lying", "sidelying left", "lying on the left", "นอนตะแคงซ้าย", "ตะแคงซ้าย");
  add("Sitting", "in sitting", "sitting position", "seated", "position sitting"); add("Standing", "in standing", "standing position", "ท่ายืน"); add("Long sitting", "long sitting", "นั่งเหยียดขา");
  add("Half lying", "half lying", "semi-recumbent", "นอนกึ่งนั่ง"); add("Four point kneeling", "four point kneeling", "4 point kneeling", "quadruped", "all fours", "on all fours", "คลาน", "ท่าคลาน");
  const SESSION = /\b(60|90|45)\s*(?:min|mins|minutes|นาที)\b|\b(1|one)\s*(?:hour|hr|ชั่วโมง)\b|ชั่วโมงครึ่ง|\b1\.5\s*(?:hour|hours|hr|hrs|ชั่วโมง)\b/g;
  const SESSIONCTX = /session|cpg|treatment time|treated for|ชั่วโมง|hour|ทำ|รักษา/;
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
  add("Vertical jump with split leg on bosu", "split leg jump on bosu", "split jump on bosu"); add("Box jump", "box jump", "box jumps", "กระโดดกล่อง"); add("Drop jump", "drop jump", "drop jumps", "depth jump"); add("Broad jump", "broad jump", "broad jumps", "long jump", "กระโดดไกล");
  add("Lateral bound", "lateral bound", "lateral bounds", "skater", "skaters", "skater jumps"); add("Agility ladder", "agility ladder", "ladder drill", "ladder drills", "บันไดลิง"); add("Change of direction drill", "change of direction", "cod drill", "cutting drill", "cutting");
  add("Sprint progression", "sprint", "sprints", "sprinting", "วิ่งเร็ว"); add("Plyometric progression", "plyometric", "plyometrics", "plyo", "พลัยโอเมตริก"); add("Sport-specific drill", "sport specific", "sport-specific", "sports specific");
  add("Pilates reformer — footwork", "footwork", "reformer footwork"); add("Pilates reformer — leg circles", "leg circles"); add("Pilates mat — hundred", "the hundred", "pilates hundred"); add("Pilates mat — roll up", "roll up", "roll ups", "roll-up");
  add("Pilates — spine stretch", "spine stretch"); add("Pilates — swan", "swan"); add("Stationary bike", "stationary bike", "exercise bike", "spin bike", "จักรยานอยู่กับที่"); add("Treadmill", "treadmill", "ลู่วิ่ง"); add("Cross trainer", "cross trainer", "elliptical");
  add("Rowing machine", "rowing machine", "rower", "เครื่องพาย"); add("General mobility circuit", "mobility circuit", "mobility work", "mobility drills");
  const ALL_EX = Object.values(V.EXERCISES).flat();
  const FUNC_SET = new Set([...V.FUNCTIONAL, ...Object.values(V.FUNCTIONAL_BY_REGION).flat()]);
  const EX_SET = new Set(ALL_EX);
  const DOSE1 = /(\d+)\s*(?:x|×|\*|times|reps?|steps?|ครั้ง)[^\d\n]{0,16}?(\d+)\s*(?:sets?|เซ็ต|เซต|รอบ)/, DOSE2 = /(\d+)\s*(?:sec|secs|seconds|วินาที|วิ)\s*(?:hold)?[^\d\n]{0,10}?(?:x|×|\*|times)\s*(\d+)/, DOSE3 = /(\d+)\s*(?:reps?|repetitions?|ครั้ง)\b/;
  const DAILY = /\b(daily|every day|each day)\b|ทุกวัน/, TWICE = /\b(twice daily|twice a day|two times a day|2x\/day|bid)\b|วันละ 2 ครั้ง|วันละสองครั้ง/;
  function dose(c) {
    let m;
    if ((m = DOSE1.exec(c))) return `${m[1]} x ${m[2]} sets`;
    if ((m = DOSE2.exec(c))) return `${m[1]} sec hold x ${m[2]}`;
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

  add("PKB (prone knee bend)", "pkb", "prone knee bend", "femoral nerve stretch"); add("SIJ distraction", "sij distraction", "si distraction", "sacroiliac distraction"); add("SIJ compression", "sij compression", "si compression", "sacroiliac compression");
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

  // ---------- line builders ----------
  const romLine = (m) => `${m}; Rt. ${BLANK}°/${BLANK}°/${BLANK}° Lt. ${BLANK}°/${BLANK}°/${BLANK}°`;
  const palpLine = (f, m, s) => `${f} at ${s ? s + " " : ""}${m} m.`;
  const exLine = (e, d) => `${e} — ${d || BLANK}`;

  // ---------- main ----------
  const NUMWORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const numberWords = (t) => t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -](one|two|three|four|five|six|seven|eight|nine)\b/g, (m, a, b) => String(NUMWORDS[a] + NUMWORDS[b]))
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g, (m) => String(NUMWORDS[m]))
    .replace(/(\d)\s*point\s*(\d)/g, "$1.$2")
    .replace(/\b([0-5])\s+(minus|plus)\b/g, (m, d, w) => d + (w === "minus" ? "-" : "+"))
    .replace(/(สิบเอ็ด|สิบสอง|สิบสาม|สิบสี่|สิบห้า|สิบหก|สิบเจ็ด|สิบแปด|สิบเก้า|ยี่สิบ|สิบ|ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)(?![ก-๙])/g, (m) => ({ "สิบเอ็ด": 11, "สิบสอง": 12, "สิบสาม": 13, "สิบสี่": 14, "สิบห้า": 15, "สิบหก": 16, "สิบเจ็ด": 17, "สิบแปด": 18, "สิบเก้า": 19, "ยี่สิบ": 20, "สิบ": 10, "ศูนย์": 0, "หนึ่ง": 1, "สอง": 2, "สาม": 3, "สี่": 4, "ห้า": 5, "หก": 6, "เจ็ด": 7, "แปด": 8, "เก้า": 9 })[m])
    .replace(/(สิบเอ็ด|สิบสอง|สิบสาม|สิบสี่|สิบห้า|สิบหก|สิบเจ็ด|สิบแปด|สิบเก้า|ยี่สิบ|สิบ|ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)(?=\s*(\/|เต็ม|จาก|ครั้ง|เซ็ต|วินาที|นาที|องศา|ใน))/g, (m) => ({ "สิบเอ็ด": 11, "สิบสอง": 12, "สิบสาม": 13, "สิบสี่": 14, "สิบห้า": 15, "สิบหก": 16, "สิบเจ็ด": 17, "สิบแปด": 18, "สิบเก้า": 19, "ยี่สิบ": 20, "สิบ": 10, "ศูนย์": 0, "หนึ่ง": 1, "สอง": 2, "สาม": 3, "สี่": 4, "ห้า": 5, "หก": 6, "เจ็ด": 7, "แปด": 8, "เก้า": 9 })[m]);
  const HISTORY = /\b(previous\w*|history|years? ago|months? ago|weeks? ago|before|used to|old|childhood)\b|เคย|มาก่อน|ปีก่อน|ปีที่แล้ว|เดือนก่อน/;

  function run(text, region) {
    const low = numberWords(norm(text));
    const out = { lines: [], region: null, heard: new Set(), tt: "", vas: "" };
    if (!low.trim()) return out;
    // family: the same test / movement / exercise / finding must not appear twice; the more specific line wins
    const famOf = (heading, line, sec) => {
      const noSide = (t) => t.replace(/\b(Rt\.|Lt\.|Both)\s*/g, "").replace(/\s+/g, " ").trim();
      if (heading === "Special test") return "T:" + line.replace(/\s*(Rt\.|Lt\.|Both)?\s*:\s*(\+ve|-ve|___ve)$/, "").replace(/\s*(Rt\.|Lt\.|Both)$/, "").toLowerCase();
      if (/range of motions$/.test(heading)) return "R:" + heading + ":" + line.replace(/[:;].*$/, "").toLowerCase();
      if (heading === "Exercise") return "X:" + line.replace(/ — .*$/, "").replace(/ with band$/, "").toLowerCase();
      if (heading === "Functional test") return "F:" + line.replace(/ with pain$/, "").toLowerCase();
      if (heading === "Muscle power") { const m = line.match(/^(?:weakness at (?:rt\. |lt\. |both )?(.+?)(?:,.*)?|(.+?) weakness.*|(?:rt\. |lt\. |both )?(.+?) grade [0-5].*)$/i); if (m) return "W:" + (m[1] || m[2] || m[3]).toLowerCase(); }
      if (heading === "Palpation") return "P:" + noSide(line).toLowerCase();
      if (sec === "subjective" && /^(pain at|dull|sharp|radiating|throbbing|stiffness|numbness|shooting|tingling|burning|aching|clicking|locking|giving way)/i.test(line)) return "S:" + noSide(line).toLowerCase();
      return null;
    };
    const specificity = (line) => (/___ve$/.test(line) ? 0 : 1) + (/(Rt\.|Lt\.|Both)/.test(line) ? 1 : 0) + (/___/.test(line) ? 0 : 1) + (/ — (?!___)/.test(line) ? 1 : 0) + (/with pain|by pain|by tightness|full ROM|limited/.test(line) ? 1 : 0) + (/, Grade/.test(line) ? 1 : 0);
    const push = (sec, heading, line) => {
      if (out.lines.some((l) => l.sec === sec && l.heading === heading && l.line === line)) return;
      const fam = famOf(heading, line, sec);
      if (fam) {
        const sideOf = (t) => (t.match(/\b(Rt\.|Lt\.|Both)\b/) || [""])[0];
        const idx = out.lines.findIndex((l) => l.sec === sec && famOf(l.heading, l.line, l.sec) === fam && !((heading === "Palpation" || sec === "subjective") && sideOf(l.line) && sideOf(line) && sideOf(l.line) !== sideOf(line)));
        if (idx >= 0) { if (specificity(line) > specificity(out.lines[idx].line)) out.lines[idx] = { sec, heading, line }; return; }
      }
      out.lines.push({ sec, heading, line });
    };
    const heard = (hits) => hits.forEach((h) => out.heard.add(h.term));

    // body parts and region
    const body = pick(scan(BODY_ENTRIES, low)).filter((h) => !/behind\s*$/.test(low.slice(Math.max(0, h.i - 8), h.i)));
    const partNear = (i, w) => { let best = null; body.forEach((b) => { const d = Math.abs(b.i - i); if (d <= (w || 40) && sameLine(low, b.i, i) && (!best || d < best.d)) best = { d, part: b.term }; }); return best ? best.part : ""; };
    const labelled = hasSpeakers(low);
    const patientSaid = (i) => labelled && isPatientLine(speakerLine(low, i));
    const counts = {}; body.forEach((b) => { const r = REGION_OF[b.term]; counts[r] = (counts[r] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top) out.region = top[0];
    const R = (region && region !== V.REGIONS[0]) ? region : (out.region || V.REGIONS[0]);

    // Subjective: set phrases first, then pain description, plain pain at a part, aggravating, easing
    const phraseHitsAll = pick(scan(entries(V.SUBJECTIVE_PHRASES || []), low));
    const phraseHits = phraseHitsAll.filter((h) => !hasSpeakers(low) || isPatientLine(speakerLine(low, h.i)) || speakerLine(low, h.i).length > 220);
    phraseHits.forEach((h) => { out.heard.add(h.term); push("subjective", "", h.term); });
    const modEarly = pick(scan(entries(MODALITIES), low));
    const complaintOk = (i) => !labelled || patientSaid(i) || speakerLine(low, i).length > 220;
    const painHits = pick(scan(entries(V.PAIN_TYPE), low)).filter((h) => !overlaps(h, phraseHits) && !negated(low, h.i) && !isQuestion(speakerLine(low, h.i)) && !inExamPart(low, h.i) && complaintOk(h.i) && !(h.term === "Numbness" && /^ชา(ร์|ว|ย|ม)/.test(low.slice(h.i, h.i + 4)))); heard(painHits);
    const partsUsed = new Set();
    painHits.forEach((h) => {
      const c = clause(low, h.i, h.len);
      if (h.term === "Stiffness" && EXAM.test(c) && !PAIN.test(c)) return;
      const p = partNear(h.i), s = sideNear(low, h.i, h.len);
      if (p) partsUsed.add(p);
      push("subjective", "", (ADJ.has(h.term) ? h.term + " pain" : h.term) + (p ? " at " + withSide(s, p) : ""));
    });
    body.forEach((h) => {
      const c = ctx(low, h.i, h.len, 25);
      if (!PAIN.test(c) || partsUsed.has(h.term) || overlaps(h, phraseHits) || inExamPart(low, h.i) || isQuestion(speakerLine(low, h.i)) || !complaintOk(h.i)) return;
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

    // VAS — only a value written as n/10
    const vm = VAS.exec(low); if (vm) { const n = vm[1] || vm[2] || vm[3]; if (n && +n <= 10) { out.vas = n; push("objective", "", `VAS ${n}/10`); } }

    // Observation
    const obsTerms = [...V.OBSERVATION, ...(V.OBSERVATION_BY_REGION[R] || [])];
    const IMPROVING = /^\s*(ลดลง|น้อยลง|ดีขึ้น|หาย|decreas\w*|reduc\w*|less|better|improv\w*|resolv\w*|gone)/i;
    const GOALISH = /(ลด|เพิ่ม|reduce|decrease|improve|increase|prevent)\s*$/;
    const obs = pick(scan(entries(obsTerms), low)).filter((h) => !negated(low, h.i) && !isQuestion(speakerLine(low, h.i)) && !IMPROVING.test(low.slice(h.i + h.len, h.i + h.len + 14)) && !GOALISH.test(low.slice(Math.max(0, h.i - 10), h.i)) && !patientSaid(h.i) && !/^\s*(plan|treatment(?!\s+times?)|gym|home)/i.test(speakerLine(low, h.i).slice(0, 18))); heard(obs);
    obs.forEach((h) => {
      const c = ctx(low, h.i, h.len, 40);
      if (h.term === "Redness" && !/\b(skin|red|redness|erythema)\b|แดง/.test(c)) return;
      const p = SITE_OBS.has(h.term) ? partNear(h.i) : "";
      push("objective", "Observation", h.term + (p ? " at " + withSide(side(c), p) : ""));
    });

    // Palpation: finding + nearest muscle (or body part)
    const muscles = pick(scan(entries(ALL_MUSCLES), low)); heard(muscles);
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
      if (isQuestion(speakerLine(low, h.i))) return;
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
    const moves = V.ROM_BY_REGION[R] || V.ROM_GENERAL;
    const bases = [...new Set(moves.map((m) => m.replace(/ (Rt\.|Lt\.)$/, "")))];
    const moveEntries = bases.map((b) => { const tok = norm(b).replace(MOVE_PREFIX, ""); return [b, [...new Set([norm(b), ...(MOVE[tok] || [tok])])]]; });
    const moveHits = pick(scan(moveEntries, low)); const movesSeen = new Set();
    moveHits.forEach((h) => {
      const lineKey = h.term + "|" + sideNear(low, h.i, h.len, 10, false, 7) + "@" + low.lastIndexOf("\n", h.i); if (movesSeen.has(lineKey)) return; movesSeen.add(lineKey);
      const prefix = (h.term.split(" ")[0] || "").toLowerCase(); const preWord = (low.slice(Math.max(0, h.i - 16), h.i).match(/(hip|shoulder|knee|neck|cervical|trunk|lumbar|back|ankle|elbow|wrist|thoracic)\s*$/) || [])[1];
      if (preWord && prefix && preWord !== prefix && !(prefix === "trunk" && /lumbar|back/.test(preWord)) && !(prefix === "neck" && preWord === "cervical")) return;
      const wide = ctx(low, h.i, h.len, 60);
      const nextM = moveHits.filter((m) => m.i > h.i).map((m) => m.i).sort((a, b) => a - b)[0];
      const segEnd = Math.min(nextM === undefined ? low.length : nextM, h.i + h.len + 60, (low.indexOf("\n", h.i) < 0 ? low.length : low.indexOf("\n", h.i)));
      const seg = low.slice(h.i + h.len, segEnd);
      const c = /limit|full|เต็ม|จำกัด|ไม่สุด|ได้ไม่|ปวด|pain|ติด|ตึง|tight|normal|wnl/.test(seg) ? seg : "";
      const lineStart = low.lastIndexOf("\n", h.i) + 1, beforeOnLine = low.slice(lineStart, h.i);
      if (/muscle power|mmt|strength|กำลัง|grade|weak/.test(beforeOnLine) && !ROMCTX.test(seg)) return;
      if (/^\s*(treatment(?!\s+times?)|gym|home|exercise|plan)/i.test(low.slice(lineStart, lineStart + 18))) return;
      if (EXCTX.test(c) && !ROMCTX.test(c)) return;
      if (!ROMCTX.test(wide) && h.len < 6) return;
      out.heard.add(h.term);
      const heading = PASSIVE.test(wide) ? "Passive range of motions" : "Active range of motions";
      let line;
      const sd = sideNear(low, h.i, h.len, 10, false, 7); const nm = sd && !/ (Rt\.|Lt\.)$/.test(h.term) ? `${h.term} ${sd}` : h.term;
      const PAIN_ONLY = /\b(pain|painful|ache|hurts?)\b|ปวด|เจ็บ/, TIGHT = /tight|ตึง|stiff|ฝืด/;
      const cP = c.replace(/(ไม่|\bno|\bwithout|\bnot)\s*(มี)?\s*(ปวด|เจ็บ|pain\w*)/g, "");
      if (LIMITED.test(c)) line = `${nm}: limited` + (TIGHT.test(c) && !PAIN_ONLY.test(cP) ? " by tightness" : PAIN_ONLY.test(cP) ? " by pain" : TIGHT.test(c) ? " by tightness" : "");
      else if (FULL.test(c)) line = `${nm}: full ROM` + (NOPAIN.test(c) && !PAIN_ONLY.test(cP) ? " without pain" : PAIN_ONLY.test(cP) ? " with pain at end range" : TIGHT.test(c) ? " with tightness at end range" : "");
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
    const strHits = pick(scan(entries(V.STRENGTH.filter((s) => !/^Grade/.test(s))), low)).filter((h) => !negated(low, h.i) && !isQuestion(speakerLine(low, h.i)) && !patientSaid(h.i));
    strHits.forEach((h) => {
      out.heard.add(h.term);
      let where = ""; muscles.forEach((m) => { if (Math.abs(m.i - h.i) <= 40 && sameLine(low, m.i, h.i)) where = where || m.term; });
      if (!where) { where = partNear(h.i, 30); if (where && h.term === "Weakness" && strHits.some((o) => o !== h && o.term !== "Weakness" && sameLine(low, o.i, h.i))) return; }
      // a grade belongs to the nearest strength phrase before it, if it is close
      const g = grades.find((x) => !x.used && x.i > h.i && x.i - (h.i + h.len) <= 45 && sameLine(low, h.i, x.i) && !strHits.some((o) => o.i > h.i && o.i < x.i));
      if (g) g.used = true;
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
    fx.forEach((h) => {
      const c = ctx(low, h.i, h.len, 60), cl = clause(low, h.i, h.len);
      const isEx = EXCTX.test(c), isTest = TESTCTX.test(c);
      const inF = FUNC_SET.has(h.term), inE = EX_SET.has(h.term);
      out.heard.add(h.term);
      if (/^\s*(onto|on the|on this|off|from)\b/.test(low.slice(h.i + h.len, h.i + h.len + 9)) || /\b(poor|weak|reduced|good|delayed)\s*$/.test(low.slice(Math.max(0, h.i - 10), h.i))) return;
      if (inE && (!inF || isEx) && !(inF && isTest && !isEx) && !(inF && /\b(show me|can you do|do a|for me)\b/.test(low.slice(Math.max(0, h.i - 30), h.i)))) {
        exHits.push(h);
        const nextX = fx.filter((o) => o.i > h.i).map((o) => o.i).sort((a, b) => a - b)[0];
        const after = low.slice(h.i + h.len, Math.min(nextX === undefined ? low.length : nextX, h.i + h.len + 70, (low.indexOf("\n", h.i) < 0 ? low.length : low.indexOf("\n", h.i))));
        const d = dose(after);
        push("exercise", "Exercise", exLine(h.term, d));
      }
      else if (inF && !overlaps(h, moveHits)) push("objective", "Functional test", h.term + (/\b(pain|painful)\b|ปวด|เจ็บ/.test(low.slice(h.i + h.len, h.i + h.len + 30)) ? " with pain" : ""));
    });

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
      const res = first(after) || first(cl) || BLANK + "ve";
      const s = sideNear(low, h.i, h.len, 8, false);
      push("objective", "Special test", `${name}${s ? " " + s : ""}: ${res}`);
    });

    // Neurological
    pick(scan(entries(V.NEURO_PHRASES), low)).forEach((h) => { out.heard.add(h.term); push("objective", "Neurological examination", h.term); });
    if (NEUROCTX.test(low)) pick(scan(entries(V.MYOTOMES), low)).forEach((h) => { if (NEUROCTX.test(ctx(low, h.i, h.len, 40))) { out.heard.add(h.term); push("objective", "Myotome", h.term); } });

    // Diagnoses
    const dxSeen = new Set();
    pick(scan(entries(ALL_DX), low)).forEach((h) => {
      const c = ctx(low, h.i, h.len, 80);
      if (GENERIC_DX.has(h.term) && !DXCTX.test(c)) return;
      if (patientSaid(h.i) || isQuestion(speakerLine(low, h.i))) return;
      if (HISTORY.test(clause(low, h.i, h.len)) && !/^\s*(analysis|diagnosis|impression|dx)/i.test(speakerLine(low, h.i))) return;
      if (dxSeen.has(h.term)) return; dxSeen.add(h.term);
      out.heard.add(h.term);
      const s = sideNear(low, h.i, h.len);
      push("analysis", "", s && s !== "Both" && !/^(Left|Right) /.test(h.term) ? `${s} ${h.term}` : h.term);
    });

    // Plan
    pick(scan(entries(V.PLAN_GOALS), low)).forEach((h) => { out.heard.add(h.term); push("plan", "", h.term); });

    // Treatment: modalities, position, session
    const modHits = pick(scan(entries(MODALITIES), low)).filter((h) => !overlaps(h, exHits) && !patientSaid(h.i) && !isQuestion(speakerLine(low, h.i)));
    const hasCombined = modHits.some((h) => h.term === "US combined with stim" || h.term === "US + IFC");
    modHits.forEach((h) => {
      if ((h.term === "Ultrasound (US)" || h.term === "Electrical stimulation") && hasCombined) return;
      const c = ctx(low, h.i, h.len, 25);
      if ((h.term === "Stretching" || h.term === "Hot pack") && (BETTER.test(c) || WORSE.test(c)) && !/\b(did|gave|given|applied|apply|treated|treatment|tx)\b|ทำ|ให้|ใช้/.test(c)) return;
      if (h.term === "Home advice" && /\bno advice\b/.test(c)) return;
      out.heard.add(h.term); push("treatment", "", V.TREATMENT_MODALITIES[h.term]);
    });
    if (!modHits.some((h) => /traction/.test(h.term)) && scan([["t", TRACTION]], low).length) {
      const t = R === "Neck / cervical" ? "Neck traction" : "Pelvic traction"; out.heard.add(t); push("treatment", "", V.TREATMENT_MODALITIES[t]);
    }
    pick(scan(entries(V.POSITIONS), low)).forEach((h) => { out.heard.add(h.term); push("treatment", "", h.term); });
    pick(scan(entries(V.POST_TREATMENT || []), low)).forEach((h) => { out.heard.add(h.term); push("treatment", "", h.term); });
    let sm; SESSION.lastIndex = 0;
    while ((sm = SESSION.exec(low))) {
      const c = ctx(low, sm.index, sm[0].length, 30); if (!SESSIONCTX.test(c)) continue;
      const mins = sm[1] ? sm[1] : /1\.5|ครึ่ง/.test(sm[0]) ? "90" : "60";
      const t = mins === "45" ? "CPG 45 mins" : `Session ${mins} minutes`;
      if (V.SESSION_LENGTHS.includes(t)) { out.heard.add(t); push("treatment", "", t); }
    }

    // Problem list (new-patient form)
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

  return { run, hits, aliasesOf };
})();
