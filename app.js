/* =============================================================
   Pattern to Performance — Front-end MVP (prototype)
   ----------------------------------------------------------------
   localStorage keys (single source of truth for prototype state):
     ptp.user            { name, email, ageRange, role, careerStage, workStyle, mainChallenge, mainGoal, recognisedPattern, openText }
     ptp.assessment      { responses, completedAt }
     ptp.profile         { primary, secondary, scores, subTags, frequency, replacementBehaviour, recommendedProgramme }
     ptp.summit          { programme, startDate, currentStageIndex, altitudePct, dayNumber }
     ptp.identity        { day0, day30, day60, day90, futureSelfLetter }
     ptp.challenges      { breakers: [...], goldens: [...] }
     ptp.reflections     { daily: [...], weekly: [...], monthly: [...] }
     ptp.progress        { weeks: [{ weekIndex, scores, frequency, breakersDone, goldensDone, witnessed, reflectionStreak }] }

   Backend integration points (stubs only — see fns at bottom):
     - Supabase: persist all state, RLS per user_id, encrypted reflection content.
     - Stripe: handle £497 / £897 / £1,497 checkout via Stripe Checkout / Payment Links;
       webhook → createSummit() on payment success.
     - Resend / Loops: transactional onboarding, daily challenge nudge, weekly summary.
     - Claude API: reflection summarisation, pattern-signal extraction, weekly insight.
     - PostHog: lifecycle + retention analytics.
     - Optional: Twilio/WhatsApp for daily nudges in production.
   ============================================================= */

const PtP = (() => {
  const KEY = 'ptp';
  const ns = (k) => `${KEY}.${k}`;

  // ---------- storage helpers ----------
  const load = (k, fallback = null) => {
    try { const v = localStorage.getItem(ns(k)); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  };
  const save = (k, v) => localStorage.setItem(ns(k), JSON.stringify(v));
  const clear = () => Object.keys(localStorage).filter(k => k.startsWith(KEY + '.')).forEach(k => localStorage.removeItem(k));

  // ---------- pattern catalogue ----------
  const PATTERNS = {
    overthinker:   { id: 'overthinker',   name: 'The Overthinker',
      one: 'Thinks too much, acts too late.',
      cost: 'Lost momentum, missed windows, the team gets impatient, decisions slip.',
      triggers: 'High-stakes calls, ambiguity, multiple options, perfectionist standards, fear of being wrong in public.',
      replacement: 'Decide faster, act smaller, build proof.',
      firstChallenge: 'Make one decision in under 10 minutes today that you would normally delay.' },
    avoider:       { id: 'avoider',       name: 'The Avoider',
      one: 'Dodges discomfort.',
      cost: 'Conversations rot, problems compound, trust erodes, the room loses respect quietly.',
      triggers: 'Conflict, feedback, accountability moments, conversations that feel personal, performance issues.',
      replacement: 'Step into the moment you normally escape.',
      firstChallenge: 'Have one conversation you have been avoiding — by end of week.' },
    overexplainer: { id: 'overexplainer', name: 'The Over-Explainer',
      one: 'Weakens the message by saying too much.',
      cost: 'Authority leaks. People stop listening before the point lands.',
      triggers: 'Senior audiences, written messages, anything where you feel you need permission to take up space.',
      replacement: 'Say the point clearly, then stop.',
      firstChallenge: 'Explain one important point in under 60 seconds. No padding.' },
    performer:     { id: 'performer',     name: 'The Performer',
      one: 'Looks capable externally but feels pressure internally.',
      cost: 'Burnout, isolation, the gap between appearance and reality grows until something breaks.',
      triggers: 'Visibility, status comparison, pressure to keep up, fear of being found out.',
      replacement: 'Stop performing strength. Start building it honestly.',
      firstChallenge: 'Tell one trusted person where you are actually feeling pressure.' },
    drifter:       { id: 'drifter',       name: 'The Drifter',
      one: 'Has potential but lacks direction.',
      cost: 'Years compound with no compounding. Capability exists; results do not.',
      triggers: 'Open-ended environments, multiple options, lack of external structure, post-success drift.',
      replacement: 'Choose a path, remove distraction, move daily.',
      firstChallenge: 'Choose one clear direction for the next 30 days. Remove one distraction today.' },
    pleaser:      { id: 'pleaser',       name: 'The Pleaser',
      one: 'Says yes too often and abandons their own standards.',
      cost: 'Capacity disappears. Resentment builds. The work that mattered most gets dropped first.',
      triggers: 'Social pressure, hierarchy, fear of disappointing, unclear personal priorities.',
      replacement: 'Be honest without over-apologising.',
      firstChallenge: 'Say no once this week without over-explaining.' },
    silenttalent:  { id: 'silenttalent',  name: 'The Silent Talent',
      one: 'Has ability but stays hidden.',
      cost: 'Promotions go to less capable people. Influence stays small. The work goes unrewarded.',
      triggers: 'Group settings, opportunities to speak, situations that feel like self-promotion, internal narrative of "not ready yet".',
      replacement: 'Be seen before you feel fully ready.',
      firstChallenge: 'Speak first in a meeting, group, or conversation this week.' },
    reactor:       { id: 'reactor',       name: 'The Reactor',
      one: 'Lets emotion drive behaviour under pressure.',
      cost: 'Trust costs, repaired relationships, the wrong impression formed in 6 seconds.',
      triggers: 'Stress, criticism, surprise, perceived disrespect, fatigue, hunger.',
      replacement: 'Pause, name the emotion, choose the response.',
      firstChallenge: 'Pause for 10 seconds before responding in your next triggering moment.' },
  };

  const SCORE_AREAS = ['Self-Awareness', 'Authority', 'Discipline', 'Connection'];
  const SUB_TAGS = ['Energy', 'Environment', 'Direction', 'Emotional control', 'Communication clarity', 'Visibility'];

  const STAGES = [
    { id: 'basecamp',   name: 'Basecamp',     subtitle: 'Awareness',
      pain: 'You can sense the pattern but not name it.',
      fix: 'Name the pattern. Map when and where it shows up.',
      achievement: 'A clear, written description of your pattern in your own words.',
      unlock: 'Complete the Pattern Assessment + 3 Pattern Breakers.' },
    { id: 'first-climb',name: 'First Climb',  subtitle: 'Ownership',
      pain: 'Awareness without ownership. You see it, you still slip.',
      fix: 'Own the cost. Own the trigger. Stop blaming context.',
      achievement: 'A first reflection that names cost and trigger honestly.',
      unlock: 'Complete week 1 reflection + first Golden Challenge.' },
    { id: 'ridge',      name: 'The Ridge',    subtitle: 'Action',
      pain: 'You know what to do; the body resists doing it.',
      fix: 'Smaller reps, more often. Behavioural reps over insight.',
      achievement: '12+ Pattern Breakers logged. First witnessed Golden Challenge.',
      unlock: 'Reach altitude 35%.' },
    { id: 'hard-climb', name: 'The Hard Climb', subtitle: 'Repetition',
      pain: 'The novelty has gone. Discipline is the only fuel left.',
      fix: 'Show up on the days you do not feel like it.',
      achievement: 'Reflection streak of 14 days. Weakest score area moved by 8+ points.',
      unlock: 'Reach altitude 60%.' },
    { id: 'storm',      name: 'The Storm',    subtitle: 'Pressure',
      pain: 'A real-world high-pressure moment exposes the old pattern again.',
      fix: 'Run the new behaviour under pressure. This is what trains it.',
      achievement: 'A witnessed Golden Challenge under genuine pressure.',
      unlock: 'Reach altitude 82%.' },
    { id: 'summit',     name: 'The Summit',   subtitle: 'New Standard',
      pain: 'Risk of returning to the old normal once the programme ends.',
      fix: 'Codify the new standard. Set the next 90-day plan before the climb ends.',
      achievement: 'Final Transformation Report + Future-Self letter returned + new identity statement signed.',
      unlock: 'Complete final reassessment.' },
  ];

  const PROGRAMMES = {
    '30':  { id: '30',  name: '30-Day Pattern Sprint',         price: 497,
      summary: 'For identifying the pattern and starting the reset.',
      length: 30,  goldens: 4 },
    '60':  { id: '60',  name: '60-Day Pattern Builder',        price: 897,
      summary: 'For turning awareness into repeated behaviour change.',
      length: 60,  goldens: 8 },
    '90':  { id: '90',  name: '90-Day Pattern Transformation', price: 1497,
      summary: 'For replacing the old pattern with a new personal and professional standard.',
      length: 90,  goldens: 12 },
  };

  // ---------- challenge library (sample) ----------
  // Selection logic: PatternType + CareerStage + WorkStyle + WeakestScoreArea + Goal
  // For prototype we tag each challenge and pick the best match.
  const CHALLENGE_LIBRARY = [
    { id: 'b001', text: 'Speak once earlier than you usually would in your next meeting.', tags: ['silenttalent', 'overthinker', 'authority', 'visibility'] },
    { id: 'b002', text: 'Send the message you have been delaying. Three sentences. No softeners.', tags: ['avoider', 'overexplainer', 'authority', 'communication'] },
    { id: 'b003', text: 'Change one piece of your physical environment today (workspace, route, lighting).', tags: ['drifter', 'environment', 'energy'] },
    { id: 'b004', text: 'Make one decision in under 5 minutes that you would normally chew on.', tags: ['overthinker', 'discipline', 'direction'] },
    { id: 'b005', text: 'Say no to one request without giving a reason longer than 12 words.', tags: ['pleaser', 'authority'] },
    { id: 'b006', text: 'Pause for 10 seconds before responding to the next thing that gets under your skin.', tags: ['reactor', 'self-awareness', 'emotional-control'] },
    { id: 'b007', text: 'Ask one better question in your next 1:1 and stop talking.', tags: ['overexplainer', 'connection', 'communication'] },
    { id: 'b008', text: 'Tell one trusted person where you are actually struggling — not where it looks good.', tags: ['performer', 'connection'] },
    { id: 'b009', text: 'Block 90 minutes for the work that matters most. Phone in another room.', tags: ['drifter', 'discipline', 'environment'] },
    { id: 'b010', text: 'Reach out to one person you have lost contact with. Two-line message. Today.', tags: ['silenttalent', 'connection', 'visibility'] },
  ];

  const GOLDEN_LIBRARY = {
    overthinker:   'Make one decision in under 10 minutes that you would normally delay. Document it briefly.',
    avoider:       'Have one conversation you have been avoiding. In person or on a call — not in writing.',
    overexplainer: 'Explain one important point in under 60 seconds, in front of someone who matters.',
    performer:     'Tell one trusted person where you are actually feeling pressure. Be specific.',
    drifter:       'Choose one clear direction for the next 30 days and remove one distraction today.',
    pleaser:       'Say no once this week without over-explaining. Three words is allowed; three sentences is not.',
    silenttalent:  'Speak first in a meeting, group, or conversation. Stay there 90 seconds.',
    reactor:       'Pause for 10 seconds before responding in a triggering moment. Name the emotion to yourself first.',
  };

  // ---------- assessment scoring ----------
  // The assessment uses 24 items: 3 per pattern, scored 1-5.
  // Plus context fields (career stage, work style, etc.) used only for routing.
  // For each pattern, compute mean. Top score = primary, second = secondary.
  // Score areas computed from a weighted overlay (sub-tags).
  const ASSESSMENT_ITEMS = [
    // overthinker
    { p: 'overthinker',   q: 'I find myself analysing decisions long after I should have made them.' },
    { p: 'overthinker',   q: 'I run through worst-case scenarios more than I act.' },
    { p: 'overthinker',   q: 'I delay sending messages while I rewrite them in my head.' },
    // avoider
    { p: 'avoider',       q: 'I postpone conversations I know I need to have.' },
    { p: 'avoider',       q: 'I find reasons not to bring up things that bother me at work.' },
    { p: 'avoider',       q: 'I tend to deal with friction by getting busy with something else.' },
    // overexplainer
    { p: 'overexplainer', q: 'I add context to a request so people will not be annoyed with me.' },
    { p: 'overexplainer', q: 'My emails get longer when I am unsure how the reader will receive them.' },
    { p: 'overexplainer', q: 'I justify decisions out loud even when no one has questioned them.' },
    // performer
    { p: 'performer',     q: 'People who know me well would be surprised how much pressure I am under.' },
    { p: 'performer',     q: 'I look composed in situations that I am internally finding very hard.' },
    { p: 'performer',     q: 'I rarely admit when I am not coping.' },
    // drifter
    { p: 'drifter',       q: 'I have capability that is not being directed toward anything specific right now.' },
    { p: 'drifter',       q: 'My weeks blur into each other without clear forward movement.' },
    { p: 'drifter',       q: 'I jump between priorities depending on what feels live that day.' },
    // pleaser
    { p: 'pleaser',       q: 'I say yes when I want to say no.' },
    { p: 'pleaser',       q: 'I over-apologise when I push back, even gently.' },
    { p: 'pleaser',       q: 'My standards drop when other people are watching me hold them.' },
    // silenttalent
    { p: 'silenttalent',  q: 'My results do not match how visible my work is.' },
    { p: 'silenttalent',  q: 'I wait until I feel ready before putting myself forward.' },
    { p: 'silenttalent',  q: 'People often discover I have skills they did not know about.' },
    // reactor
    { p: 'reactor',       q: 'My first reaction under pressure is rarely the one I would have chosen.' },
    { p: 'reactor',       q: 'I notice I have responded too quickly only after I have already responded.' },
    { p: 'reactor',       q: 'Strong feelings show up in my tone or face before I have decided how to handle them.' },
  ];

  // ---------- profile generation ----------
  function generatePatternProfile() {
    const a = load('assessment');
    if (!a || !a.responses) return null;
    const totals = {}; const counts = {};
    Object.entries(a.responses).forEach(([qid, val]) => {
      const item = ASSESSMENT_ITEMS[Number(qid)];
      if (!item) return;
      totals[item.p] = (totals[item.p] || 0) + Number(val);
      counts[item.p] = (counts[item.p] || 0) + 1;
    });
    const ranked = Object.keys(PATTERNS).map(p => ({
      p, mean: counts[p] ? totals[p] / counts[p] : 0
    })).sort((a, b) => b.mean - a.mean);
    const primary   = PATTERNS[ranked[0].p];
    const secondary = PATTERNS[ranked[1].p];

    // score areas — weighted overlay; tweak as needed
    const map = {
      'Self-Awareness': ['overthinker', 'performer', 'reactor'],
      'Authority':      ['overexplainer', 'pleaser', 'silenttalent'],
      'Discipline':     ['drifter', 'overthinker', 'avoider'],
      'Connection':     ['avoider', 'silenttalent', 'performer'],
    };
    const scores = {};
    SCORE_AREAS.forEach(area => {
      const ps = map[area];
      const sum = ps.reduce((s, p) => s + (totals[p] || 0), 0);
      const max = ps.reduce((s, p) => s + (counts[p] || 0) * 5, 0);
      // higher score on items = stronger pattern = LOWER current score on the area
      // map to 0–100 with 100 = strongest area, 0 = weakest
      const ratio = max ? sum / max : 0;
      scores[area] = Math.round(100 - ratio * 70 + Math.random() * 4); // small noise to feel organic
    });

    const subTags = {};
    SUB_TAGS.forEach(t => subTags[t] = Math.round(45 + Math.random() * 30));

    const frequency = Math.max(2, Math.round((totals[primary.id] || 0) / 3 * 1.2));

    const recommendedProgramme = ranked[0].mean >= 4 ? '90' : ranked[0].mean >= 3 ? '60' : '30';

    const profile = {
      primary: primary.id,
      secondary: secondary.id,
      scores,
      subTags,
      frequency,
      replacementBehaviour: primary.replacement,
      recommendedProgramme,
      generatedAt: new Date().toISOString(),
    };
    save('profile', profile);
    // BACKEND: replace with submitProfileToBackend(profile) — Supabase upsert into profiles table
    return profile;
  }

  // ---------- summit setup ----------
  function createSummit(programmeId) {
    const programme = PROGRAMMES[programmeId];
    if (!programme) return null;
    const summit = {
      programme: programmeId,
      startDate: new Date().toISOString(),
      currentStageIndex: 0,
      altitudePct: 4,
      dayNumber: 1,
    };
    save('summit', summit);
    // BACKEND: Stripe webhook → POST /api/summit { user_id, programme }; createSummit on backend
    seedDayOneChallenges();
    return summit;
  }

  function seedDayOneChallenges() {
    const profile = load('profile');
    if (!profile) return;
    const todays = pickPatternBreaker(profile);
    const golden = GOLDEN_LIBRARY[profile.primary];
    save('challenges', {
      breakers: [{ id: todays.id, text: todays.text, status: 'assigned', day: 1 }],
      goldens:  [{ id: 'g1', week: 1, text: golden, status: 'assigned' }],
    });
  }

  function pickPatternBreaker(profile) {
    if (!profile) profile = load('profile');
    if (!profile) return CHALLENGE_LIBRARY[0];
    // simple: pick first breaker tagged with primary; fall back to library[0]
    return CHALLENGE_LIBRARY.find(c => c.tags.includes(profile.primary)) || CHALLENGE_LIBRARY[0];
  }

  // ---------- progress ----------
  function logBreakerCompletion(id, note = '') {
    const c = load('challenges') || { breakers: [], goldens: [] };
    const idx = c.breakers.findIndex(b => b.id === id);
    if (idx >= 0) c.breakers[idx].status = 'completed';
    save('challenges', c);
    bumpProgress({ breakers: 1 });
  }

  function bumpProgress({ breakers = 0, goldens = 0, witnessed = 0 } = {}) {
    const summit = load('summit');
    if (!summit) return;
    summit.altitudePct = Math.min(100, summit.altitudePct + breakers * 2 + goldens * 6 + witnessed * 4);
    summit.currentStageIndex = stageIndexForAltitude(summit.altitudePct);
    save('summit', summit);
  }

  function stageIndexForAltitude(pct) {
    if (pct < 12) return 0;
    if (pct < 28) return 1;
    if (pct < 50) return 2;
    if (pct < 72) return 3;
    if (pct < 92) return 4;
    return 5;
  }

  function submitReflection(type, payload) {
    const all = load('reflections') || { daily: [], weekly: [], monthly: [] };
    const entry = { ...payload, at: new Date().toISOString() };
    all[type] = all[type] || [];
    all[type].push(entry);
    save('reflections', all);
    // BACKEND: POST /api/reflections + LLM extraction (Claude API) returning sentiment, pattern signal
  }

  // ---------- demo / seed ----------
  // Useful so dashboard, progress, pattern pack etc. all show populated data
  // even if user hasn't completed assessment yet.
  function seedDemoIfEmpty() {
    if (load('profile')) return;
    const responses = {};
    ASSESSMENT_ITEMS.forEach((it, i) => {
      // bias toward Overthinker + Performer for an interesting demo profile
      const lean = (it.p === 'overthinker' || it.p === 'performer') ? 1.2 : 0.7;
      responses[i] = Math.max(1, Math.min(5, Math.round(2.5 + Math.random() * 2 * lean)));
    });
    save('user', {
      name: 'Alex Morgan', email: 'alex@example.com',
      ageRange: '35-44', role: 'Senior Manager', careerStage: 'mid',
      workStyle: 'hybrid', mainChallenge: 'plateau', mainGoal: 'authority',
      recognisedPattern: 'overthinker', openText: 'I freeze on big decisions and over-prepare for high-stakes meetings.'
    });
    save('assessment', { responses, completedAt: new Date().toISOString() });
    generatePatternProfile();
    save('identity', {
      day0: 'I am someone who over-prepares and acts late.',
      futureSelfLetter: 'You will look back and laugh at how long you waited to make this decision.',
    });
    createSummit('60');
    const summit = load('summit');
    summit.altitudePct = 38; summit.currentStageIndex = 2; summit.dayNumber = 23;
    save('summit', summit);
    save('progress', {
      weeks: [
        { weekIndex: 1, scores: { 'Self-Awareness': 52, 'Authority': 48, 'Discipline': 56, 'Connection': 60 }, frequency: 14, breakersDone: 5, goldensDone: 1, witnessed: 1, reflectionStreak: 5 },
        { weekIndex: 2, scores: { 'Self-Awareness': 58, 'Authority': 52, 'Discipline': 60, 'Connection': 62 }, frequency: 11, breakersDone: 6, goldensDone: 1, witnessed: 1, reflectionStreak: 12 },
        { weekIndex: 3, scores: { 'Self-Awareness': 61, 'Authority': 57, 'Discipline': 62, 'Connection': 63 }, frequency:  9, breakersDone: 6, goldensDone: 1, witnessed: 1, reflectionStreak: 18 },
        { weekIndex: 4, scores: { 'Self-Awareness': 64, 'Authority': 60, 'Discipline': 64, 'Connection': 65 }, frequency:  7, breakersDone: 6, goldensDone: 1, witnessed: 1, reflectionStreak: 23 },
      ]
    });
    save('reflections', {
      daily: [
        { at: dateOffset(-2), q: 'Where did the old pattern show up today?', text: 'Slack message I rewrote four times before sending.' },
        { at: dateOffset(-1), q: 'What rep did you complete?', text: 'Made a hiring call in 6 minutes instead of 2 days.' },
      ],
      weekly: [
        { at: dateOffset(-7), summary: 'Pattern showed up most in written communication. Acted faster in 2 meetings. Old behaviour tried to take over after the Tuesday board call.' }
      ],
      monthly: [],
    });
    save('challenges', {
      breakers: [
        { id: 'b001', day: 1,  text: 'Speak once earlier than you usually would in your next meeting.', status: 'completed' },
        { id: 'b004', day: 22, text: 'Make one decision in under 5 minutes that you would normally chew on.', status: 'completed' },
        { id: 'b007', day: 23, text: 'Ask one better question in your next 1:1 and stop talking.', status: 'assigned' },
      ],
      goldens: [
        { id: 'g1', week: 1, text: GOLDEN_LIBRARY.overthinker, status: 'witnessed', witnesses: ['Priya', 'Jordan', 'Sam'] },
        { id: 'g2', week: 2, text: GOLDEN_LIBRARY.overthinker, status: 'witnessed', witnesses: ['Priya', 'Jordan'] },
        { id: 'g3', week: 3, text: GOLDEN_LIBRARY.overthinker, status: 'completed' },
        { id: 'g4', week: 4, text: GOLDEN_LIBRARY.overthinker, status: 'assigned' },
      ],
    });
  }

  function dateOffset(days) {
    const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString();
  }

  // ---------- backend stubs ----------
  // Wire these up when Supabase/Stripe/Resend/Claude/PostHog are connected.
  async function submitAssessmentToBackend(_payload) { /* TODO: Supabase upsert + audit */ return { ok: true }; }
  async function generatePatternProfileApi(_payload) { /* TODO: server-side LLM enrichment via Claude */ return generatePatternProfile(); }
  async function startCheckout(programmeId) {
    // TODO: Stripe Payment Link / Checkout
    // const url = stripeUrls[programmeId];
    // window.location = url;
    alert(`(prototype) Stripe checkout for ${PROGRAMMES[programmeId].name} — £${PROGRAMMES[programmeId].price}`);
    return createSummit(programmeId);
  }
  async function assignPatternBreaker(_userId) { /* TODO: server: pick from library by tags + day */ return pickPatternBreaker(); }
  async function assignGoldenChallenge(_userId, _week) { /* TODO: server: weekly cron */ }
  async function submitReflectionApi(payload) { /* TODO: persist + Claude analysis */ submitReflection(payload.type, payload); }
  async function updateProgress(_userId) { /* TODO: nightly recompute */ }
  async function submitWitnessedRep(_id, _witnessIds) { /* TODO: notify witnesses, mark witnessed */ }
  async function updatePatternFrequency(_userId, _value) { /* TODO: persist */ }
  async function exportUserData() {
    const out = {};
    ['user','assessment','profile','summit','identity','challenges','reflections','progress'].forEach(k => out[k] = load(k));
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'pattern-to-performance-export.json'; a.click();
    URL.revokeObjectURL(url);
  }
  async function deleteUserData() {
    if (!confirm('Delete all your local data? This is reversible only by retaking the assessment.')) return;
    clear();
    location.href = './index.html';
  }

  // ---------- nav / reveal helpers ----------
  function setupReveal() {
    const els = document.querySelectorAll('[data-reveal]');
    if (!els.length || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    els.forEach(el => io.observe(el));
  }

  function setActiveNav(currentFile) {
    document.querySelectorAll('.nav a').forEach(a => {
      if (a.getAttribute('href') === currentFile || a.dataset.href === currentFile) a.classList.add('active');
    });
  }

  function topbar(currentFile) {
    const isHome = currentFile === 'index.html' || currentFile === '';
    if (isHome) {
      return `
      <header class="topbar" id="topbar">
        <div class="wrap topbar-inner">
          <a href="./index.html" class="brand">
            <div class="brand-mark">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19l5-9 4 6 3-4 6 7H3z"/></svg>
            </div>
            <div class="brand-name">
              <span>Lead Within Academy</span>
              <span class="small">Behavioural performance</span>
            </div>
          </a>
          <nav class="nav">
            <a href="./assessment.html">The Behavioural Baseline Test</a>
            <a href="./programmes.html">Programmes</a>
          </nav>
          <a href="./assessment.html" class="btn btn-primary btn-sm">Take the Behavioural Baseline Test →</a>
        </div>
      </header>`;
    }
    return `
    <header class="topbar">
      <div class="wrap topbar-inner">
        <a href="./index.html" class="brand">
          <div class="brand-mark">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19l5-9 4 6 3-4 6 7H3z"/></svg>
          </div>
          <div class="brand-name">
            <span>Lead Within Academy</span>
            <span class="small">Behavioural performance</span>
          </div>
        </a>
        <nav class="nav">
          <a href="./assessment.html">Baseline Test</a>
          <a href="./programmes.html">Programmes</a>
          <a href="./dashboard.html">Dashboard</a>
          <a href="./progress.html">Progress</a>
          <a href="./pattern-pack.html">Pattern Pack</a>
        </nav>
        <a href="./assessment.html" class="btn btn-ghost btn-sm">Take the Baseline Test</a>
      </div>
    </header>`;
  }

  function footer() {
    return `
    <footer class="foot">
      <div class="wrap row">
        <div>© Lead Within Academy · Pattern to Performance™ · Spot it. Break it. Replace it. Prove it.</div>
        <div class="row" style="gap:24px;">
          <a href="#" onclick="PtP.exportUserData(); return false;">Export my data</a>
          <a href="#" onclick="PtP.deleteUserData(); return false;">Delete my data</a>
        </div>
      </div>
    </footer>`;
  }

  // ---------- mountain SVG ----------
  // altitudePct: 0..100 — controls climber position along the route.
  function mountainSVG(altitudePct = 0, opts = {}) {
    const pct = Math.max(0, Math.min(100, altitudePct));
    // Route path is normalised over 0..1; map pct to point along it.
    const route = "M 60 460 C 160 440 220 410 300 360 C 360 320 410 290 460 250 C 520 210 560 180 620 130 C 680 80 720 60 760 50";
    return `
    <svg viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#0a1226"/>
          <stop offset="60%"  stop-color="#0a0f1f"/>
          <stop offset="100%" stop-color="#06090f"/>
        </linearGradient>
        <linearGradient id="m1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1a2540"/><stop offset="100%" stop-color="#070b14"/>
        </linearGradient>
        <linearGradient id="m2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#222e4d"/><stop offset="100%" stop-color="#0a1224"/>
        </linearGradient>
        <linearGradient id="m3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2c3a60"/><stop offset="100%" stop-color="#0d1428"/>
        </linearGradient>
        <radialGradient id="halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(230,200,121,0.55)"/>
          <stop offset="60%" stop-color="rgba(230,200,121,0.05)"/>
          <stop offset="100%" stop-color="rgba(230,200,121,0)"/>
        </radialGradient>
        <linearGradient id="goldRoute" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#c9a961"/><stop offset="100%" stop-color="#f0d68c"/>
        </linearGradient>
      </defs>

      <rect width="800" height="500" fill="url(#sky)"/>

      <!-- stars -->
      <g class="stars">
        <circle cx="80"  cy="60"  r="1" class="star-twinkle"/>
        <circle cx="220" cy="40"  r="1.2"/>
        <circle cx="320" cy="90"  r="0.9" class="star-twinkle"/>
        <circle cx="500" cy="40"  r="1"/>
        <circle cx="640" cy="80"  r="1.4"/>
        <circle cx="700" cy="30"  r="1" class="star-twinkle"/>
        <circle cx="120" cy="120" r="0.8"/>
        <circle cx="420" cy="110" r="0.9"/>
      </g>

      <!-- distant range -->
      <path d="M0,360 L80,300 L150,330 L240,260 L320,310 L420,240 L520,290 L600,250 L680,280 L800,260 L800,500 L0,500 Z" fill="url(#m3)" opacity="0.7"/>
      <!-- mid range -->
      <path d="M0,400 L100,360 L200,400 L320,330 L450,380 L560,330 L680,370 L800,330 L800,500 L0,500 Z" fill="url(#m2)" opacity="0.85"/>
      <!-- near mountain (the climb) -->
      <path d="M0,500 L0,470 C 60,460 120,455 180,450 C 240,445 280,440 320,420 C 380,380 430,360 480,320 C 540,270 600,220 660,140 L760,50 L800,80 L800,500 Z" fill="url(#m1)"/>

      <!-- summit halo -->
      <circle cx="760" cy="50" r="60" fill="url(#halo)" class="summit-glow"/>
      <!-- summit marker -->
      <circle cx="760" cy="50" r="6" fill="#f0d68c"/>
      <circle cx="760" cy="50" r="12" fill="none" stroke="rgba(240,214,140,0.5)" stroke-width="1"/>

      <!-- route (dashed) -->
      <path d="${route}" class="route"/>
      <!-- progress route -->
      <path d="${route}" class="route-progress" stroke-dasharray="2000" stroke-dashoffset="${2000 - 20 * pct}"/>

      <!-- markers at 30/60/90 (rough positions along the path) -->
      ${routeMarker(route, 0.33, '30 day')}
      ${routeMarker(route, 0.66, '60 day')}
      ${routeMarker(route, 1.00, '90 day')}

      <!-- climber -->
      ${climberAt(route, pct / 100)}
    </svg>`;
  }

  // helpers — get a point along the path using a temp SVGPathElement attached offscreen
  function pathPointAt(d, t) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d); svg.appendChild(p);
    document.body.appendChild(svg);
    const len = p.getTotalLength();
    const pt = p.getPointAtLength(len * t);
    document.body.removeChild(svg);
    return pt;
  }

  function routeMarker(d, t, label) {
    // Without DOM at template-time we approximate marker positions with hardcoded points
    // (the SVG is static; this is a stylistic approximation).
    const pts = { 0.33: { x: 380, y: 295 }, 0.66: { x: 580, y: 165 }, 1.00: { x: 760, y: 50 } };
    const pt = pts[t] || { x: 0, y: 0 };
    return `
      <g>
        <circle cx="${pt.x}" cy="${pt.y}" r="4" fill="#0b0f1a" stroke="#c9a961" stroke-width="1.5"/>
        <text x="${pt.x + 12}" y="${pt.y + 4}" font-family="Inter" font-size="10" fill="#9aa3b8" letter-spacing="1.6">${label.toUpperCase()}</text>
      </g>`;
  }

  function climberAt(d, t) {
    // approximate climber position using same scheme; t = 0..1
    // We sample three rough points and lerp.
    const samples = [
      { t: 0,    x: 60,  y: 460 },
      { t: 0.33, x: 380, y: 295 },
      { t: 0.66, x: 580, y: 165 },
      { t: 1.0,  x: 760, y: 50 },
    ];
    let pt = samples[0];
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      if (t >= a.t && t <= b.t) {
        const k = (t - a.t) / (b.t - a.t);
        pt = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        break;
      }
    }
    return `
      <g>
        <circle cx="${pt.x}" cy="${pt.y}" r="11" fill="rgba(230,200,121,0.18)"/>
        <circle cx="${pt.x}" cy="${pt.y}" r="6" fill="#f0d68c"/>
        <circle cx="${pt.x}" cy="${pt.y}" r="2.2" fill="#0b0f1a"/>
      </g>`;
  }

  // -----------------------------------------------------------------
  // heroMountain — Section 01: cinematic peak with three faint route
  // lines drawn lightly up the face, terminating at different
  // elevations. No labels, no climber, no overlay text.
  // -----------------------------------------------------------------
  function heroMountain() {
    return `
    <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="hSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#0a1226"/>
          <stop offset="55%"  stop-color="#080d1d"/>
          <stop offset="100%" stop-color="#06090f"/>
        </linearGradient>
        <linearGradient id="hPeak" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2c3a60"/>
          <stop offset="50%" stop-color="#1a2540"/>
          <stop offset="100%" stop-color="#070b14"/>
        </linearGradient>
        <linearGradient id="hMid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#222e4d"/>
          <stop offset="100%" stop-color="#0a1224"/>
        </linearGradient>
        <linearGradient id="hFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1a2540"/>
          <stop offset="100%" stop-color="#0d1428"/>
        </linearGradient>
        <radialGradient id="hHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(230,200,121,0.40)"/>
          <stop offset="60%" stop-color="rgba(230,200,121,0.04)"/>
          <stop offset="100%" stop-color="rgba(230,200,121,0)"/>
        </radialGradient>
      </defs>

      <rect width="800" height="1000" fill="url(#hSky)"/>

      <!-- stars -->
      <g opacity="0.7">
        <circle cx="80"  cy="80"   r="0.9" fill="#fff"/>
        <circle cx="220" cy="50"   r="1.1" fill="#fff"/>
        <circle cx="380" cy="100"  r="0.8" fill="#fff"/>
        <circle cx="540" cy="70"   r="1.2" fill="#fff"/>
        <circle cx="700" cy="40"   r="1.0" fill="#fff"/>
        <circle cx="140" cy="180"  r="0.7" fill="#fff"/>
        <circle cx="620" cy="160"  r="0.9" fill="#fff"/>
        <circle cx="460" cy="200"  r="0.8" fill="#fff"/>
      </g>

      <!-- far range -->
      <path d="M0,720 L80,640 L180,690 L280,600 L400,660 L520,580 L640,640 L760,580 L800,610 L800,1000 L0,1000 Z" fill="url(#hFar)" opacity="0.55"/>

      <!-- mid range -->
      <path d="M0,800 L120,720 L240,790 L380,680 L520,760 L640,690 L780,750 L800,720 L800,1000 L0,1000 Z" fill="url(#hMid)" opacity="0.75"/>

      <!-- main peak -->
      <path d="M0,1000 L0,900 C 80,880 160,860 240,820 C 320,780 380,720 440,640 C 500,560 540,480 580,380 C 620,280 650,200 680,140 L720,80 L760,40 L800,80 L800,1000 Z" fill="url(#hPeak)"/>

      <!-- summit halo -->
      <circle cx="760" cy="40" r="80" fill="url(#hHalo)"/>
      <circle cx="760" cy="40" r="4" fill="#e6c879"/>

      <!-- three faint route lines: 30 / 60 / 90 -->
      <!-- 30-day route — terminates lower on the face -->
      <path d="M 110 900 C 200 820 280 740 360 660 C 400 620 430 600 460 580"
            fill="none" stroke="rgba(201, 169, 97, 0.22)" stroke-width="1.6"
            stroke-dasharray="2 5" stroke-linecap="round"/>
      <circle cx="460" cy="580" r="3" fill="rgba(201, 169, 97, 0.5)"/>

      <!-- 60-day route — terminates higher -->
      <path d="M 90 920 C 200 840 300 750 400 620 C 480 510 540 420 600 320"
            fill="none" stroke="rgba(201, 169, 97, 0.28)" stroke-width="1.6"
            stroke-dasharray="2 5" stroke-linecap="round"/>
      <circle cx="600" cy="320" r="3" fill="rgba(201, 169, 97, 0.55)"/>

      <!-- 90-day route — to summit -->
      <path d="M 70 940 C 200 860 320 770 460 600 C 580 460 660 290 760 40"
            fill="none" stroke="rgba(230, 200, 121, 0.55)" stroke-width="2"
            stroke-dasharray="3 5" stroke-linecap="round" id="hero-route-90"/>
    </svg>`;
  }

  // -----------------------------------------------------------------
  // routesMountain — Section 07: same peak, three terminal markers
  // labelled with the outcome words (not durations).
  // -----------------------------------------------------------------
  function routesMountain() {
    return `
    <svg viewBox="0 0 1600 700" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="rSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#0a1226"/>
          <stop offset="100%" stop-color="#06090f"/>
        </linearGradient>
        <linearGradient id="rPeak" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2c3a60"/>
          <stop offset="60%" stop-color="#1a2540"/>
          <stop offset="100%" stop-color="#070b14"/>
        </linearGradient>
        <linearGradient id="rMid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#222e4d"/>
          <stop offset="100%" stop-color="#0a1224"/>
        </linearGradient>
        <radialGradient id="rHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(230,200,121,0.35)"/>
          <stop offset="70%" stop-color="rgba(230,200,121,0.04)"/>
          <stop offset="100%" stop-color="rgba(230,200,121,0)"/>
        </radialGradient>
      </defs>

      <rect width="1600" height="700" fill="url(#rSky)"/>

      <!-- mid range -->
      <path d="M0,560 L200,500 L400,540 L600,460 L800,510 L1000,450 L1200,500 L1400,460 L1600,490 L1600,700 L0,700 Z" fill="url(#rMid)" opacity="0.7"/>

      <!-- main peak -->
      <path d="M0,700 L0,640 C 200,620 360,580 500,520 C 640,460 740,380 820,300 C 880,240 920,180 960,120 L1000,60 L1040,30 L1080,80 C 1140,180 1220,280 1320,360 C 1440,460 1540,520 1600,560 L1600,700 Z" fill="url(#rPeak)"/>

      <!-- summit halo -->
      <circle cx="1040" cy="30" r="90" fill="url(#rHalo)"/>
      <circle cx="1040" cy="30" r="5" fill="#e6c879"/>

      <!-- three route lines with terminal markers -->
      <!-- 30-day -->
      <path d="M 200 640 C 350 580 460 510 540 460"
            fill="none" stroke="rgba(201, 169, 97, 0.45)" stroke-width="1.8"
            stroke-dasharray="3 5" stroke-linecap="round" class="rline" id="rline-30"/>
      <circle cx="540" cy="460" r="6" fill="#0a0e18" stroke="#c9a961" stroke-width="2"/>
      <circle cx="540" cy="460" r="2.5" fill="#e6c879"/>
      <text x="560" y="464" font-family="Inter" font-size="11" fill="#c9a961" letter-spacing="1.4">30 · FIRST RESET</text>

      <!-- 60-day -->
      <path d="M 200 640 C 400 540 600 420 740 300"
            fill="none" stroke="rgba(201, 169, 97, 0.55)" stroke-width="1.8"
            stroke-dasharray="3 5" stroke-linecap="round" class="rline" id="rline-60"/>
      <circle cx="740" cy="300" r="6" fill="#0a0e18" stroke="#c9a961" stroke-width="2"/>
      <circle cx="740" cy="300" r="2.5" fill="#e6c879"/>
      <text x="760" y="304" font-family="Inter" font-size="11" fill="#c9a961" letter-spacing="1.4">60 · CONSISTENCY UNDER PRESSURE</text>

      <!-- 90-day to summit -->
      <path d="M 200 640 C 400 540 700 360 1040 30"
            fill="none" stroke="rgba(230, 200, 121, 0.75)" stroke-width="2.2"
            stroke-dasharray="3 5" stroke-linecap="round" class="rline" id="rline-90"/>
      <circle cx="1040" cy="30" r="9" fill="none" stroke="rgba(230, 200, 121, 0.5)" stroke-width="1.2"/>
      <text x="1060" y="34" font-family="Inter" font-size="11" fill="#e6c879" letter-spacing="1.4">90 · THE NEW STANDARD</text>
    </svg>`;
  }

  // -----------------------------------------------------------------
  // domainsDiagram — Section 06: bespoke radial diagram, 8 domains
  // around an octagonal perimeter, irregular inner polygon = "where
  // most clients start".
  // -----------------------------------------------------------------
  function domainsDiagram() {
    const cx = 300, cy = 300, r = 220;
    const labels = [
      'CONFIDENCE',
      'COMMUNICATION',
      'SELF-AWARENESS',
      'HABITS',
      'CHOICES',
      'ENVIRONMENT',
      'RELATIONSHIPS',
      'LEADERSHIP PRESENCE',
    ];
    // 8 points around an octagon, starting at top
    const pts = labels.map((_, i) => {
      const angle = (-Math.PI / 2) + (i * (Math.PI * 2) / 8);
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), angle };
    });
    // irregular inner polygon (varying radii)
    const innerRadii = [0.62, 0.48, 0.55, 0.42, 0.50, 0.38, 0.46, 0.52];
    const innerPts = labels.map((_, i) => {
      const angle = (-Math.PI / 2) + (i * (Math.PI * 2) / 8);
      const ir = r * innerRadii[i];
      return { x: cx + ir * Math.cos(angle), y: cy + ir * Math.sin(angle) };
    });
    const innerPath = innerPts.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ') + ' Z';

    return `
    <svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <!-- spokes -->
      ${pts.map(p => `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="currentColor" stroke-width="0.6" stroke-opacity="0.18"/>`).join('')}

      <!-- outer octagon -->
      <polygon points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="currentColor" stroke-opacity="0.32" stroke-width="1"/>

      <!-- inner irregular polygon -->
      <path d="${innerPath}" fill="rgba(180, 140, 71, 0.06)" stroke="#b48c47" stroke-width="1.4" stroke-opacity="0.7"/>

      <!-- centre marker -->
      <circle cx="${cx}" cy="${cy}" r="3" fill="#b48c47"/>
      <text x="${cx}" y="${cy + 22}" text-anchor="middle" font-family="Inter" font-size="10" letter-spacing="2" fill="currentColor" fill-opacity="0.7">YOUR STANDARD</text>

      <!-- perimeter dots and labels -->
      ${pts.map((p, i) => {
        const offsetX = Math.cos(p.angle) * 24;
        const offsetY = Math.sin(p.angle) * 24;
        const lx = p.x + offsetX;
        const ly = p.y + offsetY + 4;
        const anchor = p.x < cx - 40 ? 'end' : p.x > cx + 40 ? 'start' : 'middle';
        return `
          <circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#b48c47"/>
          <text x="${lx}" y="${ly}" text-anchor="${anchor}" font-family="Inter" font-size="10.5" letter-spacing="1.6" fill="currentColor" fill-opacity="0.78" font-weight="600">${labels[i]}</text>
        `;
      }).join('')}
    </svg>`;
  }

  // -----------------------------------------------------------------
  // Homepage observers — topbar reveal, ghosted words, route reveal
  // -----------------------------------------------------------------
  function setupHomepageObservers() {
    if (!document.body.classList.contains('light-theme')) return;

    // 1) Topbar reveals after scrolling past the hero
    const topbar = document.getElementById('topbar');
    const hero = document.querySelector('.section-hero');
    if (topbar && hero) {
      const heroObserver = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.intersectionRatio < 0.2) topbar.classList.add('is-visible');
          else topbar.classList.remove('is-visible');
        });
      }, { threshold: [0, 0.2, 1] });
      heroObserver.observe(hero);
    }

    // 2) Ghosted background words fade in when their section enters viewport
    const ghostWords = document.querySelectorAll('.ghost-word');
    if (ghostWords.length && 'IntersectionObserver' in window) {
      const gObserver = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) e.target.classList.add('in');
          else e.target.classList.remove('in');
        });
      }, { threshold: 0.18, rootMargin: '-12% 0px -12% 0px' });
      ghostWords.forEach(g => gObserver.observe(g));
    }

    // 3) Route cards horizontal reveal (Section 07 — the one horizontal moment)
    const routeCards = document.querySelectorAll('.route-card');
    const routesSection = document.querySelector('.section-routes');
    if (routeCards.length && routesSection && 'IntersectionObserver' in window) {
      const rObserver = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            routeCards.forEach((c, i) => {
              setTimeout(() => c.classList.add('in'), i * 250);
            });
            rObserver.unobserve(e.target);
          }
        });
      }, { threshold: 0.25 });
      rObserver.observe(routesSection);
    }
  }

  // -----------------------------------------------------------------
  // v6 — Three.js procedural terrain (hero)
  // -----------------------------------------------------------------
  function shouldUseWebGL() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (window.innerWidth < 760) return false;
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  function elevationAt(x, z) {
    // Three designed peaks + background ridge + slope + noise
    const g = (cx, cz, r, h) => {
      const dx = x - cx, dz = z - cz;
      return h * Math.exp(-(dx*dx + dz*dz) / (r*r));
    };
    const p1 = g(5.5, -3, 3.2, 2.8);   // dominant peak — back-right
    const p2 = g(-2, -1, 2.6, 1.9);    // mid plateau
    const p3 = g(-5.5, 5.5, 2.4, 1.0); // foreground rise
    const r1 = g(2, -9, 5, 1.5);       // distant ridge
    const slope = Math.max(0, z + 2) * -0.04;
    const a = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    const n = ((a - Math.floor(a)) * 2 - 1) * 0.18;
    return Math.max(-0.4, p1 + p2 + p3 + r1 + slope + n);
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function fallbackTerrainSVG(opts = {}) {
    // Static stylised terrain + route lines for non-WebGL devices
    return `
    <svg class="terrain-fallback-svg" viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="fbSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0d1428"/>
          <stop offset="60%" stop-color="#080d1d"/>
          <stop offset="100%" stop-color="#03050a"/>
        </linearGradient>
        <radialGradient id="fbHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(230,200,121,0.35)"/>
          <stop offset="60%" stop-color="rgba(230,200,121,0.04)"/>
          <stop offset="100%" stop-color="rgba(230,200,121,0)"/>
        </radialGradient>
      </defs>
      <rect width="800" height="1000" fill="url(#fbSky)"/>
      <g stroke="rgba(243,238,223,0.06)" stroke-width="1" fill="none">
        <path d="M0,820 Q200,750 400,780 T800,750"/>
        <path d="M0,720 Q250,610 450,650 T800,610"/>
        <path d="M0,620 Q300,470 500,530 T800,470"/>
        <path d="M0,520 Q350,330 550,420 T800,340"/>
        <path d="M0,420 Q400,210 600,320 T800,220"/>
      </g>
      <circle cx="640" cy="180" r="90" fill="url(#fbHalo)"/>
      <path d="M120,920 Q210,700 290,560" fill="none" stroke="rgba(201,169,97,0.45)" stroke-width="1.6" stroke-dasharray="3 5" stroke-linecap="round"/>
      <circle cx="290" cy="560" r="5" fill="#0a0e18" stroke="#c9a961" stroke-width="1.5"/>
      <circle cx="290" cy="560" r="2.2" fill="#e6c879"/>
      <path d="M200,920 Q330,580 470,400" fill="none" stroke="rgba(201,169,97,0.55)" stroke-width="1.6" stroke-dasharray="3 5" stroke-linecap="round"/>
      <circle cx="470" cy="400" r="5" fill="#0a0e18" stroke="#c9a961" stroke-width="1.5"/>
      <circle cx="470" cy="400" r="2.2" fill="#e6c879"/>
      <path d="M300,920 Q510,500 640,180" fill="none" stroke="rgba(230,200,121,0.8)" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/>
      <circle cx="640" cy="180" r="7" fill="#0a0e18" stroke="#e6c879" stroke-width="2"/>
      <circle cx="640" cy="180" r="3" fill="#e6c879"/>
    </svg>`;
  }

  // Mount the Three.js hero terrain into a container DOM element.
  // Returns { destroy, activateRoute, refresh } or null on fallback.
  function heroTerrain(container, options = {}) {
    if (!container) return null;
    if (!shouldUseWebGL() || !window.THREE) {
      container.innerHTML = fallbackTerrainSVG();
      return { destroy() {}, activateRoute() {}, refresh() {} };
    }

    const THREE = window.THREE;
    const wide = !!options.wide;

    // Setup
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    let W = container.offsetWidth || 800;
    let H = container.offsetHeight || 1000;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);

    const lightTheme = !!options.light;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(lightTheme ? 0xf3edda : 0x06090f, wide ? 14 : 11, wide ? 30 : 26);

    const camera = new THREE.PerspectiveCamera(wide ? 36 : 42, W / H, 0.1, 100);
    if (wide) {
      camera.position.set(0, 5.5, 13);
      camera.lookAt(0, 1, -1);
    } else {
      camera.position.set(0, 7, 12);
      camera.lookAt(0, 1, -0.5);
    }

    // Terrain
    const segments = 84;
    const geom = new THREE.PlaneGeometry(22, 22, segments, segments);
    geom.rotateX(-Math.PI / 2);
    const positions = geom.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      positions.setY(i, elevationAt(x, z));
    }
    geom.computeVertexNormals();

    // Filled base (skipped on light theme so the cream background shows through)
    if (!lightTheme) {
      const fillMat = new THREE.MeshBasicMaterial({
        color: 0x080c18,
        transparent: true,
        opacity: 0.94,
        side: THREE.DoubleSide,
      });
      const fillMesh = new THREE.Mesh(geom, fillMat);
      scene.add(fillMesh);
    }

    // Wireframe — architectural drawing on light, glow on dark
    const wireMat = new THREE.MeshBasicMaterial({
      color: lightTheme ? 0x0c1325 : 0xf3eedf,
      wireframe: true,
      transparent: true,
      opacity: lightTheme ? 0.07 : 0.055,
    });
    const wireMesh = new THREE.Mesh(geom, wireMat);
    scene.add(wireMesh);

    // Gold contour lines — sample horizontal slices at elevation steps
    const contourGroup = new THREE.Group();
    const contourLevels = [0.6, 1.4, 2.2];
    contourLevels.forEach((level) => {
      const segs = [];
      const step = 0.25;
      for (let z = -11; z <= 11; z += step) {
        for (let x = -11; x <= 11; x += step) {
          const a = elevationAt(x, z);
          const b = elevationAt(x + step, z);
          if ((a - level) * (b - level) < 0) {
            const t = (level - a) / (b - a);
            const px = x + step * t;
            segs.push(new THREE.Vector3(px, level + 0.005, z));
          }
        }
      }
      if (segs.length > 1) {
        const cg = new THREE.BufferGeometry().setFromPoints(segs);
        const cm = new THREE.PointsMaterial({
          color: lightTheme ? 0xb48c47 : 0xc9a961,
          size: 0.025,
          transparent: true,
          opacity: lightTheme ? 0.55 : 0.35,
          sizeAttenuation: true,
        });
        contourGroup.add(new THREE.Points(cg, cm));
      }
    });
    scene.add(contourGroup);

    // Routes — three curves, terminate at peak positions
    const peak30 = new THREE.Vector3(-5.5, elevationAt(-5.5, 5.5) + 0.06, 5.5);
    const peak60 = new THREE.Vector3(-2,   elevationAt(-2, -1) + 0.06, -1);
    const peak90 = new THREE.Vector3(5.5,  elevationAt(5.5, -3) + 0.06, -3);

    const routes = [
      {
        label: '30',
        curve: new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(-1, 0.2, 9.5),
          new THREE.Vector3(-3.5, 1.2, 7.2),
          peak30
        ),
      },
      {
        label: '60',
        curve: new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(-1.5, 0.2, 9.5),
          new THREE.Vector3(-2.4, 1.8, 4),
          peak60
        ),
      },
      {
        label: '90',
        curve: new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(2, 0.2, 9.5),
          new THREE.Vector3(3.5, 2.5, 2),
          peak90
        ),
      },
    ];

    const routeObjs = routes.map((r, idx) => {
      const points = r.curve.getPoints(60);
      const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: lightTheme ? (idx === 2 ? 0xb48c47 : 0x8a6a35) : (idx === 2 ? 0xe6c879 : 0xc9a961),
        transparent: true,
        opacity: idx === 2 ? 0.9 : 0.7,
      });
      const line = new THREE.Line(lineGeom, lineMat);
      line.geometry.setDrawRange(0, 0);
      scene.add(line);

      const glowGeom = lineGeom.clone();
      const glowMat = new THREE.LineBasicMaterial({
        color: lightTheme ? 0xb48c47 : 0xe6c879,
        transparent: true,
        opacity: lightTheme ? 0.25 : 0.18,
      });
      const glow = new THREE.Line(glowGeom, glowMat);
      glow.geometry.setDrawRange(0, 0);
      scene.add(glow);

      const endPt = r.curve.getPoint(1);
      const markerGeom = new THREE.SphereGeometry(0.1, 16, 16);
      const markerMat = new THREE.MeshBasicMaterial({ color: lightTheme ? 0xb48c47 : 0xf0d68c });
      const marker = new THREE.Mesh(markerGeom, markerMat);
      marker.position.copy(endPt);
      marker.scale.set(0, 0, 0);
      scene.add(marker);

      const haloGeom = new THREE.SphereGeometry(0.32, 16, 16);
      const haloMat = new THREE.MeshBasicMaterial({
        color: lightTheme ? 0xb48c47 : 0xc9a961,
        transparent: true,
        opacity: lightTheme ? 0.28 : 0.18,
      });
      const halo = new THREE.Mesh(haloGeom, haloMat);
      halo.position.copy(endPt);
      halo.scale.set(0, 0, 0);
      scene.add(halo);

      return { line, glow, marker, halo, points };
    });

    // Animation
    const startTime = performance.now();
    let lastFrame = startTime;
    let rotationY = 0;
    let scrollOffset = 0;
    let mouseX = 0;
    let activeMask = options.activateOnLoad === false ? [false, false, false] : [true, true, true];
    let routeActivations = [
      options.activateOnLoad === false ? null : 0,
      options.activateOnLoad === false ? null : 600,
      options.activateOnLoad === false ? null : 1200,
    ];

    function onMouseMove(e) {
      mouseX = ((e.clientX / window.innerWidth) - 0.5) * 0.04;
    }
    function onScroll() {
      scrollOffset = Math.min(1, (window.scrollY || 0) / 800);
    }
    function onResize() {
      W = container.offsetWidth || W;
      H = container.offsetHeight || H;
      renderer.setSize(W, H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    let rafId = null;
    function animate(now) {
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;
      const elapsed = now - startTime;

      // Route progressive draw
      const drawDur = 1000;
      routeObjs.forEach((r, i) => {
        const start = routeActivations[i];
        if (start == null) {
          r.line.geometry.setDrawRange(0, 0);
          r.glow.geometry.setDrawRange(0, 0);
          r.marker.scale.set(0, 0, 0);
          r.halo.scale.set(0, 0, 0);
          return;
        }
        const localElapsed = (performance.now() - r._activatedAt) || (elapsed - start);
        const t = Math.max(0, Math.min(1, localElapsed / drawDur));
        const eased = easeOutCubic(t);
        const segCount = Math.floor(eased * 60);
        r.line.geometry.setDrawRange(0, segCount * 2);
        r.glow.geometry.setDrawRange(0, segCount * 2);
        const mT = Math.max(0, Math.min(1, (localElapsed - drawDur * 0.7) / 400));
        const ms = easeOutBack(mT);
        r.marker.scale.set(ms, ms, ms);
        r.halo.scale.set(mT * 1.5, mT * 1.5, mT * 1.5);
      });

      rotationY += dt * (wide ? 0.025 : 0.035);
      scene.rotation.y = rotationY * 0.18 + mouseX;
      scene.rotation.x = scrollOffset * -0.08;

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    }

    // Begin loop
    if (options.activateOnLoad !== false) {
      routeObjs.forEach((r, i) => { r._activatedAt = performance.now() + i * 600; });
    }
    rafId = requestAnimationFrame(animate);

    function activateRoute(index) {
      if (index < 0 || index >= routeObjs.length) return;
      if (routeActivations[index] != null) return;
      routeActivations[index] = performance.now() - startTime;
      routeObjs[index]._activatedAt = performance.now();
    }

    function destroy() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }

    return { destroy, activateRoute, refresh: onResize };
  }

  // -----------------------------------------------------------------
  // v7 — Architectural peak SVG (replaces the routes terrain on light)
  // A horizontal architectural rendering: 5 contour passes, three
  // route lines climbing to terminal markers. Dark navy lines on
  // cream — like a behavioural blueprint.
  // -----------------------------------------------------------------
  function architecturalPeak() {
    return `
    <svg viewBox="0 0 1600 600" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="apFog" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(180, 140, 71, 0)"/>
          <stop offset="100%" stop-color="rgba(180, 140, 71, 0.08)"/>
        </linearGradient>
      </defs>

      <!-- Contour passes — light architectural style -->
      <g fill="none" stroke="#0c1325" stroke-width="1" stroke-opacity="0.08">
        <path d="M0,560 Q200,500 400,510 T800,490 T1200,500 T1600,490"/>
        <path d="M0,500 Q200,420 420,430 T820,400 T1200,410 T1600,400"/>
        <path d="M0,440 Q220,340 460,360 T860,310 T1200,330 T1600,320"/>
        <path d="M0,380 Q260,250 520,280 T920,230 T1240,240 T1600,250"/>
        <path d="M0,320 Q300,150 600,200 T1000,140 T1280,160 T1600,170"/>
        <path d="M0,260 Q340,80 680,130 T1080,60 T1340,80 T1600,100"/>
      </g>

      <!-- Underlying peak silhouette (very subtle) -->
      <path d="M0,600 L0,560 Q200,500 400,510 T780,490 Q900,440 1060,300 Q1180,180 1240,80 L1280,40 L1320,100 Q1420,260 1520,460 Q1560,520 1600,540 L1600,600 Z"
            fill="rgba(180,140,71,0.04)" stroke="#0c1325" stroke-opacity="0.18" stroke-width="1.2"/>

      <!-- Atmospheric fog -->
      <rect x="0" y="400" width="1600" height="200" fill="url(#apFog)"/>

      <!-- Route 30 — terminates lower elevation -->
      <path d="M 240 580 Q 380 520 480 460 T 620 380" fill="none"
            stroke="#b48c47" stroke-width="1.6" stroke-dasharray="3 5" stroke-linecap="round"
            stroke-opacity="0.65"/>
      <circle cx="620" cy="380" r="6" fill="#f6f1e5" stroke="#b48c47" stroke-width="1.8"/>
      <circle cx="620" cy="380" r="2.4" fill="#b48c47"/>
      <text x="640" y="385" font-family="'JetBrains Mono', monospace" font-size="10" letter-spacing="1.6" fill="#b48c47" font-weight="600">30 · FIRST RESET</text>

      <!-- Route 60 — mid elevation -->
      <path d="M 220 580 Q 400 460 560 360 T 880 240" fill="none"
            stroke="#b48c47" stroke-width="1.8" stroke-dasharray="3 5" stroke-linecap="round"
            stroke-opacity="0.78"/>
      <circle cx="880" cy="240" r="7" fill="#f6f1e5" stroke="#b48c47" stroke-width="2"/>
      <circle cx="880" cy="240" r="2.6" fill="#b48c47"/>
      <text x="900" y="246" font-family="'JetBrains Mono', monospace" font-size="10" letter-spacing="1.6" fill="#b48c47" font-weight="600">60 · CONSISTENCY</text>

      <!-- Route 90 — to summit -->
      <path d="M 200 580 Q 440 420 720 280 T 1280 40" fill="none"
            stroke="#8a6a35" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"
            stroke-opacity="0.92"/>
      <circle cx="1280" cy="40" r="10" fill="none" stroke="#b48c47" stroke-width="1.4" stroke-opacity="0.4"/>
      <circle cx="1280" cy="40" r="7" fill="#f6f1e5" stroke="#8a6a35" stroke-width="2"/>
      <circle cx="1280" cy="40" r="3" fill="#8a6a35"/>
      <text x="1300" y="46" font-family="'JetBrains Mono', monospace" font-size="10" letter-spacing="1.6" fill="#8a6a35" font-weight="700">90 · THE NEW STANDARD</text>
    </svg>`;
  }

  // -----------------------------------------------------------------
  // v6 — Behavioural Intelligence Map (SVG, lives in Section 06)
  // -----------------------------------------------------------------
  function behaviouralIntelligenceMap() {
    const cx = 300, cy = 300, R = 220;
    const labels = [
      'CONFIDENCE', 'COMMUNICATION', 'SELF-AWARENESS', 'HABITS',
      'CHOICES', 'ENVIRONMENT', 'RELATIONSHIPS', 'LEADERSHIP PRESENCE',
    ];
    const pts = labels.map((_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI / 4);
      return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a, idx: i };
    });
    // Irregular inner polygon — "current standard"
    const innerR = [0.62, 0.50, 0.56, 0.42, 0.50, 0.36, 0.46, 0.55];
    const innerPts = labels.map((_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI / 4);
      const r = R * innerR[i];
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });

    let rings = '';
    for (let i = 5; i >= 1; i--) {
      const radius = R * (i / 5);
      const opacity = 0.05 + (i * 0.025);
      rings += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="rgba(201,169,97,${opacity.toFixed(3)})" stroke-width="${i === 5 ? 1.2 : 1}"/>`;
    }

    const spokes = pts.map(p =>
      `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="rgba(243,238,223,0.07)" stroke-width="1"/>`
    ).join('');

    const innerPath = innerPts.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ') + ' Z';

    const nodesAndLabels = pts.map((p, i) => {
      const offset = 28;
      const lx = p.x + Math.cos(p.a) * offset;
      const ly = p.y + Math.sin(p.a) * offset;
      let anchor = 'middle';
      if (p.x < cx - 40) anchor = 'end';
      else if (p.x > cx + 40) anchor = 'start';
      const dy = Math.abs(p.y - cy) < 20 ? 4 : (p.y > cy ? 14 : -2);
      return `
        <g class="bim-node" data-idx="${i}" style="transform-origin: ${p.x}px ${p.y}px;">
          <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="#e6c879"/>
          <circle cx="${p.x}" cy="${p.y}" r="11" fill="none" stroke="rgba(201,169,97,0.28)" stroke-width="1"/>
        </g>
        <text x="${lx}" y="${ly + dy}" text-anchor="${anchor}" font-family="'JetBrains Mono', monospace" font-size="10" letter-spacing="2" fill="rgba(243,238,223,0.78)" font-weight="500">${labels[i]}</text>
      `;
    }).join('');

    return `
    <svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="bimBg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(201,169,97,0.08)"/>
          <stop offset="60%" stop-color="rgba(201,169,97,0.015)"/>
          <stop offset="100%" stop-color="rgba(201,169,97,0)"/>
        </radialGradient>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="${R + 20}" fill="url(#bimBg)"/>
      ${rings}
      ${spokes}
      <g class="bim-pulse">
        <path d="${innerPath}" fill="rgba(201,169,97,0.12)" stroke="#c9a961" stroke-width="1.4" stroke-opacity="0.7"/>
      </g>
      <circle cx="${cx}" cy="${cy}" r="3" fill="#c9a961"/>
      <text x="${cx}" y="${cy + 22}" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" letter-spacing="2.5" fill="rgba(201,169,97,0.75)">YOUR STANDARD</text>
      ${nodesAndLabels}
    </svg>`;
  }

  // -----------------------------------------------------------------
  // v6 — Homepage observers
  // -----------------------------------------------------------------
  function setupV6Observers() {
    if (!document.body.classList.contains('light-theme')) return;

    // Hero topbar — appears when scrolled past hero
    const topbar = document.getElementById('topbar') || document.querySelector('.topbar');
    const hero = document.querySelector('.hero-v6');
    if (topbar && hero) {
      document.body.classList.add('dark-hero-active');
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.intersectionRatio < 0.25) {
            topbar.classList.add('is-visible');
            document.body.classList.remove('dark-hero-active');
          } else {
            topbar.classList.remove('is-visible');
            document.body.classList.add('dark-hero-active');
          }
        });
      }, { threshold: [0, 0.25, 1] });
      io.observe(hero);
    }

    // Cost lines — left-rule grows
    const costRows = document.querySelectorAll('.cost-rebuilt .cost-row');
    if (costRows.length) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.4 });
      costRows.forEach(r => io.observe(r));
    }

    // Cost scan gauge — marker glides with scroll
    const gauge = document.querySelector('.scan-gauge');
    const gaugeMarker = gauge ? gauge.querySelector('.marker') : null;
    const costBlock = document.querySelector('.cost-rebuilt');
    if (gauge && gaugeMarker && costBlock) {
      const onScroll = () => {
        const rect = costBlock.getBoundingClientRect();
        const vp = window.innerHeight;
        const total = rect.height + vp;
        const seen = vp - rect.top;
        const ratio = Math.max(0, Math.min(1, seen / total));
        gaugeMarker.style.top = (14 + ratio * 72) + '%';
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    // Shift pairs (Day 0 → Day 90) — fade with stagger inside row
    const shiftPairs = document.querySelectorAll('.shift-pair');
    if (shiftPairs.length) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.3 });
      shiftPairs.forEach(p => io.observe(p));
    }

    // Product stage reveal
    const productStage = document.querySelector('.product-stage');
    if (productStage) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            productStage.classList.add('in');
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.25 });
      io.observe(productStage);
    }

    // Routes — sequential activation (3.5s total)
    const routeCards = document.querySelectorAll('.route-glass');
    const routesSection = document.querySelector('.routes-stage');
    if (routeCards.length && routesSection) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            routeCards.forEach((c, i) => {
              setTimeout(() => c.classList.add('in'), i * 1100);
            });
            // also activate the hero terrain routes if visible
            if (window.__lwaTerrain && typeof window.__lwaTerrain.activateRoute === 'function') {
              // optional bridge
            }
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.35 });
      io.observe(routesSection);
    }

    // Intelligence Map — sequential node pulse every 8s, rotating through 8
    const bimNodes = document.querySelectorAll('.bim-node');
    if (bimNodes.length) {
      let idx = 0;
      const pulse = () => {
        bimNodes.forEach(n => n.classList.remove('pulse'));
        const n = bimNodes[idx];
        if (n) n.classList.add('pulse');
        idx = (idx + 1) % bimNodes.length;
      };
      // start once map enters viewport
      const map = document.querySelector('.bim-map');
      if (map) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach(e => {
            if (e.isIntersecting) {
              pulse();
              setInterval(pulse, 1800);
              io.unobserve(e.target);
            }
          });
        }, { threshold: 0.3 });
        io.observe(map);
      }
    }
  }

  // ---------- public ----------
  return {
    PATTERNS, SCORE_AREAS, SUB_TAGS, STAGES, PROGRAMMES,
    ASSESSMENT_ITEMS, CHALLENGE_LIBRARY, GOLDEN_LIBRARY,
    load, save, clear, ns,
    generatePatternProfile, createSummit, pickPatternBreaker,
    logBreakerCompletion, bumpProgress, submitReflection, seedDemoIfEmpty,
    submitAssessmentToBackend, generatePatternProfileApi, startCheckout,
    assignPatternBreaker, assignGoldenChallenge, submitReflectionApi,
    updateProgress, submitWitnessedRep, updatePatternFrequency,
    exportUserData, deleteUserData,
    setupReveal, setActiveNav, topbar, footer,
    mountainSVG, heroMountain, routesMountain, domainsDiagram,
    setupHomepageObservers,
    // v6
    heroTerrain, behaviouralIntelligenceMap, setupV6Observers, shouldUseWebGL,
    // v7
    architecturalPeak,
  };
})();

// Auto-mount topbar/footer if placeholders exist
document.addEventListener('DOMContentLoaded', () => {
  const tb = document.querySelector('[data-topbar]');
  const ft = document.querySelector('[data-footer]');
  const file = (location.pathname.split('/').pop() || 'index.html');
  if (tb) tb.outerHTML = PtP.topbar(file);
  if (ft) ft.outerHTML = PtP.footer();
  PtP.setActiveNav('./' + file);
  PtP.setupReveal();
  PtP.setupHomepageObservers();
  if (typeof PtP.setupV6Observers === 'function') PtP.setupV6Observers();
});
