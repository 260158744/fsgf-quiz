/* ===== 模拟考试模块 · 组卷 / 计时 / 交卷 / 薄弱章节报告 =====
 * 纯逻辑(assemble/grade/resolveAnswer)与DOM渲染分离，便于无头自测。
 * 判分答案来源：离线答案库 OFFLINE_BANK（经 DB.getOfflineBank() 归一化） → 题面内嵌 a(IMA题) → 均为本地，无需后端。
 */
const Exam = (() => {
  const Q = () => (window.QUESTIONS || []);
  const ALL = () => (window.QUESTIONS_ALL || window.QUESTIONS || []);
  let state = null;          // {setup, paper, idx, answers, timeLimit, timeLeft, timer, started, finished, lastResult}
  let _offlineMap = null;

  function buildOfflineMap() {
    if (_offlineMap) return _offlineMap;
    // ★ 统一走 DB.getOfflineBank()：兼容 v3 的 {id:答案} 对象映射(OFFLINE_BANK)
    //   与旧版 [{id,a}] 数组(QUESTIONS_OFFLINE / QUESTIONS_OFFLINE_ALL)。
    let bank = (typeof DB !== 'undefined' && DB.getOfflineBank) ? DB.getOfflineBank() : null;
    if (!bank) {
      const cand = window.OFFLINE_BANK;
      if (cand && typeof cand === 'object' && !Array.isArray(cand)) bank = cand;
    }
    if (!bank) return {};       // 未就绪时不缓存，等下次再取
    _offlineMap = bank;
    return bank;
  }
  // ★ 统一答案解析：离线镜像优先，其次题面内嵌 a(IMA题)
  function resolveAnswer(q) {
    const map = buildOfflineMap();
    if (q && map[q.id]) return map[q.id];
    if (q && q.a) return q.a;
    return null;
  }

  // ---------- 组卷 ----------
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }
  function expandGroups(qs) {
    const out = []; const added = new Set();
    for (const q of qs) {
      if (q.gid) { if (added.has(q.gid)) continue; added.add(q.gid); out.push(...Q().filter(x => x.gid === q.gid)); }
      else out.push(q);
    }
    return out;
  }
  // 按大纲模块权重(3:5:2)与题型比例组卷；模块题量不足时全局补足到 total（共用题干整组加入，不切断）
  function assemble(total, level) {
    const pool = ALL().filter(q => (q.bk || '副高') === level);
    if (!pool.length) return [];
    if (pool.length <= total) return expandGroups(shuffle(pool));
    const groupMembers = {};
    pool.forEach(q => { if (q.gid) (groupMembers[q.gid] = groupMembers[q.gid] || []).push(q); });
    const used = new Set();
    const out = [];
    // 加入单题/整组；返回实际加入数量
    const addQ = (q) => {
      if (q.gid) {
        if (used.has(q.gid + '#grp')) return 0;
        used.add(q.gid + '#grp');
        const mem = groupMembers[q.gid] || [q];
        mem.forEach(x => { if (!used.has(x.id)) { out.push(x); used.add(x.id); } });
        return mem.length;
      }
      if (used.has(q.id)) return 0;
      out.push(q); used.add(q.id); return 1;
    };
    const byMod = { '专业知识': 0.3, '专业实践能力': 0.5, '学科新进展': 0.2 };
    const ratios = [0.45, 0.25, 0.15, 0.15];
    const types = ['单选题', '多选题', '共用题干题', '案例分析题'];
    for (const mod in byMod) {
      let need = Math.round(total * byMod[mod]);
      const modPool = shuffle(pool.filter(q => q.m === mod && !used.has(q.id) && !used.has((q.gid || '') + '#grp')));
      for (let ti = 0; ti < types.length; ti++) {
        const want = Math.round(need * ratios[ti]);
        const cands = shuffle(modPool.filter(q => q.t === types[ti]));
        for (const q of cands) {
          if (need <= 0) break;
          const cost = (q.gid && !used.has(q.gid + '#grp')) ? (groupMembers[q.gid] || [q]).length : (used.has(q.id) ? 0 : 1);
          if (cost > need) continue;
          const added = addQ(q); if (added) need -= added;
        }
        if (need <= 0) break;
      }
      const rest = shuffle(modPool.filter(q => !used.has(q.id) && !used.has((q.gid || '') + '#grp')));
      for (const q of rest) {
        if (need <= 0) break;
        const cost = (q.gid && !used.has(q.gid + '#grp')) ? (groupMembers[q.gid] || [q]).length : (used.has(q.id) ? 0 : 1);
        if (cost > need) continue;
        const added = addQ(q); if (added) need -= added;
      }
    }
    // 全局补足到 total（优先单题，再整组；保证整组不切断）
    let remain = total - out.length;
    if (remain > 0) {
      const singles = shuffle(pool.filter(q => !used.has(q.id) && !q.gid));
      for (const q of singles) { if (remain <= 0) break; remain -= addQ(q); }
      if (remain > 0) {
        const groups = shuffle(pool.filter(q => q.gid && !used.has(q.gid + '#grp')));
        for (const q of groups) {
          if (remain <= 0) break;
          const cost = (groupMembers[q.gid] || [q]).length;
          if (cost > remain) continue;
          remain -= addQ(q);
        }
      }
    }
    return out;
  }

  // ---------- 判分 ----------
  function isMulti(q) { return q.t === '多选题' || ((q.t === '案例分析题' || q.t === '共用题干题') && q.mk === 1); }
  function grade(paper, answers) {
    let full = 0, partial = 0, zero = 0, totalScore = 0;
    const wrongUnits = {};
    const details = paper.map((q, i) => {
      const correct = resolveAnswer(q);
      const userAns = (answers[i] || '').toUpperCase();
      if (!correct) { zero++; return { qid: q.id, ok: false, level: 'unknown', correct: null, userAns, unit: q.u }; }
      let level, pct, ok;
      if (userAns === correct) { level = 'full'; pct = 100; ok = true; full++; totalScore += 2; }
      else if (isMulti(q)) {
        if (!userAns) { level = 'zero'; pct = 0; ok = false; zero++; }
        else {
          const cs = new Set(correct.split('')), us = new Set(userAns.split(''));
          const hasWrong = [...us].some(k => !cs.has(k));
          if (hasWrong) { level = 'zero'; pct = 0; ok = false; zero++; }
          else { level = 'partial'; pct = 50; ok = false; partial++; totalScore += 1; }
        }
      } else { level = 'zero'; pct = 0; ok = false; zero++; }
      if (!ok && q.u) wrongUnits[q.u] = (wrongUnits[q.u] || 0) + 1;
      return { qid: q.id, ok, level, correct, userAns, unit: q.u };
    });
    const total = paper.length;
    const maxScore = total * 2;
    const scoreRate = maxScore ? Math.round(totalScore / maxScore * 100) : 0;
    const correctRate = total ? Math.round(full / total * 100) : 0;
    const weak = Object.entries(wrongUnits).sort((a, b) => b[1] - a[1])
      .map(([u, n]) => ({ u, n, name: (ALL().find(x => x.u === u) || {}).un || u }));
    return { total, full, partial, zero, totalScore, maxScore, scoreRate, correctRate, passed: scoreRate >= 60, details, weak };
  }

  function fmtTime(s) { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function main() { return document.getElementById('main'); }
  function cleanup() {
    if (state && state.timer) { clearInterval(state.timer); state.timer = null; }
  }
  function reset() { cleanup(); state = null; }

  // ---------- 设置面板 ----------
  function open() {
    cleanup(); state = null;
    const q = Q();
    if (!q.length) return '<div class="empty-state"><div class="es-ico">📝</div><p>题库为空，无法组卷</p></div>';
    state = { setup: { level: window.App && window.App.getSection ? window.App.getSection() : '副高', count: 50, time: 'auto' }, paper: null, idx: 0, answers: [], timeLimit: 0, timeLeft: 0, timer: null, started: false, finished: false, lastResult: null };
    return renderSetup();
  }
  function renderSetup() {
    const st = state.setup;
    const lv = (l) => `data-lv="${l}" class="exam-chip ${st.level === l ? 'on' : ''}" onclick="Exam.setLevel('${l}')"`;
    const ct = (n) => `data-ct="${n}" class="exam-chip ${st.count === n ? 'on' : ''}" onclick="Exam.setCount(${n})"`;
    const tm = (v, label) => `data-tm="${v}" class="exam-chip ${st.time === v ? 'on' : ''}" onclick="Exam.setTime('${v}')"`;
    const html = `
    <div class="page-head"><h1>📝 模拟考试</h1><p>全真组卷 · 限时计时 · 交卷出分 · 薄弱章节定位</p></div>
    <div class="exam-setup">
      <div class="exam-sec">
        <div class="exam-sec-title">① 考试板块</div>
        <div class="exam-chips">
          <button ${lv('副高')}>副高（副主任技师）</button>
          <button ${lv('正高')}>正高（主任技师）</button>
        </div>
      </div>
      <div class="exam-sec">
        <div class="exam-sec-title">② 题目数量</div>
        <div class="exam-chips">
          <button ${ct(30)}>30 题</button>
          <button ${ct(50)}>50 题</button>
          <button ${ct(80)}>80 题</button>
          <button ${ct(100)}>100 题</button>
        </div>
      </div>
      <div class="exam-sec">
        <div class="exam-sec-title">③ 考试时长</div>
        <div class="exam-chips">
          <button ${tm('auto', '智能')}>智能</button>
          <button ${tm('30', '30分')}>30 分钟</button>
          <button ${tm('45', '45分')}>45 分钟</button>
          <button ${tm('60', '60分')}>60 分钟</button>
          <button ${tm('90', '90分')}>90 分钟</button>
        </div>
      </div>
      <div class="exam-tip">💡 组卷按大纲权重（专业知识30% / 专业实践50% / 学科新进展20%）与真实题型比例分布；多选题/案例题按“少选得半分、错选0分”规则计分。</div>
      <button class="btn btn-primary btn-lg" style="margin-top:8px" onclick="Exam.startExam()">🚀 开始考试</button>
    </div>`;
    if (main()) main().innerHTML = html;
    return html;
  }
  function setLevel(l) { if (state) { state.setup.level = l; renderSetup(); } }
  function setCount(n) { if (state) { state.setup.count = n; renderSetup(); } }
  function setTime(v) { if (state) { state.setup.time = v; renderSetup(); } }

  // ---------- 开始考试 ----------
  function startExam() {
    const st = state.setup;
    const paper = assemble(st.count, st.level);
    if (!paper.length) { if (window.App) window.App.toast('该板块题目不足，无法组卷'); return; }
    let timeMin;
    if (st.time === 'auto') timeMin = Math.max(20, Math.round(paper.length * 1.1));
    else timeMin = parseInt(st.time, 10);
    state.paper = paper;
    state.answers = new Array(paper.length).fill('');
    state.idx = 0;
    state.timeLimit = timeMin * 60;
    state.timeLeft = timeMin * 60;
    state.started = true; state.finished = false;
    startTimer();
    renderExam();
  }
  function startTimer() {
    cleanup();
    state.timer = setInterval(() => {
      state.timeLeft--;
      const tEl = document.getElementById('examClock');
      if (tEl) { tEl.textContent = fmtTime(state.timeLeft); tEl.classList.toggle('danger', state.timeLeft <= 60); }
      if (state.timeLeft <= 0) { cleanup(); submitExam(true); }
    }, 1000);
  }

  // ---------- 考试进行中 ----------
  function renderExam() {
    const p = state.paper, idx = state.idx, q = p[idx];
    if (!q) return;
    const isMultiQ = isMulti(q);
    const sel = new Set((state.answers[idx] || '').split(''));
    const dmap = { '易': 'tag-easy', '中': 'tag-mid', '难': 'tag-hard' };
    let groupBlock = '';
    if (q.gid) { groupBlock = q.gs ? `<div class="group-stem"><b>📋 共用题干</b>：${esc(q.gs)}</div>` : `<div class="group-stem-ref">※ 共用题干：见本组首题</div>`; }
    const optsHtml = 'ABCDE'.split('').map(k => {
      if (!q.o || !q.o[k]) return '';
      return `<div class="opt ${isMultiQ ? 'multi-mode' : 'single-mode'} ${sel.has(k) ? 'selected' : ''}" data-k="${k}" onclick="Exam.toggle('${k}')">
        <div class="opt-key">${isMultiQ ? '' : k}</div><div class="opt-text">${esc(q.o[k])}</div></div>`;
    }).join('');
    const navHtml = p.map((qq, i) => {
      const answered = !!state.answers[i];
      const cls = i === idx ? 'cur' : (answered ? 'done' : '');
      return `<button class="exam-nav-item ${cls}" onclick="Exam.goto(${i})">${i + 1}</button>`;
    }).join('');
    const html = `
    <div class="exam-wrap">
      <div class="exam-top">
        <div class="exam-top-l">
          <button class="icon-btn" onclick="Exam.confirmExit()" title="退出">✕</button>
          <span class="exam-badge">${esc(state.setup.level)}模考</span>
          <span class="muted">第 ${idx + 1} / ${p.length} 题</span>
        </div>
        <div class="exam-top-r">
          <span class="exam-clock ${state.timeLeft <= 60 ? 'danger' : ''}" id="examClock">${fmtTime(state.timeLeft)}</span>
          <button class="btn btn-danger btn-sm" onclick="Exam.submitExam()">交卷</button>
        </div>
      </div>
      <div class="exam-qmeta">
        <span class="tag tag-type">${esc(q.t)}</span>
        <span class="tag ${dmap[q.d] || ''}">${esc(q.d)}</span>
        <span class="tag tag-cog">${esc(q.c)}</span>
        <span class="tag tag-module">${esc(q.un)}</span>
      </div>
      ${groupBlock}
      <div class="qstem">${esc(q.s)}</div>
      <div class="opts">${optsHtml}</div>
      <div class="exam-nav">
        <div class="exam-nav-head">题号导航（绿=已答）</div>
        <div class="exam-nav-grid">${navHtml}</div>
      </div>
      <div class="exam-foot">
        <button class="btn btn-ghost" ${idx === 0 ? 'disabled' : ''} onclick="Exam.prev()">← 上一题</button>
        <button class="btn btn-primary" ${idx === p.length - 1 ? 'disabled' : ''} onclick="Exam.next()">下一题 →</button>
      </div>
    </div>`;
    if (main()) main().innerHTML = html;
  }
  function toggle(k) {
    if (!state || state.finished) return;
    const q = state.paper[state.idx];
    const isMultiQ = isMulti(q);
    let cur = (state.answers[state.idx] || '').split('').filter(Boolean);
    if (isMultiQ) {
      const i = cur.indexOf(k);
      if (i >= 0) cur.splice(i, 1); else cur.push(k);
    } else { cur = [k]; }
    cur.sort();
    state.answers[state.idx] = cur.join('');
    renderExam();
  }
  function goto(i) { if (state && i >= 0 && i < state.paper.length) { state.idx = i; renderExam(); } }
  function prev() { if (state && state.idx > 0) { state.idx--; renderExam(); } }
  function next() { if (state && state.idx < state.paper.length - 1) { state.idx++; renderExam(); } }

  function confirmExit() {
    if (window.confirm('确定退出本次模拟考试？已作答内容将不计入成绩。')) { reset(); if (window.App) window.App.go('dashboard'); }
  }

  // ---------- 交卷 ----------
  function submitExam(auto) {
    if (!state || !state.paper) return;
    const unanswered = state.answers.filter(a => !a).length;
    if (!auto && unanswered > 0) {
      if (!window.confirm(`还有 ${unanswered} 题未作答，确定交卷？`)) return;
    }
    cleanup();
    const res = grade(state.paper, state.answers);
    state.finished = true; state.lastResult = res;
    // 计入学习记录（错题进错题本、能力图谱）
    try {
      for (let i = 0; i < state.paper.length; i++) {
        const q = state.paper[i], d = res.details[i];
        DB.addRecord({ qid: q.id, u: q.u, c: q.c, t: q.t, d: q.d, ok: d.ok, userAns: d.userAns, at: new Date().toISOString(), dur: 0 });
      }
    } catch (e) { }
    DB.addSession({ mode: 'exam', start: Date.now() - state.timeLimit * 1000, dur: state.timeLimit - state.timeLeft, total: res.total, correct: res.full, xp: 0, ts: Date.now() });
    renderReport(res);
  }

  function renderReport(res) {
    const grade = res.scoreRate >= 85 ? '优秀' : res.scoreRate >= 60 ? '通过' : '加油';
    const gc = res.scoreRate >= 60 ? 'var(--success)' : 'var(--warn)';
    const weakHtml = res.weak.length
      ? res.weak.slice(0, 5).map(w => `<span class="weak-tag">${esc(w.name)} <b>${w.n}</b></span>`).join('')
      : '<span class="muted">无 · 全部掌握 🎉</span>';
    const wrongIds = res.details.filter(d => d.level !== 'full' && d.level !== 'unknown').map(d => d.qid);
    const html = `
    <div class="page-head"><h1>📊 模拟考试报告</h1><p>${esc(state.setup.level)} · ${res.total} 题 · 限时 ${Math.round(state.timeLimit / 60)} 分钟</p></div>
    <div class="exam-report">
      <div class="exam-grade" style="color:${gc}">${grade}</div>
      <div class="exam-grade-sub">${res.passed ? '🎉 达到合格线（得分率≥60%）' : '⚠️ 未达合格线，继续加油'}</div>
      <div class="grid grid-3" style="margin:18px 0">
        <div class="stat-card"><div class="sc-val" style="color:${gc}">${res.scoreRate}%</div><div class="sc-label">得分率</div></div>
        <div class="stat-card"><div class="sc-val">${res.totalScore}/${res.maxScore}</div><div class="sc-label">总得分</div></div>
        <div class="stat-card"><div class="sc-val">${Math.floor((state.timeLimit - state.timeLeft) / 60)}'${('0' + ((state.timeLimit - state.timeLeft) % 60)).slice(-2)}"</div><div class="sc-label">用时</div></div>
      </div>
      <div class="stat-card" style="margin-bottom:16px">
        <div style="font-size:13px;color:var(--text-2);margin-bottom:8px">📊 得分明细</div>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <span style="color:var(--success);font-weight:700">✓ 全对 ${res.full}</span>
          <span style="color:var(--warn);font-weight:700">△ 部分 ${res.partial}</span>
          <span style="color:var(--danger);font-weight:700">✗ 错误 ${res.zero}</span>
        </div>
      </div>
      <div class="exam-weak">
        <div class="exam-weak-title">💪 薄弱章节（建议重点突破）</div>
        <div class="exam-weak-tags">${weakHtml}</div>
      </div>
      <div class="exam-report-actions">
        ${wrongIds.length ? `<button class="btn btn-outline" onclick="Exam.reviewWrong(${JSON.stringify(wrongIds)})">📕 复习本场错题(${wrongIds.length})</button>` : ''}
        <button class="btn btn-ghost" onclick="Exam.startExam()">🔄 再来一套</button>
        <button class="btn btn-primary" onclick="Exam.exitExam()">返回首页</button>
      </div>
    </div>`;
    if (main()) main().innerHTML = html;
    if (window.App) window.App.toast(auto ? '⏰ 时间到，已自动交卷' : '已交卷');
  }
  function reviewWrong(ids) {
    if (!ids || !ids.length) return;
    if (window.Quiz) window.Quiz.start('free', { ids: ids, count: ids.length });
  }
  function exitExam() { reset(); if (window.App) window.App.go('dashboard'); }

  return {
    open, cleanup, reset,
    setLevel, setCount, setTime, startExam,
    toggle, goto, prev, next, confirmExit, submitExam,
    reviewWrong, exitExam,
    renderReport,
    // ★ 测试用纯接口
    assemble, grade, resolveAnswer, isMulti,
    _state: () => state
  };
})();

// ★ 顶层 const 不会成为 window 属性；显式挂载，
//   供其它模块的 `window.Exam && ...` 兼容判断与内联 onclick 使用。
window.Exam=Exam;
