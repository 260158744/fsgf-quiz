/* ===== 答题引擎 ===== */
const Quiz=(()=>{
  const Q=window.QUESTIONS||[];
  const UNITS=['一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五','十六','十七'];
  let session=null; // {mode,queue,idx,answers,streak,maxStreak,startTime,typeFilter,unitFilter}
  let _offlineFallback=false; // 离线降级标志

  // ★ 动态读取：因为 questions_offline.js 是 defer 加载，初始化时还未执行
  // 所以不能用 const 捕获，必须每次动态读 window.QUESTIONS_OFFLINE
  function _getOffline(){
    return window.QUESTIONS_OFFLINE||null;
  }
  function findOfflineAnswer(qid){
    const QO=_getOffline();
    if(!QO) return null;
    const q=QO.find(x=>x.id===qid);
    return q?q.a:null;
  }
  function isOfflineAvailable(){
    const QO=_getOffline();
    return !!QO && QO.length>0;
  }

  // ===== 选题算法 =====
  function weakPoints(topN=5){
    const ab=DB.getAbility();const out=[];
    for(const k in ab){
      const a=ab[k];if(a.attempts>=3){const [u,c]=k.split('|');out.push({u,c,score:a.score,att:a.attempts})}
    }
    out.sort((x,y)=>x.score-y.score);return out.slice(0,topN);
  }
  function pick(mode,opt={}){
    let pool=[...Q];
    const seen=DB.seenIds();
    // 排除7天内答对过的
    if(mode!=='review'&&mode!=='exam'){
      pool=pool.filter(q=>!DB.isRecentCorrect(q.id));
    }
    // 单元过滤
    if(opt.unit) pool=pool.filter(q=>q.u===opt.unit);
    if(opt.type) pool=pool.filter(q=>q.t===opt.type);
    if(opt.module) pool=pool.filter(q=>q.m===opt.module);
    if(opt.ids) pool=pool.filter(q=>opt.ids.includes(q.id));
    // ★ 归因专项训练
    if(mode==='reason'){
      const reasonIds=DB.getWrongByReason(opt.reason);
      pool=Q.filter(q=>reasonIds.includes(q.id));
    }
    // ★ 目标练习模式
    if(mode==='goal'&&opt.units){
      pool=pool.filter(q=>opt.units.includes(q.u));
    }
    let queue=[];
    if(mode==='review'){
      const reviewIds=DB.getReview();
      pool=Q.filter(q=>reviewIds.includes(q.id));
      queue=shuffle(pool).slice(0,opt.count||Math.min(20,pool.length));
    }else if(mode==='exam'){
      // 全真模考:按真实比例分布,难度3:5:2,各单元加权
      const total=opt.count||50;
      queue=examAssemble(total);
    }else if(mode==='weak'){
      const wp=weakPoints(5);
      if(wp.length){
        const weakUnits=new Set(wp.map(w=>w.u));
        const weakPool=pool.filter(q=>weakUnits.has(q.u));
        const weakSel=shuffle(weakPool).slice(0,Math.round((opt.count||10)*0.8));
        const rest=shuffle(pool.filter(q=>!weakUnits.has(q.u))).slice(0,(opt.count||10)-weakSel.length);
        queue=[...weakSel,...rest];
      }else{
        // 无薄弱数据,退化为自由
        queue=adaptivePick(pool,opt.count||10);
      }
    }else if(mode==='memorize'){
      // 背题模式:从错题本+随机
      const wrongIds=Object.keys(DB.getWrong());
      const wPool=Q.filter(q=>wrongIds.includes(q.id));
      queue=shuffle(wPool.length?wPool:pool).slice(0,opt.count||10);
    }else{
      // 自由刷题:自适应(学习区优先)
      queue=adaptivePick(pool,opt.count||10);
    }
    return expandGroups(queue);
  }
  function adaptivePick(pool,n){
    const ab=DB.getAbility();
    const scored=pool.map(q=>{
      const k=q.u+'|'+q.c;const a=ab[k];
      let wr=a&&a.attempts>=1?a.wr:0.5;
      const base=q.d==='易'?0.85:q.d==='中'?0.65:0.40;
      const pred=wr*0.6+base*0.4;
      const inZone=pred>=0.5&&pred<=0.75;
      let w=inZone?1.3:1;
      if(q.t==='案例分析题') w*=1.1;
      if(q.t==='共用题干题') w*=1.05;
      return {q,w,pred};
    });
    scored.sort((a,b)=>b.w-a.w);
    const result=[];const used=new Set();
    for(const s of scored){if(result.length>=n)break;if(used.has(s.q.kp))continue;result.push(s.q);used.add(s.q.kp)}
    // 不够补齐
    if(result.length<n){for(const q of shuffle(pool)){if(result.length>=n)break;if(!result.includes(q))result.push(q)}}
    return shuffle(result);
  }
  function examAssemble(total){
    // 按大纲模块权重 30/50/20,题型 单选45% 多选25% 共用题干15% 案例15%
    const nSingle=Math.round(total*0.45),nMulti=Math.round(total*0.25),nGroup=Math.round(total*0.15),nCase=total-nSingle-nMulti-nGroup;
    const byMod={专业知识:0.3,专业实践能力:0.5,学科新进展:0.2};
    const out=[];
    for(const [mod,w] of Object.entries(byMod)){
      const modN=Math.round(total*w);
      const modPool=Q.filter(q=>q.m===mod);
      const s=Math.round(modN*0.45),m=Math.round(modN*0.25),g=Math.round(modN*0.15),c=modN-s-m-g;
      out.push(...shuffle(modPool.filter(q=>q.t==='单选题')).slice(0,s));
      out.push(...shuffle(modPool.filter(q=>q.t==='多选题')).slice(0,m));
      out.push(...shuffle(modPool.filter(q=>q.t==='共用题干题')).slice(0,g));
      out.push(...shuffle(modPool.filter(q=>q.t==='案例分析题')).slice(0,c));
    }
    // 共用题干题整组展开后截断到目标数
    return expandGroups(shuffle(out)).slice(0,total);
  }
  function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

  // ★ 统一判断：该题是否允许多选（共用题干题由 mk 字段标记，前端无答案）
  function isMultiQ(q){
    return q.t==='多选题' || q.t==='案例分析题' || (q.t==='共用题干题' && q.mk===1);
  }

  // ★ v1.1 共用题干题：抽到组内任一题则整组按原始顺序加入（保证病例在前）
  function expandGroups(qs){
    const out=[];const added=new Set();
    for(const q of qs){
      if(q.gid){
        if(added.has(q.gid))continue;
        added.add(q.gid);
        const members=Q.filter(x=>x.gid===q.gid);
        out.push(...members);
      }else{
        out.push(q);
      }
    }
    return out;
  }

  // ===== 会话控制 =====
  function start(mode,opt={}){
    // ★ 模考前呼吸引导
    if(mode==='exam' && DB.getSettings().breathingGuide!==false){
      showBreathingGuide(()=>{_start(mode,opt)});
      return;
    }
    _start(mode,opt);
  }
  function _start(mode,opt={}){
    const queue=pick(mode,opt);
    if(!queue.length){App.toast('没有可用的题目，请先调整筛选或清除答题记录');return false}
    session={mode,queue,idx:0,answers:[],streak:0,maxStreak:0,startTime:Date.now(),submitted:false,consecWrong:0,totalTime:0};
    document.getElementById('quizOverlay').hidden=false;
    render();
    return true;
  }
  function exit(){
    if(session&&session.answers.length){
      finishSession(false);
    }
    session=null;
    document.getElementById('quizOverlay').hidden=true;
    App.render();
  }
  function cur(){return session?session.queue[session.idx]:null}

  function render(){
    const q=cur();if(!q)return;
    session.submitted=false;
    session.qStart=Date.now();  // 记录本题开始时间
    // header
    document.getElementById('qprogText').textContent=`第 ${session.idx+1} / ${session.queue.length} 题`;
    document.getElementById('qprogFill').style.width=((session.idx)/session.queue.length*100)+'%';
    document.getElementById('streakPill').textContent='🔥 '+session.streak;
    // ★ TTS 朗读题目
    if(TTS.isEnabled()){
      TTS.speakQuestion(q);
    }
    // ★ 草稿纸加载已有内容
    const draft=DB.getDraft(q.id);
    if(draft)Sketch.loadStrokes(q.id,draft);
    // body
    const body=document.getElementById('quizBody');
    const isMulti=isMultiQ(q);
    const isCase=q.t==='案例分析题';
    const isGroup=!!q.gid;
    const modeClass=isMulti?'multi-mode':'single-mode';
    const dmap={'易':'tag-easy','中':'tag-mid','难':'tag-hard'};
    // 共用题干：组首题显示病例，后续小题显示提示（引用上一题的病例缓存）
    let groupBlock='';
    if(isGroup){
      if(q.gs){
        session.lastGstem=q.gs;
        groupBlock=`<div class="group-stem"><b>📋 共用题干</b>：${esc(q.gs)}</div>`;
      }else{
        groupBlock=`<div class="group-stem-ref">※ 共用题干：见上一题（同一病例场景）</div>`;
      }
    }else{
      session.lastGstem=null;
    }
    body.innerHTML=`
    <div class="quiz-body-inner">
      ${renderTools()}
      <div class="qmeta">
        <span class="tag tag-type">${q.t}</span>
        <span class="tag ${dmap[q.d]}">${q.d}</span>
        <span class="tag tag-cog">${q.c}</span>
        <span class="tag tag-module">${q.un}</span>
        <span class="muted" style="font-size:11px">${q.id}</span>
      </div>
      ${isCase?'<span class="case-tag">📋 案例分析题</span>':''}
      ${groupBlock}
      <div class="qstem">${esc(q.s)}</div>
      <div class="opts" id="optsBox">
        ${'ABCDE'.split('').map(k=>`
          <div class="opt ${modeClass}" data-k="${k}" onclick="Quiz.toggle('${k}')">
            <div class="opt-key">${isMulti?'':k}</div>
            <div class="opt-text">${esc(q.o[k])}</div>
          </div>`).join('')}
      </div>
      <div id="explainBox"></div>
    </div>`;
    // footer
    const ft=document.getElementById('quizFooter');
    // 多选题显示选中计数与提示
    const multiHint = isMulti
      ? `<span class="sel-count" id="selCount"><span class="sel-num" id="selNum">0</span><span class="sel-total">/ 5 可多选</span></span>`
      : `<span class="muted" style="font-size:12px;align-self:center">单选</span>`;
    ft.innerHTML=`
      <button class="btn btn-ghost btn-sm" onclick="Quiz.skip()">跳过</button>
      <div style="display:flex;gap:8px;align-items:center">
        ${multiHint}
        <button class="btn btn-primary" id="submitBtn" onclick="Quiz.submit()" disabled>提交</button>
      </div>`;
    session.sel=new Set();
  }
  function toggle(k){
    if(session.submitted)return;
    const q=cur();
    const isMulti=isMultiQ(q);
    const el=document.querySelector(`.opt[data-k="${k}"]`);
    if(isMulti){
      // 多选模式：勾选/取消
      if(session.sel.has(k)){session.sel.delete(k);el.classList.remove('selected')}
      else{session.sel.add(k);el.classList.add('selected')}
    }else{
      // 单选模式：切换选中项
      session.sel.clear();session.sel.add(k);
      document.querySelectorAll('.opt').forEach(o=>o.classList.remove('selected'));
      el.classList.add('selected');
    }
    // 更新提交按钮状态
    document.getElementById('submitBtn').disabled=session.sel.size===0;
    // 多选题更新选中计数
    const selNumEl=document.getElementById('selNum');
    if(selNumEl) selNumEl.textContent=session.sel.size;
  }
  /**
   * ═══════════════════════════════════════════════════════
   * 多选题评分标准（参照卫生专业技术资格考试历年真题）
   * ═══════════════════════════════════════════════════════
   *
   *  情况                    判定        得分    说明
   * ───────────────────────────────────────────────────
   *  A. 所选 = 正确答案集合     完全正确     满分    全部选对
   *  B. 所选 ⊂ 正确答案 且无错选  部分正确     半分    少选但没选错
   *  C. 所选包含任何错误选项      错误         0分     错选则整题0分
   *  D. 未作答                  未答         0分
   *
   * 注：案例分析题视同多选题，按相同规则评分。
   * 单选题不受影响（A=满分, B/C/D=0分）。
   * ═══════════════════════════════════════════════════════
   */
  async function submit(){
    if(session.submitted)return;
    const q=cur();
    const userAns=[...session.sel].sort().join('');
    const isMulti=isMultiQ(q);
    session.submitted=true;
    // 禁用选项点击
    document.querySelectorAll('.opt').forEach(o=>{o.style.cursor='default'});
    document.getElementById('submitBtn').disabled=true;
    document.getElementById('submitBtn').textContent='提交中...';

    let correct=null;
    let usedOffline=false;
    let result=null;  // 保存 API 返回结果（用于解析等）

    // ★ 第一步：尝试后端 API 验证
    try {
      result = await API.submitAnswer(q.id, userAns, {
        mode: session.mode,
        timeSpent: Math.round((Date.now()-session.qStart)/1000)
      });
      if (result && result.ok && result.correct_answer) {
        correct = result.correct_answer;
      }
    } catch(e) {
      // API 不可达（网络断连等）
    }

    // ★ 第二步：API 失败 → 自动降级到本地答案校验
    if (!correct) {
      if (isOfflineAvailable()) {
        usedOffline = true;
        correct = findOfflineAnswer(q.id);
      }
    }

    // ★ 第三步：仍然没有答案 → 报错放行
    if (!correct) {
      App.toast('无法获取答案：网络不通且本地无离线数据，请连接网络后刷新页面');
      session.submitted = false;
      document.getElementById('submitBtn').disabled=false;
      document.getElementById('submitBtn').textContent='提交';
      return;
    }

    // 首次离线降级时提示
    if (usedOffline && !_offlineFallback) {
      _offlineFallback = true;
      App.toast('已切换至离线模式 · 数据校验正常');
    }

    // ── 计分与渲染 ──
    try {
      const correctSet = new Set(correct.split(''));   // 正确答案集合
      const userSet = new Set(userAns.split(''));       // 用户选择集合

      // ── 计算得分（前端计算，后端返回 is_correct 作为参考）──
      let scoreLevel;   // 'full' | 'partial' | 'zero'
      let scorePct;     // 百分比 100 | 50 | 0
      let ok;           // 布尔值（用于连胜等原有逻辑）

      if (userAns === correct) {
        // A. 完全匹配 → 满分
        scoreLevel = 'full'; scorePct = 100; ok = true;
      } else if (isMulti) {
        // 多选题/案例：检查是否有错选
        const hasWrongChoice = [...userSet].some(k => !correctSet.has(k));
        if (hasWrongChoice) {
          // C. 有错选 → 0分
          scoreLevel = 'zero'; scorePct = 0; ok = false;
        } else {
          // B. 无错选但有遗漏 → 部分得分（半分）
          scoreLevel = 'partial'; scorePct = 50; ok = false;
        }
      } else {
        // 单选不匹配 → 0分
        scoreLevel = 'zero'; scorePct = 0; ok = false;
      }

      // 标记选项视觉状态
      document.querySelectorAll('.opt').forEach(o=>{
        const k=o.dataset.k;
        if(correct.includes(k)) o.classList.add('correct');          // 正确答案标绿
        else if(userSet.has(k)) o.classList.add('wrong');            // 用户错选标红
        // 用户漏选的正确项：只标绿色（已在上面的 correct 处理），不加额外标记
      });

      // 记录到本地
      const dur=Math.round((Date.now()-session.qStart)/1000);
      DB.addRecord({qid:q.id,u:q.u,c:q.c,t:q.t,d:q.d,
        ok: scoreLevel==='full', userAns, at:new Date().toISOString(), dur});
      session.answers.push({qid:q.id,ok:scoreLevel==='full',userAns,correct,dur,scoreLevel,scorePct});

      if(ok){session.streak++;session.maxStreak=Math.max(session.maxStreak,session.streak)}
      else{session.streak=0}

      // XP（按实际得分比例）
      const baseXP = Gamify.xpFor(true, session.streak, q.t,
        !!DB.getWrong()[q.id]||session.mode==='review');
      const actualXP = scoreLevel==='full'?baseXP:(scoreLevel==='partial'?Math.ceil(baseXP*0.5):0);
      if(actualXP>0){DB.addXP(actualXP);showXP(actualXP)}
      DB.incDaily();

      // 解析 + 评分明细
      renderExplain(q, ok, userAns, correct, result, {isMulti,scoreLevel,scorePct,userSet,correctSet});

      // footer 结果显示
      const isLast=session.idx>=session.queue.length-1;
      const resultIcon = scoreLevel==='full'?'✓':scoreLevel==='partial'?'△':'✗';
      const resultText = scoreLevel==='full'?'回答正确':
                          scoreLevel==='partial'?'部分正确':'回答错误';
      const resultColor = scoreLevel==='full'?'var(--success)':
                           scoreLevel==='partial'?'var(--warn)':'var(--danger)';
      const xpText = actualXP>0 ? `<span style="color:var(--accent)">+${actualXP} XP</span>` :
                     scoreLevel==='partial' ? '<span class="muted" style="font-size:11px">少选得半分</span>' : '';
      // ★ 鼓励文案（答错时显示）
      const encourage = scoreLevel!=='full' ? `<div class="encourage">💬 ${encourageText(q,scoreLevel,session)}</div>` : '';

      document.getElementById('quizFooter').innerHTML=`
        <div style="display:flex;flex-direction:column;gap:4px;width:100%">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:13px;font-weight:700;color:${resultColor}">
              ${resultIcon} ${resultText} ${xpText}
            </div>
            <button class="btn btn-primary" id="nextBtn" onclick="Quiz.next()">${isLast?'查看本场结果 →':'下一题 →'}</button>
          </div>
          ${encourage}
        </div>`;

      // ★ P0-1 自动下一题（设置开启时）
      const settings=DB.getSettings();
      if(settings.autoNext && !isLast){
        const nb=document.getElementById('nextBtn');
        nb.textContent='下一题 → (自动跳转...)';
        nb.disabled=true;
        setTimeout(()=>{
          // 用户可能已手动点击，检查按钮是否还存在且未禁用
          const btn=document.getElementById('nextBtn');
          if(btn && btn.disabled){Quiz.next();}
        },1200);
      }

      // ★ TTS 朗读结果
      if(TTS.isEnabled()){
        TTS.speakResult(ok,scoreLevel);
        TTS.speakExplain((result&&result.explanation)||q.ex||'');
      }

      // ★ 费曼检验（答对关键概念题时触发）
      if(scoreLevel==='full'){tryFeynman(q)}

      // ★ 疲劳检测：连续答错时分级提醒
      if(!ok){
        session.consecWrong=(session.consecWrong||0)+1;
        if(session.consecWrong>=5){
          showRestPanel();
          session.consecWrong=0;
        }else if(session.consecWrong>=3){
          App.toast('🧠 连续答错 '+session.consecWrong+' 题，慢一点，仔细看题');
        }
      }else{
        session.consecWrong=0;
      }
      // ★ 学习超时检测
      session.totalTime+=dur;
      if(session.totalTime>2700&&!session._restShown){
        // 45分钟
        showRestPanel('timeout');
        session._restShown=true;
      }
    } catch(err) {
      console.error('[Quiz] Submit error:', err);
      App.toast('网络错误，请重试');
      session.submitted = false;
      document.getElementById('submitBtn').disabled=false;
      document.getElementById('submitBtn').textContent='提交';
    }
  }
  function renderExplain(q,ok,userAns,correct,apiResult,scoreInfo){
    const box=document.getElementById('explainBox');
    // 优先使用后端返回的解析，其次用本地题目数据
    const ex = (apiResult && apiResult.explanation) || q.ex || '';
    const trap = (apiResult && apiResult.trap) || q.tr || '';
    const goodM=ex.match(/【为什么对】([\s\S]*?)(?=【为什么错】|$)/);
    const badM=ex.match(/【为什么错】([\s\S]*?)$/);

    // ── 多选题评分明细 ──
    let scoreHTML = '';
    if (scoreInfo && scoreInfo.isMulti) {
      const {scoreLevel,scorePct,userSet,correctSet} = scoreInfo;
      const correctArr = [...correctSet].sort();
      const userArr = [...userSet].sort();
      // 计算各项数量
      const rightCount = [...userSet].filter(k=>correctSet.has(k)).length;   // 选对的
      const wrongCount = [...userSet].filter(k=>!correctSet.has(k)).length;   // 选错的
      const missedCount = [...correctSet].filter(k=>!userSet.has(k)).length;  // 漏选的

      const levelClass = scoreLevel==='full'?'full':scoreLevel==='partial'?'partial':'zero';
      const levelText = scoreLevel==='full'?'满分':
                         scoreLevel==='partial'?'部分得分（半分）':'不得分';

      scoreHTML = `
      <div class="score-breakdown">
        <div style="font-weight:700;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
          <span>📊 本题评分明细</span>
          <span class="sb-val ${levelClass}">${levelText} (${scorePct}%)</span>
        </div>
        <div class="sb-row"><span class="sb-label">正确答案：</span><span class="sb-val" style="color:var(--success)">${correctArr.join(' / ')}</span></div>
        <div class="sb-row"><span class="sb-label">你的选择：</span><span class="sb-val">${userArr.length?userArr.join(' / '):'<span style="color:var(--text-3)">未作答</span>'}</span></div>
        <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;text-align:center">
          <div style="background:var(--success-l);border-radius:6px;padding:6px">
            <div style="font-size:16px;font-weight:700;color:var(--success)">${rightCount}</div>
            <div style="font-size:10px;color:var(--text-3)">选对</div>
          </div>
          <div style="background:${wrongCount?'var(--danger-l)':'var(--surface)'};border-radius:6px;padding:6px">
            <div style="font-size:16px;font-weight:700;color:${wrongCount?'var(--danger)':'var(--text-3)'}">${wrongCount}</div>
            <div style="font-size:10px;color:var(--text-3)">选错</div>
          </div>
          <div style="background:${missedCount?'var(--warn-l)':'var(--surface)'};border-radius:6px;padding:6px">
            <div style="font-size:16px;font-weight:700;color:${missedCount?'var(--warn)':'var(--text-3)'}">${missedCount}</div>
            <div style="font-size:10px;color:var(--text-3)">漏选</div>
          </div>
        </div>
        <div class="score-rule-hint">
          <b>评分规则：</b>全选对→满分 · 少选无错→半分 · 有错选→0分
        </div>
      </div>`;
    }

    box.innerHTML=`<div class="explain">
      ${scoreHTML}
      <h4>💡 解析</h4>
      <div class="explain-body">
        ${goodM?`<p><span class="why-good">为什么对：</span>${hlKp(esc(goodM[1].trim()))}</p>`:''}
        ${badM?`<p><span class="why-bad">为什么错：</span>${hlKp(esc(badM[1].trim()))}</p>`:''}
        ${(!goodM&&!badM&&ex)?`<p>${hlKp(esc(ex))}</p>`:''}
      </div>
      ${trap?`<div class="explain-trap"><b>⚠️ 易错陷阱：</b>${hlKp(esc(trap))}</div>`:''}
      <div class="explain-kp">
        <span>🏷️ 知识点：${esc(q.kp)}</span>
        <span>📚 大纲：${esc(q.ch)}</span>
      </div>
      <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="App.openLecture('${q.u}')">📚 查阅「${esc(q.un)}」单元讲义 →</button>
      ${scoreInfo && scoreInfo.scoreLevel!=='full'?renderAttribution(q.id):''}
      ${renderAskTeacher(q)}
    </div>
    ${renderSimilarCard(q, scoreInfo)}`;
  }
  // ★ 解析关键词高亮（考试高频术语）
  const KP_TERMS=['信噪比','对比噪声比','空间分辨力','密度分辨力','时间分辨力','窗宽','窗位','CT值','磁化转移','脂肪抑制','化学位移','磁敏感','涡流','梯度场','射频脉冲','重复时间','回波时间','反转时间','激励次数','视野','层厚','层间距','矩阵','带宽','压缩感知','并行采集','DICOM','PACS','RIS','DSA','CTA','MRA','MRCP','MRS','DWI','ADC','BOLD','T1WI','T2WI','FLAIR','GRE','SE','TSE','EPI','IR','MPR','MIP','VR','kV','mA','mAs','钆','碘对比剂','对比剂','半衰期','防护','屏蔽','准直器','滤线栅','增感屏','量子检出效率','调制传递函数','噪声等效量子','自动曝光控制','多平面重组','曲面重组'];
  function hlKp(txt){
    if(!txt) return txt;
    for(const t of KP_TERMS){
      if(txt.includes(t)){
        txt=txt.split(t).join(`<b class="hl-kp">${t}</b>`);
      }
    }
    return txt;
  }
  // ★ P1-1 答错后推送同知识点相似题
  function renderSimilarCard(q, scoreInfo){
    if(!scoreInfo || scoreInfo.scoreLevel==='full') return '';
    const sameKp = Q.filter(x=>x.kp===q.kp && x.id!==q.id).slice(0,3);
    if(!sameKp.length) return '';
    const ids = sameKp.map(x=>x.id);
    return `<div class="similar-card">
      <div class="sc-head"><b>💪 巩固练习</b><span class="muted" style="font-size:11px">同知识点「${esc(q.kp)}」还有 ${sameKp.length} 题</span></div>
      <button class="btn btn-outline btn-sm" style="margin-top:6px" onclick="Quiz.start('free',{ids:${JSON.stringify(ids)},count:${sameKp.length}})">📝 立即巩固这 ${sameKp.length} 题</button>
    </div>`;
  }
  function showXP(xp){
    const el=document.createElement('div');el.className='xp-pop';el.textContent='+'+xp+' XP';
    document.body.appendChild(el);setTimeout(()=>el.remove(),800);
  }
  function next(){
    // ★ 保存草稿到错题
    const q=cur();
    if(q){
      const draft=Sketch.saveStrokes(q.id);
      if(draft)DB.setDraft(q.id,draft);
    }
    session.idx++;
    if(session.idx>=session.queue.length){
      finishSession(true);
    }else{
      session.qStart=Date.now();
      render();
    }
  }
  function skip(){
    session.idx++;
    if(session.idx>=session.queue.length){finishSession(true)}
    else{session.qStart=Date.now();render()}
  }
  function finishSession(showResult){
    const s=session;const dur=Math.round((Date.now()-s.startTime)/1000);
    const total=s.answers.length;
    // 按新的评分体系统计
    let fullCount=0,partialCount=0,zeroCount=0,totalScore=0;
    s.answers.forEach(a=>{
      if(a.ok){fullCount++;totalScore+=2}       // 满分2分
      else if(a.scoreLevel==='partial'){partialCount++;totalScore+=1}  // 半分1分
      else{zeroCount++}                          // 0分
    });
    const maxScore=total*2;
    const acc=total?Math.round(fullCount/total*100):0;
    const scoreRate=maxScore?Math.round(totalScore/maxScore*100):0;
    DB.addSession({mode:s.mode,start:s.startTime,dur,total,correct:fullCount,xp:0,ts:Date.now()});
    // 勋章检查
    const night=new Date().getHours()>=22||new Date().getHours()<2;
    const avgDur=s.answers.length?Math.round(s.answers.reduce((a,b)=>a+b.dur,0)/s.answers.length):0;
    const ctx={
      maxStreak:s.maxStreak,
      examPass:s.mode==='exam'&&acc>=60,
      examExcellent:s.mode==='exam'&&acc>=85,
      weakConquered:false,
      nightOwl:night,
      speedDemon:s.answers.length>=10&&avgDur<30&&acc>80,
      reviewCorrect:s.answers.filter(a=>a.ok).length // 粗略
    };
    const newBadges=Gamify.checkBadges(ctx);
    if(showResult&&s.answers.length){
      showSessionResult(s,fullCount,total,acc,dur,newBadges);
      // ★ 模考正向报告
      if(s.mode==='exam'){
        setTimeout(()=>showPositiveReport(s),100);
      }
    }
  }

  // ★ 正向成果报告
  function showPositiveReport(s){
    const prevSessions=DB.getSessions().filter(x=>x.mode==='exam'&&x.ts<s.startTime).sort((a,b)=>b.ts-a.ts);
    const prev=prevSessions[0];
    const improvements=[];
    // 从 session 重新计算当前正确率和用时
    const fullCount=s.answers.filter(a=>a.ok).length;
    const total=s.answers.length;
    const acc=total?Math.round(fullCount/total*100):0;
    const dur=Math.round((Date.now()-s.startTime)/1000);
    // 对比上次模考
    if(prev){
      if(acc>prev.correct/prev.total*100){
        improvements.push(`📈 正确率提升 ${Math.round(acc-prev.correct/prev.total*100)} 个百分点（上次 ${Math.round(prev.correct/prev.total*100)}%）`);
      }
      if(s.maxStreak>=5){
        improvements.push(`🔥 最长连胜 ${s.maxStreak} 题，专注力很棒`);
      }
      if(dur<prev.dur&&s.answers.length>=prev.total){
        improvements.push(`⚡ 用时缩短，答题效率提升`);
      }
    }else{
      improvements.push(`🎯 首次模考完成，迈出了重要一步`);
      if(s.maxStreak>=3)improvements.push(`🔥 最长连胜 ${s.maxStreak} 题`);
    }
    // 攻克的薄弱点
    const weakBefore=Report.weakList();
    const conquered=[];
    for(const w of weakBefore){
      // 如果本次该单元答题全对
      const unitAns=s.answers.filter(a=>Q.find(x=>x.id===a.qid)?.u===w.u);
      if(unitAns.length&&unitAns.every(a=>a.ok)){
        conquered.push(w.u);
      }
    }
    if(conquered.length){
      improvements.push(`✅ 攻克薄弱单元：${conquered.map(u=>{const qu=Q.find(x=>x.u===u);return qu?qu.un:u}).join('、')}`);
    }
    // 待提升
    const wrongUnits={};
    s.answers.filter(a=>!a.ok).forEach(a=>{
      const q=Q.find(x=>x.id===a.qid);
      if(q)wrongUnits[q.u]=(wrongUnits[q.u]||0)+1;
    });
    const sortedWrong=Object.entries(wrongUnits).sort((a,b)=>b[1]-a[1]).slice(0,2);

    const body=document.getElementById('quizBody');
    const reportHTML=`
      <div class="positive-report">
        <div class="pr-title">🎉 本次模考成果</div>
        ${improvements.map(i=>`<div class="pr-item">${i}</div>`).join('')}
        ${sortedWrong.length?`<div class="pr-weak">💪 待提升：${sortedWrong.map(([u])=>{const qu=Q.find(x=>x.u===u);return qu?qu.un:u}).join('、')}</div>`:''}
      </div>`;
    body.insertAdjacentHTML('beforeend',reportHTML);
  }
  function showSessionResult(s,correct,total,acc,dur,badges){
    // 重新计算（因为 finishSession 已更新但 s.answers 包含 scoreLevel）
    let fullCount=0,partialCount=0,zeroCount=0,totalScore=0;
    s.answers.forEach(a=>{
      if(a.ok){fullCount++;totalScore+=2}
      else if(a.scoreLevel==='partial'){partialCount++;totalScore+=1}
      else{zeroCount++}
    });
    const maxScore=s.answers.length*2;
    const scoreRate=maxScore?Math.round(totalScore/maxScore*100):0;

    const body=document.getElementById('quizBody');
    const grade=scoreRate>=85?'优秀':scoreRate>=60?'通过':'加油';
    const gc=scoreRate>=60?'var(--success)':'var(--warn)';
    const hasPartial=partialCount>0;  // 是否有部分得分
    body.innerHTML=`
    <div class="quiz-body-inner" style="text-align:center;padding-top:40px">
      <div style="font-size:64px;margin-bottom:8px">${scoreRate>=85?'🌟':scoreRate>=60?'🎖️':'💪'}</div>
      <h2 style="font-size:24px;color:${gc}">${grade}</h2>
      <p class="muted" style="margin:6px 0 24px">${s.mode==='exam'?'全真模考':s.mode==='weak'?'薄弱强化':s.mode==='review'?'复习计划':s.mode==='memorize'?'背题模式':'自由刷题'} · 共答 ${total} 题</p>
      <div class="grid grid-3" style="margin-bottom:24px">
        <div class="stat-card"><div class="sc-val" style="color:${gc}">${scoreRate}%</div><div class="sc-label">得分率</div></div>
        <div class="stat-card"><div class="sc-val">${totalScore}/${maxScore}</div><div class="sc-label">得分</div></div>
        <div class="stat-card"><div class="sc-val">${Math.floor(dur/60)}'${(dur%60).toString().padStart(2,'0')}"</div><div class="sc-label">用时</div></div>
      </div>
      ${hasPartial?`<div class="stat-card" style="margin-bottom:18px">
        <div style="font-size:13px;color:var(--text-2);margin-bottom:6px">📊 得分明细</div>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <span style="color:var(--success);font-weight:700">✓ 全对 ${fullCount} (${fullCount*2}分)</span>
          <span style="color:var(--warn);font-weight:700">△ 部分正确 ${partialCount} (${partialCount}分)</span>
          <span style="color:var(--danger);font-weight:700">✗ 错误 ${zeroCount} (0分)</span>
        </div>
      </div>`:`<div class="stat-card" style="margin-bottom:18px"><div style="font-size:13px;color:var(--text-2);margin-bottom:6px">✅ 答对 / 总数</div><div style="font-size:22px;font-weight:700;color:${gc}">${fullCount} / ${total}</div></div>`}
      <div class="stat-card" style="margin-bottom:18px"><div style="font-size:13px;color:var(--text-2);margin-bottom:6px">🔥 本场最大连胜：${s.maxStreak}</div></div>
      ${badges.length?`<div class="card" style="background:var(--accent-l);border-color:var(--accent);margin-bottom:18px">
        <h3 style="color:var(--accent);margin-bottom:10px">🏅 新获得勋章</h3>
        ${badges.map(b=>`<div style="display:inline-block;margin:4px;padding:8px 12px;background:var(--surface);border-radius:8px;font-size:13px">${b.ico} ${b.name} <span class="muted">+${b.xp}XP</span></div>`).join('')}
      </div>`:''}
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="Quiz.exit()">返回</button>
        ${session.answers.some(a=>a.scoreLevel!=='full')?`<button class="btn btn-outline" onclick="Quiz.reviewMistakes()">📕 复习本场错题(${session.answers.filter(a=>a.scoreLevel!=='full').length})</button>`:''}
        <button class="btn btn-primary" onclick="Quiz.again()">再来一组</button>
      </div>
    </div>`;
    document.getElementById('quizFooter').innerHTML='';
  }
  function again(){
    document.getElementById('quizOverlay').hidden=true;
    App.render();
    setTimeout(()=>start(session.mode,{count:session.queue.length}),100);
  }
  // ★ 本场错题回顾：用本场答错的题重新开一组
  function reviewMistakes(){
    const wrongIds = session.answers.filter(a=>a.scoreLevel!=='full').map(a=>a.qid);
    if(!wrongIds.length){App.toast('本场没有错题 🎉');return}
    document.getElementById('quizOverlay').hidden=true;
    App.render();
    setTimeout(()=>start('free',{ids:wrongIds,count:wrongIds.length}),100);
  }
  function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

  // ★ 呼吸引导浮层
  function showBreathingGuide(onComplete){
    const overlay=document.createElement('div');
    overlay.className='breathing-overlay';
    overlay.innerHTML=`
      <div class="breathing-content">
        <div class="breathing-title">🌿 考前放松</div>
        <div class="breathing-subtitle">深呼吸能提升专注力</div>
        <div class="breathing-circle">
          <div class="breathing-ring"></div>
          <div class="breathing-ring breathing-ring-2"></div>
          <div class="breathing-text" id="breathText">准备...</div>
        </div>
        <div class="breathing-hint">吸气 4秒 → 屏息 4秒 → 呼气 4秒</div>
        <button class="btn btn-ghost breathing-skip" id="breathSkip">跳过，直接开始</button>
      </div>`;
    document.body.appendChild(overlay);
    const phases=[{t:'吸气...',d:4000},{t:'屏息...',d:4000},{t:'呼气...',d:4000}];
    let phase=0;
    const textEl=overlay.querySelector('#breathText');
    function nextPhase(){
      if(phase>=phases.length){
        overlay.remove();
        onComplete();
        return;
      }
      textEl.textContent=phases[phase].t;
      const ring=overlay.querySelector('.breathing-ring');
      if(phase===0)ring.classList.add('breathing-inhale');
      else if(phase===2)ring.classList.remove('breathing-inhale'),ring.classList.add('breathing-exhale');
      setTimeout(()=>{phase++;nextPhase()},phases[phase-1]?.d||4000);
    }
    setTimeout(nextPhase,500);
    overlay.querySelector('#breathSkip').onclick=()=>{overlay.remove();onComplete()};
  }

  // ★ 鼓励文案池
  const ENCOURAGE={
    first_wrong:['这个知识点容易混淆，现在弄懂了就是赚到','这题偏难，很多人都会踩坑，看懂解析就好'],
    repeat_wrong:['这个点反复出错，建议查阅讲义后专门突破','别灰心，同类型的题再来一次就熟了'],
    partial:['思路对了大半，差最后一步','少选不扣全分，说明方向是对的'],
    case_wrong:['案例题信息量大，拆开逐条分析就不难','案例题确实难，逐个排除选项是关键'],
    misread:['审题时多看一眼关键词，就能避免这种失误'],
    concept:['概念还需要再巩固，讲义里有详细解释']
  };
  function encourageText(q,scoreLevel,session){
    const wrong=DB.getWrong();
    const w=wrong[q.id];
    const isRepeat=w&&w.count>=2;
    let pool;
    if(scoreLevel==='partial')pool=ENCOURAGE.partial;
    else if(isRepeat)pool=ENCOURAGE.repeat_wrong;
    else if(q.t==='案例分析题'||q.t==='共用题干题')pool=ENCOURAGE.case_wrong;
    else if(w&&w.reason==='misread')pool=ENCOURAGE.misread;
    else if(w&&w.reason==='concept')pool=ENCOURAGE.concept;
    else pool=ENCOURAGE.first_wrong;
    return pool[Math.floor(Math.random()*pool.length)];
  }

  // ★ 自我归因标签
  const REASONS=[
    {code:'careless',label:'我其实会，只是粗心',ico:'😅'},
    {code:'concept',label:'概念还没吃透',ico:'🤔'},
    {code:'misread',label:'审题没看清',ico:'👀'},
    {code:'unknown',label:'完全没思路',ico:'😵'}
  ];
  function renderAttribution(qid){
    const w=DB.getWrong()[qid];
    const current=w?.reason;
    return `<div class="attribution-box" id="attributionBox">
      <div class="attr-title">💭 为什么答错了？</div>
      <div class="attr-tags">
        ${REASONS.map(r=>`<button class="attr-tag ${current===r.code?'active':''}" onclick="Quiz.setReason('${qid}','${r.code}')">${r.ico} ${r.label}</button>`).join('')}
      </div>
    </div>`;
  }
  function setReason(qid,code){
    DB.setWrongReason(qid,code);
    // 更新UI选中状态
    document.querySelectorAll('.attr-tag').forEach(t=>t.classList.remove('active'));
    event?.target?.closest('.attr-tag')?.classList.add('active');
  }

  // ★ 「问老师」功能
  function renderAskTeacher(q){
    const confused=DB.getWrong()[q.id]?.confused;
    return `<div class="ask-teacher">
      <div class="at-title">💡 对这道题还有疑问？</div>
      <div class="at-actions">
        <button class="btn btn-ghost btn-sm ${confused?'at-marked':''}" onclick="Quiz.markConfused('${q.id}')">${confused?'✅ 已标记需复习':'❓ 我没看懂'}</button>
        <button class="btn btn-ghost btn-sm" onclick="Quiz.askAbout('${q.id}')">📝 追问</button>
      </div>
    </div>`;
  }
  function markConfused(qid){
    DB.setConfused(qid);
    App.toast('已标记为「需后续复习」，题库将持续优化此题');
    // 更新按钮状态
    const btn=event?.target;
    if(btn){btn.classList.add('at-marked');btn.textContent='✅ 已标记需复习'}
  }
  function askAbout(qid){
    const text=prompt('请输入你的疑问：');
    if(!text||!text.trim())return;
    // 尝试调用后端AI接口
    if(navigator.onLine&&API.getToken()){
      App.toast('正在请求AI解答...');
      API.ask(qid,text.trim()).then(r=>{
        if(r&&r.ok&&r.answer){
          alert('💡 AI解答：\n\n'+r.answer);
        }else{
          App.toast('AI暂不可用，已标记为待解答');
          DB.setConfused(qid);
        }
      }).catch(()=>{App.toast('网络错误，已标记为待解答');DB.setConfused(qid)});
    }else{
      App.toast('离线模式：已标记为待解答，联网后可追问');
      DB.setConfused(qid);
    }
  }

  // ★ 费曼检验
  function tryFeynman(q){
    // 仅关键概念题且答对时触发
    if(!q.key||!q.key_concepts||!q.key_concepts.length)return;
    if(session.answers[session.idx]?.scoreLevel!=='full')return;
    // 每题只弹一次
    if(DB.getFeynman(q.id))return;
    setTimeout(()=>{
      const box=document.getElementById('explainBox');
      if(!box)return;
      const feynmanHTML=`
        <div class="feynman-box" id="feynmanBox">
          <div class="fm-title">🧠 费曼检验 · 用自己的话解释</div>
          <div class="fm-q">${esc(q.s)}</div>
          <div class="fm-hint">请用自己的话解释为什么（不必一模一样，说出关键点即可）：</div>
          <textarea class="fm-input" id="feynmanInput" rows="3" placeholder="例如：T1加权像主要反映组织的T1弛豫时间差异..."></textarea>
          <div class="fm-actions">
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('feynmanBox').remove()">跳过</button>
            <button class="btn btn-primary btn-sm" onclick="Quiz.submitFeynman('${q.id}')">提交解释</button>
          </div>
          <div class="fm-result" id="feynmanResult"></div>
        </div>`;
      box.insertAdjacentHTML('beforeend',feynmanHTML);
    },800);
  }
  function submitFeynman(qid){
    const input=document.getElementById('feynmanInput');
    if(!input||!input.value.trim())return;
    const text=input.value.trim();
    const q=Q.find(x=>x.id===qid);
    if(!q||!q.key_concepts)return;
    // 前端关键词匹配
    const keywords=q.key_concepts;
    const matched=keywords.filter(kw=>text.includes(kw));
    const ratio=matched.length/keywords.length;
    let feedback='';
    if(ratio>=0.7){
      feedback=`✅ 解释得很好！你提到了 ${matched.length}/${keywords.length} 个关键概念：${matched.join('、')}`;
    }else if(ratio>=0.3){
      feedback=`⚠️ 部分正确。你提到了 ${matched.length}/${keywords.length} 个关键点：${matched.join('、')}。<br>还差：${keywords.filter(kw=>!matched.includes(kw)).join('、')}`;
    }else{
      feedback=`💡 还需要补充关键概念。参考要点：${keywords.join('、')}`;
    }
    DB.saveFeynman(qid,text);
    document.getElementById('feynmanResult').innerHTML=`<div class="fm-feedback">${feedback}</div>`;
    document.getElementById('feynmanInput').disabled=true;
  }

  // ★ 休息提醒面板
  function showRestPanel(type){
    const overlay=document.createElement('div');
    overlay.className='rest-overlay';
    const isTimeout=type==='timeout';
    overlay.innerHTML=`
      <div class="rest-panel">
        <div class="rest-ico">${isTimeout?'⏰':'🧠'}</div>
        <h3>${isTimeout?'已学习超过45分钟':'连续答错较多'}</h3>
        <p class="rest-msg">${isTimeout?'长时间学习效率会下降，站起来活动一下':'正确率下降，休息一下再继续效果更好'}</p>
        <div class="rest-actions">
          <button class="btn btn-primary" onclick="this.closest('.rest-overlay').remove();Quiz._restTimer()">休息 5 分钟</button>
          <button class="btn btn-ghost" onclick="this.closest('.rest-overlay').remove()">继续坚持</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  function _restTimer(){
    let sec=300;
    const overlay=document.createElement('div');
    overlay.className='rest-overlay rest-timing';
    overlay.innerHTML=`<div class="rest-panel"><div class="rest-ico">⏳</div><h3>休息中</h3><div class="rest-countdown" id="restCD">5:00</div><button class="btn btn-ghost" onclick="this.closest('.rest-overlay').remove();Quiz._resume()">提前结束</button></div>`;
    document.body.appendChild(overlay);
    const cd=document.getElementById('restCD');
    const timer=setInterval(()=>{
      sec--;
      if(sec<=0){clearInterval(timer);overlay.remove();_resume();return}
      cd.textContent=Math.floor(sec/60)+':'+(sec%60).toString().padStart(2,'0');
    },1000);
    Quiz._restTimerInterval=timer;
  }
  function _resume(){
    if(Quiz._restTimerInterval)clearInterval(Quiz._restTimerInterval);
    session._restShown=false;
    session.totalTime=0;
    App.toast('休息结束，继续加油 💪');
  }

  // ★ TTS 和草稿纸按钮（在答题区渲染）
  function renderTools(){
    const ttsOn=TTS.isEnabled();
    return `<div class="quiz-tools">
      ${TTS.supported()?`<button class="quiz-tool ${ttsOn?'active':''}" id="ttsBtn" onclick="Quiz.toggleTTS()" title="听题模式">🔊</button>`:''}
      <button class="quiz-tool" onclick="Sketch.toggle()" title="草稿纸">📝</button>
    </div>`;
  }
  function toggleTTS(){
    const on=TTS.toggle();
    document.getElementById('ttsBtn')?.classList.toggle('active',on);
    if(on&&session){
      const q=cur();
      if(q)TTS.speakQuestion(q);
    }
    App.toast(on?'听题模式已开启':'听题模式已关闭');
  }

  return {start,exit,submit,next,skip,toggle,again,reviewMistakes,render,pick,weakPoints,cur,setReason,
    showBreathingGuide,encourageText,markConfused,askAbout,tryFeynman,submitFeynman,
    showRestPanel,_restTimer,_resume,renderTools,toggleTTS};
})();
