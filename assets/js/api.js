/* ===== API 客户端 · 后端通信 ===== */
const API = (() => {
  const BASE = '';  // 同源部署时为空，跨域时填后端地址

  let _token = null;
  let _shareCode = null;

  function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (_token) h['Authorization'] = 'Bearer ' + _token;
    return h;
  }

  async function request(method, path, body) {
    const opts = { method, headers: headers() };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(BASE + '/api' + path, opts);
      const data = await res.json();
      if (!data.ok && res.status === 401) {
        // Token 过期，跳转登录
        _token = null;
        localStorage.removeItem(User.tokenKey());
        if (window.App && window.App.showLock) window.App.showLock();
      }
      return data;
    } catch (err) {
      console.error('[API]', method, path, err);
      return { ok: false, error: '网络连接失败，请检查网络' };
    }
  }

  // ── 认证 ──
  async function login(password) {
    // 检查是否是分享码模式
    const sc = new URLSearchParams(location.search).get('share');
    if (sc) {
      const r = await request('POST', '/auth/login', {
        mode: 'share', code: sc, password: password || ''
      });
      if (r.ok) { setToken(r.token); _shareCode = sc; }
      return r;
    }
    // 全局密码模式
    const r = await request('POST', '/auth/login', {
      mode: 'password', password
    });
    if (r.ok) setToken(r.token);
    return r;
  }

  async function adminLogin(username, password) {
    const r = await request('POST', '/auth/login', {
      mode: 'admin', username, password
    });
    if (r.ok) setToken(r.token);
    return r;
  }

  async function checkSession() {
    return request('GET', '/auth/session');
  }

  function setToken(t) {
    _token = t;
    localStorage.setItem(User.tokenKey(), t);
  }

  function restoreToken() {
    _token = localStorage.getItem(User.tokenKey());
    return !!_token;
  }

  function logout() {
    _token = null;
    _shareCode = null;
    localStorage.removeItem(User.tokenKey());
  }

  function getToken() { return _token; }
  function getShareCode() { return _shareCode; }

  // ── 题库（无答案）──
  async function getQuestions(params = {}) {
    const qs = new URLSearchParams();
    if (params.unit) qs.set('unit', params.unit);
    if (params.difficulty) qs.set('difficulty', params.difficulty);
    if (params.type) qs.set('type', params.type);
    if (params.cognitive) qs.set('cognitive', params.cognitive);
    if (params.keyword) qs.set('keyword', params.keyword);
    if (params.ids) qs.set('ids', params.ids);
    if (params.count) qs.set('count', params.count);
    return request('GET', '/questions?' + qs.toString());
  }

  async function getQuestion(qid) {
    return request('GET', '/questions/' + qid);
  }

  async function getQuestionCount() {
    return request('GET', '/questions/count');
  }

  // ── 答题（答案后端验证）──
  async function submitAnswer(qid, answer, options = {}) {
    return request('POST', '/submit', {
      question_id: qid,
      answer: answer,
      mode: options.mode || 'free',
      time_spent: options.timeSpent || 0,
      need_explanation: true  // 答完后返回解析
    });
  }

  async function submitBatch(answers, mode) {
    return request('POST', '/submit/batch', { answers, mode });
  }

  // ── 统计（数据隔离）──
  async function statsOverview() {
    return request('GET', '/stats/overview');
  }

  async function statsDetail() {
    return request('GET', '/stats/detail');
  }

  async function wrongBook() {
    return request('GET', '/stats/wrong-book');
  }

  async function markMastered(qid) {
    return request('POST', '/wrong/' + qid + '/master');
  }

  // ── 管理员（仅管理员token可用）──
  async function createShare(params) {
    return request('POST', '/admin/shares', params);
  }

  async function listShares() {
    return request('GET', '/admin/shares');
  }

  async function toggleShare(id) {
    return request('POST', '/admin/shares/' + id + '/toggle');
  }

  async function deleteShare(id) {
    return request('DELETE', '/admin/shares/' + id);
  }

  async function shareStats(id) {
    return request('GET', '/admin/shares/' + id + '/stats');
  }

  async function systemStatus() {
    return request('GET', '/admin/system');
  }

  async function changePassword(oldPwd, newPwd) {
    return request('POST', '/admin/password', { old_password: oldPwd, new_password: newPwd });
  }

  return {
    login, adminLogin, checkSession,
    setToken, restoreToken, logout, getToken, getShareCode,
    getQuestions, getQuestion, getQuestionCount,
    submitAnswer, submitBatch,
    statsOverview, statsDetail, wrongBook, markMastered,
    createShare, listShares, toggleShare, deleteShare, shareStats,
    systemStatus, changePassword
  };
})();
