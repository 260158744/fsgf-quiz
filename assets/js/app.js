/* ===== 主应用 · 路由与视图 ===== */
const App=(()=>{
  const Q=window.QUESTIONS||[];
  let CUR_SEC='副高';
  const ALLQ=window.QUESTIONS_ALL||window.QUESTIONS||[];
  const TB=window.TEXTBOOK||{parts:[]};
  function closeOverlay(){const o=document.getElementById('quizOverlay');if(o)o.hidden=true;}
  function getSection(){return CUR_SEC}
  function setSection(sec){
    if(sec!=='副高'&&sec!=='正高') sec='副高';
    CUR_SEC=sec;
    // 就地改写数组内容（不能重新赋值，否则各模块 const 捕获的引用会失效）
    const arr=window.QUESTIONS; arr.length=0;
    for(const x of ALLQ) if((x.bk||'副高')===sec) arr.push(x);
    try{ for(const q of DB.getImported()) if((q.bk||'副高')===sec) arr.push(q); }catch(e){}
    // 离线镜像现在是 id→答案 全量映射，无需按板块过滤
    document.querySelectorAll('.sec-tab').forEach(b=>b.classList.toggle('active',b.dataset.sec===sec));
    const st=document.getElementById('sectionTitle'); if(st) st.textContent='放射医学技术'+(sec==='正高'?'（正高）':'（副高）');
    try{ localStorage.setItem('fsgf_section',sec) }catch(e){}
    go('dashboard');
  }
  // 锁屏卡片原始模板（用户选择/管理员界面返回时恢复）
  const LOCK_CARD_TMPL=`<div class="lock-logo">🩻</div>
    <h1 class="lock-title">放射医学技术副高</h1>
    <p class="lock-subtitle">智能备考题库 · 2000题</p>
    <div class="lock-form">
      <div class="lock-input-wrap">
        <input type="password" id="lockPwdInput" placeholder="请输入访问密码" autocomplete="off" autofocus>
        <button class="lock-toggle-pwd" id="lockTogglePwd" title="显示/隐藏密码"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
      </div>
      <div class="lock-hint" id="lockHint"></div>
      <button class="btn btn-primary btn-block" id="lockBtn" style="margin-top:14px;height:44px;font-size:15px">解锁进入</button>
    </div>
    <p class="lock-footer">本站为个人备考工具，仅限授权用户访问</p>`;
  // ===== 🔒 密码门禁（API优先 + 客户端降级） =====
  const SHARE_CODE = new URLSearchParams(location.search).get('share');

  // 客户端密码验证（离线/PWA模式降级用）
  async function offlineVerify(pwd) {
    // 默认密码: 123456 (salt+pwd SHA-256)
    const EXPECTED = '39007183d0ded57fd27d7a3752e69106629d0d332b9eaa60a6c7dd13ec978f88';
    // 明文兜底：兼容非 HTTPS / crypto.subtle 不可用环境
    if (pwd === '123456') return true;
    try {
      if (!window.crypto || !crypto.subtle) return false;
      const encoder = new TextEncoder();
      const data = encoder.encode('fsgf_quiz_salt_v1' + pwd);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return hashHex === EXPECTED;
    } catch(e) { return false; }
  }

  function checkAuth(){
    // URL参数免密: ?pwd=xxx 或 ?share=xxx&pwd=xxx
    const urlPwd = new URLSearchParams(location.search).get('pwd');
    if (urlPwd) {
      return autoLogin(urlPwd);
    }
    // 恢复已有 token
    if (API.restoreToken()) {
      return API.checkSession().then(r => {
        if (r.ok) { authenticated = true; return true; }
        else { API.logout(); return false; }
      }).catch(() => false);
    }
    // 检查是否有本地缓存的离线登录（按用户）
    if (sessionStorage.getItem(User.sessionKey()) === '1') {
      authenticated = true;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  async function autoLogin(password){
    try {
      const r = await API.login(password);
      if (r.ok) { authenticated = true; return true; }
    } catch(e) {}
    // API 失败，尝试离线验证
    if (await offlineVerify(password)) {
      sessionStorage.setItem(User.sessionKey(), '1');
      authenticated = true;
      return true;
    }
    return false;
  }

  async function doAuth(pwd){
    try {
      const r = await API.login(pwd);
      if (r.ok){ authenticated = true; return true; }
      // API 返回错误，如果是密码错误就直接返回false
      if (r && r.error && r.error.includes('密码')) return false;
    } catch(e) {}
    // API 不可达，尝试离线验证
    if (await offlineVerify(pwd)) {
      sessionStorage.setItem(User.sessionKey(), '1');
      authenticated = true;
      return true;
    }
    return false;
  }
  function unlockUI(){
    authenticated=true;
    // 确保存在当前用户档案（首次自动创建默认档案）
    if(!User.current()){
      const id=User.create('默认用户');
      User.setCurrent(id);
    }
    const ls=document.getElementById('lockScreen');
    ls.classList.add('unlocked');
    ls.style.display='none';
    document.querySelector('.layout').style.display='';
    document.getElementById('quizOverlay').style.display='';
    document.querySelector('.toast-wrap').style.display='';
    initApp();
  }
  function showLock(){
    document.querySelector('.layout').style.display='none';
    document.getElementById('quizOverlay').style.display='none';
    document.querySelector('.toast-wrap').style.display='none';
    const ls=document.getElementById('lockScreen');
    ls.style.display='flex';
    ls.classList.remove('unlocked');

    // 根据是否是分享链接调整界面
    const isShare = !!SHARE_CODE;
    const titleEl = ls.querySelector('.lock-title');
    const subEl = ls.querySelector('.lock-subtitle');
    const inputEl = document.getElementById('lockPwdInput');
    const hintEl = document.getElementById('lockHint');

    if (isShare) {
      titleEl.textContent = '🔗 题库分享';
      subEl.textContent = `分享码: ${SHARE_CODE} · 请输入访问密码`;
      inputEl.placeholder = SHARE_CODE ? '请输入该分享的密码' : '请输入访问密码';
    } else {
      titleEl.textContent = '放射医学技术副高';
      subEl.textContent = '智能备考题库 · 2000题';
      inputEl.placeholder = '请输入访问密码';
    }

    const btn=document.getElementById('lockBtn');
    const toggle=document.getElementById('lockTogglePwd');
    const card=document.querySelector('.lock-card');

    btn.onclick=async ()=>{
      const v=inputEl.value.trim();
      if(!v && !isShare){shake();hintEl.textContent='请输入密码';hintEl.classList.add('show');return}
      hintEl.classList.remove('show');
      btn.disabled=true;btn.textContent='验证中...';

      try {
        const ok = await doAuth(v);
        if (ok) { showUserSelect(); }
        else {
          shake();hintEl.textContent=isShare?'分享码无效或密码错误':'密码错误，请重新输入';hintEl.classList.add('show');inputEl.value='';inputEl.focus();
        }
      } catch(e) {
        shake();hintEl.textContent='网络错误，请重试';hintEl.classList.add('show');
      }
      btn.disabled=false;btn.textContent='解锁进入';
    };
    inputEl.onkeydown=e=>{if(e.key==='Enter')btn.click()};
    toggle.onclick=()=>{inputEl.type=inputEl.type==='password'?'text':'password'};
    inputEl.focus();

    // 管理员入口（连续点击logo 5次）
    let adminClicks = 0;
    const logo = ls.querySelector('.lock-logo');
    logo.onclick = () => {
      adminClicks++;
      if (adminClicks >= 5) {
        adminClicks = 0;
        showAdminLogin(ls);
      }
      setTimeout(() => { adminClicks = 0; }, 2000);
    };
  }

  function showAdminLogin(lockScreen){
    const card = lockScreen.querySelector('.lock-card');
    const oldHTML = card.innerHTML;
    card.innerHTML = `
      <div class="lock-logo">🔐</div>
      <h1 class="lock-title">管理员登录</h1>
      <p class="lock-subtitle" style="font-size:11px;color:var(--danger)">管理面板 — 分享管理与数据统计</p>
      <div class="lock-form">
        <input type="text" id="adminUserInput" placeholder="用户名" style="width:100%;height:44px;border:2px solid var(--border-2);border-radius:12px;padding:0 14px;font-size:15px;background:var(--surface);color:var(--text);outline:none;margin-bottom:10px;box-sizing:border-box">
        <div class="lock-input-wrap">
          <input type="password" id="adminPwdInput" placeholder="管理员密码" autocomplete="off">
          <button class="lock-toggle-pwd" title="显示/隐藏密码">👁</button>
        </div>
        <div class="lock-hint" id="adminHint"></div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="btn btn-outline btn-block" id="adminBackBtn" style="flex:1;height:42px">← 返回</button>
          <button class="btn btn-primary btn-block" id="adminLoginBtn" style="flex:2;height:42px">登录管理面板</button>
        </div>
      </div>
    `;
    const userIn = document.getElementById('adminUserInput');
    const pwdIn = document.getElementById('adminPwdInput');
    const loginBtn = document.getElementById('adminLoginBtn');
    const backBtn = document.getElementById('adminBackBtn');
    const hint = document.getElementById('adminHint');

    loginBtn.onclick = async () => {
      const u = userIn.value.trim(), p = pwdIn.value.trim();
      if (!u || !p) { shake(); hint.textContent = '请输入用户名和密码'; hint.classList.add('show'); return; }
      loginBtn.disabled = true; loginBtn.textContent = '登录中...';
      const r = await API.adminLogin(u, p);
      if (r.ok) { authenticated = true; unlockUI(); }
      else { shake(); hint.textContent = r.error || '登录失败'; hint.classList.add('show'); }
      loginBtn.disabled = false; loginBtn.textContent = '登录管理面板';
    };
    backBtn.onclick = () => { card.innerHTML = oldHTML; showLock(); };
    pwdIn.onkeydown = e => { if (e.key === 'Enter') loginBtn.click(); };
    userIn.focus();
  }
  function shake(){const c=document.querySelector('.lock-card');c.classList.remove('shake');void c.offsetWidth;c.classList.add('shake')}

  // ===== 👤 用户选择/创建界面（多用户数据隔离） =====
  function showUserSelect(){
    const users=User.list();
    const ls=document.getElementById('lockScreen');
    const card=ls.querySelector('.lock-card');

    // 首次使用（仅默认用户且从未自定义过）→ 自动进入，减少打扰
    if(users.length===1 && users[0].id==='u1' && !localStorage.getItem('fsgf_user_created')){
      localStorage.setItem('fsgf_user_created','1');
      User.setCurrent('u1');
      unlockUI();
      return;
    }

    const rows=users.map((u,i)=>`
      <button class="user-row" onclick="App.selectUser('${u.id}')">
        <span class="user-avatar">${(u.name||'用').slice(0,1)}</span>
        <span class="user-meta">
          <b>${u.name}</b>
          <small>${i===0?'默认档案':'个人档案'} · ${new Date(u.createdAt).toLocaleDateString()}创建</small>
        </span>
        <span class="user-arrow">›</span>
      </button>`).join('');

    card.innerHTML=`
      <div class="lock-logo">👤</div>
      <h1 class="lock-title">选择学习档案</h1>
      <p class="lock-subtitle">多人共用本系统，每人数据完全独立</p>
      <div class="user-list" style="margin:14px 0;max-height:260px;overflow-y:auto">
        ${rows}
      </div>
      <div class="lock-form">
        <div class="lock-input-wrap" style="margin-bottom:8px">
          <input type="text" id="newUserName" placeholder="输入昵称，创建新档案（如：小李）" autocomplete="off" style="width:100%;height:44px;border:2px solid var(--border-2);border-radius:12px;padding:0 14px;font-size:14px;background:var(--surface);color:var(--text);outline:none;box-sizing:border-box">
        </div>
        <div class="lock-hint" id="userHint"></div>
        <button class="btn btn-primary btn-block" id="createUserBtn" style="margin-top:6px;height:44px;font-size:15px">＋ 新建档案并进入</button>
        <button class="btn btn-outline btn-block" id="userBackBtn" style="margin-top:8px;height:40px;font-size:13px">← 返回重新输入密码</button>
      </div>`;

    document.getElementById('createUserBtn').onclick=()=>{
      const n=document.getElementById('newUserName').value.trim();
      if(!n){shake();const h=document.getElementById('userHint');h.textContent='请输入昵称';h.classList.add('show');return}
      const id=User.create(n);
      User.setCurrent(id);
      localStorage.setItem('fsgf_user_created','1');
      unlockUI();
    };
    document.getElementById('userBackBtn').onclick=()=>{card.innerHTML=LOCK_CARD_TMPL;showLock()};
    const input=document.getElementById('newUserName');
    input.onkeydown=e=>{if(e.key==='Enter')document.getElementById('createUserBtn').click()};
    input.focus();
  }
  function selectUser(id){
    if(User.switchTo(id)){
      localStorage.setItem('fsgf_user_created','1');
      unlockUI();
    }
  }

  const UNITS=[
    ['一','人体断面影像解剖','专业知识'],['二','医学物理基础','专业知识'],
    ['三','医学影像设备与成像原理','专业知识'],['四','对比剂','专业知识'],
    ['五','影像质量管理','专业知识'],['六','数字X线成像基础','专业知识'],
    ['七','影像诊断学基础','专业实践能力'],['八','普通X线检查技术','专业实践能力'],
    ['九','CT检查技术','专业实践能力'],['十','MR检查技术','专业实践能力'],
    ['十一','DSA检查技术','专业实践能力'],
    ['十二','PACS技术','学科新进展'],['十三','图像打印技术','学科新进展'],
    ['十四','数字X线技术进展','学科新进展'],['十五','DSA技术进展','学科新进展'],
    ['十六','CT技术进展','学科新进展'],['十七','MR技术进展','学科新进展']
  ];
  const WEIGHTS={'专业知识':0.3,'专业实践能力':0.5,'学科新进展':0.2};
  let view='dashboard';

  async function init(){
    // 🚪 密码门禁已移除：打开即进入（数据仍按用户档案隔离）
    unlockUI();
  }
  function initApp(){
    // 隐藏加载屏
    const ls=document.getElementById('loadingScreen');
    if(ls){ls.classList.add('done');setTimeout(()=>{if(ls.parentNode)ls.parentNode.removeChild(ls)},400);}
    // 主题 + 外观设置
    const s=DB.getSettings();
    document.documentElement.dataset.theme=s.theme;
    document.documentElement.dataset.font=s.fontSize||'md';
    document.documentElement.dataset.bg=s.bgTone||'default';
    document.documentElement.dataset.motion=s.reduceMotion?'off':'on';
    document.getElementById('themeToggle').textContent=s.theme==='dark'?'☀️':'🌙';
    // TTS 设置
    if(s.ttsEnabled)TTS.toggle();
    // 打卡
    if(DB.checkin()){toast('📅 已打卡，连续 '+DB.getStreak()+' 天')}
    // 导航
    document.querySelectorAll('.nav-item').forEach(n=>n.onclick=()=>{go(n.dataset.view)});
    // 移动端底部Tab导航
    document.querySelectorAll('.mtab').forEach(t=>t.onclick=()=>{go(t.dataset.view)});
    document.getElementById('navToggle').onclick=()=>{
      const sb=document.getElementById('sidebar');
      const isOpen=sb.classList.toggle('open');
      // 动态管理遮罩层（移动端侧边栏打开时显示）
      if(window.innerWidth<=760){
        let ov=document.getElementById('sidebarOverlay');
        if(!ov){
          ov=document.createElement('div');
          ov.id='sidebarOverlay';
          ov.className='sidebar-overlay';
          document.body.appendChild(ov);
          ov.onclick=()=>{sb.classList.remove('open');ov.classList.remove('show');};
        }
        if(isOpen){setTimeout(()=>ov.classList.add('show'),10);}
        else{ov.classList.remove('show');}
      }
    };
    // 板块切换(副高/正高)
    document.querySelectorAll('.sec-tab').forEach(b=>b.onclick=()=>{setSection(b.dataset.sec)});
    document.getElementById('themeToggle').onclick=toggleTheme;
    document.getElementById('quizExit').onclick=()=>Quiz.exit();
    // 恢复上次板块 + 合入自动出题导入的题目
    let _sec='副高';
    try{ _sec=localStorage.getItem('fsgf_section')||'副高' }catch(e){}
    CUR_SEC=(_sec==='正高')?'正高':'副高';
    const _arr=window.QUESTIONS; _arr.length=0;
    for(const x of ALLQ) if((x.bk||'副高')===CUR_SEC) _arr.push(x);
    try{ for(const q of DB.getImported()) if((q.bk||'副高')===CUR_SEC) _arr.push(q) }catch(e){}
    document.querySelectorAll('.sec-tab').forEach(b=>b.classList.toggle('active',b.dataset.sec===CUR_SEC));
    const _st=document.getElementById('sectionTitle'); if(_st)_st.textContent='放射医学技术'+(CUR_SEC==='正高'?'（正高）':'（副高）');
    render();
  }
  function go(v){
    view=v;
    // 同步侧边栏高亮
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===v));
    // 同步移动端底部Tab高亮
    document.querySelectorAll('.mtab').forEach(t=>t.classList.toggle('active',t.dataset.view===v));
    // 关闭移动端抽屉
    document.getElementById('sidebar').classList.remove('open');
    const ov=document.getElementById('sidebarOverlay');
    if(ov) ov.classList.remove('show');
    render();
  }
  function toggleTheme(){const s=DB.getSettings();const nv=s.theme==='light'?'dark':'light';DB.setSetting('theme',nv);document.documentElement.dataset.theme=nv;document.getElementById('themeToggle').textContent=nv==='dark'?'☀️':'🌙';render()}
  function toast(msg){const w=document.getElementById('toastWrap');const t=document.createElement('div');t.className='toast';t.textContent=msg;w.appendChild(t);setTimeout(()=>t.remove(),2500)}

  function render(){
    updateTopbar();updateLevelCard();updateBadges();
    const main=document.getElementById('main');
    const V={
      dashboard:renderDash,map:renderMap,practice:renderPractice,
      plan:renderPlan,lectures:renderLectures,wrong:renderWrong,review:renderReview,
      reports:renderReports,badges:renderBadges,settings:renderSettings,
      goals:renderGoals,
      textbook:renderTextbook,notes:renderNotes,hot:renderHot,auto:renderAuto
    };
    main.innerHTML=(V[view]||renderDash)();
    // 绑定动态事件
    bindEvents();
  }
  function updateTopbar(){
    const recs=DB.getRecords();const correct=recs.filter(r=>r.ok).length;
    const wrong=Object.values(DB.getWrong()).filter(w=>!w.mastered).length;
    const review=DB.getReview().length;
    document.getElementById('topbarStats').innerHTML=`
      <div class="tstat"><b>${recs.length}</b><span>已答题</span></div>
      <div class="tstat"><b>${recs.length?Math.round(correct/recs.length*100):0}%</b><span>正确率</span></div>
      <div class="tstat"><b>${DB.getXP()}</b><span>XP</span></div>
      <div class="tstat"><b>${DB.getStreak()}</b><span>连续天</span></div>`;
    document.getElementById('wrongCount').textContent=wrong||'';
    document.getElementById('reviewCount').textContent=review||'';
    const nc=document.getElementById('notesCount');
    if(nc){try{nc.textContent=(DB.getAllNotes?DB.getAllNotes():[]).length||''}catch(e){nc.textContent=''}}
  }
  function updateLevelCard(){
    const lv=Gamify.level(DB.getXP());
    document.getElementById('levelCard').innerHTML=`
      <div class="lv-name">${lv.display} <span style="font-size:11px">${DB.getXP()} XP</span></div>
      <div class="lv-bar"><div class="lv-bar-fill" style="width:${lv.progress}%"></div></div>
      <div class="lv-xp">${lv.xpNext?`距下一段位 ${lv.xpNext-DB.getXP()} XP`:'已达最高段位'}</div>`;
  }
  function updateBadges(){
    // 在勋章视图渲染时处理
  }

  // ★ 每日一言
  const QUOTES=[
    '你今天的每一道错题，都是考试时的每一分。','备考不是赛跑，是马拉松，配速比速度重要。',
    '看懂解析的那一刻，你就比昨天强了一点。','题海战术不如精做一题，弄懂比做完更重要。',
    '坚持是最朴素的通关秘籍。','模考不是终点，是发现薄弱点的起点。',
    '每个正确答案背后，都是无数个错题的积累。','与其焦虑考试，不如多刷一题。',
    '理解优先于记忆，记忆服务于理解。','今天的努力，是明天的从容。',
    '错题不是失败，是路标——告诉你哪里需要加强。','分段学习比疲劳战术高效十倍。',
    '能讲清楚的才是真懂——试着给自己讲一遍。','考试考的不是你会多少，是你不会的有没有学会。',
    '专注 25 分钟胜过走神 2 小时。','休息也是学习的一部分，大脑在休息时整理记忆。',
    '别追求完美，追求进步。','今天比昨天多做对一题，就是胜利。',
    '备考路上，最难的是开始，最重要的是坚持。','把错题本当成你的私人教练。',
    '每个考过副高的人，都曾和你一样在刷题。','理解一个概念，胜过背诵十遍。',
    '考试是在特定时间、特定地点、集中注意力输出你平时的积累。','不要跳过解析，那才是精华。',
    '反复错的题，换个角度学——画图、举例、教别人。','模考分数低？太好了，提前发现了问题。',
    '学习区（80%能做对的题）进步最快。','难的不是题目，是克服不想做的那一刻。',
    '把"我不会"变成"我还没学会"，心态就不一样了。','你不需要做到完美，你需要做到通过。'
  ];
  function dailyQuote(){
    const day=Math.floor(Date.now()/86400000);
    return QUOTES[day%QUOTES.length];
  }

  // ===== 仪表盘 =====
  function renderDash(){
    const recs=DB.getRecords();const correct=recs.filter(r=>r.ok).length;
    const daily=DB.getDaily();const dpct=daily.target?Math.min(100,Math.round(daily.done/daily.target*100)):0;
    const wrong=Object.values(DB.getWrong()).filter(w=>!w.mastered).length;
    const review=DB.getReview().length;
    const ab=DB.getAbility();let weakN=0;for(const k in ab){if(ab[k].attempts>=3&&ab[k].score<40)weakN++}
    const days=examCountdown();
    const doneSet=new Set(recs.map(r=>r.qid)).size;
    return `
    <div class="daily-quote">💬 ${dailyQuote()}</div>
    <div class="dash-hero">
      <h2>👋 欢迎备考，${DB.getStreak()>0?'已坚持 '+DB.getStreak()+' 天':'今天开始第一题'}</h2>
      <p class="hero-sub">放射医学技术（${CUR_SEC==='正高'?'正高级':'副高级'}）· 依据官方考纲与《放射学高级教程》编制 · 共 ${Q.length} 题</p>
      ${days?`<div class="countdown-bar ${days<=30?'urgent':''}">📅 距考试还有 <b>${days}</b> 天 · 已刷 ${doneSet}/${Q.length} 题 (${Math.round(doneSet/Q.length*100)}%) · 每天约需 ${Math.ceil((Q.length-doneSet)/Math.max(1,days))} 题</div>`:''}
      <div class="hero-row">
        <div class="daily-ring">
          <svg class="ring-svg" viewBox="0 0 60 60">
            <circle class="ring-bg" cx="30" cy="30" r="25"/>
            <circle class="ring-fg" cx="30" cy="30" r="25" stroke-dasharray="${dpct*1.57} 157"/>
          </svg>
          <div><div class="ring-txt">${daily.done}/${daily.target}</div><div style="font-size:11px;opacity:.85">今日目标</div></div>
        </div>
        <div><div class="hr-val">${recs.length}</div><div class="hr-label">累计答题</div></div>
        <div><div class="hr-val">${recs.length?Math.round(correct/recs.length*100):0}%</div><div class="hr-label">总正确率</div></div>
        <div><div class="hr-val">${Gamify.level(DB.getXP()).display}</div><div class="hr-label">当前段位</div></div>
      </div>
    </div>
    <div class="section-title">🎯 选择练习模式</div>
    <div class="mode-grid">
      <div class="mode-card" onclick="Quiz.start('free',{count:10})"><span class="mode-ico">✍️</span><h3>自由刷题</h3><p>自适应选题，瞄准学习区，10题一组</p></div>
      <div class="mode-card" onclick="Quiz.start('weak',{count:10})"><span class="mode-ico">🎯</span><h3>薄弱强化</h3><p>优先推送你得分最低的知识点</p></div>
      <div class="mode-card" onclick="Quiz.start('exam',{count:50})"><span class="mode-ico">📋</span><h3>全真模考</h3><p>50题·按大纲权重分布·难度3:5:2</p></div>
      <div class="mode-card" onclick="Quiz.start('memorize',{count:10})"><span class="mode-ico">📖</span><h3>背题模式</h3><p>从错题本抽取，边答边记</p></div>
    </div>
    <div class="grid grid-4" style="margin-top:18px">
      <div class="stat-card danger"><span class="sc-icon">📕</span><div class="sc-val">${wrong}</div><div class="sc-label">待攻克错题</div></div>
      <div class="stat-card warn"><span class="sc-icon">🔁</span><div class="sc-val">${review}</div><div class="sc-label">今日待复习</div></div>
      <div class="stat-card"><span class="sc-icon">⚠️</span><div class="sc-val">${weakN}</div><div class="sc-label">严重薄弱点</div></div>
      <div class="stat-card success"><span class="sc-icon">🏅</span><div class="sc-val">${DB.getBadges().length}</div><div class="sc-label">已获勋章</div></div>
    </div>
    <div class="card" style="margin-top:18px">
      <h3 style="margin-bottom:10px">📈 快速入口</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="App.go('plan')">🗓️ 备考计划</button>
        <button class="btn btn-outline btn-sm" onclick="App.go('map')">查看知识地图</button>
        <button class="btn btn-outline btn-sm" onclick="App.go('reports')">学情报告</button>
        <button class="btn btn-outline btn-sm" onclick="Quiz.start('review',{count:20})">${review>0?'开始今日复习':'暂无待复习'}</button>
        <button class="btn btn-outline btn-sm" onclick="App.go('wrong')">错题本(${wrong})</button>
      </div>
    </div>`;
  }

  // ===== 知识地图 =====
  function renderMap(){
    const ab=DB.getAbility();const recs=DB.getRecords();
    const byUnit={};for(const r of recs){byUnit[r.u]=byUnit[r.u]||{t:0,c:0};byUnit[r.u].t++;if(r.ok)byUnit[r.u].c++}
    const modules={'专业知识':[],'专业实践能力':[],'学科新进展':[]};
    for(const[u,name,mod]of UNITS){
      const qcount=Q.filter(q=>q.u===u).length;
      const st=byUnit[u]||{t:0,c:0};
      const acc=st.t?Math.round(st.c/st.t*100):null;
      // 单元平均能力分
      let ascore=0,an=0;for(const c of['记忆','理解','应用','分析']){const a=ab[u+'|'+c];if(a&&a.attempts>0){ascore+=a.score;an++}}
      ascore=an?ascore/an:0;
      modules[mod].push({u,name,qcount,st,acc,ascore});
    }
    let html=`<div class="page-head"><h1>🗺️ 知识地图</h1><p>共17个单元·${Q.length}题·按大纲三大模块组织，点击单元进入专项练习</p></div>`;
    for(const[mod,arr]of Object.entries(modules)){
      html+=`<div class="module-section"><div class="module-title">${modName(mod)}<span class="module-weight">大纲权重 ${WEIGHTS[mod]*100}%</span></div>`;
    for(const u of arr){
      const accColor=u.acc===null?'var(--text-3)':u.acc>=80?'var(--success)':u.acc>=60?'var(--warn)':'var(--danger)';
      const asColor=u.ascore>=60?'var(--success)':u.ascore>=40?'var(--warn)':'var(--danger)';
      const donePct=Math.round(u.st.t/u.qcount*100);
      const doneColor=u.st.t>=u.qcount?'var(--success)':u.st.t>0?'var(--primary)':'var(--text-3)';
      html+=`<div class="unit-row" onclick="Quiz.start('free',{unit:'${u.u}',count:10})">
        <div class="unit-num">${u.u}</div>
        <div class="unit-info"><div class="ui-name">${u.name}</div><div class="ui-meta">${u.qcount} 题 · 已做 ${u.st.t} (${donePct}%)${u.acc!==null?` · 正确率 ${u.acc}%`:''}</div></div>
        <div class="unit-acc">
          ${u.ascore>0?`<div style="font-size:11px;color:var(--text-3)">能力</div><div class="acc-txt" style="color:${asColor}">${Math.round(u.ascore)}</div>`:''}
          <div class="acc-bar" style="width:70px;margin-top:3px"><div class="acc-bar-fill" style="width:${donePct}%;background:${doneColor}"></div></div>
          <span class="unit-quiz-btn">练习</span>
        </div>
      </div>`;
    }
      html+=`</div>`;
    }
    html+=`<div class="card"><h3 style="margin-bottom:8px">📌 重点难点提示</h3><div class="detail-list">
      <b>高频高分模块</b>：单元九（CT）、单元十（MR）题量最大（各110题），权重50%的专业实践能力核心。<br>
      <b>易错高发区</b>：MRI信号演变、序列参数权衡(SNR/时间/分辨率)、对比剂不良反应处理、X线摄影体位角度、CT值与窗宽窗位计算。<br>
      <b>记忆密集区</b>：断面解剖、PACS/DICOM标准、图像打印技术——多用"背题模式"。<br>
      <b>分析应用区</b>：案例分析题集中在各部位检查技术方案设计——建议扎实自由刷题后再挑战模考。
    </div></div>`;
    return html;
  }
  function modName(m){return {'专业知识':'📚 专业知识','专业实践能力':'🛠️ 专业实践能力','学科新进展':'🚀 学科新进展'}[m]}

  // ===== 练习选择 =====
  function renderPractice(){
    const activeGoal=DB.getActiveGoal();
    return `<div class="page-head"><h1>✍️ 开始刷题</h1><p>选择练习模式与筛选条件</p></div>
    ${activeGoal?`<div class="card" style="background:var(--primary-l);border-color:var(--primary);margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><b style="color:var(--primary)">🎯 目标进行中</b> <span class="muted" style="font-size:12px">${activeGoal.name||'单元专攻'}</span></div>
        <button class="btn btn-primary btn-sm" onclick="Quiz.start('goal',{units:${JSON.stringify(activeGoal.units).replace(/"/g,'&quot;')},count:15})">继续目标练习</button>
      </div>
    </div>`:''}
    <div class="mode-grid">
      <div class="mode-card" onclick="Quiz.start('free',{count:10})"><span class="mode-ico">✍️</span><h3>自由刷题</h3><p>10题·自适应·学习区优先</p></div>
      <div class="mode-card" onclick="Quiz.start('weak',{count:10})"><span class="mode-ico">🎯</span><h3>薄弱强化</h3><p>10题·针对薄弱单元</p></div>
      <div class="mode-card" onclick="Quiz.start('exam',{count:50})"><span class="mode-ico">📋</span><h3>全真模考</h3><p>50题·模拟真实考试</p></div>
      <div class="mode-card" onclick="Quiz.start('memorize',{count:10})"><span class="mode-ico">📖</span><h3>背题模式</h3><p>10题·从错题本抽取</p></div>
    </div>
    <div class="section-title">按单元专项练习</div>
    <div class="grid grid-3">
      ${UNITS.map(([u,name,mod])=>`<div class="unit-row" onclick="Quiz.start('free',{unit:'${u}',count:10})"><div class="unit-num">${u}</div><div class="unit-info"><div class="ui-name">${name}</div><div class="ui-meta">${Q.filter(q=>q.u===u).length}题 · ${mod}</div></div><span class="unit-quiz-btn">练习</span></div>`).join('')}
    </div>`;
  }

  // ===== 智能备考计划 =====
  function examCountdown(){
    const d=DB.getSettings().examDate;
    if(!d) return null;
    const days=Math.ceil((new Date(d+'T23:59:59')-Date.now())/86400000);
    return days;
  }
  function renderPlan(){
    const s=DB.getSettings();
    const days=examCountdown();
    const recs=DB.getRecords();
    const total=Q.length;
    const done=new Set(recs.map(r=>r.qid)).size;
    const wrong=Object.values(DB.getWrong()).filter(w=>!w.mastered).length;
    const review=DB.getReview().length;
    const daily=DB.getDaily();
    // 单元覆盖情况
    const byUnit={};for(const r of recs){byUnit[r.u]=byUnit[r.u]||new Set();byUnit[r.u].add(r.qid)}
    const unitCover=UNITS.map(([u,name,mod])=>{
      const cnt=Q.filter(q=>q.u===u).length;
      const dset=byUnit[u]||new Set();
      return {u,name,mod,cnt,done:Math.min(cnt,dset.size)};
    });

    let html=`<div class="page-head"><h1>🗓️ 智能备考计划</h1><p>以考试日期倒排复习节奏，每日推荐学习任务</p></div>`;

    // 未设置考试日期 → 引导
    if(!days){
      html+=`<div class="card" style="background:var(--primary-l);border-color:var(--primary);text-align:center;padding:28px">
        <div style="font-size:40px;margin-bottom:10px">📅</div>
        <h3 style="margin-bottom:8px">还没有设置考试日期</h3>
        <p class="muted" style="font-size:13px;margin-bottom:14px">设置后系统会根据剩余天数自动生成每日复习计划</p>
        <button class="btn btn-primary" onclick="App.go('settings')">去设置考试日期 →</button>
      </div>`;
    }else{
      const urgent=days<=30;
      const weekly = Math.max(10, Math.round((total-done)/Math.max(1,days/7)));
      html+=`<div class="grid grid-3">
        <div class="stat-card ${urgent?'danger':''}"><div class="sc-val">${days}</div><div class="sc-label">距考试（天）</div><div class="sc-sub" style="color:${urgent?'var(--danger)':'var(--warn)'};font-size:12px">${urgent?'⚠️ 时间紧张，建议每天 ≥ ${weekly} 题':'节奏适中，每周约 ${weekly} 题'}</div></div>
        <div class="stat-card"><div class="sc-val">${done}<span style="font-size:14px;color:var(--text-3)">/${total}</span></div><div class="sc-label">已刷题数</div><div class="sc-sub" style="font-size:12px;color:var(--text-2)">${Math.round(done/total*100)}% 覆盖</div></div>
        <div class="stat-card"><div class="sc-val">${daily.done}<span style="font-size:14px;color:var(--text-3)">/${daily.target}</span></div><div class="sc-label">今日已完成</div><div class="sc-sub" style="font-size:12px;color:var(--text-2)">目标 ${daily.target} 题 · 继续加油</div></div>
      </div>`;
      // 今日建议卡片
      const weak=Report.weakList().slice(0,3);
      const hasReview=review>0;
      html+=`<div class="card" style="margin-top:16px;background:var(--primary-l);border-color:var(--primary)">
        <h3 style="margin-bottom:10px">🎯 今日建议（自动生成）</h3>
        <div class="detail-list" style="font-size:13px;line-height:2">
          ${hasReview?`<b>1️⃣ 先复习</b>：今日 ${review} 题待复习，先做「复习计划」巩固记忆<br>`:`<b>1️⃣ 今日无复习任务</b>，可以直接开始新题<br>`}
          ${weak.length?`<b>2️⃣ 主攻薄弱</b>：${weak.map(w=>{const u=UNITS.find(x=>x[0]===w.u);return `「${u?u[1]:w.u}·${w.c}」`}).join('、')} 正确率偏低，建议「薄弱强化」<br>`:'<b>2️⃣ 暂无明显薄弱点</b>，继续刷题积累<br>'}
          <b>3️⃣ 查漏补缺</b>：还有 ${total-done} 题未刷，剩余 ${days} 天平均每天需 ${Math.ceil((total-done)/Math.max(1,days))} 题
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          ${hasReview?`<button class="btn btn-primary btn-sm" onclick="Quiz.start('review',{count:20})">🔁 开始今日复习</button>`:''}
          ${weak.length?`<button class="btn btn-outline btn-sm" onclick="Quiz.start('weak',{count:15})">🎯 薄弱强化</button>`:''}
          <button class="btn btn-outline btn-sm" onclick="Quiz.start('free',{count:10})">✍️ 自由刷题</button>
        </div>
      </div>`;
    }

    // 单元覆盖进度
    html+=`<div class="section-title">单元覆盖进度</div>`;
    html+=`<div class="card">`;
    for(const u of unitCover){
      const pct=Math.round(u.done/u.cnt*100);
      const col=pct===100?'var(--success)':pct>=60?'var(--primary)':pct>0?'var(--warn)':'var(--text-3)';
      html+=`<div class="unit-row" onclick="Quiz.start('free',{unit:'${u.u}',count:10})">
        <div class="unit-num">${u.u}</div>
        <div class="unit-info"><div class="ui-name">${u.name}</div><div class="ui-meta">${u.done}/${u.cnt} 题 · ${u.mod}</div></div>
        <div class="unit-acc">
          <div class="acc-bar" style="width:90px"><div class="acc-bar-fill" style="width:${pct}%;background:${col}"></div></div>
          <span style="font-size:12px;color:${col};font-weight:500">${pct}%</span>
        </div>
      </div>`;
    }
    html+=`</div>`;
    html+=`<div class="card" style="margin-top:14px"><div class="detail-list" style="font-size:12px">
      <b>📌 计划说明</b>：覆盖全部17单元后再反复刷薄弱单元；专业实践能力（单元七~十一）权重50%，投入时间建议占比一半；案例分析题多练综合推理。
    </div></div>`;
    return html;
  }

  // ===== 重点讲义 =====
  let lectureFocus='一';
  let textbookFocus=null, textbookFocusSec=null;
  function renderLectures(){
    const L=window.LECTURES||{};
    const meta=UNITS.find(u=>u[0]===lectureFocus);
    let html=`<div class="page-head"><h1>📚 重点讲义</h1><p>17单元精编讲义 · 与题目考点一一对应 · 刷题时可同步查阅</p></div>`;
    html+=`<div class="lecture-tabs">${UNITS.map(([u,name])=>`<button class="filter-chip ${lectureFocus===u?'active':''}" onclick="App.openLecture('${u}')">${u}</button>`).join('')}</div>`;
    const lec=L[lectureFocus];
    if(!lec){
      html+=`<div class="empty-state"><div class="es-ico">📖</div><p>该单元讲义正在编制中</p></div>`;
      return html;
    }
    html+=`<div class="card" style="background:var(--primary-l);border-color:var(--primary)">
      <h3 style="margin-bottom:6px">${lec.title||(meta?meta[1]:lectureFocus)}</h3>
      <div class="muted" style="font-size:12px">${lec.module||''}${lec.weight?` · 大纲权重 ${lec.weight}%`:''}</div>
      ${lec.overview?`<p style="font-size:13px;margin-top:8px;color:var(--text-2)">${lec.overview}</p>`:''}
    </div>`;
    for(const sec of (lec.sections||[])){
      html+=`<div class="card lecture-sec"><h3>${sec.h}</h3><div class="lecture-body">${sec.content}</div></div>`;
    }
    if(lec.other){html+=`<div class="card lecture-sec"><h3>📌 其他提示</h3><div class="lecture-body">${lec.other}</div></div>`}
    return html;
  }
  // 跳转讲义：必须先关掉答题浮层，否则页面已切换但被浮层挡住（原"点了没反应"的根因）
  function openLecture(u){closeOverlay();lectureFocus=u;go('lectures');window.scrollTo&&window.scrollTo(0,0);}
  // 从答题解析跳转到教材具体出处
  function openBook(ref){
    closeOverlay();
    if(ref&&ref.篇){textbookFocus=ref.篇; textbookFocusSec=ref.节||null;}
    go('textbook');
    const secTitle=ref&&ref.节;
    // 渲染后定位到对应小节并高亮
    setTimeout(()=>{
      const sid=secTitle&&tbkIndex[secTitle];
      const el=sid&&document.getElementById(sid);
      if(el){
        el.scrollIntoView({behavior:'smooth',block:'center'});
        el.classList.add('tbk-flash');
        setTimeout(()=>el.classList.remove('tbk-flash'),2600);
      }else{ window.scrollTo&&window.scrollTo(0,0); }
      // 释放焦点锁，之后用户可自由折叠其他篇
      textbookFocus=null; textbookFocusSec=null;
    },150);
  }

  // ===== 错题本 =====
  let wrongFilter='all';let wrongTab='list';
  function renderWrong(){
    const wrong=DB.getWrong();const arr=Object.entries(wrong).filter(([k,w])=>!w.mastered);
    const filt=arr.filter(([id,w])=>{
      if(wrongFilter==='all')return true;
      const q=Q.find(x=>x.id===id);if(!q)return false;
      if(wrongFilter==='hard')return q.d==='难';
      if(wrongFilter==='case')return q.t==='案例分析题'||q.t==='共用题干题';
      return q.u===wrongFilter;
    });
    let html=`<div class="page-head"><h1>📕 错题本</h1><p>共 ${arr.length} 道待攻克错题·支持筛选与导出</p></div>`;
    // ★ 标签页切换
    html+=`<div class="wrong-tabs">
      <button class="filter-chip ${wrongTab==='list'?'active':''}" onclick="App.setWrongTab('list')">📋 错题列表</button>
      <button class="filter-chip ${wrongTab==='reason'?'active':''}" onclick="App.setWrongTab('reason')">📊 错因分析</button>
    </div>`;
    if(wrongTab==='reason'){
      // ★ 错因分析标签页
      const stats=DB.getReasonStats();
      const reasons=[
        {code:'careless',label:'粗心失误',ico:'😅'},
        {code:'concept',label:'概念混淆',ico:'🤔'},
        {code:'misread',label:'审题不清',ico:'👀'},
        {code:'unknown',label:'完全不会',ico:'😵'},
        {code:'unlabeled',label:'未标记',ico:'❓'}
      ];
      const total=Object.values(stats).reduce((a,b)=>a+b,0)||1;
      html+=`<div class="card"><h3 style="margin-bottom:12px">📊 错因分布</h3>`;
      for(const r of reasons){
        const count=stats[r.code]||0;
        const pct=Math.round(count/total*100);
        if(count===0&&r.code!=='unlabeled')continue;
        html+=`<div class="reason-row">
          <span class="rr-ico">${r.ico}</span>
          <span class="rr-label">${r.label}</span>
          <span class="rr-count">${count}题</span>
          <div class="rr-bar"><div class="rr-bar-fill" style="width:${pct}%"></div></div>
          ${count>0?`<button class="btn btn-outline btn-sm" onclick="Quiz.start('reason',{reason:'${r.code}',count:20})">专项训练 ${count} 道</button>`:''}
        </div>`;
      }
      html+=`<div class="detail-list" style="margin-top:14px;font-size:12px">
        <b>💡 建议</b>：粗心失误→放慢审题速度；概念混淆→重读讲义；审题不清→注意关键词标记；完全不会→从基础学起。
      </div></div>`;
      return html;
    }
    // 原有列表视图
    html+=`<div class="list-toolbar">
      <button class="btn btn-outline btn-sm" onclick="App.exportWrong()">⬇️ 导出错题</button>
      <button class="btn btn-outline btn-sm" onclick="App.exportWrongPrint()">🖨️ A4打印</button>
      <button class="btn btn-ghost btn-sm" onclick="Quiz.start('memorize',{count:20})">📖 背题模式复习</button>
      <span style="flex:1"></span>
      <button class="filter-chip ${wrongFilter==='all'?'active':''}" onclick="App.setWrongFilter('all')">全部</button>
      <button class="filter-chip ${wrongFilter==='hard'?'active':''}" onclick="App.setWrongFilter('hard')">仅难题</button>
      <button class="filter-chip ${wrongFilter==='case'?'active':''}" onclick="App.setWrongFilter('case')">仅案例</button>
    </div>`;
    if(!filt.length){html+=`<div class="empty-state"><div class="es-ico">🎉</div><p>暂无错题，继续保持！</p></div>`;return html}
    filt.sort((a,b)=>b[1].count-a[1].count);
    for(const[id,w]of filt.slice(0,50)){
      const q=Q.find(x=>x.id===id);if(!q)continue;
      const dmap={'易':'tag-easy','中':'tag-mid','难':'tag-hard'};
      html+=`<div class="qitem" onclick="App.previewQuestion('${id}')">
        <div class="qitem-head">
          <div class="qitem-stem">${esc(q.s)}</div>
          <span class="qitem-wrong-count">×${w.count}</span>
        </div>
        <div class="qitem-meta"><span class="tag tag-type">${q.t}</span><span class="tag ${dmap[q.d]}">${q.d}</span><span class="tag tag-cog">${q.c}</span><span>${q.un}</span><span>· 掌握度 ${Math.round(w.mastery*100)}%</span></div>
        <div class="qitem-actions"><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();App.previewQuestion('${id}')">查看解析</button><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();App.markMastered('${id}')">标记已掌握</button></div>
      </div>`;
    }
    return html;
  }
  // ===== 复习计划 =====
  function renderReview(){
    const reviewIds=DB.getReview();
    const wrong=DB.getWrong();
    let html=`<div class="page-head"><h1>🔁 复习计划</h1><p>基于艾宾浩斯遗忘曲线·间隔1/2/4/7/15/30天·连续答对5次即掌握</p></div>`;
    if(!reviewIds.length){html+=`<div class="empty-state"><div class="es-ico">✅</div><p>今日无待复习题目</p><button class="btn btn-primary" style="margin-top:14px" onclick="Quiz.start('free',{count:10})">去刷新题</button></div>`;return html}
    html+=`<div class="card" style="background:var(--primary-l);border-color:var(--primary)"><div style="display:flex;align-items:center;gap:12px"><div style="font-size:32px">⏰</div><div><div style="font-weight:700;color:var(--primary)">今日待复习 ${reviewIds.length} 题</div><div class="muted" style="font-size:12px">在最佳记忆时机复习，效率最高</div></div><button class="btn btn-primary" style="margin-left:auto" onclick="Quiz.start('review',{count:20})">开始复习</button></div></div>`;
    html+=`<div class="section-title">待复习题目</div>`;
    for(const id of reviewIds.slice(0,30)){
      const q=Q.find(x=>x.id===id);if(!q)continue;const w=wrong[id];
      html+=`<div class="qitem" onclick="App.previewQuestion('${id}')"><div class="qitem-head"><div class="qitem-stem">${esc(q.s)}</div><span class="qitem-wrong-count">×${w?.count||1}</span></div><div class="qitem-meta"><span class="tag tag-cog">${q.c}</span><span>${q.un}</span><span>· 掌握度 ${Math.round((w?.mastery||0)*100)}%</span></div></div>`;
    }
    return html;
  }

  // ===== 报告 =====
  function renderReports(){
    const radar=Report.radarSVG();const growth=Report.growthSVG();const cog=Report.cogStats();const top=Report.topWrong(8);const weak=Report.weakList();
    let html=`<div class="page-head"><h1>📈 学情报告</h1><p>能力雷达图·成长曲线·认知维度·高频错题·薄弱点</p></div>`;
    html+=`<div class="report-section"><h3>🎯 能力雷达图</h3><div class="card"><div class="radar-wrap">${radar.svg}<div class="radar-legend">`;
    for(const d of radar.data){
      const c=d.score<40?'var(--danger)':d.score<60?'var(--warn)':'var(--success)';
      html+=`<div class="legend-row"><span class="legend-dot" style="background:${c}"></span><span class="legend-name">${d.u} ${d.name}</span><span class="legend-val" style="color:${c}">${d.hasData?Math.round(d.score):'—'}</span></div>`;
    }
    html+=`</div></div></div></div>`;
    html+=`<div class="report-section"><h3>📊 成长曲线（近30天正确率）</h3><div class="card"><div class="chart-wrap">${growth.svg}</div>${growth.avg7?`<div style="text-align:center;margin-top:8px;color:var(--text-2);font-size:13px">近7天平均正确率 <b style="color:var(--primary);font-size:16px">${growth.avg7}%</b></div>`:''}</div></div>`;
    html+=`<div class="report-section"><h3>🧠 认知维度分析</h3><div class="card"><div class="grid grid-4">`;
    for(const c of cog){
      const col=c.acc>=80?'var(--success)':c.acc>=60?'var(--warn)':'var(--danger)';
      html+=`<div class="stat-card"><div class="sc-val" style="color:${col}">${c.acc}%</div><div class="sc-label">${c.c}</div><div class="sc-sub">${c.correct}/${c.total}</div></div>`;
    }
    html+=`</div><p class="muted" style="font-size:12px;margin-top:10px">提示：记忆→理解→应用→分析，认知层次越高越难。分析维度薄弱说明综合推理能力需加强。</p></div></div>`;
    if(weak.length){html+=`<div class="report-section"><h3>⚠️ 薄弱点TOP</h3><div class="card"><div class="weak-list">`;
    for(const w of weak){const u=UNITS.find(x=>x[0]===w.u);const sev=w.score<40?'severe':'warn';html+=`<div class="weak-item ${sev}"><span class="muted" style="font-size:12px;width:24px">${w.u}</span><span class="wi-name">${u?u[1]:''} · ${w.c}</span><span class="wi-score">${Math.round(w.score)}</span></div>`}
    html+=`</div><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="Quiz.start('weak',{count:15})">🎯 针对薄弱点练习</button></div></div>`}
    if(top.length){html+=`<div class="report-section"><h3>📕 高频错题TOP</h3><div class="card">`;
    for(const t of top){html+=`<div class="qitem" onclick="App.previewQuestion('${t.q.id}')"><div class="qitem-head"><div class="qitem-stem">${esc(t.q.s)}</div><span class="qitem-wrong-count">×${t.w.count}</span></div><div class="qitem-meta"><span class="tag tag-cog">${t.q.c}</span><span>${t.q.un}</span></div></div>`}
    html+=`</div></div>`}
    return html;
  }

  // ===== 勋章墙 =====
  function renderBadges(){
    const earned=DB.getBadges();
    let html=`<div class="page-head"><h1>🏅 勋章墙</h1><p>已获得 ${earned.length} / ${Gamify.BADGES.length} 枚勋章</p></div>`;
    html+=`<div class="badge-grid">`;
    for(const b of Gamify.BADGES){
      const got=earned.includes(b.code);
      html+=`<div class="badge-tile ${got?'earned':'locked'}"><div class="bt-ico">${b.ico}</div><div class="bt-name">${b.name}</div><div class="bt-desc">${b.desc}</div>${got?'<div class="bt-check">✓</div>':''}<div style="font-size:10px;color:var(--accent);margin-top:4px">+${b.xp} XP</div></div>`;
    }
    return html+`</div>`;
  }

  // ===== 学习目标管理 =====
  function renderGoals(){
    const goals=DB.getGoals();
    const active=DB.getActiveGoal();
    let html=`<div class="page-head"><h1>🎯 学习目标</h1><p>设定目标，系统自动重组题目和计划</p></div>`;
    // 当前活跃目标
    if(active){
      const elapsed=Math.floor((Date.now()-active.startDate)/86400000);
      const remaining=active.targetDays-elapsed;
      const unitNames=(active.units||[]).map(u=>{const un=UNITS.find(x=>x[0]===u);return un?un[1]:u});
      const recs=DB.getRecords().filter(r=>active.units.includes(r.u));
      const done=new Set(recs.map(r=>r.qid)).size;
      const correct=recs.filter(r=>r.ok).length;
      const acc=recs.length?Math.round(correct/recs.length*100):0;
      html+=`<div class="card" style="background:var(--primary-l);border-color:var(--primary)">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div>
            <h3 style="color:var(--primary)">📌 当前目标：${active.name||unitNames.join('、')}</h3>
            <p class="muted" style="font-size:13px;margin-top:4px">进度：第 ${elapsed}/${active.targetDays} 天 · 已练 ${recs.length} 题 · 正确率 ${acc}%</p>
            ${remaining<=0?`<p style="color:var(--warn);margin-top:6px">⚠️ 目标已到期，建议标记完成或调整</p>`:`<p class="muted" style="font-size:12px;margin-top:4px">预计完成：还有 ${remaining} 天</p>`}
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <button class="btn btn-primary btn-sm" onclick="Quiz.start('goal',{units:${JSON.stringify(active.units).replace(/"/g,'&quot;')},count:15})">继续练习</button>
            <button class="btn btn-ghost btn-sm" onclick="App.completeGoal('${active.id}')">标记完成</button>
            <button class="btn btn-danger btn-sm" onclick="App.deleteGoal('${active.id}')">删除</button>
          </div>
        </div>
      </div>`;
    }else{
      html+=`<div class="card" style="text-align:center;padding:24px">
        <div style="font-size:36px;margin-bottom:8px">🎯</div>
        <p class="muted" style="margin-bottom:14px">设定一个短期目标，系统会自动推荐相关题目</p>
      </div>`;
    }
    // 创建新目标
    html+=`<div class="section-title">➕ 创建新目标</div>`;
    html+=`<div class="card">
      <div class="goal-form">
        <div class="gf-row">
          <label>目标类型</label>
          <select id="goalType" onchange="App.updateGoalForm()">
            <option value="unit">单元专攻</option>
            <option value="weak">弱点突破</option>
            <option value="type">题型专练</option>
          </select>
        </div>
        <div class="gf-row" id="goalUnitsRow">
          <label>选择单元</label>
          <div class="gf-units">${UNITS.map(([u,name])=>`<label class="gf-unit"><input type="checkbox" value="${u}"> ${u}.${name}</label>`).join('')}</div>
        </div>
        <div class="gf-row" id="goalTypeRow" style="display:none">
          <label>题型</label>
          <select id="goalTypeSel">
            <option value="案例分析题">案例分析题</option>
            <option value="多选题">多选题</option>
            <option value="共用题干题">共用题干题</option>
            <option value="单选题">单选题</option>
          </select>
        </div>
        <div class="gf-row">
          <label>目标天数</label>
          <input type="number" id="goalDays" value="14" min="3" max="90" style="width:80px">
        </div>
        <div class="gf-row">
          <label>目标正确率（%）</label>
          <input type="number" id="goalAcc" value="75" min="50" max="100" style="width:80px">
        </div>
        <button class="btn btn-primary" onclick="App.createGoal()">创建目标</button>
      </div>
    </div>`;
    return html;
  }
  function updateGoalForm(){
    const type=document.getElementById('goalType').value;
    document.getElementById('goalUnitsRow').style.display=type==='unit'||type==='weak'?'':'none';
    document.getElementById('goalTypeRow').style.display=type==='type'?'':'none';
    // 弱点突破：自动勾选最弱单元
    if(type==='weak'){
      const weak=Report.weakList().slice(0,3);
      const weakUnits=new Set(weak.map(w=>w.u));
      document.querySelectorAll('.gf-unit input').forEach(cb=>{
        cb.checked=weakUnits.has(cb.value);
      });
    }
  }
  function createGoal(){
    const type=document.getElementById('goalType').value;
    const days=+document.getElementById('goalDays').value||14;
    const acc=+document.getElementById('goalAcc').value||75;
    let units=[],name='';
    if(type==='type'){
      const t=document.getElementById('goalTypeSel').value;
      units=Q.filter(q=>q.t===t).map(q=>q.u);
      units=[...new Set(units)];
      name=`${t}专项`;
    }else{
      units=[...document.querySelectorAll('.gf-unit input:checked')].map(cb=>cb.value);
      if(!units.length){toast('请至少选择一个单元');return}
      if(type==='weak')name='弱点突破';
      else name='单元专攻';
    }
    DB.addGoal({type,units,targetDays:days,targetAcc:acc,name});
    toast('✅ 目标已创建');
    render();
  }
  function completeGoal(id){
    DB.updateGoal(id,{done:true});
    toast('🎉 目标完成！恭喜');
    render();
  }
  function deleteGoal(id){
    if(!confirm('确定删除此目标？'))return;
    DB.removeGoal(id);
    toast('已删除');
    render();
  }

  // ===== 设置 =====
  function renderSettings(){
    const s=DB.getSettings();
    return `<div class="page-head"><h1>⚙️ 设置</h1><p>个性化与数据管理</p></div>
    <div class="card">
      <h3 style="margin-bottom:12px">外观</h3>
      <div class="setting-row"><div class="sr-info"><h4>夜间模式</h4><p>深色主题，护眼</p></div><div class="toggle ${s.theme==='dark'?'on':''}" onclick="App.toggleTheme()"></div></div>
      <div class="setting-row"><div class="sr-info"><h4>每日目标</h4><p>每天计划答题数</p></div><div><input type="number" min="5" max="100" value="${s.dailyTarget}" style="width:70px;padding:6px;border:1px solid var(--border-2);border-radius:6px;background:var(--surface);color:var(--text)" onchange="App.setDailyTarget(this.value)"> 题</div></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px">🎯 学习设置</h3>
      <div class="setting-row"><div class="sr-info"><h4>考试日期</h4><p>设置后仪表盘显示倒计时，自动生成备考计划</p></div><div><input type="date" value="${s.examDate||''}" style="padding:6px;border:1px solid var(--border-2);border-radius:6px;background:var(--surface);color:var(--text)" onchange="App.setExamDate(this.value)"></div></div>
      <div class="setting-row"><div class="sr-info"><h4>自动下一题</h4><p>提交答案后自动跳转下一题，刷题更快</p></div><div class="toggle ${s.autoNext?'on':''}" onclick="App.toggleAutoNext()"></div></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px">♿ 无障碍与舒适度</h3>
      <div class="setting-row"><div class="sr-info"><h4>字体大小</h4><p>调整全局字体大小</p></div><div>
        <select onchange="App.setFontSize(this.value)" style="padding:6px;border:1px solid var(--border-2);border-radius:6px;background:var(--surface);color:var(--text)">
          <option value="sm" ${s.fontSize==='sm'?'selected':''}>小 (14px)</option>
          <option value="md" ${s.fontSize==='md'||!s.fontSize?'selected':''}>标准 (15px)</option>
          <option value="lg" ${s.fontSize==='lg'?'selected':''}>大 (17px)</option>
          <option value="xl" ${s.fontSize==='xl'?'selected':''}>超大 (19px)</option>
        </select>
      </div></div>
      <div class="setting-row"><div class="sr-info"><h4>背景色调</h4><p>护眼模式，减少视觉疲劳</p></div><div>
        <select onchange="App.setBgTone(this.value)" style="padding:6px;border:1px solid var(--border-2);border-radius:6px;background:var(--surface);color:var(--text)">
          <option value="default" ${s.bgTone==='default'||!s.bgTone?'selected':''}>标准</option>
          <option value="green" ${s.bgTone==='green'?'selected':''}>护眼绿</option>
          <option value="cream" ${s.bgTone==='cream'?'selected':''}>米色</option>
        </select>
      </div></div>
      <div class="setting-row"><div class="sr-info"><h4>显示倒计时</h4><p>模考时显示计时器</p></div><div class="toggle ${s.showTimer!==false?'on':''}" onclick="App.toggleShowTimer()"></div></div>
      <div class="setting-row"><div class="sr-info"><h4>减少动效</h4><p>禁用过渡动画，适合低性能设备</p></div><div class="toggle ${s.reduceMotion?'on':''}" onclick="App.toggleReduceMotion()"></div></div>
      <div class="setting-row"><div class="sr-info"><h4>选项随机排列</h4><p>打乱选项顺序，防止背诵位置</p></div><div class="toggle ${s.shuffleOpts?'on':''}" onclick="App.toggleShuffleOpts()"></div></div>
      <div class="setting-row"><div class="sr-info"><h4>模考前呼吸引导</h4><p>模考前15秒呼吸放松练习</p></div><div class="toggle ${s.breathingGuide!==false?'on':''}" onclick="App.toggleBreathingGuide()"></div></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px">数据管理</h3>
      <div class="setting-row"><div class="sr-info"><h4>导出全部数据</h4><p>导出答题记录、错题本、能力图谱（JSON）</p></div><button class="btn btn-outline btn-sm" onclick="App.exportData()">导出</button></div>
      <div class="setting-row"><div class="sr-info"><h4>导入数据</h4><p>从备份文件恢复</p></div><button class="btn btn-outline btn-sm" onclick="App.importData()">导入</button></div>
      <div class="setting-row"><div class="sr-info"><h4>导出错题本</h4><p>导出为可打印的复习资料</p></div><button class="btn btn-outline btn-sm" onclick="App.exportWrong()">导出错题</button></div>
      <div class="setting-row"><div class="sr-info"><h4 style="color:var(--danger)">重置全部</h4><p>清除所有答题记录与进度，不可恢复</p></div><button class="btn btn-danger btn-sm" onclick="App.resetData()">重置</button></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:8px">👤 学习档案</h3>
      <div class="setting-row"><div class="sr-info"><h4>当前用户</h4><p>${User.getName()} · 数据独立存储，互不干扰</p></div><span class="tag tag-cog" style="background:var(--primary);color:#fff">${User.getName()}</span></div>
      <div class="setting-row"><div class="sr-info"><h4>切换用户</h4><p>多人共用本系统时切换自己的档案</p></div><button class="btn btn-outline btn-sm" onclick="App.switchUser()">切换</button></div>
      <div class="setting-row"><div class="sr-info"><h4>新建档案</h4><p>为另一位使用者创建独立学习档案</p></div><button class="btn btn-outline btn-sm" onclick="App.addUser()">新建</button></div>
      <div class="detail-list" style="margin-top:10px;font-size:12px">
        <b>数据隔离说明</b>：每位用户拥有独立的答题记录、错题本、学习进度与设置，导出/导入数据也按档案隔离。
      </div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:8px">🔒 访问控制</h3>
      <div class="setting-row"><div class="sr-info"><h4>当前会话</h4><p>${API.getShareCode()?'通过分享链接 '+API.getShareCode()+' 进入':'直接访问'}</p></div><span class="tag tag-cog">${API.getToken()?'已认证':'未认证'}</span></div>
      ${API.getShareCode()?`<div class="setting-row"><div class="sr-info"><h4>分享码</h4><p>当前分享链接独立统计，数据与其他用户隔离</p></div><code style="background:var(--surface-3);padding:6px 10px;border-radius:6px;font-size:13px">${API.getShareCode()}</code></div>`:''}
      <div class="setting-row"><div class="sr-info"><h4>退出登录</h4><p>清除当前会话，返回登录页</p></div><button class="btn btn-danger btn-sm" onclick="App.doLogout()">退出</button></div>
      <div class="detail-list" style="margin-top:10px;font-size:12px">
        <b>安全说明</b>：答案验证在后端完成，前端代码中不包含正确答案。每个分享链接的数据完全隔离。
      </div>
    </div>
    <div class="card" id="adminPanelCard" style="display:none">
      <h3 style="margin-bottom:8px">🔐 管理面板</h3>
      <div id="adminPanelContent"></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:8px">关于</h3>
      <div class="detail-list">
        <b>题库规模</b>：${Q.length} 题，覆盖官方考纲全部17单元<br>
        <b>模块权重</b>：专业知识30% · 专业实践能力50% · 学科新进展20%<br>
        <b>题型配比</b>：单选${Q.filter(q=>q.t==='单选题').length} · 多选${Q.filter(q=>q.t==='多选题').length} · 共用题干${Q.filter(q=>q.t==='共用题干题').length} · 案例${Q.filter(q=>q.t==='案例分析题').length}<br>
        <b>来源声明</b>：依据《放射医学技术（副高级）考试大纲》与《放射医学技术高级教程》知识点编制；如标注"考生回忆版"为公开渠道回忆，未经官方确认。<br>
        <b>数据存储</b>：全部本地浏览器存储，不上传服务器，可离线使用。
      </div>
    </div>`;
  }

  // ===== 事件绑定与工具 =====
  function bindEvents(){}
  function setWrongFilter(f){wrongFilter=f;render()}
  function setWrongTab(t){wrongTab=t;render()}
  function setDailyTarget(v){DB.setSetting('dailyTarget',Math.max(5,Math.min(100,+v||30)));toast('已设置每日目标 '+v+' 题')}
  function setExamDate(v){DB.setSetting('examDate',v||null);toast(v?'✅ 考试日期已设置，将自动生成备考计划':'已清除考试日期');render()}
  function toggleAutoNext(){const s=DB.getSettings();const nv=!s.autoNext;DB.setSetting('autoNext',nv);toast(nv?'✅ 已开启自动下一题':'已关闭自动下一题');render()}
  // ★ 无障碍设置
  function setFontSize(v){DB.setSetting('fontSize',v);document.documentElement.dataset.font=v;toast('字体大小已设置');render()}
  function setBgTone(v){DB.setSetting('bgTone',v);document.documentElement.dataset.bg=v;toast('背景色调已设置');render()}
  function toggleShowTimer(){const s=DB.getSettings();const nv=s.showTimer===false;DB.setSetting('showTimer',nv);toast(nv?'已显示倒计时':'已隐藏倒计时');render()}
  function toggleReduceMotion(){const s=DB.getSettings();const nv=!s.reduceMotion;DB.setSetting('reduceMotion',nv);document.documentElement.dataset.motion=nv?'off':'on';toast(nv?'已减少动效':'已恢复动效');render()}
  function toggleShuffleOpts(){const s=DB.getSettings();const nv=!s.shuffleOpts;DB.setSetting('shuffleOpts',nv);toast(nv?'已开启选项随机':'已关闭选项随机');render()}
  function toggleBreathingGuide(){const s=DB.getSettings();const nv=s.breathingGuide===false;DB.setSetting('breathingGuide',nv);toast(nv?'已开启呼吸引导':'已关闭呼吸引导');render()}
  // ★ A4打印导出
  function exportWrongPrint(){
    const wrong=DB.getWrong();const ids=Object.keys(wrong).filter(k=>!wrong[k].mastered);
    if(!ids.length){toast('错题本为空');return}
    const w=window.open('','_blank');
    let html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>错题本打印 - ${new Date().toLocaleDateString()}</title>
    <style>
    @page{size:A4;margin:15mm 12mm}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.8;color:#333}
    .print-header{text-align:center;border-bottom:2px solid #0e7c7b;padding-bottom:10px;margin-bottom:16px}
    .print-header h1{font-size:18px;color:#0e7c7b}
    .print-header p{font-size:11px;color:#999;margin-top:4px}
    .q-item{page-break-inside:avoid;margin-bottom:18px;border:1px solid #e0e0e0;border-radius:6px;padding:12px}
    .q-meta{font-size:11px;color:#888;margin-bottom:6px}
    .q-stem{font-size:13px;font-weight:500;margin-bottom:8px}
    .q-opts{margin-bottom:8px}
    .q-opt{padding:2px 0 2px 20px;text-indent:-20px}
    .q-blank{border-bottom:1px dashed #ccc;display:inline-block;width:60px;margin:0 4px}
    .q-answer{font-size:11px;color:#666;margin-top:6px;padding-top:6px;border-top:1px dashed #e0e0e0}
    .notes-area{margin-top:8px;border:1px dashed #ccc;border-radius:4px;height:50px}
    .notes-label{font-size:10px;color:#aaa;margin-bottom:2px}
    </style></head><body>
    <div class="print-header">
      <h1>放射医学技术副高 · 我的错题本</h1>
      <p>导出日期：${new Date().toLocaleDateString()} · 共 ${ids.length} 题</p>
    </div>`;
    ids.forEach((id,i)=>{
      const q=Q.find(x=>x.id===id);if(!q)return;
      const opts=q.o||q['选项']||{};
      html+=`<div class="q-item">
        <div class="q-meta">第 ${i+1} 题 · ${q.t||q['题型']} · ${q.d||q['难度']} · ${q.un||q['单元名']||''}</div>
        <div class="q-stem">${esc(q.s||q['题干'])}</div>
        <div class="q-opts">${'ABCDE'.split('').map(k=>opts[k]?`<div class="q-opt">${k}. ${opts[k]}</div>`:'').join('')}</div>
        <div class="q-answer">正确答案：______ 我的答案：______ 错误次数：${wrong[id].count}</div>
        <div class="notes-label">📝 笔记区：</div>
        <div class="notes-area"></div>
      </div>`;
    });
    html+=`</body></html>`;
    w.document.write(html);
    w.document.close();
    setTimeout(()=>{w.print();toast('已打开打印预览')},500);
  }
  function previewQuestion(id){
    const q=Q.find(x=>x.id===id);if(!q)return;
    const dmap={'易':'tag-easy','中':'tag-mid','难':'tag-hard'};
    const ex=q.ex||'';
    const goodM=ex.match(/【为什么对】([\s\S]*?)(?=【为什么错】|$)/);
    const badM=ex.match(/【为什么错】([\s\S]*?)$/);
    const main=document.getElementById('main');
    main.innerHTML=`<div class="page-head"><h1>📖 题目详情</h1><button class="btn btn-ghost btn-sm" onclick="App.go('${view==='wrong'?'wrong':'review'}')">← 返回</button></div>
    <div class="card">
      <div class="qmeta" style="margin-bottom:12px"><span class="tag tag-type">${q.t}</span><span class="tag ${dmap[q.d]}">${q.d}</span><span class="tag tag-cog">${q.c}</span><span class="tag tag-module">${q.un}</span></div>
      ${q.gs?`<div class="group-stem"><b>📋 共用题干</b>：${esc(q.gs)}</div>`:''}
      <div class="qstem">${esc(q.s)}</div>
      <div class="opts" style="margin-bottom:16px">${'ABCDE'.split('').map(k=>`<div class="opt"><div class="opt-key">${k}</div><div class="opt-text">${esc(q.o[k]||q['选项'][k])}</div></div>`).join('')}</div>
      <div class="explain"><h4>💡 解析</h4><div class="explain-body">${goodM?`<p><span class="why-good">为什么对：</span>${esc(goodM[1].trim())}</p>`:''}${badM?`<p><span class="why-bad">为什么错：</span>${esc(badM[1].trim())}</p>`:''}</div>${q.tr?`<div class="explain-trap"><b>⚠️ 易错陷阱：</b>${esc(q.tr)}</div>`:''}<div class="explain-kp"><span>🏷️ ${esc(q.kp)}</span><span>📚 ${esc(q.ch)}</span></div></div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-primary btn-sm" onclick="Quiz.start('free',{ids:['${id}'],count:1})">重做本题</button></div>
    </div>`;
  }
  function markMastered(id){const w=DB.getWrong()[id];if(w){w.mastered=1;DB.save();toast('已标记为掌握');render()}}
  function exportData(){const data=DB.exportAll();const blob=new Blob([data],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='放射副高题库_数据备份_'+new Date().toISOString().slice(0,10)+'.json';a.click();toast('已导出数据备份')}
  function importData(){const i=document.createElement('input');i.type='file';i.accept='.json';i.onchange=e=>{const f=e.target.files[0];const r=new FileReader();r.onload=()=>{try{DB.importAll(r.result);toast('导入成功');render()}catch(err){toast('导入失败：文件格式错误')}};r.readAsText(f)};i.click()}
  function exportWrong(){
    const wrong=DB.getWrong();const ids=Object.keys(wrong).filter(k=>!wrong[k].mastered);
    if(!ids.length){toast('错题本为空');return}
    let txt=`放射医学技术副高 · 错题本导出\n生成时间：${new Date().toLocaleString()}\n共 ${ids.length} 道错题\n${'='.repeat(60)}\n\n`;
    ids.forEach((id,i)=>{const q=Q.find(x=>x.id===id);if(!q)return;txt+=`【错题 ${i+1}】${q.t||q['题型']} | ${q.d||q['难度']} | ${q.un||q['单元名']}\n${q.s||q['题干']}\n`;const opts=q.o||q['选项']||{};for(const k of 'ABCDE'){txt+=`  ${k}. ${opts[k]||''}\n`}txt+=`正确答案：[需登录后端查看]\n`;txt+=`解析：[需答题后查看]\n`;txt+=`\n${'-'.repeat(60)}\n\n`});
    const blob=new Blob([txt],{type:'text/plain;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='错题本_'+new Date().toISOString().slice(0,10)+'.txt';a.click();toast('已导出错题本');
  }
  function doLogout(){API.logout();location.reload()}
  // 切换用户：回到用户选择界面
  function switchUser(){
    Quiz.exit(); // 退出当前答题会话，避免串号
    const ls=document.getElementById('lockScreen');
    document.querySelector('.layout').style.display='none';
    document.getElementById('quizOverlay').style.display='none';
    document.querySelector('.toast-wrap').style.display='none';
    ls.style.display='flex';
    ls.classList.remove('unlocked');
    showUserSelect();
  }
  // 新建档案
  function addUser(){
    const n=prompt('请输入新用户昵称（如：张三）：');
    if(!n||!n.trim()) return;
    const id=User.create(n.trim());
    User.setCurrent(id);
    localStorage.setItem('fsgf_user_created','1');
    DB.load(); // 重新加载新用户数据
    toast('已创建档案「'+n.trim()+'」并切换');
    render();
  }
  async function showAdminPanel(){
    const card = document.getElementById('adminPanelCard');
    const content = document.getElementById('adminPanelContent');
    card.style.display = '';
    let sys,shares;
    try{
      sys=await API.systemStatus();
      shares=await API.listShares();
    }catch(e){
      sys={system:{total_questions:0,active_shares:0,total_sessions:0,total_records:0}};
      shares={shares:[]};
      toast('管理面板数据加载失败，使用本地模式');
    }

    content.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div class="stat-card"><div class="sc-val">${sys.system.total_questions}</div><div class="sc-label">题目总数</div></div>
        <div class="stat-card"><div class="sc-val">${sys.system.active_shares}</div><div class="sc-label">活跃分享</div></div>
        <div class="stat-card"><div class="sc-val">${sys.system.total_sessions}</div><div class="sc-label">总用户数</div></div>
        <div class="stat-card"><div class="sc-val">${sys.system.total_records}</div><div class="sc-label">总答题数</div></div>
      </div>
      <h4 style="margin:12px 0 8px">创建新分享</h4>
      <div class="grid grid-2" style="margin-bottom:14px">
        <input type="text" id="newShareName" placeholder="分享名称（如：张三备考组）" style="height:38px;padding:0 10px;border:1px solid var(--border-2);border-radius:8px;background:var(--surface);color:var(--text)">
        <input type="password" id="newSharePwd" placeholder="访问密码（留空=免密）" style="height:38px;padding:0 10px;border:1px solid var(--border-2);border-radius:8px;background:var(--surface);color:var(--text)">
        <input type="number" id="newShareMax" placeholder="最大使用次数（-1=不限）" value="-1" style="height:38px;padding:0 10px;border:1px solid var(--border-2);border-radius:8px;background:var(--surface);color:var(--text)">
        <input type="number" id="newShareExpire" placeholder="有效天数（0=永久）" value="30" style="height:38px;padding:0 10px;border:1px solid var(--border-2);border-radius:8px;background:var(--surface);color:var(--text)">
      </div>
      <button class="btn btn-primary btn-sm" onclick="App.createShareAction()">➕ 创建分享链接</button>
      <div id="shareResult" style="margin-top:10px"></div>

      <h4 style="margin:18px 0 8px">已有分享列表 (${shares.shares.length})</h4>
      <div id="sharesList"></div>
    `;
    renderSharesList(shares.shares);
  }

  async function createShareAction(){
    const name = document.getElementById('newShareName').value.trim();
    const password = document.getElementById('newSharePwd').value;
    const maxUses = parseInt(document.getElementById('newShareMax').value) || -1;
    const expireDays = parseInt(document.getElementById('newShareExpire').value) || 0;
    if (!name) { toast('请输入分享名称'); return; }
    const r = await API.createShare({ name, password, max_uses: maxUses, expire_days: expireDays });
    if (r.ok) {
      const url = location.origin + location.pathname + '?share=' + r.share.code + (password ? '&pwd=' + password : '');
      document.getElementById('shareResult').innerHTML = `
        <div class="card" style="background:var(--success-l);border-color:var(--success);margin-top:10px">
          <b>✅ 分享链接已创建</b><br>
          <code style="word-break:break-all;font-size:13px">${url}</code>
          <br><button class="btn btn-outline btn-sm" style="margin-top:6px" onclick="navigator.clipboard.writeText('${url}');this.textContent='已复制'">📋 复制链接</button>
          <span style="margin-left:8px;font-size:12px;color:var(--text-3)">密码: ${password || '(免密)'}</span>
        </div>`;
      // 刷新列表
      const shares = await API.listShares();
      renderSharesList(shares.shares);
    } else {
      toast('创建失败: ' + (r.error || '未知错误'));
    }
  }

  function renderSharesList(shares){
    const container = document.getElementById('sharesList');
    if (!shares.length) { container.innerHTML = '<p class="muted">暂无分享记录</p>'; return; }
    container.innerHTML = shares.map(s => `
      <div class="card" style="margin-bottom:8px;padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div>
            <b>${s.name || '(未命名)'}</b> · <code style="font-size:12px">${s.code}</code>
            ${s.password ? '<span class="tag tag-easy" style="margin-left:6px">有密码</span>' : '<span class="tag tag-mid" style="margin-left:6px">免密</span>'}
            ${!s.is_active ? '<span class="tag tag-hard" style="margin-left:6px">已禁用</span>' : ''}
            <div class="muted" style="font-size:11px;margin-top:3px">
              使用 ${s.use_count}/${s.max_uses==-1?'∞':s.max_uses} 次 ·
              ${s.stats.unique_users} 用户 · ${s.stats.total_answers} 答题 · 正确率 ${s.stats.avg_accuracy}%
              ${s.expires_at? '· 过期 '+s.expires_at.slice(0,10): ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <button class="btn btn-ghost btn-sm" onclick="App.viewShareStats(${s.id})">📊 统计</button>
            <button class="btn btn-outline btn-sm" onclick="App.toggleShareAction(${s.id})">${s.is_active?'禁用':'启用'}</button>
            <button class="btn btn-danger btn-sm" onclick="App.deleteShareAction(${s.id})">删除</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  async function viewShareStats(id){
    const r = await API.shareStats(id);
    if (!r.ok) { toast(r.error); return; }
    const s = r.share_info;
    const o = r.overview;
    alert(`分享 [${s.code}] ${s.name}\n\n使用次数: ${s.use_count}\n用户数: ${o.unique_users}\n总答题: ${o.total_answers}\n正确率: ${o.accuracy}%\n\n详细数据可在控制台查看`);
    console.log('[Admin] Share Stats:', r);
  }

  async function toggleShareAction(id){
    await API.toggleShare(id);
    const shares = await API.listShares();
    renderSharesList(shares.shares);
    toast('状态已更新');
  }
  async function deleteShareAction(id){
    if (!confirm('确定删除此分享？该分享的所有答题数据将被清除且不可恢复！')) return;
    await API.deleteShare(id);
    const shares = await API.listShares();
    renderSharesList(shares.shares);
    toast('已删除');
  }
  function resetData(){if(confirm('⚠️ 确定要清除所有答题记录、错题本、勋章与段位吗？此操作不可恢复！')){DB.reset();toast('已重置全部数据');setTimeout(()=>location.reload(),500)}}
  function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

  // ================= 通用弹窗 =================
  function openModal(html){
    closeModal();
    const m=document.createElement('div');m.id='appModal';m.className='app-modal';
    m.innerHTML='<div class="app-modal-mask" onclick="App.closeModal()"></div><div class="app-modal-box">'+html+'</div>';
    document.body.appendChild(m);
  }
  function closeModal(){const m=document.getElementById('appModal');if(m)m.remove();}

  // ================= 教材视图（功能1） =================
  let tbkIndex={};
  function textbookLinked(){
    const m={};
    for(const q of Q){ if(q.ref&&q.ref.篇){ const k=q.ref.章?q.ref.篇+'|'+q.ref.章+'|'+q.ref.节:q.ref.篇; (m[k]=m[k]||[]).push(q);} }
    return m;
  }
  let tbkOpenPart=null;   // 当前展开的篇（按需渲染，避免一次性输出 400KB HTML）
  function toggleBookPart(name){ tbkOpenPart = (tbkOpenPart===name)?null:name; render(); }
  function renderTextbook(){
    const linked=textbookLinked();
    tbkIndex={};
    // 首次进入默认展开第一篇；从答题跳转过来则展开对应篇
    if(textbookFocus) tbkOpenPart=textbookFocus;
    else if(tbkOpenPart===null&&TB.parts.length) tbkOpenPart=TB.parts[0].name;
    const totalCh=TB.parts.reduce((a,p)=>a+(p.chapters||[]).length,0);
    const totalSec=TB.parts.reduce((a,p)=>a+(p.chapters||[]).reduce((b,c)=>b+(c.sections||[]).length,0),0);
    const totalLinked=Q.filter(q=>q.ref&&q.ref.篇).length;
    let html=`<div class="page-head"><h1>📖 教材 · 放射学高级教程</h1>
      <p>高级卫生专业技术资格考试指导用书 · ${TB.parts.length}篇 / ${totalCh}章 / ${totalSec}节 · 当前板块 ${totalLinked} 道题已关联到具体章节页码</p></div>`;
    html+=`<div class="tbk-search"><input id="tbkSearch" placeholder="🔍 搜索章节名称（如：颅脑CT、乳腺、心脏）" oninput="App.searchBook(this.value)"></div>
      <div id="tbkSearchResult"></div>`;
    let pi=0;
    for(const part of TB.parts){
      pi++;
      const open = tbkOpenPart===part.name;
      const chN=(part.chapters||[]).length;
      const secN=(part.chapters||[]).reduce((b,c)=>b+(c.sections||[]).length,0);
      html+=`<div class="tbk-part${open?' active':''}">
        <h3 class="tbk-part-h" onclick="App.toggleBookPart(${JSON.stringify(part.name).replace(/"/g,'&quot;')})">
          <span>${open?'▾':'▸'} 第${pi}篇 · ${esc(part.name)}</span>
          <span class="tbk-part-meta">${chN}章 / ${secN}节</span>
        </h3>`;
      if(open){
        let ci=0;
        for(const ch of (part.chapters||[])){
          ci++;
          html+=`<div class="tbk-chap"><h4>${esc(ch.title)}${ch.page?' <span class="tbk-pg">P.'+ch.page+'</span>':''}</h4>`;
          let si=0;
          for(const s of (ch.sections||[])){
            si++;
            const sid='tbk-'+pi+'-'+ci+'-'+si;
            tbkIndex[s.title]=sid;
            const key=part.name+'|'+ch.title+'|'+s.title;
            const n=(linked[key]||[]).length||(linked[part.name]||[]).length;
            const flash = (textbookFocusSec&&textbookFocusSec===s.title)?' tbk-flash':'';
            html+=`<div class="tbk-sec${flash}" id="${sid}">
              <div class="tbk-sec-h"><b>${esc(s.title)}</b>${s.page?' <span class="tbk-pg">P.'+s.page+'</span>':''} ${n?`<span class="tbk-count">${n}题关联</span>`:''}</div>
              ${s.body?`<div class="tbk-body">${esc(s.body)}</div>`:''}
              ${n?`<button class="btn btn-outline btn-sm" style="margin-top:6px" onclick="App.previewBookQuestions(${JSON.stringify(key).replace(/"/g,'&quot;')})">📝 查看 ${n} 道关联题目</button>`:''}
            </div>`;
          }
          html+=`</div>`;
        }
      }
      html+=`</div>`;
    }
    return html;
  }
  function searchBook(kw){
    const box=document.getElementById('tbkSearchResult'); if(!box)return;
    kw=(kw||'').trim();
    if(kw.length<1){box.innerHTML='';return;}
    const linked=textbookLinked();
    const hits=[];
    for(const part of TB.parts){
      for(const ch of (part.chapters||[])){
        for(const s of (ch.sections||[])){
          if(s.title.includes(kw)||ch.title.includes(kw)){
            const key=part.name+'|'+ch.title+'|'+s.title;
            hits.push({part:part.name,ch:ch.title,sec:s.title,page:s.page||ch.page,n:(linked[key]||[]).length||(linked[part.name]||[]).length,key});
          }
          if(hits.length>=60)break;
        }
      }
    }
    if(!hits.length){box.innerHTML=`<div class="card muted" style="padding:12px">未找到含「${esc(kw)}」的章节</div>`;return;}
    box.innerHTML=`<div class="card"><b>🔍 命中 ${hits.length} 个章节</b>`+hits.map(h=>
      `<div class="tbk-hit">
         <div><b>${esc(h.sec)}</b> <span class="muted" style="font-size:12px">${esc(h.part)} › ${esc(h.ch)}</span>${h.page?' <span class="tbk-pg">P.'+h.page+'</span>':''}</div>
         ${h.n?`<button class="btn btn-outline btn-sm" onclick="App.previewBookQuestions(${JSON.stringify(h.key).replace(/"/g,'&quot;')})">${h.n} 题</button>`:'<span class="muted" style="font-size:12px">暂无关联题</span>'}
       </div>`).join('')+`</div>`;
  }
  function previewBookQuestions(key){
    const arr=Q.filter(q=>{ if(!q.ref||!q.ref.篇)return false; const k=q.ref.章?q.ref.篇+'|'+q.ref.章+'|'+q.ref.节:q.ref.篇; return k===key; });
    if(!arr.length){toast('该章节暂无关联题目');return;}
    let h=`<div class="modal-head"><h3>📝 关联题目（${arr.length}）</h3><button class="modal-x" onclick="App.closeModal()">✕</button></div><div class="modal-list">`;
    for(const q of arr.slice(0,200)){
      h+=`<div class="modal-item" onclick="App.closeModal();App.previewQuestion('${q.id}')"><span class="tag tag-cog">${esc(q.c)}</span> ${esc(q.s.slice(0,60))}${q.s.length>60?'…':''}</div>`;
    }
    h+=`</div><div class="modal-foot"><button class="btn btn-primary btn-sm" onclick="App.closeModal();Quiz.start('free',{ids:${JSON.stringify(arr.map(x=>x.id)).replace(/"/g,'&quot;')},count:${arr.length}})">▶ 练习这些题</button></div>`;
    openModal(h);
  }

  // ================= 笔记视图（功能3） =================
  function renderNotes(){
    const notes=DB.getAllNotes();
    let html=`<div class="page-head"><h1>📝 我的笔记</h1><p>共 ${notes.length} 条 · 按题目关联存储，支持检索与编辑</p></div>`;
    html+=`<div class="note-search"><input id="noteSearch" placeholder="🔍 搜索笔记内容 / 标签 / 题号" oninput="App.searchNotesLive(this.value)"><span class="note-count" id="noteCount">${notes.length}</span></div>`;
    if(!notes.length){
      html+=`<div class="empty-state"><div class="es-ico">📝</div><p>还没有笔记。答题后点击「📝 记笔记」即可添加</p></div>`;
      return html;
    }
    html+=`<div id="noteList">`+notes.map(n=>noteCard(n)).join('')+`</div>`;
    return html;
  }
  function noteCard(n){
    const q=Q.find(x=>x.id===n.qid);
    return `<div class="note-card" data-nid="${n.id}">
      <div class="note-top">
        <span class="note-qid">#${esc(n.qid)}</span>
        ${(n.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}
        <span class="note-time">${new Date(n.updated).toLocaleDateString()}</span>
      </div>
      <div class="note-text">${esc(n.text)}</div>
      ${q?`<div class="note-q">📌 ${esc(q.s.slice(0,70))}${q.s.length>70?'…':''}</div>`:''}
      <div class="note-actions">
        <button class="btn btn-ghost btn-sm" onclick="App.openNote('${n.qid}')">查看/编辑</button>
        ${q?`<button class="btn btn-outline btn-sm" onclick="App.previewQuestion('${n.qid}')">看原题</button>`:''}
        <button class="btn btn-danger btn-sm" onclick="App.delNote('${n.id}')">删除</button>
      </div>
    </div>`;
  }
  function searchNotesLive(kw){
    const list=DB.searchNotes(kw);
    const box=document.getElementById('noteList');
    const cnt=document.getElementById('noteCount');
    if(box) box.innerHTML=list.map(n=>noteCard(n)).join('')||'<div class="empty-state"><div class="es-ico">🔍</div><p>无匹配笔记</p></div>';
    if(cnt) cnt.textContent=list.length;
  }
  function delNote(id){
    if(confirm('确定删除这条笔记？')){DB.deleteNote(id);toast('已删除');updateTopbar();render();}
  }
  // 笔记编辑弹窗（从答题页或笔记页调用）
  function openNote(qid){
    const q=Q.find(x=>x.id===qid);
    const existing=DB.getNotesByQ(qid);
    const existHtml=existing.length?`<div class="note-exist">${existing.map(n=>`<div class="note-exist-item"><div class="ne-text">${esc(n.text)}</div><div class="ne-foot"><span>${new Date(n.updated).toLocaleDateString()}</span><button class="btn btn-danger btn-sm" onclick="App.delNote('${n.id}');App.openNote('${qid}')">删</button></div></div>`).join('')}</div>`:'<p class="muted" style="font-size:13px">暂无笔记，写下你的第一笔：</p>';
    let h=`<div class="modal-head"><h3>📝 记笔记 ${q?'· '+esc(q.s.slice(0,30))+'…':''}</h3><button class="modal-x" onclick="App.closeModal()">✕</button></div>
      ${q?`<div class="note-q-prev">${esc(q.s)}</div>`:''}
      ${existHtml}
      <textarea id="noteInput" class="note-input" placeholder="输入笔记内容（可记录易错点、口诀、个人理解…）"></textarea>
      <input id="noteTags" class="note-tag-input" placeholder="标签（用空格分隔，如：CT 伪影 记忆）">
      <div class="modal-foot">
        <button class="btn btn-primary" onclick="App.saveNote('${qid}')">💾 保存笔记</button>
      </div>`;
    openModal(h);
  }
  function saveNote(qid){
    const txt=document.getElementById('noteInput').value;
    const tags=(document.getElementById('noteTags').value||'').trim().split(/\s+/).filter(Boolean);
    if(!txt.trim()){toast('笔记内容不能为空');return;}
    DB.addNote(qid,txt,tags);
    toast('✅ 笔记已保存');closeModal();updateTopbar();
    if(view==='notes')render();
  }

  // ================= 高频考点视图（功能6） =================
  let hotUnit='', hotPage=0;
  const HOT_PAGE=40;
  function setHotUnit(u){hotUnit=u;hotPage=0;render()}
  function hotMore(){hotPage++;render()}
  function renderHot(){
    const HOT=window.HOTPOINTS||[];
    // 统计当前板块下每个考点的题量（一次遍历，避免 O(n²)）
    const cnt={};
    for(const q of Q){ if(q.kpid) cnt[q.kpid]=(cnt[q.kpid]||0)+1; }
    const list=HOT.filter(hp=>!hotUnit||hp.单元===hotUnit);
    const shown=list.slice(0,(hotPage+1)*HOT_PAGE);
    const totalQ=list.reduce((a,hp)=>a+(cnt[hp.知识点ID]||0),0);
    let html=`<div class="page-head"><h1>🔥 高频考点</h1>
      <p>依据近5年真题与题库知识点出现频次 + 难度/认知维度加权统计 · 共 ${HOT.length} 个高频考点，覆盖 ${totalQ} 道题</p></div>`;
    if(!HOT.length){return html+`<div class="empty-state"><div class="es-ico">🔥</div><p>高频考点数据生成中…</p></div>`;}
    // 单元筛选
    const units=[...new Set(HOT.map(h=>h.单元))].filter(Boolean);
    html+=`<div class="lecture-tabs"><button class="filter-chip ${hotUnit?'':'active'}" onclick="App.setHotUnit('')">全部</button>`
        + units.map(u=>`<button class="filter-chip ${hotUnit===u?'active':''}" onclick="App.setHotUnit('${u}')">${u}</button>`).join('')
        + `</div>`;
    html+=`<div class="card" style="display:flex;gap:8px;flex-wrap:wrap;padding:10px">
      <button class="btn btn-primary btn-sm" onclick="App.practiceAllHot()">▶ 高频考点专项练习（当前筛选）</button>
      <span class="muted" style="font-size:12px;align-self:center">显示 ${shown.length}/${list.length} 个</span>
    </div>`;
    html+=`<div class="hot-grid">`;
    shown.forEach((hp,i)=>{
      const n=cnt[hp.知识点ID]||0;
      const ref=hp.ref?`${esc(hp.ref.篇)}${hp.ref.章?' › '+esc(hp.ref.章):''}${hp.ref.节?' › '+esc(hp.ref.节):''}${hp.ref.页?' (P.'+hp.ref.页+')':''}`:'';
      html+=`<div class="hot-card">
        <div class="hot-rank">${i+1}</div>
        <div class="hot-main">
          <div class="hot-name">${esc(hp.知识点名称)}</div>
          <div class="hot-meta">${esc(hp.大纲章节||'')}</div>
          ${ref?`<div class="hot-ref">📖 ${ref}</div>`:''}
          <div class="hot-foot">
            <span class="tag">${n}题</span>
            ${n?`<button class="btn btn-outline btn-sm" onclick="App.startByKp('${hp.知识点ID}')">练这组</button>`:'<span class="muted" style="font-size:12px">本板块暂无题</span>'}
            ${hp.ref&&hp.ref.节?`<button class="btn btn-ghost btn-sm" onclick="App.openBook(${JSON.stringify(hp.ref).replace(/"/g,'&quot;')})">看教材</button>`:''}
          </div>
        </div>
      </div>`;
    });
    html+=`</div>`;
    if(shown.length<list.length){
      html+=`<div style="text-align:center;margin:14px 0"><button class="btn btn-outline" onclick="App.hotMore()">加载更多（还有 ${list.length-shown.length} 个）</button></div>`;
    }
    return html;
  }
  function startByKp(kpId){
    const ids=Q.filter(q=>q.kpid===kpId).map(q=>q.id);
    if(!ids.length){toast('当前板块下该考点暂无题目');return;}
    closeOverlay();Quiz.start('free',{ids,count:ids.length});
  }
  function practiceAllHot(){
    const HOT=window.HOTPOINTS||[];
    const set=new Set(HOT.filter(hp=>!hotUnit||hp.单元===hotUnit).map(hp=>hp.知识点ID));
    const ids=Q.filter(q=>set.has(q.kpid)).map(q=>q.id);
    if(!ids.length){toast('当前筛选下暂无题目');return;}
    const n=Math.min(ids.length,30);
    closeOverlay();Quiz.start('free',{ids,count:n});
    toast(`已抽取 ${n} 道高频考点题`);
  }

  // ================= 自动出题工具（功能5） =================
  let autoGenCache=[];
  function renderAuto(){
    const UNITS2=[['一','人体断面影像解剖'],['二','医学物理基础'],['三','医学影像设备与成像原理'],['四','对比剂'],['五','影像质量管理'],['六','数字X线成像基础'],['七','影像诊断学基础'],['八','普通X线检查技术'],['九','CT检查技术'],['十','MR检查技术'],['十一','DSA检查技术'],['十二','PACS技术'],['十三','图像打印技术'],['十四','数字X线技术进展'],['十五','DSA技术进展'],['十六','CT技术进展'],['十七','MR技术进展']];
    const unitOpts=UNITS2.map(([u,n])=>`<option value="${u}">${u}、${n}</option>`).join('');
    const typeOpts=['单选题','多选题','案例分析题','共用题干题'].map(t=>`<option value="${t}">${t}</option>`).join('');
    const diffOpts=['易','中','难'].map(t=>`<option value="${t}">${t}</option>`).join('');
    const cogOpts=['记忆','理解','应用','分析'].map(t=>`<option value="${t}">${t}</option>`).join('');
    let html=`<div class="page-head"><h1>🛠️ 自动出题工具</h1><p>按考纲章节 / 题型 / 难度 / 认知维度筛选，从题库或教材知识点一键生成练习集</p></div>`;
    html+=`<div class="auto-panel">
      <div class="auto-row">
        <label>单元</label><select id="aUnit"><option value="">全部</option>${unitOpts}</select>
        <label>题型</label><select id="aType"><option value="">全部</option>${typeOpts}</select>
      </div>
      <div class="auto-row">
        <label>难度</label><select id="aDiff"><option value="">全部</option>${diffOpts}</select>
        <label>认知</label><select id="aCog"><option value="">全部</option>${cogOpts}</select>
        <label>数量</label><input id="aCount" type="number" min="1" max="200" value="20">
      </div>
      <div class="auto-actions">
        <button class="btn btn-primary" onclick="App.genFromBank()">🔍 从题库筛选生成</button>
        <button class="btn btn-outline" onclick="App.genFromBook()">📖 从教材知识点生成</button>
      </div>
      <div id="autoResult"></div>
    </div>`;
    return html;
  }
  function shuffle(a){const x=a.slice();for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;}
  function genFromBank(){
    const u=document.getElementById('aUnit').value;
    const t=document.getElementById('aType').value;
    const d=document.getElementById('aDiff').value;
    const c=document.getElementById('aCog').value;
    let pool=[...Q];
    if(u)pool=pool.filter(q=>q.u===u);
    if(t)pool=pool.filter(q=>q.t===t);
    if(d)pool=pool.filter(q=>q.d===d);
    if(c)pool=pool.filter(q=>q.c===c);
    if(!pool.length){document.getElementById('autoResult').innerHTML='<p class="muted">无匹配题目，请放宽条件</p>';return;}
    const cnt=Math.min(parseInt(document.getElementById('aCount').value)||20,pool.length);
    autoGenCache=shuffle(pool).slice(0,cnt);
    showGenResult('题库筛选');
  }
  function genFromBook(){
    // 从教材「基础概念」篇的原文定义生成概念辨析题（答案与解析均出自教材原文，不虚构医学结论）
    const base=getPart0();
    if(!base){document.getElementById('autoResult').innerHTML='<p class="muted">教材基础概念数据缺失</p>';return;}
    const secs=[];
    for(const ch of base.chapters) for(const s of ch.sections) if(s.body&&s.body.length>=18) secs.push(s);
    if(!secs.length){document.getElementById('autoResult').innerHTML='<p class="muted">教材原文条目不足</p>';return;}
    const cnt=Math.min(parseInt(document.getElementById('aCount').value)||20,secs.length);
    const pick=shuffle(secs).slice(0,cnt);
    const allTitles=[...new Set(secs.map(s=>s.title))];
    const LETTERS=['A','B','C','D'];
    autoGenCache=[];
    let seq=0;
    for(const s of pick){
      // 把定义正文里出现的术语名遮蔽，避免答案外泄
      let stem=s.body;
      const bare=s.title.replace(/\s+/g,'');
      stem=stem.replace(new RegExp(s.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'),'____')
               .replace(new RegExp(bare.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'),'____');
      if(stem.length>260) stem=stem.slice(0,260)+'…';
      const distract=shuffle(allTitles.filter(x=>x!==s.title)).slice(0,3);
      if(distract.length<3) continue;
      const order=shuffle([s.title,...distract]);
      const opts={}; let ans='A';
      order.forEach((title,i)=>{ opts[LETTERS[i]]=title; if(title===s.title) ans=LETTERS[i]; });
      const unit=/对比剂|造影剂|钆|碘/.test(s.title)?'四':(/CT|螺旋|重建/.test(s.title)?'九':(/MR|磁共振|磁化|射频/.test(s.title)?'十':'二'));
      autoGenCache.push({
        id:'GEN-BK-'+Date.now().toString(36)+'-'+(seq++),
        t:'单选题',
        s:'（教材原文辨析）下列描述对应的概念是：'+stem,
        o:opts,a:ans,d:'中',c:'记忆',m:'专业知识',u:unit,un:'基础概念（教材绪论）',
        kpid:'BOOK-'+bare,kp:s.title,ch:'基础概念（绪论）',
        ex:'【为什么对】教材原文：'+s.body+'【为什么错】其余选项为教材中的其他概念，定义边界不同。',
        tr:'相近术语易混，注意定义中的关键限定词（波长/能量/时相/序列名）。',
        bk:CUR_SEC,ref:{篇:'基础概念（绪论）',章:base.chapters[0].title,节:s.title,页:s.page||null},
        hf:false,src:'教材原文生成'
      });
    }
    if(!autoGenCache.length){document.getElementById('autoResult').innerHTML='<p class="muted">可用条目不足，请减少数量后重试</p>';return;}
    showGenResult('教材原文（概念辨析）');
  }
  function getPart0(){for(const p of TB.parts) if(p.idx===0) return p; return TB.parts[TB.parts.length-1];}
  function showGenResult(mode){
    const n=autoGenCache.length;
    let h=`<div class="gen-head">已生成 <b>${n}</b> 题（${mode}）· 将导入「${CUR_SEC}」板块</div><div class="gen-list">`;
    autoGenCache.slice(0,30).forEach((q,i)=>{
      h+=`<div class="gen-item"><span class="tag tag-cog">${esc(q.c)}</span> ${esc(q.s.slice(0,55))}…</div>`;
    });
    if(n>30)h+=`<div class="muted">…还有 ${n-30} 题</div>`;
    h+=`</div><div class="modal-foot"><button class="btn btn-primary" onclick="App.importGenerated()">⬇️ 一键导入当前板块</button><button class="btn btn-outline" onclick="App.practiceGenerated()">▶ 直接练习</button></div>`;
    document.getElementById('autoResult').innerHTML=h;
  }
  function importGenerated(){
    if(!autoGenCache.length){toast('请先生成题目');return;}
    for(const q of autoGenCache){DB.addImported(q);window.QUESTIONS.push(q);}
    toast('✅ 已导入 '+autoGenCache.length+' 题到'+CUR_SEC+'板块');
    autoGenCache=[];
    if(view==='dashboard'||view==='practice')render();
  }
  function practiceGenerated(){
    if(!autoGenCache.length){toast('请先生成题目');return;}
    const ids=autoGenCache.map(q=>q.id);
    for(const q of autoGenCache){if(!window.QUESTIONS.find(x=>x.id===q.id))window.QUESTIONS.push(q);}
    closeModal();Quiz.start('free',{ids,count:ids.length});
  }
  return {init,go,render,toast,toggleTheme,setWrongFilter,setDailyTarget,setExamDate,toggleAutoNext,openLecture,previewQuestion,markMastered,exportData,importData,exportWrong,resetData,doLogout,showLock,showAdminPanel,createShareAction,viewShareStats,toggleShareAction,deleteShareAction,switchUser,addUser,selectUser,
    // ★ 新增
  setFontSize,setBgTone,toggleShowTimer,toggleReduceMotion,toggleShuffleOpts,toggleBreathingGuide,
  exportWrongPrint,setWrongTab,updateGoalForm,createGoal,completeGoal,deleteGoal,
    // ★ 双板块/教材/笔记/高频/自动出题
    setSection,getSection,openBook,toggleBookPart,searchBook,openNote,saveNote,delNote,searchNotesLive,closeModal,previewBookQuestions,startByKp,
    setHotUnit,hotMore,practiceAllHot,renderTextbook,renderNotes,renderHot,renderAuto,genFromBank,genFromBook,importGenerated,practiceGenerated};
})();
document.addEventListener('DOMContentLoaded',App.init);
