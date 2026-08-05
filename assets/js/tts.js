/* ===== 听题模式 · Web Speech API ===== */
const TTS=(()=>{
  let _ voices=[];
  let _rate=1;
  let _enabled=false;
  let _queue=[];
  let _speaking=false;
  let _paused=false;

  function supported(){return 'speechSynthesis' in window}

  function loadVoices(){
    if(!supported())return;
    voices=speechSynthesis.getVoices().filter(v=>v.lang.startsWith('zh'));
  }
  if(supported()){
    loadVoices();
    speechSynthesis.onvoiceschanged=loadVoices;
  }

  function pickVoice(){
    if(!voices.length)loadVoices();
    // 优先选 zh-CN 的女声/默认声
    return voices.find(v=>v.lang==='zh-CN')||voices[0]||null;
  }

  function speak(text,opts={}){
    if(!supported()||!_enabled||!text)return;
    const u=new SpeechSynthesisUtterance(text);
    u.lang='zh-CN';
    u.rate=_rate;
    const v=pickVoice();
    if(v)u.voice=v;
    u.onend=()=>{
      _speaking=false;
      if(_queue.length){
        const next=_queue.shift();
        speak(next.text,next.opts);
      }
    };
    u.onerror=()=>{_speaking=false};
    _speaking=true;
    speechSynthesis.speak(u);
  }

  function speakQuestion(q){
    if(!supported()||!q)return;
    cancel();
    let text='';
    // 题型提示
    if(q.t==='单选题')text+='单选题。';
    else if(q.t==='多选题')text+='多选题。';
    else if(q.t==='案例分析题')text+='案例分析题。';
    // 共用题干
    if(q.gs)text+=q.gs+'。';
    // 题干
    text+=q.s;
    // 选项
    const opts=q.o||q['选项']||{};
    for(const k of 'ABCDE'){
      if(opts[k])text+=' '+k+'.'+opts[k];
    }
    speak(text);
  }

  function speakExplain(text){
    if(!text)return;
    // 截断过长的解析
    const max=text.length>500?text.slice(0,500)+'...':text;
    speak(max);
  }

  function speakResult(ok,scoreLevel){
    if(ok){
      speak('回答正确！');
    }else if(scoreLevel==='partial'){
      speak('部分正确，少选了。');
    }else{
      speak('回答错误。');
    }
  }

  function enqueue(text,opts){_queue.push({text,opts})}

  function cancel(){
    if(supported())speechSynthesis.cancel();
    _queue=[];_speaking=false;_paused=false;
  }

  function pause(){if(supported()&&_speaking){speechSynthesis.pause();_paused=true}}
  function resume(){if(supported()&&_paused){speechSynthesis.resume();_paused=false}}

  function toggle(){
    _enabled=!_enabled;
    if(!_enabled)cancel();
    return _enabled;
  }

  function setRate(r){_rate=Math.max(0.5,Math.min(1.5,r))}
  function getRate(){return _rate}
  function isEnabled(){return _enabled}
  function isSpeaking(){return _speaking}

  return {supported,speakQuestion,speakExplain,speakResult,cancel,pause,resume,toggle,setRate,getRate,isEnabled,isSpeaking};
})();
