/* lay.js — how BPC physios talk to patients, mapped to what goes in the chart.
   Physios are taught to avoid anatomical words with patients: "the outside of
   your knee", "kick your leg up", "I'll press your kneecap down and you tighten
   your thigh". This file is the key that turns that talk into the muscle, the
   movement, the test and the result. Every entry: what the physio says ->
   what the chart calls it. Region gates ambiguous phrases ("outside of your
   leg" is the ITB near the knee and the peroneals near the ankle). */

window.LAY = (function () {
  const R_KNEE = "Knee", R_ANKLE = "Ankle & foot", R_HIP = "Hip", R_SH = "Shoulder", R_NECK = "Neck / cervical",
    R_LUMB = "Trunk / lumbar", R_THOR = "Thoracic spine", R_ARM = "Elbow, wrist & hand";

  // --- body talk -> muscle / structure (as named in MUSCLES) ---------------
  // [phrases[], muscle, regions where it applies (null = anywhere)]
  const BODY = [
    [["point of your shoulder", "point of the shoulder", "top of your shoulder, the point", "tip of your shoulder", "on top of the shoulder joint"], "supraspinatus", [R_SH]],
    [["back of your shoulder", "back of the shoulder", "on the shoulder blade", "behind your shoulder"], "infraspinatus", [R_SH]],
    [["between your shoulder blades", "between the shoulder blades", "inside edge of your shoulder blade"], "rhomboid", [R_SH, R_NECK, R_THOR]],
    [["under your collarbone", "below your collarbone", "under the collarbone", "front of your chest near the shoulder"], "pectoralis minor", [R_SH, R_NECK, R_THOR]],
    [["side of your neck", "side of the neck", "muscle down the side of your neck"], "levator scapulae", [R_NECK, R_SH]],
    [["base of your skull", "base of the skull", "back of your head where it meets the neck", "just under your skull"], "suboccipital", [R_NECK]],
    [["muscles beside the spine", "muscles beside your spine", "either side of your spine", "muscles next to the spine", "left of the spine", "right of the spine", "beside the spine"], "paraspinal", [R_LUMB, R_THOR, R_NECK]],
    [["deep in the buttock", "deep in your buttock", "deep in your bottom", "middle of your buttock"], "piriformis", [R_LUMB, R_HIP]],
    [["just in front of the ankle bone on the outside", "in front of and below the ankle bone", "front of the ankle bone on the outside", "in front of the ankle bone"], "ATFL", [R_ANKLE]],
    [["below the ankle bone", "under the ankle bone", "just below the ankle bone on the outside"], "CFL", [R_ANKLE]],
    [["base of your little toe", "outside edge of your foot", "along the outside of the foot"], "peroneus brevis", [R_ANKLE]],
    [["outside of your knee", "outside of the knee", "outer knee", "lateral knee", "side of your knee", "outside of your thigh", "outside of the thigh", "outer thigh", "side of your thigh"], "ITB", [R_KNEE, R_HIP]],
    [["front of your thigh", "front of the thigh", "top of your thigh", "thigh muscle", "your quad", "your quads"], "quadriceps", null],
    [["inside of your knee", "inner knee", "medial knee", "inside of the knee"], "MCL", [R_KNEE]],
    [["under your kneecap", "below your kneecap", "below the kneecap", "under the kneecap", "tendon below the knee", "just below the knee", "top of your shin"], "patellar tendon", [R_KNEE]],
    [["kneecap", "knee cap"], "patellofemoral joint", [R_KNEE]],
    [["back of your knee", "behind your knee", "behind the knee"], "popliteus", [R_KNEE]],
    [["back of your thigh", "back of the thigh", "your hamstring", "hamstrings"], "hamstring", null],
    [["your calf", "calf muscle", "back of your lower leg", "back of the lower leg", "calves"], "gastrocnemius", null],
    [["front of your shin", "shin muscle", "front of your lower leg", "front of the lower leg", "outside of your shin"], "tibialis anterior", [R_ANKLE, R_KNEE]],
    [["outside of your lower leg", "outside of the lower leg", "outside of your ankle", "outer ankle", "outside of the ankle", "outside of your foot", "outer foot"], "peroneus longus", [R_ANKLE]],
    [["ankle ligament", "ligament on the outside of your ankle", "outside ligament", "front outside of your ankle", "just in front of the ankle bone"], "ATFL", [R_ANKLE]],
    [["back of your heel", "back of the heel", "above your heel", "achilles", "heel cord"], "achilles tendon", null],
    [["bottom of your foot", "bottom of your heel", "sole of your foot", "underneath your foot", "arch of your foot", "under your heel", "heel bone"], "plantar fascia", null],
    [["your bum", "your buttock", "buttock", "glute", "glutes", "back of your hip", "your bottom"], "gluteus maximus", null],
    [["side of your hip", "outside of your hip", "outer hip", "hip muscle on the side", "side of the hip"], "gluteus medius", null],
    [["front of your hip", "front of the hip", "hip flexor", "top of your thigh at the front", "crease of your hip"], "iliopsoas", null],
    [["your groin", "inner thigh", "inside of your thigh", "groin muscle"], "hip adductor", null],
    [["deep in your buttock", "deep in the buttock", "deep glute"], "piriformis", null],
    [["lower back muscles", "muscles of your lower back", "either side of your spine", "beside your spine", "along your spine", "back muscles", "muscles in your back"], "lumbar paraspinal", [R_LUMB, R_THOR, null]],
    [["side of your lower back", "flank", "just above your hip at the back"], "quadratus lumborum (QL)", [R_LUMB]],
    [["top of your shoulder", "top of your shoulders", "between your neck and shoulder", "shoulder muscle at the top", "shoulder muscles", "your traps"], "upper trapezius", null],
    [["side of your neck", "sides of your neck", "muscle at the side of your neck"], "levator scapulae", [R_NECK, R_SH]],
    [["base of your skull", "back of your head", "just under your skull", "top of your neck at the back", "where your neck meets your head"], "sub-occipital", null],
    [["back of your neck", "neck muscles", "muscles of your neck"], "cervical paraspinal", null],
    [["between your shoulder blades", "between the shoulder blades", "inside of your shoulder blade", "inner shoulder blade"], "rhomboid", null],
    [["your shoulder blade", "shoulder blade muscle", "back of your shoulder"], "infraspinatus", [R_SH]],
    [["front of your shoulder", "front of the shoulder", "front of your chest", "chest muscle", "your pec", "your pecs"], "pectoralis major", null],
    [["under your collarbone", "below the collarbone", "just under the collarbone"], "pectoralis minor", null],
    [["top of your arm", "top of your shoulder at the side", "outside of your shoulder", "outer shoulder", "side of your shoulder"], "supraspinatus", [R_SH]],
    [["your bicep", "your biceps", "front of your upper arm", "front of the upper arm"], "biceps", null],
    [["your tricep", "your triceps", "back of your upper arm", "back of the upper arm"], "triceps", null],
    [["under your arm", "side of your back", "armpit muscle", "your lat", "your lats"], "latissimus dorsi", null],
    [["outside of your elbow", "outside of the elbow", "outer elbow", "bony point on the outside of your elbow"], "common extensor origin", null],
    [["inside of your elbow", "inside of the elbow", "inner elbow", "bony point on the inside of your elbow"], "common flexor origin", null],
    [["top of your forearm", "back of your forearm", "forearm muscles on top", "forearm muscle"], "wrist extensor group", null],
    [["underneath your forearm", "palm side of your forearm", "front of your forearm"], "wrist flexor group", null],
    [["base of your thumb", "fleshy part of your thumb", "thumb muscle"], "thenar", null],
    [["your tummy", "stomach muscles", "your abs", "your core", "deep tummy muscle", "tummy muscles"], "transversus abdominis", null],
  ];

  // --- movement talk -> ROM movement token (matched to the region's movement names) ----
  // [phrases[], movement token as in MOVE keys or a full movement name]
  const MOVE = [
    [["kick your leg up", "kick your leg out", "straighten your knee", "straighten your leg", "straighten the knee", "straighten it fully", "straighten it", "straighten that leg", "leg out straight", "lock your knee out", "push your knee straight"], "Knee extension"],
    [["bend your knee", "pull your heel to your bottom", "pull your heel towards your bottom", "heel to your bum", "bend the knee", "bring your heel up"], "Knee flexion"],
    [["raise your arm overhead", "raise your arm up", "lift your arm up", "arm up in front", "reach up", "arm straight up", "arm forward and up", "hands above your head", "lift both arms up"], "Shoulder flexion"],
    [["out to the side", "arm out to the side", "lift your arm out sideways", "arms out like a bird", "arm sideways"], "Shoulder abduction"],
    [["hand behind your back", "reach behind your back", "reach up your back", "behind your back like doing up a bra", "scratch your back"], "Hand behind back"],
    [["hand behind your head", "hand behind your neck", "reach behind your head", "like combing your hair"], "Shoulder ER"],
    [["rotate your arm out", "turn your arm out", "open the door", "elbow in, hand out", "turn your forearm out"], "Shoulder ER"],
    [["rotate your arm in", "turn your arm in", "close the door", "hand across your tummy", "turn your forearm in"], "Shoulder IR"],
    [["look up", "look up at the ceiling", "tilt your head back", "chin up"], "Neck extension"],
    [["look down", "chin to your chest", "tuck your chin down", "bend your neck forward", "nod down"], "Neck flexion"],
    [["turn your head", "look over your shoulder", "turn to look behind", "turn your head to the"], "Neck rotation"],
    [["ear to your shoulder", "tilt your head", "tip your head to the side", "ear towards your shoulder"], "Neck lateral flexion"],
    [["bend forward", "touch your toes", "reach for your toes", "bend down to the floor", "fold forward", "roll down"], "Trunk flexion"],
    [["lean back", "lean backwards", "lean back with your hands on your hips", "arch your back", "bend backwards", "look up and lean back", "extend your back"], "Trunk extension"],
    [["slide your hand down your leg", "slide your hand down the side of your leg", "hand down the side of your leg", "lean to the side", "side bend", "tip to the side", "reach down the side of your leg", "slide your hand down"], "Trunk lateral flexion"],
    [["twist your body", "twist round", "turn your body", "rotate your trunk", "look behind you with your whole body"], "Trunk rotation"],
    [["pull your foot up", "pull your toes up", "toes towards you", "point your foot up", "foot up towards your knee", "bring your toes up"], "Ankle dorsiflexion"],
    [["point your toes", "push your foot down", "press the pedal", "point your foot down", "toes away from you", "push down like a gas pedal"], "Ankle plantarflexion"],
    [["turn your foot in", "sole of your foot inwards", "roll your foot in", "foot inwards"], "Subtalar inversion"],
    [["turn your foot out", "sole of your foot outwards", "roll your foot out", "foot outwards"], "Subtalar eversion"],
    [["lift your knee up", "knee to your chest", "bring your knee up", "lift your leg up towards your chest", "hug your knee"], "Hip flexion"],
    [["leg out to the side", "move your leg out", "open your leg out", "leg away from the other one", "take your leg out sideways"], "Hip abduction"],
    [["leg across", "bring your leg in", "leg towards the middle", "cross your leg over", "squeeze your legs together"], "Hip adduction"],
    [["leg back", "lift your leg behind you", "kick back", "leg up behind you", "lift your leg off the bed lying on your front"], "Hip extension"],
    [["curl your arm up", "bend your elbow", "bring your hand to your shoulder", "bend your arm"], "Elbow flexion"],
    [["straighten your elbow", "straighten your arm", "arm out straight"], "Elbow extension"],
    [["palm up", "turn your palm up", "turn your hand over palm up"], "Supination"],
    [["palm down", "turn your palm down", "turn your hand over palm down"], "Pronation"],
    [["bend your wrist up", "wrist up", "back of your hand towards you", "cock your wrist back", "lift your hand up at the wrist"], "Wrist extension"],
    [["bend your wrist down", "wrist down", "palm towards you", "drop your wrist", "hand down at the wrist"], "Wrist flexion"],
  ];

  // --- what the physio says while doing a special test -> the test --------
  // Each: phrases the physio uses (any one of them, in the physio's line), the test, regions.
  // The result is read from the patient's reply on the next line(s): pain/click/yes -> +ve, no/fine -> -ve.
  const TESTS = [
    [["press your kneecap down", "press down on your kneecap", "push your kneecap down", "hold your kneecap", "tighten your thigh while i hold the kneecap", "squeeze your thigh muscle while i press"], "Patellar grind", [R_KNEE]],
    [["push your kneecap to the side", "move your kneecap outwards", "push the kneecap sideways", "kneecap to the outside"], "Patellar apprehension", [R_KNEE]],
    [["bend and rotate your knee", "bend and rotate the knee", "bend and twist your knee", "bend and twist the knee", "twist your knee", "twist the knee", "rotate your knee", "rotate the knee", "bend your knee right up and turn your foot", "turn your foot in and out while i bend", "if there's a click", "pain or a click", "any clicking"], "McMurray test", [R_KNEE]],
    [["stand on the painful leg and twist", "stand on one leg and twist", "twist on the leg with your knee slightly bent"], "Thessaly test", [R_KNEE]],
    [["pull your shin forward", "pull your lower leg forward", "pull the shin bone forward", "pull the shin forward", "knee slightly bent and i'll pull", "pull your leg forward at the knee", "check the ligament at the front", "i'll pull your shin"], "Lachman test", [R_KNEE]],
    [["knee bent up and i'll pull your shin", "sit on your foot and pull", "pull your shin towards me", "pull the leg forward with your knee bent"], "Anterior drawer (knee)", [R_KNEE]],
    [["push your shin back", "push your lower leg backwards", "push the shin backwards"], "Posterior drawer", [R_KNEE]],
    [["push your knee inwards", "press your knee in from the outside", "stress the inside of your knee", "push the knee in"], "Valgus stress test", [R_KNEE]],
    [["push your knee outwards", "press your knee out from the inside", "stress the outside of your knee", "push the knee out"], "Varus stress test", [R_KNEE]],
    [["hug your knee to your chest", "hug your left knee", "hug your right knee", "hug one knee", "knee to your chest and let", "leg hang off the bed", "let the other leg hang", "let the other leg relax down", "does the thigh stay up", "thigh stays up", "thigh stay up"], "Thomas test", [R_KNEE, R_HIP, R_LUMB]],
    [["let your leg drop down behind you lying on your side", "top leg back and let it drop", "does your leg drop", "leg stays up in the air on your side"], "Ober test", [R_KNEE, R_HIP]],
    [["press on the outside of your knee while i straighten", "press on the outside of the knee and bend", "pressure on the outside of your knee as i move it"], "Noble test", [R_KNEE, R_HIP]],
    [["lift your leg straight up", "lift your leg up straight", "keep your leg straight and i'll lift it", "i'll lift your straight leg", "raise your leg keeping the knee straight", "pain down the leg when i lift", "i'm going to lift your leg straight up", "lift your leg straight up, keep it relaxed"], "SLR", [R_LUMB, R_HIP]],
    [["sit on the edge and slouch", "slouch and straighten your knee", "slump forward", "chin down and straighten your leg", "slouch down, chin to chest"], "Slump test", [R_LUMB, R_THOR]],
    [["bend your knee while you lie on your front", "heel to your bottom lying on your front", "on your front and i'll bend your knee", "bend your knee while you're on your front", "while you're on your front, i'll bring your heel", "on your front, i'll bring your heel towards your bottom", "bring your heel towards your bottom while you're on your front"], "PKB (prone knee bend)", [R_LUMB, R_HIP]],
    [["press down on your head", "push down on the top of your head", "press on top of your head", "press down on the top of your head", "push down on your head", "press straight down on your head"], "Compression test", [R_NECK]],
    [["tilt your head and i'll press down", "head to the side and press down", "turn and tilt your head, i'll press", "tilt your head back and to the side", "tilt your head to the right and i'll press", "tilt your head to the left and i'll press", "tilt your head to the side and i'll press", "head tilted and i'll press down"], "Spurling test", [R_NECK]],
    [["lift your head up", "take the weight of your head", "take the weight of it", "gently pull your head up", "lift your head off your shoulders", "lift your head and take the weight"], "Distraction test", [R_NECK]],
    [["arm out, thumb down", "thumb pointing down", "empty a can", "emptying a can", "like pouring out a can", "arm out and turn your thumb down", "turn your thumb down like", "thumb down like you're emptying"], "Empty can test", [R_SH]],
    [["arm out, thumb up", "thumb pointing up", "like holding a full can"], "Full can test", [R_SH]],
    [["i'll lift your arm up in front", "arm straight and i'll lift it right up", "lift your arm all the way up with the palm down", "lift it up in front all the way", "i'll lift it up in front", "lift your arm up in front all the way", "all the way with the palm down"], "Neer test", [R_SH]],
    [["arm forward, elbow bent, i'll turn it in", "elbow bent and i'll rotate your arm in", "arm at ninety and rotate in", "bend your elbow and i'll push your hand down", "elbow bent, i'll turn your arm inwards", "i'll turn your arm inwards", "i'll turn your arm in", "elbow bent and turn your arm inwards"], "Hawkins-Kennedy", [R_SH]],
    [["palm up, arm forward, resist", "arm forward, palm up, don't let me push", "palm facing up and push against my hand", "palm facing up, arm forward, push up", "palm facing up, arm forward", "palm up, arm forward, push up against my hand"], "Speed's test", [R_SH]],
    [["elbow bent, turn your palm up against me", "turn your palm up while i hold your hand", "resist as you turn your hand out"], "Yergason test", [R_SH]],
    [["arm out like a throw", "arm behind like throwing a ball", "does it feel like it will pop out", "feels like it might slip out", "about to throw a ball", "like you're about to throw", "feel like it might slip out"], "Apprehension test", [R_SH]],
    [["painful arc", "catches in the middle of the movement", "catch in the middle of the movement", "a catch through the middle"], "Painful arc", [R_SH]],
    [["make a fist with your thumb inside", "thumb in your fist and bend your wrist down", "tuck your thumb in and bend towards the little finger"], "Finkelstein test", [R_ARM]],
    [["tap on your wrist", "tap here on the wrist", "tap on the inside of your wrist", "tap over the nerve"], "Tinel sign", [R_ARM, R_ANKLE]],
    [["backs of your hands together", "hold your wrists bent down together", "press the backs of your hands together for a minute", "hands like a reverse prayer"], "Phalen test", [R_ARM]],
    [["make a fist and bend your wrist up against me", "lift your wrist up against my hand with the elbow straight", "cock your wrist back and don't let me push it down"], "Cozen test", [R_ARM]],
    [["i'll bend your wrist down with your arm straight", "stretch the top of your forearm", "palm down, arm straight, i'll bend your wrist"], "Mill's test", [R_ARM]],
    [["squeeze your calf", "squeeze the calf muscle", "i'll squeeze your calf and watch your foot"], "Thompson test", [R_ANKLE]],
    [["pull your heel forward", "pull your foot forward", "hold your heel and pull it forward", "pull your ankle forward"], "Anterior drawer (ankle)", [R_ANKLE]],
    [["tilt your heel inwards", "tip your heel in", "roll your heel inwards", "tilt your ankle in"], "Talar tilt", [R_ANKLE]],
    [["squeeze your lower leg", "squeeze the two bones together", "squeeze your shin bones", "squeeze the two bones of your lower leg", "squeeze the two bones", "squeeze your lower leg bones together"], "Squeeze test", [R_ANKLE]],
    [["pull your big toe up", "bend your big toe up", "lift your big toe back", "stretch your big toe up"], "Windlass test", [R_ANKLE]],
    [["figure four", "figure of four", "ankle on the other knee", "ankle across your other knee and let the knee drop", "like a number four"], "FABER", [R_HIP, R_LUMB]],
    [["knee up and across your body", "bring your knee across and turn it in", "knee to the opposite shoulder", "knee up and in"], "FADIR", [R_HIP]],
    [["stand on one leg and i'll watch your hips", "stand on one leg, keep your hips level", "does your hip drop when you stand on one leg"], "Trendelenburg", [R_HIP, R_KNEE, R_LUMB]],
    [["press your hips together", "press on both hips", "squeeze your pelvis", "push in on your hips", "push them together", "press on your hips, push them together", "press your pelvis together"], "SIJ compression", [R_LUMB, R_HIP]],
    [["press your hips apart", "press on the front of both hips", "push down on your hip bones", "push your pelvis open", "press them apart", "down on the front of your hips", "press down on the front of your hips"], "SIJ distraction", [R_LUMB, R_HIP]],
    [["bend forward and i'll look at your spine", "bend forward so i can see your back", "touch your toes while i look at your spine", "bend forward from standing"], "Adam's forward bend test", [R_THOR, R_LUMB]],
  ];

  // --- what the physio says while testing strength -> muscle group ---------
  const MMT_CONTEXT = /don't let me|dont let me|do not let me|resist|hold it|hold that|hold this|push against|pull against|against my hand|against me|i'll push|i will push|i'll pull|i will pull|keep it there|stay strong|ต้าน|อย่าให้|เกร็งไว้|ค้างไว้/i;
  const MMT = [
    [["straighten your knee", "keep your knee straight", "leg straight", "push down on your ankle", "kick your leg up", "knee straight and hold"], "quadriceps"],
    [["keep your knee bent", "heel towards you", "heel to your bottom and hold", "bend your knee against", "pull your heel"], "hamstring"],
    [["leg to the side", "leg up towards the ceiling", "top leg up", "lift your leg up sideways", "leg out sideways and hold"], "gluteus medius"],
    [["leg off the bed", "leg up off the bed", "lift your leg up off the bed", "leg behind you", "leg up behind", "lift your leg back", "on your front", "on your stomach"], "gluteus maximus"],
    [["push your foot down", "point your foot down", "like a pedal", "toes away"], "gastrocnemius"],
    [["pull your foot up", "toes up", "foot up towards you"], "tibialis anterior"],
    [["turn your foot out", "foot outwards"], "peroneus longus"],
    [["push your arm down", "arm out to the side", "hold your arm out"], "middle deltoid"],
    [["turn your arm out", "hand out against", "rotate out", "elbow tucked in, out"], "infraspinatus"],
    [["turn your arm in", "hand in against", "rotate in", "elbow tucked in, in"], "subscapularis"],
    [["thumb down", "empty can"], "supraspinatus"],
    [["shoulder blades together", "shoulder blades back", "squeeze your shoulder blades"], "rhomboid"],
    [["push your head", "head to the side", "keep your head still", "head straight"], "cervical paraspinal"],
    [["tuck your chin", "chin in", "nod your chin"], "deep neck flexor"],
    [["bend your elbow", "curl your arm", "arm bent"], "biceps"],
    [["straighten your elbow", "arm straight and push down"], "triceps"],
    [["cock your wrist back", "wrist up", "wrist back"], "wrist extensor group"],
    [["squeeze my fingers", "grip my hand", "squeeze as hard as you can", "squeeze my hand"], "grip"],
    [["tummy in", "belly button in", "tighten your tummy", "draw in"], "transversus abdominis"],
  ];

  // physio-observed cues for tests where the patient's reply does not decide the result
  const TEST_CUES = {
    "Thomas test": [/thigh stays? up|stays up|doesn't come down|off the bed|lifts up/i, /drops down|flat on the bed|comes down|lies flat/i],
    "Ober test": [/stays up|doesn't drop|stays in the air/i, /drops down|drops/i],
    "Trendelenburg": [/hip drops|pelvis drops|drops on|sags/i, /stays level|level|steady/i],
    "Thompson test": [/foot doesn't move|no movement|doesn't point/i, /foot points|foot moves|plantar/i],
    "Adam's forward bend test": [/hump|rib hump|one side higher|curve/i, /symmetrical|even|straight/i],
    "Windlass test": [/pain|hurts|yes/i, /no|fine|nothing/i],
    "Painful arc": [/painful arc|catch|catches|pinch/i, /no painful arc|smooth|no catch/i],
    "Distraction test": [/relie|eases|takes it away|feels nice|feels good|feels better|better/i, /no change|no different|same|nothing|worse/i],
  };

  // functional tests said plainly
  const FUNC = [
    [["do a squat", "squat for me", "squat down", "squat as deep", "squat as far", "deep squat"], "Squat"],
    [["stand on your right leg and", "stand on your left leg and", "stand on one leg and do", "small dip", "single leg dip", "one leg squat", "squat on one leg", "on one leg and bend"], "Single leg squat"],
    [["step down from", "step down slowly", "step off the box", "step down off"], "Step down test"],
    [["step up onto", "step up on the box", "step onto the box"], "Step up test"],
    [["stand on one leg", "balance on one leg", "stand on your right leg", "stand on your left leg", "one leg, eyes closed"], "Single leg balance"],
    [["walk for me", "walk up and down", "walk to the door", "watch you walk", "let me see you walk"], "Gait analysis"],
    [["up on your toes", "onto your tiptoes", "up onto your toes", "heel raises", "raise your heels"], "Heel raise"],
    [["hop on one leg", "hop for me", "hop forward", "hop up and down"], "Hop test"],
    [["sit down and stand up", "stand up from the chair", "stand up without using your hands", "sit to stand"], "Sit to stand double legs"],
    [["reach behind your back", "hand up your back", "scratch your back"], "Hand behind back"],
    [["hand behind your head", "reach behind your neck", "comb your hair"], "Hand behind neck"],
    [["knee to the wall", "knee towards the wall", "touch the wall with your knee"], "Knee to wall"],
  ];

  // --- plain words for a diagnosis, said while explaining ------------------
  const DX = [
    [["runner's knee", "runners knee", "kneecap rubbing", "kneecap tracking", "kneecap is pulled to the outside", "pain behind the kneecap"], "Patellofemoral pain syndrome", [R_KNEE]],
    [["jumper's knee", "the tendon below your kneecap is inflamed", "tendon under the kneecap is irritated"], "Patellar tendinopathy", [R_KNEE]],
    [["wear and tear", "the cartilage is worn", "arthritis in your knee", "joint is worn"], "Knee osteoarthritis", [R_KNEE]],
    [["wear and tear", "arthritis in your hip", "hip joint is worn"], "Hip osteoarthritis", [R_HIP]],
    [["the cushion in your knee", "the shock absorber in your knee is torn", "meniscus is torn", "torn cartilage"], "Meniscus tear", [R_KNEE]],
    [["rolled your ankle", "rolled ankle", "went over on your ankle", "sprained your ankle", "sprained ankle", "ligament on the outside of the ankle is overstretched", "ankle ligament is sprained", "sprained the ligament on the outside of your ankle", "sprained the ligament", "ligament on the outside of your ankle", "moderate sprain", "mild sprain", "severe sprain", "ankle sprain"], "Ankle sprain", [R_ANKLE]],
    [["heel pain from the tissue under your foot", "band under your foot is inflamed", "the tissue under your foot", "plantar fasciitis"], "Plantar fasciitis", [R_ANKLE]],
    [["achilles is inflamed", "achilles tendon is irritated", "tendon at the back of your heel is inflamed"], "Achilles tendinitis", [R_ANKLE]],
    [["shin splints", "the muscle on your shin is overloaded"], "Shin splints", [R_ANKLE]],
    [["frozen shoulder", "your shoulder capsule is tight", "the shoulder joint has stiffened up", "capsule has become stiff"], "Frozen shoulder (adhesive capsulitis)", [R_SH]],
    [["tendon is pinched", "pinching in the shoulder", "tendon gets squashed", "impingement", "catching at the top of the shoulder", "tendon gets pinched", "what we call impingement", "pinched in the space"], "Subacromial impingement", [R_SH]],
    [["rotator cuff tendon is inflamed", "rotator cuff is irritated", "tendon on top of your shoulder is inflamed"], "Rotator cuff tendinitis", [R_SH]],
    [["tennis elbow", "tendon on the outside of your elbow is inflamed"], "Lateral epicondylitis (tennis elbow)", [R_ARM]],
    [["golfer's elbow", "tendon on the inside of your elbow is inflamed"], "Medial epicondylitis (golfer's elbow)", [R_ARM]],
    [["nerve in your wrist is squashed", "carpal tunnel", "nerve at the wrist is compressed"], "Carpal tunnel syndrome", [R_ARM]],
    [["slipped disc", "disc is bulging", "disc is pressing on the nerve", "disc is pushing on the nerve", "herniated disc", "the cushion between the bones is bulging", "disc pressing on a nerve", "disc pressing on the nerve", "disc bulged", "bulged backwards", "disc bulge", "bulging disc", "disc is a cushion", "pressing on the nerve that runs down", "disc has bulged"], "Lumbar disc herniation", [R_LUMB]],
    [["pinched nerve in your back", "nerve is irritated in your back", "sciatica", "nerve pain down your leg"], "Sciatica", [R_LUMB]],
    [["pinched nerve in your neck", "nerve in your neck is irritated", "trapped nerve in your neck", "nerve pain down your arm"], "Cervical radiculopathy", [R_NECK]],
    [["muscle knots", "knots in the muscle", "trigger points in the muscle", "muscle is overworked and tight", "tight bands in the muscle", "muscle tension from posture"], "Myofascial pain syndrome (MPS)", [R_NECK, R_THOR, R_SH]],
    [["headache from your neck", "headaches coming from the neck", "neck is causing the headache", "headache coming from the neck", "headache comes from your neck", "headache is coming from the neck", "refers pain up into your head"], "Cervicogenic headache", [R_NECK]],
    [["office syndrome", "from sitting at the computer"], "Office syndrome", [R_NECK, R_THOR]],
    [["pulled muscle", "strained muscle", "muscle strain", "small tear in the muscle", "muscle is torn a little"], "Muscle strain", null],
    [["hamstring is torn", "pulled your hamstring", "hamstring strain"], "Hamstring strain", [R_HIP, R_KNEE]],
    [["tight band on the outside of your leg", "band on the outside of your thigh is tight", "itb is tight"], "ITB tightness", [R_KNEE, R_HIP]],
    [["sacroiliac joint", "joint at the back of your pelvis", "the joint where your spine meets your pelvis"], "Sacroiliac joint dysfunction", [R_LUMB]],
    [["deep buttock muscle pressing on the nerve", "piriformis"], "Piriformis syndrome", [R_LUMB, R_HIP]],
    [["your posture is causing it", "posture problem", "poor posture", "postural"], "Poor posture", null],
    [["muscle imbalance", "some muscles are tight and others are weak", "weak on one side and tight on the other"], "Muscle imbalance", null],
  ];

  // --- the patient's reply -> test result ----------------------------------
  const POSITIVE = /\b(yes|yeah|yep|ouch|ow|ah|that hurts|that's it|that's the one|that's the spot|there|painful|pain|sharp|catch|click|clicks|clicking|pop|grinding|tender|sore|uncomfortable|yes a bit|a bit|a little|slightly|hmm yes)\b|เจ็บ|ปวด|ใช่|ตรงนั้น|โอ๊ย|อุ๊ย|ดัง|กึก/i;
  const NEGATIVE = /\b(no|nope|nothing|fine|okay|ok|that's fine|no pain|not really|nothing there|doesn't hurt|feels normal|same as the other side|no click|no difference)\b|ไม่|ไม่เจ็บ|ไม่ปวด|ปกติ|เฉยๆ|โอเค/i;

  return { BODY, MOVE, TESTS, MMT, MMT_CONTEXT, TEST_CUES, FUNC, DX, POSITIVE, NEGATIVE };
})();
