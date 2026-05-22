import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ReactDOM from 'react-dom/client'


/* ── Design tokens ───────────────────────────────────────────────────── */
const A={
  systemBg:'#F5F3EF',
  cardBg:'#fff',
  inputBg:'rgba(0,0,0,0.04)',
  label1:'#1A1A1A',label2:'#3A3A3A',label3:'#6B6B6B',label4:'rgba(0,0,0,0.42)',label5:'rgba(0,0,0,0.22)',
  blue:'#007AFF',green:'#34C759',amber:'#FF9500',red:'#FF3B30',indigo:'#5856D6',teal:'#32ADE6',purple:'#AF52DE',
  blueFill:'rgba(0,122,255,0.08)',greenFill:'rgba(52,199,89,0.08)',amberFill:'rgba(255,149,0,0.08)',redFill:'rgba(255,59,48,0.08)',
  sep:'rgba(0,0,0,0.07)',sepOpaque:'#D8D8D8',
  shadowSm:'0 1px 2px rgba(0,0,0,0.04),0 2px 8px rgba(0,0,0,0.06)',
  shadowMd:'0 2px 8px rgba(0,0,0,0.06),0 8px 24px rgba(0,0,0,0.08)',
  shadowLg:'0 4px 16px rgba(0,0,0,0.10),0 16px 48px rgba(0,0,0,0.12)',
  r:'14px',rSm:'10px',rXs:'7px',rPill:'999px',
  glass:'#fff',
  glassFilter:'none',
};

const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ── Local date helper — avoids UTC-vs-local timezone flip ───────────── */
function localDate(d=new Date()){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function daysUntil(dateStr){
  const t=new Date(); t.setHours(0,0,0,0);
  return Math.round((new Date(dateStr+'T00:00:00')-t)/86400000);
}

/* ── API helper ──────────────────────────────────────────────────────── */
const _authHdr=()=>{const t=localStorage.getItem('kith_token');return t?{'Authorization':`Bearer ${t}`}:{};};
const api={
  get:(path)=>fetch(path,{headers:{..._authHdr()}}).then(r=>r.json()),
  post:(path,data)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify(data)}).then(r=>r.json()),
  put:(path,data)=>fetch(path,{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify(data)}).then(r=>r.json()),
  del:(path)=>fetch(path,{method:'DELETE',headers:{..._authHdr()}}).then(r=>r.json()),
};

/* ── Time formatting helper ─────────────────────────────────────────── */
function fmtTime(t, fmt='12h'){
  if(!t||t==='All day') return t;
  if(fmt==='12h') return t; // stored as 12h already
  const m=t.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if(!m) return t;
  let [,h,min,ap]=m; h=parseInt(h);
  if(ap.toUpperCase()==='PM'&&h!==12) h+=12;
  if(ap.toUpperCase()==='AM'&&h===12) h=0;
  return `${String(h).padStart(2,'0')}:${min}`;
}

/* ── Calendar color mapping ──────────────────────────────────────────── */
const CAL_COLORS={kith:A.green};
function calColor(cal,events){
  if(CAL_COLORS[cal]) return CAL_COLORS[cal];
  // Find color from first event with this calendar
  const ev=events.find(e=>e.calendar===cal);
  return ev?.color||A.blue;
}

/* ── Hooks ───────────────────────────────────────────────────────────── */
function useClock(){
  const [t,setT]=useState(new Date());
  useEffect(()=>{const id=setInterval(()=>setT(new Date()),1000);return()=>clearInterval(id);},[]);
  return t;
}
function useToast(){
  const [toasts,setToasts]=useState([]);
  const add=useCallback((msg,type='green')=>{
    const id=Date.now();
    setToasts(p=>[...p,{id,msg,type}]);
    const t=setTimeout(()=>setToasts(p=>p.filter(x=>x.id!==id)),3000);
    return ()=>clearTimeout(t);
  },[]);
  return{toasts,add};
}

function useIsMobile(){
  const [w,setW]=useState(window.innerWidth);
  useEffect(()=>{const h=()=>setW(window.innerWidth);window.addEventListener('resize',h);return()=>window.removeEventListener('resize',h);},[]);
  return w<768;
}

/* ── Push notifications ──────────────────────────────────────────────── */
function urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=window.atob(base64);
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

async function subscribePush(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)) throw new Error('Push not supported in this browser');
  const reg=await navigator.serviceWorker.ready;
  const permission=await Notification.requestPermission();
  if(permission!=='granted') throw new Error('Notification permission denied');
  const{publicKey}=await api.get('/api/push/vapid-key');
  const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)});
  await api.post('/api/push/subscribe',sub.toJSON());
  return sub;
}

/* ── Base UI components ──────────────────────────────────────────────── */
function ToastStack({toasts}){
  const tint={green:A.green,blue:A.blue,red:A.red,amber:A.amber};
  return(
    <div style={{position:'fixed',bottom:28,right:28,zIndex:9999,display:'flex',flexDirection:'column',gap:8,pointerEvents:'none'}}>
      {toasts.map(t=>(
        <div key={t.id} style={{background:'rgba(28,28,30,0.88)',backdropFilter:'blur(20px)',color:'#fff',padding:'12px 18px',borderRadius:13,fontSize:14,fontWeight:500,boxShadow:A.shadowLg,animation:'toastIn .22s cubic-bezier(.4,0,.2,1)',display:'flex',alignItems:'center',gap:10,minWidth:200}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:tint[t.type]||A.green,flexShrink:0}}/>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

function Drawer({open,onClose,title,children,width=440}){
  return(
    <>
      {open&&<div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.18)',zIndex:100,animation:'fadeIn .15s'}}/>}
      <div style={{position:'fixed',top:0,right:0,height:'100%',width,background:'#fff',zIndex:101,transform:open?'translateX(0)':`translateX(${width+20}px)`,transition:'transform .3s cubic-bezier(.4,0,.2,1)',display:'flex',flexDirection:'column',boxShadow:open?'-1px 0 0 rgba(0,0,0,0.07),-4px 0 40px rgba(0,0,0,0.10)':'none'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 24px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <span style={{fontSize:17,fontWeight:600,letterSpacing:'-.01em'}}>{title}</span>
          <button onClick={onClose} style={{width:28,height:28,borderRadius:'50%',background:A.inputBg,border:'none',cursor:'pointer',fontSize:16,color:A.label3,display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>{children}</div>
      </div>
    </>
  );
}

function Modal({open,onClose,title,children,width=660}){
  if(!open) return null;
  return(
    <>
      <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.24)',zIndex:200,animation:'fadeIn .15s'}}/>
      <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'#fff',borderRadius:A.r,border:'1px solid rgba(0,0,0,0.06)',zIndex:201,width,maxWidth:'94vw',maxHeight:'88vh',display:'flex',flexDirection:'column',boxShadow:A.shadowLg,animation:'slideUp .2s cubic-bezier(.4,0,.2,1)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 24px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <span style={{fontSize:17,fontWeight:600}}>{title}</span>
          <button onClick={onClose} style={{width:28,height:28,borderRadius:'50%',background:A.inputBg,border:'none',cursor:'pointer',fontSize:16,color:A.label3,display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
        </div>
        <div style={{flex:1,overflow:'auto',padding:'20px 24px'}}>{children}</div>
      </div>
    </>
  );
}

function FormGroup({children,label,footer}){
  return(
    <div style={{marginBottom:22}}>
      {label&&<div style={{fontSize:11,fontWeight:600,color:A.label4,marginBottom:7,paddingLeft:6,textTransform:'uppercase',letterSpacing:'.07em'}}>{label}</div>}
      <div style={{background:'#fff',borderRadius:A.r,overflow:'hidden',boxShadow:A.shadowSm,border:'1px solid rgba(0,0,0,0.06)'}}>
        {React.Children.map(children,(child,i)=>(
          <div key={i} style={{borderTop:i>0?`1px solid ${A.sep}`:'none'}}>{child}</div>
        ))}
      </div>
      {footer&&<div style={{fontSize:13,color:A.label4,marginTop:6,paddingLeft:6}}>{footer}</div>}
    </div>
  );
}

function FormRow({label,children,footer}){
  const isMobile=useIsMobile();
  return(
    <div style={{padding:'12px 16px'}}>
      <div style={{display:'flex',alignItems:isMobile?'flex-start':'center',justifyContent:'space-between',gap:12,flexDirection:isMobile?'column':'row'}}>
        {label&&<span style={{fontSize:15,color:A.label1,flexShrink:0,fontWeight:500}}>{label}</span>}
        <div style={{flex:1,display:'flex',justifyContent:isMobile?'flex-start':'flex-end',width:isMobile?'100%':undefined}}>{children}</div>
      </div>
      {footer&&<div style={{fontSize:12,color:A.label4,marginTop:6}}>{footer}</div>}
    </div>
  );
}

function Inp({value,onChange,placeholder,type='text',onKeyDown,onBlur,disabled,inputRef,style:s={}}){
  const [focus,setFocus]=useState(false);
  return(
    <input ref={inputRef} type={type} value={value} onChange={onChange} placeholder={placeholder} onKeyDown={onKeyDown} disabled={disabled}
      onFocus={()=>setFocus(true)} onBlur={e=>{setFocus(false);onBlur&&onBlur(e);}}
      style={{width:'100%',background:focus?'#fff':A.inputBg,border:`1.5px solid ${focus?A.blue:'rgba(0,0,0,0.09)'}`,borderRadius:A.rXs,color:A.label1,padding:'9px 12px',fontSize:15,outline:'none',transition:'background .15s,border-color .15s',opacity:disabled?.5:1,...s}}/>
  );
}

function Sel({value,onChange,children}){
  return(
    <select value={value} onChange={onChange} style={{background:A.inputBg,border:'1.5px solid rgba(0,0,0,0.09)',borderRadius:A.rXs,color:A.label1,padding:'9px 12px',fontSize:15,outline:'none',cursor:'pointer',width:'100%'}}>{children}</select>
  );
}

function Btn({children,onClick,variant='blue',sm,full,style:s={}}){
  const v={
    blue:{background:A.blue,color:'#fff',border:'none'},
    green:{background:A.green,color:'#fff',border:'none'},
    ghost:{background:A.inputBg,color:A.label2,border:'none'},
    red:{background:A.redFill,color:A.red,border:'none'},
    text:{background:'none',color:A.blue,border:'none',padding:0,fontWeight:500},
  };
  return(
    <button onClick={onClick} style={{padding:sm?'7px 14px':'10px 20px',borderRadius:A.rPill,fontSize:sm?13:15,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,width:full?'100%':undefined,transition:'opacity .15s,transform .12s cubic-bezier(.25,.46,.45,.94)',letterSpacing:'-.02em',...v[variant],...s}}
      onMouseEnter={e=>{e.currentTarget.style.opacity='.88';}}
      onMouseLeave={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.transform='scale(1)';}}
      onMouseDown={e=>{e.currentTarget.style.transform='scale(.96)';e.currentTarget.style.opacity='.78';}}
      onMouseUp={e=>{e.currentTarget.style.transform='scale(1)';e.currentTarget.style.opacity='1';}}
    >{children}</button>
  );
}

function Toggle({checked,onChange,label}){
  return(
    <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
      <div onClick={()=>onChange(!checked)} style={{width:51,height:31,borderRadius:16,background:checked?A.green:'rgba(120,120,128,0.24)',position:'relative',cursor:'pointer',transition:'background .22s cubic-bezier(.4,0,.2,1)',flexShrink:0}}>
        <div style={{position:'absolute',top:2,left:checked?22:2,width:27,height:27,borderRadius:'50%',background:'#fff',boxShadow:'0 2px 6px rgba(0,0,0,0.18)',transition:'left .22s cubic-bezier(.4,0,.2,1)'}}/>
      </div>
      {label&&<span style={{fontSize:15,color:A.label1}}>{label}</span>}
    </label>
  );
}

function Badge({children,color=A.blue,bg}){
  return(
    <span style={{background:bg||color+'1A',color,fontSize:12,fontWeight:700,padding:'3px 9px',borderRadius:A.rPill,letterSpacing:'-.01em',display:'inline-flex',alignItems:'center',gap:4}}>{children}</span>
  );
}

function Card({children,style:s={}}){
  return <div style={{background:'#fff',borderRadius:A.r,boxShadow:A.shadowSm,border:'1px solid rgba(0,0,0,0.06)',...s}}>{children}</div>;
}

function Confetti({active,count=48}){
  if(!active) return null;
  const colors=['#007AFF','#34C759','#FF9500','#FF3B30','#5856D6','#AF52DE','#FFD60A','#32ADE6'];
  const pieces=Array.from({length:count},(_,i)=>({
    id:i,x:Math.random()*100,delay:Math.random()*0.9,
    color:colors[i%colors.length],size:5+Math.random()*7,
    dur:2.2+Math.random()*1.4,pill:Math.random()>.45,
  }));
  return(
    <div style={{position:'fixed',inset:0,pointerEvents:'none',zIndex:9997,overflow:'hidden'}}>
      {pieces.map(p=>(
        <div key={p.id} style={{position:'absolute',top:'-12px',left:`${p.x}%`,width:p.size,height:p.pill?p.size*1.8:p.size,borderRadius:p.pill?'50%':'3px',background:p.color,animation:`confettiFall ${p.dur}s ${p.delay}s ease-in forwards`}}/>
      ))}
    </div>
  );
}

/* ── Countdowns ──────────────────────────────────────────────────────── */
function CountdownsScreen({countdowns,setCountdowns,toastAdd}){
  const [form,setForm]=useState({label:'',date:'',emoji:'🎉'});
  const EMOJIS=['🎉','🎂','✈️','🏫','🏖️','🎄','🎃','💍','🏆','⭐'];
  const save=async()=>{
    if(!form.label.trim()||!form.date) return;
    const r=await api.post('/api/countdowns',form);
    setCountdowns(p=>[...p,r].sort((a,b)=>a.date.localeCompare(b.date)));
    setForm({label:'',date:'',emoji:'🎉'});
    toastAdd('Countdown added');
  };
  const del=async id=>{
    await api.del(`/api/countdowns/${id}`);
    setCountdowns(p=>p.filter(c=>c.id!==id));
    toastAdd('Deleted','blue');
  };
  return(
    <div style={{maxWidth:640}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:28,fontWeight:800,letterSpacing:'-.04em'}}>Countdowns</h1>
        <p style={{color:A.label4,fontSize:15,marginTop:4}}>Track days until special events</p>
      </div>
      <FormGroup label="Add Countdown">
        <div style={{padding:'14px 16px'}}>
          <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}>
            {EMOJIS.map(e=>(
              <button key={e} onClick={()=>setForm(p=>({...p,emoji:e}))} style={{width:38,height:38,borderRadius:A.rXs,border:`2px solid ${form.emoji===e?A.blue:'transparent'}`,background:form.emoji===e?A.blueFill:'transparent',cursor:'pointer',fontSize:22}}>{e}</button>
            ))}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <Inp value={form.label} onChange={e=>setForm(p=>({...p,label:e.target.value}))} placeholder="Label (e.g. Summer Vacation)"/>
            <Inp type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/>
            <Btn onClick={save} full>Add Countdown</Btn>
          </div>
        </div>
      </FormGroup>
      {countdowns.length===0&&(
        <Card style={{padding:'40px 24px',textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:8}}>⏳</div>
          <div style={{fontSize:16,fontWeight:600,color:A.label1}}>No countdowns yet</div>
          <div style={{color:A.label4,fontSize:14,marginTop:4}}>Add birthdays, trips, and holidays above</div>
        </Card>
      )}
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {countdowns.map(c=>{
          const days=daysUntil(c.date);
          return(
            <Card key={c.id} style={{padding:'18px 20px',display:'flex',alignItems:'center',gap:16}}>
              <span style={{fontSize:32}}>{c.emoji}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:16,fontWeight:600,color:A.label1}}>{c.label}</div>
                <div style={{fontSize:13,color:A.label4,marginTop:2}}>{c.date}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0,minWidth:60}}>
                {days===0&&<div style={{fontSize:18,fontWeight:800,color:A.green}}>Today!</div>}
                {days>0&&<><div style={{fontSize:28,fontWeight:800,color:A.blue,lineHeight:1}}>{days}</div><div style={{fontSize:12,color:A.label4}}>days</div></>}
                {days<0&&<div style={{fontSize:13,color:A.label5,fontStyle:'normal'}}>{Math.abs(days)}d ago</div>}
              </div>
              <button onClick={()=>del(c.id)} style={{background:'none',border:'none',color:A.label5,cursor:'pointer',fontSize:20,padding:'4px',lineHeight:1}}>×</button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ── Family Members ──────────────────────────────────────────────────── */
function FamilyScreen({members,setMembers,toastAdd}){
  const [form,setForm]=useState({name:'',color:'#007AFF'});
  const [pinModal,setPinModal]=useState(null);
  const [pinInput,setPinInput]=useState('');
  const [goalId,setGoalId]=useState(null);
  const [goalForm,setGoalForm]=useState({monthly_goal:'',reward:''});
  const COLORS=['#007AFF','#34C759','#FF3B30','#FF9500','#5856D6','#32ADE6','#AF52DE','#FF2D55','#FF6B35','#30D158'];
  const save=async()=>{
    if(!form.name.trim()) return;
    const r=await api.post('/api/members',form);
    setMembers(p=>[...p,r]);
    setForm({name:'',color:'#007AFF'});
    toastAdd('Member added');
  };
  const del=async id=>{
    await api.del(`/api/members/${id}`);
    setMembers(p=>p.filter(m=>m.id!==id));
    toastAdd('Removed','blue');
  };
  const savePin=async()=>{
    if(!String(pinInput||'').match(/^\d{4,8}$/)){toastAdd('PIN must be 4–8 digits','red');return;}
    await api.put(`/api/members/${pinModal}/pin`,{pin:String(pinInput)});
    setPinModal(null);setPinInput('');
    toastAdd('PIN updated');
  };
  const saveGoal=async()=>{
    const goal=Number(goalForm.monthly_goal)||0;
    await api.put(`/api/members/${goalId}/goal`,{monthly_goal:goal,reward:goalForm.reward});
    setMembers(p=>p.map(m=>m.id===goalId?{...m,monthly_goal:goal,reward:goalForm.reward}:m));
    setGoalId(null);
    toastAdd('Goal saved');
  };
  return(
    <div style={{maxWidth:600}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:28,fontWeight:800,letterSpacing:'-.03em'}}>Family</h1>
        <p style={{color:A.label4,fontSize:15,marginTop:4}}>Color-code events by person. Pick a member when adding events.</p>
      </div>
      <FormGroup label="Add Member">
        <div style={{padding:'14px 16px'}}>
          <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}>
            {COLORS.map(c=>(
              <button key={c} onClick={()=>setForm(p=>({...p,color:c}))} style={{width:30,height:30,borderRadius:'50%',border:`3px solid ${form.color===c?'#1C1C1E':'transparent'}`,background:c,cursor:'pointer'}}/>
            ))}
          </div>
          <div style={{display:'flex',gap:8}}>
            <Inp value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Name (e.g. Emma)"/>
            <Btn onClick={save} style={{flexShrink:0}}>Add</Btn>
          </div>
        </div>
      </FormGroup>
      {members.length===0?(
        <Card style={{padding:'40px 24px',textAlign:'center'}}>
          <div style={{fontSize:16,fontWeight:600,color:A.label1}}>No members yet</div>
          <div style={{color:A.label4,fontSize:14,marginTop:4}}>Add people to color-code calendar events by person</div>
        </Card>
      ):(
        <Card>
          {members.map((m,i)=>(
            <div key={m.id} style={{borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
              <div style={{display:'flex',alignItems:'center',gap:14,padding:'14px 16px'}}>
                <div style={{width:40,height:40,borderRadius:'50%',background:m.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontWeight:700,color:'#fff',flexShrink:0}}>{m.initials}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:500,color:A.label1}}>{m.name}</div>
                  {m.monthly_goal>0&&<div style={{fontSize:12,color:A.label4,marginTop:2}}>{m.monthly_goal} pt goal{m.reward?` · ${m.reward}`:''}</div>}
                </div>
                <button onClick={()=>{setGoalId(goalId===m.id?null:m.id);setGoalForm({monthly_goal:m.monthly_goal||'',reward:m.reward||''});}} style={{background:'none',border:'none',color:A.blue,fontSize:13,cursor:'pointer',fontWeight:500}}>
                  {goalId===m.id?'Cancel':'Set Goal'}
                </button>
                <button onClick={()=>{setPinModal(m.id);setPinInput('');}} style={{background:'none',border:'none',color:A.blue,fontSize:13,cursor:'pointer',fontWeight:500}}>PIN</button>
                <button onClick={()=>del(m.id)} style={{background:'none',border:'none',color:A.label4,fontSize:13,cursor:'pointer',fontWeight:500}}>Remove</button>
              </div>
              {goalId===m.id&&(
                <div style={{padding:'0 16px 14px',display:'flex',gap:8,alignItems:'center'}}>
                  <Inp type="number" min="0" value={goalForm.monthly_goal} onChange={e=>setGoalForm(p=>({...p,monthly_goal:e.target.value}))} placeholder="Monthly pts goal" style={{width:160}}/>
                  <Inp value={goalForm.reward} onChange={e=>setGoalForm(p=>({...p,reward:e.target.value}))} placeholder="Reward (optional)" style={{flex:1}}/>
                  <Btn sm onClick={saveGoal}>Save</Btn>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      <Modal open={pinModal!==null} onClose={()=>{setPinModal(null);setPinInput('');}} title={`Set PIN — ${members.find(m=>m.id===pinModal)?.name||''}`} width={360}>
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <p style={{fontSize:14,color:A.label4,lineHeight:1.5}}>4–8 digits. Members use this to log in on shared devices.</p>
          <Inp type="password" value={pinInput} onChange={e=>setPinInput(e.target.value.replace(/\D/g,'').slice(0,8))} placeholder="Enter PIN" onKeyDown={e=>e.key==='Enter'&&savePin()}/>
          <Btn onClick={savePin} full>Save PIN</Btn>
        </div>
      </Modal>
    </div>
  );
}

/* ── Display Mode ────────────────────────────────────────────────────── */
function DisplayMode({onManage,events,chores,setChores,meals,grocery,countdowns,weather,clockFormat='12h',nightModeStart='23:00',nightModeEnd='06:00',goals=[],notes=[],polls=[],rotationMs=10000,wifiQrData=null}){
  const isMobile=useIsMobile();
  const now=useClock();
  const [liveGames,setLiveGames]=useState([]);
  useEffect(()=>{
    const load=()=>api.get('/api/sports').then(d=>{if(Array.isArray(d))setLiveGames(d.filter(g=>g.state==='in'));}).catch(()=>{});
    load();
    const id=setInterval(load,60000);
    return()=>clearInterval(id);
  },[]);

  const [news,setNews]=useState([]);
  useEffect(()=>{
    const load=()=>api.get('/api/news').then(d=>{if(Array.isArray(d))setNews(d);}).catch(()=>{});
    load();
    const id=setInterval(load,5*60*1000);
    return()=>clearInterval(id);
  },[]);

  const [memberProgress,setMemberProgress]=useState([]);
  useEffect(()=>{
    const load=()=>api.get('/api/members/progress').then(d=>{if(Array.isArray(d))setMemberProgress(d);}).catch(()=>{});
    load();
    const id=setInterval(load,5*60*1000);
    return()=>clearInterval(id);
  },[]);

  const [livePollVotes,setLivePollVotes]=useState({});
  useEffect(()=>{
    const load=()=>api.get('/api/polls').then(d=>{
      if(Array.isArray(d)&&d.length) setLivePollVotes(d[0].votes||{});
    }).catch(()=>{});
    load();
    const id=setInterval(load,30000);
    return()=>clearInterval(id);
  },[]);
  const [haEvents,setHaEvents]=useState([]);
  const [smEvents,setSmEvents]=useState([]);
  useEffect(()=>{
    const load=()=>api.get('/api/ha/events').then(d=>{if(Array.isArray(d))setHaEvents(d);}).catch(()=>{});
    load();
    const id=setInterval(load,30000);
    return()=>clearInterval(id);
  },[]);
  useEffect(()=>{
    const load=()=>fetch('/api/ha/pull').then(r=>r.json()).then(d=>{if(Array.isArray(d))setSmEvents(d);}).catch(()=>{});
    load();
    const id=setInterval(load,20000);
    return()=>clearInterval(id);
  },[]);
  const allSmartEvents=useMemo(()=>[...smEvents,...haEvents].slice(0,10),[smEvents,haEvents]);
  const [nowPlaying,setNowPlaying]=useState({playing:false});
  useEffect(()=>{
    const load=()=>api.get('/api/music/now-playing').then(d=>setNowPlaying(d||{playing:false})).catch(()=>{});
    load();
    const id=setInterval(load,12000);
    return()=>clearInterval(id);
  },[]);
  const [widgetData,setWidgetData]=useState({});
  useEffect(()=>{
    const load=()=>api.get('/api/widgets/data').then(d=>setWidgetData(d||{})).catch(()=>{});
    load();
    const id=setInterval(load,3*60*1000);
    return()=>clearInterval(id);
  },[]);

  const [newsIdx,setNewsIdx]=useState(0);
  const [newsVisible,setNewsVisible]=useState(true);
  const newsFadeTimer=useRef(null);
  useEffect(()=>{
    if(news.length<=1)return;
    const id=setInterval(()=>{
      setNewsVisible(false);
      newsFadeTimer.current=setTimeout(()=>{setNewsIdx(i=>(i+1)%news.length);setNewsVisible(true);},500);
    },15000);
    return()=>{clearInterval(id);clearTimeout(newsFadeTimer.current);};
  },[news.length]);
  const [centerIdx,setCenterIdx]=useState(0);
  useEffect(()=>{const id=setInterval(()=>setCenterIdx(i=>i+1),rotationMs);return()=>clearInterval(id);},[rotationMs]);
  const [showControls,setShowControls]=useState(false);
  const hideTimer=useRef(null);
  useEffect(()=>{
    const show=()=>{setShowControls(true);clearTimeout(hideTimer.current);hideTimer.current=setTimeout(()=>setShowControls(false),3000);};
    window.addEventListener('mousemove',show);
    window.addEventListener('touchstart',show);
    return()=>{window.removeEventListener('mousemove',show);window.removeEventListener('touchstart',show);clearTimeout(hideTimer.current);};
  },[]);
  const h12=now.getHours()%12||12;
  const min=String(now.getMinutes()).padStart(2,'0');
  const ampm=now.getHours()>=12?'PM':'AM';
  const dateStr=`${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;

  // Photo frame — cycles every 12s when photos are present

  // Night mode
  const [nightDismissed,setNightDismissed]=useState(false);
  const nightDismissTimer=useRef(null);
  const parseMins=t=>{const[h,m]=(t||'00:00').split(':').map(Number);return h*60+m;};
  const nowMins=now.getHours()*60+now.getMinutes();
  const nmStart=parseMins(nightModeStart);
  const nmEnd=parseMins(nightModeEnd);
  const isNightTime=nmStart>nmEnd?nowMins>=nmStart||nowMins<nmEnd:nowMins>=nmStart&&nowMins<nmEnd;
  const isNightMode=isNightTime&&!nightDismissed;
  const dismissNight=()=>{
    setNightDismissed(true);
    clearTimeout(nightDismissTimer.current);
    nightDismissTimer.current=setTimeout(()=>setNightDismissed(false),5*60*1000);
  };
  useEffect(()=>()=>clearTimeout(nightDismissTimer.current),[]);

  const todayStr=localDate();
  const agendaDays=[0,1,2,3].map(offset=>{
    const d=new Date(); d.setDate(d.getDate()+offset);
    const label=offset===0?'Today':offset===1?'Tomorrow':DAYS[d.getDay()];
    return{label,date:localDate(d)};
  });
  const dueC=chores.filter(c=>(c.status==='due'||c.status==='overdue')&&!c.done);
  const upCD=(countdowns||[]).filter(c=>daysUntil(c.date)>=0);
  const progressMembers=memberProgress.filter(m=>m.monthly_goal>0);
  const pinnedNotes=useMemo(()=>(notes||[]).filter(n=>n.pinned),[notes]);
  const centerPanels=[
    ...(dueC.length>0?['chores']:[]),
    ...(upCD.length>0?['countdowns']:[]),
    ...(goals.length>0?['goals']:[]),
    ...(progressMembers.length>0?['members']:[]),
    ...(widgetData.quote?['w_quote']:[]),
    ...(widgetData.stocks?.length?['w_stocks']:[]),
    ...(widgetData.producthunt?.length?['w_producthunt']:[]),
    ...(widgetData.github?['w_github']:[]),
    ...(widgetData.reddit?.posts?.length?['w_reddit']:[]),
    ...(widgetData.beehiiv?['w_beehiiv']:[]),
    ...(widgetData.youtube?['w_youtube']:[]),
    ...(widgetData.etsy?['w_etsy']:[]),
    ...(widgetData.powerwall?['w_powerwall']:[]),
    ...(widgetData.flight?['w_flight']:[]),
    ...(widgetData.uptime?.length?['w_uptime']:[]),
    ...(widgetData.nextdns?['w_nextdns']:[]),
    ...(widgetData.beszel?.length?['w_beszel']:[]),
    ...(widgetData.plex?['w_plex']:[]),
    ...(widgetData.moen?['w_moen']:[]),
    ...(widgetData.unifi?['w_unifi']:[]),
  ];
  const activePanelId=centerPanels[centerIdx%Math.max(1,centerPanels.length)];

  const [dmChoreConfetti,setDmChoreConfetti]=useState(false);
  const toggleChore=async id=>{
    try{
      const result=await api.put(`/api/chores/${id}/done`);
      if(result.error) return;
      setChores(p=>p.map(c=>c.id===id?{...c,done:result.done,next_due:result.next_due,status:result.status}:c));
      if(result.done){setDmChoreConfetti(true);setTimeout(()=>setDmChoreConfetti(false),2500);}
    }catch(e){}
  };

  const todayDinner=()=>{
    const dayName=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()];
    return meals.find(m=>m.day===dayName)?.meal||'—';
  };

  // Dark dashboard tokens
  const D={
    bg:'#0F1013',card:'#1A1B21',border:'rgba(255,255,255,0.07)',
    t1:'#FFFFFF',t2:'rgba(255,255,255,0.65)',t3:'rgba(255,255,255,0.38)',t4:'rgba(255,255,255,0.20)',
    sep:'rgba(255,255,255,0.07)',
  };
  const isTV=window.innerWidth>=1440;
  const Widget=({children,style:s={}})=>(
    <div style={{background:D.card,borderRadius:16,border:`1px solid ${D.border}`,padding:isTV?'18px 22px':'16px 18px',overflow:'hidden',...s}}>{children}</div>
  );
  const WLabel=({children})=>(
    <div style={{fontSize:isTV?12:10,fontWeight:700,color:D.t3,textTransform:'uppercase',letterSpacing:'.10em',marginBottom:isTV?14:12}}>{children}</div>
  );

  if(isNightMode) return(
    <div onClick={dismissNight} style={{width:'100vw',height:'100vh',background:D.bg,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',userSelect:'none',position:'relative'}}>
      <div style={{display:'flex',alignItems:'baseline',gap:10}}>
        <span style={{fontSize:isMobile?80:148,fontWeight:800,color:'rgba(255,255,255,0.82)',lineHeight:1,letterSpacing:'-0.04em',fontVariantNumeric:'tabular-nums'}}>{h12}:{min}</span>
        <span style={{fontSize:isMobile?24:38,color:'rgba(255,255,255,0.32)',fontWeight:400}}>{ampm}</span>
      </div>
      <div style={{fontSize:isMobile?15:20,color:'rgba(255,255,255,0.32)',fontWeight:400,letterSpacing:'-.01em',marginTop:10}}>{dateStr}</div>
      {weather&&<div style={{fontSize:isMobile?13:16,color:'rgba(255,255,255,0.22)',marginTop:10}}>{weather.temp}° · {weather.condition}</div>}
      <div style={{position:'absolute',bottom:28,fontSize:11,color:'rgba(255,255,255,0.14)',fontFamily:'JetBrains Mono,monospace',letterSpacing:'.10em',textTransform:'uppercase'}}>tap to wake</div>
    </div>
  );

  return(
    <div style={{width:'100vw',height:'100vh',background:D.bg,overflow:'hidden',padding:isMobile?'16px 16px':isTV?'28px 36px':'24px 28px',display:'flex',flexDirection:'column',gap:isMobile?10:isTV?18:14,position:'relative'}}>
      <Confetti active={dmChoreConfetti} count={14}/>

      {/* Header — clock + date */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'baseline',gap:8}}>
          <span style={{fontSize:isMobile?64:isTV?140:108,fontWeight:800,color:D.t1,lineHeight:1,letterSpacing:'-0.04em',fontVariantNumeric:'tabular-nums'}}>{h12}:{min}</span>
          <span style={{fontSize:isMobile?18:isTV?36:28,color:D.t3,fontWeight:400,marginBottom:isMobile?6:isTV?14:10}}>{ampm}</span>
        </div>
        <div style={{textAlign:'right',paddingBottom:8}}>
          <div style={{fontSize:isMobile?14:isTV?26:20,color:D.t2,fontWeight:400,letterSpacing:'-.01em'}}>{dateStr}</div>
          <div style={{fontSize:isTV?14:12,color:D.t4,marginTop:5,display:'flex',alignItems:'center',gap:5,justifyContent:'flex-end',fontFamily:'JetBrains Mono,monospace'}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:A.green}}/>synced
          </div>
        </div>
      </div>

      {/* Widget grid — desktop: 3-col, mobile: stacked */}
      {isMobile?(
        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:12,minHeight:0}}>
          {/* Mobile: weather + dinner side-by-side */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <Widget>
              <WLabel>Weather</WLabel>
              {weather?(
                <>
                  <div style={{fontSize:44,fontWeight:800,color:D.t1,lineHeight:1,letterSpacing:'-.05em',fontVariantNumeric:'tabular-nums'}}>{weather.temp}°</div>
                  <div style={{fontSize:13,color:D.t2,fontWeight:500,marginTop:4}}>{weather.condition}</div>
                  <div style={{fontSize:11,color:D.t3,marginTop:2,marginBottom:10}}>H:{weather.hi}° · L:{weather.lo}°</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:2,borderTop:`1px solid ${D.sep}`,paddingTop:8}}>
                    {weather.forecast.slice(0,3).map(f=>(
                      <div key={f.day} style={{textAlign:'center'}}>
                        <div style={{fontSize:9,color:D.t3,fontWeight:600,marginBottom:2}}>{f.day.slice(0,3)}</div>
                        <div style={{fontSize:14,marginBottom:2}}>{f.icon}</div>
                        <div style={{fontSize:11,color:D.t1,fontWeight:700}}>{f.hi}°</div>
                        <div style={{fontSize:10,color:D.t4}}>{f.lo}°</div>
                      </div>
                    ))}
                  </div>
                </>
              ):<div style={{fontSize:13,color:D.t4}}>Loading…</div>}
            </Widget>
            <Widget>
              <WLabel>Dinner tonight</WLabel>
              <div style={{fontSize:18,fontWeight:700,color:D.t1,letterSpacing:'-.01em',lineHeight:1.3,marginBottom:10}}>{todayDinner()||'—'}</div>
              {[1].map(offset=>{
                const d=new Date(); d.setDate(d.getDate()+offset);
                const meal=(meals||[]).find(m=>m.day===DAYS[d.getDay()])?.meal||'—';
                return(
                  <div key={offset} style={{background:'rgba(255,255,255,0.05)',borderRadius:6,padding:'6px 9px'}}>
                    <div style={{fontSize:10,fontWeight:700,color:D.t3,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:2}}>Tomorrow</div>
                    <div style={{fontSize:12,color:meal!=='—'?D.t2:D.t4,fontWeight:500}}>{meal}</div>
                  </div>
                );
              })}
            </Widget>
          </div>
          {/* Mobile: upcoming events */}
          <Widget style={{flex:1}}>
            <WLabel>Upcoming</WLabel>
            {agendaDays.slice(0,2).map(({label,date})=>{
              const evs=events.filter(e=>e.date===date);
              return(
                <div key={date} style={{marginBottom:10}}>
                  <div style={{fontSize:10,fontWeight:700,color:D.t3,marginBottom:6,textTransform:'uppercase',letterSpacing:'.08em'}}>{label}</div>
                  {evs.length===0&&<div style={{fontSize:13,color:D.t4}}>Free</div>}
                  {evs.slice(0,3).map(ev=>(
                    <div key={ev.id} style={{background:ev.color+'18',borderRadius:8,padding:'8px 11px',marginBottom:4,borderLeft:`3px solid ${ev.color}`}}>
                      <div style={{fontSize:14,color:D.t1,fontWeight:600}}>{ev.title}</div>
                      <div style={{fontSize:12,color:D.t3,fontVariantNumeric:'tabular-nums',marginTop:1}}>{fmtTime(ev.time,clockFormat)}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </Widget>
          {/* Mobile: chores */}
          {chores.filter(c=>!c.done).length>0&&(
            <Widget>
              <WLabel>Chores due</WLabel>
              {chores.filter(c=>(c.status==='due'||c.status==='overdue')&&!c.done).slice(0,4).map((c,i)=>(
                <div key={c.id} onClick={()=>toggleChore(c.id)} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 0',borderBottom:`1px solid ${D.sep}`,cursor:'pointer'}}>
                  <div style={{width:20,height:20,borderRadius:'50%',flexShrink:0,border:`1.5px solid ${D.t4}`,display:'flex',alignItems:'center',justifyContent:'center'}}/>
                  <span style={{flex:1,fontSize:14,color:D.t2,fontWeight:500}}>{c.name}</span>
                  <span style={{fontSize:11,color:c.status==='overdue'?A.red:A.amber,fontWeight:700}}>{c.status==='overdue'?'Overdue':'Today'}</span>
                </div>
              ))}
            </Widget>
          )}
        </div>
      ):(
        <div style={{flex:1,display:'flex',flexDirection:'column',gap:12,minHeight:0}}>

          {/* Main 3-col grid */}
          <div style={{flex:1,display:'grid',gridTemplateColumns:'1fr 1.6fr 1fr',gap:isTV?16:12,minHeight:0,zoom:isTV?1.1:undefined}}>

            {/* LEFT: Upcoming events */}
            <Widget style={{display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <WLabel>Upcoming</WLabel>
              <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:14,WebkitMaskImage:'linear-gradient(to bottom,black calc(100% - 24px),transparent 100%)',maskImage:'linear-gradient(to bottom,black calc(100% - 24px),transparent 100%)'}}>
                {agendaDays.map(({label,date})=>{
                  const evs=events.filter(e=>e.date===date);
                  return(
                    <div key={date}>
                      <div style={{fontSize:10,fontWeight:700,color:D.t3,marginBottom:6,textTransform:'uppercase',letterSpacing:'.08em'}}>{label}</div>
                      {evs.length===0&&<div style={{fontSize:13,color:D.t4}}>Free</div>}
                      {evs.map(ev=>(
                        <div key={ev.id} style={{background:ev.color+'18',borderRadius:8,padding:'8px 11px',marginBottom:4,borderLeft:`3px solid ${ev.color}`}}>
                          <div style={{fontSize:14,color:D.t1,fontWeight:600}}>{ev.title}</div>
                          <div style={{fontSize:12,color:D.t3,fontVariantNumeric:'tabular-nums',marginTop:1}}>{fmtTime(ev.time,clockFormat)}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </Widget>

            {/* CENTER: rotating panel + dinner */}
            <div style={{display:'flex',flexDirection:'column',gap:12,minHeight:0}}>
              {centerPanels.length>0&&(
                <div key={activePanelId} className='screen' style={{flex:1,display:'flex',flexDirection:'column',minHeight:0}}>
                  <Widget style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                    {centerPanels.length>1&&(
                      <div style={{display:'flex',gap:5,marginBottom:10}}>
                        {centerPanels.map((p,i)=>(
                          <div key={p} style={{width:5,height:5,borderRadius:'50%',background:i===centerIdx%centerPanels.length?D.t2:D.t4,transition:'background .4s'}}/>
                        ))}
                      </div>
                    )}
                    {activePanelId==='chores'&&(
                      <>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                          <WLabel>Chores</WLabel>
                          <span style={{fontSize:11,fontWeight:700,color:A.amber}}>{dueC.length} due</span>
                        </div>
                        <div style={{flex:1,overflowY:'auto',WebkitMaskImage:'linear-gradient(to bottom,black calc(100% - 24px),transparent 100%)',maskImage:'linear-gradient(to bottom,black calc(100% - 24px),transparent 100%)'}}>
                          {dueC.map(c=>(
                            <div key={c.id} onClick={()=>toggleChore(c.id)} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 0',borderBottom:`1px solid ${D.sep}`,cursor:'pointer'}}>
                              <div style={{width:22,height:22,borderRadius:'50%',flexShrink:0,border:`1.5px solid ${D.t4}`,display:'flex',alignItems:'center',justifyContent:'center'}}/>
                              <span style={{flex:1,fontSize:14,color:D.t2,fontWeight:500}}>{c.name}</span>
                              <span style={{fontSize:11,color:c.status==='overdue'?A.red:A.amber,fontWeight:700}}>{c.status==='overdue'?'Overdue':'Today'}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {activePanelId==='countdowns'&&(
                      <>
                        <WLabel>Countdowns</WLabel>
                        <div style={{flex:1,overflowY:'auto',marginTop:2}}>
                          {upCD.map(c=>{
                            const days=daysUntil(c.date);
                            return(
                              <div key={c.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderBottom:`1px solid ${D.sep}`}}>
                                <span style={{fontSize:22}}>{c.emoji}</span>
                                <span style={{flex:1,fontSize:15,color:D.t2,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.label}</span>
                                <span style={{fontSize:18,fontWeight:800,color:D.t1,flexShrink:0}}>{days===0?'Today':days+'d'}</span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {activePanelId==='goals'&&(
                      <>
                        <WLabel>Goals</WLabel>
                        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:16,marginTop:2}}>
                          {goals.map(g=>{
                            const pct=g.progress_target>0?Math.min(100,Math.round((g.progress_current/g.progress_target)*100)):0;
                            const done=pct>=100;
                            const isCounter=g.progress_type==='counter';
                            return(
                              <div key={g.id}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:8}}>
                                  <span style={{fontSize:15,fontWeight:600,color:D.t1}}>{g.name}</span>
                                  <span style={{fontSize:14,fontWeight:700,color:done?A.green:D.t3}}>{isCounter?`${g.unit||''}${g.progress_current}/${g.unit||''}${g.progress_target}`:`${pct}%`}</span>
                                </div>
                                <div style={{height:6,borderRadius:3,background:'rgba(255,255,255,0.08)',overflow:'hidden'}}>
                                  <div style={{height:'100%',borderRadius:3,width:`${pct}%`,background:done?A.green:pct>60?A.amber:'rgba(255,255,255,0.35)',transition:'width .6s'}}/>
                                </div>
                                {g.description&&<div style={{fontSize:11,color:D.t4,marginTop:5}}>{g.description}</div>}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {activePanelId==='members'&&(
                      <>
                        <WLabel>Family Progress</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',gap:14,justifyContent:'center',overflowY:'auto',marginTop:2}}>
                          {progressMembers.map(m=>{
                            const pct=m.monthly_goal>0?Math.min(100,Math.round((m.points/m.monthly_goal)*100)):0;
                            const hit=m.points>=m.monthly_goal;
                            return(
                              <div key={m.id} style={{display:'flex',alignItems:'center',gap:12}}>
                                <div style={{width:42,height:42,borderRadius:'50%',background:m.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontWeight:700,color:'#fff',flexShrink:0}}>{m.initials}</div>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:7}}>
                                    <span style={{fontSize:15,fontWeight:600,color:D.t1}}>{m.name}</span>
                                    <span style={{fontSize:14,fontWeight:700,color:hit?A.green:D.t2}}>{m.points}{m.monthly_goal>0?`/${m.monthly_goal} pts`:' pts'}</span>
                                  </div>
                                  <div style={{height:6,borderRadius:3,background:'rgba(255,255,255,0.08)',overflow:'hidden'}}>
                                    <div style={{height:'100%',borderRadius:3,width:`${pct}%`,background:hit?A.green:pct>60?A.amber:'rgba(255,255,255,0.35)',transition:'width .6s'}}/>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {activePanelId==='w_quote'&&(
                      <>
                        <WLabel>Quote</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center'}}>
                          <div style={{fontSize:17,color:D.t1,fontWeight:500,lineHeight:1.5,fontStyle:'italic',marginBottom:10}}>"{widgetData.quote?.text}"</div>
                          <div style={{fontSize:13,color:D.t3}}>— {widgetData.quote?.author}</div>
                        </div>
                      </>
                    )}
                    {activePanelId==='w_stocks'&&(
                      <>
                        <WLabel>Markets</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:10,marginTop:4}}>
                          {widgetData.stocks?.map(s=>{
                            const up=parseFloat(s.change)>=0;
                            return(
                              <div key={s.ticker} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                <span style={{fontSize:16,fontWeight:700,color:D.t1,letterSpacing:'.02em'}}>{s.ticker}</span>
                                <div style={{textAlign:'right'}}>
                                  <div style={{fontSize:17,fontWeight:800,color:D.t1,fontVariantNumeric:'tabular-nums'}}>${s.price}</div>
                                  <div style={{fontSize:12,fontWeight:600,color:up?A.green:A.red}}>{up?'+':''}{s.change}%</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {activePanelId==='w_producthunt'&&(
                      <>
                        <WLabel>Product Hunt today</WLabel>
                        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:8,marginTop:4}}>
                          {widgetData.producthunt?.slice(0,4).map((p,i)=>(
                            <div key={i} style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                              <span style={{fontSize:12,color:D.t4,fontWeight:700,flexShrink:0,minWidth:14,marginTop:2}}>{i+1}</span>
                              <div>
                                <div style={{fontSize:14,color:D.t1,fontWeight:600,lineHeight:1.3}}>{p.title}</div>
                                {p.tagline&&<div style={{fontSize:11,color:D.t3,marginTop:2}}>{p.tagline}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {activePanelId==='w_github'&&(
                      <>
                        <WLabel>GitHub — {widgetData.github?.username}</WLabel>
                        <div style={{fontSize:12,color:D.t3,marginBottom:8}}>{widgetData.github?.total} contributions · last 30 days</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                          {widgetData.github?.days?.map((count,i)=>(
                            <div key={i} style={{width:11,height:11,borderRadius:2,background:count===0?'rgba(255,255,255,0.07)':count<3?'#1a7f37':count<6?'#2ea043':count<9?'#40c463':'#9be9a8'}}/>
                          ))}
                        </div>
                      </>
                    )}
                    {activePanelId==='w_reddit'&&(
                      <>
                        <WLabel>Reddit — {widgetData.reddit?.sub}</WLabel>
                        <div style={{flex:1,overflowY:'auto',marginTop:2}}>
                          {widgetData.reddit?.posts?.map((post,i)=>(
                            <div key={i} style={{padding:'7px 0',borderBottom:`1px solid ${D.sep}`}}>
                              <div style={{fontSize:13,color:D.t2,fontWeight:500,lineHeight:1.35}}>{post.title}</div>
                              <div style={{fontSize:11,color:D.t4,marginTop:2}}>{post.sub&&<span style={{color:D.t3,marginRight:6}}>r/{post.sub}</span>}{post.score?.toLocaleString()} pts</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {activePanelId==='w_beehiiv'&&(
                      <>
                        <WLabel>Newsletter</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',textAlign:'center'}}>
                          <div style={{fontSize:52,fontWeight:800,color:D.t1,letterSpacing:'-.04em',lineHeight:1}}>{widgetData.beehiiv?.subscribers?.toLocaleString()}</div>
                          <div style={{fontSize:14,color:D.t3,marginTop:8}}>active subscribers</div>
                          {widgetData.beehiiv?.name&&<div style={{fontSize:11,color:D.t4,marginTop:4}}>{widgetData.beehiiv.name}</div>}
                        </div>
                      </>
                    )}
                    {activePanelId==='w_youtube'&&(
                      <>
                        <WLabel>YouTube — {widgetData.youtube?.name}</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:16,marginTop:4}}>
                          <div style={{textAlign:'center'}}>
                            <div style={{fontSize:44,fontWeight:800,color:D.t1,letterSpacing:'-.04em',lineHeight:1}}>{widgetData.youtube?.subscribers?.toLocaleString()}</div>
                            <div style={{fontSize:13,color:D.t3,marginTop:4}}>subscribers</div>
                          </div>
                          <div style={{display:'flex',gap:8}}>
                            <div style={{flex:1,background:'rgba(255,255,255,0.06)',borderRadius:8,padding:'10px',textAlign:'center'}}>
                              <div style={{fontSize:16,fontWeight:700,color:D.t1}}>{(widgetData.youtube?.views/1000000)>=1?(widgetData.youtube.views/1000000).toFixed(1)+'M':(widgetData.youtube?.views/1000).toFixed(0)+'K'}</div>
                              <div style={{fontSize:10,color:D.t4,marginTop:2}}>total views</div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                    {activePanelId==='w_etsy'&&(
                      <>
                        <WLabel>Etsy — {widgetData.etsy?.name}</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:16,marginTop:4}}>
                          <div style={{display:'flex',gap:8}}>
                            <div style={{flex:1,background:'rgba(255,255,255,0.06)',borderRadius:8,padding:'12px',textAlign:'center'}}>
                              <div style={{fontSize:28,fontWeight:800,color:D.t1}}>{widgetData.etsy?.sales?.toLocaleString()}</div>
                              <div style={{fontSize:11,color:D.t4,marginTop:4}}>total sales</div>
                            </div>
                            <div style={{flex:1,background:'rgba(255,255,255,0.06)',borderRadius:8,padding:'12px',textAlign:'center'}}>
                              <div style={{fontSize:28,fontWeight:800,color:D.t1}}>{widgetData.etsy?.listings}</div>
                              <div style={{fontSize:11,color:D.t4,marginTop:4}}>active listings</div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                    {activePanelId==='w_powerwall'&&(()=>{
                      const pw=widgetData.powerwall;
                      const gridExport=pw.grid_kw<0;
                      const batCharging=pw.battery_kw<0;
                      return(
                        <>
                          <WLabel>Powerwall</WLabel>
                          <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:10}}>
                            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
                              <div style={{fontSize:38,fontWeight:800,color:D.t1,letterSpacing:'-.03em',lineHeight:1}}>{pw.battery_pct}%</div>
                              <div style={{flex:1,height:10,borderRadius:5,background:'rgba(255,255,255,0.08)',overflow:'hidden'}}>
                                <div style={{height:'100%',borderRadius:5,width:`${pw.battery_pct}%`,background:pw.battery_pct>20?A.green:A.red,transition:'width .6s'}}/>
                              </div>
                            </div>
                            {[
                              {label:'Solar',kw:pw.solar_kw,note:pw.solar_kw>0?`${pw.solar_kw} kW`:null,color:A.amber},
                              {label:'Home', kw:pw.load_kw, note:`${pw.load_kw} kW`,color:D.t2},
                              {label:'Grid', kw:Math.abs(pw.grid_kw),note:`${Math.abs(pw.grid_kw)} kW ${gridExport?'export':'import'}`,color:gridExport?A.green:D.t3},
                              {label:'Battery',kw:Math.abs(pw.battery_kw),note:pw.battery_kw===0?'Idle':`${Math.abs(pw.battery_kw)} kW ${batCharging?'charging':'discharging'}`,color:A.green},
                            ].map(row=>(
                              <div key={row.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                <span style={{fontSize:13,color:D.t3,width:56}}>{row.label}</span>
                                <span style={{fontSize:14,fontWeight:600,color:row.color||D.t1}}>{row.note||'—'}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                    {activePanelId==='w_flight'&&(()=>{
                      const f=widgetData.flight;
                      const statusColor={active:A.green,landed:A.green,scheduled:D.t3,cancelled:A.red,incident:A.red,diverted:A.amber}[f.status]||D.t3;
                      return(
                        <>
                          <WLabel>{f.flight} — {f.airline}</WLabel>
                          <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:14}}>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <div style={{textAlign:'center',flex:1}}>
                                <div style={{fontSize:22,fontWeight:800,color:D.t1}}>{f.dep_iata}</div>
                                <div style={{fontSize:11,color:D.t4,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.dep_city}</div>
                              </div>
                              <div style={{fontSize:13,color:D.t4,flexShrink:0}}>→</div>
                              <div style={{textAlign:'center',flex:1}}>
                                <div style={{fontSize:22,fontWeight:800,color:D.t1}}>{f.arr_iata}</div>
                                <div style={{fontSize:11,color:D.t4,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.arr_city}</div>
                              </div>
                            </div>
                            <div style={{display:'flex',gap:8}}>
                              <div style={{flex:1,background:'rgba(255,255,255,0.06)',borderRadius:8,padding:'10px',textAlign:'center'}}>
                                <div style={{fontSize:16,fontWeight:700,color:D.t1}}>{f.dep_actual||f.dep_sched}</div>
                                {f.dep_actual&&f.dep_actual!==f.dep_sched&&<div style={{fontSize:10,color:D.t4,textDecoration:'line-through'}}>{f.dep_sched}</div>}
                                <div style={{fontSize:10,color:D.t4,marginTop:2}}>departs</div>
                              </div>
                              <div style={{flex:1,background:'rgba(255,255,255,0.06)',borderRadius:8,padding:'10px',textAlign:'center'}}>
                                <div style={{fontSize:16,fontWeight:700,color:D.t1}}>{f.arr_actual||f.arr_sched}</div>
                                {f.arr_actual&&f.arr_actual!==f.arr_sched&&<div style={{fontSize:10,color:D.t4,textDecoration:'line-through'}}>{f.arr_sched}</div>}
                                <div style={{fontSize:10,color:D.t4,marginTop:2}}>arrives</div>
                              </div>
                            </div>
                            <div style={{textAlign:'center',fontSize:12,fontWeight:700,color:statusColor,textTransform:'capitalize'}}>{f.status}</div>
                          </div>
                        </>
                      );
                    })()}
                    {activePanelId==='w_uptime'&&(
                      <>
                        <WLabel>Services</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:8}}>
                          {(widgetData.uptime||[]).map((s,i)=>(
                            <div key={i} style={{display:'flex',alignItems:'center',gap:10}}>
                              <div style={{width:8,height:8,borderRadius:'50%',background:s.ok?A.green:A.red,flexShrink:0}}/>
                              <div style={{flex:1,fontSize:13,fontWeight:500,color:D.t2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</div>
                              <div style={{textAlign:'right',flexShrink:0}}>
                                <div style={{fontSize:12,color:s.ok?A.green:A.red,fontWeight:600}}>{s.ok?(s.ms!=null?`${s.ms}ms`:'ok'):'down'}</div>
                                {s.uptime!=null&&<div style={{fontSize:10,color:D.t4}}>{(s.uptime*100).toFixed(1)}%</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {activePanelId==='w_nextdns'&&(()=>{
                      const nd=widgetData.nextdns;
                      return(
                        <>
                          <WLabel>NextDNS — 24h</WLabel>
                          <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:16}}>
                            <div style={{textAlign:'center'}}>
                              <div style={{fontSize:44,fontWeight:800,color:D.t1,letterSpacing:'-.04em',lineHeight:1}}>{nd.total?.toLocaleString()}</div>
                              <div style={{fontSize:12,color:D.t4,marginTop:4}}>total queries</div>
                            </div>
                            <div style={{display:'flex',gap:8}}>
                              <div style={{flex:1,background:'rgba(255,59,48,0.10)',borderRadius:8,padding:'10px',textAlign:'center'}}>
                                <div style={{fontSize:22,fontWeight:700,color:A.red}}>{nd.blocked?.toLocaleString()}</div>
                                <div style={{fontSize:10,color:D.t4,marginTop:2}}>blocked</div>
                              </div>
                              <div style={{flex:1,background:'rgba(52,199,89,0.10)',borderRadius:8,padding:'10px',textAlign:'center'}}>
                                <div style={{fontSize:22,fontWeight:700,color:A.green}}>{nd.pct}%</div>
                                <div style={{fontSize:10,color:D.t4,marginTop:2}}>block rate</div>
                              </div>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                    {activePanelId==='w_beszel'&&(
                      <>
                        <WLabel>Servers</WLabel>
                        <div style={{flex:1,display:'flex',flexWrap:'wrap',gap:8,alignContent:'flex-start'}}>
                          {(widgetData.beszel||[]).map((srv,i)=>(
                            <div key={i} style={{flex:'1 1 45%',minWidth:0,background:'rgba(255,255,255,0.05)',borderRadius:10,padding:'10px 12px',display:'flex',flexDirection:'column',gap:7}}>
                              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                                <div style={{width:7,height:7,borderRadius:'50%',background:srv.status==='up'?A.green:A.red,flexShrink:0}}/>
                                <div style={{fontSize:12,fontWeight:700,color:D.t1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{srv.name}</div>
                              </div>
                              {srv.cpu!=null&&(
                                <div>
                                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:D.t3,marginBottom:3}}><span>CPU</span><span style={{fontWeight:600,color:D.t2}}>{srv.cpu}%</span></div>
                                  <div style={{height:4,borderRadius:2,background:'rgba(255,255,255,0.08)'}}><div style={{width:`${Math.min(100,srv.cpu)}%`,height:'100%',borderRadius:2,background:A.blue}}/></div>
                                </div>
                              )}
                              {srv.memPct!=null&&(
                                <div>
                                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:D.t3,marginBottom:3}}><span>RAM</span><span style={{fontWeight:600,color:D.t2}}>{srv.memPct}%</span></div>
                                  <div style={{height:4,borderRadius:2,background:'rgba(255,255,255,0.08)'}}><div style={{width:`${Math.min(100,srv.memPct)}%`,height:'100%',borderRadius:2,background:'#BF5AF2'}}/></div>
                                </div>
                              )}
                              {srv.diskPct!=null&&(
                                <div>
                                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:D.t3,marginBottom:3}}><span>Disk</span><span style={{fontWeight:600,color:D.t2}}>{srv.diskPct}%</span></div>
                                  <div style={{height:4,borderRadius:2,background:'rgba(255,255,255,0.08)'}}><div style={{width:`${Math.min(100,srv.diskPct)}%`,height:'100%',borderRadius:2,background:A.amber}}/></div>
                                </div>
                              )}
                              {srv.temp!=null&&(
                                <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:D.t3,marginTop:1}}>
                                  <span>Temp</span><span style={{fontWeight:600,color:srv.temp>70?A.red:srv.temp>55?A.amber:D.t2}}>{srv.temp}°C</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {activePanelId==='w_plex'&&(()=>{
                      const px=widgetData.plex;
                      const isPlaying=px?.type==='playing';
                      const items=px?.items||[];
                      if(isPlaying) return(
                        <>
                          <WLabel>Now Playing on Plex</WLabel>
                          <div style={{flex:1,display:'flex',flexDirection:'column',gap:10,justifyContent:'space-evenly'}}>
                            {items.map((item,i)=>(
                              <div key={i} style={{display:'flex',gap:14,alignItems:'center'}}>
                                {item.thumb&&<img src={item.thumb} alt="" style={{width:72,height:72,objectFit:'cover',borderRadius:9,flexShrink:0,background:'rgba(255,255,255,0.06)'}} onError={e=>e.target.style.display='none'}/>}
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:15,fontWeight:700,color:D.t1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',letterSpacing:'-.01em'}}>{item.title}</div>
                                  {item.user&&<div style={{fontSize:12,color:D.t3,marginTop:3}}>{item.state==='paused'?'Paused · ':''}{item.user}</div>}
                                  {item.pct!=null&&(
                                    <>
                                      <div style={{marginTop:10,height:4,borderRadius:3,background:'rgba(255,255,255,0.12)'}}>
                                        <div style={{width:`${item.pct}%`,height:'100%',borderRadius:3,background:A.amber}}/>
                                      </div>
                                      <div style={{fontSize:10,color:D.t4,marginTop:4}}>{item.pct}%</div>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                      return(
                        <>
                          <WLabel>Recently Added</WLabel>
                          {items.length===0?(
                            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
                              <div style={{fontSize:12,color:D.t4}}>Nothing playing</div>
                            </div>
                          ):(
                            <div style={{flex:1,display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,alignContent:'stretch'}}>
                              {items.map((item,i)=>(
                                <div key={i} style={{display:'flex',flexDirection:'column',minHeight:0}}>
                                  {item.thumb&&<img src={item.thumb} alt="" style={{width:'100%',flex:1,minHeight:0,objectFit:'cover',borderRadius:7,background:'rgba(255,255,255,0.06)',display:'block'}} onError={e=>e.target.style.display='none'}/>}
                                  <div style={{fontSize:11,fontWeight:600,color:D.t1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginTop:5}}>{item.title}</div>
                                  {item.year&&<div style={{fontSize:10,color:D.t4}}>{item.year}</div>}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {activePanelId==='w_moen'&&(()=>{
                      const m=widgetData.moen;
                      const modeColor={home:A.green,away:A.amber,sleep:A.indigo}[m.system_mode]||D.t3;
                      return(
                        <>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                            <WLabel>Moen Flo</WLabel>
                            {m.has_alert&&<span style={{fontSize:11,fontWeight:700,color:A.red}}>LEAK ALERT</span>}
                          </div>
                          <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:14}}>
                            <div style={{display:'flex',gap:10,alignItems:'stretch'}}>
                              <div style={{flex:1,background:'rgba(255,255,255,0.06)',borderRadius:10,padding:'12px',textAlign:'center'}}>
                                <div style={{fontSize:36,fontWeight:800,color:D.t1,letterSpacing:'-.03em',lineHeight:1}}>{m.daily_gal}</div>
                                <div style={{fontSize:11,color:D.t4,marginTop:4}}>gal today</div>
                              </div>
                              <div style={{flex:1,background:'rgba(255,255,255,0.06)',borderRadius:10,padding:'12px',textAlign:'center'}}>
                                <div style={{fontSize:36,fontWeight:800,color:m.flow_gpm>0?A.blue:D.t1,letterSpacing:'-.03em',lineHeight:1}}>{m.flow_gpm}</div>
                                <div style={{fontSize:11,color:D.t4,marginTop:4}}>gpm now</div>
                              </div>
                            </div>
                            {[
                              {label:'Pressure',val:`${m.psi} psi`,color:D.t2},
                              {label:'Mode',val:m.system_mode,color:modeColor},
                              {label:'Status',val:m.connected?'Connected':'Offline',color:m.connected?A.green:A.red},
                            ].map(row=>(
                              <div key={row.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                <span style={{fontSize:13,color:D.t3}}>{row.label}</span>
                                <span style={{fontSize:14,fontWeight:600,color:row.color,textTransform:'capitalize'}}>{row.val}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                    {activePanelId==='w_unifi'&&(()=>{
                      const u=widgetData.unifi;
                      const upColor=u.status==='up'?A.green:A.red;
                      return(
                        <>
                          <WLabel>UniFi Network</WLabel>
                          <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:12}}>
                            <div style={{display:'flex',gap:10}}>
                              <div style={{flex:1,background:'rgba(255,255,255,0.06)',borderRadius:10,padding:'12px',textAlign:'center'}}>
                                <div style={{fontSize:40,fontWeight:800,color:D.t1,letterSpacing:'-.04em',lineHeight:1}}>{u.clients}</div>
                                <div style={{fontSize:11,color:D.t4,marginTop:4}}>devices online</div>
                              </div>
                              <div style={{flex:1,background:'rgba(255,255,255,0.06)',borderRadius:10,padding:'12px',textAlign:'center'}}>
                                <div style={{fontSize:24,fontWeight:700,color:D.t1}}>{u.ap_count}</div>
                                <div style={{fontSize:11,color:D.t4,marginTop:4}}>access points</div>
                              </div>
                            </div>
                            {[
                              {label:'WAN',val:u.status,color:upColor},
                              {label:'Download',val:`${u.rx_mbps} Mbps`,color:D.t2},
                              {label:'Upload',val:`${u.tx_mbps} Mbps`,color:D.t2},
                            ].map(row=>(
                              <div key={row.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                <span style={{fontSize:13,color:D.t3}}>{row.label}</span>
                                <span style={{fontSize:14,fontWeight:600,color:row.color,textTransform:'capitalize'}}>{row.val}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </Widget>
                </div>
              )}
              <Widget style={{flexShrink:0}}>
                <WLabel>Dinner tonight</WLabel>
                <div style={{fontSize:26,fontWeight:700,color:D.t1,letterSpacing:'-.02em',lineHeight:1.2,marginBottom:12}}>{todayDinner()||'—'}</div>
                <div style={{display:'flex',gap:8}}>
                  {[1,2].map(offset=>{
                    const d=new Date(); d.setDate(d.getDate()+offset);
                    const dayName=DAYS[d.getDay()];
                    const meal=(meals||[]).find(m=>m.day===dayName)?.meal||'—';
                    return(
                      <div key={offset} style={{flex:1,background:'rgba(255,255,255,0.05)',borderRadius:8,padding:'7px 10px'}}>
                        <div style={{fontSize:10,fontWeight:700,color:D.t3,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:3}}>{offset===1?'Tomorrow':dayName}</div>
                        <div style={{fontSize:12,color:meal!=='—'?D.t2:D.t4,fontWeight:500}}>{meal}</div>
                      </div>
                    );
                  })}
                </div>
              </Widget>
            </div>

            {/* RIGHT: weather + dynamic extras */}
            <div style={{display:'flex',flexDirection:'column',gap:12,minHeight:0,overflow:'hidden'}}>
              {/* Weather — always */}
              <Widget style={{flexShrink:0}}>
                <WLabel>Weather</WLabel>
                {weather?(
                  <>
                    <div style={{display:'flex',alignItems:'baseline',gap:10,marginBottom:6}}>
                      <span style={{fontSize:48,fontWeight:800,color:D.t1,lineHeight:1,letterSpacing:'-.05em',fontVariantNumeric:'tabular-nums'}}>{weather.temp}°</span>
                      <div>
                        <div style={{fontSize:13,color:D.t2,fontWeight:500}}>{weather.condition}</div>
                        <div style={{fontSize:11,color:D.t3,marginTop:1}}>H:{weather.hi}° · L:{weather.lo}°</div>
                      </div>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:2,borderTop:`1px solid ${D.sep}`,paddingTop:8}}>
                      {weather.forecast.map(f=>(
                        <div key={f.day} style={{textAlign:'center'}}>
                          <div style={{fontSize:9,color:D.t3,fontWeight:600,marginBottom:2}}>{f.day}</div>
                          <div style={{fontSize:15,marginBottom:2}}>{f.icon}</div>
                          <div style={{fontSize:11,color:D.t1,fontWeight:700}}>{f.hi}°</div>
                          <div style={{fontSize:10,color:D.t4}}>{f.lo}°</div>
                        </div>
                      ))}
                    </div>
                  </>
                ):(
                  <div style={{fontSize:13,color:D.t4}}>Loading…</div>
                )}
              </Widget>
              {/* Grocery — if items exist */}
              {(grocery||[]).filter(g=>!g.checked).length>0&&(
                <Widget style={{flexShrink:0}}>
                  <WLabel>Grocery</WLabel>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2px 12px'}}>
                    {(grocery||[]).filter(g=>!g.checked).slice(0,8).map(item=>(
                      <div key={item.id} style={{display:'flex',alignItems:'center',gap:7,padding:'4px 0'}}>
                        <div style={{width:4,height:4,borderRadius:'50%',background:'rgba(255,255,255,0.35)',flexShrink:0}}/>
                        <span style={{fontSize:13,color:D.t2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name}</span>
                      </div>
                    ))}
                  </div>
                </Widget>
              )}
              {/* WiFi QR — when configured */}
              {wifiQrData&&(
                <Widget style={{flexShrink:0}}>
                  <WLabel>Guest WiFi</WLabel>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
                    <img src={wifiQrData.dataUrl} alt="WiFi QR" style={{width:'100%',maxWidth:200,borderRadius:8,display:'block'}}/>
                    <div style={{fontSize:13,fontWeight:600,color:D.t2,letterSpacing:'.02em'}}>{wifiQrData.ssid}</div>
                  </div>
                </Widget>
              )}
              {/* Pinned notes — fills remaining space */}
              {pinnedNotes.length>0&&(
                <Widget style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0}}>
                  <WLabel>Notes</WLabel>
                  <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:8}}>
                    {pinnedNotes.map(n=>(
                      <div key={n.id} style={{background:n.color&&n.color!=='#FAFAF5'?n.color+'28':'rgba(255,255,255,0.07)',borderRadius:8,padding:'10px 12px',borderLeft:`3px solid ${n.color&&n.color!=='#FAFAF5'?n.color:'rgba(255,255,255,0.25)'}`}}>
                        <div style={{fontSize:13,fontWeight:700,color:D.t2,marginBottom:n.content?6:0,lineHeight:1.3,textTransform:'uppercase',letterSpacing:'.04em'}}>{n.title}</div>
                        {n.content&&<div style={{fontSize:16,fontWeight:600,color:D.t1,lineHeight:1.6,whiteSpace:'pre-wrap',fontFamily:'JetBrains Mono,monospace',letterSpacing:'.06em',wordBreak:'break-all'}}>{n.content}</div>}
                      </div>
                    ))}
                  </div>
                </Widget>
              )}
            </div>

          </div>{/* end main 3-col grid */}


        </div>
      )}

      {/* Activity bar — news ticker + smart home events + live scores + manage */}
      <div style={{flexShrink:0,display:'flex',alignItems:'center',gap:12}}>
        <div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:10,overflow:'hidden'}}>
          {news.length>0&&(
            <>
              <div style={{width:5,height:5,borderRadius:'50%',background:D.t4,flexShrink:0}}/>
              <span style={{fontSize:12,color:D.t3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',transition:'opacity .5s',opacity:newsVisible?1:0}}>
                {news[newsIdx%news.length]?.title}
              </span>
            </>
          )}
          {allSmartEvents.length>0&&(
            <>
              {news.length>0&&<span style={{color:D.sep,flexShrink:0}}>·</span>}
              <div style={{width:6,height:6,borderRadius:'50%',background:A.blue,flexShrink:0}}/>
              <span style={{fontSize:12,color:D.t2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flexShrink:0,maxWidth:'30%'}}>
                {allSmartEvents[0].icon} {allSmartEvents[0].title}{allSmartEvents[0].message?` · ${allSmartEvents[0].message}`:''}
              </span>
            </>
          )}
          {liveGames.length>0&&(
            <>
              {(news.length>0||allSmartEvents.length>0)&&<span style={{color:D.sep,flexShrink:0}}>·</span>}
              <div style={{width:6,height:6,borderRadius:'50%',background:A.red,animation:'pulse 1.2s ease infinite',flexShrink:0}}/>
              <div style={{display:'flex',alignItems:'center',gap:12,overflow:'hidden'}}>
                {liveGames.slice(0,4).map((g,i)=>(
                  <span key={g.id||i} style={{fontSize:12,color:D.t1,fontVariantNumeric:'tabular-nums',fontWeight:600,flexShrink:0}}>
                    {g.away?.abbr} {g.away?.score}–{g.home?.score} {g.home?.abbr}{g.detail&&<span style={{fontSize:11,color:D.t4,marginLeft:3}}>{g.detail}</span>}
                    {i<Math.min(3,liveGames.length-1)&&<span style={{color:D.sep,marginLeft:8}}>·</span>}
                  </span>
                ))}
              </div>
            </>
          )}
          {nowPlaying.playing&&(
            <>
              {(news.length>0||allSmartEvents.length>0||liveGames.length>0)&&<span style={{color:D.sep,flexShrink:0}}>·</span>}
              {nowPlaying.thumb?<img src={nowPlaying.thumb} style={{width:14,height:14,borderRadius:2,objectFit:'cover',flexShrink:0}}/>:<svg width="12" height="12" viewBox="0 0 24 24" fill={A.amber} style={{flexShrink:0}}><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/></svg>}
              <span style={{fontSize:12,color:A.amber,fontWeight:600,flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'28%'}}>
                {nowPlaying.title}{nowPlaying.artist?` · ${nowPlaying.artist}`:''}
              </span>
            </>
          )}
        </div>
        <button onClick={onManage} style={{flexShrink:0,background:'rgba(255,255,255,0.08)',color:D.t2,border:'1px solid rgba(255,255,255,0.12)',borderRadius:A.rPill,padding:'9px 20px',fontSize:13,fontWeight:500,cursor:'pointer',transition:'background .15s,opacity .4s',opacity:showControls?1:0,pointerEvents:showControls?'auto':'none'}}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.13)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.08)'}
        >Manage</button>
      </div>
    </div>
  );
}

/* ── Dashboard ───────────────────────────────────────────────────────── */
function DashboardScreen({events,setEvents,chores,grocery,meals,countdowns,weather,clockFormat='12h',quickActions=[]}){
  const isMobile=useIsMobile();
  const now=useClock();
  const [news,setNews]=useState([]);
  useEffect(()=>{api.get('/api/news').then(d=>{if(Array.isArray(d))setNews(d);}).catch(()=>{});},[]);
  const [qaOpen,setQaOpen]=useState(false);
  const [qaForm,setQaForm]=useState({title:'',date:localDate(),time:'',cal:'kith'});
  const [qaLoading,setQaLoading]=useState(false);
  const [leaderboard,setLeaderboard]=useState([]);
  const [haEvents,setHaEvents]=useState([]);
  const [qaState,setQaState]=useState({});
  const [showConfetti,setShowConfetti]=useState(false);
  const prevDueRef=useRef(null);

  const h=now.getHours();
  const greeting=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  const todayStr=localDate();
  const todayEvs=events.filter(e=>e.date===todayStr);
  const dueChores=chores.filter(c=>(c.status==='due'||c.status==='overdue')&&!c.done);
  const groceryRemaining=(grocery||[]).filter(g=>!g.checked).length;
  const clockOpts=clockFormat==='24h'?{hour:'2-digit',minute:'2-digit',hour12:false}:{hour:'numeric',minute:'2-digit'};

  const weekDays=useMemo(()=>Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()+i);
    const ds=localDate(d);
    return{label:DAYS[d.getDay()].slice(0,3),num:d.getDate(),date:ds,isToday:i===0,evs:events.filter(e=>e.date===ds)};
  }),[events]);

  const submitQuickAdd=async()=>{
    if(!qaForm.title.trim()||qaLoading) return;
    setQaLoading(true);
    try {
      await api.post('/api/events',{title:qaForm.title,date:qaForm.date,time:qaForm.time||'All day',calendar:qaForm.cal,color:A.green,duration:'1h',notes:'',source:'manual'});
      const updated=await api.get('/api/events');
      setEvents(updated);
      setQaOpen(false);
      setQaForm({title:'',date:localDate(),time:'',cal:'kith'});
    } finally {
      setQaLoading(false);
    }
  };

  const getMeal=dayName=>((meals||[]).find(m=>m.day===dayName)?.meal||'');
  const upcomingCDs=(countdowns||[]).filter(c=>daysUntil(c.date)>=0).sort((a,b)=>daysUntil(a.date)-daysUntil(b.date)).slice(0,4);

  useEffect(()=>{
    api.get('/api/chores/leaderboard').then(d=>setLeaderboard(Array.isArray(d)?d:[])).catch(()=>{});
  },[chores]);

  useEffect(()=>{
    const load=()=>api.get('/api/ha/events').then(d=>{if(Array.isArray(d))setHaEvents(d);}).catch(()=>{});
    load();
    const id=setInterval(load,60000);
    return()=>clearInterval(id);
  },[]);

  const [smEvents,setSmEvents]=useState([]);
  useEffect(()=>{
    const load=()=>fetch('/api/ha/pull').then(r=>r.json()).then(d=>{if(Array.isArray(d))setSmEvents(d);}).catch(()=>{});
    load();
    const id=setInterval(load,20000);
    return()=>clearInterval(id);
  },[]);
  const allSmartEvents=useMemo(()=>[...smEvents,...haEvents].slice(0,10),[smEvents,haEvents]);

  useEffect(()=>{
    if(prevDueRef.current!==null&&prevDueRef.current>0&&dueChores.length===0){
      setShowConfetti(true);
      const t=setTimeout(()=>setShowConfetti(false),3500);
      return ()=>clearTimeout(t);
    }
    prevDueRef.current=dueChores.length;
  },[dueChores.length]);

  return(
    <div>
      <div style={{marginBottom:20,display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
        <div style={{minWidth:0}}>
          <h1 style={{fontSize:isMobile?28:44,fontWeight:800,letterSpacing:'-.05em',color:A.label1,lineHeight:1.05}}>{greeting}</h1>
          <p style={{color:A.label4,fontSize:isMobile?13:15,marginTop:6,fontWeight:400}}>{DAYS[now.getDay()]}, {MONTHS[now.getMonth()]} {now.getDate()} · {now.toLocaleTimeString('en-US',clockOpts)}</p>
        </div>
        <Btn onClick={()=>{setQaForm({title:'',date:localDate(),time:'',cal:'kith'});setQaOpen(true);}} style={{flexShrink:0,marginTop:4}}>+ Add Event</Btn>
      </div>

      {/* Stats — individual cards with big colored numbers */}
      <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(2,1fr)':'repeat(4,1fr)',gap:10,marginBottom:16}}>
        {[
          {n:todayEvs.length,label:'Events Today'},
          {n:dueChores.length,label:'Chores Due'},
          {n:groceryRemaining,label:'On List'},
        ].map(s=>(
          <Card key={s.label} style={{padding:'18px 20px'}}>
            <div style={{fontSize:isMobile?38:52,fontWeight:800,letterSpacing:'-.05em',color:A.label1,lineHeight:1,marginBottom:8,fontVariantNumeric:'tabular-nums'}}>{s.n}</div>
            <div style={{fontSize:11,fontWeight:600,color:A.label4,textTransform:'uppercase',letterSpacing:'.07em'}}>{s.label}</div>
          </Card>
        ))}
        <Card style={{padding:'18px 20px'}}>
          {weather?(
            <>
              <div style={{fontSize:isMobile?38:52,fontWeight:800,letterSpacing:'-.05em',color:A.label1,lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{weather.temp}°</div>
              <div style={{fontSize:11,fontWeight:600,color:A.label4,textTransform:'uppercase',letterSpacing:'.07em',margin:'6px 0 10px'}}>{weather.condition}</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:2,borderTop:`1px solid ${A.sep}`,paddingTop:8}}>
                {(weather.forecast||[]).slice(1,4).map(f=>(
                  <div key={f.day} style={{textAlign:'center'}}>
                    <div style={{fontSize:9,color:A.label4,fontWeight:600,marginBottom:2}}>{f.day.slice(0,3)}</div>
                    <div style={{fontSize:13,marginBottom:1}}>{f.icon}</div>
                    <div style={{fontSize:10,color:A.label1,fontWeight:700}}>{f.hi}°</div>
                    <div style={{fontSize:9,color:A.label4}}>{f.lo}°</div>
                  </div>
                ))}
              </div>
            </>
          ):(
            <>
              <div style={{fontSize:isMobile?38:52,fontWeight:800,letterSpacing:'-.05em',color:A.label1,lineHeight:1,marginBottom:8}}>—</div>
              <div style={{fontSize:11,fontWeight:600,color:A.label4,textTransform:'uppercase',letterSpacing:'.07em'}}>Weather</div>
            </>
          )}
        </Card>
      </div>

      {/* Outdoor chore rain warning */}
      {(()=>{
        const outdoorDue=dueChores.filter(c=>c.outdoor);
        const isRaining=weather&&['Drizzle','Rain','Showers','Thunderstorm'].includes(weather.condition);
        if(!isRaining||!outdoorDue.length) return null;
        return(
          <div style={{background:A.blueFill,borderRadius:A.r,padding:'12px 16px',marginBottom:16,display:'flex',alignItems:'center',gap:12,border:`1px solid ${A.blue}22`}}>
            <span style={{fontSize:22,flexShrink:0}}>{weather.icon}</span>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:A.blue}}>Rain today — outdoor chores flagged</div>
              <div style={{fontSize:13,color:A.label3,marginTop:2}}>{outdoorDue.map(c=>c.name).join(', ')}</div>
            </div>
          </div>
        );
      })()}

      {/* Quick Actions */}
      {quickActions.length>0&&(
        <Card style={{marginBottom:16,padding:'14px 16px'}}>
          <div style={{fontSize:11,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:12}}>Quick Actions</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
            {quickActions.map(action=>{
              const state=qaState[action.id]||'idle';
              return(
                <button key={action.id} disabled={state==='loading'} onClick={async()=>{
                  setQaState(s=>({...s,[action.id]:'loading'}));
                  try{
                    const r=await api.post('/api/quick-actions/trigger',{id:action.id});
                    setQaState(s=>({...s,[action.id]:r.ok===false?'error':'done'}));
                  }catch{
                    setQaState(s=>({...s,[action.id]:'error'}));
                  }
                  setTimeout(()=>setQaState(s=>({...s,[action.id]:'idle'})),2000);
                }} style={{
                  display:'flex',flexDirection:'column',alignItems:'center',gap:6,
                  padding:'12px 18px',borderRadius:A.r,border:'none',cursor:state==='loading'?'wait':'pointer',
                  background:state==='done'?A.greenFill:state==='error'?A.redFill:A.inputBg,
                  transition:'background .2s',minWidth:80,
                }}>
                  <span style={{fontSize:22,lineHeight:1,opacity:state==='loading'?.5:1}}>{action.icon||'⚡'}</span>
                  <span style={{fontSize:12,fontWeight:600,color:state==='done'?A.green:state==='error'?A.red:A.label2,textAlign:'center',lineHeight:1.2}}>
                    {state==='loading'?'…':state==='done'?'Done':state==='error'?'Failed':action.label}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Smart home events */}
      {allSmartEvents.length>0&&(
        <Card style={{marginBottom:16,padding:0,overflow:'hidden'}}>
          {allSmartEvents.slice(0,5).map((ev,i)=>{
            const ts=ev.created_at?new Date(ev.created_at.endsWith('Z')||ev.created_at.includes('+')?ev.created_at:ev.created_at+'Z'):new Date();
            const ago=Math.round((Date.now()-ts.getTime())/60000);
            const agoStr=ago<1?'just now':ago<60?`${ago}m ago`:ago<1440?`${Math.round(ago/60)}h ago`:'yesterday';
            return(
              <div key={ev.id||i} style={{display:'flex',alignItems:'center',gap:12,padding:'11px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                <span style={{fontSize:18,flexShrink:0}}>{ev.icon||'🏠'}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:A.label1}}>{ev.title}</div>
                  {ev.message&&<div style={{fontSize:13,color:A.label4,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ev.message}</div>}
                </div>
                <span style={{fontSize:12,color:A.label5,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{agoStr}</span>
              </div>
            );
          })}
        </Card>
      )}

      {/* 7-day week strip */}
      <Card style={{marginBottom:16,padding:'12px 10px'}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,overflowX:isMobile?'auto':undefined}}>
          {weekDays.map(d=>(
            <div key={d.date} style={{textAlign:'center',padding:'7px 4px',borderRadius:A.rXs,background:d.isToday?A.blueFill:'transparent',minWidth:isMobile?40:undefined}}>
              <div style={{fontSize:10,fontWeight:700,color:d.isToday?A.blue:A.label4,marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>{d.label}</div>
              <div style={{fontSize:17,fontWeight:d.isToday?700:400,color:d.isToday?A.blue:A.label1,marginBottom:6,lineHeight:1}}>{d.num}</div>
              <div style={{display:'flex',gap:3,justifyContent:'center',flexWrap:'wrap',minHeight:12}}>
                {d.evs.length===0&&<div style={{width:6,height:6,borderRadius:'50%',background:A.sep}}/>}
                {d.evs.slice(0,3).map((ev,i)=>(
                  <div key={i} style={{width:6,height:6,borderRadius:'50%',background:ev.color}}/>
                ))}
                {d.evs.length>3&&<span style={{fontSize:9,color:A.label4,fontWeight:700,lineHeight:'6px'}}>+{d.evs.length-3}</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Upcoming countdowns */}
      {upcomingCDs.length>0&&(
        <div style={{display:'flex',gap:10,marginBottom:16,overflowX:'auto',paddingBottom:2}}>
          {upcomingCDs.map(c=>{
            const days=daysUntil(c.date);
            return(
              <Card key={c.id} style={{padding:'12px 16px',flexShrink:0,minWidth:128,textAlign:'center',cursor:'default'}}>
                <div style={{fontSize:24}}>{c.emoji}</div>
                <div style={{fontSize:22,fontWeight:800,color:A.indigo,lineHeight:1,marginTop:4}}>{days===0?'🎉':days}</div>
                {days>0&&<div style={{fontSize:10,color:A.label4,marginBottom:2}}>days</div>}
                <div style={{fontSize:12,fontWeight:600,color:A.label1,marginTop:2,lineHeight:1.3}}>{c.label}</div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Today's events + Due today */}
      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:12,marginBottom:12}}>
        <Card>
          <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`,fontSize:11,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.07em'}}>Today's Events</div>
          {todayEvs.map((ev,i)=>(
            <div key={ev.id} className="irow" style={{display:'flex',alignItems:'center',gap:12,padding:'13px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
              <div style={{width:3,height:38,borderRadius:2,background:ev.color,flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:15,fontWeight:600,color:A.label1}}>{ev.title}</div>
                <div style={{fontSize:12,color:A.label4,fontVariantNumeric:'tabular-nums',marginTop:2}}>{fmtTime(ev.time,clockFormat)}</div>
              </div>
            </div>
          ))}
          {todayEvs.length===0&&<div style={{padding:'20px 16px',fontSize:14,color:A.label4}}>Free today</div>}
        </Card>
        <Card>
          <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`,fontSize:11,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.07em'}}>Due Today</div>
          {dueChores.map((c,i)=>(
            <div key={c.id} className="irow" style={{display:'flex',alignItems:'center',gap:10,padding:'13px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:c.status==='overdue'?A.red:A.amber,flexShrink:0}}/>
              <span style={{fontSize:14,color:A.label1,fontWeight:500,flex:1}}>{c.name}</span>
              <span style={{fontSize:12,color:A.label4}}>{c.recurrence.split(' ')[0]}</span>
            </div>
          ))}
          {dueChores.length===0&&<div style={{padding:'20px 16px',fontSize:14,color:A.label4}}>All caught up!</div>}
        </Card>
      </div>

      {/* Meals this week */}
      {meals&&meals.length>0&&(
        <Card style={{padding:0,overflow:'hidden'}}>
          <div style={{padding:'10px 16px',fontSize:11,fontWeight:700,color:A.label3,textTransform:'uppercase',letterSpacing:'.07em',borderBottom:`1px solid ${A.sep}`}}>Meals This Week</div>
          <div style={{display:'flex',overflowX:'auto'}}>
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i)=>{
              const d=new Date(); d.setDate(d.getDate()-d.getDay()+i);
              const isToday=localDate(d)===localDate();
              const meal=getMeal(day);
              return(
                <div key={day} style={{padding:'10px 14px',borderRight:i<6?`1px solid ${A.sep}`:'none',minWidth:100,flexShrink:0,background:isToday?A.blueFill:'transparent'}}>
                  <div style={{fontSize:10,fontWeight:700,color:isToday?A.blue:A.label4,marginBottom:4,textTransform:'uppercase',letterSpacing:'.05em'}}>{day}</div>
                  <div style={{fontSize:13,color:meal?A.label1:A.label5,fontWeight:meal?500:400,lineHeight:1.3}}>{meal||'—'}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Weekly leaderboard */}
      {leaderboard.length>0&&(
        <Card style={{marginTop:12,padding:0,overflow:'hidden'}}>
          <div style={{padding:'10px 16px',fontSize:11,fontWeight:700,color:A.label3,textTransform:'uppercase',letterSpacing:'.07em',borderBottom:`1px solid ${A.sep}`}}>This Week</div>
          {leaderboard.map((m,i)=>(
            <div key={m.member_id||i} className="irow" style={{display:'flex',alignItems:'center',gap:12,padding:'10px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
              <div style={{width:34,height:34,borderRadius:'50%',background:m.color||A.blue,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:'#fff',flexShrink:0}}>{m.initials||m.member_name?.charAt(0)}</div>
              <span style={{flex:1,fontSize:14,fontWeight:600,color:A.label1}}>{m.member_name}</span>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:22,fontWeight:800,color:A.amber,lineHeight:1}}>{m.points}</span>
                <span style={{fontSize:16}}>⭐</span>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Confetti active={showConfetti}/>

      {/* News headlines — only shown when feed has loaded */}
      {news.length>0&&(
        <Card style={{marginTop:12,padding:0,overflow:'hidden'}}>
          <div style={{padding:'10px 16px',fontSize:11,fontWeight:700,color:A.label3,textTransform:'uppercase',letterSpacing:'.07em',borderBottom:`1px solid ${A.sep}`}}>Headlines</div>
          {news.slice(0,4).map((item,i)=>(
            <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
              className="irow"
              style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none',textDecoration:'none'}}
            >
              <div style={{width:4,height:4,borderRadius:'50%',background:A.label5,flexShrink:0,marginTop:6}}/>
              <span style={{fontSize:13,color:A.label2,lineHeight:1.4}}>{item.title}</span>
            </a>
          ))}
        </Card>
      )}

      {/* Quick-add event — Drawer on mobile (avoids iOS fixed-modal date picker issues), Modal on desktop */}
      {isMobile?(
        <Drawer open={qaOpen} onClose={()=>setQaOpen(false)} title="Add Event">
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <Inp value={qaForm.title} onChange={e=>setQaForm(p=>({...p,title:e.target.value}))} placeholder="Event title" onKeyDown={e=>e.key==='Enter'&&submitQuickAdd()}/>
            <Inp type="date" value={qaForm.date} onChange={e=>setQaForm(p=>({...p,date:e.target.value}))}/>
            <Inp value={qaForm.time} onChange={e=>setQaForm(p=>({...p,time:e.target.value}))} placeholder="Time (e.g. 3:00 PM)"/>
            <Btn onClick={submitQuickAdd} full>{qaLoading?'Adding…':'Add Event'}</Btn>
          </div>
        </Drawer>
      ):(
        <Modal open={qaOpen} onClose={()=>setQaOpen(false)} title="Add Event" width={420}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <Inp value={qaForm.title} onChange={e=>setQaForm(p=>({...p,title:e.target.value}))} placeholder="Event title" onKeyDown={e=>e.key==='Enter'&&submitQuickAdd()} inputRef={r=>r&&r.focus()}/>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <Inp type="date" value={qaForm.date} onChange={e=>setQaForm(p=>({...p,date:e.target.value}))}/>
              <Inp value={qaForm.time} onChange={e=>setQaForm(p=>({...p,time:e.target.value}))} placeholder="Time (e.g. 3:00 PM)"/>
            </div>
            <Btn onClick={submitQuickAdd} full>{qaLoading?'Adding…':'Add Event'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── Calendar ────────────────────────────────────────────────────────── */
function CalendarScreen({events,setEvents,icsSources,toastAdd,members,clockFormat='12h'}){
  const isMobile=useIsMobile();
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [editEvent,setEditEvent]=useState(null);
  const [form,setForm]=useState({title:'',date:localDate(),time:'',endTime:'',duration:'1h',cal:'kith',notes:'',memberId:'',recurring:''});
  const [calFilters,setCalFilters]=useState({kith:true});
  const [calView,setCalView]=useState(()=>window.innerWidth<768?'agenda':'week');
  const [weekOffset,setWeekOffset]=useState(0);
  const [monthOffset,setMonthOffset]=useState(0);
  const [selectedEvent,setSelectedEvent]=useState(null);
  const [deleteConfirm,setDeleteConfirm]=useState(false);

  const calMap={kith:A.green};
  icsSources.forEach(s=>{calMap[`ics:${s.name}`]=s.color;});
  useEffect(()=>{
    setCalFilters(prev=>{
      const next={kith:prev.kith??true};
      icsSources.forEach(s=>{const k=`ics:${s.name}`;next[k]=prev[k]??true;});
      return next;
    });
  },[icsSources]);
  const calLabels={kith:'Kith'};
  icsSources.forEach(s=>{calLabels[`ics:${s.name}`]=s.name;});

  const weekStart=useMemo(()=>{
    const d=new Date(); d.setDate(d.getDate()-d.getDay()+weekOffset*7); d.setHours(0,0,0,0); return d;
  },[weekOffset]);
  const weekDays=useMemo(()=>Array.from({length:7},(_,i)=>{
    const d=new Date(weekStart); d.setDate(weekStart.getDate()+i);
    return{label:DAYS[d.getDay()].slice(0,3),num:String(d.getDate()),date:localDate(d),today:localDate(d)===localDate()};
  }),[weekStart]);
  const refDate=useMemo(()=>{const d=new Date();d.setMonth(d.getMonth()+monthOffset);return d;},[monthOffset]);
  const mYear=refDate.getFullYear(),mMonth=refDate.getMonth();
  const firstDayOfMonth=new Date(mYear,mMonth,1).getDay();
  const daysInMonth=new Date(mYear,mMonth+1,0).getDate();
  const monthCells=[...Array(firstDayOfMonth).fill(null),...Array.from({length:daysInMonth},(_,i)=>i+1)];
  const miniFirstDay=new Date(refDate.getFullYear(),refDate.getMonth(),1).getDay();
  const miniDIM=new Date(refDate.getFullYear(),refDate.getMonth()+1,0).getDate();
  const miniCal=[...Array(miniFirstDay).fill(null),...Array.from({length:miniDIM},(_,i)=>i+1)];
  const filteredEvents=events.filter(e=>{const cal=calMap[e.calendar]!==undefined?e.calendar:'kith';return calFilters[cal]!==false;});

  const navBtnStyle={background:A.inputBg,border:'none',borderRadius:A.rXs,color:A.label2,padding:'5px 11px',fontSize:16,cursor:'pointer'};
  const goBack=()=>calView==='month'?setMonthOffset(p=>p-1):setWeekOffset(p=>p-1);
  const goFwd=()=>calView==='month'?setMonthOffset(p=>p+1):setWeekOffset(p=>p+1);
  const goToday=()=>{setWeekOffset(0);setMonthOffset(0);};
  const headerLabel=calView==='month'?`${MONTHS[mMonth]} ${mYear}`:`${MONTHS[weekStart.getMonth()]} ${weekStart.getFullYear()}`;

  const blankForm={title:'',date:localDate(),time:'',endTime:'',duration:'1h',cal:'kith',notes:'',memberId:'',recurring:''};
  const openNew=()=>{setEditEvent(null);setForm(blankForm);setDrawerOpen(true);};
  const openEdit=ev=>{
    setEditEvent(ev);
    setForm({title:ev.title,date:ev.date,time:ev.time==='All day'?'':ev.time,endTime:ev.end_time||'',duration:ev.duration||'1h',cal:ev.calendar,notes:ev.notes||'',memberId:ev.member_id?String(ev.member_id):'',recurring:ev.recurring_rule||''});
    setDrawerOpen(true); setSelectedEvent(null);
  };
  const saveEvent=async()=>{
    if(!form.title.trim()) return;
    const member=form.memberId?members?.find(m=>m.id===Number(form.memberId)):null;
    const color=member?.color||calMap[form.cal]||A.green;
    const payload={title:form.title,date:form.date,time:form.time||'All day',end_time:form.endTime,duration:form.duration,calendar:form.cal,color,notes:form.notes,member_id:form.memberId||null,recurring_rule:form.recurring};
    try {
      if(editEvent){
        const updated=await api.put(`/api/events/${editEvent.id}`,payload);
        setEvents(p=>p.map(e=>e.id===editEvent.id?updated:e));
        toastAdd('Event updated');
      } else {
        await api.post('/api/events',payload);
        api.get('/api/events').then(setEvents);
        toastAdd('Event saved');
      }
      setDrawerOpen(false);
    } catch(err) {
      toastAdd('Failed to save event','red');
    }
  };
  const deleteEvent=async(id,scope='one')=>{
    await api.del(`/api/events/${id}?scope=${scope}`);
    if(scope==='one') setEvents(p=>p.filter(e=>e.id!==id));
    else if(scope==='all'){ const ev=events.find(e=>e.id===id); const sid=ev?.external_id||id; setEvents(p=>p.filter(e=>e.id!==sid&&e.external_id!==sid)); }
    else if(scope==='future'){ const ev=events.find(e=>e.id===id); const sid=ev?.external_id||id; setEvents(p=>p.filter(e=>!(( e.id===sid||e.external_id===sid)&&e.date>=ev.date))); }
    setSelectedEvent(null);
    setDeleteConfirm(false);
    toastAdd('Event deleted','blue');
  };
  const confirmDelete=ev=>{
    if(!ev.recurring_rule){deleteEvent(ev.id);return;}
    setDeleteConfirm(true);
  };

  const sharedHeader=isMobile?(
    <div style={{background:A.cardBg,flexShrink:0}}>
      <div style={{padding:'10px 16px',borderBottom:`1px solid ${A.sep}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          <button onClick={goBack} style={navBtnStyle}>‹</button>
          <button onClick={goToday} style={{...navBtnStyle,fontSize:12,padding:'5px 8px'}}>Today</button>
          <button onClick={goFwd} style={navBtnStyle}>›</button>
          <span style={{fontSize:13,fontWeight:600,marginLeft:6,color:A.label1}}>{headerLabel}</span>
        </div>
        <button onClick={openNew} style={{background:A.blue,border:'none',borderRadius:A.rPill,color:'#fff',fontSize:20,lineHeight:1,width:30,height:30,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0}}>+</button>
      </div>
      <div style={{padding:'6px 16px 6px',borderBottom:`1px solid ${A.sep}`,display:'flex',background:A.inputBg,gap:2}}>
        {['week','month','agenda'].map(v=>(
          <button key={v} onClick={()=>setCalView(v)} style={{flex:1,padding:'5px 0',border:'none',borderRadius:6,background:calView===v?A.cardBg:'transparent',color:calView===v?A.label1:A.label3,fontSize:12,fontWeight:calView===v?600:400,cursor:'pointer',textTransform:'capitalize',boxShadow:calView===v?A.shadowSm:'none',transition:'all .15s'}}>{v}</button>
        ))}
      </div>
    </div>
  ):(
    <div style={{padding:'10px 20px',borderBottom:`1px solid ${A.sep}`,display:'flex',alignItems:'center',justifyContent:'space-between',background:A.cardBg,flexShrink:0}}>
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        <button onClick={goBack} style={navBtnStyle}>‹</button>
        <button onClick={goToday} style={{...navBtnStyle,fontSize:12,padding:'5px 10px'}}>Today</button>
        <button onClick={goFwd} style={navBtnStyle}>›</button>
        <span style={{fontSize:14,fontWeight:600,marginLeft:8,color:A.label1}}>{headerLabel}</span>
      </div>
      <div style={{display:'flex',gap:6,alignItems:'center'}}>
        <div style={{display:'flex',background:A.inputBg,borderRadius:A.rXs,padding:2,gap:1}}>
          {['week','month','agenda'].map(v=>(
            <button key={v} onClick={()=>setCalView(v)} style={{padding:'4px 10px',border:'none',borderRadius:6,background:calView===v?A.cardBg:'transparent',color:calView===v?A.label1:A.label3,fontSize:12,fontWeight:calView===v?600:400,cursor:'pointer',boxShadow:calView===v?A.shadowSm:'none',transition:'all .15s',textTransform:'capitalize'}}>{v}</button>
          ))}
        </div>
        <Btn onClick={openNew}>+ New Event</Btn>
      </div>
    </div>
  );

  const times=['7 AM','8 AM','9 AM','10 AM','11 AM','12 PM','1 PM','2 PM','3 PM','4 PM','5 PM','6 PM','7 PM','8 PM'];

  const WeekView=()=>{
    const allDayEvs=weekDays.flatMap(d=>filteredEvents.filter(e=>e.date===d.date&&(!e.time||e.time==='All day')));
    return(
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {sharedHeader}
        <div style={{flex:1,overflowX:'auto',display:'flex',flexDirection:'column'}}>
          <div style={{minWidth:600,display:'flex',flexDirection:'column',flex:1}}>
            {allDayEvs.length>0&&(
              <div style={{display:'grid',gridTemplateColumns:'52px repeat(7,1fr)',borderBottom:`1px solid ${A.sep}`,background:A.cardBg,flexShrink:0}}>
                <div style={{padding:'5px 8px',textAlign:'right'}}><span style={{fontSize:10,color:A.label5,letterSpacing:'.02em'}}>All day</span></div>
                {weekDays.map(d=>(
                  <div key={d.date} style={{padding:'3px 4px',borderLeft:`1px solid ${A.sep}`,background:d.today?'rgba(0,122,255,0.02)':'transparent'}}>
                    {filteredEvents.filter(e=>e.date===d.date&&(!e.time||e.time==='All day')).map(ev=>(
                      <div key={ev.id} onClick={()=>setSelectedEvent(ev)} style={{background:ev.color+'22',borderLeft:`2.5px solid ${ev.color}`,borderRadius:'0 6px 6px 0',padding:'3px 7px',fontSize:11,color:ev.color,fontWeight:600,cursor:'pointer',marginBottom:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ev.title}</div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div style={{display:'grid',gridTemplateColumns:'52px repeat(7,1fr)',background:A.cardBg,borderBottom:`1px solid ${A.sep}`,zIndex:10,flexShrink:0}}>
              <div/>
              {weekDays.map(d=>(
                <div key={d.date} style={{padding:'10px 4px',textAlign:'center',background:d.today?A.blueFill:'transparent'}}>
                  <div style={{fontSize:11,color:d.today?A.blue:A.label4,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em'}}>{d.label}</div>
                  <div style={{width:32,height:32,borderRadius:'50%',margin:'3px auto 0',display:'flex',alignItems:'center',justifyContent:'center',background:d.today?A.blue:'transparent',fontSize:18,fontWeight:600,color:d.today?'#fff':A.label1}}>{d.num}</div>
                </div>
              ))}
            </div>
            <div style={{flex:1,overflowY:'auto'}}>
              {times.map(t=>(
                <div key={t} style={{display:'grid',gridTemplateColumns:'52px repeat(7,1fr)',borderBottom:`1px solid ${A.sep}`}}>
                  <div style={{padding:'0 8px',paddingTop:6,textAlign:'right'}}><span style={{fontSize:11,color:A.label5,fontVariantNumeric:'tabular-nums'}}>{t}</span></div>
                  {weekDays.map(d=>{
                    const slotH=parseInt(t)+(t.includes('PM')&&!t.startsWith('12')?12:0);
                    const evs=filteredEvents.filter(e=>{
                      if(e.date!==d.date||!e.time||e.time==='All day') return false;
                      const eh=parseInt(e.time);
                      const eam=e.time.toUpperCase().includes('AM');
                      const epm=e.time.toUpperCase().includes('PM')&&!e.time.startsWith('12');
                      return((eam&&eh===12?0:eh)+(epm?12:0))===slotH;
                    });
                    return(
                      <div key={d.date} style={{minHeight:54,padding:'3px 4px',background:d.today?'rgba(0,122,255,0.02)':'transparent',borderLeft:`1px solid ${A.sep}`}}>
                        {evs.map(ev=>(
                          <div key={ev.id} onClick={()=>setSelectedEvent(ev)} style={{background:ev.color+'18',borderLeft:`2.5px solid ${ev.color}`,borderRadius:'0 7px 7px 0',padding:'5px 8px',fontSize:12,color:ev.color,fontWeight:600,cursor:'pointer',marginBottom:2}}>
                            {ev.title}
                            <div style={{fontSize:10,opacity:.7,fontVariantNumeric:'tabular-nums'}}>{fmtTime(ev.time,clockFormat)}{ev.end_time?` – ${fmtTime(ev.end_time,clockFormat)}`:''}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const MonthView=()=>(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      {sharedHeader}
      <div style={{flex:1,overflowY:'auto',padding:10}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:1,background:A.sep}}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>(
            <div key={d} style={{background:A.cardBg,padding:'6px 4px',textAlign:'center',fontSize:11,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.04em'}}>{d}</div>
          ))}
          {monthCells.map((d,i)=>{
            if(!d) return <div key={i} style={{background:A.systemBg,minHeight:76}}/>;
            const dateStr=`${mYear}-${String(mMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const dayEvs=filteredEvents.filter(e=>e.date===dateStr);
            const isToday=dateStr===localDate();
            return(
              <div key={i} style={{background:A.cardBg,minHeight:76,padding:'4px 5px'}}>
                <div style={{width:24,height:24,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:3,background:isToday?A.blue:'transparent',fontSize:13,fontWeight:isToday?700:400,color:isToday?'#fff':A.label1}}>{d}</div>
                {dayEvs.slice(0,3).map(ev=>(
                  <div key={ev.id} onClick={()=>setSelectedEvent(ev)} style={{background:ev.color+'18',borderLeft:`2px solid ${ev.color}`,borderRadius:'0 4px 4px 0',padding:'2px 5px',fontSize:11,color:ev.color,fontWeight:600,marginBottom:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',cursor:'pointer'}}>{ev.title}</div>
                ))}
                {dayEvs.length>3&&<div style={{fontSize:10,color:A.label5,paddingLeft:4}}>+{dayEvs.length-3} more</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const AgendaView=()=>{
    const timeSort=t=>(!t||t==='All day')?'00:00':t.replace(/(\d+):(\d+)\s*(AM|PM)/i,(_,h,m,ap)=>{let hr=parseInt(h);if(ap.toUpperCase()==='PM'&&hr!==12)hr+=12;if(ap.toUpperCase()==='AM'&&hr===12)hr=0;return String(hr).padStart(2,'0')+':'+m;});
    const upcoming=filteredEvents.filter(e=>e.date>=localDate()).sort((a,b)=>a.date.localeCompare(b.date)||timeSort(a.time).localeCompare(timeSort(b.time)));
    const byDate={};
    upcoming.forEach(e=>{if(!byDate[e.date])byDate[e.date]=[];byDate[e.date].push(e);});
    return(
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {sharedHeader}
        <div style={{flex:1,overflowY:'auto',padding:'16px 20px'}}>
          {Object.keys(byDate).length===0&&<div style={{color:A.label4,fontSize:14,fontStyle:'normal',textAlign:'center',paddingTop:32}}>No upcoming events</div>}
          {Object.entries(byDate).map(([date,evs])=>{
            const d=new Date(date+'T12:00:00');
            const tom=localDate(new Date(Date.now()+86400000));
            const label=date===localDate()?'Today':date===tom?'Tomorrow':`${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
            return(
              <div key={date} style={{marginBottom:20}}>
                <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:8}}>{label}</div>
                {evs.map(ev=>(
                  <div key={ev.id} onClick={()=>setSelectedEvent(ev)} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',background:A.cardBg,borderRadius:A.rSm,marginBottom:6,cursor:'pointer',boxShadow:A.shadowSm,borderLeft:`3px solid ${ev.color}`}}
                    onMouseEnter={e=>e.currentTarget.style.background=A.systemBg}
                    onMouseLeave={e=>e.currentTarget.style.background=A.cardBg}
                  >
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,fontWeight:600,color:A.label1}}>{ev.title}</div>
                      <div style={{fontSize:12,color:A.label4,fontVariantNumeric:'tabular-nums',marginTop:2}}>{ev.time==='All day'?'All day':`${fmtTime(ev.time,clockFormat)}${ev.end_time?` – ${fmtTime(ev.end_time,clockFormat)}`:''}`}</div>
                      {ev.recurring_rule&&<div style={{fontSize:11,color:A.purple,marginTop:2}}>↻ {ev.recurring_rule}</div>}
                    </div>
                    <div style={{width:10,height:10,borderRadius:3,background:ev.color,flexShrink:0}}/>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  useEffect(()=>{if(isMobile&&calView==='week')setCalView('agenda');},[isMobile]);
  if(isMobile){
    return(
      <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
        {/* Mobile header */}
        <div style={{padding:'10px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:`1px solid ${A.sep}`,background:A.cardBg,flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:4}}>
            <button onClick={goBack} style={{background:A.inputBg,border:'none',borderRadius:A.rXs,color:A.label2,padding:'5px 10px',fontSize:17,cursor:'pointer',lineHeight:1}}>‹</button>
            <span style={{fontSize:15,fontWeight:700,letterSpacing:'-.02em',minWidth:130,textAlign:'center'}}>{headerLabel}</span>
            <button onClick={goFwd} style={{background:A.inputBg,border:'none',borderRadius:A.rXs,color:A.label2,padding:'5px 10px',fontSize:17,cursor:'pointer',lineHeight:1}}>›</button>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button onClick={()=>setCalView(v=>v==='agenda'?'month':'agenda')} style={{background:A.inputBg,border:'none',borderRadius:A.rXs,padding:'7px 12px',fontSize:13,color:A.label2,cursor:'pointer',fontWeight:500}}>
              {calView==='agenda'?'Month':'List'}
            </button>
            <Btn sm onClick={openNew}>+ Add</Btn>
          </div>
        </div>
        {/* View — no week view on mobile */}
        <div style={{flex:1,overflowY:'auto'}}>
          {calView==='month'&&<MonthView/>}
          {calView==='agenda'&&<AgendaView/>}
        </div>
        {/* Event detail */}
        {selectedEvent&&(
          <Modal open={!!selectedEvent} onClose={()=>{setSelectedEvent(null);setDeleteConfirm(false);}} title="" width={460}>
            <div style={{marginBottom:16}}>
              <div style={{height:4,borderRadius:'2px 2px 0 0',background:selectedEvent.color,margin:'-20px -24px 20px'}}/>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                <div style={{width:10,height:10,borderRadius:3,background:calMap[selectedEvent.calendar]||A.blue,flexShrink:0}}/>
                <span style={{fontSize:13,color:A.label4,fontWeight:500}}>{calLabels[selectedEvent.calendar]||selectedEvent.calendar}</span>
              </div>
              <div style={{fontSize:19,fontWeight:700,color:A.label1,marginBottom:10,letterSpacing:'-.01em'}}>{selectedEvent.title}</div>
              <div style={{fontSize:14,color:A.label3,marginBottom:4}}>{selectedEvent.date}</div>
              <div style={{fontSize:14,color:A.label3,fontVariantNumeric:'tabular-nums',marginBottom:selectedEvent.notes?12:0}}>
                {selectedEvent.time==='All day'?'All day':`${fmtTime(selectedEvent.time,clockFormat)}${selectedEvent.end_time?` – ${fmtTime(selectedEvent.end_time,clockFormat)}`:''}`}
              </div>
              {selectedEvent.notes&&<div style={{fontSize:14,color:A.label2,background:A.systemBg,borderRadius:A.rXs,padding:'10px 12px'}}>{selectedEvent.notes}</div>}
            </div>
            <div style={{paddingTop:16,borderTop:`1px solid ${A.sep}`}}>
              {deleteConfirm?(
                <div>
                  <div style={{fontSize:13,color:A.label3,marginBottom:10,fontWeight:500}}>Delete recurring event:</div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <Btn sm variant="red" onClick={()=>deleteEvent(selectedEvent.id,'one')} full>Just this event</Btn>
                    <Btn sm variant="red" onClick={()=>deleteEvent(selectedEvent.id,'future')} full>This and all future events</Btn>
                    <Btn sm variant="red" onClick={()=>deleteEvent(selectedEvent.id,'all')} full>All events in series</Btn>
                    <Btn sm variant="ghost" onClick={()=>setDeleteConfirm(false)} full>Cancel</Btn>
                  </div>
                </div>
              ):(
                <div style={{display:'flex',gap:8}}>
                  <Btn sm onClick={()=>openEdit(selectedEvent)} full>Edit</Btn>
                  <Btn sm variant="red" onClick={()=>confirmDelete(selectedEvent)} full>Delete</Btn>
                </div>
              )}
            </div>
          </Modal>
        )}
        <Drawer open={drawerOpen} onClose={()=>setDrawerOpen(false)} title={editEvent?'Edit Event':'New Event'}>
          <FormGroup label="Event Details">
            <div style={{padding:'12px 16px'}}><Inp value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder="Title"/></div>
            <div style={{padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}><Inp type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/></div>
            <div style={{padding:'12px 16px',borderTop:`1px solid ${A.sep}`,display:'flex',gap:8}}>
              <Inp value={form.time} onChange={e=>setForm(p=>({...p,time:e.target.value}))} placeholder="Start (e.g. 3:00 PM)" style={{flex:1}}/>
              <Inp value={form.endTime} onChange={e=>setForm(p=>({...p,endTime:e.target.value}))} placeholder="End" style={{flex:1}}/>
            </div>
          </FormGroup>
          <FormGroup label="Repeat">
            <div style={{padding:'12px 16px'}}>
              <Sel value={form.recurring} onChange={e=>setForm(p=>({...p,recurring:e.target.value}))}>
                <option value="">Does not repeat</option>
                <option value="Daily">Daily</option>
                <option value="Weekdays">Every weekday (Mon–Fri)</option>
                <option value="Weekly">Weekly</option>
                <option value="Bi-weekly">Every 2 weeks</option>
                <option value="Monthly">Monthly</option>
                <option value="Annually">Annually</option>
              </Sel>
            </div>
          </FormGroup>
          <FormGroup label="Calendar">
            <div style={{padding:'12px 16px'}}>
              <Sel value={form.cal} onChange={e=>setForm(p=>({...p,cal:e.target.value}))}>
                <option value="kith">Kith</option>
                {icsSources.map(s=><option key={s.id} value={`ics:${s.name}`}>{s.name}</option>)}
              </Sel>
            </div>
          </FormGroup>
          {members&&members.length>0&&(
            <FormGroup label="Person (optional)">
              <div style={{padding:'12px 16px'}}>
                <Sel value={form.memberId} onChange={e=>setForm(p=>({...p,memberId:e.target.value}))}>
                  <option value="">No person</option>
                  {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
                </Sel>
              </div>
            </FormGroup>
          )}
          <FormGroup label="Notes">
            <div style={{padding:'12px 16px'}}><textarea value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} placeholder="Optional notes..." rows={3} style={{width:'100%',background:'transparent',border:'none',outline:'none',resize:'vertical',fontSize:15,color:A.label1}}/></div>
          </FormGroup>
          <div style={{display:'flex',gap:8}}>
            <Btn onClick={saveEvent} full>{editEvent?'Update':'Save'} Event</Btn>
            <Btn variant="ghost" onClick={()=>setDrawerOpen(false)} full>Cancel</Btn>
          </div>
        </Drawer>
      </div>
    );
  }

  return(
    <div style={{display:'flex',gap:0,height:'100%'}}>
      {/* Left panel */}
      <div style={{width:256,borderRight:`1px solid ${A.sep}`,padding:'16px 14px',flexShrink:0,overflowY:'auto'}}>
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <span style={{fontSize:15,fontWeight:600,letterSpacing:'-.01em'}}>{MONTHS[new Date().getMonth()]} {new Date().getFullYear()}</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:1,textAlign:'center'}}>
            {['S','M','T','W','T','F','S'].map((d,i)=>(
              <div key={i} style={{fontSize:11,color:A.label4,fontWeight:600,padding:'3px 0'}}>{d}</div>
            ))}
            {miniCal.map((d,i)=>{
              const cellDate=d?`${refDate.getFullYear()}-${String(refDate.getMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
              const isToday=cellDate===localDate();
              const hasEv=cellDate&&events.some(e=>e.date===cellDate);
              return(
                <div key={i} style={{position:'relative',padding:'4px 0'}}>
                  <div style={{width:28,height:28,borderRadius:'50%',margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'center',background:isToday?A.blue:'transparent',fontSize:13,color:isToday?'#fff':d?A.label1:'transparent',fontWeight:isToday?600:400}}>{d||''}</div>
                  {hasEv&&!isToday&&<div style={{position:'absolute',bottom:1,left:'50%',transform:'translateX(-50%)',width:4,height:4,borderRadius:'50%',background:A.blue}}/>}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{fontSize:12,fontWeight:600,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>Calendars</div>
        <div style={{background:A.cardBg,borderRadius:A.r,overflow:'hidden',boxShadow:A.shadowSm}}>
          {Object.entries(calLabels).map(([key,label],i)=>(
            <div key={key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 14px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{width:10,height:10,borderRadius:3,background:calMap[key]||A.blue}}/>
                <span style={{fontSize:14}}>{label}</span>
              </div>
              <Toggle checked={calFilters[key]!==false} onChange={v=>setCalFilters(p=>({...p,[key]:v}))}/>
            </div>
          ))}
        </div>
      </div>

      {/* Main view area */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {calView==='week'&&<WeekView/>}
        {calView==='month'&&<MonthView/>}
        {calView==='agenda'&&<AgendaView/>}
      </div>

      {/* Event detail modal */}
      {selectedEvent&&(
        <Modal open={!!selectedEvent} onClose={()=>{setSelectedEvent(null);setDeleteConfirm(false);}} title="" width={460}>
          <div style={{marginBottom:16}}>
            <div style={{height:4,borderRadius:'2px 2px 0 0',background:selectedEvent.color,margin:'-20px -24px 20px'}}/>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
              <div style={{width:10,height:10,borderRadius:3,background:calMap[selectedEvent.calendar]||A.blue,flexShrink:0}}/>
              <span style={{fontSize:13,color:A.label4,fontWeight:500}}>{calLabels[selectedEvent.calendar]||selectedEvent.calendar}</span>
            </div>
            <div style={{fontSize:19,fontWeight:700,color:A.label1,marginBottom:10,letterSpacing:'-.01em'}}>{selectedEvent.title}</div>
            <div style={{fontSize:14,color:A.label3,marginBottom:4}}>{selectedEvent.date}</div>
            <div style={{fontSize:14,color:A.label3,fontVariantNumeric:'tabular-nums',marginBottom:selectedEvent.recurring_rule||selectedEvent.notes?12:0}}>
              {selectedEvent.time==='All day'?'All day':`${fmtTime(selectedEvent.time,clockFormat)}${selectedEvent.end_time?` – ${fmtTime(selectedEvent.end_time,clockFormat)}`:''}`}
            </div>
            {selectedEvent.recurring_rule&&<div style={{fontSize:13,color:A.purple,marginBottom:8,fontWeight:500}}>↻ {selectedEvent.recurring_rule}</div>}
            {selectedEvent.notes&&<div style={{fontSize:14,color:A.label2,background:A.systemBg,borderRadius:A.rXs,padding:'10px 12px',marginBottom:4}}>{selectedEvent.notes}</div>}
          </div>
          <div style={{paddingTop:16,borderTop:`1px solid ${A.sep}`}}>
            {deleteConfirm?(
              <div>
                <div style={{fontSize:13,color:A.label3,marginBottom:10,fontWeight:500}}>Delete recurring event:</div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <Btn sm variant="red" onClick={()=>deleteEvent(selectedEvent.id,'one')} full>Just this event</Btn>
                  <Btn sm variant="red" onClick={()=>deleteEvent(selectedEvent.id,'future')} full>This and all future events</Btn>
                  <Btn sm variant="red" onClick={()=>deleteEvent(selectedEvent.id,'all')} full>All events in series</Btn>
                  <Btn sm variant="ghost" onClick={()=>setDeleteConfirm(false)} full>Cancel</Btn>
                </div>
              </div>
            ):(
              <div style={{display:'flex',gap:8}}>
                <Btn sm onClick={()=>openEdit(selectedEvent)} full>Edit</Btn>
                <Btn sm variant="red" onClick={()=>confirmDelete(selectedEvent)} full>Delete</Btn>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Add / Edit event drawer */}
      <Drawer open={drawerOpen} onClose={()=>setDrawerOpen(false)} title={editEvent?'Edit Event':'New Event'}>
        <FormGroup label="Event Details">
          <div style={{padding:'12px 16px'}}><Inp value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder="Title"/></div>
          <div style={{padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}><Inp type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/></div>
          <div style={{padding:'12px 16px',borderTop:`1px solid ${A.sep}`,display:'flex',gap:8}}>
            <Inp value={form.time} onChange={e=>setForm(p=>({...p,time:e.target.value}))} placeholder="Start (e.g. 3:00 PM)" style={{flex:1}}/>
            <Inp value={form.endTime} onChange={e=>setForm(p=>({...p,endTime:e.target.value}))} placeholder="End time" style={{flex:1}}/>
          </div>
        </FormGroup>
        <FormGroup label="Repeat">
          <div style={{padding:'12px 16px'}}>
            <Sel value={form.recurring} onChange={e=>setForm(p=>({...p,recurring:e.target.value}))}>
              <option value="">Does not repeat</option>
              <option value="Daily">Daily</option>
              <option value="Weekdays">Every weekday (Mon–Fri)</option>
              <option value="Weekly">Weekly</option>
              <option value="Bi-weekly">Every 2 weeks</option>
              <option value="Monthly">Monthly</option>
              <option value="Annually">Annually</option>
            </Sel>
          </div>
        </FormGroup>
        <FormGroup label="Calendar">
          <div style={{padding:'12px 16px'}}>
            <Sel value={form.cal} onChange={e=>setForm(p=>({...p,cal:e.target.value}))}>
              <option value="kith">Kith</option>
              {icsSources.map(s=><option key={s.id} value={`ics:${s.name}`}>{s.name}</option>)}
            </Sel>
          </div>
        </FormGroup>
        {members&&members.length>0&&(
          <FormGroup label="Person (optional)">
            <div style={{padding:'12px 16px'}}>
              <Sel value={form.memberId} onChange={e=>setForm(p=>({...p,memberId:e.target.value}))}>
                <option value="">No person assigned</option>
                {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
              </Sel>
            </div>
          </FormGroup>
        )}
        <FormGroup label="Notes">
          <div style={{padding:'12px 16px'}}><textarea value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} placeholder="Optional notes..." rows={3} style={{width:'100%',background:'transparent',border:'none',outline:'none',resize:'vertical',fontSize:15,color:A.label1}}/></div>
        </FormGroup>
        <div style={{display:'flex',gap:8}}>
          <Btn onClick={saveEvent} full>{editEvent?'Update':'Save'} Event</Btn>
          <Btn variant="ghost" onClick={()=>setDrawerOpen(false)} full>Cancel</Btn>
        </div>
      </Drawer>
    </div>
  );
}

/* ── Upload Card (Magic Import) ──────────────────────────────────────── */
function UploadCard({toastAdd,onUploaded}){
  const [loading,setLoading]=useState(false);
  const inputRef=useRef(null);

  const handle=async e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    e.target.value='';
    const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
    const isImage=file.type.startsWith('image/');
    if(!isPdf&&!isImage){toastAdd('Only images and PDFs are supported','red');return;}
    setLoading(true);
    try{
      const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});
      const result=await api.post('/api/inbox/upload',{filename:file.name,data});
      if(result.error){toastAdd(result.error,'red');}
      else if(result.count===0){toastAdd('No events found in this file','blue');}
      else{toastAdd(`${result.count} event${result.count>1?'s':''} added to inbox`);onUploaded();}
    }catch(err){toastAdd('Upload failed','red');}
    finally{setLoading(false);}
  };

  return(
    <Card style={{padding:'16px 18px',marginBottom:24}}>
      <div style={{fontSize:14,color:A.label3,marginBottom:10}}>Import a photo or PDF of an event, flyer, or schedule:</div>
      <input ref={inputRef} type="file" accept="image/*,.pdf" style={{display:'none'}} onChange={handle}/>
      <Btn sm onClick={()=>inputRef.current?.click()} disabled={loading}>
        {loading?'Parsing…':'+ Upload Image or PDF'}
      </Btn>
    </Card>
  );
}

/* ── Inbox ───────────────────────────────────────────────────────────── */
const isValidDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d);

function InboxScreen({toastAdd,events,setEvents,setInboxCount}){
  const [pending,setPending]=useState([]);
  const [recent,setRecent]=useState([]);
  const [fwdAddress,setFwdAddress]=useState('');
  const [editDates,setEditDates]=useState({});

  useEffect(()=>{
    api.get('/api/inbox').then(d=>{
      setPending(d.pending);
      setRecent(d.recent);
      setInboxCount(d.pending.length);
    });
    api.get('/api/settings').then(st=>{if(st.forwarding_address) setFwdAddress(st.forwarding_address);}).catch(()=>{});
  },[]);

  const accept=async id=>{
    const item=pending.find(i=>i.id===id);
    const isoDate=editDates[id]??(item.event_date?.match(/^\d{4}-\d{2}-\d{2}$/)?item.event_date:localDate());
    try{
      const result=await api.post(`/api/inbox/${id}/accept`,{date:isoDate});
      if(result.error){toastAdd(result.error,'red');return;}
      setPending(p=>{const next=p.filter(i=>i.id!==id);setInboxCount(next.length);return next;});
      setRecent(p=>[{event_name:item.event_name,event_date:isoDate,source:'Email'},...p]);
      api.get('/api/events').then(setEvents);
      toastAdd('Added to Kith Calendar');
    }catch(e){toastAdd('Failed to add event','red');}
  };
  const discard=async id=>{
    await api.del(`/api/inbox/${id}`);
    setPending(p=>{const next=p.filter(i=>i.id!==id);setInboxCount(next.length);return next;});
    toastAdd('Discarded','blue');
  };

  return(
    <div style={{maxWidth:720,margin:'0 auto'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:28,fontWeight:800,letterSpacing:'-.04em'}}>Inbox</h1>
          <p style={{color:A.label4,fontSize:15,marginTop:4}}>Parsed events from forwarded emails</p>
        </div>
        {pending.length>0&&<Badge color={A.blue}>{pending.length} pending</Badge>}
      </div>

      {pending.length===0&&(
        <Card style={{padding:'48px 24px',textAlign:'center',marginBottom:24}}>
          <div style={{fontSize:17,fontWeight:600,marginBottom:6}}>All clear</div>
          <div style={{color:A.label4,fontSize:15}}>No events waiting for review.</div>
        </Card>
      )}

      <div style={{display:'flex',flexDirection:'column',gap:12,marginBottom:28}}>
        {pending.map(item=>{
          const hi=item.confidence==='high';
          const confColor=hi?A.green:A.amber;
          return(
            <Card key={item.id} style={{overflow:'hidden',animation:'slideUp .2s ease'}}>
              <div style={{padding:'16px 18px 0'}}>
                <div style={{fontSize:11,color:A.label4,marginBottom:6,textTransform:'uppercase',letterSpacing:'.04em',fontWeight:500}}>Forwarded email</div>
                <div style={{fontSize:16,fontWeight:600,color:A.label1,marginBottom:14}}>{item.subject}</div>
                <div style={{background:A.systemBg,borderRadius:A.rSm,padding:'14px 16px',marginBottom:14}}>
                  <div style={{fontSize:17,fontWeight:700,color:A.label1,marginBottom:10,letterSpacing:'-.01em'}}>{item.event_name}</div>
                  <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <span style={{fontSize:11,fontWeight:600,color:A.label4,textTransform:'uppercase',letterSpacing:'.05em'}}>Date</span>
                      <input type="date"
                        value={editDates[item.id]??(isValidDate(item.event_date)?item.event_date:localDate())}
                        onChange={e=>setEditDates(p=>({...p,[item.id]:e.target.value}))}
                        style={{fontSize:13,color:A.label1,background:'#fff',border:`1px solid ${!isValidDate(item.event_date)&&!editDates[item.id]?A.amber:A.sep}`,borderRadius:A.rXs,padding:'5px 8px',cursor:'pointer'}}
                      />
                      {!isValidDate(item.event_date)&&!editDates[item.id]&&(
                        <span style={{fontSize:11,color:A.amber}}>AI returned "{item.event_date}" — pick a date</span>
                      )}
                    </div>
                    <span style={{fontSize:13,color:A.label3}}>{item.event_time}</span>
                    <span style={{fontSize:13,color:A.label3}}>{item.recurrence}</span>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
                  <span style={{fontSize:12,color:A.label4}}>Confidence</span>
                  <div style={{height:4,borderRadius:2,background:'rgba(0,0,0,0.06)',flex:1,maxWidth:100}}>
                    <div style={{height:'100%',borderRadius:2,background:confColor,width:hi?'100%':'58%'}}/>
                  </div>
                  <span style={{fontSize:12,fontWeight:700,color:confColor}}>{item.confidence}</span>
                </div>
              </div>
              <div style={{borderTop:`1px solid ${A.sep}`,padding:'12px 18px',display:'flex',gap:8,background:'rgba(0,0,0,0.01)'}}>
                <Btn variant="green" sm onClick={()=>accept(item.id)}>Add to Kith Calendar</Btn>
                <Btn variant="ghost" sm onClick={()=>discard(item.id)}>Discard</Btn>
              </div>
            </Card>
          );
        })}
      </div>

      <Card style={{padding:'16px 18px',marginBottom:24}}>
        <div style={{fontSize:14,color:A.label3,marginBottom:10}}>Forward any email with dates to this address:</div>
        <div style={{background:'#1C1C1E',borderRadius:A.rSm,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:15,color:'#30D158'}}>{fwdAddress}</span>
          <button onClick={()=>{navigator.clipboard.writeText(fwdAddress);toastAdd('Copied','blue');}} style={{background:'rgba(255,255,255,0.1)',border:'none',color:'rgba(255,255,255,0.7)',borderRadius:6,padding:'5px 12px',fontSize:12,cursor:'pointer'}}>Copy</button>
        </div>
      </Card>

      <UploadCard toastAdd={toastAdd} onUploaded={()=>api.get('/api/inbox').then(d=>{setPending(d.pending);setRecent(d.recent);setInboxCount(d.pending.length);})}/>

      <div style={{fontSize:12,fontWeight:600,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Recently Added</div>
      <Card>
        {recent.map((r,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:0,padding:'12px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
            <div style={{flex:1,fontSize:14,fontWeight:500,color:A.label1}}>{r.event_name}</div>
            <div style={{fontSize:13,color:A.label4,minWidth:60}}>{r.event_date}</div>
            <div style={{fontSize:13,color:A.label5,minWidth:60,textAlign:'center'}}>{r.source}</div>
            <div style={{display:'flex',alignItems:'center',gap:4,color:A.green,fontSize:13,fontWeight:600,minWidth:80,justifyContent:'flex-end'}}>
              <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5L4.5 8.5L11 1.5" stroke={A.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Added
            </div>
          </div>
        ))}
        {recent.length===0&&<div style={{padding:'14px 16px',fontSize:14,color:A.label4,fontStyle:'normal'}}>None yet</div>}
      </Card>
    </div>
  );
}

/* ── Chores ──────────────────────────────────────────────────────────── */
function ChoresScreen({chores,setChores,goals=[],toastAdd}){
  const isMobile=useIsMobile();
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [editChore,setEditChore]=useState(null);
  const [form,setForm]=useState({name:'',recur:'Weekly',day:'Monday',start:'',points:1,outdoor:false,goal_id:'',goal_amount:1});
  const [choreConfetti,setChoreConfetti]=useState(false);

  const openNew=()=>{
    setEditChore(null);
    setForm({name:'',recur:'Weekly',day:'Monday',start:'',points:1,outdoor:false,goal_id:'',goal_amount:1});
    setDrawerOpen(true);
  };

  const openEdit=c=>{
    let recur='Weekly',day='Monday';
    if(c.recurrence==='Daily') recur='Daily';
    else if(c.recurrence==='Bi-weekly') recur='Bi-weekly';
    else if(c.recurrence==='Monthly'||c.recurrence.startsWith('Monthly')) recur='Monthly';
    else if(c.recurrence.startsWith('Weekly')) {
      recur='Weekly';
      const m=c.recurrence.match(/\((\w+)\)/);
      if(m) day=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].find(d=>d.startsWith(m[1]))||'Monday';
    } else recur='Custom';
    setEditChore(c);
    setForm({name:c.name,recur,day,start:c.next_due||'',points:c.points||1,outdoor:!!c.outdoor,goal_id:c.goal_id||'',goal_amount:c.goal_amount||1});
    setDrawerOpen(true);
  };

  const saveChore=async()=>{
    if(!form.name.trim()) return;
    const recurrence=form.recur==='Weekly'?`Weekly (${form.day.slice(0,3)})`:form.recur;
    const body={name:form.name,recurrence,next_due:form.start,points:form.points,outdoor:form.outdoor?1:0,goal_id:form.goal_id||null,goal_amount:Number(form.goal_amount)||1};
    if(editChore){
      const updated=await api.put(`/api/chores/${editChore.id}`,body);
      setChores(p=>p.map(c=>c.id===editChore.id?updated:c));
      toastAdd('Chore updated');
    } else {
      const newChore=await api.post('/api/chores',{...body,start:form.start});
      setChores(p=>[...p,newChore]);
      toastAdd('Chore added');
    }
    setDrawerOpen(false);
    setEditChore(null);
    setForm({name:'',recur:'Weekly',day:'Monday',start:'',points:1,outdoor:false,goal_id:'',goal_amount:1});
  };

  const deleteChore=async id=>{
    await api.del(`/api/chores/${id}`);
    setChores(p=>p.filter(c=>c.id!==id));
    toastAdd('Deleted','blue');
  };

  const toggleDone=async c=>{
    try{
      const result=await api.put(`/api/chores/${c.id}/done`);
      if(result.error){toastAdd(result.error,'red');return;}
      setChores(p=>p.map(x=>x.id===c.id?{...x,done:result.done,next_due:result.next_due,status:result.status}:x));
      if(result.done){
        toastAdd(`${c.name} done!`);
        setChoreConfetti(true);
        setTimeout(()=>setChoreConfetti(false),2500);
      }
    }catch{toastAdd('Failed to update','red');}
  };

  const statePill=s=>{
    if(s==='due')     return{color:A.amber,bg:A.amberFill,label:'Due today'};
    if(s==='overdue') return{color:A.red,  bg:A.redFill,  label:'Overdue'};
    return                  {color:A.green,bg:A.greenFill,label:'Upcoming'};
  };

  return(
    <div>
      <Confetti active={choreConfetti} count={14}/>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Chores</h1>
          <p style={{color:A.label4,fontSize:15,marginTop:6,fontWeight:400}}>
            {chores.filter(c=>c.status==='due'||c.status==='overdue').length} due today · {chores.length} total
          </p>
        </div>
        <Btn onClick={openNew}>+ Add Chore</Btn>
      </div>
      <Card>
        {chores.length===0 ? (
          <div style={{padding:'52px 24px',textAlign:'center'}}>
            <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No chores yet</div>
            <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Add recurring tasks above to keep the home running</div>
          </div>
        ) : isMobile ? (
          <div>
            {chores.map(c=>{
              const p=statePill(c.status);
              return(
                <div key={c.id} style={{padding:'14px 16px',borderTop:`1px solid ${A.sep}`,borderLeft:`3px solid ${c.status==='due'?A.amber:c.status==='overdue'?A.red:'transparent'}`,background:c.done?A.greenFill:c.status==='due'?`${A.amber}06`:c.status==='overdue'?`${A.red}06`:'transparent',opacity:c.done?.6:1,transition:'opacity .3s'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                    <span style={{fontSize:15,fontWeight:600,textDecoration:c.done?'line-through':'none',color:c.done?A.label4:A.label1}}>{c.name}</span>
                    <Badge color={p.color} bg={p.bg}>{p.label}</Badge>
                  </div>
                  <div style={{fontSize:13,color:A.label4,marginBottom:10}}>{c.recurrence} · Next: {c.next_due||'—'}</div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <button onClick={()=>toggleDone(c)} style={{flex:1,padding:'9px 0',borderRadius:A.rXs,border:'none',background:c.done?A.inputBg:A.green,color:c.done?A.label3:'#fff',fontSize:14,fontWeight:700,cursor:'pointer'}}>
                      {c.done?'Undo':'Mark Done'}
                    </button>
                    <button onClick={()=>openEdit(c)} style={{background:A.inputBg,border:'none',borderRadius:A.rXs,color:A.label2,fontSize:13,cursor:'pointer',fontWeight:500,padding:'9px 14px'}}>Edit</button>
                    <button onClick={()=>deleteChore(c.id)} style={{background:'none',border:'none',color:A.red,fontSize:13,cursor:'pointer',fontWeight:500,padding:'9px 4px'}}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <div style={{display:'grid',gridTemplateColumns:'2fr 56px 1.2fr 1fr 1fr 120px 120px',padding:'10px 16px',borderBottom:`1px solid ${A.sep}`}}>
              {['Chore','Pts','Recurrence','Last Done','Next Due','Status',''].map((h,i)=>(
                <div key={i} style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.05em'}}>{h}</div>
              ))}
            </div>
            {chores.map((c,i)=>{
              const p=statePill(c.status);
              return(
                <div key={c.id} className="irow" style={{display:'grid',gridTemplateColumns:'2fr 56px 1.2fr 1fr 1fr 120px 120px',padding:'13px 16px',borderTop:`1px solid ${A.sep}`,borderLeft:`3px solid ${c.status==='due'?A.amber:c.status==='overdue'?A.red:'transparent'}`,background:c.done?A.greenFill:c.status==='due'?`${A.amber}06`:c.status==='overdue'?`${A.red}06`:'transparent',alignItems:'center',opacity:c.done?.65:1,transition:'opacity .3s'}}>
                  <div style={{fontSize:15,fontWeight:500,textDecoration:c.done?'line-through':'none',color:c.done?A.label4:A.label1}}>{c.name}</div>
                  <div style={{fontSize:13,color:A.amber,fontWeight:700}}>{'⭐'.repeat(c.points||1)}</div>
                  <div style={{fontSize:13,color:A.label4}}>{c.recurrence}</div>
                  <div style={{fontSize:13,color:A.label4}}>{c.last_done||'Never'}</div>
                  <div style={{fontSize:13,color:A.label4}}>{c.next_due||'—'}</div>
                  <Badge color={p.color} bg={p.bg}>{p.label}</Badge>
                  <div style={{display:'flex',gap:8}}>
                    <button onClick={()=>toggleDone(c)} style={{padding:'5px 10px',borderRadius:A.rXs,border:'none',background:c.done?A.inputBg:A.green,color:c.done?A.label3:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>{c.done?'Undo':'Done'}</button>
                    <button onClick={()=>openEdit(c)} style={{background:'none',border:'none',color:A.blue,fontSize:13,cursor:'pointer',fontWeight:500}}>Edit</button>
                    <button onClick={()=>deleteChore(c.id)} style={{background:'none',border:'none',color:A.red,fontSize:13,cursor:'pointer',fontWeight:500}}>Del</button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </Card>
      <Drawer open={drawerOpen} onClose={()=>{setDrawerOpen(false);setEditChore(null);}} title={editChore?'Edit Chore':'Add Chore'}>
        <FormGroup label="Details">
          <div style={{padding:'12px 16px'}}><Inp value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Chore name"/></div>
          <div style={{padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}>
            <Sel value={form.recur} onChange={e=>setForm(p=>({...p,recur:e.target.value}))}>
              {['Daily','Weekly','Bi-weekly','Monthly','Custom'].map(o=><option key={o}>{o}</option>)}
            </Sel>
          </div>
          {form.recur==='Weekly'&&(
            <div style={{padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}>
              <Sel value={form.day} onChange={e=>setForm(p=>({...p,day:e.target.value}))}>
                {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d=><option key={d}>{d}</option>)}
              </Sel>
            </div>
          )}
          <div style={{padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}>
            <Inp type="date" value={form.start} onChange={e=>setForm(p=>({...p,start:e.target.value}))}/>
          </div>
        </FormGroup>
        <FormGroup label="Points">
          <div style={{padding:'12px 16px'}}>
            <div style={{display:'flex',gap:4,marginBottom:6}}>
              {[1,2,3,4,5].map(n=>(
                <button key={n} onClick={()=>setForm(p=>({...p,points:n}))} style={{background:'none',border:'none',fontSize:28,cursor:'pointer',opacity:n<=form.points?1:.2,transition:'opacity .1s',lineHeight:1,padding:'2px'}}>⭐</button>
              ))}
            </div>
            <div style={{fontSize:12,color:A.label4}}>{form.points} point{form.points!==1?'s':''} when completed</div>
          </div>
        </FormGroup>
        <FormGroup label="Options">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px'}}>
            <span style={{fontSize:15,color:A.label1,fontWeight:500}}>Outdoor chore</span>
            <button onClick={()=>setForm(p=>({...p,outdoor:!p.outdoor}))} style={{width:44,height:26,borderRadius:13,background:form.outdoor?A.blue:A.label5,border:'none',cursor:'pointer',position:'relative',transition:'background .2s',flexShrink:0}}>
              <div style={{position:'absolute',top:3,left:form.outdoor?21:3,width:20,height:20,borderRadius:'50%',background:'#fff',transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,0.18)'}}/>
            </button>
          </div>
        </FormGroup>
        {goals.length>0&&(
          <FormGroup label="Link to goal (optional)">
            <div style={{padding:'12px 16px'}}>
              <select value={form.goal_id} onChange={e=>setForm(p=>({...p,goal_id:e.target.value}))}
                style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
                <option value="">None</option>
                {goals.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              {form.goal_id&&(
                <div style={{marginTop:10}}>
                  <label style={{fontSize:13,color:A.label4,display:'block',marginBottom:6}}>Amount to add when completed</label>
                  <Inp type="number" min="0.1" step="0.1" value={form.goal_amount} onChange={e=>setForm(p=>({...p,goal_amount:e.target.value}))} style={{width:120}}/>
                </div>
              )}
            </div>
          </FormGroup>
        )}
        <div style={{display:'flex',gap:8,marginTop:4}}>
          <Btn onClick={saveChore} full>{editChore?'Update Chore':'Save Chore'}</Btn>
          <Btn variant="ghost" onClick={()=>{setDrawerOpen(false);setEditChore(null);}} full>Cancel</Btn>
        </div>
      </Drawer>
    </div>
  );
}

/* ── Grocery ─────────────────────────────────────────────────────────── */
function GroceryScreen({grocery,setGrocery,meals,setMeals,toastAdd}){
  const isMobile=useIsMobile();
  const [input,setInput]=useState('');
  const [editingDay,setEditingDay]=useState(null);
  const [mealInput,setMealInput]=useState('');
  const inputRef=useRef();

  const addItem=async()=>{
    if(!input.trim()) return;
    const newItem=await api.post('/api/grocery',{name:input.trim()});
    setGrocery(p=>[...p,newItem]);
    setInput('');
    inputRef.current?.focus();
  };
  const toggle=async id=>{
    const result=await api.put(`/api/grocery/${id}/toggle`);
    setGrocery(p=>p.map(i=>i.id===id?{...i,checked:result.checked}:i));
  };
  const clearChecked=async()=>{
    await api.del('/api/grocery/checked');
    setGrocery(p=>p.filter(i=>!i.checked));
  };
  const saveMeal=async day=>{
    await api.put(`/api/meals/${day}`,{meal:mealInput});
    setMeals(p=>p.map(m=>m.day===day?{...m,meal:mealInput}:m));
    setEditingDay(null); setMealInput('');
  };

  const unchecked=(grocery||[]).filter(i=>!i.checked);
  const checked=(grocery||[]).filter(i=>i.checked);
  const cats=[...new Set(unchecked.map(i=>i.category))];

  return(
    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 340px',gap:20,alignItems:'start'}}>
      <div>
        <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:20}}>
          <div>
            <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Grocery</h1>
            <p style={{fontSize:15,marginTop:6,color:A.label4,fontWeight:400}}>{unchecked.length} items remaining</p>
          </div>
          {checked.length>0&&<button onClick={clearChecked} style={{background:'none',border:'none',color:A.label4,fontSize:14,cursor:'pointer'}}>Clear checked</button>}
        </div>
        <div style={{display:'flex',gap:10,marginBottom:16}}>
          <Inp value={input} onChange={e=>setInput(e.target.value)} placeholder="Add item..." onKeyDown={e=>e.key==='Enter'&&addItem()} inputRef={inputRef}/>
          <Btn onClick={addItem} style={{flexShrink:0}}>Add</Btn>
        </div>
        {unchecked.length===0&&checked.length===0&&(
          <div style={{padding:'52px 24px',textAlign:'center',marginBottom:12}}>
            <div style={{fontSize:15,fontWeight:600,color:A.label3,marginBottom:4}}>List is empty</div>
            <div style={{fontSize:14,color:A.label4}}>Type an item above and press Enter</div>
          </div>
        )}
        {cats.map(cat=>{
          const catItems=unchecked.filter(i=>i.category===cat);
          return(
            <div key={cat} style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6,paddingLeft:4}}>{cat}</div>
              <Card>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr'}}>
                  {catItems.map((item,idx)=>{
                    let _tx=0;
                    const isLeftCol=idx%2===0;
                    const hasRightNeighbor=idx+1<catItems.length;
                    return(
                      <div key={item.id} className="tap"
                        onTouchStart={e=>{_tx=e.touches[0].clientX;}}
                        onTouchEnd={e=>{if(e.changedTouches[0].clientX-_tx>60){e.preventDefault();toggle(item.id);}}}
                        onClick={()=>toggle(item.id)}
                        style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',borderTop:idx>1?`1px solid ${A.sep}`:'none',borderRight:isLeftCol&&hasRightNeighbor?`1px solid ${A.sep}`:'none',cursor:'pointer'}}
                        onMouseEnter={e=>e.currentTarget.style.background=A.systemBg}
                        onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                      >
                        <div style={{width:22,height:22,borderRadius:'50%',border:`2px solid ${A.sepOpaque}`,flexShrink:0}}/>
                        <span style={{fontSize:15,color:A.label1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          );
        })}
        {checked.length>0&&(
          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6,paddingLeft:4}}>Checked ({checked.length})</div>
            <Card>
              {checked.map((item,idx)=>(
                <div key={item.id} onClick={()=>toggle(item.id)} style={{display:'flex',alignItems:'center',gap:14,padding:'13px 16px',borderTop:idx>0?`1px solid ${A.sep}`:'none',cursor:'pointer',opacity:.45}}>
                  <div style={{width:24,height:24,borderRadius:'50%',background:A.green,border:`2px solid ${A.green}`,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4.5L4.5 8L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <span style={{fontSize:15,color:A.label4,textDecoration:'line-through'}}>{item.name}</span>
                </div>
              ))}
            </Card>
          </div>
        )}
      </div>

      <div>
        <h2 style={{fontSize:18,fontWeight:700,letterSpacing:'-.01em',marginBottom:4}}>Meal Plan</h2>
        <p style={{color:A.label4,fontSize:14,marginBottom:14}}>This week</p>
        <Card>
          {(meals||[]).map((m,i)=>{
            const dayName=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()];
            const isToday=m.day===dayName;
            const isEditing=editingDay===m.day;
            return(
              <div key={m.day} style={{padding:'13px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none',background:isToday?A.blueFill:'transparent'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:13,fontWeight:isToday?700:500,color:isToday?A.blue:A.label4,width:30,flexShrink:0}}>{m.day}</span>
                  {isEditing?(
                    <div style={{flex:1,display:'flex',gap:6}}>
                      <Inp value={mealInput} onChange={e=>setMealInput(e.target.value)} placeholder="Meal..." onKeyDown={e=>e.key==='Enter'&&saveMeal(m.day)} style={{fontSize:14}}/>
                      <Btn sm onClick={()=>saveMeal(m.day)}>OK</Btn>
                    </div>
                  ):(
                    <>
                      <span style={{flex:1,fontSize:15,color:m.meal?A.label1:A.label5,fontStyle:m.meal?'normal':'italic',fontWeight:isToday?500:400}}>{m.meal||'Not planned'}</span>
                      <button onClick={()=>{setEditingDay(m.day);setMealInput(m.meal);}} style={{background:'none',border:'none',color:A.blue,fontSize:13,cursor:'pointer',fontWeight:500,flexShrink:0}}>{m.meal?'Edit':'Add'}</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}

function WebhookSecretPanel({toastAdd}){
  const [secret,setSecret]=useState('');
  const [revealed,setRevealed]=useState(false);
  const [loading,setLoading]=useState(false);

  const load=async()=>{
    const r=await api.get('/api/settings/webhook-secret');
    if(r?.secret){setSecret(r.secret);setRevealed(true);}
  };

  const regen=async()=>{
    if(!confirm('Generate a new webhook secret? You will need to update Cloudflare with the new value.')) return;
    setLoading(true);
    const r=await api.put('/api/settings/webhook-secret',{});
    setLoading(false);
    if(r?.secret){setSecret(r.secret);setRevealed(true);toastAdd('New secret generated — copy it and update Cloudflare','blue');}
    else toastAdd('Failed to generate','red');
  };

  const copy=()=>{navigator.clipboard.writeText(secret);toastAdd('Copied','blue');};

  if(!revealed) return(
    <Btn sm onClick={load}>Reveal current secret</Btn>
  );

  return(
    <div>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
        <code style={{flex:1,fontSize:12,background:A.inputBg,padding:'6px 10px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,color:A.label2,wordBreak:'break-all'}}>{secret}</code>
        <Btn sm variant="ghost" onClick={copy}>Copy</Btn>
      </div>
      <Btn sm variant="ghost" onClick={regen} disabled={loading}>{loading?'Generating…':'Regenerate'}</Btn>
      <div style={{fontSize:12,color:A.label5,marginTop:8}}>After regenerating, paste the new value into your Cloudflare Worker as <code>HEARTH_WEBHOOK_SECRET</code>.</div>
    </div>
  );
}

/* ── Settings ────────────────────────────────────────────────────────── */
function SettingsScreen({toastAdd,icsSources,setIcsSources,onDisplay,photos,setPhotos,clockFormat,setClockFormat,nightModeStart,setNightModeStart,nightModeEnd,setNightModeEnd,setRefreshMs,parseRefreshMs,setQuickActions,setRotationMs,setWifiQrData}){
  const isMobile=useIsMobile();
  const [weatherCity,setWeatherCity]=useState('');
  const [weatherLat,setWeatherLat]=useState('33.749');
  const [weatherLon,setWeatherLon]=useState('-84.388');
  const [weatherDisplay,setWeatherDisplay]=useState('');
  const [geoLoading,setGeoLoading]=useState(false);
  const [fwdAddress,setFwdAddress]=useState('');
  const [webhookSecret,setWebhookSecret]=useState('');
  const [resendKey,setResendKey]=useState('');
  const [resendFrom,setResendFrom]=useState('');
  const [emailTo,setEmailTo]=useState('');
  const [summaryTime,setSummaryTime]=useState('07:00');
  const [kithUrl,setKithUrl]=useState('');
  const [weeklyDigest,setWeeklyDigest]=useState(false);
  const [dailySummary,setDailySummary]=useState(false);
  const [emailTestLoading,setEmailTestLoading]=useState(false);
  const [newsFeeds,setNewsFeeds]=useState([]);
  const [newsFeedInput,setNewsFeedInput]=useState('');
  const [sportsLeagues,setSportsLeagues]=useState({nfl:true,nba:true,mlb:true,nhl:true,wnba:false,mls:false,epl:false,ucl:false,wc:false,wwc:false,ncaaf:false,ncaab:false,pga:false,atp:false,nascar:false,f1:false});
  const [haSecret,setHaSecret]=useState('');
  const haWebhookUrl=`${window.location.origin}/api/webhook/ha`;
  const [haUrl,setHaUrl]=useState('');
  const [haToken,setHaToken]=useState('');
  const [haHasToken,setHaHasToken]=useState(false);
  const [haSaving,setHaSaving]=useState(false);

  const [homeyUrl,setHomeyUrl]=useState('');
  const [homeyToken,setHomeyToken]=useState('');
  const [homeyHasToken,setHomeyHasToken]=useState(false);
  const [homeySaving,setHomeySaving]=useState(false);
  const [smTesting,setSmTesting]=useState(false);
  const [anthropicKey,setAnthropicKey]=useState('');
  const [hasAnthropicKey,setHasAnthropicKey]=useState(false);
  const [beehiivKey,setBeehiivKey]=useState('');
  const [hasBeehiivKey,setHasBeehiivKey]=useState(false);
  const [youtubeKey,setYoutubeKey]=useState('');
  const [hasYoutubeKey,setHasYoutubeKey]=useState(false);
  const [etsyKey,setEtsyKey]=useState('');
  const [hasEtsyKey,setHasEtsyKey]=useState(false);
  const [teslemetryKey,setTeslemetryKey]=useState('');
  const [hasTeslemetryKey,setHasTeslemetryKey]=useState(false);
  const [aviationstackKey,setAviationstackKey]=useState('');
  const [hasAviationstackKey,setHasAviationstackKey]=useState(false);
  const [nextdnsKey,setNextdnsKey]=useState('');
  const [hasNextdnsKey,setHasNextdnsKey]=useState(false);
  const [nextdnsProfile,setNextdnsProfile]=useState('');
  const [beszelUrl,setBeszelUrl]=useState('');
  const [beszelUser,setBeszelUser]=useState('');
  const [beszelPass,setBeszelPass]=useState('');
  const [hasBeszel,setHasBeszel]=useState(false);
  const [kumaUrl,setKumaUrl]=useState('');
  const [kumaSlug,setKumaSlug]=useState('');
  const [plexUrl,setPlexUrl]=useState('');
  const [plexToken,setPlexToken]=useState('');
  const [hasPlexKey,setHasPlexKey]=useState(false);
  const [hasLastfm,setHasLastfm]=useState(false);
  const [lastfmApiKey,setLastfmApiKey]=useState('');
  const [lastfmUser,setLastfmUser]=useState('');
  const [hasMoen,setHasMoen]=useState(false);
  const [moenUser,setMoenUser]=useState('');
  const [moenPass,setMoenPass]=useState('');
  const [hasUnifi,setHasUnifi]=useState(false);
  const [unifiUrl,setUnifiUrl]=useState('');
  const [unifiUser,setUnifiUser]=useState('');
  const [unifiPass,setUnifiPass]=useState('');
  const [unifiSite,setUnifiSite]=useState('default');
  const [unifiInterval,setUnifiInterval]=useState('60');
  const [wifiSsid,setWifiSsid]=useState('');
  const [wifiPassword,setWifiPassword]=useState('');
  const [wUptimeUrls,setWUptimeUrls]=useState('');
  const [intSaving,setIntSaving]=useState(false);
  const [wQuote,setWQuote]=useState(false);
  const [wStocks,setWStocks]=useState(false);
  const [wStocksTickers,setWStocksTickers]=useState('');
  const [wPH,setWPH]=useState(false);
  const [wGithub,setWGithub]=useState(false);
  const [wGithubUser,setWGithubUser]=useState('');
  const [wReddit,setWReddit]=useState(false);
  const [wRedditSub,setWRedditSub]=useState('');
  const [wBeehiiv,setWBeehiiv]=useState(false);
  const [wYoutube,setWYoutube]=useState(false);
  const [wYoutubeHandle,setWYoutubeHandle]=useState('');
  const [wEtsy,setWEtsy]=useState(false);
  const [wEtsyShop,setWEtsyShop]=useState('');
  const [wFlightNum,setWFlightNum]=useState('');
  const [qaList,setQaList]=useState([]);
  const [qaDrawer,setQaDrawer]=useState(false);
  const [qaEdit,setQaEdit]=useState(null);
  const qaBlank={label:'',icon:'⚡',url:'',method:'POST',headers:'',body:''};
  const [qaForm,setQaForm]=useState(qaBlank);
  useEffect(()=>{
    api.get('/api/settings').then(st=>{
      if(st.weather_lat) setWeatherLat(st.weather_lat);
      if(st.weather_lon) setWeatherLon(st.weather_lon);
      if(st.weather_city){setWeatherCity(st.weather_city);setWeatherDisplay(st.weather_city);}
      if(st.forwarding_address) setFwdAddress(st.forwarding_address);
      if(st.temperature_unit) setTemp(st.temperature_unit==='C'?'°C':'°F');
      if(st.refresh_interval) setRefresh(st.refresh_interval);
      if(st.widget_rotation_sec) setRotationSec(st.widget_rotation_sec);
      if(st.resend_from) setResendFrom(st.resend_from);
      if(st.email_to) setEmailTo(st.email_to);
      if(st.daily_summary_time) setSummaryTime(st.daily_summary_time);
      if(st.kith_url) setKithUrl(st.kith_url);
      if(st.weekly_digest_enabled) setWeeklyDigest(st.weekly_digest_enabled==='1');
      if(st.daily_summary_enabled) setDailySummary(st.daily_summary_enabled==='1');
      if(st.news_feed) setNewsFeeds(st.news_feed.split(',').map(s=>s.trim()).filter(Boolean));
      setWQuote(st.widget_quote_enabled==='1');
      setWStocks(st.widget_stocks_enabled==='1');
      if(st.widget_stocks_tickers) setWStocksTickers(st.widget_stocks_tickers);
      setWPH(st.widget_producthunt_enabled==='1');
      setWGithub(st.widget_github_enabled==='1');
      if(st.widget_github_username) setWGithubUser(st.widget_github_username);
      setWReddit(st.widget_reddit_enabled==='1');
      if(st.widget_reddit_subreddit) setWRedditSub(st.widget_reddit_subreddit);
      setWBeehiiv(st.widget_beehiiv_enabled==='1');
      setWYoutube(st.widget_youtube_enabled==='1');
      if(st.widget_youtube_handle) setWYoutubeHandle(st.widget_youtube_handle);
      setWEtsy(st.widget_etsy_enabled==='1');
      if(st.widget_etsy_shop) setWEtsyShop(st.widget_etsy_shop);
      if(st.widget_flight_number) setWFlightNum(st.widget_flight_number);
      if(st.nextdns_profile_id) setNextdnsProfile(st.nextdns_profile_id);
      if(st.widget_uptime_urls) setWUptimeUrls(st.widget_uptime_urls);
      if(st.uptime_kuma_url) setKumaUrl(st.uptime_kuma_url);
      if(st.uptime_kuma_slug) setKumaSlug(st.uptime_kuma_slug);
      if(st.custom_sport_paths) setCustomSportPath(st.custom_sport_paths);
      if(st.wifi_ssid) setWifiSsid(st.wifi_ssid);
      if(st.sports_leagues){
        const active=st.sports_leagues.split(',').map(s=>s.trim().toLowerCase());
        setSportsLeagues({nfl:active.includes('nfl'),nba:active.includes('nba'),mlb:active.includes('mlb'),nhl:active.includes('nhl'),wnba:active.includes('wnba'),mls:active.includes('mls'),epl:active.includes('epl'),ucl:active.includes('ucl'),wc:active.includes('wc'),wwc:active.includes('wwc'),ncaaf:active.includes('ncaaf'),ncaab:active.includes('ncaab'),pga:active.includes('pga'),atp:active.includes('atp'),nascar:active.includes('nascar'),f1:active.includes('f1')});
      }
    }).catch(()=>{});
    api.get('/api/ha/secret').then(d=>{if(d.secret) setHaSecret(d.secret);}).catch(()=>{});
    fetch('/api/ha/smart-home-status',{headers:{..._authHdr()}}).then(r=>r.json()).then(d=>{if(d.ha){if(d.ha.url)setHaUrl(d.ha.url);if(d.ha.hasToken)setHaHasToken(true);}if(d.homey){if(d.homey.url)setHomeyUrl(d.homey.url);if(d.homey.hasToken)setHomeyHasToken(true);}}).catch(()=>{});
    api.get('/api/settings/integrations').then(d=>{setHasAnthropicKey(!!d.has_anthropic);setHasBeehiivKey(!!d.has_beehiiv);setHasYoutubeKey(!!d.has_youtube);setHasEtsyKey(!!d.has_etsy);setHasTeslemetryKey(!!d.has_teslemetry);setHasAviationstackKey(!!d.has_aviationstack);setHasNextdnsKey(!!d.has_nextdns);setHasBeszel(!!d.has_beszel);if(d.beszel_url)setBeszelUrl(d.beszel_url);setHasPlexKey(!!d.has_plex);if(d.plex_url)setPlexUrl(d.plex_url);setHasLastfm(!!d.has_lastfm);if(d.lastfm_user)setLastfmUser(d.lastfm_user);setHasMoen(!!d.has_moen);setHasUnifi(!!d.has_unifi);if(d.unifi_url)setUnifiUrl(d.unifi_url);if(d.unifi_site)setUnifiSite(d.unifi_site);if(d.unifi_pull_interval)setUnifiInterval(d.unifi_pull_interval);}).catch(()=>{});
    api.get('/api/quick-actions').then(d=>{if(Array.isArray(d)) setQaList(d);}).catch(()=>{});
  },[]);
  const geocodeCity=async()=>{
    if(!weatherCity.trim()) return;
    setGeoLoading(true);
    try{
      const r=await api.get(`/api/weather/geocode?city=${encodeURIComponent(weatherCity)}`);
      if(r.error) throw new Error(r.error);
      setWeatherLat(String(r.lat));
      setWeatherLon(String(r.lon));
      setWeatherDisplay(r.name);
      await api.put('/api/settings',{weather_lat:String(r.lat),weather_lon:String(r.lon),weather_city:r.name});
      toastAdd(`Location set to ${r.name}`);
    }catch(e){
      toastAdd(e.message||'City not found','red');
    }finally{setGeoLoading(false);}
  };
  const [temp,setTemp]=useState('°F');
  const [refresh,setRefresh]=useState('1min');
  const [rotationSec,setRotationSec]=useState('10');

  const saveSetting=(key,value)=>api.put('/api/settings',{[key]:value}).then(r=>{if(r.error)toastAdd(r.error,'red');else toastAdd('Saved');}).catch(()=>toastAdd('Save failed','red'));
  const [pushStatus,setPushStatus]=useState('idle');
  const [icsForm,setIcsForm]=useState({name:'',url:'',color:'#3B82F6'});
  const [icsLoading,setIcsLoading]=useState(false);
  const [icsEditId,setIcsEditId]=useState(null);
  const [icsEditForm,setIcsEditForm]=useState({name:'',url:'',color:'#3B82F6'});
  const [icsEditLoading,setIcsEditLoading]=useState(false);
  const [customSportPath,setCustomSportPath]=useState('');

  const addIcsSource=async()=>{
    if(!icsForm.name.trim()||!icsForm.url.trim()) return;
    setIcsLoading(true);
    try{
      const result=await api.post('/api/ics/sources',icsForm);
      if(result.error) throw new Error(result.error);
      setIcsSources(p=>[...p,result]);
      setIcsForm({name:'',url:'',color:'#3B82F6'});
      toastAdd(`Imported ${result.events_imported} events from ${result.name}`);
    }catch(e){
      toastAdd(`Failed: ${e.message}`,'red');
    }finally{setIcsLoading(false);}
  };

  const removeIcsSource=async id=>{
    await api.del(`/api/ics/sources/${id}`);
    setIcsSources(p=>p.filter(s=>s.id!==id));
    toastAdd('Calendar removed','blue');
  };

  const syncICS=async()=>{
    const r=await api.post('/api/ics/sync');
    toastAdd(`Synced ${r.total_events} events`);
  };

  const enablePush=async()=>{
    setPushStatus('requesting');
    try{
      await subscribePush();
      setPushStatus('subscribed');
      toastAdd('Push notifications enabled');
    }catch(e){
      setPushStatus('error');
      toastAdd(e.message,'red');
    }
  };

  const testPush=async()=>{
    await api.post('/api/push/test');
    toastAdd('Test notification sent');
  };

  const SegControl=({value,onChange,options})=>(
    <div style={{display:'flex',background:A.inputBg,borderRadius:A.rXs,padding:2,gap:1}}>
      {options.map(o=>(
        <button key={o} onClick={()=>onChange(o)} style={{padding:'6px 14px',border:'none',borderRadius:7,background:value===o?A.cardBg:'transparent',color:value===o?A.label1:A.label3,fontSize:13,fontWeight:value===o?600:400,cursor:'pointer',boxShadow:value===o?A.shadowSm:'none',transition:'all .15s'}}>{o}</button>
      ))}
    </div>
  );

  return(
    <div style={{maxWidth:620}}>
      <h1 style={{fontSize:28,fontWeight:800,letterSpacing:'-.03em',marginBottom:24}}>Settings</h1>

      <FormGroup label="Google Calendar">
        <div style={{padding:'14px 16px'}}>
          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:A.label5,flexShrink:0}}/>
            <span style={{fontSize:14,color:A.label3,fontWeight:500}}>Not connected</span>
          </div>
          <p style={{fontSize:13,color:A.label3,marginBottom:12,lineHeight:1.5}}>Add Google Calendar via its secret ICS link: open Google Calendar → Settings → select your calendar → "Integrate calendar" → copy the <em>Secret address in iCal format</em>. Paste it in ICS Calendars below.</p>
        </div>
      </FormGroup>

      <FormGroup label="ICS Calendars">
        {icsSources.length>0&&(
          <>
            {icsSources.map((s,i)=>(
              <div key={s.id} style={{borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                {icsEditId===s.id?(
                  <div style={{padding:'12px 16px',display:'flex',flexDirection:'column',gap:8}}>
                    <Inp value={icsEditForm.name} onChange={e=>setIcsEditForm(p=>({...p,name:e.target.value}))} placeholder="Calendar name"/>
                    <Inp value={icsEditForm.url} onChange={e=>setIcsEditForm(p=>({...p,url:e.target.value}))} placeholder="https://...ics"/>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <input type="color" value={icsEditForm.color} onChange={e=>setIcsEditForm(p=>({...p,color:e.target.value}))} style={{width:36,height:36,border:'none',borderRadius:6,cursor:'pointer',background:'transparent'}}/>
                      <Btn sm onClick={async()=>{
                        setIcsEditLoading(true);
                        try{
                          const r=await api.put(`/api/ics/sources/${s.id}`,icsEditForm);
                          if(r.error){toastAdd(r.error,'red');}
                          else{setIcsSources(p=>p.map(x=>x.id===s.id?r.source:x));setIcsEditId(null);toastAdd('Calendar updated');}
                        }catch{toastAdd('Update failed','red');}
                        finally{setIcsEditLoading(false);}
                      }} style={{flex:1}}>{icsEditLoading?'Saving…':'Save'}</Btn>
                      <Btn sm variant="ghost" onClick={()=>setIcsEditId(null)}>Cancel</Btn>
                    </div>
                  </div>
                ):(
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{width:10,height:10,borderRadius:3,background:s.color,flexShrink:0}}/>
                      <div>
                        <div style={{fontSize:15,color:A.label1,fontWeight:500}}>{s.name}</div>
                        <div style={{fontSize:12,color:A.label5,fontFamily:'JetBrains Mono,monospace',maxWidth:240,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.url}</div>
                      </div>
                    </div>
                    <div style={{display:'flex',gap:12,flexShrink:0}}>
                      <button onClick={()=>{setIcsEditId(s.id);setIcsEditForm({name:s.name,url:s.url,color:s.color});}} style={{background:'none',border:'none',color:A.blue,fontSize:13,cursor:'pointer',fontWeight:500}}>Edit</button>
                      <button onClick={()=>removeIcsSource(s.id)} style={{background:'none',border:'none',color:A.red,fontSize:13,cursor:'pointer',fontWeight:500}}>Remove</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div style={{padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}>
              <Btn sm variant="ghost" onClick={syncICS}>Sync all now</Btn>
            </div>
          </>
        )}
        <div style={{padding:'14px 16px',borderTop:icsSources.length>0?`1px solid ${A.sep}`:'none'}}>
          <div style={{fontSize:13,color:A.label3,marginBottom:10}}>Add a calendar via webcal:// or https:// URL (.ics)</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <Inp value={icsForm.name} onChange={e=>setIcsForm(p=>({...p,name:e.target.value}))} placeholder="Calendar name (e.g. Work)"/>
            <Inp value={icsForm.url} onChange={e=>setIcsForm(p=>({...p,url:e.target.value}))} placeholder="https://calendar.example.com/feed.ics"/>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <input type="color" value={icsForm.color} onChange={e=>setIcsForm(p=>({...p,color:e.target.value}))} style={{width:36,height:36,border:'none',borderRadius:6,cursor:'pointer',background:'transparent'}}/>
              <Btn onClick={addIcsSource} sm style={{flex:1}} variant={icsLoading?'ghost':'blue'} disabled={icsLoading}>{icsLoading?'Importing…':'Add Calendar'}</Btn>
            </div>
          </div>
        </div>
      </FormGroup>

      <FormGroup label="Push Notifications">
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:14,color:A.label3,marginBottom:12}}>Get reminders for due chores and upcoming events. Requires HTTPS.</div>
          {/iphone|ipad|ipod/i.test(navigator.userAgent)&&/safari/i.test(navigator.userAgent)&&!/chrome/i.test(navigator.userAgent)&&(
            <div style={{fontSize:13,color:A.amber,background:A.amberFill,padding:'9px 12px',borderRadius:A.rXs,marginBottom:12,lineHeight:1.5}}>
              Safari on iOS 16.4+ supports Web Push. Add Kith to your Home Screen first, then enable notifications from the installed app.
            </div>
          )}
          {pushStatus==='subscribed'?(
            <div style={{display:'flex',gap:8}}>
              <div style={{display:'flex',alignItems:'center',gap:6,fontSize:14,color:A.green,fontWeight:600}}><div style={{width:8,height:8,borderRadius:'50%',background:A.green}}/>Notifications enabled</div>
              <Btn sm variant="ghost" onClick={testPush}>Send test</Btn>
            </div>
          ):(
            <Btn onClick={enablePush} sm variant={pushStatus==='error'?'ghost':'blue'} style={{minWidth:180}}>
              {pushStatus==='requesting'?'Requesting…':pushStatus==='error'?'Retry':'Enable Notifications'}
            </Btn>
          )}
        </div>
      </FormGroup>

      <FormGroup label="Email Forwarding">
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:14,color:A.label3,marginBottom:10}}>Forward emails with dates here. They&apos;ll appear in your Inbox for review.</div>
          <Inp value={fwdAddress} onChange={e=>setFwdAddress(e.target.value)} placeholder="you@yourdomain.com"/>
          <div style={{display:'flex',gap:8,marginTop:8}}>
            <Btn sm onClick={()=>saveSetting('forwarding_address',fwdAddress)}>Save</Btn>
            <Btn sm variant="ghost" onClick={()=>{navigator.clipboard.writeText(fwdAddress);toastAdd('Copied','blue');}}>Copy</Btn>
          </div>
          <div style={{fontSize:12,color:A.label5,marginTop:8}}>Changing this address requires updating your email routing rules.</div>
          <div style={{borderTop:`1px solid ${A.sep}`,marginTop:14,paddingTop:14}}>
            <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:4}}>Webhook secret</div>
            <div style={{fontSize:13,color:A.label4,marginBottom:10}}>Must match the secret in your Cloudflare Worker. Copy it here after regenerating, then paste it into Cloudflare.</div>
            <WebhookSecretPanel toastAdd={toastAdd}/>
          </div>
        </div>
      </FormGroup>

      <FormGroup label="Email Reminders">
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:14,color:A.label3,marginBottom:14}}>Powered by <a href="https://resend.com" target="_blank" rel="noopener noreferrer" style={{color:A.blue}}>Resend</a>. Get a free API key at resend.com, verify your sending domain, then paste it below.</div>
          <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:14}}>
            <Inp value={resendKey} onChange={e=>setResendKey(e.target.value)} placeholder="Resend API key (re_…)" type="password"/>
            <Inp value={resendFrom} onChange={e=>setResendFrom(e.target.value)} placeholder="From address (e.g. kith@yourdomain.com)"/>
            <Inp value={emailTo} onChange={e=>setEmailTo(e.target.value)} placeholder="Send reminders to (email address)"/>
            <Inp value={kithUrl} onChange={e=>setKithUrl(e.target.value)} placeholder="App URL for unsubscribe link (e.g. https://kith.yourdomain.com)"/>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:0,background:A.systemBg,borderRadius:A.rSm,marginBottom:14,overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 14px'}}>
              <div>
                <div style={{fontSize:14,color:A.label1,fontWeight:500}}>Daily summary</div>
                <div style={{fontSize:12,color:A.label4}}>Today's events + chores at 7am</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <input type="time" value={summaryTime} onChange={e=>setSummaryTime(e.target.value)} style={{background:'var(--input-bg,#F2F2F7)',border:'none',borderRadius:6,padding:'4px 8px',fontSize:13,color:'inherit',cursor:'pointer'}}/>
                <SegControl value={dailySummary?'On':'Off'} onChange={v=>{const on=v==='On';setDailySummary(on);fetch('/api/settings/email',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({daily_summary_enabled:on})});}} options={['Off','On']}/>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 14px',borderTop:`1px solid ${A.sep}`}}>
              <div>
                <div style={{fontSize:14,color:A.label1,fontWeight:500}}>Weekly digest</div>
                <div style={{fontSize:12,color:A.label4}}>Week ahead every Sunday at 6pm</div>
              </div>
              <SegControl value={weeklyDigest?'On':'Off'} onChange={v=>{const on=v==='On';setWeeklyDigest(on);fetch('/api/settings/email',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({weekly_digest_enabled:on})});}} options={['Off','On']}/>
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <Btn sm onClick={async()=>{
              try{
                const body={resend_from:resendFrom,email_to:emailTo,daily_summary_time:summaryTime,kith_url:kithUrl};
                if(resendKey) body.resend_api_key=resendKey;
                const r=await fetch('/api/settings/email',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify(body)});
                const d=await r.json();
                if(d.error) toastAdd(d.error,'red'); else toastAdd('Email settings saved');
              }catch{toastAdd('Save failed','red');}
            }}>Save</Btn>
            <Btn sm variant="ghost" disabled={emailTestLoading} onClick={async()=>{
              setEmailTestLoading(true);
              try{
                const r=await fetch('/api/email/test',{method:'POST',headers:{...(_authHdr())}});
                const d=await r.json();
                if(d.error) toastAdd(d.error,'red'); else toastAdd('Test email sent');
              }catch{toastAdd('Test failed','red');}
              finally{setEmailTestLoading(false);}
            }}>{emailTestLoading?'Sending…':'Send test'}</Btn>
          </div>
        </div>
      </FormGroup>

      <FormGroup label="Display">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px'}}>
          <span style={{fontSize:15,color:A.label1}}>Refresh interval</span>
          <select value={refresh} onChange={e=>{const v=e.target.value;setRefresh(v);saveSetting('refresh_interval',v);if(setRefreshMs)setRefreshMs(parseRefreshMs(v));}} style={{background:A.inputBg,border:'none',borderRadius:A.rXs,padding:'6px 10px',fontSize:14,color:A.label1,cursor:'pointer'}}>
            <option value="30s">30 seconds</option><option value="1min">1 minute</option><option value="5min">5 minutes</option>
          </select>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}>
          <span style={{fontSize:15,color:A.label1}}>Panel rotation speed</span>
          <select value={rotationSec} onChange={e=>{const v=e.target.value;setRotationSec(v);saveSetting('widget_rotation_sec',v);if(setRotationMs)setRotationMs((parseInt(v)||10)*1000);}} style={{background:A.inputBg,border:'none',borderRadius:A.rXs,padding:'6px 10px',fontSize:14,color:A.label1,cursor:'pointer'}}>
            <option value="5">5 seconds</option><option value="8">8 seconds</option><option value="10">10 seconds</option><option value="15">15 seconds</option><option value="20">20 seconds</option><option value="30">30 seconds</option>
          </select>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}>
          <span style={{fontSize:15,color:A.label1}}>Clock</span>
          <SegControl value={clockFormat} onChange={v=>{setClockFormat(v);saveSetting('clock_format',v);}} options={['12h','24h']}/>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}>
          <span style={{fontSize:15,color:A.label1}}>Temperature</span>
          <SegControl value={temp} onChange={v=>{setTemp(v);saveSetting('temperature_unit',v==='°C'?'C':'F');}} options={['°F','°C']}/>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}>
          <div>
            <div style={{fontSize:15,color:A.label1}}>Night mode</div>
            <div style={{fontSize:12,color:A.label4,marginTop:2}}>Minimal clock display</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <input type="time" value={nightModeStart} onChange={e=>{setNightModeStart(e.target.value);saveSetting('night_mode_start',e.target.value);}} style={{background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.rXs,padding:'6px 10px',fontSize:14,color:A.label1,cursor:'pointer'}}/>
            <span style={{fontSize:12,color:A.label4}}>to</span>
            <input type="time" value={nightModeEnd} onChange={e=>{setNightModeEnd(e.target.value);saveSetting('night_mode_end',e.target.value);}} style={{background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.rXs,padding:'6px 10px',fontSize:14,color:A.label1,cursor:'pointer'}}/>
          </div>
        </div>
        <div style={{padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}>
          {!isMobile&&<Btn onClick={onDisplay}>Open Display Mode ↗</Btn>}
        </div>
      </FormGroup>

      <FormGroup label="Weather Location">
        <div style={{padding:'14px 16px',display:'flex',gap:10}}>
          <Inp value={weatherCity} onChange={e=>setWeatherCity(e.target.value)} onKeyDown={e=>e.key==='Enter'&&geocodeCity()} placeholder="City name, e.g. Atlanta" style={{flex:1}}/>
          <Btn sm onClick={geocodeCity}>{geoLoading?'…':'Search'}</Btn>
        </div>
        {weatherDisplay&&<div style={{padding:'0 16px 14px',fontSize:13,color:A.green}}>Current: {weatherDisplay}</div>}
      </FormGroup>

      <FormGroup label="WiFi Network" footer="Displays a scan-to-join QR code on the wall display.">
        <div style={{padding:'14px 16px',display:'flex',flexDirection:'column',gap:8}}>
          <Inp value={wifiSsid} onChange={e=>setWifiSsid(e.target.value)} placeholder="Network name (SSID)"/>
          <Inp value={wifiPassword} onChange={e=>setWifiPassword(e.target.value)} type="password" placeholder="Password"/>
          <Btn sm onClick={async()=>{
            if(!wifiSsid.trim()){toastAdd('Network name required','red');return;}
            const wifiBody={wifi_ssid:wifiSsid.trim()};
            if(wifiPassword) wifiBody.wifi_password=wifiPassword;
            await fetch('/api/settings/wifi',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify(wifiBody)});
            setWifiPassword('');
            api.get('/api/wifi/qr').then(d=>{if(d?.dataUrl) setWifiQrData(d);}).catch(()=>{});
            toastAdd('WiFi saved');
          }}>Save WiFi</Btn>
        </div>
      </FormGroup>

      <FormGroup label="Display Photos" footer="Photos rotate every 12 seconds in the top-right panel of the wall display.">
        <div style={{padding:'14px 16px'}}>
          <label style={{display:'inline-flex',alignItems:'center',gap:10,cursor:'pointer',background:A.blue,color:'#fff',padding:'9px 18px',borderRadius:A.rPill,fontSize:14,fontWeight:600}}>
            + Upload Photo
            <input type="file" accept="image/*" multiple style={{display:'none'}} onChange={async e=>{
              const files=[...e.target.files];
              e.target.value='';
              let ok=0;
              await Promise.all(files.map(file=>new Promise(resolve=>{
                const reader=new FileReader();
                reader.onload=async ev=>{
                  try{
                    const r=await api.post('/api/photos',{filename:file.name,data:ev.target.result});
                    if(!r.error){setPhotos(p=>[r,...p]);ok++;}
                  }catch{}
                  resolve();
                };
                reader.readAsDataURL(file);
              })));
              if(ok>0) toastAdd(`${ok} photo${ok>1?'s':''} uploaded`);
              else toastAdd('Upload failed','red');
            }}/>
          </label>
          {photos&&photos.length>0&&(
            <div style={{marginTop:14,display:'flex',flexWrap:'wrap',gap:8}}>
              {photos.map(p=>(
                <div key={p.id} style={{position:'relative',width:72,height:72,borderRadius:A.rXs,overflow:'hidden',flexShrink:0}}>
                  <img src={`/photos/${p.filename}`} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>
                  <button onClick={async()=>{await api.del(`/api/photos/${p.id}`);setPhotos(pr=>pr.filter(x=>x.id!==p.id));toastAdd('Removed','blue');}} style={{position:'absolute',top:2,right:2,width:20,height:20,borderRadius:'50%',background:'rgba(0,0,0,0.55)',border:'none',color:'#fff',fontSize:13,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1}}>×</button>
                </div>
              ))}
            </div>
          )}
          {(!photos||photos.length===0)&&<p style={{fontSize:13,color:A.label5,marginTop:10,fontStyle:'normal'}}>No photos yet — upload some to show a rotating frame on the wall display</p>}
        </div>
      </FormGroup>

      <FormGroup label="Content" footer="News headlines and live sports show on the wall display when active.">
        <FormRow label="News feeds (RSS)">
          <div style={{display:'flex',flexDirection:'column',gap:6,flex:1,width:'100%'}}>
            {newsFeeds.map((url,i)=>(
              <div key={i} style={{background:A.systemBg,borderRadius:A.rXs,padding:'8px 10px',display:'flex',flexDirection:'column',gap:6}}>
                <span style={{fontSize:12,color:A.label3,fontFamily:'JetBrains Mono,monospace',wordBreak:'break-all',lineHeight:1.4}}>{url}</span>
                <button onClick={()=>{const next=newsFeeds.filter((_,j)=>j!==i);setNewsFeeds(next);saveSetting('news_feed',next.join(','));}} style={{alignSelf:'flex-end',background:'none',border:`1px solid ${A.red}`,color:A.red,fontSize:12,cursor:'pointer',fontWeight:600,padding:'4px 12px',borderRadius:A.rPill}}>Remove</button>
              </div>
            ))}
            <div style={{display:'flex',gap:8,width:'100%'}}>
              <Inp value={newsFeedInput} onChange={e=>setNewsFeedInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&newsFeedInput.trim()){const next=[...newsFeeds,newsFeedInput.trim()];setNewsFeeds(next);saveSetting('news_feed',next.join(','));setNewsFeedInput('');}}} placeholder="https://feeds.npr.org/1001/rss.xml" style={{flex:1,minWidth:0}}/>
              <Btn sm onClick={()=>{if(!newsFeedInput.trim())return;const next=[...newsFeeds,newsFeedInput.trim()];setNewsFeeds(next);saveSetting('news_feed',next.join(','));setNewsFeedInput('');}}>Add</Btn>
            </div>
          </div>
        </FormRow>
        <FormRow label="Custom event (ESPN path)" footer="For Olympics or one-off events. Enter the ESPN sport/league path, e.g. soccer/fifa.world.u20">
          <div style={{display:'flex',gap:10,flex:1}}>
            <Inp value={customSportPath} onChange={e=>setCustomSportPath(e.target.value)} placeholder="e.g. soccer/fifa.world" style={{flex:1}}/>
            <Btn sm onClick={()=>saveSetting('custom_sport_paths',customSportPath.trim())}>Save</Btn>
          </div>
        </FormRow>
        <FormRow label="Live sports">
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            {[['nfl','NFL'],['nba','NBA'],['mlb','MLB'],['nhl','NHL'],['wnba','WNBA'],['mls','MLS'],['epl','EPL'],['ucl','Champions League'],['wc','World Cup'],['wwc',"Women's World Cup"],['ncaaf','NCAAF'],['ncaab','NCAAB'],['pga','PGA Golf'],['atp','ATP Tennis'],['nascar','NASCAR'],['f1','Formula 1']].map(([lg,label])=>(
              <label key={lg} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:14,color:A.label1}}>
                <input type="checkbox" checked={!!sportsLeagues[lg]} onChange={e=>{
                  const next={...sportsLeagues,[lg]:e.target.checked};
                  setSportsLeagues(next);
                  saveSetting('sports_leagues',Object.entries(next).filter(([,v])=>v).map(([k])=>k).join(','));
                }}/>
                {label}
              </label>
            ))}
          </div>
        </FormRow>
      </FormGroup>

      <FormGroup label="Quick Actions">
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:14,color:A.label3,marginBottom:14}}>Buttons on your dashboard that fire any HTTP request — works with Home Assistant, Homey, or anything with an API.</div>
          {qaList.length>0&&(
            <div style={{display:'flex',flexDirection:'column',gap:0,marginBottom:14,borderRadius:A.rSm,overflow:'hidden',border:`1px solid ${A.sep}`}}>
              {qaList.map((action,i)=>(
                <div key={action.id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:'#fff',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                  <span style={{fontSize:20,flexShrink:0}}>{action.icon||'⚡'}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:600,color:A.label1}}>{action.label}</div>
                    <div style={{fontSize:11,color:A.label5,fontFamily:'JetBrains Mono,monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{action.method} {action.url}</div>
                  </div>
                  <button onClick={()=>{setQaEdit(action);setQaForm({label:action.label,icon:action.icon||'⚡',url:action.url,method:action.method||'POST',headers:action.headers||'',body:action.body||''});setQaDrawer(true);}} style={{background:'none',border:'none',color:A.blue,fontSize:13,cursor:'pointer',fontWeight:500}}>Edit</button>
                  <button onClick={async()=>{const next=qaList.filter(a=>a.id!==action.id);await api.put('/api/quick-actions',{actions:next});setQaList(next);if(setQuickActions)setQuickActions(next);toastAdd('Removed','blue');}} style={{background:'none',border:'none',color:A.red,fontSize:13,cursor:'pointer',fontWeight:500}}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <Btn sm onClick={()=>{setQaEdit(null);setQaForm(qaBlank);setQaDrawer(true);}}>+ Add Action</Btn>
        </div>
        <Drawer open={qaDrawer} onClose={()=>{setQaDrawer(false);setQaEdit(null);}} title={qaEdit?'Edit Action':'Add Action'}>
          <FormGroup label="Display">
            <div style={{padding:'12px 16px',display:'flex',gap:10,alignItems:'center'}}>
              <Inp value={qaForm.icon} onChange={e=>setQaForm(p=>({...p,icon:e.target.value}))} style={{width:56,textAlign:'center',fontSize:22}} placeholder="⚡"/>
              <Inp value={qaForm.label} onChange={e=>setQaForm(p=>({...p,label:e.target.value}))} placeholder="Lock front door" style={{flex:1}}/>
            </div>
          </FormGroup>
          <FormGroup label="Request">
            <div style={{padding:'12px 16px',display:'flex',gap:8,alignItems:'center'}}>
              <SegControl value={qaForm.method} onChange={v=>setQaForm(p=>({...p,method:v}))} options={['GET','POST','PUT']}/>
            </div>
            <div style={{padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}>
              <Inp value={qaForm.url} onChange={e=>setQaForm(p=>({...p,url:e.target.value}))} placeholder="http://homeassistant.local:8123/api/services/lock/lock"/>
            </div>
          </FormGroup>
          <FormGroup label="Headers (JSON, optional)" footer='e.g. {"Authorization":"Bearer xxx"}'>
            <div style={{padding:'12px 16px'}}>
              <textarea value={qaForm.headers} onChange={e=>setQaForm(p=>({...p,headers:e.target.value}))} rows={3} placeholder='{"Authorization": "Bearer your-token"}'
                style={{width:'100%',padding:0,border:'none',background:'transparent',fontSize:13,color:A.label1,resize:'none',outline:'none',fontFamily:'JetBrains Mono,monospace',lineHeight:1.5}}/>
            </div>
          </FormGroup>
          {qaForm.method!=='GET'&&(
            <FormGroup label="Body (JSON, optional)" footer='e.g. {"entity_id":"lock.front_door"}'>
              <div style={{padding:'12px 16px'}}>
                <textarea value={qaForm.body} onChange={e=>setQaForm(p=>({...p,body:e.target.value}))} rows={3} placeholder='{"entity_id": "lock.front_door"}'
                  style={{width:'100%',padding:0,border:'none',background:'transparent',fontSize:13,color:A.label1,resize:'none',outline:'none',fontFamily:'JetBrains Mono,monospace',lineHeight:1.5}}/>
              </div>
            </FormGroup>
          )}
          <div style={{padding:'16px'}}>
            <Btn onClick={async()=>{
              if(!qaForm.label.trim()||!qaForm.url.trim()){toastAdd('Label and URL are required','red');return;}
              let next;
              if(qaEdit){
                next=qaList.map(a=>a.id===qaEdit.id?{...qaEdit,...qaForm}:a);
              } else {
                next=[...qaList,{id:Date.now().toString(36),...qaForm}];
              }
              await api.put('/api/quick-actions',{actions:next});
              setQaList(next);
              if(setQuickActions) setQuickActions(next);
              setQaDrawer(false);setQaEdit(null);
              toastAdd(qaEdit?'Action updated':'Action added');
            }} full>{qaEdit?'Save Changes':'Add Action'}</Btn>
          </div>
        </Drawer>
      </FormGroup>

      <FormGroup label="Smart Home">
        <div style={{padding:'14px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:10}}>Home Assistant — pull notifications</div>
          <div style={{marginBottom:8}}><Inp value={haUrl} onChange={e=>setHaUrl(e.target.value)} placeholder="http://homeassistant.local:8123"/></div>
          <div style={{marginBottom:10}}><Inp value={haToken} onChange={e=>setHaToken(e.target.value)} placeholder={haHasToken?'Token saved — paste to replace':'Long-lived access token'} type="password"/></div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:6}}>
            <Btn sm onClick={async()=>{
              if(!haUrl.trim()){toastAdd('URL is required','red');return;}
              setHaSaving(true);
              const body={ha_url:haUrl.trim()};
              if(haToken.trim()) body.ha_token=haToken.trim();
              const r=await fetch('/api/settings/smart-home',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify(body)}).then(x=>x.json()).catch(()=>({error:'Failed'}));
              setHaSaving(false);
              if(r.ok){toastAdd('Saved');if(haToken.trim())setHaHasToken(true);setHaToken('');}
              else toastAdd(r.error||'Save failed','red');
            }} disabled={haSaving}>{haSaving?'Saving…':'Save'}</Btn>
          </div>
          <div style={{fontSize:12,color:A.label5}}>Create a long-lived token in your HA profile page.</div>
        </div>
        <div style={{padding:'14px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:10}}>Homey Pro — pull notifications</div>
          <div style={{marginBottom:8}}><Inp value={homeyUrl} onChange={e=>setHomeyUrl(e.target.value)} placeholder="https://xxx.connect.athom.com"/></div>
          <div style={{marginBottom:10}}><Inp value={homeyToken} onChange={e=>setHomeyToken(e.target.value)} placeholder={homeyHasToken?'Token saved — paste to replace':'Personal access token'} type="password"/></div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:6}}>
            <Btn sm onClick={async()=>{
              if(!homeyUrl.trim()){toastAdd('URL is required','red');return;}
              setHomeySaving(true);
              const body={homey_url:homeyUrl.trim()};
              if(homeyToken.trim()) body.homey_token=homeyToken.trim();
              const r=await fetch('/api/settings/smart-home',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify(body)}).then(x=>x.json()).catch(()=>({error:'Failed'}));
              setHomeySaving(false);
              if(r.ok){toastAdd('Saved');if(homeyToken.trim())setHomeyHasToken(true);setHomeyToken('');}
              else toastAdd(r.error||'Save failed','red');
            }} disabled={homeySaving}>{homeySaving?'Saving…':'Save'}</Btn>
            <Btn sm variant="ghost" onClick={async()=>{
              setSmTesting(true);
              const r=await fetch('/api/ha/pull').then(x=>x.json()).catch(()=>({error:'Request failed'}));
              setSmTesting(false);
              if(Array.isArray(r)) toastAdd(r.length>0?`Connected — ${r.length} notification${r.length!==1?'s':''}  found`:'Connected — no notifications right now');
              else toastAdd(r.error||'Connection failed','red');
            }} disabled={smTesting}>{smTesting?'Testing…':'Test both'}</Btn>
          </div>
          <div style={{fontSize:12,color:A.label5}}>Generate a Personal Access Token at my.homey.app → Account → Personal Access Tokens.</div>
        </div>
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:10}}>Push events (webhook)</div>
          <div style={{fontSize:14,color:A.label3,marginBottom:14,lineHeight:1.5}}>
            Send any automation result to your dashboard. Use the <strong style={{color:A.label1}}>Make a web request</strong> action in HA or a Homey flow:
          </div>
          <div style={{background:A.systemBg,borderRadius:A.rSm,padding:'12px 14px',marginBottom:14,fontFamily:'JetBrains Mono,monospace',fontSize:12,color:A.label2,wordBreak:'break-all',lineHeight:1.7}}>
            <div><span style={{color:A.label4}}>Method:</span> POST</div>
            <div><span style={{color:A.label4}}>URL:</span> {haWebhookUrl}</div>
            <div><span style={{color:A.label4}}>Header:</span> X-HA-Secret: <em style={{color:haSecret?A.label2:A.label5}}>{haSecret||'(loading…)'}</em></div>
            <div><span style={{color:A.label4}}>Body (JSON):</span></div>
            <div style={{paddingLeft:14}}>{'{ "title": "Front door unlocked", "message": "by Mike at 3:42 PM", "icon": "🚪" }'}</div>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <Btn sm onClick={()=>{navigator.clipboard.writeText(haWebhookUrl);toastAdd('URL copied','blue');}}>Copy URL</Btn>
            <Btn sm variant="ghost" onClick={()=>{navigator.clipboard.writeText(haSecret);toastAdd('Secret copied','blue');}}>Copy secret</Btn>
            <Btn sm variant="ghost" onClick={async()=>{
              const r=await fetch('/api/ha/secret',{headers:{..._authHdr()}});
              const d=await r.json();
              if(d.secret) setHaSecret(d.secret);
            }}>Refresh secret</Btn>
          </div>
          <div style={{fontSize:12,color:A.label5,marginTop:10}}>Events appear on your dashboard for 24 hours. The <code style={{fontSize:11}}>icon</code> field is optional — any emoji works.</div>
        </div>
      </FormGroup>

      <FormGroup label="Integrations">
        <div style={{padding:'14px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:8}}>Anthropic (Claude usage widget)</div>
          <div style={{marginBottom:10}}><Inp value={anthropicKey} onChange={e=>setAnthropicKey(e.target.value)} placeholder={hasAnthropicKey?'Saved — paste to replace':'sk-ant-…'} type="password"/></div>
          <Btn sm onClick={async()=>{
            if(!anthropicKey.trim()){toastAdd('Paste a key first','red');return;}
            setIntSaving(true);
            const r=await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({anthropic_api_key:anthropicKey.trim()})}).then(x=>x.json()).catch(()=>({error:'Failed'}));
            setIntSaving(false);
            if(r.ok){setHasAnthropicKey(true);setAnthropicKey('');toastAdd('Saved');}
            else toastAdd(r.error||'Save failed','red');
          }} disabled={intSaving}>{intSaving?'Saving…':'Save'}</Btn>
          <div style={{fontSize:12,color:A.label5,marginTop:8}}>Powers the AI usage meter on your display. Get a key at console.anthropic.com.</div>
        </div>
        <div style={{padding:'14px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:8}}>Beehiiv (newsletter stats)</div>
          <div style={{marginBottom:10}}><Inp value={beehiivKey} onChange={e=>setBeehiivKey(e.target.value)} placeholder={hasBeehiivKey?'Saved — paste to replace':'Beehiiv API key'} type="password"/></div>
          <Btn sm onClick={async()=>{
            if(!beehiivKey.trim()){toastAdd('Paste a key first','red');return;}
            setIntSaving(true);
            const r=await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({beehiiv_api_key:beehiivKey.trim()})}).then(x=>x.json()).catch(()=>({error:'Failed'}));
            setIntSaving(false);
            if(r.ok){setHasBeehiivKey(true);setBeehiivKey('');toastAdd('Saved');}
            else toastAdd(r.error||'Save failed','red');
          }} disabled={intSaving}>{intSaving?'Saving…':'Save'}</Btn>
          <div style={{fontSize:12,color:A.label5,marginTop:8}}>Get a key at app.beehiiv.com → Settings → API.</div>
        </div>
        <div style={{padding:'14px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:8}}>YouTube (channel stats)</div>
          <div style={{marginBottom:10}}><Inp value={youtubeKey} onChange={e=>setYoutubeKey(e.target.value)} placeholder={hasYoutubeKey?'Saved — paste to replace':'YouTube Data API v3 key'} type="password"/></div>
          <Btn sm onClick={async()=>{
            if(!youtubeKey.trim()){toastAdd('Paste a key first','red');return;}
            setIntSaving(true);
            const r=await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({youtube_api_key:youtubeKey.trim()})}).then(x=>x.json()).catch(()=>({error:'Failed'}));
            setIntSaving(false);
            if(r.ok){setHasYoutubeKey(true);setYoutubeKey('');toastAdd('Saved');}
            else toastAdd(r.error||'Save failed','red');
          }} disabled={intSaving}>{intSaving?'Saving…':'Save'}</Btn>
          <div style={{fontSize:12,color:A.label5,marginTop:8}}>Get a key at console.cloud.google.com → YouTube Data API v3.</div>
        </div>
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:8}}>Etsy (shop stats)</div>
          <div style={{marginBottom:10}}><Inp value={etsyKey} onChange={e=>setEtsyKey(e.target.value)} placeholder={hasEtsyKey?'Saved — paste to replace':'Etsy API key (keystring)'} type="password"/></div>
          <Btn sm onClick={async()=>{
            if(!etsyKey.trim()){toastAdd('Paste a key first','red');return;}
            setIntSaving(true);
            const r=await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({etsy_api_key:etsyKey.trim()})}).then(x=>x.json()).catch(()=>({error:'Failed'}));
            setIntSaving(false);
            if(r.ok){setHasEtsyKey(true);setEtsyKey('');toastAdd('Saved');}
            else toastAdd(r.error||'Save failed','red');
          }} disabled={intSaving}>{intSaving?'Saving…':'Save'}</Btn>
          <div style={{fontSize:12,color:A.label5,marginTop:8}}>Get a key at etsy.com/developers → Create app.</div>
        </div>
        <div style={{padding:'14px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:8}}>Teslemetry (Powerwall)</div>
          <div style={{marginBottom:10}}><Inp value={teslemetryKey} onChange={e=>setTeslemetryKey(e.target.value)} placeholder={hasTeslemetryKey?'Saved — paste to replace':'Teslemetry API key'} type="password"/></div>
          <Btn sm onClick={async()=>{
            if(!teslemetryKey.trim()){toastAdd('Paste a key first','red');return;}
            setIntSaving(true);
            const r=await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({teslemetry_api_key:teslemetryKey.trim()})}).then(x=>x.json()).catch(()=>({error:'Failed'}));
            setIntSaving(false);
            if(r.ok){setHasTeslemetryKey(true);setTeslemetryKey('');toastAdd('Saved');}
            else toastAdd(r.error||'Save failed','red');
          }} disabled={intSaving}>{intSaving?'Saving…':'Save'}</Btn>
          <div style={{fontSize:12,color:A.label5,marginTop:8}}>Get a key at teslemetry.com → Account. Auto-discovers your energy site.</div>
        </div>
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:8}}>AviationStack (flight tracker)</div>
          <div style={{marginBottom:10}}><Inp value={aviationstackKey} onChange={e=>setAviationstackKey(e.target.value)} placeholder={hasAviationstackKey?'Saved — paste to replace':'AviationStack API key'} type="password"/></div>
          <Btn sm onClick={async()=>{
            if(!aviationstackKey.trim()){toastAdd('Paste a key first','red');return;}
            setIntSaving(true);
            const r=await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({aviationstack_api_key:aviationstackKey.trim()})}).then(x=>x.json()).catch(()=>({error:'Failed'}));
            setIntSaving(false);
            if(r.ok){setHasAviationstackKey(true);setAviationstackKey('');toastAdd('Saved');}
            else toastAdd(r.error||'Save failed','red');
          }} disabled={intSaving}>{intSaving?'Saving…':'Save'}</Btn>
          <div style={{fontSize:12,color:A.label5,marginTop:8}}>Free tier at aviationstack.com (100 calls/month). Enter a flight in Widgets to track it.</div>
        </div>
        <div style={{padding:'12px 16px'}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:8}}>NextDNS</div>
          <div style={{marginBottom:10}}><Inp value={nextdnsKey} onChange={e=>setNextdnsKey(e.target.value)} placeholder={hasNextdnsKey?'Saved — paste to replace':'NextDNS API key'} type="password"/></div>
          <Btn onClick={async()=>{
            if(!nextdnsKey.trim()){toastAdd('Paste a key first','red');return;}
            setIntSaving(true);
            const r=await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({nextdns_api_key:nextdnsKey.trim()})}).then(x=>x.json()).catch(()=>({error:'Failed'}));
            setIntSaving(false);
            if(r.ok){setHasNextdnsKey(true);setNextdnsKey('');toastAdd('Saved');}
            else toastAdd(r.error||'Save failed','red');
          }} disabled={intSaving}>{intSaving?'Saving…':'Save'}</Btn>
          <div style={{fontSize:12,color:A.label5,marginTop:8}}>Get your API key at my.nextdns.io → Account.</div>
        </div>
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:8}}>Beszel (server monitor)</div>
          <div style={{marginBottom:8}}><Inp value={beszelUrl} onChange={e=>setBeszelUrl(e.target.value)} placeholder="https://beszel.example.com"/></div>
          <div style={{marginBottom:8}}><Inp value={beszelUser} onChange={e=>setBeszelUser(e.target.value)} placeholder={hasBeszel?'Username (saved)':'Username'}/></div>
          <div style={{marginBottom:10}}><Inp value={beszelPass} onChange={e=>setBeszelPass(e.target.value)} placeholder={hasBeszel?'Password (saved — paste to replace)':'Password'} type="password"/></div>
          <Btn onClick={async()=>{
            if(!beszelUrl.trim()){toastAdd('Enter Beszel URL','red');return;}
            if(!beszelUser.trim()){toastAdd('Enter username','red');return;}
            if(!beszelPass.trim()&&!hasBeszel){toastAdd('Enter password','red');return;}
            setIntSaving(true);
            const payload={beszel_url:beszelUrl.trim(),beszel_user:beszelUser.trim()};
            if(beszelPass.trim()) payload.beszel_pass=beszelPass.trim();
            const r=await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify(payload)}).then(x=>x.json()).catch(()=>({error:'Failed'}));
            setIntSaving(false);
            if(r.ok){setHasBeszel(true);setBeszelPass('');toastAdd('Saved');}
            else toastAdd(r.error||'Save failed','red');
          }} disabled={intSaving}>{intSaving?'Saving…':'Save'}</Btn>
          <div style={{fontSize:12,color:A.label5,marginTop:8}}>Fetches CPU, RAM, and temperature for all your servers every 60s.</div>
        </div>
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:8}}>Plex</div>
          <div style={{marginBottom:8}}><Inp value={plexUrl} onChange={e=>setPlexUrl(e.target.value)} placeholder={hasPlexKey?'Server URL (saved)':'http://192.168.1.x:32400'}/></div>
          <div style={{marginBottom:10}}><Inp value={plexToken} onChange={e=>setPlexToken(e.target.value)} placeholder={hasPlexKey?'Token (saved — paste to replace)':'X-Plex-Token'} type="password"/></div>
          <Btn onClick={async()=>{
            if(!plexUrl.trim()){toastAdd('Enter Plex server URL','red');return;}
            if(!plexToken.trim()&&!hasPlexKey){toastAdd('Enter Plex token','red');return;}
            setIntSaving(true);
            const payload={plex_url:plexUrl.trim()};
            if(plexToken.trim()) payload.plex_token=plexToken.trim();
            const r=await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify(payload)}).then(x=>x.json()).catch(()=>({error:'Failed'}));
            setIntSaving(false);
            if(r.ok){setHasPlexKey(true);setPlexToken('');toastAdd('Saved');}
            else toastAdd(r.error||'Save failed','red');
          }} disabled={intSaving}>{intSaving?'Saving…':'Save'}</Btn>
          <div style={{fontSize:12,color:A.label5,marginTop:8}}>Shows now playing (with progress) or recently added when idle. Refreshes every 30s.</div>
        </div>
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:6}}>Last.fm{hasLastfm&&<span style={{marginLeft:8,fontSize:11,color:A.green,fontWeight:500}}>Connected</span>}</div>
          <div style={{fontSize:12,color:A.label5,marginBottom:10}}>Shows what's currently scrobbling from Spotify (or any source). Needs your Last.fm API key and username.</div>
          <input placeholder="API Key" value={lastfmApiKey} onChange={e=>setLastfmApiKey(e.target.value)} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.r,padding:'8px 10px',fontSize:13,color:A.label1,marginBottom:8,boxSizing:'border-box'}}/>
          <input placeholder="Username" value={lastfmUser} onChange={e=>setLastfmUser(e.target.value)} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.r,padding:'8px 10px',fontSize:13,color:A.label1,marginBottom:10,boxSizing:'border-box'}}/>
          <Btn onClick={async()=>{const payload={lastfm_user:lastfmUser};if(lastfmApiKey)payload.lastfm_api_key=lastfmApiKey;await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify(payload)});setHasLastfm(!!(lastfmUser));setLastfmApiKey('');toastAdd('Saved');}}>Save Last.fm</Btn>
        </div>
        <div style={{padding:'14px 16px',borderTop:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:6}}>Moen Flo{hasMoen&&<span style={{marginLeft:8,fontSize:11,color:A.green,fontWeight:500}}>Connected</span>}</div>
          <div style={{fontSize:12,color:A.label5,marginBottom:10}}>Water monitoring — shows daily usage, flow rate, pressure, and leak alerts. Uses your Moen account credentials.</div>
          <input placeholder="Moen email" value={moenUser} onChange={e=>setMoenUser(e.target.value)} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.r,padding:'8px 10px',fontSize:13,color:A.label1,marginBottom:8,boxSizing:'border-box'}}/>
          <input placeholder="Password" type="password" value={moenPass} onChange={e=>setMoenPass(e.target.value)} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.r,padding:'8px 10px',fontSize:13,color:A.label1,marginBottom:10,boxSizing:'border-box'}}/>
          <Btn onClick={async()=>{if(!moenUser.trim()||!moenPass.trim()){toastAdd('Email and password required','red');return;}await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({moen_user:moenUser.trim(),moen_pass:moenPass.trim()})});setHasMoen(true);setMoenPass('');toastAdd('Saved');}}>Save Moen Flo</Btn>
        </div>
        <div style={{padding:'14px 16px',borderTop:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:6}}>UniFi Network{hasUnifi&&<span style={{marginLeft:8,fontSize:11,color:A.green,fontWeight:500}}>Connected</span>}</div>
          <div style={{fontSize:12,color:A.label5,marginBottom:10}}>Shows devices online, WAN status, and real-time bandwidth from your UniFi controller.</div>
          <input placeholder="Controller URL (e.g. https://192.168.1.1)" value={unifiUrl} onChange={e=>setUnifiUrl(e.target.value)} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.r,padding:'8px 10px',fontSize:13,color:A.label1,marginBottom:8,boxSizing:'border-box'}}/>
          <input placeholder="Username" value={unifiUser} onChange={e=>setUnifiUser(e.target.value)} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.r,padding:'8px 10px',fontSize:13,color:A.label1,marginBottom:8,boxSizing:'border-box'}}/>
          <input placeholder="Password" type="password" value={unifiPass} onChange={e=>setUnifiPass(e.target.value)} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.r,padding:'8px 10px',fontSize:13,color:A.label1,marginBottom:8,boxSizing:'border-box'}}/>
          <input placeholder="Site name (default)" value={unifiSite} onChange={e=>setUnifiSite(e.target.value)} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.r,padding:'8px 10px',fontSize:13,color:A.label1,marginBottom:8,boxSizing:'border-box'}}/>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
            <span style={{fontSize:13,color:A.label2,flexShrink:0}}>Pull every</span>
            <select value={unifiInterval} onChange={e=>setUnifiInterval(e.target.value)} style={{flex:1,background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.r,padding:'8px 10px',fontSize:13,color:A.label1}}>
              <option value="30">30 seconds</option>
              <option value="60">60 seconds</option>
              <option value="120">2 minutes</option>
              <option value="300">5 minutes</option>
            </select>
          </div>
          <Btn onClick={async()=>{if(!unifiUrl.trim()||!unifiUser.trim()||!unifiPass.trim()){toastAdd('URL, username, and password required','red');return;}await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({unifi_url:unifiUrl.trim(),unifi_user:unifiUser.trim(),unifi_pass:unifiPass.trim(),unifi_site:unifiSite.trim()||'default',unifi_pull_interval:unifiInterval})});setHasUnifi(true);setUnifiPass('');toastAdd('Saved');}}>Save UniFi</Btn>
        </div>
      </FormGroup>

      <FormGroup label="Widgets">
        <div style={{padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:`1px solid ${A.sep}`}}>
          <span style={{fontSize:14,fontWeight:500,color:A.label1}}>Quote of the day</span>
          <Toggle checked={wQuote} onChange={v=>{setWQuote(v);saveSetting('widget_quote_enabled',v?'1':'0');}}/>
        </div>
        <div style={{padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:`1px solid ${A.sep}`}}>
          <span style={{fontSize:14,fontWeight:500,color:A.label1}}>Product Hunt today</span>
          <Toggle checked={wPH} onChange={v=>{setWPH(v);saveSetting('widget_producthunt_enabled',v?'1':'0');}}/>
        </div>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:500,color:A.label2,marginBottom:8}}>Stock tickers</div>
          <Inp value={wStocksTickers} onChange={e=>setWStocksTickers(e.target.value)} onBlur={e=>saveSetting('widget_stocks_tickers',e.target.value)} placeholder="AAPL, TSLA, SPY — leave blank to disable"/>
        </div>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:500,color:A.label2,marginBottom:8}}>GitHub username</div>
          <Inp value={wGithubUser} onChange={e=>setWGithubUser(e.target.value)} onBlur={e=>saveSetting('widget_github_username',e.target.value)} placeholder="username — leave blank to disable"/>
        </div>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:500,color:A.label2,marginBottom:8}}>Reddit subreddits</div>
          <Inp value={wRedditSub} onChange={e=>setWRedditSub(e.target.value)} onBlur={e=>saveSetting('widget_reddit_subreddit',e.target.value)} placeholder="woodworking, DIY, esp32 — leave blank to disable"/>
        </div>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:500,color:A.label2,marginBottom:4}}>Beehiiv</div>
          <div style={{fontSize:12,color:hasBeehiivKey?A.green:A.label5}}>{hasBeehiivKey?'Active — key saved in Integrations':'Add Beehiiv key in Integrations to enable'}</div>
        </div>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:500,color:A.label2,marginBottom:8}}>YouTube channel handle</div>
          {!hasYoutubeKey&&<div style={{fontSize:11,color:A.amber,marginBottom:6}}>Add YouTube key in Integrations to enable</div>}
          <Inp value={wYoutubeHandle} onChange={e=>setWYoutubeHandle(e.target.value)} onBlur={e=>saveSetting('widget_youtube_handle',e.target.value)} placeholder="@YourChannel — leave blank to disable" disabled={!hasYoutubeKey}/>
        </div>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:500,color:A.label2,marginBottom:8}}>Etsy shop name</div>
          {!hasEtsyKey&&<div style={{fontSize:11,color:A.amber,marginBottom:6}}>Add Etsy key in Integrations to enable</div>}
          <Inp value={wEtsyShop} onChange={e=>setWEtsyShop(e.target.value)} onBlur={e=>saveSetting('widget_etsy_shop',e.target.value)} placeholder="YourShopName — leave blank to disable" disabled={!hasEtsyKey}/>
        </div>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:500,color:A.label2,marginBottom:8}}>Flight tracker</div>
          {!hasAviationstackKey&&<div style={{fontSize:11,color:A.amber,marginBottom:6}}>Add AviationStack key in Integrations to enable</div>}
          <Inp value={wFlightNum} onChange={e=>setWFlightNum(e.target.value)} onBlur={e=>saveSetting('widget_flight_number',e.target.value)} placeholder="e.g. AA123 — leave blank to disable" disabled={!hasAviationstackKey}/>
        </div>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:500,color:A.label2,marginBottom:8}}>Uptime Kuma</div>
          <div style={{marginBottom:6}}><Inp value={kumaUrl} onChange={e=>setKumaUrl(e.target.value)} onBlur={e=>saveSetting('uptime_kuma_url',e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveSetting('uptime_kuma_url',kumaUrl)} placeholder="https://uptimekuma.example.com"/></div>
          <Inp value={kumaSlug} onChange={e=>setKumaSlug(e.target.value)} onBlur={e=>saveSetting('uptime_kuma_slug',e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveSetting('uptime_kuma_slug',kumaSlug)} placeholder="Status page slug (e.g. home)"/>
          <div style={{fontSize:11,color:A.label5,marginTop:4}}>Uses your public status page. Overrides manual URLs below when set.</div>
        </div>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:500,color:A.label2,marginBottom:8}}>Uptime monitor (manual URLs)</div>
          <Inp value={wUptimeUrls} onChange={e=>setWUptimeUrls(e.target.value)} onBlur={e=>saveSetting('widget_uptime_urls',e.target.value)} placeholder="Home Assistant|http://ha.local:8123, Pi|http://pi.local — comma-separated"/>
          <div style={{fontSize:11,color:A.label5,marginTop:4}}>Format: Label|url. Use http:// for local servers. Used only if Uptime Kuma is not set.</div>
        </div>
        <div style={{padding:'12px 16px'}}>
          <div style={{fontSize:13,fontWeight:500,color:A.label2,marginBottom:8}}>NextDNS profile ID</div>
          {!hasNextdnsKey&&<div style={{fontSize:11,color:A.amber,marginBottom:6}}>Add NextDNS API key in Integrations to enable</div>}
          <Inp value={nextdnsProfile} onChange={e=>setNextdnsProfile(e.target.value)} onBlur={e=>saveSetting('nextdns_profile_id',e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveSetting('nextdns_profile_id',nextdnsProfile)} placeholder="e.g. abc123 — leave blank to disable" disabled={!hasNextdnsKey}/>
          <div style={{fontSize:11,color:A.label5,marginTop:4}}>Find your profile ID at my.nextdns.io.</div>
        </div>
      </FormGroup>

    </div>
  );
}

/* ── Bookmarks Screen ────────────────────────────────────────────────── */
function BookmarksScreen({bookmarks,setBookmarks,toastAdd}){
  const isMobile=useIsMobile();
  const [drawerOpen,setDrawerOpen]=useState(false);
  const blank={title:'',url:'',category:'',emoji:'🔗'};
  const [form,setForm]=useState(blank);

  const open=()=>{setForm(blank);setDrawerOpen(true);};
  const save=async()=>{
    if(!form.title.trim()){toastAdd('Title is required','red');return;}
    if(!form.url.trim()){toastAdd('URL is required','red');return;}
    const url=/^https?:\/\//i.test(form.url)?form.url:`https://${form.url}`;
    const created=await api.post('/api/bookmarks',{...form,url}).catch(()=>({error:'Failed'}));
    if(created.error){toastAdd(created.error||'Save failed','red');return;}
    setBookmarks(p=>[...p,created]);
    toastAdd('Bookmark added');
    setDrawerOpen(false);setForm(blank);
  };
  const del=async id=>{
    await api.del(`/api/bookmarks/${id}`);
    setBookmarks(p=>p.filter(b=>b.id!==id));
    toastAdd('Deleted','blue');
  };

  const categories=[...new Set(bookmarks.map(b=>b.category||'').filter(Boolean))];
  const uncategorized=bookmarks.filter(b=>!b.category);

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Bookmarks</h1>
          <p style={{color:A.label4,fontSize:15,marginTop:6}}>{bookmarks.length} link{bookmarks.length!==1?'s':''}</p>
        </div>
        <Btn onClick={open}>+ Add</Btn>
      </div>

      {bookmarks.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No bookmarks yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>School portals, pediatrician, HOA — save links your family actually uses</div>
        </Card>
      ):(
        <>
          {categories.map(cat=>(
            <div key={cat} style={{marginBottom:20}}>
              <div style={{fontSize:11,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>{cat}</div>
              <Card style={{padding:0,overflow:'hidden'}}>
                {bookmarks.filter(b=>b.category===cat).map((b,i,arr)=>(
                  <div key={b.id} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 16px',borderBottom:i<arr.length-1?`1px solid ${A.sep}`:'none'}}>
                    <span style={{fontSize:20,flexShrink:0}}>{b.emoji||'🔗'}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <a href={b.url} target="_blank" rel="noopener noreferrer" style={{fontSize:15,fontWeight:600,color:A.blue,textDecoration:'none'}}>{b.title}</a>
                      <div style={{fontSize:12,color:A.label4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.url}</div>
                    </div>
                    <button onClick={()=>del(b.id)} style={{background:'none',border:'none',fontSize:12,color:A.red,cursor:'pointer',fontWeight:500,padding:'4px 0',flexShrink:0}}>Delete</button>
                  </div>
                ))}
              </Card>
            </div>
          ))}
          {uncategorized.length>0&&(
            <div style={{marginBottom:20}}>
              {categories.length>0&&<div style={{fontSize:11,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>Other</div>}
              <Card style={{padding:0,overflow:'hidden'}}>
                {uncategorized.map((b,i,arr)=>(
                  <div key={b.id} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 16px',borderBottom:i<arr.length-1?`1px solid ${A.sep}`:'none'}}>
                    <span style={{fontSize:20,flexShrink:0}}>{b.emoji||'🔗'}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <a href={b.url} target="_blank" rel="noopener noreferrer" style={{fontSize:15,fontWeight:600,color:A.blue,textDecoration:'none'}}>{b.title}</a>
                      <div style={{fontSize:12,color:A.label4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.url}</div>
                    </div>
                    <button onClick={()=>del(b.id)} style={{background:'none',border:'none',fontSize:12,color:A.red,cursor:'pointer',fontWeight:500,padding:'4px 0',flexShrink:0}}>Delete</button>
                  </div>
                ))}
              </Card>
            </div>
          )}
        </>
      )}

      <Drawer open={drawerOpen} onClose={()=>setDrawerOpen(false)} title="Add Bookmark">
        <FormGroup label="Details">
          <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`}}><Inp value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder="Title (e.g. School Portal)"/></div>
          <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`}}><Inp value={form.url} onChange={e=>setForm(p=>({...p,url:e.target.value}))} placeholder="https://..." type="url"/></div>
          <div style={{padding:'12px 16px',borderBottom:`1px solid ${A.sep}`}}><Inp value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))} placeholder="Category (e.g. School, Health) — optional"/></div>
          <div style={{padding:'12px 16px'}}><Inp value={form.emoji} onChange={e=>setForm(p=>({...p,emoji:e.target.value}))} placeholder="Emoji (default 🔗)"/></div>
        </FormGroup>
        <div style={{padding:'16px'}}><Btn onClick={save} full>Add Bookmark</Btn></div>
      </Drawer>
    </div>
  );
}

/* ── Notes Screen ────────────────────────────────────────────────────── */
const NOTE_COLORS=['#FAFAF5','#FFFBCC','#E8F5E9','#E3F2FD','#FCE4EC','#F3E5F5'];
function NotesScreen({notes,setNotes,toastAdd}){
  const isMobile=useIsMobile();
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [editNote,setEditNote]=useState(null);
  const blank={title:'',content:'',color:'#FAFAF5',pinned:false};
  const [form,setForm]=useState(blank);

  const openNew=()=>{setEditNote(null);setForm(blank);setDrawerOpen(true);};
  const openEdit=n=>{setEditNote(n);setForm({title:n.title,content:n.content||'',color:n.color||'#FAFAF5',pinned:!!n.pinned});setDrawerOpen(true);};

  const save=async()=>{
    if(!form.title.trim()){toastAdd('Title is required','red');return;}
    const body={title:form.title.trim(),content:form.content,color:form.color,pinned:form.pinned?1:0};
    if(editNote){
      const updated=await api.put(`/api/notes/${editNote.id}`,body);
      setNotes(p=>p.map(n=>n.id===editNote.id?updated:n).sort((a,b)=>b.pinned-a.pinned||b.id-a.id));
      toastAdd('Note updated');
    } else {
      const created=await api.post('/api/notes',body);
      setNotes(p=>[created,...p].sort((a,b)=>b.pinned-a.pinned||b.id-a.id));
      toastAdd('Note added');
    }
    setDrawerOpen(false);setEditNote(null);setForm(blank);
  };

  const togglePin=async n=>{
    const updated=await api.put(`/api/notes/${n.id}`,{pinned:n.pinned?0:1});
    setNotes(p=>p.map(x=>x.id===n.id?updated:x).sort((a,b)=>b.pinned-a.pinned||b.id-a.id));
  };

  const del=async id=>{
    await api.del(`/api/notes/${id}`);
    setNotes(p=>p.filter(n=>n.id!==id));
    toastAdd('Deleted','blue');
  };

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Notes</h1>
          <p style={{color:A.label4,fontSize:15,marginTop:6}}>{notes.length} note{notes.length!==1?'s':''} · {notes.filter(n=>n.pinned).length} pinned to display</p>
        </div>
        <Btn onClick={openNew}>+ Add Note</Btn>
      </div>

      {notes.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No notes yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>WiFi password, trash day, plumber number — pin a note to show it on the wall display</div>
        </Card>
      ):(
        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(240px,1fr))',gap:12}}>
          {notes.map(n=>(
            <div key={n.id} style={{background:n.color||'#FAFAF5',borderRadius:A.r,padding:'18px 20px',position:'relative',border:'1px solid rgba(0,0,0,0.06)'}}>
              {n.pinned&&<div style={{position:'absolute',top:12,right:14,width:8,height:8,borderRadius:'50%',background:A.blue}}/>}
              <div style={{fontSize:15,fontWeight:700,color:'#1C1C1E',marginBottom:n.content?8:0,paddingRight:16}}>{n.title}</div>
              {n.content&&<div style={{fontSize:13,color:'#3C3C43',lineHeight:1.5,whiteSpace:'pre-wrap'}}>{n.content}</div>}
              <div style={{display:'flex',gap:10,marginTop:14,alignItems:'center'}}>
                <button onClick={()=>togglePin(n)} style={{background:'none',border:'none',fontSize:12,color:n.pinned?A.blue:A.label4,cursor:'pointer',fontWeight:600,padding:0}}>{n.pinned?'Unpin':'Pin to display'}</button>
                <button onClick={()=>openEdit(n)} style={{background:'none',border:'none',fontSize:12,color:A.blue,cursor:'pointer',fontWeight:500,padding:0}}>Edit</button>
                <button onClick={()=>del(n.id)} style={{background:'none',border:'none',fontSize:12,color:A.red,cursor:'pointer',fontWeight:500,padding:0}}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Drawer open={drawerOpen} onClose={()=>{setDrawerOpen(false);setEditNote(null);}} title={editNote?'Edit Note':'Add Note'}>
        <FormGroup label="Note">
          <div style={{padding:'12px 16px'}}><Inp value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder="Title (e.g. WiFi Password)"/></div>
          <div style={{padding:'12px 16px',borderTop:`1px solid ${A.sep}`}}>
            <textarea value={form.content} onChange={e=>setForm(p=>({...p,content:e.target.value}))} placeholder="Content (optional)" rows={6}
              style={{width:'100%',padding:0,border:'none',background:'transparent',fontSize:15,color:A.label1,resize:'vertical',outline:'none',fontFamily:'inherit',lineHeight:1.5,minHeight:100}}/>
          </div>
        </FormGroup>
        <FormGroup label="Color">
          <div style={{padding:'12px 16px',display:'flex',gap:10}}>
            {NOTE_COLORS.map(c=>(
              <button key={c} onClick={()=>setForm(p=>({...p,color:c}))} style={{width:28,height:28,borderRadius:'50%',background:c,border:form.color===c?`2px solid ${A.blue}`:'2px solid transparent',cursor:'pointer'}}/>
            ))}
          </div>
        </FormGroup>
        <FormGroup label="Options">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px'}}>
            <span style={{fontSize:15,color:A.label1,fontWeight:500}}>Pin to wall display</span>
            <button onClick={()=>setForm(p=>({...p,pinned:!p.pinned}))} style={{width:44,height:26,borderRadius:13,background:form.pinned?A.blue:A.label5,border:'none',cursor:'pointer',position:'relative',transition:'background .2s',flexShrink:0}}>
              <div style={{position:'absolute',top:3,left:form.pinned?21:3,width:20,height:20,borderRadius:'50%',background:'#fff',transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,0.18)'}}/>
            </button>
          </div>
        </FormGroup>
        <div style={{padding:'16px'}}><Btn onClick={save} full>{editNote?'Save Changes':'Add Note'}</Btn></div>
      </Drawer>
    </div>
  );
}

/* ── Polls Screen ────────────────────────────────────────────────────── */
function PollsScreen({polls,setPolls,toastAdd}){
  const isMobile=useIsMobile();
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [question,setQuestion]=useState('');
  const [options,setOptions]=useState(['','']);
  const [voting,setVoting]=useState({});

  const vote=async(poll,idx)=>{
    if(voting[poll.id]) return;
    setVoting(v=>({...v,[poll.id]:true}));
    try{
      const result=await api.post(`/api/polls/${poll.id}/vote`,{option:idx});
      setPolls(p=>p.map(x=>x.id===poll.id?{...x,votes:result.votes}:x));
      toastAdd('Vote counted');
    }catch{toastAdd('Vote failed','red');}
    finally{setVoting(v=>({...v,[poll.id]:false}));}
  };

  const savePoll=async()=>{
    const filtered=options.filter(o=>o.trim());
    if(!question.trim()||filtered.length<2){toastAdd('Need a question and at least 2 options','red');return;}
    const created=await api.post('/api/polls',{question:question.trim(),options:filtered});
    setPolls(p=>[created,...p]);
    setDrawerOpen(false);setQuestion('');setOptions(['','']);
    toastAdd('Poll created');
  };

  const del=async id=>{
    await api.del(`/api/polls/${id}`);
    setPolls(p=>p.filter(x=>x.id!==id));
    toastAdd('Deleted','blue');
  };

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Polls</h1>
          <p style={{color:A.label4,fontSize:15,marginTop:6}}>Vote from here · live results show on the wall display</p>
        </div>
        <Btn onClick={()=>setDrawerOpen(true)}>+ New Poll</Btn>
      </div>

      {polls.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No polls yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Create a poll — household votes from their phones, results show on the wall display</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {polls.map(poll=>{
            const total=Object.values(poll.votes||{}).reduce((a,b)=>a+b,0);
            return(
              <Card key={poll.id} style={{padding:'20px'}}>
                <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16,gap:12}}>
                  <div style={{fontSize:17,fontWeight:700,color:A.label1,flex:1}}>{poll.question}</div>
                  <div style={{display:'flex',gap:8,flexShrink:0}}>
                    <span style={{fontSize:12,color:A.label4}}>{total} vote{total!==1?'s':''}</span>
                    <button onClick={()=>del(poll.id)} style={{background:'none',border:'none',color:A.red,fontSize:13,cursor:'pointer',fontWeight:500}}>Delete</button>
                  </div>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {poll.options.map((opt,idx)=>{
                    const count=poll.votes?.[idx]||0;
                    const pct=total>0?Math.round((count/total)*100):0;
                    return(
                      <button key={idx} onClick={()=>vote(poll,idx)} disabled={!!voting[poll.id]}
                        style={{width:'100%',textAlign:'left',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.rXs,padding:'10px 14px',cursor:'pointer',position:'relative',overflow:'hidden'}}>
                        <div style={{position:'absolute',top:0,left:0,height:'100%',width:`${pct}%`,background:`${A.blue}18`,transition:'width .4s ease'}}/>
                        <div style={{position:'relative',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                          <span style={{fontSize:14,fontWeight:500,color:A.label1}}>{opt}</span>
                          <span style={{fontSize:13,fontWeight:700,color:A.blue,fontVariantNumeric:'tabular-nums'}}>{pct}%</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Drawer open={drawerOpen} onClose={()=>{setDrawerOpen(false);setQuestion('');setOptions(['','']);}} title="New Poll">
        <FormGroup label="Question">
          <div style={{padding:'12px 16px'}}><Inp value={question} onChange={e=>setQuestion(e.target.value)} placeholder="What's for dinner this week?"/></div>
        </FormGroup>
        <FormGroup label="Options">
          {options.map((opt,i)=>(
            <div key={i} style={{padding:'10px 16px',borderTop:`1px solid ${A.sep}`,display:'flex',gap:8,alignItems:'center'}}>
              <Inp value={opt} onChange={e=>setOptions(p=>{const n=[...p];n[i]=e.target.value;return n;})} placeholder={`Option ${i+1}`} style={{flex:1}}/>
              {options.length>2&&<button onClick={()=>setOptions(p=>p.filter((_,j)=>j!==i))} style={{background:'none',border:'none',color:A.red,cursor:'pointer',fontSize:18,lineHeight:1,padding:'0 4px'}}>×</button>}
            </div>
          ))}
          {options.length<6&&(
            <div style={{padding:'10px 16px',borderTop:`1px solid ${A.sep}`}}>
              <button onClick={()=>setOptions(p=>[...p,''])} style={{background:'none',border:'none',color:A.blue,fontSize:14,cursor:'pointer',fontWeight:500}}>+ Add option</button>
            </div>
          )}
        </FormGroup>
        <div style={{padding:'16px'}}><Btn onClick={savePoll} full>Create Poll</Btn></div>
      </Drawer>
    </div>
  );
}

/* ── Goals Screen ────────────────────────────────────────────────────── */
function GoalsScreen({goals,setGoals,toastAdd}){
  const isMobile=useIsMobile();
  const blank={name:'',description:'',progress_type:'percent',progress_current:'',progress_target:'100',unit:'',deadline:''};
  const [form,setForm]=useState(blank);
  const [editId,setEditId]=useState(null);
  const [open,setOpen]=useState(false);
  const [dragging,setDragging]=useState({});
  const [saving,setSaving]=useState({});
  const [goalConfetti,setGoalConfetti]=useState(false);

  const pctOf=g=>dragging[g.id]??(g.progress_target>0?Math.min(100,Math.round((g.progress_current/g.progress_target)*100)):0);

  const openAdd=()=>{setEditId(null);setForm(blank);setOpen(true);};
  const openEdit=g=>{
    setEditId(g.id);
    setForm({name:g.name,description:g.description||'',progress_type:g.progress_type,progress_current:String(g.progress_current),progress_target:String(g.progress_target),unit:g.unit||'',deadline:g.deadline||''});
    setOpen(true);
  };
  const closeForm=()=>{setOpen(false);setEditId(null);setForm(blank);};

  const save=async()=>{
    if(!form.name.trim()){toastAdd('Name required','red');return;}
    const body={name:form.name.trim(),description:form.description.trim(),progress_type:form.progress_type,progress_current:Number(form.progress_current)||0,progress_target:Number(form.progress_target)||100,unit:form.unit.trim(),deadline:form.deadline};
    if(editId){
      const r=await api.put(`/api/goals/${editId}`,body);
      if(!r?.id){toastAdd(r?.error||'Save failed','red');return;}
      setGoals(p=>p.map(g=>g.id===editId?r:g));
      toastAdd('Saved');
    }else{
      const r=await api.post('/api/goals',body);
      if(!r?.id){toastAdd(r?.error||'Save failed','red');return;}
      setGoals(p=>[...p,r]);
      toastAdd('Goal added');
    }
    closeForm();
  };

  const del=async id=>{
    await api.del(`/api/goals/${id}`);
    setGoals(p=>p.filter(g=>g.id!==id));
    toastAdd('Deleted','blue');
  };

  const commitProgress=async(g,pct)=>{
    if(saving[g.id]) return;
    setSaving(s=>({...s,[g.id]:true}));
    const newVal=Math.round((pct/100)*(g.progress_target||100));
    const r=await api.put(`/api/goals/${g.id}`,{progress_current:newVal});
    setSaving(s=>{const n={...s};delete n[g.id];return n;});
    setDragging(d=>{const n={...d};delete n[g.id];return n;});
    if(r?.id){
      const wasComplete=g.progress_current>=g.progress_target;
      setGoals(p=>p.map(x=>x.id===g.id?r:x));
      if(!wasComplete&&newVal>=g.progress_target){
        toastAdd('Goal reached!','green');
        setGoalConfetti(true);
        setTimeout(()=>setGoalConfetti(false),3500);
      }
    }
    else toastAdd(r?.error||'Save failed','red');
  };

  return(
    <div>
      <Confetti active={goalConfetti}/>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Goals</h1>
          <p style={{color:A.label4,fontSize:15,marginTop:6}}>{goals.length} household goal{goals.length!==1?'s':''}</p>
        </div>
        <Btn onClick={openAdd}>+ Add Goal</Btn>
      </div>

      {goals.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No goals yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Add a household goal and track progress here</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {goals.map(g=>{
            const pct=pctOf(g);
            const done=g.progress_target>0&&g.progress_current>=g.progress_target;
            const isCounter=g.progress_type==='counter';
            const daysLeft=g.deadline?Math.ceil((new Date(g.deadline)-new Date())/86400000):null;
            const isSaving=!!saving[g.id];
            return(
              <Card key={g.id} style={{padding:'18px 20px'}}>
                <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,marginBottom:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:17,fontWeight:700,color:A.label1}}>{g.name}</div>
                    {g.description&&<div style={{fontSize:13,color:A.label4,marginTop:3,lineHeight:1.4}}>{g.description}</div>}
                  </div>
                  <div style={{display:'flex',gap:12,flexShrink:0,alignItems:'center'}}>
                    {daysLeft!==null&&<span style={{fontSize:12,color:daysLeft<14?A.amber:A.label4,fontWeight:600}}>{daysLeft>0?`${daysLeft}d left`:'Due today'}</span>}
                    <button onClick={()=>openEdit(g)} style={{background:'none',border:'none',color:A.blue,fontSize:13,cursor:'pointer',fontWeight:500}}>Edit</button>
                    <button onClick={()=>del(g.id)} style={{background:'none',border:'none',color:A.red,fontSize:13,cursor:'pointer',fontWeight:500}}>Delete</button>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
                  <div style={{flex:1,height:8,borderRadius:4,background:A.inputBg,overflow:'hidden'}}>
                    <div style={{height:'100%',borderRadius:4,background:done?A.green:pct>60?A.amber:A.blue,width:`${pct}%`,transition:isSaving?'none':'width .3s ease'}}/>
                  </div>
                  <span style={{fontSize:13,fontWeight:700,color:done?A.green:A.label2,flexShrink:0,minWidth:48,textAlign:'right'}}>
                    {isCounter?`${g.unit||''}${g.progress_current}/${g.unit||''}${g.progress_target}`:`${pct}%`}
                  </span>
                </div>
                {isCounter?(
                  <input type="number" min="0" max={g.progress_target}
                    defaultValue={g.progress_current}
                    key={g.id+'-'+g.progress_current}
                    onBlur={e=>{const v=Number(e.target.value)||0;if(v!==g.progress_current) commitProgress(g,g.progress_target>0?Math.min(100,(v/g.progress_target)*100):0);}}
                    disabled={isSaving}
                    style={{width:100,padding:'6px 10px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:14,color:A.label1}}/>
                ):(
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <input type="range" min="0" max="100"
                      value={pct}
                      onChange={e=>setDragging(d=>({...d,[g.id]:Number(e.target.value)}))}
                      onMouseUp={()=>commitProgress(g,pct)}
                      onTouchEnd={()=>commitProgress(g,pct)}
                      disabled={isSaving}
                      style={{flex:1,accentColor:A.blue,opacity:isSaving?.6:1,cursor:isSaving?'not-allowed':'pointer'}}/>
                    <span style={{fontSize:13,color:A.label4,minWidth:32,textAlign:'right'}}>{pct}%</span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Drawer open={open} onClose={closeForm} title={editId?'Edit Goal':'Add Goal'}>
        <FormGroup label="Name">
          <div style={{padding:'12px 16px'}}><Inp value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Pay off car"/></div>
        </FormGroup>
        <FormGroup label="Description (optional)">
          <div style={{padding:'12px 16px'}}><Inp value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="Notes"/></div>
        </FormGroup>
        <FormGroup label="Progress type">
          <div style={{padding:'12px 16px',display:'flex',gap:8}}>
            {['percent','counter'].map(t=>(
              <button key={t} onClick={()=>setForm(p=>({...p,progress_type:t}))} style={{flex:1,padding:'8px',borderRadius:A.rXs,border:`1px solid ${form.progress_type===t?A.blue:A.sep}`,background:form.progress_type===t?A.blue+'22':'transparent',color:form.progress_type===t?A.blue:A.label3,fontWeight:600,fontSize:13,cursor:'pointer',textTransform:'capitalize'}}>{t}</button>
            ))}
          </div>
        </FormGroup>
        {form.progress_type==='counter'&&(
          <FormGroup label="Unit / Current / Target">
            <div style={{padding:'12px 16px',display:'flex',gap:8}}>
              <Inp value={form.unit} onChange={e=>setForm(p=>({...p,unit:e.target.value}))} placeholder="$ or lbs…" style={{width:80}}/>
              <Inp type="number" value={form.progress_current} onChange={e=>setForm(p=>({...p,progress_current:e.target.value}))} placeholder="Current" style={{flex:1}}/>
              <Inp type="number" value={form.progress_target} onChange={e=>setForm(p=>({...p,progress_target:e.target.value}))} placeholder="Target" style={{flex:1}}/>
            </div>
          </FormGroup>
        )}
        <FormGroup label="Deadline (optional)">
          <div style={{padding:'12px 16px'}}><Inp type="date" value={form.deadline} onChange={e=>setForm(p=>({...p,deadline:e.target.value}))}/></div>
        </FormGroup>
        <div style={{padding:'16px'}}><Btn onClick={save} full>{editId?'Save Changes':'Add Goal'}</Btn></div>
      </Drawer>
    </div>
  );
}


function ManageMode({onDisplay,onLogout,events,setEvents,chores,setChores,grocery,setGrocery,meals,setMeals,icsSources,setIcsSources,inboxCount,setInboxCount,countdowns,setCountdowns,members,setMembers,photos,setPhotos,clockFormat,setClockFormat,weather,nightModeStart,setNightModeStart,nightModeEnd,setNightModeEnd,setRefreshMs,parseRefreshMs,goals,setGoals,notes,setNotes,polls,setPolls,bookmarks,setBookmarks,quickActions,setQuickActions,setRotationMs,setWifiQrData}){
  const isMobile=useIsMobile();
  const [screen,setScreen]=useState('dashboard');
  const {toasts,add:toastAdd}=useToast();
  const [scrolled,setScrolled]=useState(false);
  const [serverUp,setServerUp]=useState(null);
  useEffect(()=>{
    const ping=()=>api.get('/api/uptime').then(()=>setServerUp(true)).catch(()=>setServerUp(false));
    ping();
    const id=setInterval(ping,60000);
    return()=>clearInterval(id);
  },[]);

  const nav=[
    {id:'dashboard',label:'Dashboard',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="1" y="1" width="6" height="6" rx="2" fill="currentColor" opacity=".9"/><rect x="10" y="1" width="6" height="6" rx="2" fill="currentColor" opacity=".9"/><rect x="1" y="10" width="6" height="6" rx="2" fill="currentColor" opacity=".9"/><rect x="10" y="10" width="6" height="6" rx="2" fill="currentColor" opacity=".9"/></svg>},
    {id:'calendar',label:'Calendar',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="1.5" y="3.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1.5 7h14" stroke="currentColor" strokeWidth="1.5"/><path d="M5.5 1.5v3M11.5 1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'chores',label:'Chores',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="2" y="1.5" width="13" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5.5 7l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 11h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'grocery',label:'Grocery',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M2 4h13l-1.5 8H3.5L2 4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M6 4l.5-2.5h4L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>},
    {id:'countdowns',label:'Countdowns',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8.5 5.5V9l2.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 1.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'family',label:'Family',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1 14c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M12 9c1.66 0 3 1.34 3 3v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'goals',label:'Goals',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="6.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="8.5" cy="8.5" r="3" stroke="currentColor" strokeWidth="1.5"/><circle cx="8.5" cy="8.5" r="1" fill="currentColor"/></svg>},
    {id:'notes',label:'Notes',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="2" y="2" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 6h7M5 9h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'bookmarks',label:'Bookmarks',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M3.5 2h10a1 1 0 011 1v12l-5.5-3.5L3.5 15V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>},
    {id:'polls',label:'Polls',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="2" y="9" width="3" height="6" rx="1" fill="currentColor" opacity=".5"/><rect x="7" y="5" width="3" height="10" rx="1" fill="currentColor" opacity=".7"/><rect x="12" y="2" width="3" height="13" rx="1" fill="currentColor"/></svg>},
    {id:'inbox',label:'Inbox',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="1.5" y="3.5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1.5 6.5l7 4 7-4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,badge:inboxCount},
    {id:'settings',label:'Settings',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8.5 1v2M8.5 14v2M1 8.5h2M14 8.5h2M3.05 3.05l1.42 1.42M12.53 12.53l1.42 1.42M12.53 3.05l-1.42 1.42M4.47 12.53l-1.42 1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
  ];

  const screens={
    dashboard:  <DashboardScreen events={events} setEvents={setEvents} chores={chores} grocery={grocery} meals={meals} countdowns={countdowns} weather={weather} clockFormat={clockFormat} quickActions={quickActions}/>,
    calendar:   <CalendarScreen events={events} setEvents={setEvents} icsSources={icsSources} toastAdd={toastAdd} members={members} clockFormat={clockFormat}/>,
    chores:     <ChoresScreen chores={chores} setChores={setChores} goals={goals} toastAdd={toastAdd}/>,
    grocery:    <GroceryScreen grocery={grocery} setGrocery={setGrocery} meals={meals} setMeals={setMeals} toastAdd={toastAdd}/>,
    countdowns: <CountdownsScreen countdowns={countdowns} setCountdowns={setCountdowns} toastAdd={toastAdd}/>,
    family:     <FamilyScreen members={members} setMembers={setMembers} toastAdd={toastAdd}/>,
    goals:      <GoalsScreen goals={goals} setGoals={setGoals} toastAdd={toastAdd}/>,
    notes:      <NotesScreen notes={notes} setNotes={setNotes} toastAdd={toastAdd}/>,
    bookmarks:  <BookmarksScreen bookmarks={bookmarks} setBookmarks={setBookmarks} toastAdd={toastAdd}/>,
    polls:      <PollsScreen polls={polls} setPolls={setPolls} toastAdd={toastAdd}/>,
    inbox:      <InboxScreen toastAdd={toastAdd} events={events} setEvents={setEvents} setInboxCount={setInboxCount}/>,
    settings:   <SettingsScreen toastAdd={toastAdd} icsSources={icsSources} setIcsSources={setIcsSources} onDisplay={onDisplay} photos={photos} setPhotos={setPhotos} clockFormat={clockFormat} setClockFormat={setClockFormat} nightModeStart={nightModeStart} setNightModeStart={setNightModeStart} nightModeEnd={nightModeEnd} setNightModeEnd={setNightModeEnd} setRefreshMs={setRefreshMs} parseRefreshMs={parseRefreshMs} setQuickActions={setQuickActions} setRotationMs={setRotationMs} setWifiQrData={setWifiQrData}/>,
  };

  if(isMobile){
    return(
      <div style={{display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden',background:A.systemBg}}>
        {/* Mobile top bar */}
        <div className="hdr" style={{height:54,background:'#fff',borderBottom:'1px solid rgba(0,0,0,0.07)',boxShadow:scrolled?'0 1px 12px rgba(0,0,0,0.06)':'none',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 16px',flexShrink:0}}>
          <span style={{fontSize:17,fontWeight:700,letterSpacing:'-.03em',color:A.label1}}>{nav.find(n=>n.id===screen)?.label}</span>
          <button onClick={()=>setScreen('settings')} style={{width:30,height:30,borderRadius:'50%',background:A.inputBg,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:A.label3}}>
            <svg width="15" height="15" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8.5 1v2M8.5 14v2M1 8.5h2M14 8.5h2M3.05 3.05l1.42 1.42M12.53 12.53l1.42 1.42M12.53 3.05l-1.42 1.42M4.47 12.53l-1.42 1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        {/* Content */}
        <div key={screen} className="screen fade-scroll" onScroll={e=>setScrolled(e.currentTarget.scrollTop>12)} style={{flex:1,overflowY:'auto',padding:screen==='calendar'?0:'16px 20px',paddingBottom:`calc(96px + env(safe-area-inset-bottom))`}}>
          {screens[screen]}
        </div>
        {/* Bottom tab bar */}
        <div style={{position:'fixed',bottom:'max(12px, env(safe-area-inset-bottom))',left:'50%',transform:'translateX(-50%)',width:'calc(100% - 32px)',maxWidth:560,background:'#fff',border:'1px solid rgba(0,0,0,0.07)',borderRadius:28,boxShadow:'0 2px 20px rgba(0,0,0,0.10)',display:'flex',padding:'0 2px',zIndex:50,height:58,alignItems:'center'}}>
          {nav.map(item=>{
            const active=screen===item.id;
            return(
              <button key={item.id} onClick={()=>setScreen(item.id)} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',border:'none',background:'none',cursor:'pointer',gap:2,position:'relative',padding:'4px 0'}}>
                <div style={{width:active?42:32,height:active?28:28,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,background:active?A.inputBg:'transparent',transition:'width .15s,background .15s',color:active?A.label1:A.label4}}>
                  {item.icon}
                </div>
                {active&&<span style={{fontSize:10,fontWeight:700,color:A.label1,letterSpacing:'-.01em',lineHeight:1}}>{item.label}</span>}
              </button>
            );
          })}
        </div>
        <ToastStack toasts={toasts}/>
      </div>
    );
  }

  return(
    <div style={{display:'flex',height:'100vh',overflow:'hidden',background:A.systemBg}}>
      <div style={{width:220,flexShrink:0,background:'#EEECEA',borderRight:'1px solid rgba(0,0,0,0.07)',display:'flex',flexDirection:'column'}}>
        <div style={{padding:'22px 18px 14px'}}>
          <div style={{fontSize:22,fontWeight:800,letterSpacing:'-.05em',color:A.label1}}>Kith</div>
          <div style={{fontSize:12,color:A.label5,marginTop:1,letterSpacing:'-.01em'}}>Family Dashboard</div>
        </div>
        <div style={{flex:1,padding:'4px 10px',overflowY:'auto'}}>
          {nav.map(item=>{
            const active=screen===item.id;
            return(
              <button key={item.id} onClick={()=>setScreen(item.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:A.rSm,border:'none',cursor:'pointer',width:'100%',background:active?'#1A1A1A':'transparent',color:active?'#fff':A.label3,fontSize:14,fontWeight:active?600:400,textAlign:'left',marginBottom:1,transition:'background .12s,color .12s'}}
                onMouseEnter={e=>{if(!active)e.currentTarget.style.background='rgba(0,0,0,0.05)';}}
                onMouseLeave={e=>{if(!active)e.currentTarget.style.background='transparent';}}
                onMouseDown={e=>{e.currentTarget.style.transform='scale(.99)';}}
                onMouseUp={e=>{e.currentTarget.style.transform='scale(1)';}}
              >
                <span style={{flexShrink:0,opacity:active?1:.7}}>{item.icon}</span>
                <span style={{flex:1}}>{item.label}</span>
                {item.badge&&!active&&<span style={{background:A.red,color:'#fff',fontSize:11,fontWeight:700,padding:'1px 6px',borderRadius:A.rPill}}>{item.badge}</span>}
              </button>
            );
          })}
        </div>
        <div style={{padding:'12px 10px 16px',borderTop:`1px solid ${A.sep}`}}>
          <button onClick={onDisplay} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderRadius:A.rSm,border:'1px solid rgba(0,0,0,0.09)',cursor:'pointer',width:'100%',background:'transparent',color:A.label3,fontSize:13,fontWeight:500,textAlign:'left',marginBottom:8,transition:'background .12s'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(0,0,0,0.04)'}
            onMouseLeave={e=>e.currentTarget.style.background='transparent'}
          >
            <svg width="15" height="12" viewBox="0 0 15 12" fill="none"><rect x=".75" y=".75" width="13.5" height="9" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M4 11.25h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M7.5 9.75v1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            Display Mode
          </button>
          <button onClick={onLogout} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderRadius:A.rSm,border:'none',cursor:'pointer',width:'100%',background:'transparent',color:A.label4,fontSize:13,fontWeight:400,textAlign:'left',marginBottom:10,transition:'background .12s'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(0,0,0,0.04)'}
            onMouseLeave={e=>e.currentTarget.style.background='transparent'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 13H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10 10l3-3-3-3M13 7H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Switch user
          </button>
          <div style={{width:8,height:8,borderRadius:'50%',background:serverUp===null?A.label5:serverUp?A.green:A.red,transition:'background .3s'}}/>
        </div>
      </div>

      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div className="hdr" style={{height:54,background:'#fff',borderBottom:'1px solid rgba(0,0,0,0.07)',boxShadow:scrolled?'0 1px 12px rgba(0,0,0,0.06)':'none',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 26px',flexShrink:0}}>
          <span style={{fontSize:17,fontWeight:700,letterSpacing:'-.03em',color:A.label1}}>{nav.find(n=>n.id===screen)?.label}</span>
          <div style={{display:'flex',alignItems:'center',gap:14}}>
            <button onClick={()=>setScreen('settings')} style={{width:30,height:30,borderRadius:'50%',background:A.inputBg,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:A.label3}}>
              <svg width="15" height="15" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8.5 1v2M8.5 14v2M1 8.5h2M14 8.5h2M3.05 3.05l1.42 1.42M12.53 12.53l1.42 1.42M12.53 3.05l-1.42 1.42M4.47 12.53l-1.42 1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>
        <div key={screen} className="screen fade-scroll" onScroll={e=>setScrolled(e.currentTarget.scrollTop>12)} style={{flex:1,overflowY:'auto',padding:screen==='calendar'?0:'28px 32px'}}>
          {screens[screen]}
        </div>
      </div>
      <ToastStack toasts={toasts}/>
    </div>
  );
}

/* ── App Root ─────────────────────────────────────────────────────────── */
/* ── Auth / Login ────────────────────────────────────────────────────────── */
function PinPad({title,subtitle,onSubmit,onBack,error,loading}){
  const [pin,setPin]=useState('');
  const press=(d)=>{
    if(loading) return;
    const next=pin+d;
    if(next.length<=8) setPin(next);
  };
  const submit=()=>{if(pin.length>=4&&!loading) onSubmit(pin).then(ok=>{if(!ok) setPin('');});};
  const del=()=>setPin(p=>p.slice(0,-1));
  return(
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:28,animation:'slideUp .2s ease'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:22,fontWeight:600,color:A.label1}}>{title}</div>
        {subtitle&&<div style={{fontSize:14,color:A.label3,marginTop:5}}>{subtitle}</div>}
      </div>
      <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',justifyContent:'center',maxWidth:160}}>
        {Array.from({length:8},(_,i)=>(
          <div key={i} style={{width:12,height:12,borderRadius:'50%',background:pin.length>i?A.blue:A.sep,transition:'background .12s'}}/>
        ))}
      </div>
      {error&&<div style={{fontSize:13,color:A.red,fontWeight:500,marginTop:-8}}>{error}</div>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,76px)',gap:12}}>
        {[1,2,3,4,5,6,7,8,9,pin.length>=4?'✓':'',0,'⌫'].map((d,i)=>(
          d===''?<div key={i}/>:
          <button key={i} onClick={()=>d==='⌫'?del():d==='✓'?submit():press(String(d))}
            style={{width:76,height:76,borderRadius:'50%',border:'none',background:d==='⌫'||d==='✓'?'transparent':A.inputBg,fontSize:d==='⌫'?22:d==='✓'?28:24,fontWeight:500,color:d==='✓'?A.blue:A.label1,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',opacity:loading?.5:1,transition:'opacity .1s'}}>
            {d}
          </button>
        ))}
      </div>
      {onBack&&<button onClick={onBack} style={{color:A.blue,background:'none',border:'none',fontSize:15,cursor:'pointer',marginTop:4}}>Back</button>}
    </div>
  );
}

function LoginOverlay({onLogin,onKiosk}){
  const [members,setMembers]=useState([]);
  const [selected,setSelected]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [setupNeeded,setSetupNeeded]=useState(false);

  useEffect(()=>{
    fetch('/api/members').then(r=>r.json()).then(setMembers).catch(()=>{});
    fetch('/api/auth/setup-status').then(r=>r.json()).then(s=>{
      if(!s.configured) setSetupNeeded(true);
    }).catch(()=>{});
  },[]);

  const submitPin=async(pin)=>{
    setError(''); setLoading(true);
    try{
      if(setupNeeded){
        const r=await fetch('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});
        const d=await r.json();
        if(!r.ok){setError(d.error||'Setup failed');setLoading(false);return false;}
        onLogin(d.token,null); return true;
      }
      const endpoint=selected.type==='admin'?'/api/auth/admin':'/api/auth/login';
      const body=selected.type==='admin'?{pin}:{member_id:selected.data.id,pin};
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const d=await r.json();
      if(!r.ok){setError(d.error||'Wrong PIN');setLoading(false);return false;}
      onLogin(d.token,d.member||null); return true;
    }catch(e){setError('Connection error');setLoading(false);return false;}
  };

  const wrap=(children)=>(
    <div style={{position:'fixed',inset:0,background:A.systemBg,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',zIndex:10000,gap:40}}>
      {children}
    </div>
  );

  if(setupNeeded) return wrap(
    <>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:28,fontWeight:700,color:A.label1}}>Welcome to Kith</div>
        <div style={{fontSize:15,color:A.label3,marginTop:8,maxWidth:280}}>Create an admin PIN to get started.</div>
      </div>
      <PinPad title="Create Admin PIN" onSubmit={submitPin} error={error} loading={loading}/>
    </>
  );

  if(selected) return wrap(
    <PinPad
      title={selected.type==='admin'?'Admin':selected.data.name}
      subtitle={selected.type==='admin'?'Enter admin PIN':'Enter your PIN'}
      onSubmit={submitPin}
      onBack={()=>{setSelected(null);setError('');}}
      error={error}
      loading={loading}
    />
  );

  return wrap(
    <>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:28,fontWeight:700,color:A.label1}}>Kith</div>
        <div style={{fontSize:15,color:A.label3,marginTop:6}}>Who&rsquo;s using this?</div>
      </div>
      <div style={{display:'flex',gap:20,flexWrap:'wrap',justifyContent:'center',maxWidth:420}}>
        {members.map(m=>(
          <button key={m.id} onClick={()=>setSelected({type:'member',data:m})}
            style={{display:'flex',flexDirection:'column',alignItems:'center',gap:10,background:'none',border:'none',cursor:'pointer',padding:8}}>
            <div style={{width:68,height:68,borderRadius:'50%',background:m.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,fontWeight:700,color:'#fff',boxShadow:A.shadowMd}}>
              {m.initials}
            </div>
            <div style={{fontSize:14,fontWeight:500,color:A.label1}}>{m.name}</div>
          </button>
        ))}
        <button onClick={()=>setSelected({type:'admin'})}
          style={{display:'flex',flexDirection:'column',alignItems:'center',gap:10,background:'none',border:'none',cursor:'pointer',padding:8}}>
          <div style={{width:68,height:68,borderRadius:'50%',background:A.label4,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,color:'#fff',boxShadow:A.shadowMd}}>⚙</div>
          <div style={{fontSize:14,fontWeight:500,color:A.label3}}>Admin</div>
        </button>
      </div>
      <button onClick={onKiosk} style={{color:A.label4,background:'none',border:'none',fontSize:13,cursor:'pointer'}}>
        View Only (Display Mode)
      </button>
    </>
  );
}

function SetupWizard({onComplete}){
  const [step,setStep]=useState(1);
  const [city,setCity]=useState('');
  const [cityResult,setCityResult]=useState(null);
  const [cityBusy,setCityBusy]=useState(false);
  const [cityErr,setCityErr]=useState('');
  const [memberName,setMemberName]=useState('');
  const [memberColor,setMemberColor]=useState('#007AFF');
  const [addedMembers,setAddedMembers]=useState([]);
  const [aiProvider,setAiProvider]=useState('gemini');
  const [aiKey,setAiKey]=useState('');
  const [saving,setSaving]=useState(false);
  const COLORS=['#007AFF','#34C759','#FF3B30','#FF9500','#5856D6','#32ADE6','#AF52DE','#FF2D55'];

  const searchCity=async()=>{
    if(!city.trim()) return;
    setCityBusy(true);setCityErr('');
    try{
      const r=await fetch(`/api/weather/geocode?city=${encodeURIComponent(city)}`).then(r=>r.json());
      if(r.error){setCityErr('City not found');setCityResult(null);}
      else setCityResult(r);
    }catch{setCityErr('Search failed');}
    finally{setCityBusy(false);}
  };

  const step1Next=async()=>{
    if(cityResult) await api.put('/api/settings',{weather_lat:String(cityResult.lat),weather_lon:String(cityResult.lon),weather_city:cityResult.name}).catch(()=>{});
    setStep(2);
  };

  const addMember=async()=>{
    if(!memberName.trim()) return;
    const r=await api.post('/api/members',{name:memberName.trim(),color:memberColor}).catch(()=>null);
    if(r?.id) setAddedMembers(p=>[...p,{id:r.id,name:r.name,color:memberColor,initials:r.initials}]);
    setMemberName('');
  };

  const step3Next=async()=>{
    if(aiKey.trim()){
      await fetch('/api/settings/ai-key',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({provider:aiProvider,key:aiKey.trim()})}).catch(()=>{});
    }
    setStep(4);
  };

  const finish=async()=>{
    setSaving(true);
    await api.put('/api/settings',{wizard_completed:'1'}).catch(()=>{});
    onComplete();
  };

  const dots=(
    <div style={{display:'flex',gap:8,marginBottom:40}}>
      {[1,2,3,4].map(s=>(
        <div key={s} style={{width:s===step?24:8,height:8,borderRadius:4,background:s<=step?A.blue:'rgba(0,0,0,0.12)',transition:'all .3s'}}/>
      ))}
    </div>
  );

  const wrap=(title,sub,content,btns)=>(
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:A.systemBg,padding:24}}>
      {dots}
      <div style={{width:'100%',maxWidth:440}}>
        <div style={{marginBottom:28,textAlign:'center'}}>
          <h1 style={{fontSize:28,fontWeight:800,letterSpacing:'-.04em',color:A.label1,margin:0}}>{title}</h1>
          {sub&&<p style={{fontSize:15,color:A.label4,marginTop:8,lineHeight:1.5,margin:'8px 0 0'}}>{sub}</p>}
        </div>
        {content}
        <div style={{display:'flex',gap:12,marginTop:28}}>{btns}</div>
      </div>
    </div>
  );

  if(step===1) return wrap(
    'Where are you?',
    'Used for local weather on your dashboard.',
    <Card style={{padding:20}}>
      <div style={{display:'flex',gap:8}}>
        <Inp value={city} onChange={e=>{setCity(e.target.value);setCityResult(null);setCityErr('');}} placeholder="City name" onKeyDown={e=>e.key==='Enter'&&searchCity()}/>
        <Btn onClick={searchCity} style={{flexShrink:0}}>{cityBusy?'…':'Search'}</Btn>
      </div>
      {cityResult&&<div style={{marginTop:12,padding:'10px 14px',background:A.blueFill,borderRadius:A.rXs,fontSize:14,color:A.blue,fontWeight:500}}>{cityResult.name}</div>}
      {cityErr&&<div style={{marginTop:12,fontSize:14,color:A.red}}>{cityErr}</div>}
    </Card>,
    <Btn full onClick={step1Next}>{cityResult?'Use this location':'Skip'}</Btn>
  );

  if(step===2) return wrap(
    "Who's in your family?",
    'Color-code events and track chores by person.',
    <>
      <Card style={{padding:20,marginBottom:16}}>
        <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:14}}>
          {COLORS.map(c=><button key={c} onClick={()=>setMemberColor(c)} style={{width:30,height:30,borderRadius:'50%',border:`3px solid ${memberColor===c?'#1C1C1E':'transparent'}`,background:c,cursor:'pointer'}}/>)}
        </div>
        <div style={{display:'flex',gap:8}}>
          <Inp value={memberName} onChange={e=>setMemberName(e.target.value)} placeholder="Name (e.g. Emma)" onKeyDown={e=>e.key==='Enter'&&addMember()}/>
          <Btn onClick={addMember} style={{flexShrink:0}}>Add</Btn>
        </div>
      </Card>
      {addedMembers.length>0&&<Card>{addedMembers.map((m,i)=>(
        <div key={m.id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
          <div style={{width:36,height:36,borderRadius:'50%',background:m.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:'#fff'}}>{m.initials}</div>
          <span style={{fontSize:15,fontWeight:500,color:A.label1}}>{m.name}</span>
        </div>
      ))}</Card>}
    </>,
    <>
      <Btn variant='ghost' full onClick={()=>setStep(3)}>Skip</Btn>
      <Btn full onClick={()=>setStep(3)}>Continue</Btn>
    </>
  );

  if(step===3) return wrap(
    'AI email parsing',
    'Optional — lets Kith extract events from forwarded emails.',
    <Card style={{padding:20}}>
      <div style={{marginBottom:12}}>
        <Sel value={aiProvider} onChange={e=>setAiProvider(e.target.value)}>
          <option value="gemini">Gemini Flash (Google — recommended)</option>
          <option value="anthropic">Claude Haiku (Anthropic)</option>
          <option value="openai">GPT-4o Mini (OpenAI)</option>
          <option value="groq">Llama 3.1 (Groq — free tier)</option>
        </Sel>
      </div>
      <Inp value={aiKey} onChange={e=>setAiKey(e.target.value)} placeholder="Paste API key" type="password"/>
    </Card>,
    <>
      <Btn variant='ghost' full onClick={()=>setStep(4)}>Skip</Btn>
      <Btn full onClick={step3Next}>{aiKey.trim()?'Save & continue':'Continue'}</Btn>
    </>
  );

  return(
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:A.systemBg,padding:24,textAlign:'center'}}>
      <div style={{fontSize:56,marginBottom:8}}>🏡</div>
      <h1 style={{fontSize:32,fontWeight:800,letterSpacing:'-.04em',color:A.label1,margin:'0 0 8px'}}>Kith is ready</h1>
      <p style={{fontSize:16,color:A.label4,marginBottom:40,maxWidth:320,lineHeight:1.5}}>Your family dashboard is all set. You can update any of this later in Settings.</p>
      <Btn onClick={finish} style={{minWidth:200,padding:'14px 32px',fontSize:17}}>
        {saving?'Loading…':'Enter Kith'}
      </Btn>
    </div>
  );
}

function App(){
  const [auth,setAuth]=useState('');
  const [kiosk,setKiosk]=useState(false);
  const [authChecked,setAuthChecked]=useState(false);
  const [currentMember,setCurrentMember]=useState(null);
  const [mode,setMode]=useState('manage');
  const [events,setEvents]=useState([]);
  const [chores,setChores]=useState([]);
  const [grocery,setGrocery]=useState([]);
  const [meals,setMeals]=useState([]);
  const [icsSources,setIcsSources]=useState([]);
  const [inboxCount,setInboxCount]=useState(0);
  const [countdowns,setCountdowns]=useState([]);
  const [members,setMembers]=useState([]);
  const [goals,setGoals]=useState([]);
  const [notes,setNotes]=useState([]);
  const [polls,setPolls]=useState([]);
  const [bookmarks,setBookmarks]=useState([]);
  const [quickActions,setQuickActions]=useState([]);
  const [photos,setPhotos]=useState([]);
  const [clockFormat,setClockFormat]=useState('12h');
  const [nightModeStart,setNightModeStart]=useState('23:00');
  const [nightModeEnd,setNightModeEnd]=useState('06:00');
  const [refreshMs,setRefreshMs]=useState(60000);
  const [rotationMs,setRotationMs]=useState(10000);
  const [weather,setWeather]=useState(null);
  const [wifiQrData,setWifiQrData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [wizardDone,setWizardDone]=useState(null); // null=checking, false=show wizard, true=done
  const parseRefreshMs=v=>({'30s':30000,'1min':60000,'5min':300000}[v]||60000);

  const handleLogin=(token,member)=>{
    localStorage.setItem('kith_token',token);
    if(member) setCurrentMember(member);
    setAuth(token);
  };
  const handleKiosk=()=>{
    localStorage.setItem('kith_kiosk','1');
    setKiosk(true);
  };
  const handleLogout=()=>{
    localStorage.removeItem('kith_token');
    localStorage.removeItem('kith_kiosk');
    setAuth('');
    setKiosk(false);
  };

  useEffect(()=>{
    const kioskFlag=localStorage.getItem('kith_kiosk')==='1';
    if(kioskFlag){setKiosk(true);setAuthChecked(true);return;}
    const token=localStorage.getItem('kith_token')||'';
    if(!token){setAuthChecked(true);return;}
    fetch('/api/auth/me',{headers:{'Authorization':`Bearer ${token}`}})
      .then(r=>{if(r.ok) setAuth(token); else localStorage.removeItem('kith_token');})
      .catch(()=>{})
      .finally(()=>setAuthChecked(true));
  },[]);

  // Check whether setup wizard has been completed
  useEffect(()=>{
    if(!authChecked) return;
    if(kiosk){setWizardDone(true);return;}
    if(!auth) return;
    api.get('/api/settings').then(s=>{
      setWizardDone(s.wizard_completed==='1');
    }).catch(()=>setWizardDone(true));
  },[authChecked,auth,kiosk]);

  useEffect(()=>{
    if(!authChecked||(!auth&&!kiosk)||wizardDone!==true) return;
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('/sw.js').catch(()=>{});
    }
    Promise.allSettled([
      api.get('/api/events'),
      api.get('/api/chores'),
      api.get('/api/grocery'),
      api.get('/api/meals'),
      api.get('/api/ics/sources'),
      api.get('/api/inbox'),
      api.get('/api/countdowns'),
      api.get('/api/members'),
      api.get('/api/photos'),
      api.get('/api/settings'),
      api.get('/api/goals'),
      api.get('/api/notes'),
      api.get('/api/polls'),
      api.get('/api/quick-actions'),
      api.get('/api/bookmarks'),
    ]).then(([ev,ch,gr,ml,ics,inb,cd,mb,ph,st,gl,nt,pl,qa,bm])=>{
      if(ev.status==='fulfilled'&&Array.isArray(ev.value)) setEvents(ev.value);
      if(ch.status==='fulfilled'&&Array.isArray(ch.value)) setChores(ch.value);
      if(gr.status==='fulfilled'&&Array.isArray(gr.value)) setGrocery(gr.value);
      if(ml.status==='fulfilled'&&Array.isArray(ml.value)) setMeals(ml.value);
      if(ics.status==='fulfilled'&&Array.isArray(ics.value)) setIcsSources(ics.value);
      if(inb.status==='fulfilled'&&Array.isArray(inb.value?.pending)) setInboxCount(inb.value.pending.length);
      if(cd.status==='fulfilled'&&Array.isArray(cd.value)) setCountdowns(cd.value);
      if(mb.status==='fulfilled'&&Array.isArray(mb.value)) setMembers(mb.value);
      if(ph.status==='fulfilled'&&Array.isArray(ph.value)) setPhotos(ph.value);
      if(gl.status==='fulfilled'&&Array.isArray(gl.value)) setGoals(gl.value);
      if(nt.status==='fulfilled'&&Array.isArray(nt.value)) setNotes(nt.value);
      if(pl.status==='fulfilled'&&Array.isArray(pl.value)) setPolls(pl.value);
      if(qa.status==='fulfilled'&&Array.isArray(qa.value)) setQuickActions(qa.value);
      if(bm.status==='fulfilled'&&Array.isArray(bm.value)) setBookmarks(bm.value);
      if(st.status==='fulfilled'){
        const s=st.value;
        if(s.clock_format) setClockFormat(s.clock_format);
        if(s.night_mode_start) setNightModeStart(s.night_mode_start);
        if(s.night_mode_end) setNightModeEnd(s.night_mode_end);
        if(s.refresh_interval) setRefreshMs(parseRefreshMs(s.refresh_interval));
        if(s.widget_rotation_sec) setRotationMs((parseInt(s.widget_rotation_sec)||10)*1000);
      }
      setLoading(false);
    });
    api.get('/api/weather').then(w=>{if(!w.error) setWeather(w);}).catch(()=>{});
    api.get('/api/wifi/qr').then(d=>{if(d?.dataUrl) setWifiQrData(d);}).catch(()=>{});
  },[authChecked,auth,kiosk,wizardDone]);

  // Background poll — keeps wall display live
  useEffect(()=>{
    if(loading||(!auth&&!kiosk)) return;
    const poll=()=>{
      Promise.allSettled([
        api.get('/api/events'),
        api.get('/api/chores'),
        api.get('/api/grocery'),
        api.get('/api/countdowns'),
        api.get('/api/inbox'),
        api.get('/api/meals'),
        api.get('/api/members'),
        api.get('/api/photos'),
      ]).then(([ev,ch,gr,cd,inb,ml,mb,ph])=>{
        if(ev.status==='fulfilled') setEvents(ev.value);
        if(ch.status==='fulfilled') setChores(ch.value);
        if(gr.status==='fulfilled') setGrocery(gr.value);
        if(cd.status==='fulfilled') setCountdowns(cd.value);
        if(inb.status==='fulfilled'&&Array.isArray(inb.value?.pending)) setInboxCount(inb.value.pending.length);
        if(ml.status==='fulfilled') setMeals(ml.value);
        if(mb.status==='fulfilled') setMembers(mb.value);
        if(ph.status==='fulfilled') setPhotos(ph.value);
      });
      api.get('/api/weather').then(w=>{if(!w.error) setWeather(w);}).catch(()=>{});
    };
    const id=setInterval(poll,refreshMs);
    return()=>clearInterval(id);
  },[loading,auth,kiosk,refreshMs]);

  if(!authChecked) return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:A.systemBg}}>
      <div style={{width:36,height:36,border:`3px solid ${A.sep}`,borderTop:`3px solid ${A.blue}`,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
    </div>
  );
  if(!auth&&!kiosk) return <LoginOverlay onLogin={handleLogin} onKiosk={handleKiosk}/>;
  if((auth||kiosk)&&wizardDone===null) return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:A.systemBg}}>
      <div style={{width:36,height:36,border:`3px solid ${A.sep}`,borderTop:`3px solid ${A.blue}`,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
    </div>
  );
  if(auth&&wizardDone===false) return <SetupWizard onComplete={()=>setWizardDone(true)}/>;
  if(loading) return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:A.systemBg,flexDirection:'column',gap:16}}>
      <div style={{width:36,height:36,border:`3px solid ${A.sep}`,borderTop:`3px solid ${A.blue}`,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
      <div style={{fontSize:15,color:A.label4,fontWeight:500}}>Loading Kith…</div>
    </div>
  );

  return mode==='display'
    ?<DisplayMode onManage={()=>setMode('manage')} events={events} chores={chores} setChores={setChores} meals={meals} grocery={grocery} countdowns={countdowns} clockFormat={clockFormat} weather={weather} nightModeStart={nightModeStart} nightModeEnd={nightModeEnd} goals={goals} notes={notes} polls={polls} rotationMs={rotationMs} wifiQrData={wifiQrData}/>
    :<ManageMode onDisplay={()=>setMode('display')} onLogout={handleLogout} events={events} setEvents={setEvents} chores={chores} setChores={setChores} grocery={grocery} setGrocery={setGrocery} meals={meals} setMeals={setMeals} icsSources={icsSources} setIcsSources={setIcsSources} inboxCount={inboxCount} setInboxCount={setInboxCount} countdowns={countdowns} setCountdowns={setCountdowns} members={members} setMembers={setMembers} photos={photos} setPhotos={setPhotos} clockFormat={clockFormat} setClockFormat={setClockFormat} weather={weather} nightModeStart={nightModeStart} setNightModeStart={setNightModeStart} nightModeEnd={nightModeEnd} setNightModeEnd={setNightModeEnd} setRefreshMs={setRefreshMs} parseRefreshMs={parseRefreshMs} goals={goals} setGoals={setGoals} notes={notes} setNotes={setNotes} polls={polls} setPolls={setPolls} bookmarks={bookmarks} setBookmarks={setBookmarks} quickActions={quickActions} setQuickActions={setQuickActions} setRotationMs={setRotationMs} setWifiQrData={setWifiQrData}/>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
