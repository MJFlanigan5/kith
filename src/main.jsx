import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ReactDOM from 'react-dom/client'


/* ── Design tokens — neutral values reference CSS vars, accents stay hardcoded ── */
const A={
  systemBg:'var(--k-sysBg)',
  cardBg:'var(--k-cardBg)',
  inputBg:'var(--k-inputBg)',
  label1:'var(--k-l1)',label2:'var(--k-l2)',label3:'var(--k-l3)',label4:'var(--k-l4)',label5:'var(--k-l5)',
  blue:'#007AFF',green:'#34C759',amber:'#FF9500',red:'#FF3B30',indigo:'#5856D6',teal:'#32ADE6',purple:'#AF52DE',
  blueFill:'var(--k-blueFill)',greenFill:'var(--k-greenFill)',amberFill:'var(--k-amberFill)',redFill:'var(--k-redFill)',
  sep:'var(--k-sep)',sepOpaque:'var(--k-sepO)',
  shadowSm:'var(--k-sh1)',shadowMd:'var(--k-sh2)',shadowLg:'var(--k-sh3)',
  r:'14px',rSm:'10px',rXs:'7px',rPill:'999px',
  glass:'var(--k-cardBg)',glassFilter:'none',
  chrome:'var(--k-chrome)',
};

const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ── Local date helper — avoids UTC-vs-local timezone flip ───────────── */
function localDate(d=new Date()){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function ordinal(n){const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);}

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
        <div key={t.id} style={{background:'rgba(28,28,30,0.92)',backdropFilter:'blur(20px)',color:'#F5F5F7',border:'1px solid rgba(255,255,255,0.10)',padding:'12px 18px',borderRadius:13,fontSize:14,fontWeight:500,boxShadow:A.shadowLg,animation:'toastIn .22s cubic-bezier(.4,0,.2,1)',display:'flex',alignItems:'center',gap:10,minWidth:200}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:tint[t.type]||A.green,flexShrink:0}}/>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

function Drawer({open,onClose,title,children,width=440}){
  const isMobile=useIsMobile();
  const effectiveWidth=isMobile?'100%':width;
  const translateOut=isMobile?'translateY(100%)':`translateX(${width+20}px)`;
  return(
    <>
      {open&&<div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.18)',zIndex:100,animation:'fadeIn .15s'}}/>}
      <div style={{position:'fixed',top:isMobile?'auto':0,bottom:isMobile?0:'auto',right:0,height:isMobile?'92%':'100%',width:effectiveWidth,background:A.cardBg,zIndex:101,borderRadius:isMobile?'20px 20px 0 0':'0',transform:open?'translate(0,0)':translateOut,transition:'transform .32s cubic-bezier(.4,0,.2,1)',display:'flex',flexDirection:'column',boxShadow:open?'0 -2px 40px rgba(0,0,0,0.12)':'none'}}>
        {isMobile&&<div style={{width:36,height:4,borderRadius:2,background:A.sep,margin:'12px auto 0',flexShrink:0}}/>}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:isMobile?'14px 20px 12px':'20px 24px 16px',borderBottom:`1px solid ${A.sep}`}}>
          <span style={{fontSize:17,fontWeight:600,letterSpacing:'-.01em'}}>{title}</span>
          <button onClick={onClose} style={{width:28,height:28,borderRadius:'50%',background:A.inputBg,border:'none',cursor:'pointer',fontSize:16,color:A.label3,display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:isMobile?'16px 20px':'20px 24px',paddingBottom:`calc(${isMobile?'24px':'20px'} + env(safe-area-inset-bottom))`}}>{children}</div>
      </div>
    </>
  );
}

function Modal({open,onClose,title,children,width=660}){
  if(!open) return null;
  return(
    <>
      <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.24)',zIndex:200,animation:'fadeIn .15s'}}/>
      <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:A.cardBg,borderRadius:A.r,border:`1px solid ${A.sep}`,zIndex:201,width,maxWidth:'94vw',maxHeight:'88vh',display:'flex',flexDirection:'column',boxShadow:A.shadowLg,animation:'slideUp .2s cubic-bezier(.4,0,.2,1)'}}>
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
      <div style={{background:A.cardBg,borderRadius:A.r,overflow:'hidden',boxShadow:A.shadowSm,border:`1px solid ${A.sep}`}}>
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
      style={{width:'100%',background:focus?A.cardBg:A.inputBg,border:`1.5px solid ${focus?A.blue:A.sep}`,borderRadius:A.rXs,color:A.label1,padding:'9px 12px',fontSize:15,outline:'none',transition:'background .15s,border-color .15s',opacity:disabled?.5:1,...s}}/>
  );
}

function Sel({value,onChange,children}){
  return(
    <select value={value} onChange={onChange} style={{background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:A.rXs,color:A.label1,padding:'9px 12px',fontSize:15,outline:'none',cursor:'pointer',width:'100%'}}>{children}</select>
  );
}

function SegControl({value,onChange,options}){
  return(
    <div style={{display:'flex',background:A.inputBg,borderRadius:A.rXs,padding:2,gap:1}}>
      {options.map(o=>(
        <button key={o} onClick={()=>onChange(o)} style={{padding:'6px 14px',border:'none',borderRadius:7,background:value===o?A.cardBg:'transparent',color:value===o?A.label1:A.label3,fontSize:13,fontWeight:value===o?600:400,cursor:'pointer',boxShadow:value===o?A.shadowSm:'none',transition:'all .15s'}}>{o}</button>
      ))}
    </div>
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
  return <div style={{background:A.cardBg,borderRadius:A.r,boxShadow:A.shadowSm,border:`1px solid ${A.sep}`,...s}}>{children}</div>;
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
  const [editId,setEditId]=useState(null);
  const [editForm,setEditForm]=useState({label:'',date:'',emoji:'🎉'});
  const EMOJIS=['🎉','🎂','✈️','🏫','🏖️','🎄','🎃','💍','🏆','⭐'];
  const save=async()=>{
    if(!form.label.trim()){toastAdd('Label required','red');return;}
    if(!form.date){toastAdd('Date required','red');return;}
    const r=await api.post('/api/countdowns',form);
    if(!r?.id){toastAdd('Failed to add','red');return;}
    setCountdowns(p=>[...p,r].sort((a,b)=>a.date.localeCompare(b.date)));
    setForm({label:'',date:'',emoji:'🎉'});
    toastAdd('Countdown added');
  };
  const saveEdit=async()=>{
    if(!editForm.label.trim()){toastAdd('Label required','red');return;}
    if(!editForm.date){toastAdd('Date required','red');return;}
    const r=await api.put(`/api/countdowns/${editId}`,editForm);
    if(!r?.id){toastAdd('Failed to update','red');return;}
    setCountdowns(p=>p.map(c=>c.id===editId?r:c).sort((a,b)=>a.date.localeCompare(b.date)));
    setEditId(null);
    toastAdd('Updated');
  };
  const del=async id=>{
    try{
      const r=await api.del(`/api/countdowns/${id}`);
      if(r?.error){toastAdd('Failed to delete','red');return;}
      setCountdowns(p=>p.filter(c=>c.id!==id));
      toastAdd('Deleted','blue');
    }catch{toastAdd('Failed to delete','red');}
  };
  const clearPast=async()=>{
    const past=countdowns.filter(c=>daysUntil(c.date)<0);
    try{
      await Promise.all(past.map(c=>api.del(`/api/countdowns/${c.id}`)));
      setCountdowns(p=>p.filter(c=>daysUntil(c.date)>=0));
      toastAdd(`Cleared ${past.length}`,'blue');
    }catch{toastAdd('Failed to clear','red');}
  };
  return(
    <div style={{maxWidth:640}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:28,fontWeight:800,letterSpacing:'-.04em'}}>Countdowns</h1>
          <p style={{color:A.label4,fontSize:15,marginTop:4}}>Track days until special events</p>
        </div>
        {countdowns.some(c=>daysUntil(c.date)<0)&&(
          <button onClick={clearPast} style={{background:'none',border:'none',color:A.label4,fontSize:14,cursor:'pointer',marginTop:4}}>Clear past</button>
        )}
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
          const isEditing=editId===c.id;
          return(
            <Card key={c.id} style={{padding:'18px 20px'}}>
              {isEditing?(
                <div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
                    {EMOJIS.map(e=>(
                      <button key={e} onClick={()=>setEditForm(p=>({...p,emoji:e}))} style={{width:34,height:34,borderRadius:A.rXs,border:`2px solid ${editForm.emoji===e?A.blue:'transparent'}`,background:editForm.emoji===e?A.blueFill:'transparent',cursor:'pointer',fontSize:20}}>{e}</button>
                    ))}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <Inp value={editForm.label} onChange={e=>setEditForm(p=>({...p,label:e.target.value}))} placeholder="Label"/>
                    <Inp type="date" value={editForm.date} onChange={e=>setEditForm(p=>({...p,date:e.target.value}))}/>
                    <div style={{display:'flex',gap:8}}>
                      <Btn onClick={saveEdit} full>Save</Btn>
                      <Btn variant="ghost" onClick={()=>setEditId(null)} full>Cancel</Btn>
                    </div>
                  </div>
                </div>
              ):(
                <div style={{display:'flex',alignItems:'center',gap:16}}>
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
                  <button onClick={()=>{setEditId(c.id);setEditForm({label:c.label,date:c.date,emoji:c.emoji});}} style={{background:'none',border:'none',color:A.blue,cursor:'pointer',fontSize:13,fontWeight:500,padding:'4px'}}>Edit</button>
                  <button onClick={()=>del(c.id)} style={{background:'none',border:'none',color:A.label5,cursor:'pointer',fontSize:20,padding:'4px',lineHeight:1}}>×</button>
                </div>
              )}
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
  const [editId,setEditId]=useState(null);
  const [editForm,setEditForm]=useState({name:'',color:'#007AFF',birthday:'',family_role:'adult'});
  const [health,setHealth]=useState({});
  const [healthEdit,setHealthEdit]=useState(null);
  const blankHealth={blood_type:'',allergies:'',medications:'',conditions:'',doctor_name:'',doctor_phone:'',insurance_provider:'',insurance_id:'',notes:''};
  const [healthForm,setHealthForm]=useState(blankHealth);
  const [healthSaving,setHealthSaving]=useState(false);
  const BLOOD_TYPES=['','A+','A-','B+','B-','AB+','AB-','O+','O-'];
  const openHealth=async(m)=>{
    let rec=health[m.id];
    if(!rec){
      rec=await api.get(`/api/members/${m.id}/health`).catch(()=>({}));
      setHealth(h=>({...h,[m.id]:rec||{}}));
    }
    const r=rec||{};
    setHealthForm({
      blood_type:r.blood_type||'',allergies:r.allergies||'',medications:r.medications||'',conditions:r.conditions||'',
      doctor_name:r.doctor_name||'',doctor_phone:r.doctor_phone||'',insurance_provider:r.insurance_provider||'',
      insurance_id:r.insurance_id||'',notes:r.notes||''
    });
    setHealthEdit(m.id);
  };
  const saveHealth=async()=>{
    if(!healthEdit) return;
    setHealthSaving(true);
    const r=await api.put(`/api/members/${healthEdit}/health`,healthForm).catch(()=>null);
    setHealthSaving(false);
    if(!r){toastAdd('Failed to save','red');return;}
    setHealth(h=>({...h,[healthEdit]:r}));
    setHealthEdit(null);
    toastAdd('Health info saved');
  };
  useEffect(()=>{
    if(!members?.length) return;
    Promise.all(members.map(m=>api.get(`/api/members/${m.id}/health`).then(r=>[m.id,r||{}]).catch(()=>[m.id,{}])))
      .then(pairs=>{
        const map={};
        for(const [id,rec] of pairs) if(rec&&rec.member_id) map[id]=rec;
        setHealth(map);
      });
  },[members?.length]);
  const COLORS=['#007AFF','#34C759','#FF3B30','#FF9500','#5856D6','#32ADE6','#AF52DE','#FF2D55','#FF6B35','#30D158'];
  const save=async()=>{
    if(!form.name.trim()){toastAdd('Name required','red');return;}
    const r=await api.post('/api/members',form);
    if(!r?.id){toastAdd('Failed to add','red');return;}
    setMembers(p=>[...p,r]);
    setForm({name:'',color:'#007AFF'});
    toastAdd('Member added');
  };
  const saveEdit=async()=>{
    if(!editForm.name.trim()){toastAdd('Name required','red');return;}
    const r=await api.put(`/api/members/${editId}`,{name:editForm.name,color:editForm.color,birthday:editForm.birthday||'',family_role:editForm.family_role||'adult'});
    if(!r?.id){toastAdd('Failed to update','red');return;}
    setMembers(p=>p.map(m=>m.id===editId?r:m));
    setEditId(null);
    toastAdd('Updated');
  };
  const del=async id=>{
    try{
      const r=await api.del(`/api/members/${id}`);
      if(r?.error){toastAdd('Failed to remove','red');return;}
      setMembers(p=>p.filter(m=>m.id!==id));
      toastAdd('Removed','blue');
    }catch{toastAdd('Failed to remove','red');}
  };
  const savePin=async()=>{
    if(!String(pinInput||'').match(/^\d{4,8}$/)){toastAdd('PIN must be 4–8 digits','red');return;}
    try{
      const r=await api.put(`/api/members/${pinModal}/pin`,{pin:String(pinInput)});
      if(r?.error){toastAdd(r.error,'red');return;}
      setPinModal(null);setPinInput('');
      toastAdd('PIN updated');
    }catch{toastAdd('Failed to save PIN','red');}
  };
  const saveGoal=async()=>{
    const goal=Number(goalForm.monthly_goal)||0;
    try{
      const r=await api.put(`/api/members/${goalId}/goal`,{monthly_goal:goal,reward:goalForm.reward});
      if(r?.error){toastAdd(r.error,'red');return;}
      setMembers(p=>p.map(m=>m.id===goalId?{...m,monthly_goal:goal,reward:goalForm.reward}:m));
      setGoalId(null);
      toastAdd('Goal saved');
    }catch{toastAdd('Failed to save goal','red');}
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
              <button key={c} onClick={()=>setForm(p=>({...p,color:c}))} style={{width:30,height:30,borderRadius:'50%',border:`3px solid ${form.color===c?A.label1:'transparent'}`,background:c,cursor:'pointer'}}/>
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
                  <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                    <span style={{fontSize:15,fontWeight:500,color:A.label1}}>{m.name}</span>
                    {health[m.id]?.blood_type&&<span style={{fontSize:11,fontWeight:700,color:A.red,background:A.redFill,padding:'1px 6px',borderRadius:A.rPill}}>{health[m.id].blood_type}</span>}
                    {health[m.id]?.allergies&&<span style={{fontSize:11,fontWeight:700,color:A.amber,background:A.amberFill,padding:'1px 6px',borderRadius:A.rPill}}>⚠ Allergies</span>}
                  </div>
                  {m.monthly_goal>0&&<div style={{fontSize:12,color:A.label4,marginTop:2}}>{m.monthly_goal} pt goal{m.reward?` · ${m.reward}`:''}</div>}
                  {m.birthday&&<div style={{fontSize:12,color:A.label5,marginTop:1}}>{new Date(m.birthday+'T12:00:00').toLocaleDateString(undefined,{month:'long',day:'numeric'})}</div>}
                </div>
                <button onClick={()=>{setEditId(editId===m.id?null:m.id);setEditForm({name:m.name,color:m.color,birthday:m.birthday||'',family_role:m.family_role||'adult'});}} style={{background:'none',border:'none',color:A.blue,fontSize:13,cursor:'pointer',fontWeight:500}}>
                  {editId===m.id?'Cancel':'Edit'}
                </button>
                <button onClick={()=>{setGoalId(goalId===m.id?null:m.id);setGoalForm({monthly_goal:m.monthly_goal||'',reward:m.reward||''});}} style={{background:'none',border:'none',color:A.blue,fontSize:13,cursor:'pointer',fontWeight:500}}>
                  {goalId===m.id?'Cancel':'Set Goal'}
                </button>
                <button onClick={()=>openHealth(m)} style={{background:'none',border:'none',color:A.blue,fontSize:13,cursor:'pointer',fontWeight:500}}>Health</button>
                <button onClick={()=>{setPinModal(m.id);setPinInput('');}} style={{background:'none',border:'none',color:A.blue,fontSize:13,cursor:'pointer',fontWeight:500}}>PIN</button>
                <button onClick={()=>del(m.id)} style={{background:'none',border:'none',color:A.label4,fontSize:13,cursor:'pointer',fontWeight:500}}>Remove</button>
              </div>
              {editId===m.id&&(
                <div style={{padding:'0 16px 14px'}}>
                  <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
                    {COLORS.map(c=>(
                      <button key={c} onClick={()=>setEditForm(p=>({...p,color:c}))} style={{width:26,height:26,borderRadius:'50%',border:`3px solid ${editForm.color===c?A.label1:'transparent'}`,background:c,cursor:'pointer'}}/>
                    ))}
                  </div>
                  <div style={{display:'flex',gap:8,marginBottom:8}}>
                    <Inp value={editForm.name} onChange={e=>setEditForm(p=>({...p,name:e.target.value}))} placeholder="Name"/>
                    <Btn sm onClick={saveEdit}>Save</Btn>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}>
                    <div style={{fontSize:12,color:A.label4,flexShrink:0}}>Birthday</div>
                    <Inp type="date" value={editForm.birthday||''} onChange={e=>setEditForm(p=>({...p,birthday:e.target.value}))} style={{flex:1}}/>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}>
                    <div style={{fontSize:12,color:A.label4,flexShrink:0}}>Role</div>
                    <select value={editForm.family_role||'adult'} onChange={e=>setEditForm(p=>({...p,family_role:e.target.value}))} style={{flex:1,padding:'8px 10px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:14,color:A.label1}}>
                      <option value="adult">Adult</option>
                      <option value="kid">Kid</option>
                    </select>
                  </div>
                </div>
              )}
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
      <Drawer open={healthEdit!==null} onClose={()=>setHealthEdit(null)} title={`Health — ${members.find(m=>m.id===healthEdit)?.name||''}`}>
        <FormGroup label="Blood type">
          <div style={{padding:'12px 16px'}}>
            <select value={healthForm.blood_type} onChange={e=>setHealthForm(f=>({...f,blood_type:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              {BLOOD_TYPES.map(b=><option key={b||'none'} value={b}>{b||'—'}</option>)}
            </select>
          </div>
        </FormGroup>
        <FormGroup label="Allergies">
          <div style={{padding:'12px 16px'}}><textarea value={healthForm.allergies} onChange={e=>setHealthForm(f=>({...f,allergies:e.target.value}))} placeholder="Penicillin, peanuts, etc." style={{width:'100%',minHeight:60,padding:'9px 12px',background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:A.rXs,fontSize:15,color:A.label1,fontFamily:'inherit',resize:'vertical',outline:'none'}}/></div>
        </FormGroup>
        <FormGroup label="Medications">
          <div style={{padding:'12px 16px'}}><textarea value={healthForm.medications} onChange={e=>setHealthForm(f=>({...f,medications:e.target.value}))} placeholder="Daily medications and dosages" style={{width:'100%',minHeight:60,padding:'9px 12px',background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:A.rXs,fontSize:15,color:A.label1,fontFamily:'inherit',resize:'vertical',outline:'none'}}/></div>
        </FormGroup>
        <FormGroup label="Conditions">
          <div style={{padding:'12px 16px'}}><textarea value={healthForm.conditions} onChange={e=>setHealthForm(f=>({...f,conditions:e.target.value}))} placeholder="Asthma, diabetes, etc." style={{width:'100%',minHeight:60,padding:'9px 12px',background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:A.rXs,fontSize:15,color:A.label1,fontFamily:'inherit',resize:'vertical',outline:'none'}}/></div>
        </FormGroup>
        <FormGroup label="Primary doctor">
          <div style={{padding:'12px 16px'}}><Inp value={healthForm.doctor_name} onChange={e=>setHealthForm(f=>({...f,doctor_name:e.target.value}))} placeholder="Dr. Smith"/></div>
        </FormGroup>
        <FormGroup label="Doctor phone">
          <div style={{padding:'12px 16px'}}><Inp type="tel" value={healthForm.doctor_phone} onChange={e=>setHealthForm(f=>({...f,doctor_phone:e.target.value}))} placeholder="(404) 555-0100"/></div>
        </FormGroup>
        <FormGroup label="Insurance provider">
          <div style={{padding:'12px 16px'}}><Inp value={healthForm.insurance_provider} onChange={e=>setHealthForm(f=>({...f,insurance_provider:e.target.value}))} placeholder="Blue Cross"/></div>
        </FormGroup>
        <FormGroup label="Insurance ID / member #">
          <div style={{padding:'12px 16px'}}><Inp value={healthForm.insurance_id} onChange={e=>setHealthForm(f=>({...f,insurance_id:e.target.value}))} placeholder="XJK123456789"/></div>
        </FormGroup>
        <FormGroup label="Notes">
          <div style={{padding:'12px 16px'}}><textarea value={healthForm.notes} onChange={e=>setHealthForm(f=>({...f,notes:e.target.value}))} placeholder="Anything else worth knowing in an emergency" style={{width:'100%',minHeight:60,padding:'9px 12px',background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:A.rXs,fontSize:15,color:A.label1,fontFamily:'inherit',resize:'vertical',outline:'none'}}/></div>
        </FormGroup>
        <Btn onClick={saveHealth} full>{healthSaving?'Saving…':'Save'}</Btn>
      </Drawer>
    </div>
  );
}

/* ── Presence overlay progress bar ───────────────────────────────────── */
function PresenceBar({duration,color}){
  const [w,setW]=useState(100);
  useEffect(()=>{const t=setTimeout(()=>setW(0),40);return()=>clearTimeout(t);},[]);
  return(
    <div style={{height:4,background:`${color}25`,borderRadius:2,marginTop:28,overflow:'hidden'}}>
      <div style={{height:'100%',width:`${w}%`,background:color,borderRadius:2,transition:`width ${duration/1000}s linear`}}/>
    </div>
  );
}

/* ── Display Mode ────────────────────────────────────────────────────── */
function DisplayMode({onManage,events,chores,setChores,meals,grocery,setGrocery,countdowns,photos=[],weather,clockFormat='12h',nightModeStart='23:00',nightModeEnd='06:00',goals=[],notes=[],polls=[],rotationMs=10000,wifiQrData=null,quickActions=[],members=[],packages=[],setPackages,messages=[],setMessages,appliances=[],consumables=[],maintenanceItems=[],pets=[],subscriptions=[],pantry=[],projects=[]}){
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

  const [dispEmergency,setDispEmergency]=useState({});
  useEffect(()=>{
    api.get('/api/emergency').then(d=>{if(d&&typeof d==='object'&&!d.error) setDispEmergency(d);}).catch(()=>{});
  },[]);
  const emergencyHasValue=useMemo(()=>Object.values(dispEmergency||{}).some(v=>v&&String(v).trim()!==''),[dispEmergency]);
  const EMERGENCY_LABELS={
    gas_shutoff:'Gas shut-off',water_shutoff:'Water shut-off',electric_shutoff:'Electric panel',
    insurance_company:'Insurance',policy_number:'Policy #',insurance_phone:'Insurance phone',
    doctor_name:'Doctor',doctor_phone:'Doctor phone',medical_notes:'Medical notes',extra_notes:'Notes'
  };

  const [livePollVotes,setLivePollVotes]=useState({});
  useEffect(()=>{
    const load=()=>api.get('/api/polls').then(d=>{
      if(Array.isArray(d)&&d.length) setLivePollVotes(d[0].votes||{});
    }).catch(()=>{});
    load();
    const id=setInterval(load,30000);
    return()=>clearInterval(id);
  },[]);

  // Keep a ref to members so the SSE arrival closure always sees current data
  const membersRef=useRef(members);
  useEffect(()=>{membersRef.current=members;},[members]);
  const [haEvents,setHaEvents]=useState([]);
  const [smEvents,setSmEvents]=useState([]);
  const [widgetData,setWidgetData]=useState({});
  const [online,setOnline]=useState(true);
  useEffect(()=>{
    const loadHA=()=>api.get('/api/ha/events').then(d=>{if(Array.isArray(d))setHaEvents(d);}).catch(()=>{});
    const loadSm=()=>fetch('/api/ha/pull').then(r=>r.json()).then(d=>{if(Array.isArray(d))setSmEvents(d);}).catch(()=>{});
    const loadWidgets=()=>api.get('/api/widgets/data').then(d=>setWidgetData(d||{})).catch(()=>{});
    loadHA(); loadSm(); loadWidgets();
    // Fallback polls in case SSE drops
    const fa=setInterval(loadHA,60000);
    const fb=setInterval(loadSm,60000);
    const fc=setInterval(loadWidgets,3*60*1000);
    // Single SSE connection handles activity push + widget/smart-home refresh
    const es=new EventSource('/api/events/stream');
    es.addEventListener('activity',e=>{try{const ev=JSON.parse(e.data);setSmEvents(p=>[ev,...p].slice(0,10));}catch{}});
    es.addEventListener('refresh',()=>{loadHA();loadSm();loadWidgets();});
    es.addEventListener('arrival',e=>{
      try{
        const d=JSON.parse(e.data);
        // Discard if the event is more than 10 minutes old — SSE was down when arrival happened
        if(d.ts&&Date.now()-d.ts>10*60*1000) return;
        const first=(d.name||'').toLowerCase();
        const m=membersRef.current.find(x=>x.name.toLowerCase()===first||x.name.toLowerCase().startsWith(first+' '));
        const color=m?.color||'#34C759';
        setPresenceOverlay({type:'arrival',name:d.name,entity_id:d.entity_id,color,ts:Date.now()});
        if(presenceTimerRef.current)clearTimeout(presenceTimerRef.current);
        presenceTimerRef.current=setTimeout(()=>setPresenceOverlay(null),60000);
      }catch{}
    });
    es.addEventListener('grocery',e=>{try{const d=JSON.parse(e.data);if(setGrocery){if(d.action==='add')setGrocery(p=>[...p,d.item]);else if(d.action==='remove')setGrocery(p=>p.filter(i=>i.id!==d.id));else if(d.action==='toggle')setGrocery(p=>p.map(i=>i.id===d.id?{...i,checked:d.checked}:i));else if(d.action==='clear_checked')setGrocery(p=>p.filter(i=>!i.checked));}}catch{}});
    es.addEventListener('packages',()=>{
      api.get('/api/packages').then(d=>{if(Array.isArray(d)&&setPackages)setPackages(d);}).catch(()=>{});
    });
    es.addEventListener('messages',()=>{api.get('/api/messages').then(d=>{if(Array.isArray(d)&&setMessages)setMessages(d);}).catch(()=>{});});
    // bills/vehicles/inbox state lives in App — DisplayMode gets those as props, no setters available here
    es.addEventListener('open',()=>{setOnline(true);loadWidgets();});
    es.addEventListener('error',()=>setOnline(false));
    return()=>{clearInterval(fa);clearInterval(fb);clearInterval(fc);es.close();};
  },[]);
  const allSmartEvents=useMemo(()=>[...smEvents,...haEvents].sort((a,b)=>new Date(b.created_at?.replace(' ','T'))-new Date(a.created_at?.replace(' ','T'))).slice(0,10),[smEvents,haEvents]);
  const [nowPlaying,setNowPlaying]=useState({playing:false});
  const [qaState,setQaState]=useState({});
  useEffect(()=>{
    const load=()=>api.get('/api/music/now-playing').then(d=>setNowPlaying(d||{playing:false})).catch(()=>{});
    load();
    const id=setInterval(load,8000);
    return()=>clearInterval(id);
  },[]);

  // Presence overlay — fires when who_home state changes
  const [presenceOverlay,setPresenceOverlay]=useState(null);
  const presenceTimerRef=useRef(null);
  const prevPersonsRef=useRef(null);
  useEffect(()=>{
    const persons=widgetData.who_home?.persons;
    if(!persons)return;
    if(prevPersonsRef.current===null){prevPersonsRef.current=persons;return;}
    const prevMap=Object.fromEntries(prevPersonsRef.current.map(p=>[p.entity_id,p.state]));
    let ev=null;
    for(const p of persons){
      const prev=prevMap[p.entity_id]||'unknown';
      if(prev!=='home'&&p.state==='home'){ev={type:'arrival',name:p.name.split(' ')[0],entity_id:p.entity_id};break;}
      if(prev==='home'&&p.state!=='home'){ev={type:'departure',name:p.name.split(' ')[0],entity_id:p.entity_id};break;}
    }
    prevPersonsRef.current=persons;
    if(!ev)return;
    const first=ev.name.toLowerCase();
    const m=membersRef.current.find(x=>x.name.toLowerCase()===first||x.name.toLowerCase().startsWith(first+' '));
    const color=m?.color||(ev.type==='arrival'?'#34C759':'#8E8E93');
    if(presenceTimerRef.current)clearTimeout(presenceTimerRef.current);
    setPresenceOverlay({...ev,color,ts:Date.now()});
    presenceTimerRef.current=setTimeout(()=>setPresenceOverlay(null),60000);
  },[widgetData.who_home]);
  useEffect(()=>()=>{if(presenceTimerRef.current)clearTimeout(presenceTimerRef.current);},[]);

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
  const [visiblePanelId,setVisiblePanelId]=useState('dinner');
  const [panelOpacity,setPanelOpacity]=useState(1);
  const panelFirstRender=useRef(true);
  useEffect(()=>{
    let id;
    const start=()=>{id=setInterval(()=>setCenterIdx(i=>i+1),rotationMs);};
    const stop=()=>clearInterval(id);
    const onVis=()=>{stop();if(document.visibilityState!=='hidden')start();};
    start();
    document.addEventListener('visibilitychange',onVis);
    return()=>{stop();document.removeEventListener('visibilitychange',onVis);};
  },[rotationMs]);
  const [plexIdx,setPlexIdx]=useState(0);
  useEffect(()=>{
    setPlexIdx(0);
    const items=widgetData?.plex?.items||[];
    if(items.length<=1) return;
    const id=setInterval(()=>setPlexIdx(i=>(i+1)%items.length),6000);
    return()=>clearInterval(id);
  },[widgetData?.plex?.items?.length, widgetData?.plex?.type]);
  const [showControls,setShowControls]=useState(false);
  const hideTimer=useRef(null);
  useEffect(()=>{
    const show=()=>{setShowControls(true);clearTimeout(hideTimer.current);hideTimer.current=setTimeout(()=>setShowControls(false),3000);};
    window.addEventListener('mousemove',show);
    window.addEventListener('touchstart',show);
    return()=>{window.removeEventListener('mousemove',show);window.removeEventListener('touchstart',show);clearTimeout(hideTimer.current);};
  },[]);
  const calScrollRef=useRef(null);
  const _calScroll=useRef({timer:null,pauseT:null,unPauseT:null,pausing:false});
  useEffect(()=>{
    const el=calScrollRef.current;
    const s=_calScroll.current;
    clearInterval(s.timer);clearTimeout(s.pauseT);clearTimeout(s.unPauseT);
    s.pausing=false;
    if(!el) return;
    el.scrollTop=0;
    const t=setTimeout(()=>{
      if(el.scrollHeight<=el.clientHeight+20) return;
      s.timer=setInterval(()=>{
        if(s.pausing) return;
        el.scrollTop+=0.4;
        if(el.scrollTop+el.clientHeight>=el.scrollHeight-4){
          s.pausing=true;
          s.pauseT=setTimeout(()=>{
            el.scrollTop=0;
            s.unPauseT=setTimeout(()=>{s.pausing=false;},1500);
          },3000);
        }
      },16);
    },200);
    return()=>{clearTimeout(t);clearInterval(s.timer);clearTimeout(s.pauseT);clearTimeout(s.unPauseT);};
  },[events]);
  const h12=now.getHours()%12||12;
  const min=String(now.getMinutes()).padStart(2,'0');
  const ampm=now.getHours()>=12?'PM':'AM';
  const dateStr=`${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;

  // Photo frame — cycles every 12s when photos are present
  const [photoIdx,setPhotoIdx]=useState(0);
  useEffect(()=>{
    if(photos.length<=1){setPhotoIdx(0);return;}
    const id=setInterval(()=>setPhotoIdx(i=>(i+1)%photos.length),12000);
    return()=>clearInterval(id);
  },[photos.length]);

  // Countdown overlay — fires once per countdown per day when it hits today
  const [countdownOverlay,setCountdownOverlay]=useState(null);
  const cdTimerRef=useRef(null);
  useEffect(()=>{
    const today=(countdowns||[]).find(c=>daysUntil(c.date)===0);
    if(!today) return;
    const key=`kith_cd_${today.id}_${localDate()}`;
    if(localStorage.getItem(key)) return;
    localStorage.setItem(key,'1');
    if(cdTimerRef.current) clearTimeout(cdTimerRef.current);
    setCountdownOverlay(today);
    cdTimerRef.current=setTimeout(()=>setCountdownOverlay(null),30000);
  },[countdowns]);
  useEffect(()=>()=>{if(cdTimerRef.current)clearTimeout(cdTimerRef.current);},[]);

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
  const agendaDays=[0,1,2,3,4,5,6].map(offset=>{
    const d=new Date(); d.setDate(d.getDate()+offset);
    const label=offset===0?'Today':offset===1?'Tomorrow':DAYS[d.getDay()];
    return{label,date:localDate(d)};
  });
  const displayEvents=(events||[]).filter(e=>e.source!=='bill'&&e.source!=='vehicle');
  const hasUpcomingEvents=agendaDays.some(({date})=>displayEvents.some(e=>e.date===date));
  const dueSoonVehicles=(events||[]).filter(e=>e.source==='vehicle'&&daysUntil(e.date)<=14).sort((a,b)=>a.date.localeCompare(b.date));
  const dueC=chores.filter(c=>(c.status==='due'||c.status==='overdue')&&!c.done);
  const upCD=(countdowns||[]).filter(c=>daysUntil(c.date)>=0);
  const uncheckedGrocery=(grocery||[]).filter(i=>!i.checked);
  const progressMembers=memberProgress.filter(m=>m.monthly_goal>0);
  const pinnedNotes=useMemo(()=>(notes||[]).filter(n=>n.pinned),[notes]);
  const expiringAppliances=useMemo(()=>(appliances||[]).filter(a=>a.warranty_date&&daysUntil(a.warranty_date)<=30).sort((a,b)=>a.warranty_date.localeCompare(b.warranty_date)),[appliances]);
  const urgentConsumables=useMemo(()=>(consumables||[]).filter(c=>c.status==='overdue'||c.status==='due_soon').sort((a,b)=>(a.days_remaining??Infinity)-(b.days_remaining??Infinity)),[consumables]);
  const urgentMaintenance=useMemo(()=>(maintenanceItems||[]).filter(m=>m.status==='overdue'||m.status==='due_this_month'),[maintenanceItems]);
  const urgentPetRecords=useMemo(()=>(pets||[]).flatMap(p=>(p.records||[]).filter(r=>r.status==='overdue'||(r.status==='due_soon'&&r.days_remaining<=14)).map(r=>({...r,pet_name:p.name,pet_color:p.color||'#FF9500'}))).sort((a,b)=>(a.days_remaining??Infinity)-(b.days_remaining??Infinity)),[pets]);
  const monthlySubTotal=(subscriptions||[]).filter(s=>s.active).reduce((sum,s)=>{
    const a=Number(s.amount)||0;
    if(s.billing_cycle==='annual') return sum+a/12;
    if(s.billing_cycle==='weekly') return sum+a*52/12;
    if(s.billing_cycle==='quarterly') return sum+a/3;
    return sum+a;
  },0);
  const activeSubCount=(subscriptions||[]).filter(s=>s.active).length;
  const lowPantryItems=(pantry||[]).filter(p=>p.expiry_status==='expired'||p.expiry_status==='expiring_soon'||(p.low_stock_at>0&&Number(p.quantity)<=Number(p.low_stock_at)));
  const inProgressProjects=(projects||[]).filter(p=>p.status==='in_progress');
  const centerPanels=[
    'dinner',
    ...(dueC.length>0?['chores']:[]),
    ...(dueSoonVehicles.length>0?['due_soon']:[]),
    ...(upCD.length>0?['countdowns']:[]),
    ...(goals.length>0?['goals']:[]),
    ...(progressMembers.length>0?['members']:[]),
    ...(widgetData.wotd?['w_wotd']:[]),
    ...(widgetData.sun?['w_sun']:[]),
    ...(widgetData.compliment?['w_compliment']:[]),
    ...(widgetData.quote?.text?['w_quote']:[]),
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
    ...(widgetData.who_home?['w_who_home']:[]),
    ...(widgetData.thermostat?['w_thermostat']:[]),
    ...(widgetData.ha_sensors?['w_ha_sensors']:[]),
    ...(allSmartEvents.length>0?['w_notifications']:[]),
    ...(polls.length>0?['w_polls']:[]),
    ...(uncheckedGrocery.length>0?['w_grocery']:[]),
    ...(photos.length>0?['w_photos']:[]),
    ...(packages.length>0?['w_packages']:[]),
    ...(messages.some(m=>m.expires_at&&new Date(m.expires_at.replace(' ','T')+'Z').getTime()>Date.now())?['w_messages']:[]),
    ...(nowPlaying.playing&&nowPlaying.title?['w_music']:[]),
    ...(expiringAppliances.length>0?['w_home_warranty']:[]),
    ...(urgentConsumables.length>0?['w_home_consumables']:[]),
    ...(urgentMaintenance.length>0?['w_home_maintenance']:[]),
    ...(urgentPetRecords.length>0?['w_pets']:[]),
    ...(emergencyHasValue?['w_emergency']:[]),
    ...(activeSubCount>0?['w_subscriptions']:[]),
    ...(lowPantryItems.length>0?['w_pantry']:[]),
    ...(inProgressProjects.length>0?['w_projects']:[]),
  ];
  const activePanelId=centerPanels[centerIdx%Math.max(1,centerPanels.length)];
  useEffect(()=>{
    if(panelFirstRender.current){panelFirstRender.current=false;setVisiblePanelId(activePanelId);return;}
    setPanelOpacity(0);
    const t=setTimeout(()=>{
      setVisiblePanelId(activePanelId);
      requestAnimationFrame(()=>requestAnimationFrame(()=>setPanelOpacity(1)));
    },300);
    return()=>clearTimeout(t);
  },[activePanelId]);

  const [dmChoreConfetti,setDmChoreConfetti]=useState(false);
  const toggleChore=async id=>{
    try{
      const result=await api.put(`/api/chores/${id}/done`);
      if(result.error) return;
      setChores(p=>p.map(c=>c.id===id?{...c,done:result.done,next_due:result.next_due,status:result.status}:c));
      if(result.completed||result.done){setDmChoreConfetti(true);setTimeout(()=>setDmChoreConfetti(false),2500);}
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

      {/* Presence notification — bottom-right corner card */}
      {countdownOverlay&&(
        <div onClick={()=>{if(cdTimerRef.current)clearTimeout(cdTimerRef.current);setCountdownOverlay(null);}} style={{position:'fixed',bottom:isTV?36:24,left:isTV?40:24,zIndex:999,display:'flex',alignItems:'center',gap:16,background:D.card,borderRadius:20,padding:isTV?'20px 28px':'16px 22px',border:`1.5px solid ${A.amber}55`,boxShadow:`0 0 40px ${A.amber}18,0 12px 32px rgba(0,0,0,0.35)`,animation:'presenceIn .35s cubic-bezier(.4,0,.2,1)',cursor:'pointer',maxWidth:isTV?400:320}}>
          <div style={{width:isTV?56:44,height:isTV?56:44,borderRadius:'50%',background:`${A.amber}20`,border:`2px solid ${A.amber}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:isTV?26:20}}>{countdownOverlay.emoji||'🎉'}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:isTV?22:17,fontWeight:800,color:D.t1,letterSpacing:'-0.01em',lineHeight:1.2}}>{countdownOverlay.label}</div>
            <div style={{fontSize:isTV?15:12,color:A.amber,fontWeight:600,marginTop:3}}>Today!</div>
            <PresenceBar key={countdownOverlay.id} duration={30000} color={A.amber}/>
          </div>
        </div>
      )}
      {presenceOverlay&&(
        <div style={{position:'fixed',bottom:isTV?36:24,right:isTV?40:24,zIndex:999,display:'flex',alignItems:'center',gap:16,background:D.card,borderRadius:20,padding:isTV?'20px 28px':'16px 22px',border:`1.5px solid ${presenceOverlay.color}55`,boxShadow:`0 0 40px ${presenceOverlay.color}18,0 12px 32px rgba(0,0,0,0.35)`,animation:'presenceIn .35s cubic-bezier(.4,0,.2,1)',cursor:'pointer',maxWidth:isTV?400:320,overflow:'hidden'}}
          onClick={()=>{if(presenceTimerRef.current)clearTimeout(presenceTimerRef.current);setPresenceOverlay(null);}}>
          <div style={{width:isTV?56:44,height:isTV?56:44,borderRadius:'50%',background:`${presenceOverlay.color}20`,border:`2px solid ${presenceOverlay.color}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:isTV?26:20}}>
            {presenceOverlay.type==='arrival'?'🏠':'👋'}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:isTV?22:17,fontWeight:800,color:D.t1,letterSpacing:'-0.01em',lineHeight:1.2}}>{presenceOverlay.name}</div>
            <div style={{fontSize:isTV?15:12,color:presenceOverlay.color,fontWeight:600,marginTop:3}}>
              {presenceOverlay.type==='arrival'?'Welcome home!':'has left'}
            </div>
            <PresenceBar key={presenceOverlay.ts} duration={60000} color={presenceOverlay.color}/>
          </div>
        </div>
      )}

      {/* Header — clock + date */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'baseline',gap:8}}>
          <span style={{fontSize:isMobile?64:isTV?140:108,fontWeight:800,color:D.t1,lineHeight:1,letterSpacing:'-0.04em',fontVariantNumeric:'tabular-nums'}}>{h12}:{min}</span>
          <span style={{fontSize:isMobile?18:isTV?36:28,color:D.t3,fontWeight:400,marginBottom:isMobile?6:isTV?14:10}}>{ampm}</span>
        </div>
        <div style={{textAlign:'right',paddingBottom:8}}>
          <div style={{fontSize:isMobile?14:isTV?26:20,color:D.t2,fontWeight:400,letterSpacing:'-.01em'}}>{dateStr}</div>
          <div style={{fontSize:isTV?14:12,color:D.t4,marginTop:5,display:'flex',alignItems:'center',gap:5,justifyContent:'flex-end',fontFamily:'JetBrains Mono,monospace'}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:online?A.green:A.red}}/>{online?'synced':'offline'}
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
                    {(weather.forecast||[]).slice(0,3).map(f=>(
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
                  {evs.slice(0,3).map(ev=>{const c=ev.color||'#34C759';return(
                    <div key={ev.id} style={{background:c+'18',borderRadius:8,padding:'8px 11px',marginBottom:4,borderLeft:`3px solid ${c}`}}>
                      <div style={{fontSize:14,color:D.t1,fontWeight:600}}>{ev.title}</div>
                      <div style={{fontSize:12,color:D.t3,fontVariantNumeric:'tabular-nums',marginTop:1}}>{fmtTime(ev.time,clockFormat)}</div>
                    </div>
                  );})}
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

            {/* LEFT: scrollable events + QR */}
            <Widget style={{display:'flex',flexDirection:'column',overflow:'hidden'}}>
              {hasUpcomingEvents?(
                <>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:isTV?14:12,flexShrink:0}}>
                    <div style={{fontSize:isTV?12:10,fontWeight:700,color:D.t3,textTransform:'uppercase',letterSpacing:'.10em'}}>Upcoming</div>
                    {wifiQrData&&(
                      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,marginTop:-2}}>
                        <img src={wifiQrData.dataUrl} alt="WiFi QR" style={{width:isTV?64:52,height:isTV?64:52,objectFit:'contain',borderRadius:7,display:'block'}}/>
                        <div style={{fontSize:8,fontWeight:600,color:D.t3,maxWidth:isTV?64:52,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textAlign:'center'}}>{wifiQrData.ssid}</div>
                      </div>
                    )}
                  </div>
                  <div ref={calScrollRef} style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:14,WebkitMaskImage:'linear-gradient(to bottom,black calc(100% - 24px),transparent 100%)',maskImage:'linear-gradient(to bottom,black calc(100% - 24px),transparent 100%)'}}>
                    {agendaDays.filter(({date})=>displayEvents.some(e=>e.date===date)).map(({label,date})=>{
                      const evs=displayEvents.filter(e=>e.date===date);
                      return(
                        <div key={date}>
                          <div style={{fontSize:10,fontWeight:700,color:D.t3,marginBottom:6,textTransform:'uppercase',letterSpacing:'.08em'}}>{label}</div>
                          {evs.map(ev=>{const c=ev.color||'#34C759';return(
                            <div key={ev.id} style={{background:c+'18',borderRadius:8,padding:'8px 11px',marginBottom:4,borderLeft:`3px solid ${c}`}}>
                              <div style={{fontSize:14,color:D.t1,fontWeight:600}}>{ev.title}</div>
                              <div style={{fontSize:12,color:D.t3,fontVariantNumeric:'tabular-nums',marginTop:1}}>{fmtTime(ev.time,clockFormat)}</div>
                            </div>
                          );})}
                        </div>
                      );
                    })}
                  </div>
                </>
              ):(
                wifiQrData?(
                  <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8}}>
                    <WLabel>Guest WiFi</WLabel>
                    <img src={wifiQrData.dataUrl} alt="WiFi QR" style={{width:isTV?160:130,height:isTV?160:130,objectFit:'contain',borderRadius:10,display:'block'}}/>
                    <div style={{fontSize:14,fontWeight:600,color:D.t2,letterSpacing:'.02em'}}>{wifiQrData.ssid}</div>
                    <div style={{fontSize:11,color:D.t4}}>Scan to connect</div>
                  </div>
                ):(
                  <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <div style={{fontSize:13,color:D.t4,textAlign:'center'}}>Nothing scheduled</div>
                  </div>
                )
              )}
            </Widget>

            {/* CENTER: rotating panel + dinner */}
            <div style={{display:'flex',flexDirection:'column',gap:12,minHeight:0}}>
              {centerPanels.length>0&&(
                <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0}}>
                  <Widget style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                    {centerPanels.length>1&&(
                      <div style={{display:'flex',gap:5,marginBottom:12,justifyContent:'center',alignItems:'center'}}>
                        {centerPanels.map((p,i)=>{
                          const active=i===centerIdx%centerPanels.length;
                          return <div key={p} style={{width:active?7:5,height:active?7:5,borderRadius:'50%',background:active?D.t2:D.t4,transition:'all .3s ease',flexShrink:0}}/>;
                        })}
                      </div>
                    )}
                    <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0,opacity:panelOpacity,transition:'opacity 0.3s ease'}}>
                    {visiblePanelId==='due_soon'&&(
                      <>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                          <WLabel>Vehicle Services</WLabel>
                          <span style={{fontSize:11,fontWeight:700,color:A.amber}}>{dueSoonVehicles.length} service{dueSoonVehicles.length===1?'':'s'}</span>
                        </div>
                        <div style={{flex:1,overflowY:'auto',WebkitMaskImage:'linear-gradient(to bottom,black calc(100% - 24px),transparent 100%)',maskImage:'linear-gradient(to bottom,black calc(100% - 24px),transparent 100%)'}}>
                          {dueSoonVehicles.map(e=>{
                            const days=daysUntil(e.date);
                            const [svcName,vehName]=(e.title||'').split(' — ');
                            return(
                              <div key={e.id} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 0',borderBottom:`1px solid ${D.sep}`}}>
                                <div style={{width:8,height:8,borderRadius:'50%',background:e.color||A.blue,flexShrink:0}}/>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:14,color:D.t1,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{svcName}</div>
                                  {vehName&&<div style={{fontSize:11,color:D.t4,marginTop:1}}>{vehName}</div>}
                                </div>
                                <span style={{fontSize:12,fontWeight:700,color:days<0?A.red:days===0?A.amber:D.t3,flexShrink:0}}>{days<0?`${Math.abs(days)}d overdue`:days===0?'Today':`${days}d`}</span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {visiblePanelId==='chores'&&(
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
                    {visiblePanelId==='countdowns'&&(
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
                    {visiblePanelId==='goals'&&(
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
                    {visiblePanelId==='members'&&(
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
                    {visiblePanelId==='w_wotd'&&(()=>{const w=widgetData.wotd;if(!w)return null;return(
                      <>
                        <WLabel>Word of the Day</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:10}}>
                          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                            <span style={{fontSize:isTV?38:30,fontWeight:800,color:D.t1,letterSpacing:'-.02em',lineHeight:1}}>{w.word}</span>
                          </div>
                          <div style={{display:'flex',alignItems:'center',gap:10}}>
                            {w.phonetic&&<span style={{fontSize:13,color:D.t4}}>{w.phonetic}</span>}
                            {w.partOfSpeech&&<span style={{fontSize:13,color:D.t4,fontStyle:'italic'}}>{w.partOfSpeech}</span>}
                          </div>
                          <div style={{fontSize:15,color:D.t2,lineHeight:1.55}}>{w.definition}</div>
                          {w.example&&<div style={{fontSize:13,color:D.t3,fontStyle:'italic',lineHeight:1.4,borderLeft:`3px solid ${D.sep}`,paddingLeft:10}}>"{w.example}"</div>}
                        </div>
                      </>
                    );})()}
                    {visiblePanelId==='w_sun'&&(()=>{const s=widgetData.sun;if(!s)return null;
                      const _moonMap={'new moon':'🌑','waxing crescent':'🌒','first quarter':'🌓','waxing gibbous':'🌔','full moon':'🌕','waning gibbous':'🌖','last quarter':'🌗','waning crescent':'🌘'};
                      const moonEmoji=_moonMap[(s.moon_phase||'').toLowerCase()]||'🌙';
                      return(
                      <>
                        <WLabel>Sun & Moon</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:14}}>
                          <div style={{display:'flex',gap:20}}>
                            <div style={{flex:1}}>
                              <div style={{fontSize:11,fontWeight:700,color:D.t4,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:3}}>Sunrise</div>
                              <div style={{fontSize:isTV?24:20,fontWeight:700,color:D.t1}}>{s.sunrise}</div>
                            </div>
                            <div style={{flex:1}}>
                              <div style={{fontSize:11,fontWeight:700,color:D.t4,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:3}}>Sunset</div>
                              <div style={{fontSize:isTV?24:20,fontWeight:700,color:D.t1}}>{s.sunset}</div>
                            </div>
                          </div>
                          {s.golden_hour&&<div><div style={{fontSize:11,fontWeight:700,color:D.t4,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:3}}>Golden Hour</div><div style={{fontSize:15,color:D.t2}}>{s.golden_hour}</div></div>}
                          {s.moon_phase&&(
                            <div style={{display:'flex',alignItems:'center',gap:12}}>
                              <span style={{fontSize:isTV?48:38,lineHeight:1}}>{moonEmoji}</span>
                              <div>
                                <div style={{fontSize:isTV?15:13,fontWeight:600,color:D.t2}}>{s.moon_phase}</div>
                                {s.moon_illumination!=null&&<div style={{fontSize:11,color:D.t4,marginTop:2}}>{Math.round(s.moon_illumination)}% illuminated</div>}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    );})()}
                    {visiblePanelId==='w_compliment'&&(()=>{const c=widgetData.compliment;if(!c)return null;return(
                      <>
                        <WLabel>Daily Affirmation</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center'}}>
                          <div style={{fontSize:isTV?20:17,color:D.t1,fontWeight:500,lineHeight:1.55,fontStyle:'italic'}}>"{c.text}"</div>
                        </div>
                      </>
                    );})()}
                    {visiblePanelId==='w_quote'&&(
                      <>
                        <WLabel>Quote</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center'}}>
                          <div style={{fontSize:17,color:D.t1,fontWeight:500,lineHeight:1.5,fontStyle:'italic',marginBottom:10}}>"{widgetData.quote?.text}"</div>
                          <div style={{fontSize:13,color:D.t3}}>— {widgetData.quote?.author}</div>
                        </div>
                      </>
                    )}
                    {visiblePanelId==='w_stocks'&&(
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
                    {visiblePanelId==='w_producthunt'&&(
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
                    {visiblePanelId==='w_github'&&(
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
                    {visiblePanelId==='w_reddit'&&(
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
                    {visiblePanelId==='w_beehiiv'&&(
                      <>
                        <WLabel>Newsletter</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',textAlign:'center'}}>
                          <div style={{fontSize:52,fontWeight:800,color:D.t1,letterSpacing:'-.04em',lineHeight:1}}>{widgetData.beehiiv?.subscribers?.toLocaleString()}</div>
                          <div style={{fontSize:14,color:D.t3,marginTop:8}}>active subscribers</div>
                          {widgetData.beehiiv?.name&&<div style={{fontSize:11,color:D.t4,marginTop:4}}>{widgetData.beehiiv.name}</div>}
                        </div>
                      </>
                    )}
                    {visiblePanelId==='w_youtube'&&(
                      <>
                        <WLabel>YouTube — {widgetData.youtube?.name}</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:16,marginTop:4}}>
                          <div style={{textAlign:'center'}}>
                            <div style={{fontSize:44,fontWeight:800,color:D.t1,letterSpacing:'-.04em',lineHeight:1}}>{widgetData.youtube?.subscribers?.toLocaleString()}</div>
                            <div style={{fontSize:13,color:D.t3,marginTop:4}}>subscribers</div>
                          </div>
                          <div style={{display:'flex',gap:8}}>
                            <div style={{flex:1,background:'rgba(255,255,255,0.06)',borderRadius:8,padding:'10px',textAlign:'center'}}>
                              <div style={{fontSize:16,fontWeight:700,color:D.t1}}>{((widgetData.youtube?.views??0)/1000000)>=1?((widgetData.youtube?.views??0)/1000000).toFixed(1)+'M':((widgetData.youtube?.views??0)/1000).toFixed(0)+'K'}</div>
                              <div style={{fontSize:10,color:D.t4,marginTop:2}}>total views</div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                    {visiblePanelId==='w_etsy'&&(
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
                    {visiblePanelId==='w_powerwall'&&(()=>{
                      const pw=widgetData.powerwall;if(!pw)return null;
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
                    {visiblePanelId==='w_flight'&&(()=>{
                      const f=widgetData.flight;if(!f)return null;
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
                    {visiblePanelId==='w_uptime'&&(
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
                    {visiblePanelId==='w_nextdns'&&(()=>{
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
                                <div style={{fontSize:22,fontWeight:700,color:A.green}}>{nd.pct??'—'}%</div>
                                <div style={{fontSize:10,color:D.t4,marginTop:2}}>block rate</div>
                              </div>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                    {visiblePanelId==='w_beszel'&&(
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
                    {visiblePanelId==='w_plex'&&(()=>{
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
                      const plexItem=items[plexIdx%Math.max(1,items.length)];
                      return(
                        <>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                            <WLabel>Recently Added</WLabel>
                            {items.length>1&&<div style={{fontSize:10,color:D.t4}}>{(plexIdx%items.length)+1}/{items.length}</div>}
                          </div>
                          {!plexItem?(
                            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
                              <div style={{fontSize:12,color:D.t4}}>Nothing recent</div>
                            </div>
                          ):(
                            <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'}}>
                              <div style={{flex:1,minHeight:0,borderRadius:9,overflow:'hidden',background:'rgba(255,255,255,0.06)'}}>
                                {plexItem.thumb&&<img src={plexItem.thumb} alt="" style={{width:'100%',height:'100%',objectFit:'contain',display:'block'}} onError={e=>e.target.style.display='none'}/>}
                              </div>
                              <div style={{fontSize:13,fontWeight:700,color:D.t1,marginTop:8,lineHeight:1.3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{plexItem.title}</div>
                              {plexItem.year&&<div style={{fontSize:11,color:D.t4,marginTop:2}}>{plexItem.year}</div>}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {visiblePanelId==='w_moen'&&(()=>{
                      const m=widgetData.moen;if(!m)return null;
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
                    {visiblePanelId==='w_unifi'&&(()=>{
                      const u=widgetData.unifi;if(!u)return null;
                      const upColor=u.status==='up'?A.green:A.red;
                      return(
                        <>
                          <WLabel>UniFi Network</WLabel>
                          <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:12}}>
                            <div style={{background:'rgba(255,255,255,0.06)',borderRadius:10,padding:'14px',textAlign:'center'}}>
                              <div style={{fontSize:48,fontWeight:800,color:D.t1,letterSpacing:'-.04em',lineHeight:1}}>{u.clients}</div>
                              <div style={{fontSize:12,color:D.t4,marginTop:5}}>devices online</div>
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
                    {visiblePanelId==='w_who_home'&&(()=>{
                      const {persons=[]}=widgetData.who_home||{};
                      const isHome=s=>s==='home';
                      const stateLabel=s=>s==='home'?'Home':s==='not_home'?'Away':s?s.replace(/_/g,' '):'Unknown';
                      const stateColor=s=>isHome(s)?A.green:s==='not_home'?D.t4:'#FF9500';
                      const initials=n=>n.trim().split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase()||'?';
                      const homeCount=persons.filter(p=>isHome(p.state)).length;
                      return(
                        <>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                            <WLabel>Who's Home</WLabel>
                            <span style={{fontSize:11,color:D.t4}}>{homeCount} of {persons.length} home</span>
                          </div>
                          <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:10}}>
                            {persons.map(p=>(
                              <div key={p.entity_id} style={{display:'flex',alignItems:'center',gap:12}}>
                                <div style={{width:34,height:34,borderRadius:'50%',background:stateColor(p.state),opacity:isHome(p.state)?1:0.35,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                                  <span style={{fontSize:13,fontWeight:700,color:'#fff'}}>{initials(p.name)}</span>
                                </div>
                                <span style={{fontSize:15,fontWeight:600,color:D.t1,flex:1}}>{p.name}</span>
                                <span style={{fontSize:12,fontWeight:500,color:stateColor(p.state)}}>{stateLabel(p.state)}</span>
                              </div>
                            ))}
                            {!persons.length&&<div style={{fontSize:13,color:D.t4}}>No people configured</div>}
                          </div>
                        </>
                      );
                    })()}
                    {visiblePanelId==='w_thermostat'&&(()=>{
                      const t=widgetData.thermostat;if(!t)return null;
                      const modeColor={heat:'#FF6B35',cool:'#3B82F6',heat_cool:'#AF52DE',auto:'#AF52DE',off:D.t4,fan_only:D.t3,dry:'#FF9500'}[t.mode]||D.t3;
                      const actionLabel={heating:'Heating',cooling:'Cooling',idle:'Idle',off:'Off',drying:'Drying',fan:'Fan'}[t.action]||t.action||'';
                      if(t.unavailable) return(
                        <>
                          <WLabel>{t.name}</WLabel>
                          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
                            <span style={{fontSize:13,color:D.t4}}>Thermostat unavailable</span>
                          </div>
                        </>
                      );
                      return(
                        <>
                          <WLabel>{t.name||'Thermostat'}</WLabel>
                          <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:6}}>
                            <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:4}}>
                              <span style={{fontSize:52,fontWeight:800,color:D.t1,lineHeight:1,letterSpacing:'-.04em'}}>{t.current_temp!=null?Math.round(t.current_temp):'--'}</span>
                              <span style={{fontSize:22,color:D.t3,fontWeight:400}}>°{t.unit}</span>
                            </div>
                            {[
                              {label:'Set to',val:t.target_temp!=null?`${Math.round(t.target_temp)}°${t.unit}`:'--',color:D.t2},
                              {label:'Mode',val:t.mode,color:modeColor},
                              ...(actionLabel?[{label:'Status',val:actionLabel,color:modeColor}]:[]),
                              ...(t.humidity!=null?[{label:'Humidity',val:`${Math.round(t.humidity)}%`,color:D.t2}]:[]),
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
                    {visiblePanelId==='w_ha_sensors'&&(()=>{
                      const {sensors=[]}=widgetData.ha_sensors||{};
                      if(!sensors.length) return null;
                      const stateColor=s=>{
                        if(s==='unavailable'||s==='unknown') return D.t4;
                        if(['on','open','unlocked','detected','motion','leak'].includes(s)) return A.red;
                        if(['off','closed','locked','clear','no_motion','dry'].includes(s)) return A.green;
                        return D.t2;
                      };
                      const domainIcon={lock:'🔒',locked:'🔒',alarm_motion:'🏃',alarm_contact:'🚪',alarm_smoke:'🔥',alarm_co:'💨',alarm_water:'💧',binary_sensor:'◉',light:'💡',switch:'🔌',alarm_control_panel:'🚨',climate:'🌡',cover:'🪟',sensor:'📡',camera:'📷',motion:'🏃',measure_temperature:'🌡',measure_humidity:'💧',measure_power:'⚡',measure_battery:'🔋'};
                      const deviceTypeIcon={light:'💡',socket:'🔌',lock:'🔒',thermostat:'🌡',camera:'📷',doorbell:'🔔',windowcoverings:'🪟',fan:'🌀',sensor:'📡',button:'🔘',remote:'🎮'};
                      const nameIcon=n=>{const l=n.toLowerCase();if(/motion|pir/.test(l))return'🏃';if(/door|contact|entry/.test(l))return'🚪';if(/smoke/.test(l))return'🔥';if(/leak|water|flood/.test(l))return'💧';if(/window|blind|curtain|shade/.test(l))return'🪟';if(/lock/.test(l))return'🔒';if(/temp/.test(l))return'🌡';if(/humid/.test(l))return'💧';if(/power|energy|watt/.test(l))return'⚡';if(/light|lamp|bulb/.test(l))return'💡';if(/plug|socket|outlet/.test(l))return'🔌';if(/camera/.test(l))return'📷';if(/bell|doorbell/.test(l))return'🔔';if(/fan/.test(l))return'🌀';return null;};
                      const isBinary=s=>!s.unit&&['on','off','open','closed','locked','unlocked','detected','clear','motion','no_motion','leak','dry'].includes(String(s.state||''));
                      const visible=sensors.slice(0,9);
                      const hidden=sensors.length-visible.length;
                      const cols=visible.length===1?1:visible.length<=4?2:3;
                      return(
                        <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0}}>
                          <WLabel style={{marginBottom:8,flexShrink:0}}>Home</WLabel>
                          <div style={{flex:1,display:'grid',gridTemplateColumns:`repeat(${cols},1fr)`,gap:isTV?10:7,alignContent:'start',overflow:'hidden'}}>
                            {visible.map((s,i)=>{
                              const st=s.state!=null?String(s.state):'unknown';
                              const icon=nameIcon(s.name||'')||domainIcon[s.device_class]||deviceTypeIcon[s.device_type]||domainIcon[s.domain]||'◉';
                              const color=stateColor(st);
                              const binary=isBinary(s);
                              return(
                                <div key={i} style={{position:'relative',background:'rgba(255,255,255,0.07)',borderRadius:14,border:'1px solid rgba(255,255,255,0.09)',padding:isTV?'12px 12px 9px':'9px 9px 7px',display:'flex',flexDirection:'column',justifyContent:'space-between',aspectRatio:'1',overflow:'hidden'}}>
                                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:4}}>
                                    <span style={{fontSize:isTV?26:20,lineHeight:1,opacity:0.85,flexShrink:0}}>{icon}</span>
                                    {binary
                                      ?<div style={{width:isTV?11:9,height:isTV?11:9,borderRadius:'50%',background:color,marginTop:2,flexShrink:0}}/>
                                      :<div style={{textAlign:'right',lineHeight:1.15,minWidth:0,overflow:'hidden'}}>
                                        <div style={{fontSize:isTV?14:11,fontWeight:800,color:D.t1,letterSpacing:'-.02em',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{st}</div>
                                        {s.unit&&<div style={{fontSize:isTV?10:8,color:D.t3,fontWeight:500,marginTop:1}}>{s.unit}</div>}
                                      </div>
                                    }
                                  </div>
                                  <div style={{fontSize:isTV?11:9,fontWeight:500,color:D.t3,lineHeight:1.2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name||'—'}</div>
                                </div>
                              );
                            })}
                          </div>
                          {hidden>0&&<div style={{fontSize:isTV?10:8,color:D.t4,textAlign:'right',marginTop:4,flexShrink:0}}>+{hidden} more</div>}
                        </div>
                      );
                    })()}
                    {visiblePanelId==='w_notifications'&&(()=>{
                      const recent=allSmartEvents.slice(0,5);
                      if(!recent.length) return null;
                      const fmtAgo=ts=>{
                        if(!ts) return '';
                        let d;
                        if(typeof ts==='number') d=new Date(ts<1e10?ts*1000:ts);
                        else{const n=ts.replace(' ','T');d=new Date(!n.endsWith('Z')&&!n.includes('+')?n+'Z':n);}
                        if(isNaN(d.getTime())) return '';
                        const m=Math.round((Date.now()-d.getTime())/60000);
                        return m<1?'just now':m<60?`${m}m ago`:m<1440?`${Math.round(m/60)}h ago`:m<2880?'yesterday':`${Math.round(m/1440)}d ago`;
                      };
                      return(
                        <>
                          <WLabel style={{marginBottom:10}}>Activity</WLabel>
                          <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:8}}>
                            {recent.map((ev,i)=>(
                              <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:'rgba(255,255,255,0.06)',borderRadius:10}}>
                                <span style={{fontSize:22,flexShrink:0}}>{ev.icon||'🏠'}</span>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:13,fontWeight:600,color:D.t1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ev.title}</div>
                                  {ev.message&&<div style={{fontSize:11,color:D.t3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginTop:1}}>{ev.message}</div>}
                                </div>
                                <span style={{fontSize:10,color:D.t4,flexShrink:0,whiteSpace:'nowrap'}}>{fmtAgo(ev.created_at)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                    {visiblePanelId==='w_polls'&&(()=>{
                      const poll=polls[0];
                      if(!poll) return null;
                      const votes=livePollVotes&&Object.keys(livePollVotes).length?livePollVotes:poll.votes||{};
                      const total=Object.values(votes).reduce((a,b)=>a+b,0);
                      return(
                        <>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                            <WLabel>Poll</WLabel>
                            <span style={{fontSize:11,color:D.t4}}>{total} vote{total!==1?'s':''}</span>
                          </div>
                          <div style={{fontSize:16,fontWeight:700,color:D.t1,marginBottom:14,lineHeight:1.3}}>{poll.question}</div>
                          <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:8}}>
                            {(poll.options||[]).map((opt,idx)=>{
                              const count=votes[idx]||0;
                              const pct=total>0?Math.round((count/total)*100):0;
                              return(
                                <div key={idx} style={{position:'relative',background:'rgba(255,255,255,0.07)',borderRadius:8,padding:'10px 14px',overflow:'hidden'}}>
                                  <div style={{position:'absolute',top:0,left:0,height:'100%',width:`${pct}%`,background:`${A.blue}25`,transition:'width .4s ease'}}/>
                                  <div style={{position:'relative',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <span style={{fontSize:14,fontWeight:500,color:D.t1}}>{opt}</span>
                                    <span style={{fontSize:13,fontWeight:700,color:A.blue,fontVariantNumeric:'tabular-nums'}}>{pct}%</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                    {visiblePanelId==='w_grocery'&&(()=>{
                      const cats=[...new Set(uncheckedGrocery.map(i=>i.category||'Other'))];
                      return(
                        <>
                          <WLabel>Shopping List</WLabel>
                          <div style={{flex:1,overflowY:'auto',marginTop:4}}>
                            {cats.map((cat,ci)=>(
                              <div key={cat}>
                                <div style={{fontSize:11,fontWeight:700,color:D.t4,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:5,marginTop:ci>0?10:0}}>{cat}</div>
                                {uncheckedGrocery.filter(i=>(i.category||'Other')===cat).map(i=>(
                                  <div key={i.id} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 0',borderBottom:`1px solid ${D.sep}`}}>
                                    <div style={{width:16,height:16,borderRadius:'50%',border:`1.5px solid ${D.t4}`,flexShrink:0}}/>
                                    <span style={{fontSize:15,color:D.t2,fontWeight:400}}>{i.name}</span>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                    {visiblePanelId==='w_photos'&&photos.length>0&&(()=>{
                      const p=photos[photoIdx%photos.length];
                      return(
                        <div style={{flex:1,borderRadius:10,overflow:'hidden',margin:'-2px'}}>
                          <img key={p.id} src={`/photos/${p.filename}`} style={{width:'100%',height:'100%',objectFit:'cover',display:'block',animation:'fadeIn .8s ease'}} alt=""/>
                        </div>
                      );
                    })()}
                    {visiblePanelId==='w_packages'&&packages.length>0&&(()=>{
                      const carrierColor={UPS:'#FFB500',FedEx:'#4D148C',USPS:'#004B97',Amazon:'#FF9900',DHL:'#FFCC00',OnTrac:'#E8231A',LaserShip:'#00A3E0'};
                      return(
                        <>
                          <WLabel>Packages</WLabel>
                          <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:10,marginTop:4}}>
                            {packages.map(pkg=>{
                              const color=carrierColor[pkg.carrier]||D.t3;
                              return(
                                <div key={pkg.id} style={{background:'rgba(255,255,255,0.05)',borderRadius:10,padding:'12px 14px',display:'flex',flexDirection:'column',gap:4}}>
                                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                                    <span style={{fontSize:12,fontWeight:700,color,textTransform:'uppercase',letterSpacing:'.06em'}}>{pkg.carrier||'Package'}</span>
                                    {pkg.expected_date&&<span style={{fontSize:11,color:D.t4}}>Arriving {pkg.expected_date}</span>}
                                  </div>
                                  <div style={{fontSize:15,fontWeight:600,color:D.t1,lineHeight:1.3}}>{pkg.description||pkg.tracking_number||'In transit'}</div>
                                  {pkg.tracking_number&&<div style={{fontSize:11,color:D.t4,fontFamily:'monospace'}}>{pkg.tracking_number}</div>}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                    {visiblePanelId==='w_messages'&&messages.length>0&&(()=>{
                      const now=Date.now();
                      const liveMsgs=messages.filter(m=>m.expires_at&&new Date(m.expires_at.replace(' ','T')+'Z').getTime()>now);
                      if(!liveMsgs.length) return null;
                      const fmtTimeLeft=expiresAt=>{
                        if(!expiresAt) return '';
                        const ms=new Date(expiresAt.replace(' ','T')+'Z').getTime()-now;
                        if(ms<=0) return 'Expired';
                        const mins=Math.floor(ms/60000);
                        if(mins<60) return `${mins}m left`;
                        const hrs=Math.floor(mins/60);
                        return `${hrs}h left`;
                      };
                      return(
                        <>
                          <WLabel>Messages</WLabel>
                          <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:10,marginTop:4}}>
                            {liveMsgs.map(msg=>(
                              <div key={msg.id} style={{background:'rgba(255,255,255,0.05)',borderRadius:10,padding:'14px 16px'}}>
                                <div style={{fontSize:17,fontWeight:600,color:D.t1,lineHeight:1.4,marginBottom:6}}>{msg.text}</div>
                                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                                  <span style={{fontSize:12,color:D.t3}}>{msg.author||'Family'}</span>
                                  <span style={{fontSize:11,color:D.t4}}>{fmtTimeLeft(msg.expires_at)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                    {visiblePanelId==='w_music'&&nowPlaying.playing&&(
                      <>
                        <WLabel>Now playing</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16}}>
                          {nowPlaying.thumb&&<img src={nowPlaying.thumb} alt="" style={{width:isTV?160:120,height:isTV?160:120,borderRadius:12,objectFit:'cover',boxShadow:'0 8px 32px rgba(0,0,0,0.4)'}}/>}
                          <div style={{textAlign:'center'}}>
                            <div style={{fontSize:isTV?28:22,fontWeight:700,color:D.t1,lineHeight:1.2,marginBottom:6}}>{nowPlaying.title}</div>
                            {nowPlaying.artist&&<div style={{fontSize:isTV?18:15,color:D.t3,fontWeight:500}}>{nowPlaying.artist}</div>}
                          </div>
                        </div>
                      </>
                    )}
                    {visiblePanelId==='w_home_warranty'&&expiringAppliances.length>0&&(
                      <>
                        <WLabel>Warranties expiring</WLabel>
                        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:10,marginTop:4}}>
                          {expiringAppliances.map(a=>{
                            const d=daysUntil(a.warranty_date);
                            return(
                              <div key={a.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:'rgba(255,255,255,0.05)',borderRadius:10}}>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:isTV?18:14,fontWeight:600,color:D.t1}}>{a.name}</div>
                                  {a.location&&<div style={{fontSize:11,color:D.t4,marginTop:1}}>{a.location}</div>}
                                </div>
                                <span style={{fontSize:12,fontWeight:700,color:d<0?A.red:A.amber,flexShrink:0,background:d<0?A.redFill:A.amberFill,padding:'3px 8px',borderRadius:A.rPill}}>{d<0?'Expired':`${d}d`}</span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {visiblePanelId==='w_home_consumables'&&urgentConsumables.length>0&&(
                      <>
                        <WLabel>Needs replacement</WLabel>
                        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:10,marginTop:4}}>
                          {urgentConsumables.map(c=>(
                            <div key={c.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:'rgba(255,255,255,0.05)',borderRadius:10}}>
                              <div style={{width:8,height:8,borderRadius:'50%',background:c.status==='overdue'?A.red:A.amber,flexShrink:0}}/>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:isTV?18:14,fontWeight:600,color:D.t1}}>{c.name}</div>
                                {c.location&&<div style={{fontSize:11,color:D.t4,marginTop:1}}>{c.location}</div>}
                              </div>
                              <span style={{fontSize:12,color:c.status==='overdue'?A.red:A.amber,flexShrink:0}}>{c.days_remaining<0?`${Math.abs(c.days_remaining)}d overdue`:'Due soon'}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {visiblePanelId==='w_home_maintenance'&&urgentMaintenance.length>0&&(
                      <>
                        <WLabel>Seasonal maintenance</WLabel>
                        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:10,marginTop:4}}>
                          {urgentMaintenance.map(m=>(
                            <div key={m.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:'rgba(255,255,255,0.05)',borderRadius:10}}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:isTV?18:14,fontWeight:600,color:D.t1}}>{m.name}</div>
                              </div>
                              <span style={{fontSize:12,fontWeight:700,color:m.status==='overdue'?A.red:A.amber,background:m.status==='overdue'?A.redFill:A.amberFill,padding:'2px 8px',borderRadius:A.rPill,flexShrink:0}}>{m.status==='overdue'?'Overdue':'This month'}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {visiblePanelId==='w_emergency'&&emergencyHasValue&&(()=>{
                      const filled=Object.entries(dispEmergency).filter(([k,v])=>v&&String(v).trim()!==''&&EMERGENCY_LABELS[k]);
                      return(
                        <>
                          <WLabel>Emergency info</WLabel>
                          <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:8,marginTop:4}}>
                            {filled.map(([k,v])=>(
                              <div key={k} style={{padding:'10px 14px',background:'rgba(255,255,255,0.05)',borderRadius:10}}>
                                <div style={{fontSize:11,fontWeight:700,color:D.t3,textTransform:'uppercase',letterSpacing:'.06em'}}>{EMERGENCY_LABELS[k]}</div>
                                <div style={{fontSize:isTV?17:14,color:D.t1,marginTop:3,lineHeight:1.4,whiteSpace:'pre-wrap'}}>{v}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                    {visiblePanelId==='w_pets'&&urgentPetRecords.length>0&&(
                      <>
                        <WLabel>Pet care due</WLabel>
                        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:10,marginTop:4}}>
                          {urgentPetRecords.map(r=>(
                            <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:'rgba(255,255,255,0.05)',borderRadius:10}}>
                              <div style={{width:8,height:8,borderRadius:'50%',background:r.pet_color,flexShrink:0}}/>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:isTV?18:14,fontWeight:600,color:D.t1}}>{r.name}</div>
                                <div style={{fontSize:11,color:D.t4,marginTop:1}}>{r.pet_name}</div>
                              </div>
                              <span style={{fontSize:12,color:r.status==='overdue'?A.red:A.amber,flexShrink:0}}>{r.days_remaining<0?`${Math.abs(r.days_remaining)}d overdue`:r.days_remaining===0?'Today':`${r.days_remaining}d`}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {visiblePanelId==='dinner'&&(()=>{const td=todayDinner()||'—';return(
                      <>
                        <WLabel>Dinner tonight</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',gap:12,minHeight:0}}>
                          <div style={{fontSize:isTV?40:32,fontWeight:800,color:td!=='—'?D.t1:D.t4,letterSpacing:'-.02em',lineHeight:1.2,flexShrink:0}}>
                            {td}
                          </div>
                          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,flex:1,alignContent:'start'}}>
                            {[1,2,3,4,5,6].map(offset=>{
                              const d=new Date();d.setDate(d.getDate()+offset);
                              const dayName=DAYS[d.getDay()];
                              const meal=(meals||[]).find(m=>m.day===dayName)?.meal||'—';
                              return(
                                <div key={offset} style={{background:'rgba(255,255,255,0.05)',borderRadius:8,padding:'8px 10px'}}>
                                  <div style={{fontSize:9,fontWeight:700,color:D.t3,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:3}}>{offset===1?'Tmrw':dayName}</div>
                                  <div style={{fontSize:12,color:meal!=='—'?D.t2:D.t4,fontWeight:500,lineHeight:1.3}}>{meal}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    );})()}
                    {visiblePanelId==='w_subscriptions'&&activeSubCount>0&&(
                      <>
                        <WLabel>Subscriptions</WLabel>
                        <div style={{flex:1,display:'flex',flexDirection:'column',gap:10,marginTop:4}}>
                          <div style={{fontSize:isTV?38:28,fontWeight:800,color:D.t1,letterSpacing:'-.02em',lineHeight:1}}>
                            ${monthlySubTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
                            <span style={{fontSize:14,fontWeight:400,color:D.t3}}>/mo</span>
                          </div>
                          <div style={{fontSize:13,color:D.t3}}>{activeSubCount} active subscription{activeSubCount===1?'':'s'}</div>
                          <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:6,marginTop:4}}>
                            {[...(subscriptions||[])].filter(s=>s.active).sort((a,b)=>{
                              const me=s=>{const am=Number(s.amount)||0;if(s.billing_cycle==='annual')return am/12;if(s.billing_cycle==='weekly')return am*52/12;if(s.billing_cycle==='quarterly')return am/3;return am;};
                              return me(b)-me(a);
                            }).slice(0,6).map(s=>(
                              <div key={s.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:'rgba(255,255,255,0.05)',borderRadius:8}}>
                                <div style={{width:8,height:8,borderRadius:'50%',background:s.color||'#5856D6',flexShrink:0}}/>
                                <span style={{flex:1,fontSize:13,color:D.t2,fontWeight:500}}>{s.name}</span>
                                <span style={{fontSize:12,color:D.t3}}>${Number(s.amount||0).toFixed(2)}{({monthly:'/mo',annual:'/yr',weekly:'/wk',quarterly:'/qtr'})[s.billing_cycle]||''}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                    {visiblePanelId==='w_pantry'&&lowPantryItems.length>0&&(
                      <>
                        <WLabel>Pantry alert</WLabel>
                        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:8,marginTop:4}}>
                          {lowPantryItems.slice(0,8).map(p=>{
                            const isExpired=p.expiry_status==='expired';
                            const isExpiring=p.expiry_status==='expiring_soon';
                            const label=isExpired?'Expired':isExpiring?(p.days_until_expiry===0?'Today':`${p.days_until_expiry}d`):'Low';
                            const color=isExpired?A.red:A.amber;
                            return(
                              <div key={p.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:'rgba(255,255,255,0.05)',borderRadius:10}}>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:isTV?18:14,fontWeight:600,color:D.t1}}>{p.name}</div>
                                  <div style={{fontSize:11,color:D.t3,marginTop:1}}>{p.location||'Pantry'} · {p.quantity}{p.unit?` ${p.unit}`:''}</div>
                                </div>
                                <span style={{fontSize:11,fontWeight:700,color,flexShrink:0}}>{label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {visiblePanelId==='w_projects'&&inProgressProjects.length>0&&(
                      <>
                        <WLabel>Projects in progress</WLabel>
                        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:8,marginTop:4}}>
                          {inProgressProjects.slice(0,6).map(p=>{
                            const daysLeft=p.due_date?daysUntil(p.due_date):null;
                            return(
                              <div key={p.id} style={{padding:'10px 14px',background:'rgba(255,255,255,0.05)',borderRadius:10}}>
                                <div style={{fontSize:isTV?18:14,fontWeight:600,color:D.t1,lineHeight:1.3}}>{p.title}</div>
                                <div style={{fontSize:11,color:D.t3,marginTop:2,display:'flex',gap:8}}>
                                  {p.cost_estimate>0&&<span>${Number(p.cost_estimate).toLocaleString()} est.</span>}
                                  {daysLeft!==null&&<span style={{color:daysLeft<0?A.red:daysLeft<=3?A.amber:D.t3}}>{daysLeft<0?`${Math.abs(daysLeft)}d overdue`:daysLeft===0?'Due today':`${daysLeft}d left`}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                    </div>
                  </Widget>
                </div>
              )}
            </div>

            {/* RIGHT: weather + dynamic extras */}
            <div style={{display:'flex',flexDirection:'column',gap:12,minHeight:0,overflow:'hidden'}}>
              {/* Weather */}
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
                      {(weather.forecast||[]).map(f=>(
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
              {(()=>{const unchecked=(grocery||[]).filter(g=>!g.checked);return unchecked.length>0&&(
                <Widget style={{flexShrink:0}}>
                  <WLabel>Grocery</WLabel>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2px 12px'}}>
                    {unchecked.slice(0,6).map(item=>(
                      <div key={item.id} style={{display:'flex',alignItems:'center',gap:7,padding:'4px 0'}}>
                        <div style={{width:4,height:4,borderRadius:'50%',background:'rgba(255,255,255,0.35)',flexShrink:0}}/>
                        <span style={{fontSize:13,color:D.t2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name}</span>
                      </div>
                    ))}
                  </div>
                  {unchecked.length>6&&<div style={{fontSize:11,color:D.t4,marginTop:6}}>+{unchecked.length-6} more</div>}
                </Widget>
              );})()}
              {/* Pinned notes — fills remaining space below weather */}
              {pinnedNotes.length>0&&(
                <Widget style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:100}}>
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
        {quickActions.length>0&&quickActions.map(action=>{
          const st=qaState[action.id]||'idle';
          return(
            <button key={action.id} disabled={st==='loading'} onClick={async()=>{
              setQaState(s=>({...s,[action.id]:'loading'}));
              try{
                const r=await api.post('/api/quick-actions/trigger',{id:action.id});
                setQaState(s=>({...s,[action.id]:(r.ok===false||r.error)?'error':'done'}));
              }catch{setQaState(s=>({...s,[action.id]:'error'}));}
              setTimeout(()=>setQaState(s=>({...s,[action.id]:'idle'})),2000);
            }} style={{flexShrink:0,display:'flex',alignItems:'center',gap:6,background:st==='done'?'rgba(52,199,89,0.18)':st==='error'?'rgba(255,59,48,0.18)':'rgba(255,255,255,0.08)',color:st==='done'?'#30D158':st==='error'?'#FF453A':D.t2,border:'1px solid rgba(255,255,255,0.12)',borderRadius:A.rPill,padding:'9px 16px',fontSize:13,fontWeight:500,cursor:st==='loading'?'wait':'pointer',transition:'background .2s',opacity:showControls?1:0,pointerEvents:showControls?'auto':'none'}}>
              <span style={{fontSize:16,lineHeight:1}}>{action.icon||'⚡'}</span>
              <span>{st==='loading'?'…':st==='done'?'Done':st==='error'?'Failed':action.label}</span>
            </button>
          );
        })}
        <button onClick={onManage} style={{flexShrink:0,background:'rgba(255,255,255,0.08)',color:D.t2,border:'1px solid rgba(255,255,255,0.12)',borderRadius:A.rPill,padding:'9px 20px',fontSize:13,fontWeight:500,cursor:'pointer',transition:'background .15s,opacity .4s',opacity:showControls?1:0,pointerEvents:showControls?'auto':'none'}}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.13)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.08)'}
        >Manage</button>
      </div>
    </div>
  );
}

/* ── Dashboard ───────────────────────────────────────────────────────── */
function DashboardScreen({events,setEvents,chores,grocery,meals,countdowns,weather,clockFormat='12h',quickActions=[],bills=[],payments=[],projects=[],subscriptions=[],pantry=[]}){
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
      if(Array.isArray(updated)) setEvents(updated);
      setQaOpen(false);
      setQaForm({title:'',date:localDate(),time:'',cal:'kith'});
    } finally {
      setQaLoading(false);
    }
  };

  const getMeal=dayName=>((meals||[]).find(m=>m.day===dayName)?.meal||'');
  const upcomingCDs=(countdowns||[]).filter(c=>daysUntil(c.date)>=0).sort((a,b)=>daysUntil(a.date)-daysUntil(b.date)).slice(0,4);
  const currentPeriod=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const currentYear=String(now.getFullYear());
  const paidSet=useMemo(()=>new Set((payments||[]).map(p=>`${p.bill_id}_${p.period}`)),[payments]);
  const isPaidBill=b=>paidSet.has(`${b.id}_${(b.recurrence==='monthly'?currentPeriod:b.recurrence==='annual'?currentYear:b.due_date)}`);
  const billsDueSoon=useMemo(()=>(bills||[]).filter(b=>{
    if(!b.active||isPaidBill(b)) return false;
    if(b.recurrence==='monthly'){const d=b.due_day-now.getDate();return d>=0&&d<=7;}
    if(b.due_date){const d=daysUntil(b.due_date);return d>=0&&d<=7;}
    return false;
  }).sort((a,b)=>{
    const da=a.recurrence==='monthly'?a.due_day-now.getDate():daysUntil(a.due_date);
    const db=b.recurrence==='monthly'?b.due_day-now.getDate():daysUntil(b.due_date);
    return da-db;
  }),[bills,paidSet,now]);

  const projectsDueSoon=useMemo(()=>(projects||[]).filter(p=>{
    if(p.status==='done'||!p.due_date) return false;
    const d=daysUntil(p.due_date);
    return d>=0&&d<=7;
  }).sort((a,b)=>daysUntil(a.due_date)-daysUntil(b.due_date)),[projects]);

  const subsBillingSoon=useMemo(()=>(subscriptions||[]).filter(s=>{
    if(!s.active||!s.next_billing) return false;
    const d=daysUntil(s.next_billing);
    return d>=0&&d<=7;
  }).sort((a,b)=>daysUntil(a.next_billing)-daysUntil(b.next_billing)),[subscriptions]);

  const expiringPantry=useMemo(()=>(pantry||[]).filter(p=>p.expiry_status==='expired'||p.expiry_status==='expiring_soon')
    .sort((a,b)=>(a.days_until_expiry??999)-(b.days_until_expiry??999)),[pantry]);

  useEffect(()=>{
    api.get('/api/chores/leaderboard').then(d=>setLeaderboard(Array.isArray(d)?d:[])).catch(()=>{});
  },[chores]);

  const [smEvents,setSmEvents]=useState([]);
  useEffect(()=>{
    const loadHA=()=>api.get('/api/ha/events').then(d=>{if(Array.isArray(d))setHaEvents(d);}).catch(()=>{});
    const loadSm=()=>fetch('/api/ha/pull').then(r=>r.json()).then(d=>{if(Array.isArray(d))setSmEvents(d);}).catch(()=>{});
    loadHA(); loadSm();
    const fa=setInterval(loadHA,60000); const fb=setInterval(loadSm,60000);
    const es=new EventSource('/api/events/stream');
    es.addEventListener('activity',e=>{try{const ev=JSON.parse(e.data);setSmEvents(p=>[ev,...p].slice(0,10));}catch{}});
    es.addEventListener('refresh',()=>{loadHA();loadSm();});
    return()=>{clearInterval(fa);clearInterval(fb);es.close();};
  },[]);
  const allSmartEvents=useMemo(()=>[...smEvents,...haEvents].sort((a,b)=>new Date(b.created_at?.replace(' ','T'))-new Date(a.created_at?.replace(' ','T'))).slice(0,10),[smEvents,haEvents]);

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
                    setQaState(s=>({...s,[action.id]:(r.ok===false||r.error)?'error':'done'}));
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
            const n=ev.created_at?ev.created_at.replace(' ','T'):null;
            const ts=n?new Date(n.endsWith('Z')||n.includes('+')?n:n+'Z'):new Date();
            const ago=Math.round((Date.now()-ts.getTime())/60000);
            const agoStr=ago<1?'just now':ago<60?`${ago}m ago`:ago<1440?`${Math.round(ago/60)}h ago`:ago<2880?'yesterday':`${Math.round(ago/1440)}d ago`;
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

      {/* Bills due this week */}
      {billsDueSoon.length>0&&(
        <Card style={{marginBottom:12,padding:0,overflow:'hidden'}}>
          <div style={{padding:'10px 16px',fontSize:11,fontWeight:700,color:A.label3,textTransform:'uppercase',letterSpacing:'.07em',borderBottom:`1px solid ${A.sep}`}}>Bills Due This Week</div>
          {billsDueSoon.map((b,i)=>{
            const d=b.recurrence==='monthly'?b.due_day-now.getDate():daysUntil(b.due_date);
            return(
              <div key={b.id} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                <div style={{width:10,height:10,borderRadius:'50%',background:b.color||'#3B82F6',flexShrink:0}}/>
                <span style={{flex:1,fontSize:14,fontWeight:600,color:A.label1}}>{b.name}</span>
                {Number(b.amount)>0&&<span style={{fontSize:13,color:A.label3,fontVariantNumeric:'tabular-nums'}}>${Number(b.amount).toFixed(2)}</span>}
                <span style={{fontSize:12,color:d===0?A.red:A.amber,fontWeight:600,flexShrink:0}}>{d===0?'Today':`${d}d`}</span>
              </div>
            );
          })}
        </Card>
      )}
      {projectsDueSoon.length>0&&(
        <Card style={{marginBottom:12,padding:0,overflow:'hidden'}}>
          <div style={{padding:'10px 16px',fontSize:11,fontWeight:700,color:A.label3,textTransform:'uppercase',letterSpacing:'.07em',borderBottom:`1px solid ${A.sep}`}}>Projects Due This Week</div>
          {projectsDueSoon.map((p,i)=>{
            const d=daysUntil(p.due_date);
            return(
              <div key={p.id} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                <span style={{flex:1,fontSize:14,fontWeight:600,color:A.label1}}>{p.title}</span>
                {p.cost_estimate>0&&<span style={{fontSize:13,color:A.label3}}>${Number(p.cost_estimate).toLocaleString()}</span>}
                <span style={{fontSize:12,color:d===0?A.red:A.amber,fontWeight:600,flexShrink:0}}>{d===0?'Today':`${d}d`}</span>
              </div>
            );
          })}
        </Card>
      )}
      {subsBillingSoon.length>0&&(
        <Card style={{marginBottom:12,padding:0,overflow:'hidden'}}>
          <div style={{padding:'10px 16px',fontSize:11,fontWeight:700,color:A.label3,textTransform:'uppercase',letterSpacing:'.07em',borderBottom:`1px solid ${A.sep}`}}>Subscriptions Billing This Week</div>
          {subsBillingSoon.map((s,i)=>{
            const d=daysUntil(s.next_billing);
            return(
              <div key={s.id} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                <div style={{width:10,height:10,borderRadius:'50%',background:s.color||'#5856D6',flexShrink:0}}/>
                <span style={{flex:1,fontSize:14,fontWeight:600,color:A.label1}}>{s.name}</span>
                <span style={{fontSize:13,color:A.label3}}>${Number(s.amount||0).toFixed(2)}</span>
                <span style={{fontSize:12,color:d===0?A.red:A.amber,fontWeight:600,flexShrink:0}}>{d===0?'Today':`${d}d`}</span>
              </div>
            );
          })}
        </Card>
      )}
      {expiringPantry.length>0&&(
        <Card style={{marginBottom:12,padding:0,overflow:'hidden'}}>
          <div style={{padding:'10px 16px',fontSize:11,fontWeight:700,color:A.label3,textTransform:'uppercase',letterSpacing:'.07em',borderBottom:`1px solid ${A.sep}`}}>Pantry Expiring</div>
          {expiringPantry.slice(0,5).map((p,i)=>{
            const isExpired=p.expiry_status==='expired';
            return(
              <div key={p.id} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                <span style={{flex:1,fontSize:14,fontWeight:600,color:A.label1}}>{p.name}</span>
                <span style={{fontSize:12,color:A.label4}}>{p.quantity}{p.unit?` ${p.unit}`:''} · {p.location||'Pantry'}</span>
                <span style={{fontSize:12,color:isExpired?A.red:A.amber,fontWeight:600,flexShrink:0}}>{isExpired?'Expired':p.days_until_expiry===0?'Today':`${p.days_until_expiry}d`}</span>
              </div>
            );
          })}
        </Card>
      )}

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

  const calMap={kith:A.green,packages:'#A0522D',bills:'#3B82F6',vehicles:'#8B5CF6'};
  icsSources.forEach(s=>{calMap[`ics:${s.name}`]=s.color;});
  useEffect(()=>{
    setCalFilters(prev=>{
      const next={kith:prev.kith??true,packages:prev.packages??true,bills:prev.bills??true,vehicles:prev.vehicles??true};
      icsSources.forEach(s=>{const k=`ics:${s.name}`;next[k]=prev[k]??true;});
      return next;
    });
  },[icsSources]);
  const calLabels={kith:'Kith',packages:'Packages',bills:'Bills',vehicles:'Vehicles'};
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
        api.get('/api/events').then(d=>{if(Array.isArray(d))setEvents(d);});
        toastAdd('Event saved');
      }
      setDrawerOpen(false);
    } catch(err) {
      toastAdd('Failed to save event','red');
    }
  };
  const deleteEvent=async(id,scope='one')=>{
    const r=await api.del(`/api/events/${id}?scope=${scope}`).catch(()=>null);
    if(r?.error){toastAdd('Failed to delete event','red');return;}
    if(scope==='one') setEvents(p=>p.filter(e=>e.id!==id));
    else if(scope==='all'){ const ev=events.find(e=>e.id===id); const sid=String(ev?.external_id||id); setEvents(p=>p.filter(e=>String(e.id)!==sid&&String(e.external_id)!==sid)); }
    else if(scope==='future'){ const ev=events.find(e=>e.id===id); const sid=String(ev?.external_id||id); setEvents(p=>p.filter(e=>!((String(e.id)===sid||String(e.external_id)===sid)&&e.date>=ev.date))); }
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
              {selectedEvent.source==='package'?(
                <div style={{fontSize:13,color:A.label4,textAlign:'center'}}>Manage this in the Packages section</div>
              ):selectedEvent.source==='bill'?(
                <div style={{fontSize:13,color:A.label4,textAlign:'center'}}>Manage this in the Bills section</div>
              ):selectedEvent.source==='vehicle'?(
                <div style={{fontSize:13,color:A.label4,textAlign:'center'}}>Manage this in the Vehicles section</div>
              ):deleteConfirm?(
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
      if(!d||!Array.isArray(d.pending)) return;
      setPending(d.pending);
      setRecent(d.recent||[]);
      setInboxCount(d.pending.length);
    }).catch(()=>{});
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
      api.get('/api/events').then(d=>{if(Array.isArray(d))setEvents(d);});
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
          <p style={{color:A.label4,fontSize:15,marginTop:4}}>Appointments and events detected from email</p>
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
                <div style={{fontSize:11,color:A.label4,marginBottom:6,textTransform:'uppercase',letterSpacing:'.04em',fontWeight:500}}>From email</div>
                <div style={{fontSize:16,fontWeight:600,color:A.label1,marginBottom:14}}>{item.subject}</div>
                <div style={{background:A.systemBg,borderRadius:A.rSm,padding:'14px 16px',marginBottom:14}}>
                  <div style={{fontSize:17,fontWeight:700,color:A.label1,marginBottom:10,letterSpacing:'-.01em'}}>{item.event_name}</div>
                  <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <span style={{fontSize:11,fontWeight:600,color:A.label4,textTransform:'uppercase',letterSpacing:'.05em'}}>Date</span>
                      <input type="date"
                        value={editDates[item.id]??(isValidDate(item.event_date)?item.event_date:localDate())}
                        onChange={e=>setEditDates(p=>({...p,[item.id]:e.target.value}))}
                        style={{fontSize:13,color:A.label1,background:A.cardBg,border:`1px solid ${!isValidDate(item.event_date)&&!editDates[item.id]?A.amber:A.sep}`,borderRadius:A.rXs,padding:'5px 8px',cursor:'pointer'}}
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
        <div style={{background:A.inputBg,borderRadius:A.rSm,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',border:`1px solid ${A.sep}`}}>
          <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:14,color:A.green,wordBreak:'break-all'}}>{fwdAddress}</span>
          <button onClick={()=>{navigator.clipboard.writeText(fwdAddress);toastAdd('Copied','blue');}} style={{background:A.inputBg,border:`1px solid ${A.sep}`,color:A.label2,borderRadius:6,padding:'5px 12px',fontSize:12,cursor:'pointer',flexShrink:0,marginLeft:12}}>Copy</button>
        </div>
      </Card>

      <UploadCard toastAdd={toastAdd} onUploaded={()=>api.get('/api/inbox').then(d=>{if(!d||!Array.isArray(d.pending))return;setPending(d.pending);setRecent(d.recent||[]);setInboxCount(d.pending.length);}).catch(()=>{})}/>

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
function ChoresScreen({chores,setChores,goals=[],members=[],toastAdd}){
  const isMobile=useIsMobile();
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [editChore,setEditChore]=useState(null);
  const [form,setForm]=useState({name:'',recur:'Weekly',day:'Monday',start:'',points:1,outdoor:false,goal_id:'',goal_amount:1,member_id:''});
  const [choreConfetti,setChoreConfetti]=useState(false);
  const [tab,setTab]=useState('chores');
  const [choreHistory,setChoreHistory]=useState([]);
  const [photoChoreId,setPhotoChoreId]=useState(null);
  const [photoFile,setPhotoFile]=useState(null);
  useEffect(()=>{
    if(tab==='history') api.get('/api/chores/history?limit=50').then(d=>Array.isArray(d)&&setChoreHistory(d)).catch(()=>{});
  },[tab]);

  const openNew=()=>{
    setEditChore(null);
    setForm({name:'',recur:'Weekly',day:'Monday',start:'',points:1,outdoor:false,goal_id:'',goal_amount:1,member_id:''});
    setDrawerOpen(true);
  };

  const openEdit=c=>{
    let recur='Weekly',day='Monday';
    const rec=c.recurrence||'';
    if(rec==='Daily') recur='Daily';
    else if(rec==='Bi-weekly') recur='Bi-weekly';
    else if(rec==='Monthly'||rec.startsWith('Monthly')) recur='Monthly';
    else if(rec.startsWith('Weekly')) {
      recur='Weekly';
      const m=rec.match(/\((\w+)\)/);
      if(m) day=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].find(d=>d.startsWith(m[1]))||'Monday';
    } else recur='Custom';
    setEditChore(c);
    setForm({name:c.name,recur,day,start:c.next_due||'',points:c.points||1,outdoor:!!c.outdoor,goal_id:c.goal_id||'',goal_amount:c.goal_amount||1,member_id:c.member_id||''});
    setDrawerOpen(true);
  };

  const saveChore=async()=>{
    if(!form.name.trim()){toastAdd('Name required','red');return;}
    const recurrence=form.recur==='Weekly'?`Weekly (${form.day.slice(0,3)})`:form.recur;
    const body={name:form.name,recurrence,next_due:form.start,points:form.points,outdoor:form.outdoor?1:0,goal_id:form.goal_id||null,goal_amount:Number(form.goal_amount)||1,member_id:form.member_id||null};
    try{
      if(editChore){
        const updated=await api.put(`/api/chores/${editChore.id}`,body);
        if(updated.error){toastAdd(updated.error,'red');return;}
        setChores(p=>p.map(c=>c.id===editChore.id?updated:c));
        toastAdd('Chore updated');
      } else {
        const newChore=await api.post('/api/chores',{...body,start:form.start});
        if(newChore.error){toastAdd(newChore.error,'red');return;}
        setChores(p=>[...p,newChore]);
        toastAdd('Chore added');
      }
      setDrawerOpen(false);
      setEditChore(null);
      setForm({name:'',recur:'Weekly',day:'Monday',start:'',points:1,outdoor:false,goal_id:'',goal_amount:1,member_id:''});
    }catch{toastAdd('Failed to save chore','red');}
  };

  const deleteChore=async id=>{
    try{
      await api.del(`/api/chores/${id}`);
      setChores(p=>p.filter(c=>c.id!==id));
      toastAdd('Deleted','blue');
    }catch{toastAdd('Failed to delete','red');}
  };

  const toggleDone=async c=>{
    try{
      const result=await api.put(`/api/chores/${c.id}/done`);
      if(result.error){toastAdd(result.error,'red');return;}
      setChores(p=>p.map(x=>x.id===c.id?{...x,done:result.done,next_due:result.next_due,status:result.status,streak:result.streak??x.streak}:x));
      if(result.completed||result.done){
        toastAdd(`${c.name} done!`);
        setChoreConfetti(true);
        setTimeout(()=>setChoreConfetti(false),2500);
        setPhotoChoreId(c.id);
        setPhotoFile(null);
      }
    }catch{toastAdd('Failed to update','red');}
  };

  const submitChorePhoto=async()=>{
    if(!photoFile||!photoChoreId) return;
    const reader=new FileReader();
    reader.onload=async(e)=>{
      try{
        const r=await api.post(`/api/chores/${photoChoreId}/photo`,{data:e.target.result,filename:photoFile.name});
        if(r?.error){toastAdd(r.error||'Failed to save photo','red');}else{toastAdd('Photo saved!','green');}
      }catch{toastAdd('Failed to save photo','red');}
      setPhotoChoreId(null);setPhotoFile(null);
    };
    reader.readAsDataURL(photoFile);
  };

  const statePill=s=>{
    if(s==='due')     return{color:A.amber,bg:A.amberFill,label:'Due today'};
    if(s==='overdue') return{color:A.red,  bg:A.redFill,  label:'Overdue'};
    return                  {color:A.green,bg:A.greenFill,label:'Upcoming'};
  };

  const histDateLabel=ts=>{
    const d=new Date(ts);
    const today=new Date(); today.setHours(0,0,0,0);
    const yesterday=new Date(today); yesterday.setDate(yesterday.getDate()-1);
    const dt=new Date(d); dt.setHours(0,0,0,0);
    if(dt.getTime()===today.getTime()) return 'Today';
    if(dt.getTime()===yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  };

  const histWeekGroups=()=>{
    const groups=[];
    const seenWeeks=new Map();
    for(const row of choreHistory){
      const d=new Date(row.completed_at);
      const weekStart=new Date(d);
      weekStart.setHours(0,0,0,0);
      weekStart.setDate(weekStart.getDate()-weekStart.getDay());
      const wk=weekStart.toISOString().slice(0,10);
      if(!seenWeeks.has(wk)){seenWeeks.set(wk,[]);groups.push({week:weekStart,key:wk,items:seenWeeks.get(wk)});}
      seenWeeks.get(wk).push(row);
    }
    return groups;
  };

  const thisWeekCount=()=>{
    const now=new Date(); now.setHours(0,0,0,0);
    const weekStart=new Date(now); weekStart.setDate(now.getDate()-now.getDay());
    return choreHistory.filter(r=>new Date(r.completed_at)>=weekStart).length;
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
        {tab==='chores'&&<Btn onClick={openNew}>+ Add Chore</Btn>}
      </div>
      <div style={{display:'flex',gap:4,background:A.inputBg,borderRadius:A.rSm,padding:3,marginBottom:20,width:'fit-content'}}>
        {[{id:'chores',label:'Chores'},{id:'history',label:'History'}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:'7px 18px',borderRadius:A.rXs,border:'none',cursor:'pointer',fontSize:14,fontWeight:tab===t.id?700:500,background:tab===t.id?A.cardBg:'transparent',color:tab===t.id?A.label1:A.label3,boxShadow:tab===t.id?A.shadowSm:'none',transition:'all .15s'}}>{t.label}</button>
        ))}
      </div>

      {tab==='history'&&(
        <div>
          {choreHistory.length===0?(
            <Card style={{padding:'40px 24px',textAlign:'center'}}>
              <div style={{fontSize:15,color:A.label3,fontWeight:500}}>No completions yet — complete a chore to see history here.</div>
            </Card>
          ):(
            <div>
              <div style={{fontSize:14,color:A.label3,fontWeight:500,marginBottom:16}}>{thisWeekCount()} completion{thisWeekCount()!==1?'s':''} this week</div>
              {histWeekGroups().map(({week,key,items})=>(
                <div key={key} style={{marginBottom:24}}>
                  <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.07em',marginBottom:8}}>
                    Week of {week.toLocaleDateString(undefined,{month:'short',day:'numeric'})}
                  </div>
                  <Card style={{overflow:'hidden',padding:0}}>
                    {items.map((row,i)=>(
                      <div key={row.id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:15,fontWeight:600,color:A.label1}}>{row.chore_name||'Unknown chore'}</div>
                          <div style={{fontSize:12,color:A.label4,marginTop:1}}>{histDateLabel(row.completed_at)}{row.member_name?` · ${row.member_name}`:''}</div>
                        </div>
                        <div style={{display:'flex',gap:3,alignItems:'center',flexShrink:0}}>
                          {Array.from({length:row.points||1},(_,pi)=>(
                            <div key={pi} style={{width:8,height:8,borderRadius:'50%',background:A.amber}}/>
                          ))}
                        </div>
                      </div>
                    ))}
                  </Card>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab==='chores'&&<Card>
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
                    <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
                      <span style={{fontSize:15,fontWeight:600,textDecoration:c.done?'line-through':'none',color:c.done?A.label4:A.label1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</span>
                      {(c.streak||0)>=2&&!c.done&&<span style={{fontSize:11,fontWeight:700,color:A.amber,background:A.amberFill,padding:'2px 7px',borderRadius:A.rPill,flexShrink:0}}>{c.streak}×</span>}
                    </div>
                    <Badge color={p.color} bg={p.bg}>{p.label}</Badge>
                  </div>
                  <div style={{fontSize:13,color:A.label4,marginBottom:10}}>{c.recurrence} · Next: {c.next_due||'—'}{c.member_name&&<span style={{marginLeft:8}}>· {c.member_name}</span>}</div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    {c.member_color&&<div style={{width:22,height:22,borderRadius:'50%',background:c.member_color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'#fff',flexShrink:0}}>{c.member_initials}</div>}
                    <button onClick={()=>toggleDone(c)} style={{flex:1,padding:'10px 0',borderRadius:A.rXs,border:'none',background:c.done?A.inputBg:A.green,color:c.done?A.label3:'#fff',fontSize:14,fontWeight:700,cursor:'pointer'}}>
                      {c.done?'Undo':'Mark Done'}
                    </button>
                    <button onClick={()=>openEdit(c)} style={{background:A.inputBg,border:'none',borderRadius:A.rXs,color:A.label2,fontSize:13,cursor:'pointer',fontWeight:500,padding:'10px 16px'}}>Edit</button>
                    <button onClick={()=>deleteChore(c.id)} style={{background:A.redFill,border:'none',borderRadius:A.rXs,color:A.red,fontSize:13,cursor:'pointer',fontWeight:600,padding:'10px 14px'}}>Delete</button>
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
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    {c.member_color&&<div title={c.member_name||''} style={{width:22,height:22,borderRadius:'50%',background:c.member_color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'#fff',flexShrink:0}}>{c.member_initials}</div>}
                    <span style={{fontSize:15,fontWeight:500,textDecoration:c.done?'line-through':'none',color:c.done?A.label4:A.label1}}>{c.name}</span>
                    {(c.streak||0)>=2&&!c.done&&<span style={{fontSize:11,fontWeight:700,color:A.amber,background:A.amberFill,padding:'2px 6px',borderRadius:A.rPill}}>{c.streak}×</span>}
                  </div>
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
      </Card>}
      {photoChoreId&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
          <div style={{background:A.cardBg,borderRadius:A.r,padding:24,width:'100%',maxWidth:340,boxShadow:A.shadowLg}}>
            <div style={{fontSize:16,fontWeight:700,color:A.label1,marginBottom:6}}>Add a completion photo?</div>
            <div style={{fontSize:13,color:A.label4,marginBottom:16}}>Optional — capture proof of completion.</div>
            <input type="file" accept="image/*" capture="environment" onChange={e=>setPhotoFile(e.target.files?.[0]||null)} style={{fontSize:14,marginBottom:16,width:'100%'}}/>
            <div style={{display:'flex',gap:8}}>
              <Btn onClick={submitChorePhoto} full disabled={!photoFile}>Add Photo</Btn>
              <Btn variant="ghost" onClick={()=>{setPhotoChoreId(null);setPhotoFile(null);}} full>Skip</Btn>
            </div>
          </div>
        </div>
      )}
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
        {members.length>0&&(
          <FormGroup label="Assign to (optional)">
            <div style={{padding:'12px 16px'}}>
              <select value={form.member_id} onChange={e=>setForm(p=>({...p,member_id:e.target.value}))}
                style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
                <option value="">Anyone</option>
                {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </FormGroup>
        )}
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
function GroceryScreen({grocery,setGrocery,meals,setMeals,recipes=[],toastAdd}){
  const isMobile=useIsMobile();
  const [storeMode,setStoreMode]=useState(false);
  const [input,setInput]=useState('');
  const [catInput,setCatInput]=useState('');
  const [qtyInput,setQtyInput]=useState('');
  const [editingField,setEditingField]=useState(null); // {day, field:'breakfast'|'lunch'|'dinner'}
  const [mealInput,setMealInput]=useState('');
  const [removing,setRemoving]=useState(new Set());
  const [history,setHistory]=useState([]);
  const inputRef=useRef();
  const removeTimers=useRef({});
  const [recipePickerTarget,setRecipePickerTarget]=useState(null);
  const [recipeSearch,setRecipeSearch]=useState('');
  const [fromMealsLoading,setFromMealsLoading]=useState(false);
  const [aiMealLoading,setAiMealLoading]=useState(false);

  useEffect(()=>()=>{Object.values(removeTimers.current).forEach(clearTimeout)},[]);
  useEffect(()=>{api.get('/api/grocery/history').then(r=>Array.isArray(r)&&setHistory(r)).catch(()=>{})},[]);

  const addFromHistory=async name=>{
    try{
      const newItem=await api.post('/api/grocery',{name});
      setGrocery(p=>[...p,newItem]);
      toastAdd(`${name} added`);
    }catch{toastAdd('Failed to add','red');}
  };

  const addItem=async()=>{
    if(!input.trim()) return;
    const body={name:input.trim()};
    if(catInput.trim()) body.category=catInput.trim();
    if(qtyInput.trim()) body.qty=qtyInput.trim();
    try{
      const newItem=await api.post('/api/grocery',body);
      setGrocery(p=>[...p,newItem]);
      setInput('');setQtyInput('');
      inputRef.current?.focus();
    }catch{toastAdd('Failed to add item','red');}
  };
  const toggle=async id=>{
    let result;
    try{result=await api.put(`/api/grocery/${id}/toggle`);}
    catch{toastAdd('Failed to update item','red');return;}
    if(result?.error){toastAdd('Failed to update item','red');return;}
    setGrocery(p=>p.map(i=>i.id===id?{...i,checked:result.checked}:i));
    if(result.checked){
      // Start removal countdown — item fades then deletes after 1.2s
      removeTimers.current[id]=setTimeout(()=>{
        setRemoving(s=>{const n=new Set(s);n.add(id);return n;});
        const fadeTimer=setTimeout(async()=>{
          await api.del(`/api/grocery/${id}`);
          setGrocery(p=>p.filter(i=>i.id!==id));
          setRemoving(s=>{const n=new Set(s);n.delete(id);return n;});
          delete removeTimers.current[`${id}_fade`];
        },350);
        removeTimers.current[`${id}_fade`]=fadeTimer;
      },1200);
    } else {
      // User unchecked — cancel both the outer delay and the in-progress fade timer
      clearTimeout(removeTimers.current[id]);
      clearTimeout(removeTimers.current[`${id}_fade`]);
      delete removeTimers.current[id];
      delete removeTimers.current[`${id}_fade`];
      setRemoving(s=>{const n=new Set(s);n.delete(id);return n;});
    }
  };
  const saveMeal=async(day,field)=>{
    const current=(meals||[]).find(m=>m.day===day)||{};
    const body={
      meal:     field==='dinner'    ?mealInput:(current.meal||''),
      breakfast:field==='breakfast' ?mealInput:(current.breakfast||''),
      lunch:    field==='lunch'     ?mealInput:(current.lunch||''),
    };
    await api.put(`/api/meals/${day}`,body);
    setMeals(p=>p.map(m=>m.day===day?{...m,...body}:m));
    setEditingField(null); setMealInput('');
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
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {checked.length>0&&<span style={{fontSize:13,color:A.label4}}>{checked.length} in cart</span>}
            {(unchecked.length>0||checked.length>0)&&<button onClick={()=>setStoreMode(true)} style={{fontSize:13,fontWeight:600,padding:'7px 14px',borderRadius:A.rSm,border:`1px solid ${A.sep}`,background:A.cardBg,color:A.label2,cursor:'pointer'}}>Store</button>}
          </div>
        </div>
        <div style={{display:'flex',gap:10,marginBottom:8}}>
          <Inp value={input} onChange={e=>setInput(e.target.value)} placeholder="Add item..." onKeyDown={e=>e.key==='Enter'&&addItem()} inputRef={inputRef}/>
          <Btn onClick={addItem} style={{flexShrink:0}}>Add</Btn>
        </div>
        <div style={{display:'flex',gap:8,marginBottom:8}}>
          <Inp value={catInput} onChange={e=>setCatInput(e.target.value)} placeholder="Category (e.g. Produce)" onKeyDown={e=>e.key==='Enter'&&addItem()} style={{flex:1}}/>
          <Inp value={qtyInput} onChange={e=>setQtyInput(e.target.value)} placeholder="Qty (e.g. 2 lbs)" onKeyDown={e=>e.key==='Enter'&&addItem()} style={{width:130,flexShrink:0}}/>
        </div>
        {history.filter(h=>!unchecked.some(i=>i.name.toLowerCase()===h.name.toLowerCase())).slice(0,6).length>0&&(
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:14}}>
            {history.filter(h=>!unchecked.some(i=>i.name.toLowerCase()===h.name.toLowerCase())).slice(0,6).map(h=>{
              const display=h.name.charAt(0).toUpperCase()+h.name.slice(1);
              return(
              <button key={h.name} onClick={()=>addFromHistory(display)}
                style={{fontSize:13,padding:'5px 11px',borderRadius:A.rPill,border:`1px solid ${A.sep}`,background:A.cardBg,color:A.label2,cursor:'pointer',fontWeight:500}}>
                {display}
              </button>
            );})}
          </div>
        )}
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
                        <div style={{flex:1,minWidth:0}}>
                          {item.qty&&<div style={{fontSize:11,fontWeight:600,color:A.label4,letterSpacing:'.02em'}}>{item.qty}</div>}
                          <span style={{fontSize:15,color:A.label1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'block'}}>{item.name}</span>
                        </div>
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
            <div style={{fontSize:12,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6,paddingLeft:4}}>In Cart ({checked.length})</div>
            <Card>
              {checked.map((item,idx)=>(
                <div key={item.id} onClick={()=>toggle(item.id)}
                  style={{display:'flex',alignItems:'center',gap:14,padding:'13px 16px',borderTop:idx>0?`1px solid ${A.sep}`:'none',cursor:'pointer',opacity:removing.has(item.id)?0:0.45,transform:removing.has(item.id)?'translateX(20px)':'none',transition:'opacity .3s ease,transform .3s ease',overflow:'hidden',maxHeight:removing.has(item.id)?0:80}}>
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
        <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:4}}>
          <h2 style={{fontSize:18,fontWeight:700,letterSpacing:'-.01em'}}>Meal Plan</h2>
          <div style={{display:'flex',gap:10,alignItems:'center'}}>
          <button onClick={async()=>{
            setAiMealLoading(true);
            try{
              const r=await api.post('/api/meals/suggest',{});
              if(r?.error){toastAdd(r.error||'AI unavailable','red');}
              else if(Array.isArray(r?.meals)){
                const DAY_DATES={Monday:0,Tuesday:1,Wednesday:2,Thursday:3,Friday:4,Saturday:5,Sunday:6};
                const DAY_ABBR={Monday:'Mon',Tuesday:'Tue',Wednesday:'Wed',Thursday:'Thu',Friday:'Fri',Saturday:'Sat',Sunday:'Sun'};
                for(const m of r.meals){
                  const abbr=DAY_ABBR[m.day]||m.day;
                  await api.put(`/api/meals/${abbr}`,{meal:m.meal,breakfast:'',lunch:''}).catch(()=>{});
                  setMeals(p=>p.map(mx=>mx.day===abbr?{...mx,meal:m.meal}:mx));
                }
                toastAdd('Week planned!','green');
              }
            }catch{toastAdd('AI unavailable','red');}
            setAiMealLoading(false);
          }} disabled={aiMealLoading} style={{fontSize:12,color:aiMealLoading?A.label5:A.indigo,background:'none',border:'none',cursor:aiMealLoading?'default':'pointer',fontWeight:500,flexShrink:0}}>{aiMealLoading?'Planning…':'Suggest week'}</button>
          <button onClick={async()=>{
            setFromMealsLoading(true);
            try{
              const r=await api.post('/api/grocery/from-meals',{days:['Mon','Tue','Wed','Thu','Fri','Sat','Sun']});
              if(r?.error){toastAdd(r.error||'Failed','red');}
              else if(r.added===0&&!r.skipped){toastAdd('No linked recipes — link recipes to meal slots first','blue');}
              else if(r.added===0){toastAdd('All ingredients already on list','blue');}
              else{
                const fresh=await api.get('/api/grocery');
                if(Array.isArray(fresh)) setGrocery(fresh);
                toastAdd(`Added ${r.added} item${r.added!==1?'s':''} to grocery list`);
              }
            }catch{toastAdd('Failed','red');}
            setFromMealsLoading(false);
          }} style={{fontSize:12,color:A.blue,background:'none',border:'none',cursor:'pointer',fontWeight:500,flexShrink:0}}>{fromMealsLoading?'Adding…':'Add to grocery'}</button>
          </div>
        </div>
        <p style={{color:A.label4,fontSize:14,marginBottom:14}}>This week</p>
        <Card>
          {(meals||[]).map((m,i)=>{
            const dayName=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()];
            const isToday=m.day===dayName;
            const recipeIdFor=field=>field==='dinner'?m.dinner_recipe_id:field==='breakfast'?m.breakfast_recipe_id:m.lunch_recipe_id;
            const recipeIdKey=field=>field==='dinner'?'dinner_recipe_id':field==='breakfast'?'breakfast_recipe_id':'lunch_recipe_id';
            return(
              <div key={m.day} style={{padding:'12px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none',background:isToday?A.blueFill:'transparent'}}>
                <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
                  <span style={{fontSize:13,fontWeight:isToday?700:500,color:isToday?A.blue:A.label4,width:30,flexShrink:0,paddingTop:2}}>{m.day}</span>
                  <div style={{flex:1,display:'flex',flexDirection:'column',gap:5}}>
                    {[['breakfast','B',m.breakfast],['lunch','L',m.lunch],['dinner','D',m.meal]].map(([field,lbl,val])=>{
                      const isEditing=editingField?.day===m.day&&editingField?.field===field;
                      const linkedRecipeId=recipeIdFor(field);
                      const linkedRecipe=linkedRecipeId?(recipes||[]).find(r=>r.id===linkedRecipeId):null;
                      return(
                        <div key={field} style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontSize:10,fontWeight:700,color:A.label5,width:12,flexShrink:0}}>{lbl}</span>
                          {isEditing?(
                            <>
                              <Inp value={mealInput} onChange={e=>setMealInput(e.target.value)} placeholder={`${field}...`} onKeyDown={e=>e.key==='Enter'&&saveMeal(m.day,field)} style={{fontSize:13,flex:1}}/>
                              <Btn sm onClick={()=>saveMeal(m.day,field)}>OK</Btn>
                              <button onClick={()=>{setEditingField(null);setMealInput('');}} style={{background:'none',border:'none',color:A.label4,fontSize:12,cursor:'pointer'}}>✕</button>
                            </>
                          ):(
                            <>
                              <span style={{flex:1,fontSize:14,color:val?A.label1:A.label5,fontStyle:val?'normal':'italic',minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{val||'—'}</span>
                              {linkedRecipe?(
                                <span style={{display:'flex',alignItems:'center',gap:3,fontSize:11,color:A.green,fontWeight:600,flexShrink:0}}>
                                  {linkedRecipe.name.length>12?linkedRecipe.name.slice(0,12)+'…':linkedRecipe.name}
                                  <button onClick={async()=>{const body={[recipeIdKey(field)]:null};await api.put(`/api/meals/${m.day}`,body).catch(()=>{});setMeals(p=>p.map(mx=>mx.day===m.day?{...mx,[recipeIdKey(field)]:null}:mx));}} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:11,padding:'0 2px',lineHeight:1}}>✕</button>
                                </span>
                              ):(
                                <button onClick={()=>{setRecipePickerTarget({day:m.day,field});setRecipeSearch('');}} style={{background:'none',border:'none',color:A.label4,fontSize:11,cursor:'pointer',fontWeight:500,flexShrink:0}}>Recipe</button>
                              )}
                              <button onClick={()=>{setEditingField({day:m.day,field});setMealInput(val||'');}} style={{background:'none',border:'none',color:A.blue,fontSize:12,cursor:'pointer',fontWeight:500,flexShrink:0}}>{val?'Edit':'Add'}</button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </Card>
      </div>
      {storeMode&&(()=>{
        const storeUnchecked=(grocery||[]).filter(i=>!i.checked);
        const storeChecked=(grocery||[]).filter(i=>i.checked);
        const storeCats=[...new Set(storeUnchecked.map(i=>i.category||'Other'))];
        return(
          <div style={{position:'fixed',inset:0,zIndex:500,background:A.systemBg,overflowY:'auto',paddingBottom:80}}>
            <div style={{padding:'24px 20px 0'}}>
              <h1 style={{fontSize:32,fontWeight:800,letterSpacing:'-.04em',marginBottom:20}}>Store Mode</h1>
              {storeCats.map(cat=>{
                const catItems=storeUnchecked.filter(i=>(i.category||'Other')===cat);
                return(
                  <div key={cat} style={{marginBottom:24}}>
                    <div style={{fontSize:14,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{cat}</div>
                    {catItems.map(item=>(
                      <div key={item.id} onClick={()=>toggle(item.id)}
                        style={{display:'flex',alignItems:'center',gap:16,minHeight:64,padding:'12px 16px',borderRadius:A.rSm,background:A.cardBg,marginBottom:6,cursor:'pointer',boxShadow:A.shadowSm}}>
                        <div style={{width:28,height:28,borderRadius:'50%',border:`2px solid ${A.sepOpaque}`,flexShrink:0}}/>
                        <span style={{fontSize:22,fontWeight:600,color:A.label1}}>{item.name}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {storeChecked.length>0&&(
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:14,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>In Cart ({storeChecked.length})</div>
                  {storeChecked.map(item=>(
                    <div key={item.id} onClick={()=>toggle(item.id)}
                      style={{display:'flex',alignItems:'center',gap:16,minHeight:64,padding:'12px 16px',borderRadius:A.rSm,background:A.cardBg,marginBottom:6,cursor:'pointer',opacity:0.45,boxShadow:A.shadowSm}}>
                      <div style={{width:28,height:28,borderRadius:'50%',background:A.green,border:`2px solid ${A.green}`,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <svg width="14" height="10" viewBox="0 0 12 9" fill="none"><path d="M1 4.5L4.5 8L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                      <span style={{fontSize:22,fontWeight:600,color:A.label4,textDecoration:'line-through'}}>{item.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={()=>setStoreMode(false)}
              style={{position:'fixed',bottom:24,right:24,zIndex:501,background:A.blue,color:'#fff',border:'none',borderRadius:A.rPill,padding:'14px 28px',fontSize:15,fontWeight:700,cursor:'pointer',boxShadow:A.shadowLg}}>
              Exit
            </button>
          </div>
        );
      })()}

      {recipePickerTarget&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={()=>setRecipePickerTarget(null)}>
          <div style={{background:A.cardBg,borderRadius:A.r,padding:24,width:'100%',maxWidth:360,boxShadow:A.shadowLg,maxHeight:'70vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:17,fontWeight:700,color:A.label1,marginBottom:12}}>Link a recipe</div>
            <Inp value={recipeSearch} onChange={e=>setRecipeSearch(e.target.value)} placeholder="Search recipes…" style={{marginBottom:12}}/>
            <div style={{overflowY:'auto',flex:1}}>
              {(recipes||[]).filter(r=>r.name.toLowerCase().includes(recipeSearch.toLowerCase())).map(r=>(
                <button key={r.id} onClick={async()=>{
                  const key=recipePickerTarget.field==='dinner'?'dinner_recipe_id':recipePickerTarget.field==='breakfast'?'breakfast_recipe_id':'lunch_recipe_id';
                  await api.put(`/api/meals/${recipePickerTarget.day}`,{[key]:r.id}).catch(()=>{});
                  setMeals(p=>p.map(m=>m.day===recipePickerTarget.day?{...m,[key]:r.id}:m));
                  setRecipePickerTarget(null);
                }} style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:`1px solid ${A.sep}`,borderRadius:A.rSm,marginBottom:6,cursor:'pointer',fontSize:14,color:A.label1,fontWeight:500}}>
                  {r.name}
                </button>
              ))}
              {(recipes||[]).filter(r=>r.name.toLowerCase().includes(recipeSearch.toLowerCase())).length===0&&(
                <div style={{fontSize:14,color:A.label4,textAlign:'center',padding:'20px 0'}}>No recipes found</div>
              )}
            </div>
            <Btn variant="ghost" onClick={()=>setRecipePickerTarget(null)} full style={{marginTop:12}}>Cancel</Btn>
          </div>
        </div>
      )}
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
    if(!confirm('Generate a new webhook secret? You will need to update your forwarding service with the new value.')) return;
    setLoading(true);
    const r=await api.put('/api/settings/webhook-secret',{});
    setLoading(false);
    if(r?.secret){setSecret(r.secret);setRevealed(true);toastAdd('New secret generated — update your forwarding service','blue');}
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
      <div style={{fontSize:12,color:A.label5,marginTop:8}}>After regenerating, update your forwarding service with the new value.</div>
    </div>
  );
}

/* ── Settings ────────────────────────────────────────────────────────── */
function SettingsScreen({toastAdd,icsSources,setIcsSources,onDisplay,photos,setPhotos,clockFormat,setClockFormat,nightModeStart,setNightModeStart,nightModeEnd,setNightModeEnd,setRefreshMs,parseRefreshMs,setQuickActions,setRotationMs,setWifiQrData,darkMode,onDarkMode}){
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
  const [haDiscovering,setHaDiscovering]=useState(false);
  const [haDiscovered,setHaDiscovered]=useState(null); // {moen:{all,map}, unifi:{all,map}}
  const [haMoenMap,setHaMoenMap]=useState({flow:'',pressure:'',daily:'',mode:'',alert:''});
  const [haUnifiMap,setHaUnifiMap]=useState({clients:'',rx:'',tx:''});
  const [haMoenSource,setHaMoenSource]=useState('direct'); // 'ha' or 'direct'
  const [haUnifiSource,setHaUnifiSource]=useState('direct');
  const [haPersonIds,setHaPersonIds]=useState([]);
  const [haClimateEntity,setHaClimateEntity]=useState('');
  const [haMediaEntity,setHaMediaEntity]=useState('');
  const [haSensorEntities,setHaSensorEntities]=useState('');
  const [presenceSource,setPresenceSource]=useState('both');
  const [homeyDiscovering,setHomeyDiscovering]=useState(false);
  const [homeyDiscovered,setHomeyDiscovered]=useState(null); // {users,thermostats,allDevices}
  const [homeyPersonIds,setHomeyPersonIds]=useState([]); // array of Homey device IDs
  const [homeyClimateDevice,setHomeyClimateDevice]=useState('');
  const [homeySensorDevices,setHomeySensorDevices]=useState('');

  const [homeyUrl,setHomeyUrl]=useState('');
  const [homeyToken,setHomeyToken]=useState('');
  const [homeyHasToken,setHomeyHasToken]=useState(false);
  const [homeySaving,setHomeySaving]=useState(false);
  const [smTesting,setSmTesting]=useState(false);
  const [aiProvider,setAiProvider]=useState('gemini');
  const [aiKey,setAiKey]=useState('');
  const [hasAiKey,setHasAiKey]=useState(false);
  const [aiKeySaving,setAiKeySaving]=useState(false);
  const [imapHost,setImapHost]=useState('imap.gmail.com');
  const [imapPort,setImapPort]=useState('993');
  const [imapUser,setImapUser]=useState('');
  const [imapPass,setImapPass]=useState('');
  const [imapEnabled,setImapEnabled]=useState(false);
  const [imapSaving,setImapSaving]=useState(false);
  const [imapTesting,setImapTesting]=useState(false);
  const [imapScanning,setImapScanning]=useState(false);
  const [imapInterval,setImapInterval]=useState('120');
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
  const [hasUnifi,setHasUnifi]=useState(false);
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
      if(st.ics_export_token) setIcsExportToken(st.ics_export_token);
      if(st.imap_host) setImapHost(st.imap_host);
      if(st.imap_port) setImapPort(st.imap_port);
      if(st.imap_user) setImapUser(st.imap_user);
      setImapEnabled(st.imap_enabled==='1');
      if(st.imap_poll_interval) setImapInterval(st.imap_poll_interval);
      if(st.sports_leagues){
        const active=st.sports_leagues.split(',').map(s=>s.trim().toLowerCase());
        setSportsLeagues({nfl:active.includes('nfl'),nba:active.includes('nba'),mlb:active.includes('mlb'),nhl:active.includes('nhl'),wnba:active.includes('wnba'),mls:active.includes('mls'),epl:active.includes('epl'),ucl:active.includes('ucl'),wc:active.includes('wc'),wwc:active.includes('wwc'),ncaaf:active.includes('ncaaf'),ncaab:active.includes('ncaab'),pga:active.includes('pga'),atp:active.includes('atp'),nascar:active.includes('nascar'),f1:active.includes('f1')});
      }
    }).catch(()=>{});
    api.get('/api/ha/secret').then(d=>{if(d.secret) setHaSecret(d.secret);}).catch(()=>{});
    fetch('/api/ha/smart-home-status',{headers:{..._authHdr()}}).then(r=>r.json()).then(d=>{if(d.ha){if(d.ha.url)setHaUrl(d.ha.url);if(d.ha.hasToken)setHaHasToken(true);}if(d.homey){if(d.homey.url)setHomeyUrl(d.homey.url);if(d.homey.hasToken)setHomeyHasToken(true);}}).catch(()=>{});
    api.get('/api/settings/integrations').then(d=>{if(d.ai_provider)setAiProvider(d.ai_provider);setHasAiKey(!!d.has_ai_key);setHasAnthropicKey(!!d.has_anthropic);setHasBeehiivKey(!!d.has_beehiiv);setHasYoutubeKey(!!d.has_youtube);setHasEtsyKey(!!d.has_etsy);setHasTeslemetryKey(!!d.has_teslemetry);setHasAviationstackKey(!!d.has_aviationstack);setHasNextdnsKey(!!d.has_nextdns);setHasBeszel(!!d.has_beszel);if(d.beszel_url)setBeszelUrl(d.beszel_url);setHasPlexKey(!!d.has_plex);if(d.plex_url)setPlexUrl(d.plex_url);setHasLastfm(!!d.has_lastfm);if(d.lastfm_user)setLastfmUser(d.lastfm_user);setHasMoen(!!d.has_moen);setHasUnifi(!!d.has_unifi);
      // HA entity maps
      const mm={flow:d.ha_moen_flow||'',pressure:d.ha_moen_pressure||'',daily:d.ha_moen_daily||'',mode:d.ha_moen_mode||'',alert:d.ha_moen_alert||''};
      const um={clients:d.ha_unifi_clients||'',rx:d.ha_unifi_rx||'',tx:d.ha_unifi_tx||''};
      setHaMoenMap(mm); setHaUnifiMap(um);
      if(mm.flow) setHaMoenSource('ha');
      if(um.clients||um.rx||um.tx) setHaUnifiSource('ha');
      const personStr=d.ha_person_entities||'';
      setHaPersonIds(personStr?personStr.split(',').map(s=>s.trim()).filter(Boolean):[]);
      setHaClimateEntity(d.ha_climate_entity||'');
      setHaMediaEntity(d.ha_media_entity||'');
      setHaSensorEntities(d.ha_sensor_entities||'');
      setPresenceSource(d.presence_source||'both');
      const homeyPersonStr=d.homey_person_devices||'';
      setHomeyPersonIds(homeyPersonStr?homeyPersonStr.split(',').map(s=>s.trim()).filter(Boolean):[]);
      setHomeyClimateDevice(d.homey_climate_device||'');
      setHomeySensorDevices(d.homey_sensor_devices||'');
    }).catch(()=>{});
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
  const [icsExportToken,setIcsExportToken]=useState('');

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

  return(
    <div style={{maxWidth:620}}>
      <h1 style={{fontSize:28,fontWeight:800,letterSpacing:'-.03em',marginBottom:24}}>Settings</h1>

      <FormGroup label="Appearance">
        <div style={{padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <div style={{fontSize:14,color:A.label3}}>Follow your device or choose a fixed theme.</div>
          <SegControl value={darkMode||'System'} onChange={onDarkMode} options={['System','Light','Dark']}/>
        </div>
      </FormGroup>

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

      {icsExportToken&&(
        <FormGroup label="Calendar Export">
          <div style={{padding:'14px 16px'}}>
            <div style={{fontSize:13,color:A.label3,marginBottom:10}}>Subscribe to this URL in any calendar app (Apple Calendar, Google Calendar, etc.) to see Kith events.</div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <input readOnly value={`${window.location.origin}/api/ics/export?token=${icsExportToken}`} style={{flex:1,background:A.inputBg,border:'none',borderRadius:A.rSm,padding:'9px 12px',fontSize:12,color:A.label2,fontFamily:'JetBrains Mono,monospace',overflow:'hidden',textOverflow:'ellipsis'}}/>
              <Btn sm variant="ghost" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/api/ics/export?token=${icsExportToken}`);toastAdd('Copied','blue');}}>Copy</Btn>
            </div>
          </div>
        </FormGroup>
      )}

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

      <FormGroup label="Gmail Polling (IMAP)">
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:14,color:A.label3,marginBottom:12}}>Kith polls your Gmail inbox every 15 minutes and automatically detects shipping emails. Requires a Gmail App Password — generate one at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" style={{color:A.blue}}>myaccount.google.com/apppasswords</a> (needs Google 2FA enabled).</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <Inp value={imapUser} onChange={e=>setImapUser(e.target.value)} placeholder="your@gmail.com"/>
            <Inp type="password" value={imapPass} onChange={e=>setImapPass(e.target.value)} placeholder="App password (16 chars, no spaces)"/>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <Inp value={imapHost} onChange={e=>setImapHost(e.target.value)} placeholder="imap.gmail.com" style={{flex:2}}/>
              <Inp value={imapPort} onChange={e=>setImapPort(e.target.value)} placeholder="993" style={{flex:1}}/>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center',marginTop:2}}>
              <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:A.label3,cursor:'pointer'}}>
                <input type="checkbox" checked={imapEnabled} onChange={e=>setImapEnabled(e.target.checked)} style={{width:15,height:15}}/>
                Enable polling
              </label>
              <select value={imapInterval} onChange={e=>setImapInterval(e.target.value)} style={{fontSize:12,color:A.label3,background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.rXs,padding:'4px 8px',cursor:'pointer'}}>
                <option value="15">Every 15 min</option>
                <option value="30">Every 30 min</option>
                <option value="60">Every 1 hour</option>
                <option value="120">Every 2 hours</option>
                <option value="240">Every 4 hours</option>
                <option value="720">Every 12 hours</option>
                <option value="1440">Once a day</option>
              </select>
              <div style={{flex:1}}/>
              <Btn sm variant="ghost" loading={imapTesting} onClick={async()=>{
                setImapTesting(true);
                try{
                  const r=await api.post('/api/imap/test',{host:imapHost,port:imapPort,user:imapUser,pass:imapPass});
                  if(r?.error){toastAdd(r.error||'Connection failed','red');}else{toastAdd('Connection successful','green');}
                }catch(e){toastAdd(e?.message||'Connection failed','red');}
                finally{setImapTesting(false);}
              }}>Test</Btn>
              <Btn sm loading={imapSaving} onClick={async()=>{
                setImapSaving(true);
                const payload={imap_host:imapHost,imap_port:imapPort,imap_user:imapUser,imap_enabled:imapEnabled?'1':'0',imap_poll_interval:imapInterval};
                if(imapPass) payload.imap_pass=imapPass;
                const r=await api.put('/api/settings',payload).catch(()=>null);
                setImapSaving(false);
                if(!r||r.error){toastAdd(r?.error||'Save failed','red');}else{toastAdd('IMAP settings saved');}
              }}>Save</Btn>
            </div>
            <div style={{marginTop:4,paddingTop:12,borderTop:`1px solid ${A.sep}`}}>
                <div style={{fontSize:13,color:A.label4,marginBottom:8}}>Scan the last 30 days of your inbox to auto-import packages, bills, reservations, and appointments. Duplicates are skipped.</div>
                <Btn sm variant="ghost" loading={imapScanning} onClick={async()=>{
                  if(imapScanning) return;
                  setImapScanning(true);
                  const r=await api.post('/api/imap/scan',{}).catch(()=>null);
                  if(!r?.ok){
                    toastAdd(r?.status==='already_scanning'?'Scan already in progress':'Failed to start scan','red');
                    setImapScanning(false);
                    return;
                  }
                  toastAdd('Scanning — this may take a minute…','blue');
                  const es=new EventSource('/api/events/stream');
                  const tid=setTimeout(()=>{es.close();setImapScanning(false);},5*60*1000);
                  es.addEventListener('scan_complete',e=>{
                    clearTimeout(tid);es.close();setImapScanning(false);
                    try{
                      const d=JSON.parse(e.data);
                      if(d.error==='no_credentials'){toastAdd('IMAP credentials not saved — enter and save your Gmail settings first','red');return;}
                      if(d.error==='no_ai_key'){toastAdd('No AI API key configured — add one in Settings → AI','red');return;}
                      if(d.error){toastAdd(`Scan failed: ${d.error}`,'red');return;}
                      const parts=[];
                      if(d.packages>0) parts.push(`${d.packages} package${d.packages===1?'':'s'}`);
                      if(d.bills>0) parts.push(`${d.bills} bill${d.bills===1?'':'s'}`);
                      if(d.appointments>0) parts.push(`${d.appointments} appointment${d.appointments===1?'':'s'}`);
                      if(d.events>0) parts.push(`${d.events} event${d.events===1?'':'s'}`);
                      toastAdd(parts.length?`Scan found: ${parts.join(', ')}`:'Scan complete — nothing new found');
                    }catch{toastAdd('Scan complete');}
                  });
                }}>{imapScanning?'Scanning…':'Scan last 30 days'}</Btn>
            </div>
          </div>
        </div>
      </FormGroup>

      <FormGroup label="Email Forwarding">
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:14,color:A.label3,marginBottom:12}}>Point an email forwarding service at this webhook URL. Kith parses the email with AI and auto-detects calendar events (Inbox) and shipping confirmations (Packages).</div>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:6}}>Webhook URL</div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <code style={{flex:1,fontSize:12,background:A.inputBg,padding:'8px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,color:A.label2,wordBreak:'break-all'}}>{window.location.origin}/api/email/inbound</code>
              <Btn sm variant="ghost" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/api/email/inbound`);toastAdd('Copied','blue');}}>Copy</Btn>
            </div>
            <div style={{fontSize:12,color:A.label5,marginTop:6}}>Recommended: Gmail filter → forward to Postmark Inbound → set Postmark to POST here. Or use Zapier, Make, or a Cloudflare Email Worker.</div>
          </div>
          <div style={{borderTop:`1px solid ${A.sep}`,marginTop:4,paddingTop:14}}>
            <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:4}}>Webhook secret</div>
            <div style={{fontSize:13,color:A.label4,marginBottom:10}}>Your forwarding service must send this as an <code style={{fontSize:11,background:A.inputBg,padding:'1px 5px',borderRadius:4}}>x-kith-secret</code> header. Requests without it are rejected.</div>
            <WebhookSecretPanel toastAdd={toastAdd}/>
          </div>
          <div style={{borderTop:`1px solid ${A.sep}`,marginTop:14,paddingTop:14}}>
            <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:4}}>Forwarding address (optional)</div>
            <div style={{fontSize:13,color:A.label4,marginBottom:8}}>Record the email address you set up — this is just a reminder for yourself.</div>
            <Inp value={fwdAddress} onChange={e=>setFwdAddress(e.target.value)} placeholder="kith@yourdomain.com or postmark address"/>
            <div style={{display:'flex',gap:8,marginTop:8}}>
              <Btn sm onClick={()=>saveSetting('forwarding_address',fwdAddress)}>Save</Btn>
              {fwdAddress&&<Btn sm variant="ghost" onClick={()=>{navigator.clipboard.writeText(fwdAddress);toastAdd('Copied','blue');}}>Copy</Btn>}
            </div>
          </div>
        </div>
      </FormGroup>

      <FormGroup label="AI Email Parsing">
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:14,color:A.label3,marginBottom:12}}>Powers automatic detection of calendar events and package tracking from forwarded emails. Choose a provider and enter your API key.</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <select value={aiProvider} onChange={e=>setAiProvider(e.target.value)} style={{background:'var(--input-bg,#F2F2F7)',border:'none',borderRadius:A.rSm,padding:'10px 12px',fontSize:14,color:'inherit',cursor:'pointer'}}>
              <option value="gemini">Google Gemini (free tier available)</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="openai">OpenAI GPT-4o mini</option>
              <option value="groq">Groq (fast + free)</option>
              <option value="deepseek">DeepSeek Chat (cost-optimized)</option>
            </select>
            <Inp type="password" value={aiKey} onChange={e=>setAiKey(e.target.value)} placeholder={hasAiKey?'API key saved — paste to replace':'Paste API key'}/>
            <Btn sm loading={aiKeySaving} onClick={async()=>{
              setAiKeySaving(true);
              try{
                await api.put('/api/settings/ai-key',{provider:aiProvider,...(aiKey?{key:aiKey}:{})});
                setHasAiKey(true);
                setAiKey('');
                toastAdd('AI parsing settings saved');
              }catch(e){toastAdd('Save failed','red');}
              finally{setAiKeySaving(false);}
            }}>Save</Btn>
          </div>
          {hasAiKey&&<div style={{fontSize:12,color:A.label5,marginTop:8}}>Key saved. Using {aiProvider}.</div>}
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
                <div key={action.id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:A.cardBg,borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
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
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:10}}>Home Assistant</div>
          <div style={{marginBottom:8}}><Inp value={haUrl} onChange={e=>setHaUrl(e.target.value)} placeholder="http://homeassistant.local:8123"/></div>
          <div style={{marginBottom:10}}><Inp value={haToken} onChange={e=>setHaToken(e.target.value)} placeholder={haHasToken?'Token saved — paste to replace':'Long-lived access token'} type="password"/></div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
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
            <Btn sm variant="ghost" onClick={async()=>{
              if(!haUrl.trim()&&!haHasToken){toastAdd('Save HA URL and token first','red');return;}
              setHaDiscovering(true);
              const body={};
              if(haUrl.trim()) body.ha_url=haUrl.trim();
              if(haToken.trim()) body.ha_token=haToken.trim();
              const r=await fetch('/api/ha/discover',{method:'POST',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify(body)}).then(x=>x.json()).catch(()=>({error:'Request failed'}));
              setHaDiscovering(false);
              if(r.error){toastAdd(r.error,'red');return;}
              setHaDiscovered(r);
              // Auto-fill maps from discovered matches
              if(r.moen?.map) setHaMoenMap(m=>({...m,...Object.fromEntries(Object.entries(r.moen.map).filter(([,v])=>v))}));
              if(r.unifi?.map) setHaUnifiMap(m=>({...m,...Object.fromEntries(Object.entries(r.unifi.map).filter(([,v])=>v))}));
              // ADV-002 fix: only auto-select if user hasn't already saved a subset
              if(r.persons?.length&&haPersonIds.length===0) setHaPersonIds(r.persons.map(p=>p.entity_id));
              // Auto-select first climate entity if only one found
              if(r.climates?.length===1) setHaClimateEntity(r.climates[0].entity_id);
              // Auto-select Spotify media player if found
              if(r.ha_media_entity) setHaMediaEntity(r.ha_media_entity);
              const moenFound=Object.values(r.moen?.map||{}).filter(Boolean).length;
              const unifiFound=Object.values(r.unifi?.map||{}).filter(Boolean).length;
              toastAdd(`Found ${r.moen?.all?.length||0} Moen, ${r.unifi?.all?.length||0} UniFi, ${r.persons?.length||0} persons, ${r.climates?.length||0} thermostats — ${moenFound+unifiFound} auto-mapped`);
            }} disabled={haDiscovering}>{haDiscovering?'Discovering…':'Discover Entities'}</Btn>
          </div>
          {!haDiscovered&&(haMoenSource==='ha'||haUnifiSource==='ha'||haPersonIds.length>0||haClimateEntity||haSensorEntities)&&(
            <div style={{background:A.systemBg,borderRadius:A.r,padding:'10px 14px',marginBottom:10,fontSize:12,color:A.label3}}>
              HA entity mapping active — click Discover to review or change.
              {haMoenMap.flow&&<div style={{color:A.label4,marginTop:4,fontFamily:'monospace',fontSize:11}}>Moen flow: {haMoenMap.flow}</div>}
              {haUnifiMap.clients&&<div style={{color:A.label4,fontFamily:'monospace',fontSize:11}}>UniFi clients: {haUnifiMap.clients}</div>}
              {haPersonIds.length>0&&<div style={{color:A.label4,fontFamily:'monospace',fontSize:11}}>Who's home (HA): {haPersonIds.join(', ')}</div>}
              {haClimateEntity&&<div style={{color:A.label4,fontFamily:'monospace',fontSize:11}}>Thermostat (HA): {haClimateEntity}</div>}
              {haMediaEntity&&<div style={{color:A.label4,fontFamily:'monospace',fontSize:11}}>Now playing (HA): {haMediaEntity}</div>}
              {haSensorEntities&&<div style={{color:A.label4,fontFamily:'monospace',fontSize:11}}>Home tiles: {haSensorEntities}</div>}
            </div>
          )}
          {haDiscovered&&(
            <div style={{background:A.systemBg,borderRadius:A.r,padding:'12px 14px',marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:600,color:A.label2,marginBottom:8}}>Moen Flo Entity Mapping</div>
              {[['flow','Flow rate (gal/min)'],['pressure','Pressure (PSI)'],['daily','Daily usage (gal)'],['mode','System mode'],['alert','Leak alert']].map(([k,label])=>(
                <div key={k} style={{marginBottom:6}}>
                  <div style={{fontSize:11,color:A.label4,marginBottom:2}}>{label}</div>
                  <select value={haMoenMap[k]||''} onChange={e=>setHaMoenMap(m=>({...m,[k]:e.target.value}))} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.rSm,padding:'5px 8px',fontSize:12,color:A.label1}}>
                    <option value="">— not mapped —</option>
                    {(haDiscovered.moen?.all||[]).map(s=><option key={s.entity_id} value={s.entity_id}>{s.friendly_name} ({s.state} {s.unit})</option>)}
                  </select>
                </div>
              ))}
              <div style={{fontSize:12,fontWeight:600,color:A.label2,marginTop:12,marginBottom:8}}>UniFi Entity Mapping</div>
              {[['clients','Client count'],['rx','Download (Mbit/s)'],['tx','Upload (Mbit/s)']].map(([k,label])=>(
                <div key={k} style={{marginBottom:6}}>
                  <div style={{fontSize:11,color:A.label4,marginBottom:2}}>{label}</div>
                  <select value={haUnifiMap[k]||''} onChange={e=>setHaUnifiMap(m=>({...m,[k]:e.target.value}))} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.rSm,padding:'5px 8px',fontSize:12,color:A.label1}}>
                    <option value="">— not mapped —</option>
                    {(haDiscovered.allSensors||[]).map(s=><option key={s.entity_id} value={s.entity_id}>{s.friendly_name} ({s.state}{s.unit?' '+s.unit:''})</option>)}
                  </select>
                </div>
              ))}
              <div style={{fontSize:12,fontWeight:600,color:A.label2,marginTop:12,marginBottom:6}}>Who's Home — Source</div>
              <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                {[['both','Both (merge)'],['ha','HA only'],['homey','Homey only']].map(([val,label])=>(
                  <label key={val} style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer',fontSize:12,color:presenceSource===val?A.blue:A.label3}}>
                    <input type="radio" name="presence_source" value={val} checked={presenceSource===val} onChange={()=>setPresenceSource(val)}/>
                    {label}
                  </label>
                ))}
              </div>
              <div style={{fontSize:11,color:A.label5,marginBottom:8}}>HA person entities</div>
              {(haDiscovered.persons||[]).length===0
                ?<div style={{fontSize:11,color:A.label5,marginBottom:4}}>No person.* entities found in HA</div>
                :(haDiscovered.persons||[]).map(p=>(
                  <label key={p.entity_id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,cursor:'pointer'}}>
                    <input type="checkbox" checked={haPersonIds.includes(p.entity_id)} onChange={e=>setHaPersonIds(ids=>e.target.checked?[...ids,p.entity_id]:ids.filter(id=>id!==p.entity_id))}/>
                    <span style={{fontSize:12,color:A.label2}}>{p.friendly_name}</span>
                    <span style={{fontSize:11,color:A.label4}}>({p.state})</span>
                  </label>
                ))
              }
              <div style={{fontSize:12,fontWeight:600,color:A.label2,marginTop:12,marginBottom:8}}>Thermostat</div>
              {(haDiscovered.climates||[]).length===0
                ?<div style={{fontSize:11,color:A.label5,marginBottom:4}}>No climate.* entities found in HA</div>
                :<div style={{marginBottom:6}}>
                  <select value={haClimateEntity} onChange={e=>setHaClimateEntity(e.target.value)} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.rSm,padding:'5px 8px',fontSize:12,color:A.label1}}>
                    <option value="">— not mapped —</option>
                    {(haDiscovered.climates||[]).map(s=><option key={s.entity_id} value={s.entity_id}>{s.friendly_name} ({s.state}{s.current_temp!=null?`, ${s.current_temp}°`:''})</option>)}
                  </select>
                </div>
              }
              <div style={{fontSize:12,fontWeight:600,color:A.label2,marginTop:12,marginBottom:8}}>Now Playing (Media Player)</div>
              {(haDiscovered.mediaPlayers||[]).length===0
                ?<div style={{fontSize:11,color:A.label5,marginBottom:4}}>No media_player.* entities found in HA</div>
                :<div style={{marginBottom:6}}>
                  <select value={haMediaEntity} onChange={e=>setHaMediaEntity(e.target.value)} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.rSm,padding:'5px 8px',fontSize:12,color:A.label1}}>
                    <option value="">— not mapped —</option>
                    {(haDiscovered.mediaPlayers||[]).map(s=><option key={s.entity_id} value={s.entity_id}>{s.friendly_name} ({s.state})</option>)}
                  </select>
                </div>
              }
              <div style={{fontSize:12,fontWeight:600,color:A.label2,marginTop:12,marginBottom:6}}>Home Tile Entities</div>
              <div style={{fontSize:11,color:A.label5,marginBottom:6}}>Pick up to 6 entities to show as live tiles (security, lights, locks, sensors…)</div>
              {(()=>{
                const selSet=new Set(haSensorEntities.split(',').map(x=>x.trim()).filter(Boolean));
                const atMax=selSet.size>=6;
                return(
                  <div style={{maxHeight:160,overflowY:'auto',marginBottom:6}}>
                    {[...(haDiscovered.allSensors||[])].sort((a,b)=>{const sa=selSet.has(a.entity_id),sb=selSet.has(b.entity_id);return sa===sb?0:sa?-1:1;}).map(s=>(
                      <label key={s.entity_id} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0',cursor:'pointer'}}>
                        <input type="checkbox"
                          checked={selSet.has(s.entity_id)}
                          disabled={!selSet.has(s.entity_id)&&atMax}
                          onChange={e=>{
                            const cur=[...selSet];
                            setHaSensorEntities(e.target.checked?[...cur,s.entity_id].join(','):cur.filter(id=>id!==s.entity_id).join(','));
                          }}
                        />
                        <span style={{fontSize:11,color:A.label2,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.friendly_name}</span>
                        <span style={{fontSize:10,color:A.label5,fontFamily:'monospace'}}>{s.state}{s.unit?' '+s.unit:''}</span>
                      </label>
                    ))}
                  </div>
                );
              })()}
              <Btn sm style={{marginTop:8}} onClick={async()=>{
                const payload={ha_moen_flow:haMoenMap.flow,ha_moen_pressure:haMoenMap.pressure,ha_moen_daily:haMoenMap.daily,ha_moen_mode:haMoenMap.mode,ha_moen_alert:haMoenMap.alert,ha_unifi_clients:haUnifiMap.clients,ha_unifi_rx:haUnifiMap.rx,ha_unifi_tx:haUnifiMap.tx,ha_person_entities:haPersonIds.join(','),ha_climate_entity:haClimateEntity,ha_media_entity:haMediaEntity,ha_sensor_entities:haSensorEntities,presence_source:presenceSource};
                await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify(payload)});
                if(haMoenMap.flow) setHaMoenSource('ha'); else setHaMoenSource('direct');
                if(haUnifiMap.clients||haUnifiMap.rx||haUnifiMap.tx) setHaUnifiSource('ha'); else setHaUnifiSource('direct');
                toastAdd('Entity mapping saved — widgets will refresh');
              }}>Save Mapping</Btn>
            </div>
          )}
          <div style={{fontSize:12,color:A.label5}}>Create a long-lived token in HA Profile. Use Discover to auto-find Moen Flo and UniFi entities.</div>
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
          {(homeyPersonIds.length>0||homeyClimateDevice)&&!homeyDiscovered&&(
            <div style={{background:A.systemBg,borderRadius:A.r,padding:'10px 14px',marginTop:10,fontSize:12,color:A.label3}}>
              Homey device mapping active — click Discover Devices to review.
              {homeyPersonIds.length>0&&<div style={{color:A.label4,marginTop:4,fontFamily:'monospace',fontSize:11}}>Who's home (Homey): {homeyPersonIds.length} device(s)</div>}
              {homeyClimateDevice&&<div style={{color:A.label4,fontFamily:'monospace',fontSize:11}}>Thermostat (Homey): {homeyClimateDevice}</div>}
            </div>
          )}
          <div style={{marginTop:10}}>
            <Btn sm variant="ghost" onClick={async()=>{
              setHomeyDiscovering(true);
              const r=await fetch('/api/homey/discover',{method:'POST',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify({})}).then(x=>x.json()).catch(()=>({error:'Request failed'}));
              setHomeyDiscovering(false);
              if(r.error){toastAdd(r.error,'red');return;}
              setHomeyDiscovered(r);
              // F3 fix: only auto-select if user hasn't already saved a subset
              if(r.users?.length&&homeyPersonIds.length===0) setHomeyPersonIds(r.users.map(u=>u.id));
              if(r.thermostats?.length===1&&!homeyClimateDevice) setHomeyClimateDevice(r.thermostats[0].id);
              toastAdd(`Found ${r.users?.length||0} users, ${r.thermostats?.length||0} thermostats, ${r.allDevices?.length||0} devices`);
            }} disabled={homeyDiscovering}>{homeyDiscovering?'Discovering…':'Discover Devices'}</Btn>
          </div>
          {homeyDiscovered&&(
            <div style={{background:A.systemBg,borderRadius:A.r,padding:'12px 14px',marginTop:10}}>
              <div style={{fontSize:12,fontWeight:600,color:A.label2,marginBottom:8}}>Who's Home — Homey Users</div>
              {(homeyDiscovered.users||[]).length===0
                ?<div style={{fontSize:11,color:A.label5,marginBottom:4}}>No Homey users found (check token has users scope)</div>
                :(homeyDiscovered.users||[]).map(u=>(
                  <label key={u.id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,cursor:'pointer'}}>
                    <input type="checkbox" checked={homeyPersonIds.includes(u.id)} onChange={e=>setHomeyPersonIds(ids=>e.target.checked?[...ids,u.id]:ids.filter(id=>id!==u.id))}/>
                    <span style={{fontSize:12,color:A.label2}}>{u.name}</span>
                    <span style={{fontSize:11,color:u.present===true?'#34C759':A.label4}}>({u.present===true?'home':u.present===false?'away':'unknown'})</span>
                  </label>
                ))
              }
              <div style={{fontSize:12,fontWeight:600,color:A.label2,marginTop:12,marginBottom:8}}>Thermostat</div>
              {(homeyDiscovered.thermostats||[]).length===0
                ?<div style={{fontSize:11,color:A.label5,marginBottom:4}}>No devices with temperature capability found</div>
                :<div style={{marginBottom:6}}>
                  <select value={homeyClimateDevice} onChange={e=>setHomeyClimateDevice(e.target.value)} style={{width:'100%',background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.rSm,padding:'5px 8px',fontSize:12,color:A.label1}}>
                    <option value="">— not mapped —</option>
                    {(homeyDiscovered.thermostats||[]).map(d=><option key={d.id} value={d.id}>{d.name}{d.current_temp!=null?` (${d.current_temp}°)`:''}</option>)}
                  </select>
                </div>
              }
              {(homeyDiscovered.allDevices||[]).length>0&&(()=>{
                const sensorSet=new Set(homeySensorDevices.split(',').map(x=>x.trim()).filter(Boolean));
                const atMax=sensorSet.size>=6;
                return(
                  <>
                    <div style={{fontSize:12,fontWeight:600,color:A.label2,marginTop:12,marginBottom:6}}>Home Tile Devices</div>
                    <div style={{fontSize:11,color:A.label5,marginBottom:6}}>Pick up to 6 Homey devices to show as live tiles</div>
                    <div style={{maxHeight:160,overflowY:'auto',marginBottom:6}}>
                      {homeyDiscovered.allDevices.map(d=>(
                        <label key={d.id} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0',cursor:'pointer'}}>
                          <input type="checkbox"
                            checked={sensorSet.has(d.id)}
                            disabled={!sensorSet.has(d.id)&&atMax}
                            onChange={e=>{
                              const cur=[...sensorSet];
                              setHomeySensorDevices(e.target.checked?[...cur,d.id].join(','):cur.filter(id=>id!==d.id).join(','));
                            }}
                          />
                          <span style={{fontSize:11,color:A.label2,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.name}{d.zone?<span style={{color:A.label5}}> · {d.zone}</span>:null}</span>
                          <span style={{fontSize:10,color:A.label5,fontFamily:'monospace',marginLeft:8}}>{d.capabilities.slice(0,3).join(', ')}</span>
                        </label>
                      ))}
                    </div>
                  </>
                );
              })()}
              <Btn sm style={{marginTop:12}} onClick={async()=>{
                const payload={homey_person_devices:homeyPersonIds.join(','),homey_climate_device:homeyClimateDevice,homey_sensor_devices:homeySensorDevices};
                await fetch('/api/settings/integrations',{method:'PUT',headers:{'Content-Type':'application/json',..._authHdr()},body:JSON.stringify(payload)});
                toastAdd('Homey mapping saved — widgets will refresh');
              }}>Save Homey Mapping</Btn>
            </div>
          )}
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
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:6}}>Moen Flo{haMoenSource==='ha'?<span style={{marginLeft:8,fontSize:11,color:'#3B82F6',fontWeight:500}}>via Home Assistant</span>:(hasMoen&&<span style={{marginLeft:8,fontSize:11,color:A.green,fontWeight:500}}>Connected</span>)}</div>
          <div style={{fontSize:12,color:A.label5}}>Water monitoring — daily usage, flow rate, pressure, and leak alerts. Configure in Smart Home above.</div>
        </div>
        <div style={{padding:'14px 16px',borderTop:`1px solid ${A.sep}`}}>
          <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:6}}>UniFi Network{haUnifiSource==='ha'?<span style={{marginLeft:8,fontSize:11,color:'#3B82F6',fontWeight:500}}>via Home Assistant</span>:(hasUnifi&&<span style={{marginLeft:8,fontSize:11,color:A.green,fontWeight:500}}>Connected</span>)}</div>
          <div style={{fontSize:12,color:A.label5}}>Network stats — clients, throughput, AP count. Configure in Smart Home above.</div>
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

      <FormGroup label="Data Export">
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:14,color:A.label3,marginBottom:12}}>Download a full JSON export of your Kith data — events, chores, grocery, meals, subscriptions, and more.</div>
          <Btn sm onClick={async()=>{
            try{
              const blob=await fetch('/api/export',{headers:{Authorization:`Bearer ${localStorage.getItem('kith_token')||''}`}}).then(r=>r.blob());
              const url=URL.createObjectURL(blob);
              const a=document.createElement('a');a.href=url;a.download='kith-export.json';a.click();URL.revokeObjectURL(url);
              toastAdd('Export downloaded');
            }catch{toastAdd('Export failed','red');}
          }}>Export Data</Btn>
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
  const [search,setSearch]=useState('');

  const openNew=()=>{setEditNote(null);setForm(blank);setDrawerOpen(true);};
  const openEdit=n=>{setEditNote(n);setForm({title:n.title,content:n.content||'',color:n.color||'#FAFAF5',pinned:!!n.pinned});setDrawerOpen(true);};

  const save=async()=>{
    if(!form.title.trim()){toastAdd('Title is required','red');return;}
    const body={title:form.title.trim(),content:form.content,color:form.color,pinned:form.pinned?1:0};
    if(editNote){
      const updated=await api.put(`/api/notes/${editNote.id}`,body).catch(()=>({error:'Failed'}));
      if(!updated?.id){toastAdd(updated?.error||'Save failed','red');return;}
      setNotes(p=>p.map(n=>n.id===editNote.id?updated:n).sort((a,b)=>b.pinned-a.pinned||b.id-a.id));
      toastAdd('Note updated');
    } else {
      const created=await api.post('/api/notes',body).catch(()=>({error:'Failed'}));
      if(!created?.id){toastAdd(created?.error||'Save failed','red');return;}
      setNotes(p=>[created,...p].sort((a,b)=>b.pinned-a.pinned||b.id-a.id));
      toastAdd('Note added');
    }
    setDrawerOpen(false);setEditNote(null);setForm(blank);
  };

  const togglePin=async n=>{
    const updated=await api.put(`/api/notes/${n.id}`,{pinned:n.pinned?0:1}).catch(()=>null);
    if(!updated?.id) return;
    setNotes(p=>p.map(x=>x.id===n.id?updated:x).sort((a,b)=>b.pinned-a.pinned||b.id-a.id));
  };

  const del=async id=>{
    try{await api.del(`/api/notes/${id}`);}catch{toastAdd('Failed to delete','red');return;}
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

      {notes.length>3&&(
        <div style={{marginBottom:16}}>
          <Inp value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search notes…"/>
        </div>
      )}
      {notes.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No notes yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>WiFi password, trash day, plumber number — pin a note to show it on the wall display</div>
        </Card>
      ):(()=>{
        const q=search.trim().toLowerCase();
        const filtered=q?notes.filter(n=>n.title.toLowerCase().includes(q)||(n.content||'').toLowerCase().includes(q)):notes;
        if(q&&filtered.length===0) return(
          <Card style={{padding:'40px 24px',textAlign:'center'}}>
            <div style={{fontSize:15,color:A.label3,fontWeight:500}}>No notes match '{search}'</div>
          </Card>
        );
        return(
        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(240px,1fr))',gap:12}}>
          {filtered.map(n=>(
            <div key={n.id} style={{background:n.color||'#FAFAF5',borderRadius:A.r,padding:'18px 20px',position:'relative',border:'1px solid rgba(0,0,0,0.06)'}}>
              {n.pinned&&<div style={{position:'absolute',top:12,right:14,width:8,height:8,borderRadius:'50%',background:A.blue}}/>}
              <div style={{fontSize:15,fontWeight:700,color:'#1A1A1A',marginBottom:n.content?8:0,paddingRight:16}}>{n.title}</div>
              {n.content&&<div style={{fontSize:13,color:'#3C3C43',lineHeight:1.5,whiteSpace:'pre-wrap'}}>{n.content}</div>}
              <div style={{display:'flex',gap:10,marginTop:14,alignItems:'center'}}>
                <button onClick={()=>togglePin(n)} style={{background:'none',border:'none',fontSize:12,color:n.pinned?A.blue:A.label4,cursor:'pointer',fontWeight:600,padding:0}}>{n.pinned?'Unpin':'Pin to display'}</button>
                <button onClick={()=>openEdit(n)} style={{background:'none',border:'none',fontSize:12,color:A.blue,cursor:'pointer',fontWeight:500,padding:0}}>Edit</button>
                <button onClick={()=>del(n.id)} style={{background:'none',border:'none',fontSize:12,color:A.red,cursor:'pointer',fontWeight:500,padding:0}}>Delete</button>
              </div>
            </div>
          ))}
        </div>
        );
      })()}

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
      if(!result?.votes){toastAdd(result?.error||'Vote failed','red');return;}
      setPolls(p=>p.map(x=>x.id===poll.id?{...x,votes:result.votes}:x));
      toastAdd('Vote counted');
    }catch{toastAdd('Vote failed','red');}
    finally{setVoting(v=>({...v,[poll.id]:false}));}
  };

  const savePoll=async()=>{
    const filtered=options.filter(o=>o.trim());
    if(!question.trim()||filtered.length<2){toastAdd('Need a question and at least 2 options','red');return;}
    const created=await api.post('/api/polls',{question:question.trim(),options:filtered}).catch(()=>({error:'Failed'}));
    if(!created?.id){toastAdd(created?.error||'Save failed','red');return;}
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
                    {daysLeft!==null&&<span style={{fontSize:12,color:daysLeft<0?A.red:daysLeft<14?A.amber:A.label4,fontWeight:600}}>{daysLeft>0?`${daysLeft}d left`:daysLeft===0?'Due today':`${Math.abs(daysLeft)}d overdue`}</span>}
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


/* ── Packages Screen ─────────────────────────────────────────────────── */
function PackagesScreen({packages,setPackages,toastAdd}){
  const isMobile=useIsMobile();
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [editPkg,setEditPkg]=useState(null);
  const [form,setForm]=useState({carrier:'',tracking_number:'',description:'',expected_date:''});

  const markDelivered=async id=>{
    const r=await api.put(`/api/packages/${id}/delivered`,{}).catch(()=>null);
    if(r?.error){toastAdd(r.error,'red');return;}
    setPackages(p=>p.filter(x=>x.id!==id));
    toastAdd('Marked as delivered');
  };

  const del=async id=>{
    await api.del(`/api/packages/${id}`);
    setPackages(p=>p.filter(x=>x.id!==id));
    toastAdd('Removed','blue');
  };

  const save=async()=>{
    if(!form.description.trim()&&!form.tracking_number.trim()){toastAdd('Add a description or tracking number','red');return;}
    if(editPkg){
      const r=await api.put(`/api/packages/${editPkg.id}`,form).catch(()=>null);
      if(!r?.id){toastAdd(r?.error||'Failed to save','red');return;}
      setPackages(p=>p.map(x=>x.id===r.id?r:x));
    }else{
      const r=await api.post('/api/packages',form).catch(()=>null);
      if(!r?.id){toastAdd(r?.error||'Failed to save','red');return;}
      setPackages(p=>[r,...p]);
    }
    setDrawerOpen(false);setEditPkg(null);setForm({carrier:'',tracking_number:'',description:'',expected_date:''});
    toastAdd(editPkg?'Package updated':'Package added');
  };
  const openNew=()=>{setEditPkg(null);setForm({carrier:'',tracking_number:'',description:'',expected_date:''});setDrawerOpen(true);};
  const openEdit=pkg=>{setEditPkg(pkg);setForm({carrier:pkg.carrier||'',tracking_number:pkg.tracking_number||'',description:pkg.description||'',expected_date:pkg.expected_date||''});setDrawerOpen(true);};

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Packages</h1>
          <p style={{color:A.label4,fontSize:15,marginTop:6}}>Detected from shipping emails · shows on wall display</p>
        </div>
        <Btn onClick={openNew}>+ Add</Btn>
      </div>
      {packages.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No packages</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Shipping confirmation emails are parsed automatically. Add one manually if needed.</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {packages.map(pkg=>(
            <Card key={pkg.id} style={{padding:'18px 20px'}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
                <div style={{flex:1,minWidth:0}}>
                  {pkg.carrier&&<div style={{fontSize:11,fontWeight:700,color:A.blue,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:4}}>{pkg.carrier}</div>}
                  <div style={{fontSize:16,fontWeight:600,color:A.label1,lineHeight:1.3}}>{pkg.description||'Package'}</div>
                  {pkg.tracking_number&&<div style={{fontSize:12,color:A.label4,fontFamily:'monospace',marginTop:4}}>{pkg.tracking_number}</div>}
                  {pkg.expected_date&&<div style={{fontSize:13,color:A.label3,marginTop:4}}>Arriving {pkg.expected_date}</div>}
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:6,flexShrink:0}}>
                  <button onClick={()=>markDelivered(pkg.id)} style={{background:A.green,border:'none',color:'#fff',fontSize:12,fontWeight:600,borderRadius:A.rXs,padding:'6px 12px',cursor:'pointer'}}>Delivered</button>
                  <button onClick={()=>openEdit(pkg)} style={{background:'none',border:'none',color:A.blue,fontSize:12,cursor:'pointer',fontWeight:500}}>Edit</button>
                  <button onClick={()=>del(pkg.id)} style={{background:'none',border:'none',color:A.red,fontSize:12,cursor:'pointer',fontWeight:500}}>Remove</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Drawer open={drawerOpen} onClose={()=>{setDrawerOpen(false);setEditPkg(null);setForm({carrier:'',tracking_number:'',description:'',expected_date:''});}} title={editPkg?'Edit Package':'Add Package'}>
        <FormGroup label="Description"><div style={{padding:'12px 16px'}}><Inp value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Blue hoodie from Amazon"/></div></FormGroup>
        <FormGroup label="Carrier"><div style={{padding:'12px 16px'}}><Inp value={form.carrier} onChange={e=>setForm(f=>({...f,carrier:e.target.value}))} placeholder="UPS, FedEx, USPS, Amazon…"/></div></FormGroup>
        <FormGroup label="Tracking #"><div style={{padding:'12px 16px'}}><Inp value={form.tracking_number} onChange={e=>setForm(f=>({...f,tracking_number:e.target.value}))} placeholder="1Z999AA10123456784"/></div></FormGroup>
        <FormGroup label="Expected date"><div style={{padding:'12px 16px'}}><Inp type="date" value={form.expected_date} onChange={e=>setForm(f=>({...f,expected_date:e.target.value}))}/></div></FormGroup>
        <div style={{padding:'16px'}}><Btn onClick={save} full>Save Package</Btn></div>
      </Drawer>
    </div>
  );
}

/* ── Messages Screen ─────────────────────────────────────────────────── */
function MessagesScreen({messages,setMessages,members=[],toastAdd}){
  const isMobile=useIsMobile();
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [text,setText]=useState('');
  const [author,setAuthor]=useState('');
  const [memberId,setMemberId]=useState('');
  const [expiry,setExpiry]=useState('4h');

  const post=async()=>{
    if(!text.trim()){toastAdd('Message cannot be empty','red');return;}
    const r=await api.post('/api/messages',{text:text.trim(),author:author||undefined,member_id:memberId?Number(memberId):undefined,expiry_preset:expiry}).catch(()=>null);
    if(!r?.id){toastAdd(r?.error||'Failed to post','red');return;}
    setMessages(p=>[r,...p]);
    setDrawerOpen(false);setText('');setAuthor('');setMemberId('');setExpiry('4h');
    toastAdd('Message posted');
  };

  const del=async id=>{
    await api.del(`/api/messages/${id}`);
    setMessages(p=>p.filter(m=>m.id!==id));
    toastAdd('Deleted','blue');
  };

  const fmtLeft=expiresAt=>{
    const ms=new Date(expiresAt.replace(' ','T')+'Z').getTime()-Date.now();
    if(ms<=0) return 'Expired';
    const mins=Math.floor(ms/60000);
    if(mins<60) return `${mins}m left`;
    return `${Math.floor(mins/60)}h left`;
  };

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Messages</h1>
          <p style={{color:A.label4,fontSize:15,marginTop:6}}>Leave a note for the family · auto-expires · shows on wall display</p>
        </div>
        <Btn onClick={()=>setDrawerOpen(true)}>+ Post</Btn>
      </div>
      {messages.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No active messages</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Leave a note for the family — it shows on the wall display until it expires.</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {messages.map(msg=>(
            <Card key={msg.id} style={{padding:'18px 20px'}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:16,fontWeight:500,color:A.label1,lineHeight:1.4,marginBottom:6}}>{msg.text}</div>
                  <div style={{display:'flex',gap:12,alignItems:'center'}}>
                    <span style={{fontSize:13,color:A.label3}}>{msg.author||'Family'}</span>
                    <span style={{fontSize:12,color:A.label5}}>{fmtLeft(msg.expires_at)}</span>
                  </div>
                </div>
                <button onClick={()=>del(msg.id)} style={{background:'none',border:'none',color:A.red,fontSize:13,cursor:'pointer',fontWeight:500,flexShrink:0}}>Delete</button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Drawer open={drawerOpen} onClose={()=>{setDrawerOpen(false);setText('');setAuthor('');setMemberId('');setExpiry('4h');}} title="Post Message">
        <FormGroup label="Message">
          <div style={{padding:'12px 16px'}}>
            <textarea value={text} onChange={e=>setText(e.target.value)} rows={3} placeholder="Don't forget to feed the dog!" style={{width:'100%',padding:'10px 14px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1,resize:'vertical',outline:'none',lineHeight:1.5}}/>
          </div>
        </FormGroup>
        {members.length>0&&(
          <FormGroup label="From">
            <div style={{padding:'12px 16px'}}>
              <select value={memberId} onChange={e=>{setMemberId(e.target.value);const m=members.find(x=>x.id===Number(e.target.value));if(m)setAuthor(m.name);}}
                style={{width:'100%',padding:'10px 14px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
                <option value="">Family</option>
                {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </FormGroup>
        )}
        <FormGroup label="Expires">
          <div style={{padding:'12px 16px',display:'flex',gap:8,flexWrap:'wrap'}}>
            {[['1h','1 hour'],['4h','4 hours'],['eod','End of day'],['tomorrow','Tomorrow AM']].map(([v,l])=>(
              <button key={v} onClick={()=>setExpiry(v)} style={{padding:'8px 16px',borderRadius:20,border:`1.5px solid ${expiry===v?A.blue:A.sep}`,background:expiry===v?`${A.blue}15`:'transparent',color:expiry===v?A.blue:A.label2,fontSize:13,fontWeight:500,cursor:'pointer'}}>{l}</button>
            ))}
          </div>
        </FormGroup>
        <div style={{padding:'16px'}}><Btn onClick={post} full>Post Message</Btn></div>
      </Drawer>
    </div>
  );
}

/* ── Vehicles Screen ─────────────────────────────────────────────────────── */
function VehiclesScreen({vehicles,setVehicles,toastAdd}){
  const isMobile=useIsMobile();
  const [vDrawer,setVDrawer]=useState(false);
  const [editVehicle,setEditVehicle]=useState(null);
  const blankV={name:'',make:'',model:'',year:'',color:'#3B82F6',notes:'',vin:''};
  const [vinLoading,setVinLoading]=useState(false);
  const [vForm,setVForm]=useState(blankV);

  const [sDrawer,setSDrawer]=useState(false);
  const [sVehicleId,setSVehicleId]=useState(null);
  const [editService,setEditService]=useState(null);
  const blankS={name:'',interval_days:'',interval_miles:'',notes:''};
  const [sForm,setSForm]=useState(blankS);

  const [doneTarget,setDoneTarget]=useState(null);
  const [doneDate,setDoneDate]=useState('');
  const [doneMiles,setDoneMiles]=useState('');

  const [mileageLogs,setMileageLogs]=useState({});
  const [mileageFormVid,setMileageFormVid]=useState(null);
  const [mileageInput,setMileageInput]=useState('');
  const [mileageDate,setMileageDate]=useState(localDate());
  const [mileageNote,setMileageNote]=useState('');

  useEffect(()=>{
    vehicles.forEach(v=>{
      api.get(`/api/vehicles/${v.id}/mileage`).then(rows=>{
        if(Array.isArray(rows)) setMileageLogs(p=>({...p,[v.id]:rows}));
      }).catch(()=>{});
    });
  },[vehicles.length]);

  const loadMileage=async vid=>{
    const rows=await api.get(`/api/vehicles/${vid}/mileage`).catch(()=>null);
    if(Array.isArray(rows)) setMileageLogs(p=>({...p,[vid]:rows}));
  };

  const logMileage=async vid=>{
    const m=parseInt(mileageInput);
    if(!m||m<=0){toastAdd('Enter a valid mileage','red');return;}
    const r=await api.post(`/api/vehicles/${vid}/mileage`,{miles:m,date:mileageDate,note:mileageNote}).catch(()=>null);
    if(!r?.id){toastAdd('Failed to log','red');return;}
    setMileageLogs(p=>({...p,[vid]:[r,...(p[vid]||[])]}));
    setMileageFormVid(null);setMileageInput('');setMileageNote('');setMileageDate(localDate());
    toastAdd('Mileage logged');
  };

  const delMileage=async(vid,mid)=>{
    try{await api.del(`/api/vehicles/${vid}/mileage/${mid}`);}catch{toastAdd('Failed to delete','red');return;}
    setMileageLogs(p=>({...p,[vid]:(p[vid]||[]).filter(x=>x.id!==mid)}));
  };

  const svcStatus=s=>{
    if(!s.next_due_date) return 'gray';
    const d=daysUntil(s.next_due_date);
    if(d<0) return 'red';
    if(d<=30) return 'amber';
    return 'green';
  };
  const svcColor=st=>({red:A.red,amber:A.amber,green:A.green,gray:A.label5}[st]);
  const dueLabel=s=>{
    if(!s.next_due_date){
      if(s.interval_miles>0) return `Every ${Number(s.interval_miles).toLocaleString()} mi`;
      return 'No schedule set';
    }
    const d=daysUntil(s.next_due_date);
    if(d<0) return `Overdue by ${Math.abs(d)} day${Math.abs(d)===1?'':'s'}`;
    if(d===0) return 'Due today';
    return `Due in ${d} day${d===1?'':'s'}`;
  };
  const intervalLabel=s=>{
    const parts=[];
    if(s.interval_days>0) parts.push(`every ${s.interval_days}d`);
    if(s.interval_miles>0) parts.push(`every ${Number(s.interval_miles).toLocaleString()} mi`);
    return parts.join(' · ');
  };

  const openNewVehicle=()=>{setEditVehicle(null);setVForm(blankV);setVDrawer(true);};
  const openEditVehicle=v=>{setEditVehicle(v);setVForm({name:v.name,make:v.make||'',model:v.model||'',year:v.year?String(v.year):'',color:v.color||'#3B82F6',notes:v.notes||'',vin:v.vin||''});setVDrawer(true);};

  const saveVehicle=async()=>{
    if(!vForm.name.trim()){toastAdd('Name required','red');return;}
    const payload={name:vForm.name.trim(),make:vForm.make,model:vForm.model,year:parseInt(vForm.year)||0,color:vForm.color,notes:vForm.notes,vin:vForm.vin||''};
    if(editVehicle){
      const r=await api.put(`/api/vehicles/${editVehicle.id}`,payload).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setVehicles(p=>p.map(v=>v.id===r.id?{...r,services:v.services||[]}:v));
    }else{
      const r=await api.post('/api/vehicles',payload).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setVehicles(p=>[...p,{...r,services:[]}].sort((a,b)=>a.name.localeCompare(b.name)));
    }
    setVDrawer(false);setEditVehicle(null);
    toastAdd(editVehicle?'Vehicle updated':'Vehicle added');
  };

  const delVehicle=async id=>{
    await api.del(`/api/vehicles/${id}`).catch(()=>{});
    setVehicles(p=>p.filter(v=>v.id!==id));
    setVDrawer(false);setEditVehicle(null);
    toastAdd('Vehicle removed','blue');
  };

  const openNewService=vid=>{setSVehicleId(vid);setEditService(null);setSForm(blankS);setSDrawer(true);};
  const openEditService=(vid,s)=>{setSVehicleId(vid);setEditService(s);setSForm({name:s.name,interval_days:s.interval_days||'',interval_miles:s.interval_miles||'',notes:s.notes||''});setSDrawer(true);};

  const saveService=async()=>{
    if(!sForm.name.trim()){toastAdd('Name required','red');return;}
    const payload={name:sForm.name.trim(),interval_days:parseInt(sForm.interval_days)||0,interval_miles:parseInt(sForm.interval_miles)||0,notes:sForm.notes};
    if(editService){
      const r=await api.put(`/api/vehicles/${sVehicleId}/services/${editService.id}`,payload).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setVehicles(p=>p.map(v=>v.id===sVehicleId?{...v,services:(v.services||[]).map(s=>s.id===r.id?r:s)}:v));
    }else{
      const r=await api.post(`/api/vehicles/${sVehicleId}/services`,payload).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setVehicles(p=>p.map(v=>v.id===sVehicleId?{...v,services:[...(v.services||[]),r]}:v));
    }
    setSDrawer(false);setEditService(null);
    toastAdd(editService?'Service updated':'Service added');
  };

  const delService=async(vid,sid)=>{
    await api.del(`/api/vehicles/${vid}/services/${sid}`).catch(()=>{});
    setVehicles(p=>p.map(v=>v.id===vid?{...v,services:(v.services||[]).filter(s=>s.id!==sid)}:v));
    setSDrawer(false);setEditService(null);
    toastAdd('Service removed','blue');
  };

  const openDone=(vid,s)=>{setDoneTarget({vehicleId:vid,service:s});setDoneDate(localDate());setDoneMiles('');};
  const confirmDone=async()=>{
    if(!doneTarget) return;
    const {vehicleId,service}=doneTarget;
    const r=await api.post(`/api/vehicles/${vehicleId}/services/${service.id}/done`,{date:doneDate,miles:parseInt(doneMiles)||0}).catch(()=>null);
    if(!r?.id){toastAdd('Failed to log','red');return;}
    setVehicles(p=>p.map(v=>v.id===vehicleId?{...v,services:(v.services||[]).map(s=>s.id===r.id?r:s)}:v));
    setDoneTarget(null);
    toastAdd('Service logged');
  };

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Vehicles</h1>
        <Btn onClick={openNewVehicle}>+ Add</Btn>
      </div>

      {vehicles.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No vehicles</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Add a vehicle to track oil changes, tire rotations, and other maintenance intervals.</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:20}}>
          {vehicles.map(v=>(
            <div key={v.id}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:10,height:10,borderRadius:'50%',background:v.color||'#3B82F6',flexShrink:0}}/>
                  <div>
                    <span style={{fontSize:13,fontWeight:700,color:A.label2,letterSpacing:'-.01em'}}>
                      {v.name}{v.year?` · ${v.year}`:''}
                      {(v.make||v.model)?` · ${[v.make,v.model].filter(Boolean).join(' ')}`:''}
                    </span>
                    {v.vin&&<div style={{fontSize:11,color:A.label4,fontFamily:'JetBrains Mono,monospace',marginTop:1,letterSpacing:'.04em'}}>{v.vin}</div>}
                  </div>
                </div>
                <button onClick={()=>openEditVehicle(v)} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:13,padding:'0 4px'}}>Edit</button>
              </div>
              <Card style={{overflow:'hidden',padding:0}}>
                {(()=>{
                  const logs=mileageLogs[v.id];
                  const latestMiles=logs&&logs.length>0?logs[0].miles:null;
                  return(
                    <div style={{padding:'12px 18px',borderBottom:`1px solid ${A.sep}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                      <div style={{fontSize:13,color:A.label3}}>
                        {latestMiles!=null?(
                          <span><span style={{fontWeight:700,color:A.label1}}>{Number(latestMiles).toLocaleString()}</span> mi current odometer</span>
                        ):(
                          <span style={{color:A.label4}}>No mileage logged</span>
                        )}
                      </div>
                      <button onClick={()=>{
                        if(!mileageLogs[v.id]) loadMileage(v.id);
                        setMileageFormVid(mileageFormVid===v.id?null:v.id);
                        setMileageInput('');setMileageNote('');setMileageDate(localDate());
                      }} style={{background:'none',border:`1.5px solid ${A.sep}`,borderRadius:20,padding:'4px 12px',fontSize:12,fontWeight:600,color:A.label3,cursor:'pointer'}}>
                        {mileageFormVid===v.id?'Cancel':'Log miles'}
                      </button>
                    </div>
                  );
                })()}
                {mileageFormVid===v.id&&(
                  <div style={{padding:'12px 18px',borderBottom:`1px solid ${A.sep}`,background:A.inputBg}}>
                    <div style={{display:'flex',gap:8,alignItems:'flex-end',flexWrap:'wrap'}}>
                      <div style={{flex:'1 1 120px'}}>
                        <div style={{fontSize:11,fontWeight:600,color:A.label4,marginBottom:4}}>Miles</div>
                        <Inp type="number" value={mileageInput} onChange={e=>setMileageInput(e.target.value)} placeholder="e.g. 47322"/>
                      </div>
                      <div style={{flex:'1 1 130px'}}>
                        <div style={{fontSize:11,fontWeight:600,color:A.label4,marginBottom:4}}>Date</div>
                        <Inp type="date" value={mileageDate} onChange={e=>setMileageDate(e.target.value)}/>
                      </div>
                      <div style={{flex:'2 1 180px'}}>
                        <div style={{fontSize:11,fontWeight:600,color:A.label4,marginBottom:4}}>Note (optional)</div>
                        <Inp value={mileageNote} onChange={e=>setMileageNote(e.target.value)} placeholder="e.g. Oil change"/>
                      </div>
                      <Btn onClick={()=>logMileage(v.id)}>Save</Btn>
                    </div>
                  </div>
                )}
                {(v.services||[]).length===0&&(
                  <div style={{padding:'16px 18px',fontSize:14,color:A.label4}}>No services tracked yet.</div>
                )}
                {(v.services||[]).map((s,i)=>{
                  const st=svcStatus(s);
                  const logs=mileageLogs[v.id];
                  const latestMiles=logs&&logs.length>0?logs[0].miles:null;
                  let milesUntil=null;
                  if(s.interval_miles>0&&latestMiles!=null&&s.last_done_miles>0){
                    const milesSinceService=latestMiles-s.last_done_miles;
                    milesUntil=s.interval_miles-milesSinceService;
                  }
                  return(
                    <div key={s.id} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 18px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                      <div style={{width:8,height:8,borderRadius:'50%',background:svcColor(st),flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:15,fontWeight:600,color:A.label1}}>{s.name}</div>
                        <div style={{fontSize:12,color:st==='red'?A.red:A.label5,marginTop:2}}>
                          {dueLabel(s)}{intervalLabel(s)?` · ${intervalLabel(s)}`:''}
                          {milesUntil!=null&&<span style={{marginLeft:4,color:milesUntil<=0?A.red:milesUntil<=500?A.amber:A.label5}}>
                            {milesUntil<=0?` · ${Math.abs(milesUntil).toLocaleString()} mi overdue`:` · ${milesUntil.toLocaleString()} mi until service`}
                          </span>}
                        </div>
                      </div>
                      <button onClick={()=>openDone(v.id,s)} style={{background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:20,padding:'5px 14px',fontSize:12,fontWeight:600,color:A.label3,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>Mark done</button>
                      <button onClick={()=>openEditService(v.id,s)} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:13,padding:'0 4px',flexShrink:0}}>Edit</button>
                    </div>
                  );
                })}
                <div style={{padding:'12px 18px',borderTop:(v.services||[]).length>0?`1px solid ${A.sep}`:'none'}}>
                  <button onClick={()=>openNewService(v.id)} style={{background:'none',border:'none',color:A.blue,fontSize:14,fontWeight:600,cursor:'pointer',padding:0}}>+ Add service</button>
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      {doneTarget&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={()=>setDoneTarget(null)}>
          <div style={{background:A.cardBg,borderRadius:A.r,padding:24,width:'100%',maxWidth:320,boxShadow:A.shadowLg}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:17,fontWeight:700,color:A.label1,marginBottom:4}}>Mark as done</div>
            <div style={{fontSize:14,color:A.label3,marginBottom:20}}>{doneTarget.service.name}</div>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:600,color:A.label4,marginBottom:6}}>Date</div>
              <Inp type="date" value={doneDate} onChange={e=>setDoneDate(e.target.value)}/>
            </div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:12,fontWeight:600,color:A.label4,marginBottom:6}}>Current mileage (optional)</div>
              <Inp type="number" value={doneMiles} onChange={e=>setDoneMiles(e.target.value)} placeholder="e.g. 47322"/>
            </div>
            <div style={{display:'flex',gap:8}}>
              <Btn onClick={confirmDone} full>Confirm</Btn>
              <Btn variant="ghost" onClick={()=>setDoneTarget(null)} full>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <Drawer open={vDrawer} onClose={()=>{setVDrawer(false);setEditVehicle(null);setVForm(blankV);}} title={editVehicle?'Edit Vehicle':'New Vehicle'}>
        <FormGroup label="Name"><div style={{padding:'12px 16px'}}><Inp value={vForm.name} onChange={e=>setVForm(f=>({...f,name:e.target.value}))} placeholder="Mike's Truck"/></div></FormGroup>
        <FormGroup label="VIN (optional)">
          <div style={{padding:'12px 16px',display:'flex',gap:8,alignItems:'center'}}>
            <Inp value={vForm.vin} onChange={e=>setVForm(f=>({...f,vin:e.target.value.toUpperCase()}))}
              onBlur={async e=>{
                const vin=e.target.value.trim();
                if(vin.length!==17) return;
                setVinLoading(true);
                const r=await api.get(`/api/vehicles/vin/${vin}`).catch(()=>null);
                setVinLoading(false);
                if(!r||r.error){toastAdd(r?.error||'VIN not found','red');return;}
                setVForm(f=>({...f,make:r.make||f.make,model:r.model||f.model,year:r.year?String(r.year):f.year}));
                toastAdd('VIN decoded — make/model/year filled');
              }}
              placeholder="17-character VIN" style={{flex:1,fontFamily:'JetBrains Mono,monospace',fontSize:13,letterSpacing:'.04em'}}/>
            {vinLoading&&<span style={{fontSize:12,color:A.label4}}>Decoding…</span>}
          </div>
        </FormGroup>
        <FormGroup label="Year"><div style={{padding:'12px 16px'}}><Inp type="number" value={vForm.year} onChange={e=>setVForm(f=>({...f,year:e.target.value}))} placeholder="2021"/></div></FormGroup>
        <FormGroup label="Make"><div style={{padding:'12px 16px'}}><Inp value={vForm.make} onChange={e=>setVForm(f=>({...f,make:e.target.value}))} placeholder="Toyota"/></div></FormGroup>
        <FormGroup label="Model"><div style={{padding:'12px 16px'}}><Inp value={vForm.model} onChange={e=>setVForm(f=>({...f,model:e.target.value}))} placeholder="4Runner"/></div></FormGroup>
        <FormGroup label="Color">
          <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:10}}>
            <input type="color" value={vForm.color} onChange={e=>setVForm(f=>({...f,color:e.target.value}))} style={{width:36,height:36,border:'none',borderRadius:6,cursor:'pointer',background:'transparent'}}/>
            <span style={{fontSize:13,color:A.label3}}>Shows on calendar</span>
          </div>
        </FormGroup>
        <FormGroup label="Notes (optional)"><div style={{padding:'12px 16px'}}><Inp value={vForm.notes} onChange={e=>setVForm(f=>({...f,notes:e.target.value}))}/></div></FormGroup>
        <div style={{padding:'12px 16px',display:'flex',gap:8}}>
          <Btn onClick={saveVehicle} full>Save</Btn>
          {editVehicle&&<Btn variant="ghost" onClick={()=>delVehicle(editVehicle.id)} full>Delete</Btn>}
        </div>
      </Drawer>

      <Drawer open={sDrawer} onClose={()=>{setSDrawer(false);setEditService(null);setSForm(blankS);}} title={editService?'Edit Service':'New Service'}>
        <FormGroup label="Service"><div style={{padding:'12px 16px'}}><Inp value={sForm.name} onChange={e=>setSForm(f=>({...f,name:e.target.value}))} placeholder="Oil Change, Tire Rotation…"/></div></FormGroup>
        <FormGroup label="Interval (days)"><div style={{padding:'12px 16px'}}><Inp type="number" value={sForm.interval_days} onChange={e=>setSForm(f=>({...f,interval_days:e.target.value}))} placeholder="e.g. 90"/></div></FormGroup>
        <FormGroup label="Interval (miles)"><div style={{padding:'12px 16px'}}><Inp type="number" value={sForm.interval_miles} onChange={e=>setSForm(f=>({...f,interval_miles:e.target.value}))} placeholder="e.g. 5000"/></div></FormGroup>
        <FormGroup label="Notes (optional)"><div style={{padding:'12px 16px'}}><Inp value={sForm.notes} onChange={e=>setSForm(f=>({...f,notes:e.target.value}))}/></div></FormGroup>
        <div style={{padding:'12px 16px',display:'flex',gap:8}}>
          <Btn onClick={saveService} full>Save</Btn>
          {editService&&<Btn variant="ghost" onClick={()=>delService(sVehicleId,editService.id)} full>Delete</Btn>}
        </div>
      </Drawer>
    </div>
  );
}

/* ── Bills Screen ────────────────────────────────────────────────────────── */
const BILL_CATEGORIES=['Housing','Utilities','Subscriptions','Insurance','Auto','Health','Other'];

function BillsScreen({bills,setBills,payments,setPayments,toastAdd}){
  const isMobile=useIsMobile();
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [editBill,setEditBill]=useState(null);
  const blankForm={name:'',amount:'',due_day:1,due_date:'',recurrence:'monthly',category:'Other',color:'#3B82F6',notes:''};
  const [form,setForm]=useState(blankForm);

  const now=new Date();
  const currentPeriod=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const currentYear=String(now.getFullYear());
  const monthName=['January','February','March','April','May','June','July','August','September','October','November','December'][now.getMonth()];

  const getPeriod=b=>b.recurrence==='monthly'?currentPeriod:b.recurrence==='annual'?currentYear:b.due_date;
  const paidSet=new Set(payments.map(p=>`${p.bill_id}_${p.period}`));
  const isPaid=b=>paidSet.has(`${b.id}_${getPeriod(b)}`);

  const monthTotal=bills.filter(b=>b.recurrence==='monthly').reduce((s,b)=>s+(Number(b.amount)||0),0);
  const paidCount=bills.filter(b=>isPaid(b)).length;

  const togglePaid=async b=>{
    const period=getPeriod(b);
    if(isPaid(b)){
      setPayments(p=>p.filter(x=>!(x.bill_id===b.id&&x.period===period)));
      const r=await api.del(`/api/bills/${b.id}/pay/${period}`).catch(()=>null);
      if(r?.error){
        setPayments(p=>[...p,{bill_id:b.id,period,paid_at:new Date().toISOString()}]);
        toastAdd('Failed to update','red');
      }
    }else{
      setPayments(p=>[...p,{bill_id:b.id,period,paid_at:new Date().toISOString()}]);
      const r=await api.post(`/api/bills/${b.id}/pay`,{period}).catch(()=>null);
      if(r?.error){
        setPayments(p=>p.filter(x=>!(x.bill_id===b.id&&x.period===period)));
        toastAdd('Failed to update','red');
      }
    }
  };

  const openNew=()=>{setEditBill(null);setForm(blankForm);setDrawerOpen(true);};
  const openEdit=b=>{setEditBill(b);setForm({name:b.name,amount:b.amount>0?String(b.amount):'',due_day:b.due_day||1,due_date:b.due_date||'',recurrence:b.recurrence||'monthly',category:b.category||'Other',color:b.color||'#3B82F6',notes:b.notes||''});setDrawerOpen(true);};

  const save=async()=>{
    if(!form.name.trim()){toastAdd('Name required','red');return;}
    const payload={name:form.name.trim(),amount:parseFloat(form.amount)||0,due_day:parseInt(form.due_day)||1,due_date:form.due_date,recurrence:form.recurrence,category:form.category,color:form.color,notes:form.notes};
    if(editBill){
      const r=await api.put(`/api/bills/${editBill.id}`,payload).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setBills(p=>p.map(x=>x.id===r.id?r:x));
    }else{
      const r=await api.post('/api/bills',payload).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setBills(p=>[...p,r].sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name)));
    }
    setDrawerOpen(false);setEditBill(null);
    toastAdd(editBill?'Bill updated':'Bill added');
  };

  const del=async id=>{
    await api.del(`/api/bills/${id}`).catch(()=>{});
    setBills(p=>p.filter(x=>x.id!==id));
    setDrawerOpen(false);setEditBill(null);
    toastAdd('Bill removed','blue');
  };

  const grouped=BILL_CATEGORIES.map(cat=>({cat,items:bills.filter(b=>b.category===cat)})).filter(g=>g.items.length>0);

  const dueLabel=b=>b.recurrence==='monthly'?`Due the ${ordinal(b.due_day||1)}`:b.recurrence==='annual'?`Annual · ${b.due_date}`:`One-time · ${b.due_date}`;

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Bills</h1>
          <p style={{color:A.label4,fontSize:15,marginTop:6}}>
            {monthName} · {paidCount} of {bills.length} paid
            {monthTotal>0&&` · $${monthTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} / mo`}
          </p>
        </div>
        <Btn onClick={openNew}>+ Add</Btn>
      </div>

      {bills.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No bills yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Add recurring bills to get calendar reminders on due dates. Billing emails are detected automatically.</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {grouped.map(({cat,items})=>(
            <div key={cat}>
              <div style={{fontSize:11,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>{cat}</div>
              <Card style={{overflow:'hidden',padding:0}}>
                {items.map((b,i)=>{
                  const paid=isPaid(b);
                  return(
                    <div key={b.id} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 18px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                      <div style={{width:10,height:10,borderRadius:'50%',background:b.color||'#3B82F6',flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:15,fontWeight:600,color:paid?A.label4:A.label1,textDecoration:paid?'line-through':'none',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.name}</div>
                        <div style={{fontSize:12,color:A.label5,marginTop:2}}>{dueLabel(b)}{Number(b.amount)>0?` · $${Number(b.amount).toFixed(2)}`:''}</div>
                      </div>
                      <button onClick={()=>togglePaid(b)} style={{background:paid?A.green:A.inputBg,border:`1.5px solid ${paid?A.green:A.sep}`,borderRadius:20,padding:'5px 14px',fontSize:12,fontWeight:600,color:paid?'#fff':A.label3,cursor:'pointer',flexShrink:0,transition:'all .15s',whiteSpace:'nowrap'}}>
                        {paid?'✓ Paid':'Mark paid'}
                      </button>
                      <button onClick={()=>openEdit(b)} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:13,padding:'0 4px',flexShrink:0}}>Edit</button>
                    </div>
                  );
                })}
              </Card>
            </div>
          ))}
        </div>
      )}

      <Drawer open={drawerOpen} onClose={()=>{setDrawerOpen(false);setEditBill(null);setForm(blankForm);}} title={editBill?'Edit Bill':'New Bill'}>
        <FormGroup label="Name"><div style={{padding:'12px 16px'}}><Inp value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Rent, Electric, Netflix…"/></div></FormGroup>
        <FormGroup label="Amount (optional)"><div style={{padding:'12px 16px'}}><Inp type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"/></div></FormGroup>
        <FormGroup label="Recurrence">
          <div style={{padding:'12px 16px'}}>
            <SegControl value={form.recurrence} onChange={v=>setForm(f=>({...f,recurrence:v}))} options={['monthly','annual','one-time']}/>
          </div>
        </FormGroup>
        {form.recurrence==='monthly'&&(
          <FormGroup label="Due day"><div style={{padding:'12px 16px'}}>
            <select value={form.due_day} onChange={e=>setForm(f=>({...f,due_day:parseInt(e.target.value)}))} style={{background:'var(--input-bg,#F2F2F7)',border:'none',borderRadius:A.rSm,padding:'10px 12px',fontSize:14,color:'inherit',cursor:'pointer',width:'100%'}}>
              {Array.from({length:28},(_,i)=>i+1).map(d=><option key={d} value={d}>{ordinal(d)} of the month</option>)}
            </select>
          </div></FormGroup>
        )}
        {(form.recurrence==='annual'||form.recurrence==='one-time')&&(
          <FormGroup label="Due date"><div style={{padding:'12px 16px'}}><Inp type="date" value={form.due_date} onChange={e=>setForm(f=>({...f,due_date:e.target.value}))}/></div></FormGroup>
        )}
        <FormGroup label="Category"><div style={{padding:'12px 16px'}}>
          <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} style={{background:'var(--input-bg,#F2F2F7)',border:'none',borderRadius:A.rSm,padding:'10px 12px',fontSize:14,color:'inherit',cursor:'pointer',width:'100%'}}>
            {BILL_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div></FormGroup>
        <FormGroup label="Color">
          <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:10}}>
            <input type="color" value={form.color} onChange={e=>setForm(f=>({...f,color:e.target.value}))} style={{width:36,height:36,border:'none',borderRadius:6,cursor:'pointer',background:'transparent'}}/>
            <span style={{fontSize:13,color:A.label3}}>Shows as this color on calendar</span>
          </div>
        </FormGroup>
        <FormGroup label="Notes (optional)"><div style={{padding:'12px 16px'}}><Inp value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Account number, website, etc."/></div></FormGroup>
        <div style={{padding:'12px 16px',display:'flex',gap:8}}>
          <Btn onClick={save} full>Save</Btn>
          {editBill&&<Btn variant="ghost" onClick={()=>del(editBill.id)} full>Delete</Btn>}
        </div>
      </Drawer>
    </div>
  );
}

/* ── Budget Screen ───────────────────────────────────────────────────────── */
function BudgetScreen({budget,setBudget,toastAdd}){
  const isMobile=useIsMobile();
  const {categories=[],entries=[]}=budget||{};
  const [spendDrawer,setSpendDrawer]=useState(false);
  const [catDrawer,setCatDrawer]=useState(false);
  const [editCat,setEditCat]=useState(null);
  const [expandedCat,setExpandedCat]=useState(null);
  const [spendForm,setSpendForm]=useState({amount:'',category_id:'',note:'',date:localDate()});
  const [catForm,setCatForm]=useState({name:'',monthly_budget:'',color:'#3B82F6'});
  const [importOpen,setImportOpen]=useState(false);
  const [importRows,setImportRows]=useState(null);
  const [importCatId,setImportCatId]=useState('');
  const [importLoading,setImportLoading]=useState(false);
  const [importDetected,setImportDetected]=useState('');

  const BUDGET_COLORS=['#3B82F6','#34C759','#FF9500','#FF3B30','#AF52DE','#32ADE6','#5856D6','#FF6B6B','#4ECDC4','#FFE66D'];

  const spentForCat=id=>entries.filter(e=>e.category_id===id).reduce((s,e)=>s+Number(e.amount),0);
  const totalBudget=categories.reduce((s,c)=>s+Number(c.monthly_budget||0),0);
  const totalSpent=entries.reduce((s,e)=>s+Number(e.amount),0);

  const monthName=new Date().toLocaleDateString(undefined,{month:'long',year:'numeric'});

  const saveSpend=async()=>{
    if(!spendForm.amount||isNaN(Number(spendForm.amount))||Number(spendForm.amount)<=0){toastAdd('Enter a valid amount','red');return;}
    if(!spendForm.category_id){toastAdd('Select a category','red');return;}
    const catId=Number(spendForm.category_id);
    const r=await api.post('/api/budget/entries',{...spendForm,amount:Number(spendForm.amount),category_id:catId}).catch(()=>null);
    if(!r?.id){toastAdd('Failed to save','red');return;}
    setBudget(b=>({...b,entries:[r,...(b.entries||[])]}));
    setSpendDrawer(false);setSpendForm({amount:'',category_id:'',note:'',date:localDate()});
    toastAdd('Spending logged');
    const cat=(categories||[]).find(c=>c.id===catId);
    if(cat&&Number(cat.monthly_budget)>0){
      const monthPrefix=new Date().toISOString().slice(0,7);
      const spent=[...(entries||[]),r]
        .filter(e=>e.category_id===cat.id&&e.date?.startsWith(monthPrefix))
        .reduce((s,e)=>s+Number(e.amount),0);
      if(spent>Number(cat.monthly_budget)){
        toastAdd(`Over budget on ${cat.name} ($${spent.toFixed(0)} / $${Number(cat.monthly_budget).toFixed(0)})`,'red');
      }
    }
  };

  const delEntry=async id=>{
    try{await api.del(`/api/budget/entries/${id}`);}catch{toastAdd('Failed','red');return;}
    setBudget(b=>({...b,entries:(b.entries||[]).filter(e=>e.id!==id)}));
  };

  const saveCat=async()=>{
    if(!catForm.name.trim()){toastAdd('Name required','red');return;}
    if(editCat){
      const r=await api.put(`/api/budget/categories/${editCat.id}`,{...catForm,monthly_budget:Number(catForm.monthly_budget)||0}).catch(()=>null);
      if(!r?.id){toastAdd('Failed','red');return;}
      setBudget(b=>({...b,categories:(b.categories||[]).map(c=>c.id===r.id?r:c).sort((a,z)=>a.name.localeCompare(z.name))}));
    }else{
      const r=await api.post('/api/budget/categories',{...catForm,monthly_budget:Number(catForm.monthly_budget)||0}).catch(()=>null);
      if(!r?.id){toastAdd('Failed','red');return;}
      setBudget(b=>({...b,categories:[...(b.categories||[]),r].sort((a,z)=>a.name.localeCompare(z.name))}));
    }
    setCatDrawer(false);setEditCat(null);setCatForm({name:'',monthly_budget:'',color:'#3B82F6'});
    toastAdd(editCat?'Category updated':'Category added');
  };

  const delCat=async id=>{
    try{await api.del(`/api/budget/categories/${id}`);}catch{toastAdd('Failed','red');return;}
    setBudget(b=>({...b,categories:(b.categories||[]).filter(c=>c.id!==id),entries:(b.entries||[]).filter(e=>e.category_id!==id)}));
    setCatDrawer(false);setEditCat(null);
    toastAdd('Deleted','blue');
  };

  const barColor=(spent,budget)=>{
    if(!budget) return A.blue;
    const pct=spent/budget;
    if(pct>1) return A.red;
    if(pct>=0.75) return A.amber;
    return A.green;
  };

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Budget</h1>
          <p style={{color:A.label4,fontSize:15,marginTop:6}}>{monthName}</p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button onClick={()=>{setEditCat(null);setCatForm({name:'',monthly_budget:'',color:'#3B82F6'});setCatDrawer(true);}} style={{background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.rSm,padding:'9px 14px',fontSize:13,fontWeight:600,color:A.label2,cursor:'pointer'}}>+ Category</button>
          <button onClick={()=>{setImportOpen(true);setImportRows(null);setImportCatId('');}} style={{background:A.inputBg,border:`1px solid ${A.sep}`,borderRadius:A.rSm,padding:'9px 14px',fontSize:13,fontWeight:600,color:A.label2,cursor:'pointer'}}>Import CSV</button>
          <Btn onClick={()=>setSpendDrawer(true)}>+ Add Spending</Btn>
        </div>
      </div>

      {totalBudget>0&&(
        <Card style={{padding:'18px 20px',marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:700,color:A.label2}}>Monthly total</div>
            <div style={{fontSize:13,color:A.label4}}><span style={{fontWeight:700,color:totalSpent>totalBudget?A.red:A.label1}}>${totalSpent.toFixed(2)}</span> of ${totalBudget.toFixed(2)}</div>
          </div>
          <div style={{height:8,borderRadius:4,background:A.inputBg,overflow:'hidden'}}>
            <div style={{height:'100%',borderRadius:4,background:barColor(totalSpent,totalBudget),width:`${Math.min(100,(totalSpent/totalBudget)*100)}%`,transition:'width .3s'}}/>
          </div>
        </Card>
      )}

      {categories.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No categories</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Add a category like Groceries or Dining to start tracking.</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {categories.map(cat=>{
            const spent=spentForCat(cat.id);
            const hasBudget=Number(cat.monthly_budget)>0;
            const pct=hasBudget?Math.min(100,(spent/cat.monthly_budget)*100):0;
            const catEntries=entries.filter(e=>e.category_id===cat.id);
            const expanded=expandedCat===cat.id;
            return(
              <Card key={cat.id} style={{overflow:'hidden',padding:0}}>
                <div style={{padding:'16px 18px',cursor:'pointer'}} onClick={()=>setExpandedCat(expanded?null:cat.id)}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:hasBudget?10:0}}>
                    <div style={{width:10,height:10,borderRadius:'50%',background:cat.color||A.blue,flexShrink:0}}/>
                    <div style={{flex:1,fontSize:15,fontWeight:600,color:A.label1}}>{cat.name}</div>
                    <div style={{fontSize:13,color:A.label4}}>
                      <span style={{fontWeight:700,color:hasBudget&&spent>cat.monthly_budget?A.red:A.label1}}>${spent.toFixed(2)}</span>
                      {hasBudget&&<span style={{color:A.label4}}> of ${Number(cat.monthly_budget).toFixed(2)}</span>}
                    </div>
                    <button onClick={e=>{e.stopPropagation();setEditCat(cat);setCatForm({name:cat.name,monthly_budget:cat.monthly_budget||'',color:cat.color||'#3B82F6'});setCatDrawer(true);}} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:12,padding:'0 4px'}}>Edit</button>
                  </div>
                  {hasBudget&&(
                    <div style={{height:6,borderRadius:3,background:A.inputBg,overflow:'hidden'}}>
                      <div style={{height:'100%',borderRadius:3,background:barColor(spent,cat.monthly_budget),width:`${pct}%`,transition:'width .3s'}}/>
                    </div>
                  )}
                </div>
                {expanded&&(
                  <div style={{borderTop:`1px solid ${A.sep}`}}>
                    {catEntries.length===0?(
                      <div style={{padding:'12px 18px',fontSize:14,color:A.label4}}>No entries this month.</div>
                    ):catEntries.map((e,i)=>(
                      <div key={e.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 18px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:14,fontWeight:500,color:A.label1}}>{e.note||'Expense'}</div>
                          <div style={{fontSize:12,color:A.label4,marginTop:1}}>{e.date}</div>
                        </div>
                        <div style={{fontSize:14,fontWeight:600,color:A.label1}}>${Number(e.amount).toFixed(2)}</div>
                        <button onClick={()=>delEntry(e.id)} style={{background:'none',border:'none',color:A.red,cursor:'pointer',fontSize:12,padding:'0 4px'}}>Del</button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Drawer open={spendDrawer} onClose={()=>{setSpendDrawer(false);setSpendForm({amount:'',category_id:'',note:'',date:localDate()});}} title="Add Spending">
        <FormGroup label="Amount">
          <div style={{padding:'12px 16px'}}><Inp type="number" value={spendForm.amount} onChange={e=>setSpendForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"/></div>
        </FormGroup>
        <FormGroup label="Category">
          <div style={{padding:'12px 16px'}}>
            <Sel value={spendForm.category_id} onChange={e=>setSpendForm(f=>({...f,category_id:e.target.value}))}>
              <option value="">Select…</option>
              {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </Sel>
          </div>
        </FormGroup>
        <FormGroup label="Note (optional)">
          <div style={{padding:'12px 16px'}}><Inp value={spendForm.note} onChange={e=>setSpendForm(f=>({...f,note:e.target.value}))} placeholder="e.g. Whole Foods"/></div>
        </FormGroup>
        <FormGroup label="Date">
          <div style={{padding:'12px 16px'}}><Inp type="date" value={spendForm.date} onChange={e=>setSpendForm(f=>({...f,date:e.target.value}))}/></div>
        </FormGroup>
        <div style={{padding:'12px 16px'}}><Btn onClick={saveSpend} full>Save</Btn></div>
      </Drawer>

      <Drawer open={catDrawer} onClose={()=>{setCatDrawer(false);setEditCat(null);setCatForm({name:'',monthly_budget:'',color:'#3B82F6'});}} title={editCat?'Edit Category':'Add Category'}>
        <FormGroup label="Name">
          <div style={{padding:'12px 16px'}}><Inp value={catForm.name} onChange={e=>setCatForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Groceries"/></div>
        </FormGroup>
        <FormGroup label="Monthly Budget (optional)">
          <div style={{padding:'12px 16px'}}><Inp type="number" value={catForm.monthly_budget} onChange={e=>setCatForm(f=>({...f,monthly_budget:e.target.value}))} placeholder="0 = no limit"/></div>
        </FormGroup>
        <FormGroup label="Color">
          <div style={{padding:'12px 16px',display:'flex',gap:8,flexWrap:'wrap'}}>
            {BUDGET_COLORS.map(c=>(
              <button key={c} onClick={()=>setCatForm(f=>({...f,color:c}))} style={{width:26,height:26,borderRadius:'50%',background:c,border:catForm.color===c?`2px solid ${A.label1}`:'2px solid transparent',cursor:'pointer'}}/>
            ))}
          </div>
        </FormGroup>
        <div style={{padding:'12px 16px',display:'flex',gap:8}}>
          <Btn onClick={saveCat} full>{editCat?'Save Changes':'Add Category'}</Btn>
          {editCat&&<Btn variant="ghost" onClick={()=>delCat(editCat.id)} full>Delete</Btn>}
        </div>
      </Drawer>

      <Drawer open={importOpen} onClose={()=>{setImportOpen(false);setImportRows(null);setImportCatId('');}} title="Import CSV">
        <div style={{padding:'14px 16px'}}>
          <div style={{fontSize:13,color:A.label3,marginBottom:12}}>Upload a bank statement CSV (Chase, BofA, AMEX, or generic). Only current-month expenses will be imported.</div>
          <input type="file" accept=".csv" onChange={async e=>{
            const file=e.target.files?.[0];
            if(!file) return;
            setImportLoading(true);
            try{
              const text=await file.text();
              const r=await api.post('/api/budget/import/preview',{csv:text});
              if(r?.error){toastAdd(r.error,'red');return;}
              setImportDetected(r.detected);
              setImportRows({rows:r.sample,all:r.all,total:r.total});
            }catch{toastAdd('Failed to parse CSV','red');}
            finally{setImportLoading(false);}
          }} style={{width:'100%',marginBottom:12}}/>
          {importLoading&&<div style={{fontSize:13,color:A.label4}}>Parsing…</div>}
          {importRows&&(
            <>
              <div style={{fontSize:12,color:A.label4,marginBottom:8}}>Detected: <strong style={{color:A.label2}}>{importDetected}</strong> — {importRows.total} expense row{importRows.total!==1?'s':''} this month</div>
              {importRows.rows.length>0&&(
                <div style={{background:A.inputBg,borderRadius:A.rSm,overflow:'hidden',marginBottom:12}}>
                  <div style={{display:'grid',gridTemplateColumns:'100px 1fr 80px',gap:0}}>
                    <div style={{padding:'7px 10px',fontSize:11,fontWeight:700,color:A.label5,textTransform:'uppercase',borderBottom:`1px solid ${A.sep}`}}>Date</div>
                    <div style={{padding:'7px 10px',fontSize:11,fontWeight:700,color:A.label5,textTransform:'uppercase',borderBottom:`1px solid ${A.sep}`}}>Note</div>
                    <div style={{padding:'7px 10px',fontSize:11,fontWeight:700,color:A.label5,textTransform:'uppercase',textAlign:'right',borderBottom:`1px solid ${A.sep}`}}>Amount</div>
                    {importRows.rows.map((row,i)=>(
                      <React.Fragment key={i}>
                        <div style={{padding:'7px 10px',fontSize:12,color:A.label2,borderTop:i>0?`1px solid ${A.sep}`:'none'}}>{row.date}</div>
                        <div style={{padding:'7px 10px',fontSize:12,color:A.label2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>{row.note}</div>
                        <div style={{padding:'7px 10px',fontSize:12,color:A.label2,textAlign:'right',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>${Number(row.amount).toFixed(2)}</div>
                      </React.Fragment>
                    ))}
                  </div>
                  {importRows.total>5&&<div style={{padding:'7px 10px',fontSize:12,color:A.label4,borderTop:`1px solid ${A.sep}`}}>…and {importRows.total-5} more rows</div>}
                </div>
              )}
              <div style={{marginBottom:12}}>
                <div style={{fontSize:13,fontWeight:600,color:A.label2,marginBottom:6}}>Assign to category</div>
                <Sel value={importCatId} onChange={e=>setImportCatId(e.target.value)}>
                  <option value="">Select category…</option>
                  {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </Sel>
              </div>
              <Btn full disabled={!importCatId||importLoading} onClick={async()=>{
                if(!importCatId) return;
                setImportLoading(true);
                try{
                  const r=await api.post('/api/budget/import/confirm',{rows:importRows.all,category_id:Number(importCatId)});
                  if(r?.error){toastAdd(r.error,'red');return;}
                  toastAdd(`Imported ${r.imported} entries`);
                  const fresh=await api.get('/api/budget');
                  if(fresh?.categories) setBudget(fresh);
                  setImportOpen(false);setImportRows(null);setImportCatId('');
                }catch{toastAdd('Import failed','red');}
                finally{setImportLoading(false);}
              }}>{importLoading?'Importing…':`Import ${importRows.total} entries`}</Btn>
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}

/* ── Recipes Screen ───────────────────────────────────────────────────────── */
function RecipesScreen({recipes,setRecipes,toastAdd}){
  const isMobile=useIsMobile();
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [editRecipe,setEditRecipe]=useState(null);
  const [viewRecipe,setViewRecipe]=useState(null);
  const [form,setForm]=useState({name:'',description:'',servings:4,prep_time:0,cook_time:0,ingredients:[],steps:'',source_url:''});
  const [ingLine,setIngLine]=useState('');
  const [search,setSearch]=useState('');

  const blankForm={name:'',description:'',servings:4,prep_time:0,cook_time:0,ingredients:[],steps:'',source_url:''};

  const openNew=()=>{setEditRecipe(null);setForm(blankForm);setIngLine('');setDrawerOpen(true);};
  const openEdit=r=>{
    setEditRecipe(r);
    const ings=typeof r.ingredients==='string'?JSON.parse(r.ingredients||'[]'):r.ingredients||[];
    setForm({name:r.name,description:r.description||'',servings:r.servings||4,prep_time:r.prep_time||0,cook_time:r.cook_time||0,ingredients:ings,steps:r.steps||'',source_url:r.source_url||''});
    setIngLine('');setDrawerOpen(true);
  };

  const addIng=()=>{
    const t=ingLine.trim();
    if(!t) return;
    setForm(f=>({...f,ingredients:[...f.ingredients,{name:t,qty:'',unit:''}]}));
    setIngLine('');
  };
  const removeIng=i=>setForm(f=>({...f,ingredients:f.ingredients.filter((_,j)=>j!==i)}));

  const save=async()=>{
    if(!form.name.trim()){toastAdd('Recipe name required','red');return;}
    const payload={...form,ingredients:JSON.stringify(form.ingredients)};
    if(editRecipe){
      const r=await api.put(`/api/recipes/${editRecipe.id}`,payload).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setRecipes(p=>p.map(x=>x.id===r.id?r:x));
    }else{
      const r=await api.post('/api/recipes',payload).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setRecipes(p=>[...p,r].sort((a,b)=>a.name.localeCompare(b.name)));
    }
    setDrawerOpen(false);setEditRecipe(null);
    toastAdd(editRecipe?'Recipe updated':'Recipe saved');
  };

  const del=async id=>{
    try{await api.del(`/api/recipes/${id}`);}catch{toastAdd('Delete failed','red');return;}
    setRecipes(p=>p.filter(x=>x.id!==id));
    setViewRecipe(null);
    toastAdd('Recipe deleted','blue');
  };

  const parsedView=viewRecipe?{...viewRecipe,ingredients:typeof viewRecipe.ingredients==='string'?JSON.parse(viewRecipe.ingredients||'[]'):viewRecipe.ingredients||[]}:null;

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Recipes</h1>
          <p style={{color:A.label4,fontSize:15,marginTop:6}}>Save recipes · link to meal planner</p>
        </div>
        <Btn onClick={openNew}>+ Add</Btn>
      </div>

      {recipes.length>5&&(
        <div style={{marginBottom:16}}>
          <Inp value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search recipes…"/>
        </div>
      )}

      {(()=>{
        const filtered=search.trim()?recipes.filter(r=>r.name.toLowerCase().includes(search.toLowerCase())||(r.description||'').toLowerCase().includes(search.toLowerCase())):recipes;
        return recipes.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No recipes yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Add your family favorites and link them to the meal planner.</div>
        </Card>
      ):(
        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(260px,1fr))',gap:12}}>
          {filtered.map(r=>{
            const totalMin=(r.prep_time||0)+(r.cook_time||0);
            const timeStr=totalMin?`${totalMin} min`:'';
            return(
              <Card key={r.id} style={{padding:'18px 20px',cursor:'pointer'}} onClick={()=>setViewRecipe(r)}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:16,fontWeight:700,color:A.label1,lineHeight:1.3,marginBottom:4}}>{r.name}</div>
                    {r.description&&<div style={{fontSize:13,color:A.label4,lineHeight:1.4,overflow:'hidden',textOverflow:'ellipsis',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{r.description}</div>}
                  </div>
                </div>
                <div style={{display:'flex',gap:12,marginTop:10,fontSize:12,color:A.label5}}>
                  {timeStr&&<span>{timeStr}</span>}
                  <span>{r.servings||4} servings</span>
                </div>
              </Card>
            );
          })}
        </div>
      );
      })()}

      {/* View modal */}
      <Modal open={!!viewRecipe} onClose={()=>setViewRecipe(null)} title={viewRecipe?.name||''} width={600}>
        {parsedView&&(
          <div style={{padding:'0 24px 24px'}}>
            {parsedView.description&&<p style={{fontSize:14,color:A.label3,marginBottom:16,lineHeight:1.5}}>{parsedView.description}</p>}
            <div style={{display:'flex',gap:16,marginBottom:20,fontSize:13,color:A.label4}}>
              {(parsedView.prep_time||0)+(parsedView.cook_time||0)>0&&<span>{(parsedView.prep_time||0)+(parsedView.cook_time||0)} min total</span>}
              <span>{parsedView.servings||4} servings</span>
              {parsedView.source_url&&<a href={parsedView.source_url} target="_blank" rel="noopener noreferrer" style={{color:A.blue}}>Source</a>}
            </div>
            {parsedView.ingredients.length>0&&(
              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:700,color:A.label2,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:10}}>Ingredients</div>
                <ul style={{margin:0,padding:'0 0 0 18px',display:'flex',flexDirection:'column',gap:4}}>
                  {parsedView.ingredients.map((ing,i)=>(
                    <li key={i} style={{fontSize:14,color:A.label2}}>
                      {ing.qty&&<span style={{fontWeight:600}}>{ing.qty}{ing.unit?' '+ing.unit:''} </span>}{ing.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {parsedView.steps&&(
              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:700,color:A.label2,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:10}}>Instructions</div>
                <div style={{fontSize:14,color:A.label2,lineHeight:1.7,whiteSpace:'pre-wrap'}}>{parsedView.steps}</div>
              </div>
            )}
            <div style={{display:'flex',gap:8,paddingTop:12,borderTop:`1px solid ${A.sep}`}}>
              <Btn sm onClick={()=>{setViewRecipe(null);openEdit(viewRecipe);}}>Edit</Btn>
              <Btn sm variant="ghost" onClick={()=>del(parsedView.id)}>Delete</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Add/Edit drawer */}
      <Drawer open={drawerOpen} onClose={()=>{setDrawerOpen(false);setEditRecipe(null);setForm(blankForm);setIngLine('');}} title={editRecipe?'Edit Recipe':'New Recipe'}>
        <FormGroup label="Name"><div style={{padding:'12px 16px'}}><Inp value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Grandma's lasagna"/></div></FormGroup>
        <FormGroup label="Description"><div style={{padding:'12px 16px'}}><Inp value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Short description"/></div></FormGroup>
        <FormGroup label="Servings &amp; time">
          <div style={{padding:'12px 16px',display:'flex',gap:8}}>
            <div style={{flex:1}}><div style={{fontSize:11,color:A.label5,marginBottom:4}}>Servings</div><Inp type="number" value={form.servings} onChange={e=>setForm(f=>({...f,servings:parseInt(e.target.value)||4}))}/></div>
            <div style={{flex:1}}><div style={{fontSize:11,color:A.label5,marginBottom:4}}>Prep (min)</div><Inp type="number" value={form.prep_time} onChange={e=>setForm(f=>({...f,prep_time:parseInt(e.target.value)||0}))}/></div>
            <div style={{flex:1}}><div style={{fontSize:11,color:A.label5,marginBottom:4}}>Cook (min)</div><Inp type="number" value={form.cook_time} onChange={e=>setForm(f=>({...f,cook_time:parseInt(e.target.value)||0}))}/></div>
          </div>
        </FormGroup>
        <FormGroup label="Ingredients">
          <div style={{padding:'12px 16px',display:'flex',flexDirection:'column',gap:8}}>
            {form.ingredients.map((ing,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:A.label2}}>
                <div style={{flex:1}}>{ing.qty&&<span style={{fontWeight:600}}>{ing.qty}{ing.unit?' '+ing.unit:''} </span>}{ing.name}</div>
                <button onClick={()=>removeIng(i)} style={{background:'none',border:'none',color:A.red,cursor:'pointer',fontSize:16,lineHeight:1}}>×</button>
              </div>
            ))}
            <div style={{display:'flex',gap:6}}>
              <Inp value={ingLine} onChange={e=>setIngLine(e.target.value)} placeholder="2 cups flour" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addIng();}}} style={{flex:1}}/>
              <Btn sm variant="ghost" onClick={addIng}>Add</Btn>
            </div>
            <div style={{fontSize:11,color:A.label5}}>Type ingredient and press Enter or Add. Example: "2 cups flour"</div>
          </div>
        </FormGroup>
        <FormGroup label="Instructions"><div style={{padding:'12px 16px'}}><textarea value={form.steps} onChange={e=>setForm(f=>({...f,steps:e.target.value}))} placeholder="Step by step instructions..." rows={8} style={{width:'100%',background:A.inputBg,border:'none',borderRadius:A.rSm,padding:'10px 12px',fontSize:14,color:'inherit',resize:'vertical',fontFamily:'inherit',lineHeight:1.6}}/></div></FormGroup>
        <FormGroup label="Source URL (optional)"><div style={{padding:'12px 16px'}}><Inp value={form.source_url} onChange={e=>setForm(f=>({...f,source_url:e.target.value}))} placeholder="https://..."/></div></FormGroup>
        <div style={{padding:'16px'}}><Btn onClick={save} full>Save Recipe</Btn></div>
      </Drawer>
    </div>
  );
}

/* ── Home Screen ─────────────────────────────────────────────────────────── */
function ContactsScreen({contacts,setContacts,toastAdd}){
  const isMobile=useIsMobile();
  const CATS=['Home Services','Medical','Emergency','School','Neighbors','Other'];
  const [drawer,setDrawer]=useState(false);
  const [editContact,setEditContact]=useState(null);
  const blank={name:'',role:'',category:'Other',phone:'',email:'',notes:''};
  const [form,setForm]=useState(blank);
  const [search,setSearch]=useState('');

  const openNew=()=>{setEditContact(null);setForm(blank);setDrawer(true);};
  const openEdit=c=>{setEditContact(c);setForm({name:c.name,role:c.role||'',category:c.category||'Other',phone:c.phone||'',email:c.email||'',notes:c.notes||''});setDrawer(true);};

  const save=async()=>{
    if(!form.name.trim()){toastAdd('Name required','red');return;}
    if(editContact){
      const r=await api.put(`/api/contacts/${editContact.id}`,form).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setContacts(p=>p.map(c=>c.id===r.id?r:c));
    }else{
      const r=await api.post('/api/contacts',form).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setContacts(p=>[...p,r].sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name)));
    }
    setDrawer(false);setEditContact(null);
    toastAdd(editContact?'Contact updated':'Contact added');
  };

  const del=async id=>{
    try{await api.del(`/api/contacts/${id}`);setContacts(p=>p.filter(c=>c.id!==id));setDrawer(false);setEditContact(null);toastAdd('Removed','blue');}
    catch{toastAdd('Failed to remove','red');}
  };

  const filtered=search.trim()?(contacts||[]).filter(c=>c.name.toLowerCase().includes(search.toLowerCase())||c.role.toLowerCase().includes(search.toLowerCase())||c.phone.includes(search)):(contacts||[]);
  const byCat=CATS.map(cat=>({cat,items:filtered.filter(c=>c.category===cat)})).filter(g=>g.items.length>0);

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Contacts</h1>
        <Btn onClick={openNew}>+ Add</Btn>
      </div>
      {(contacts||[]).length>4&&(
        <div style={{marginBottom:16}}>
          <Inp value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search contacts…"/>
        </div>
      )}
      {(contacts||[]).length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No contacts yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Add doctors, neighbors, contractors, and other important contacts.</div>
        </Card>
      ):(
        byCat.length===0?(
          <Card style={{padding:'32px 24px',textAlign:'center'}}>
            <div style={{fontSize:14,color:A.label4}}>No results for "{search}"</div>
          </Card>
        ):(
          <div style={{display:'flex',flexDirection:'column',gap:20}}>
            {byCat.map(({cat,items})=>(
              <div key={cat}>
                <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{cat}</div>
                <Card style={{overflow:'hidden',padding:0}}>
                  {items.map((c,i)=>(
                    <div key={c.id} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 18px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:15,fontWeight:600,color:A.label1}}>{c.name}</div>
                        {c.role&&<div style={{fontSize:12,color:A.label4,marginTop:2}}>{c.role}</div>}
                      </div>
                      {c.phone&&<a href={`tel:${c.phone}`} style={{fontSize:13,color:A.blue,fontWeight:500,textDecoration:'none',flexShrink:0}}>{c.phone}</a>}
                      <button onClick={()=>openEdit(c)} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:13,padding:'0 4px',flexShrink:0}}>Edit</button>
                    </div>
                  ))}
                </Card>
              </div>
            ))}
          </div>
        )
      )}
      <Drawer open={drawer} onClose={()=>{setDrawer(false);setEditContact(null);}} title={editContact?'Edit Contact':'Add Contact'}>
        <FormGroup label="Name"><div style={{padding:'12px 16px'}}><Inp value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Dr. Smith"/></div></FormGroup>
        <FormGroup label="Role / description"><div style={{padding:'12px 16px'}}><Inp value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))} placeholder="Pediatrician"/></div></FormGroup>
        <FormGroup label="Category">
          <div style={{padding:'12px 16px'}}>
            <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              {CATS.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </FormGroup>
        <FormGroup label="Phone"><div style={{padding:'12px 16px'}}><Inp type="tel" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="(404) 555-0100"/></div></FormGroup>
        <FormGroup label="Email"><div style={{padding:'12px 16px'}}><Inp type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="doctor@clinic.com"/></div></FormGroup>
        <FormGroup label="Notes (optional)"><div style={{padding:'12px 16px'}}><Inp value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Office hours, insurance, etc."/></div></FormGroup>
        <div style={{display:'flex',gap:8,marginTop:4}}>
          <Btn onClick={save} full>{editContact?'Save Changes':'Add Contact'}</Btn>
          {editContact&&<Btn variant="ghost" onClick={()=>del(editContact.id)} full style={{color:A.red}}>Delete</Btn>}
        </div>
        {!editContact&&<Btn variant="ghost" onClick={()=>setDrawer(false)} full style={{marginTop:8}}>Cancel</Btn>}
      </Drawer>
    </div>
  );
}

function PetsScreen({pets,setPets,toastAdd}){
  const isMobile=useIsMobile();
  const PET_COLORS=['#FF9500','#34C759','#007AFF','#FF3B30','#5856D6','#FF2D55','#AF52DE','#32ADE6'];
  const SPECIES=['Dog','Cat','Bird','Rabbit','Fish','Hamster','Guinea Pig','Reptile','Other'];
  const REC_TYPES=['vaccine','medication','vet_visit','grooming'];

  const [pDrawer,setPDrawer]=useState(false);
  const [editPet,setEditPet]=useState(null);
  const blankP={name:'',species:'',breed:'',birthday:'',vet_name:'',vet_phone:'',color:'#FF9500',notes:''};
  const [pForm,setPForm]=useState(blankP);

  const [rDrawer,setRDrawer]=useState(false);
  const [rPetId,setRPetId]=useState(null);
  const [editRec,setEditRec]=useState(null);
  const blankR={type:'vaccine',name:'',last_done:'',interval_days:'',next_due:'',notes:''};
  const [rForm,setRForm]=useState(blankR);

  const recStatus=r=>{
    if(!r.next_due) return 'gray';
    const d=daysUntil(r.next_due);
    if(d<0) return 'red';
    if(d<=30) return 'amber';
    return 'green';
  };
  const recColor=st=>({red:A.red,amber:A.amber,green:A.green,gray:A.label5}[st]);
  const recLabel=r=>{
    if(!r.next_due) return r.last_done?`Last: ${r.last_done}`:'No schedule';
    const d=daysUntil(r.next_due);
    if(d<0) return `Overdue by ${Math.abs(d)}d`;
    if(d===0) return 'Due today';
    return `Due in ${d}d`;
  };

  const openNewPet=()=>{setEditPet(null);setPForm(blankP);setPDrawer(true);};
  const openEditPet=p=>{setEditPet(p);setPForm({name:p.name,species:p.species||'',breed:p.breed||'',birthday:p.birthday||'',vet_name:p.vet_name||'',vet_phone:p.vet_phone||'',color:p.color||'#FF9500',notes:p.notes||''});setPDrawer(true);};

  const savePet=async()=>{
    if(!pForm.name.trim()){toastAdd('Name required','red');return;}
    if(editPet){
      const r=await api.put(`/api/pets/${editPet.id}`,pForm).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setPets(p=>p.map(v=>v.id===r.id?{...r,records:v.records||[]}:v));
    }else{
      const r=await api.post('/api/pets',pForm).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setPets(p=>[...p,{...r,records:[]}].sort((a,b)=>a.name.localeCompare(b.name)));
    }
    setPDrawer(false);setEditPet(null);
    toastAdd(editPet?'Pet updated':'Pet added');
  };

  const delPet=async id=>{
    try{await api.del(`/api/pets/${id}`);}catch{toastAdd('Failed to remove','red');return;}
    setPets(p=>p.filter(v=>v.id!==id));
    setPDrawer(false);setEditPet(null);
    toastAdd('Pet removed','blue');
  };

  const openNewRec=pid=>{setRPetId(pid);setEditRec(null);setRForm(blankR);setRDrawer(true);};
  const openEditRec=(pid,r)=>{setRPetId(pid);setEditRec(r);setRForm({type:r.type,name:r.name,last_done:r.last_done||'',interval_days:r.interval_days||'',next_due:r.next_due||'',notes:r.notes||''});setRDrawer(true);};

  const saveRec=async()=>{
    if(!rForm.name.trim()){toastAdd('Name required','red');return;}
    const payload={type:rForm.type,name:rForm.name.trim(),last_done:rForm.last_done,interval_days:parseInt(rForm.interval_days)||0,next_due:rForm.next_due,notes:rForm.notes};
    if(editRec){
      const r=await api.put(`/api/pets/${rPetId}/records/${editRec.id}`,payload).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setPets(p=>p.map(v=>v.id===rPetId?{...v,records:(v.records||[]).map(x=>x.id===r.id?r:x)}:v));
    }else{
      const r=await api.post(`/api/pets/${rPetId}/records`,payload).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setPets(p=>p.map(v=>v.id===rPetId?{...v,records:[...(v.records||[]),r]}:v));
    }
    setRDrawer(false);setEditRec(null);
    toastAdd(editRec?'Record updated':'Record added');
  };

  const delRec=async(pid,rid)=>{
    try{await api.del(`/api/pets/${pid}/records/${rid}`);}catch{toastAdd('Failed to remove','red');return;}
    setPets(p=>p.map(v=>v.id===pid?{...v,records:(v.records||[]).filter(x=>x.id!==rid)}:v));
    setRDrawer(false);setEditRec(null);
    toastAdd('Record removed','blue');
  };

  const markDone=async(pid,r)=>{
    const updated=await api.post(`/api/pets/${pid}/records/${r.id}/done`,{}).catch(()=>null);
    if(!updated?.id){toastAdd('Failed','red');return;}
    setPets(p=>p.map(v=>v.id===pid?{...v,records:(v.records||[]).map(x=>x.id===updated.id?updated:x)}:v));
    toastAdd('Logged');
  };

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Pets</h1>
        <Btn onClick={openNewPet}>+ Add</Btn>
      </div>
      {(pets||[]).length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No pets</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Add a pet to track vaccines, medications, vet visits, and grooming schedules.</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:20}}>
          {(pets||[]).map(pet=>(
            <div key={pet.id}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:10,height:10,borderRadius:'50%',background:pet.color||'#FF9500',flexShrink:0}}/>
                  <div>
                    <span style={{fontSize:13,fontWeight:700,color:A.label2,letterSpacing:'-.01em'}}>
                      {pet.name}{pet.species?` · ${pet.species}`:''}
                      {pet.breed?` · ${pet.breed}`:''}
                    </span>
                    {pet.vet_name&&<div style={{fontSize:11,color:A.label4,marginTop:1}}>Vet: {pet.vet_name}{pet.vet_phone?` · ${pet.vet_phone}`:''}</div>}
                  </div>
                </div>
                <button onClick={()=>openEditPet(pet)} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:13,padding:'0 4px'}}>Edit</button>
              </div>
              <Card style={{overflow:'hidden',padding:0}}>
                {(pet.records||[]).length===0&&(
                  <div style={{padding:'16px 18px',fontSize:14,color:A.label4}}>No records tracked yet.</div>
                )}
                {(pet.records||[]).map((r,i)=>{
                  const st=recStatus(r);
                  return(
                    <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 18px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                      <div style={{width:8,height:8,borderRadius:'50%',background:recColor(st),flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:15,fontWeight:600,color:A.label1}}>{r.name}</div>
                        <div style={{fontSize:12,color:st==='red'?A.red:A.label5,marginTop:2}}>
                          {recLabel(r)}{r.interval_days>0?` · every ${r.interval_days}d`:''}
                        </div>
                      </div>
                      {r.interval_days>0&&<button onClick={()=>markDone(pet.id,r)} style={{background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:20,padding:'5px 14px',fontSize:12,fontWeight:600,color:A.label3,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>Done</button>}
                      <button onClick={()=>openEditRec(pet.id,r)} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:13,padding:'0 4px',flexShrink:0}}>Edit</button>
                    </div>
                  );
                })}
                <div style={{padding:'12px 18px',borderTop:(pet.records||[]).length>0?`1px solid ${A.sep}`:'none'}}>
                  <button onClick={()=>openNewRec(pet.id)} style={{background:'none',border:'none',color:A.blue,fontSize:14,fontWeight:600,cursor:'pointer',padding:0}}>+ Add record</button>
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      <Drawer open={pDrawer} onClose={()=>{setPDrawer(false);setEditPet(null);setPForm(blankP);}} title={editPet?'Edit Pet':'New Pet'}>
        <FormGroup label="Name"><div style={{padding:'12px 16px'}}><Inp value={pForm.name} onChange={e=>setPForm(f=>({...f,name:e.target.value}))} placeholder="Buddy"/></div></FormGroup>
        <FormGroup label="Species">
          <div style={{padding:'12px 16px'}}>
            <select value={pForm.species} onChange={e=>setPForm(f=>({...f,species:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              <option value="">Select species…</option>
              {SPECIES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </FormGroup>
        <FormGroup label="Breed (optional)"><div style={{padding:'12px 16px'}}><Inp value={pForm.breed} onChange={e=>setPForm(f=>({...f,breed:e.target.value}))} placeholder="Golden Retriever"/></div></FormGroup>
        <FormGroup label="Birthday (optional)"><div style={{padding:'12px 16px'}}><Inp type="date" value={pForm.birthday} onChange={e=>setPForm(f=>({...f,birthday:e.target.value}))}/></div></FormGroup>
        <FormGroup label="Vet name (optional)"><div style={{padding:'12px 16px'}}><Inp value={pForm.vet_name} onChange={e=>setPForm(f=>({...f,vet_name:e.target.value}))} placeholder="Dr. Johnson"/></div></FormGroup>
        <FormGroup label="Vet phone (optional)"><div style={{padding:'12px 16px'}}><Inp type="tel" value={pForm.vet_phone} onChange={e=>setPForm(f=>({...f,vet_phone:e.target.value}))} placeholder="(404) 555-0100"/></div></FormGroup>
        <FormGroup label="Color">
          <div style={{padding:'12px 16px',display:'flex',gap:8,flexWrap:'wrap'}}>
            {PET_COLORS.map(c=>(
              <button key={c} onClick={()=>setPForm(f=>({...f,color:c}))} style={{width:28,height:28,borderRadius:'50%',background:c,border:pForm.color===c?`3px solid ${A.label1}`:`2px solid transparent`,cursor:'pointer'}}/>
            ))}
          </div>
        </FormGroup>
        <FormGroup label="Notes (optional)"><div style={{padding:'12px 16px'}}><Inp value={pForm.notes} onChange={e=>setPForm(f=>({...f,notes:e.target.value}))}/></div></FormGroup>
        <div style={{padding:'12px 16px',display:'flex',gap:8}}>
          <Btn onClick={savePet} full>Save</Btn>
          {editPet&&<Btn variant="ghost" onClick={()=>delPet(editPet.id)} full>Delete</Btn>}
        </div>
      </Drawer>

      <Drawer open={rDrawer} onClose={()=>{setRDrawer(false);setEditRec(null);setRForm(blankR);}} title={editRec?'Edit Record':'New Record'}>
        <FormGroup label="Type">
          <div style={{padding:'12px 16px'}}>
            <select value={rForm.type} onChange={e=>setRForm(f=>({...f,type:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              {REC_TYPES.map(t=><option key={t} value={t}>{t.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}
            </select>
          </div>
        </FormGroup>
        <FormGroup label="Name"><div style={{padding:'12px 16px'}}><Inp value={rForm.name} onChange={e=>setRForm(f=>({...f,name:e.target.value}))} placeholder="Rabies vaccine, Heartworm…"/></div></FormGroup>
        <FormGroup label="Last done (optional)"><div style={{padding:'12px 16px'}}><Inp type="date" value={rForm.last_done} onChange={e=>setRForm(f=>({...f,last_done:e.target.value}))}/></div></FormGroup>
        <FormGroup label="Repeat interval in days (0 = one-time)"><div style={{padding:'12px 16px'}}><Inp type="number" min="0" value={rForm.interval_days} onChange={e=>setRForm(f=>({...f,interval_days:e.target.value}))} placeholder="365"/></div></FormGroup>
        {(!rForm.interval_days||parseInt(rForm.interval_days)===0)&&(
          <FormGroup label="Next due date (optional)"><div style={{padding:'12px 16px'}}><Inp type="date" value={rForm.next_due} onChange={e=>setRForm(f=>({...f,next_due:e.target.value}))}/></div></FormGroup>
        )}
        <FormGroup label="Notes (optional)"><div style={{padding:'12px 16px'}}><Inp value={rForm.notes} onChange={e=>setRForm(f=>({...f,notes:e.target.value}))}/></div></FormGroup>
        <div style={{padding:'12px 16px',display:'flex',gap:8}}>
          <Btn onClick={saveRec} full>Save</Btn>
          {editRec&&<Btn variant="ghost" onClick={()=>delRec(rPetId,editRec.id)} full>Delete</Btn>}
        </div>
      </Drawer>
    </div>
  );
}

function HomeScreen({appliances,setAppliances,consumables,setConsumables,maintenanceItems=[],setMaintenanceItems,toastAdd}){
  const isMobile=useIsMobile();
  const [tab,setTab]=useState('appliances');
  const MONTH_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const REPAIR_CATS=['Plumbing','Electrical','HVAC','Appliance','Structural','Exterior','Interior','Other'];
  const [maintDrawer,setMaintDrawer]=useState(false);
  const [maintEdit,setMaintEdit]=useState(null);
  const [maintForm,setMaintForm]=useState({name:'',month:'1',notes:''});
  const maintSort=(a,b)=>{const o={overdue:0,due_this_month:1,upcoming:2,done_this_year:3};return(o[a.status]??4)-(o[b.status]??4)||a.month-b.month;};

  // ── Repairs ─────────────────────────────────────────────────────────────────
  const [repairs,setRepairs]=useState([]);
  const [repairsLoaded,setRepairsLoaded]=useState(false);
  const [rDrawer,setRDrawer]=useState(false);
  const [editRepair,setEditRepair]=useState(null);
  const [expandedRepair,setExpandedRepair]=useState(null);
  const blankR={title:'',category:'Other',date:'',cost:'',contractor:'',warranty_until:'',description:''};
  const [rForm,setRForm]=useState(blankR);
  useEffect(()=>{
    if(tab!=='repairs'||repairsLoaded) return;
    api.get('/api/home/repairs').then(d=>{if(Array.isArray(d)) setRepairs(d);setRepairsLoaded(true);}).catch(()=>setRepairsLoaded(true));
  },[tab,repairsLoaded]);
  const openNewRepair=()=>{setEditRepair(null);setRForm({...blankR,date:new Date().toISOString().slice(0,10)});setRDrawer(true);};
  const openEditRepair=r=>{setEditRepair(r);setRForm({title:r.title,category:r.category||'Other',date:r.date||'',cost:r.cost?String(r.cost):'',contractor:r.contractor||'',warranty_until:r.warranty_until||'',description:r.description||''});setRDrawer(true);};
  const saveRepair=async()=>{
    if(!rForm.title.trim()){toastAdd('Title required','red');return;}
    const body={title:rForm.title.trim(),category:rForm.category,date:rForm.date,cost:Number(rForm.cost)||0,contractor:rForm.contractor,warranty_until:rForm.warranty_until,description:rForm.description};
    if(editRepair){
      const r=await api.put(`/api/home/repairs/${editRepair.id}`,body).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setRepairs(p=>p.map(x=>x.id===r.id?r:x).sort((a,b)=>(b.date||'').localeCompare(a.date||'')));
    }else{
      const r=await api.post('/api/home/repairs',body).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setRepairs(p=>[r,...p].sort((a,b)=>(b.date||'').localeCompare(a.date||'')));
    }
    setRDrawer(false);setEditRepair(null);
    toastAdd(editRepair?'Repair updated':'Repair added');
  };
  const delRepair=async id=>{
    try{
      await api.del(`/api/home/repairs/${id}`);
      setRepairs(p=>p.filter(r=>r.id!==id));
      setRDrawer(false);setEditRepair(null);
      toastAdd('Removed','blue');
    }catch{toastAdd('Failed to remove','red');}
  };
  const totalAll=repairs.reduce((s,r)=>s+(Number(r.cost)||0),0);
  const yr=new Date().getFullYear();
  const totalYear=repairs.filter(r=>(r.date||'').startsWith(String(yr))).reduce((s,r)=>s+(Number(r.cost)||0),0);
  const fmtMoney=n=>`$${(Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2})}`;

  // ── Appliances ──────────────────────────────────────────────────────────────
  const blankA={name:'',location:'',purchase_date:'',warranty_date:'',notes:''};
  const [aDrawer,setADrawer]=useState(false);
  const [editAppl,setEditAppl]=useState(null);
  const [aForm,setAForm]=useState(blankA);

  const openNewAppl=()=>{setEditAppl(null);setAForm(blankA);setADrawer(true);};
  const openEditAppl=a=>{setEditAppl(a);setAForm({name:a.name,location:a.location||'',purchase_date:a.purchase_date||'',warranty_date:a.warranty_date||'',notes:a.notes||''});setADrawer(true);};

  const saveAppl=async()=>{
    if(!aForm.name.trim()){toastAdd('Name required','red');return;}
    if(editAppl){
      const r=await api.put(`/api/home/appliances/${editAppl.id}`,aForm).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setAppliances(p=>p.map(a=>a.id===r.id?r:a).sort(applSort));
    }else{
      const r=await api.post('/api/home/appliances',aForm).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setAppliances(p=>[...p,r].sort(applSort));
    }
    setADrawer(false);setEditAppl(null);
    toastAdd(editAppl?'Appliance updated':'Appliance added');
  };

  const delAppl=async id=>{
    try{
      await api.del(`/api/home/appliances/${id}`);
      setAppliances(p=>p.filter(a=>a.id!==id));
      setADrawer(false);setEditAppl(null);
      toastAdd('Removed','blue');
    }catch{toastAdd('Failed to remove','red');}
  };

  const applSort=(a,b)=>{
    const aw=a.warranty_date, bw=b.warranty_date;
    if(!aw&&!bw) return a.name.localeCompare(b.name);
    if(!aw) return 1;
    if(!bw) return -1;
    return aw.localeCompare(bw);
  };

  const warrantyBadge=a=>{
    if(!a.warranty_date) return null;
    const d=daysUntil(a.warranty_date);
    if(d<0) return{label:'Expired',color:A.red,bg:A.redFill};
    if(d<=30) return{label:`${d}d left`,color:A.amber,bg:A.amberFill};
    return null;
  };

  // ── Consumables ─────────────────────────────────────────────────────────────
  const SUGGESTIONS=[
    {name:'Furnace / AC filter',interval_days:90},
    {name:'Water filter',interval_days:180},
    {name:'Refrigerator water filter',interval_days:180},
    {name:'Smoke detector battery',interval_days:365},
    {name:'Dryer vent cleaning',interval_days:365},
    {name:'HVAC service',interval_days:365},
  ];
  const blankC={name:'',location:'',intervalVal:'90',intervalUnit:'days',last_replaced:'',notes:''};
  const [cDrawer,setCDrawer]=useState(false);
  const [editCons,setEditCons]=useState(null);
  const [cForm,setCForm]=useState(blankC);
  const [replacing,setReplacing]=useState(new Set());

  const intervalDays=f=>{
    const n=parseInt(f.intervalVal)||1;
    return f.intervalUnit==='weeks'?n*7:f.intervalUnit==='months'?n*30:n;
  };
  const intervalFromDays=days=>{
    if(days%30===0&&days>=30) return{intervalVal:String(days/30),intervalUnit:'months'};
    if(days%7===0&&days>=7) return{intervalVal:String(days/7),intervalUnit:'weeks'};
    return{intervalVal:String(days),intervalUnit:'days'};
  };

  const openNewCons=(preset=null)=>{
    setEditCons(null);
    if(preset){
      const {intervalVal,intervalUnit}=intervalFromDays(preset.interval_days);
      setCForm({...blankC,name:preset.name,intervalVal,intervalUnit});
    }else{
      setCForm(blankC);
    }
    setCDrawer(true);
  };
  const openEditCons=c=>{
    setEditCons(c);
    const {intervalVal,intervalUnit}=intervalFromDays(c.interval_days);
    setCForm({name:c.name,location:c.location||'',intervalVal,intervalUnit,last_replaced:c.last_replaced||'',notes:c.notes||''});
    setCDrawer(true);
  };

  const saveCons=async()=>{
    if(!cForm.name.trim()){toastAdd('Name required','red');return;}
    const days=intervalDays(cForm);
    if(days<1){toastAdd('Interval must be at least 1 day','red');return;}
    const body={name:cForm.name.trim(),location:cForm.location,interval_days:days,last_replaced:cForm.last_replaced,notes:cForm.notes};
    if(editCons){
      const r=await api.put(`/api/home/consumables/${editCons.id}`,body).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setConsumables(p=>p.map(c=>c.id===r.id?r:c).sort(consSort));
    }else{
      const r=await api.post('/api/home/consumables',body).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setConsumables(p=>[...p,r].sort(consSort));
    }
    setCDrawer(false);setEditCons(null);
    toastAdd(editCons?'Item updated':'Item added');
  };

  const delCons=async id=>{
    try{
      const r=await api.del(`/api/home/consumables/${id}`);
      if(r?.error){toastAdd('Failed to remove','red');return;}
      setConsumables(p=>p.filter(c=>c.id!==id));
      setCDrawer(false);setEditCons(null);
      toastAdd('Removed','blue');
    }catch{toastAdd('Failed to remove','red');}
  };

  const markReplaced=async c=>{
    setReplacing(s=>{const n=new Set(s);n.add(c.id);return n;});
    try{
      const r=await api.post(`/api/home/consumables/${c.id}/replaced`,{});
      if(r?.id) setConsumables(p=>p.map(x=>x.id===r.id?r:x).sort(consSort));
      else toastAdd('Failed to update','red');
    }catch{toastAdd('Failed to update','red');}
    setReplacing(s=>{const n=new Set(s);n.delete(c.id);return n;});
  };

  const consSort=(a,b)=>{
    if(a.days_remaining===null&&b.days_remaining===null) return 0;
    if(a.days_remaining===null) return 1;
    if(b.days_remaining===null) return -1;
    return a.days_remaining-b.days_remaining;
  };

  const statusDot=c=>{
    if(c.status==='overdue') return A.red;
    if(c.status==='due_soon') return A.amber;
    return A.green;
  };
  const dueLabel=c=>{
    if(c.days_remaining===null) return 'No date set';
    if(c.days_remaining<0) return `Overdue by ${Math.abs(c.days_remaining)} day${Math.abs(c.days_remaining)===1?'':'s'}`;
    if(c.days_remaining===0) return 'Due today';
    return `Due in ${c.days_remaining} day${c.days_remaining===1?'':'s'}`;
  };

  const SegCtrl=({value,onChange,options})=>(
    <div style={{display:'flex',background:A.inputBg,borderRadius:A.rXs,padding:2,gap:1}}>
      {options.map(o=>(
        <button key={o} onClick={()=>onChange(o)} style={{padding:'6px 16px',border:'none',borderRadius:7,background:value===o?A.cardBg:'transparent',color:value===o?A.label1:A.label3,fontSize:13,fontWeight:value===o?600:400,cursor:'pointer',boxShadow:value===o?A.shadowSm:'none',transition:'all .15s'}}>{o}</button>
      ))}
    </div>
  );

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Home</h1>
        <SegCtrl value={tab} onChange={setTab} options={['appliances','consumables','maintenance','repairs']}/>
      </div>

      {tab==='appliances'&&(
        <>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
            <Btn onClick={openNewAppl}>+ Add Appliance</Btn>
          </div>
          {appliances.length===0?(
            <Card style={{padding:'52px 24px',textAlign:'center'}}>
              <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No appliances yet</div>
              <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Track appliances and their warranty dates so nothing expires unnoticed.</div>
            </Card>
          ):(
            <Card style={{overflow:'hidden',padding:0}}>
              {appliances.map((a,i)=>{
                const badge=warrantyBadge(a);
                return(
                  <div key={a.id} style={{display:'flex',alignItems:'center',gap:14,padding:'16px 18px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <span style={{fontSize:15,fontWeight:600,color:A.label1}}>{a.name}</span>
                        {badge&&<span style={{fontSize:11,fontWeight:700,color:badge.color,background:badge.bg,padding:'2px 8px',borderRadius:A.rPill}}>{badge.label}</span>}
                      </div>
                      <div style={{fontSize:12,color:A.label4,marginTop:3}}>
                        {a.location&&<span>{a.location}</span>}
                        {a.location&&a.warranty_date&&<span> · </span>}
                        {a.warranty_date&&<span>Warranty: {a.warranty_date}</span>}
                        {!a.location&&!a.warranty_date&&<span style={{fontStyle:'italic'}}>No details</span>}
                      </div>
                    </div>
                    <button onClick={()=>openEditAppl(a)} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:13,padding:'0 4px',flexShrink:0}}>Edit</button>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}
      {/* drawers are outside tab conditionals so switching tabs doesn't unmount open forms */}
      <Drawer open={aDrawer} onClose={()=>{setADrawer(false);setEditAppl(null);}} title={editAppl?'Edit Appliance':'Add Appliance'}>
        <FormGroup label="Name"><div style={{padding:'12px 16px'}}><Inp value={aForm.name} onChange={e=>setAForm(f=>({...f,name:e.target.value}))} placeholder="Refrigerator"/></div></FormGroup>
        <FormGroup label="Room / Location"><div style={{padding:'12px 16px'}}><Inp value={aForm.location} onChange={e=>setAForm(f=>({...f,location:e.target.value}))} placeholder="Kitchen"/></div></FormGroup>
        <FormGroup label="Purchase date (optional)"><div style={{padding:'12px 16px'}}><Inp type="date" value={aForm.purchase_date} onChange={e=>setAForm(f=>({...f,purchase_date:e.target.value}))}/></div></FormGroup>
        <FormGroup label="Warranty expires (optional)"><div style={{padding:'12px 16px'}}><Inp type="date" value={aForm.warranty_date} onChange={e=>setAForm(f=>({...f,warranty_date:e.target.value}))}/></div></FormGroup>
        <FormGroup label="Notes (optional)"><div style={{padding:'12px 16px'}}><Inp value={aForm.notes} onChange={e=>setAForm(f=>({...f,notes:e.target.value}))} placeholder="Model number, serial, etc."/></div></FormGroup>
        <div style={{display:'flex',gap:8,marginTop:4}}>
          <Btn onClick={saveAppl} full>{editAppl?'Save Changes':'Add Appliance'}</Btn>
          {editAppl&&<Btn variant="ghost" onClick={()=>delAppl(editAppl.id)} full style={{color:A.red}}>Delete</Btn>}
        </div>
        {!editAppl&&<Btn variant="ghost" onClick={()=>setADrawer(false)} full style={{marginTop:8}}>Cancel</Btn>}
      </Drawer>

      {tab==='consumables'&&(
        <>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
            <Btn onClick={()=>openNewCons()}>+ Add Item</Btn>
          </div>
          {consumables.length===0&&(
            <>
              <Card style={{padding:'36px 24px',textAlign:'center',marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No items yet</div>
                <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Track filters, batteries, and anything that needs regular replacement.</div>
              </Card>
              <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Quick-add suggestions</div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {SUGGESTIONS.map(s=>(
                  <button key={s.name} onClick={()=>openNewCons(s)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:A.cardBg,border:`1px solid ${A.sep}`,borderRadius:A.rSm,cursor:'pointer',textAlign:'left'}}>
                    <span style={{fontSize:14,color:A.label1,fontWeight:500}}>{s.name}</span>
                    <span style={{fontSize:12,color:A.label4}}>every {s.interval_days >= 365 ? `${s.interval_days/365}yr` : s.interval_days >= 30 ? `${s.interval_days/30}mo` : `${s.interval_days}d`}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {consumables.length>0&&(
            <>
              <Card style={{overflow:'hidden',padding:0,marginBottom:16}}>
                {consumables.map((c,i)=>(
                  <div key={c.id} style={{display:'flex',alignItems:'center',gap:14,padding:'16px 18px',borderTop:i>0?`1px solid ${A.sep}`:'none',opacity:replacing.has(c.id)?0.5:1,transition:'opacity .2s'}}>
                    <div style={{width:10,height:10,borderRadius:'50%',background:statusDot(c),flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:15,fontWeight:600,color:A.label1}}>{c.name}</div>
                      <div style={{fontSize:12,color:c.status==='overdue'?A.red:c.status==='due_soon'?A.amber:A.label4,marginTop:2}}>
                        {dueLabel(c)}{c.location&&` · ${c.location}`}
                      </div>
                    </div>
                    <button onClick={()=>markReplaced(c)} disabled={replacing.has(c.id)} style={{background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:20,padding:'5px 14px',fontSize:12,fontWeight:600,color:A.label3,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>
                      {replacing.has(c.id)?'…':'Replaced'}
                    </button>
                    <button onClick={()=>openEditCons(c)} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:13,padding:'0 4px',flexShrink:0}}>Edit</button>
                  </div>
                ))}
              </Card>
              {consumables.length>0&&SUGGESTIONS.filter(s=>!consumables.some(c=>c.name.toLowerCase().includes(s.name.split('/')[0].toLowerCase().trim()))).length>0&&(
                <details style={{marginTop:16}}>
                  <summary style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',cursor:'pointer',marginBottom:8,listStyle:'none'}}>+ More suggestions</summary>
                  <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:8}}>
                    {SUGGESTIONS.filter(s=>!consumables.some(c=>c.name.toLowerCase().includes(s.name.split('/')[0].toLowerCase().trim()))).map(s=>(
                      <button key={s.name} onClick={()=>openNewCons(s)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:A.cardBg,border:`1px solid ${A.sep}`,borderRadius:A.rSm,cursor:'pointer',textAlign:'left'}}>
                        <span style={{fontSize:14,color:A.label1,fontWeight:500}}>{s.name}</span>
                        <span style={{fontSize:12,color:A.label4}}>every {s.interval_days>=365?`${s.interval_days/365}yr`:s.interval_days>=30?`${s.interval_days/30}mo`:`${s.interval_days}d`}</span>
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}
      <Drawer open={cDrawer} onClose={()=>{setCDrawer(false);setEditCons(null);}} title={editCons?'Edit Item':'Add Item'}>
        <FormGroup label="Name"><div style={{padding:'12px 16px'}}><Inp value={cForm.name} onChange={e=>setCForm(f=>({...f,name:e.target.value}))} placeholder="Furnace filter"/></div></FormGroup>
        <FormGroup label="Room / Location (optional)"><div style={{padding:'12px 16px'}}><Inp value={cForm.location} onChange={e=>setCForm(f=>({...f,location:e.target.value}))} placeholder="Basement"/></div></FormGroup>
        <FormGroup label="Replace every">
          <div style={{padding:'12px 16px',display:'flex',gap:8,alignItems:'center'}}>
            <Inp type="number" min="1" value={cForm.intervalVal} onChange={e=>setCForm(f=>({...f,intervalVal:e.target.value}))} style={{width:80}}/>
            <select value={cForm.intervalUnit} onChange={e=>setCForm(f=>({...f,intervalUnit:e.target.value}))} style={{flex:1,padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              <option value="days">days</option><option value="weeks">weeks</option><option value="months">months</option>
            </select>
          </div>
        </FormGroup>
        <FormGroup label="Last replaced (optional)"><div style={{padding:'12px 16px'}}><Inp type="date" value={cForm.last_replaced} onChange={e=>setCForm(f=>({...f,last_replaced:e.target.value}))}/></div></FormGroup>
        <FormGroup label="Notes (optional)"><div style={{padding:'12px 16px'}}><Inp value={cForm.notes} onChange={e=>setCForm(f=>({...f,notes:e.target.value}))} placeholder="Brand, size, etc."/></div></FormGroup>
        <div style={{display:'flex',gap:8,marginTop:4}}>
          <Btn onClick={saveCons} full>{editCons?'Save Changes':'Add Item'}</Btn>
          {editCons&&<Btn variant="ghost" onClick={()=>delCons(editCons.id)} full style={{color:A.red}}>Delete</Btn>}
        </div>
        {!editCons&&<Btn variant="ghost" onClick={()=>setCDrawer(false)} full style={{marginTop:8}}>Cancel</Btn>}
      </Drawer>

      {tab==='maintenance'&&(
        <>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
            <Btn onClick={()=>{setMaintEdit(null);setMaintForm({name:'',month:String(new Date().getMonth()+1),notes:''});setMaintDrawer(true);}}>+ Add Task</Btn>
          </div>
          {maintenanceItems.length===0?(
            <Card style={{padding:'52px 24px',textAlign:'center',marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No tasks yet</div>
              <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Add annual tasks like AC service, gutter cleaning, and smoke detector checks.</div>
            </Card>
          ):(
            <Card style={{overflow:'hidden',padding:0,marginBottom:16}}>
              {maintenanceItems.map((item,i)=>{
                const sc=item.status==='overdue'?{color:A.red,bg:A.redFill,label:'Overdue'}:item.status==='due_this_month'?{color:A.amber,bg:A.amberFill,label:'This month'}:item.status==='done_this_year'?{color:A.green,bg:A.greenFill,label:'Done'}:{color:A.label4,bg:'transparent',label:MONTH_NAMES[item.month-1]};
                return(
                  <div key={item.id} style={{display:'flex',alignItems:'center',gap:14,padding:'16px 18px',borderTop:i>0?`1px solid ${A.sep}`:'none',opacity:item.status==='done_this_year'?0.55:1}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <span style={{fontSize:15,fontWeight:600,color:A.label1}}>{item.name}</span>
                        <span style={{fontSize:11,fontWeight:700,color:sc.color,background:sc.bg,padding:'2px 8px',borderRadius:A.rPill}}>{sc.label}</span>
                      </div>
                      {item.notes&&<div style={{fontSize:12,color:A.label4,marginTop:3}}>{item.notes}</div>}
                    </div>
                    {item.status!=='done_this_year'&&(
                      <button onClick={async()=>{const r=await api.post(`/api/home/maintenance/${item.id}/done`,{}).catch(()=>null);if(r?.id)setMaintenanceItems(p=>p.map(x=>x.id===r.id?r:x).sort(maintSort));else toastAdd('Failed','red');}} style={{background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:20,padding:'5px 14px',fontSize:12,fontWeight:600,color:A.label3,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>Done</button>
                    )}
                    <button onClick={()=>{setMaintEdit(item);setMaintForm({name:item.name,month:String(item.month),notes:item.notes||''});setMaintDrawer(true);}} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:13,padding:'0 4px',flexShrink:0}}>Edit</button>
                  </div>
                );
              })}
            </Card>
          )}
          {maintenanceItems.length===0&&(
            <>
              <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Common tasks</div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {[{name:'AC / furnace service',month:5},{name:'Smoke & CO detector test',month:10},{name:'Water heater flush',month:3},{name:'Gutter cleaning',month:11},{name:'Dryer vent inspection',month:1},{name:'Chimney inspection',month:9}].map(s=>(
                  <button key={s.name} onClick={()=>{setMaintEdit(null);setMaintForm({name:s.name,month:String(s.month),notes:''});setMaintDrawer(true);}} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:A.cardBg,border:`1px solid ${A.sep}`,borderRadius:A.rSm,cursor:'pointer',textAlign:'left'}}>
                    <span style={{fontSize:14,color:A.label1,fontWeight:500}}>{s.name}</span>
                    <span style={{fontSize:12,color:A.label4}}>{MONTH_NAMES[s.month-1]}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      <Drawer open={maintDrawer} onClose={()=>{setMaintDrawer(false);setMaintEdit(null);}} title={maintEdit?'Edit Task':'Add Task'}>
        <FormGroup label="Task name"><div style={{padding:'12px 16px'}}><Inp value={maintForm.name} onChange={e=>setMaintForm(f=>({...f,name:e.target.value}))} placeholder="AC / furnace service"/></div></FormGroup>
        <FormGroup label="Month">
          <div style={{padding:'12px 16px'}}>
            <select value={maintForm.month} onChange={e=>setMaintForm(f=>({...f,month:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              {MONTH_NAMES.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
        </FormGroup>
        <FormGroup label="Notes (optional)"><div style={{padding:'12px 16px'}}><Inp value={maintForm.notes} onChange={e=>setMaintForm(f=>({...f,notes:e.target.value}))} placeholder="Service company, parts needed, etc."/></div></FormGroup>
        <div style={{display:'flex',gap:8,marginTop:4}}>
          <Btn onClick={async()=>{
            if(!maintForm.name.trim()){toastAdd('Name required','red');return;}
            const body={name:maintForm.name.trim(),month:parseInt(maintForm.month),notes:maintForm.notes};
            if(maintEdit){const r=await api.put(`/api/home/maintenance/${maintEdit.id}`,body).catch(()=>null);if(!r?.id){toastAdd('Failed to save','red');return;}setMaintenanceItems(p=>p.map(x=>x.id===r.id?r:x).sort(maintSort));}
            else{const r=await api.post('/api/home/maintenance',body).catch(()=>null);if(!r?.id){toastAdd('Failed to save','red');return;}setMaintenanceItems(p=>[...p,r].sort(maintSort));}
            setMaintDrawer(false);setMaintEdit(null);toastAdd(maintEdit?'Task updated':'Task added');
          }} full>{maintEdit?'Save Changes':'Add Task'}</Btn>
          {maintEdit&&<Btn variant="ghost" onClick={async()=>{try{await api.del(`/api/home/maintenance/${maintEdit.id}`);setMaintenanceItems(p=>p.filter(x=>x.id!==maintEdit.id));setMaintDrawer(false);setMaintEdit(null);toastAdd('Removed','blue');}catch{toastAdd('Failed to remove','red');}}} full style={{color:A.red}}>Delete</Btn>}
        </div>
        {!maintEdit&&<Btn variant="ghost" onClick={()=>setMaintDrawer(false)} full style={{marginTop:8}}>Cancel</Btn>}
      </Drawer>

      {tab==='repairs'&&(
        <>
          <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap'}}>
            <Card style={{padding:'14px 18px',flex:1,minWidth:160}}>
              <div style={{fontSize:11,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em'}}>This year</div>
              <div style={{fontSize:24,fontWeight:800,color:A.label1,marginTop:2,letterSpacing:'-.02em'}}>{fmtMoney(totalYear)}</div>
            </Card>
            <Card style={{padding:'14px 18px',flex:1,minWidth:160}}>
              <div style={{fontSize:11,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em'}}>All time</div>
              <div style={{fontSize:24,fontWeight:800,color:A.label1,marginTop:2,letterSpacing:'-.02em'}}>{fmtMoney(totalAll)}</div>
            </Card>
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
            <Btn onClick={openNewRepair}>+ Log Repair</Btn>
          </div>
          {!repairsLoaded?(
            <Card style={{padding:'40px 24px',textAlign:'center'}}>
              <div style={{fontSize:14,color:A.label4}}>Loading…</div>
            </Card>
          ):repairs.length===0?(
            <Card style={{padding:'52px 24px',textAlign:'center'}}>
              <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No repairs logged</div>
              <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Track repairs, costs, and contractors so you have a history for warranty claims and resale.</div>
            </Card>
          ):(
            <Card style={{overflow:'hidden',padding:0}}>
              {repairs.map((r,i)=>{
                const expanded=expandedRepair===r.id;
                return(
                  <div key={r.id} style={{borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                    <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px 18px',cursor:'pointer'}} onClick={()=>setExpandedRepair(expanded?null:r.id)}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                          <span style={{fontSize:15,fontWeight:600,color:A.label1}}>{r.title}</span>
                          <span style={{fontSize:11,fontWeight:700,color:A.label4,background:A.inputBg,padding:'2px 8px',borderRadius:A.rPill}}>{r.category||'Other'}</span>
                        </div>
                        <div style={{fontSize:12,color:A.label4,marginTop:3}}>{r.date||'No date'}</div>
                      </div>
                      <div style={{fontSize:15,fontWeight:600,color:A.label1,flexShrink:0}}>{r.cost>0?fmtMoney(r.cost):'—'}</div>
                      <button onClick={(e)=>{e.stopPropagation();openEditRepair(r);}} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:13,padding:'0 4px',flexShrink:0}}>Edit</button>
                    </div>
                    {expanded&&(
                      <div style={{padding:'0 18px 14px',display:'flex',flexDirection:'column',gap:4}}>
                        {r.description&&<div style={{fontSize:13,color:A.label3,whiteSpace:'pre-wrap'}}>{r.description}</div>}
                        {r.contractor&&<div style={{fontSize:12,color:A.label4}}>Contractor: {r.contractor}</div>}
                        {r.warranty_until&&<div style={{fontSize:12,color:A.label4}}>Warranty until: {r.warranty_until}</div>}
                        {!r.description&&!r.contractor&&!r.warranty_until&&<div style={{fontSize:12,color:A.label5,fontStyle:'italic'}}>No additional details</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}
      <Drawer open={rDrawer} onClose={()=>{setRDrawer(false);setEditRepair(null);}} title={editRepair?'Edit Repair':'Log Repair'}>
        <FormGroup label="Title"><div style={{padding:'12px 16px'}}><Inp value={rForm.title} onChange={e=>setRForm(f=>({...f,title:e.target.value}))} placeholder="Replaced water heater"/></div></FormGroup>
        <FormGroup label="Category">
          <div style={{padding:'12px 16px'}}>
            <select value={rForm.category} onChange={e=>setRForm(f=>({...f,category:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              {REPAIR_CATS.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </FormGroup>
        <FormGroup label="Date"><div style={{padding:'12px 16px'}}><Inp type="date" value={rForm.date} onChange={e=>setRForm(f=>({...f,date:e.target.value}))}/></div></FormGroup>
        <FormGroup label="Cost (USD)"><div style={{padding:'12px 16px'}}><Inp type="number" value={rForm.cost} onChange={e=>setRForm(f=>({...f,cost:e.target.value}))} placeholder="0"/></div></FormGroup>
        <FormGroup label="Contractor (optional)"><div style={{padding:'12px 16px'}}><Inp value={rForm.contractor} onChange={e=>setRForm(f=>({...f,contractor:e.target.value}))} placeholder="Smith Plumbing"/></div></FormGroup>
        <FormGroup label="Warranty until (optional)"><div style={{padding:'12px 16px'}}><Inp type="date" value={rForm.warranty_until} onChange={e=>setRForm(f=>({...f,warranty_until:e.target.value}))}/></div></FormGroup>
        <FormGroup label="Notes (optional)"><div style={{padding:'12px 16px'}}><Inp value={rForm.description} onChange={e=>setRForm(f=>({...f,description:e.target.value}))} placeholder="Brand, model, scope of work…"/></div></FormGroup>
        <div style={{display:'flex',gap:8,marginTop:4}}>
          <Btn onClick={saveRepair} full>{editRepair?'Save Changes':'Log Repair'}</Btn>
          {editRepair&&<Btn variant="ghost" onClick={()=>delRepair(editRepair.id)} full style={{color:A.red}}>Delete</Btn>}
        </div>
        {!editRepair&&<Btn variant="ghost" onClick={()=>setRDrawer(false)} full style={{marginTop:8}}>Cancel</Btn>}
      </Drawer>
    </div>
  );
}

function EmergencyScreen({toastAdd}){
  const isMobile=useIsMobile();
  const blank={gas_shutoff:'',water_shutoff:'',electric_shutoff:'',insurance_company:'',policy_number:'',insurance_phone:'',doctor_name:'',doctor_phone:'',medical_notes:'',extra_notes:''};
  const [info,setInfo]=useState(blank);
  const [form,setForm]=useState(blank);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    api.get('/api/emergency').then(d=>{const merged={...blank,...d};setInfo(merged);setForm(merged);}).catch(()=>{});
  },[]);
  const save=async()=>{
    setSaving(true);
    const r=await api.put('/api/emergency',form).catch(()=>null);
    setSaving(false);
    if(!r){toastAdd('Failed to save','red');return;}
    setInfo(form);
    toastAdd('Emergency info saved');
  };
  const textareaStyle={width:'100%',minHeight:80,padding:'9px 12px',background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:A.rXs,fontSize:15,color:A.label1,fontFamily:'inherit',resize:'vertical',outline:'none'};
  return(
    <div style={{maxWidth:780}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Emergency</h1>
      </div>
      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16,marginBottom:8}}>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Utilities</div>
          <FormGroup label="Gas shut-off location"><div style={{padding:'12px 16px'}}><Inp value={form.gas_shutoff} onChange={e=>setForm(f=>({...f,gas_shutoff:e.target.value}))} placeholder="Basement, behind furnace"/></div></FormGroup>
          <FormGroup label="Water shut-off location"><div style={{padding:'12px 16px'}}><Inp value={form.water_shutoff} onChange={e=>setForm(f=>({...f,water_shutoff:e.target.value}))} placeholder="Garage, north wall"/></div></FormGroup>
          <FormGroup label="Electric panel location"><div style={{padding:'12px 16px'}}><Inp value={form.electric_shutoff} onChange={e=>setForm(f=>({...f,electric_shutoff:e.target.value}))} placeholder="Mud room closet"/></div></FormGroup>
        </div>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Insurance</div>
          <FormGroup label="Company"><div style={{padding:'12px 16px'}}><Inp value={form.insurance_company} onChange={e=>setForm(f=>({...f,insurance_company:e.target.value}))} placeholder="State Farm"/></div></FormGroup>
          <FormGroup label="Policy #"><div style={{padding:'12px 16px'}}><Inp value={form.policy_number} onChange={e=>setForm(f=>({...f,policy_number:e.target.value}))}/></div></FormGroup>
          <FormGroup label="Phone"><div style={{padding:'12px 16px'}}><Inp type="tel" value={form.insurance_phone} onChange={e=>setForm(f=>({...f,insurance_phone:e.target.value}))} placeholder="(800) 555-0100"/></div></FormGroup>
        </div>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Medical</div>
          <FormGroup label="Primary doctor"><div style={{padding:'12px 16px'}}><Inp value={form.doctor_name} onChange={e=>setForm(f=>({...f,doctor_name:e.target.value}))}/></div></FormGroup>
          <FormGroup label="Doctor phone"><div style={{padding:'12px 16px'}}><Inp type="tel" value={form.doctor_phone} onChange={e=>setForm(f=>({...f,doctor_phone:e.target.value}))}/></div></FormGroup>
          <FormGroup label="Medical notes"><div style={{padding:'12px 16px'}}><textarea value={form.medical_notes} onChange={e=>setForm(f=>({...f,medical_notes:e.target.value}))} placeholder="Allergies, conditions, blood types" style={textareaStyle}/></div></FormGroup>
        </div>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Other</div>
          <FormGroup label="Extra notes"><div style={{padding:'12px 16px'}}><textarea value={form.extra_notes} onChange={e=>setForm(f=>({...f,extra_notes:e.target.value}))} placeholder="Spare key location, security codes, etc." style={textareaStyle}/></div></FormGroup>
        </div>
      </div>
      <div style={{marginTop:8}}>
        <Btn onClick={save}>{saving?'Saving…':'Save'}</Btn>
      </div>
    </div>
  );
}

function SubscriptionsScreen({subscriptions,setSubscriptions,toastAdd}){
  const isMobile=useIsMobile();
  const CATEGORIES=['Streaming','Software','Fitness','Food','Other'];
  const CYCLES=[['monthly','Monthly'],['annual','Annual'],['weekly','Weekly'],['quarterly','Quarterly']];
  const PALETTE=['#5856D6','#007AFF','#34C759','#FF9500','#FF3B30','#AF52DE','#32ADE6','#FF2D55'];
  const blank={name:'',amount:'',billing_cycle:'monthly',next_billing:'',trial_ends:'',category:'Other',color:'#5856D6',notes:''};
  const [drawer,setDrawer]=useState(false);
  const [editSub,setEditSub]=useState(null);
  const [form,setForm]=useState(blank);
  const monthlyEquiv=s=>{
    const a=Number(s.amount)||0;
    if(s.billing_cycle==='annual') return a/12;
    if(s.billing_cycle==='weekly') return a*52/12;
    if(s.billing_cycle==='quarterly') return a/3;
    return a;
  };
  const cycleLabel=c=>({monthly:'/mo',annual:'/yr',weekly:'/wk',quarterly:'/qtr'}[c]||'');
  const fmtMoney=n=>`$${(Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const active=(subscriptions||[]).filter(s=>s.active);
  const inactive=(subscriptions||[]).filter(s=>!s.active);
  const totalMonthly=active.reduce((s,x)=>s+monthlyEquiv(x),0);
  const totalAnnual=totalMonthly*12;
  const sorted=[...active].sort((a,b)=>monthlyEquiv(b)-monthlyEquiv(a));
  const overdueSubCount=(subscriptions||[]).filter(s=>s.active&&s.next_billing&&new Date(s.next_billing)<new Date()).length;
  const byCat=CATEGORIES.map(cat=>({cat,items:sorted.filter(s=>(s.category||'Other')===cat)})).filter(g=>g.items.length>0);
  const trialBadge=s=>{
    if(!s.trial_ends) return null;
    const d=daysUntil(s.trial_ends);
    if(d<0||d>7) return null;
    return d===0?'Trial ends today':`Trial ${d}d left`;
  };
  const openNew=()=>{setEditSub(null);setForm(blank);setDrawer(true);};
  const openEdit=s=>{setEditSub(s);setForm({name:s.name,amount:String(s.amount||''),billing_cycle:s.billing_cycle||'monthly',next_billing:s.next_billing||'',trial_ends:s.trial_ends||'',category:s.category||'Other',color:s.color||'#5856D6',notes:s.notes||''});setDrawer(true);};
  const save=async()=>{
    if(!form.name.trim()){toastAdd('Name required','red');return;}
    const body={...form,amount:Number(form.amount)||0};
    if(editSub){
      const r=await api.put(`/api/subscriptions/${editSub.id}`,body).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setSubscriptions(p=>p.map(s=>s.id===r.id?r:s));
    }else{
      const r=await api.post('/api/subscriptions',body).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setSubscriptions(p=>[...p,r]);
    }
    setDrawer(false);setEditSub(null);
    toastAdd(editSub?'Subscription updated':'Subscription added');
  };
  const del=async id=>{
    try{await api.del(`/api/subscriptions/${id}`);setSubscriptions(p=>p.filter(s=>s.id!==id));setDrawer(false);setEditSub(null);toastAdd('Removed','blue');}
    catch{toastAdd('Failed to remove','red');}
  };
  const toggleActive=async s=>{
    const r=await api.put(`/api/subscriptions/${s.id}`,{active:s.active?0:1}).catch(()=>null);
    if(!r?.id){toastAdd('Failed','red');return;}
    setSubscriptions(p=>p.map(x=>x.id===r.id?r:x));
  };
  const Row=({s})=>{
    const trial=trialBadge(s);
    const isOverdue=s.active&&s.next_billing&&new Date(s.next_billing)<new Date();
    return(
      <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px 18px'}}>
        <div style={{width:10,height:10,borderRadius:'50%',background:s.color||'#5856D6',flexShrink:0}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <span style={{fontSize:15,fontWeight:600,color:A.label1}}>{s.name}</span>
            {trial&&<span style={{fontSize:11,fontWeight:700,color:A.amber,background:A.amberFill,padding:'2px 8px',borderRadius:A.rPill}}>{trial}</span>}
            {isOverdue&&<span style={{fontSize:11,fontWeight:700,color:A.red,background:A.redFill,padding:'2px 8px',borderRadius:A.rPill}}>Review</span>}
          </div>
          <div style={{fontSize:12,color:A.label4,marginTop:2}}>
            {fmtMoney(s.amount)}{cycleLabel(s.billing_cycle)}{s.next_billing&&` · next ${s.next_billing}`}
          </div>
        </div>
        <button onClick={()=>toggleActive(s)} style={{background:s.active?A.greenFill:A.inputBg,color:s.active?A.green:A.label4,border:'none',borderRadius:A.rPill,padding:'5px 12px',fontSize:12,fontWeight:600,cursor:'pointer',flexShrink:0}}>{s.active?'Active':'Paused'}</button>
        <button onClick={()=>openEdit(s)} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:13,padding:'0 4px',flexShrink:0}}>Edit</button>
      </div>
    );
  };
  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Subscriptions</h1>
        <Btn onClick={openNew}>+ Add</Btn>
      </div>
      {overdueSubCount>0&&(
        <div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:13}}>
          {overdueSubCount} subscription{overdueSubCount>1?'s':''} may need review — billing date has passed.
        </div>
      )}
      <div style={{display:'flex',gap:12,marginBottom:20,flexWrap:'wrap'}}>
        <Card style={{padding:'14px 18px',flex:1,minWidth:160}}>
          <div style={{fontSize:11,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em'}}>Monthly</div>
          <div style={{fontSize:24,fontWeight:800,color:A.label1,marginTop:2,letterSpacing:'-.02em'}}>{fmtMoney(totalMonthly)}</div>
        </Card>
        <Card style={{padding:'14px 18px',flex:1,minWidth:160}}>
          <div style={{fontSize:11,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em'}}>Annual</div>
          <div style={{fontSize:24,fontWeight:800,color:A.label1,marginTop:2,letterSpacing:'-.02em'}}>{fmtMoney(totalAnnual)}</div>
        </Card>
      </div>
      {(subscriptions||[]).length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No subscriptions yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Track every recurring charge so it's easy to spot what to cancel.</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:20}}>
          {byCat.map(({cat,items})=>(
            <div key={cat}>
              <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{cat}</div>
              <Card style={{overflow:'hidden',padding:0}}>
                {items.map((s,i)=>(<div key={s.id} style={{borderTop:i>0?`1px solid ${A.sep}`:'none'}}><Row s={s}/></div>))}
              </Card>
            </div>
          ))}
          {inactive.length>0&&(
            <details>
              <summary style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',cursor:'pointer',marginBottom:8,listStyle:'none'}}>Paused ({inactive.length})</summary>
              <Card style={{overflow:'hidden',padding:0,opacity:.7}}>
                {inactive.map((s,i)=>(<div key={s.id} style={{borderTop:i>0?`1px solid ${A.sep}`:'none'}}><Row s={s}/></div>))}
              </Card>
            </details>
          )}
        </div>
      )}
      <Drawer open={drawer} onClose={()=>{setDrawer(false);setEditSub(null);}} title={editSub?'Edit Subscription':'Add Subscription'}>
        <FormGroup label="Name">
          <div style={{padding:'12px 16px'}}><Inp value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Netflix"/></div>
        </FormGroup>
        <FormGroup label="Amount">
          <div style={{padding:'12px 16px'}}><Inp type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="15.99"/></div>
        </FormGroup>
        <FormGroup label="Billing cycle">
          <div style={{padding:'12px 16px'}}>
            <select value={form.billing_cycle} onChange={e=>setForm(f=>({...f,billing_cycle:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              {CYCLES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </FormGroup>
        <FormGroup label="Next billing">
          <div style={{padding:'12px 16px'}}><Inp type="date" value={form.next_billing} onChange={e=>setForm(f=>({...f,next_billing:e.target.value}))}/></div>
        </FormGroup>
        <FormGroup label="Trial ends (optional)">
          <div style={{padding:'12px 16px'}}><Inp type="date" value={form.trial_ends} onChange={e=>setForm(f=>({...f,trial_ends:e.target.value}))}/></div>
        </FormGroup>
        <FormGroup label="Category">
          <div style={{padding:'12px 16px'}}>
            <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </FormGroup>
        <FormGroup label="Color">
          <div style={{padding:'12px 16px',display:'flex',flexWrap:'wrap',gap:8}}>
            {PALETTE.map(c=>(
              <button key={c} onClick={()=>setForm(f=>({...f,color:c}))} style={{width:30,height:30,borderRadius:'50%',border:`3px solid ${form.color===c?A.label1:'transparent'}`,background:c,cursor:'pointer'}}/>
            ))}
          </div>
        </FormGroup>
        <FormGroup label="Notes">
          <div style={{padding:'12px 16px'}}><Inp value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Account email, etc."/></div>
        </FormGroup>
        <div style={{display:'flex',gap:8,marginTop:4}}>
          <Btn onClick={save} full>{editSub?'Save Changes':'Add Subscription'}</Btn>
          {editSub&&<Btn variant="ghost" onClick={()=>del(editSub.id)} full style={{color:A.red}}>Delete</Btn>}
        </div>
        {!editSub&&<Btn variant="ghost" onClick={()=>setDrawer(false)} full style={{marginTop:8}}>Cancel</Btn>}
      </Drawer>
    </div>
  );
}

function ListsScreen({toastAdd}){
  const isMobile=useIsMobile();
  const EMOJIS=['📋','🛒','🏥','🔧','🎁','✈️','🏠','💊'];
  const [lists,setLists]=useState([]);
  const [activeList,setActiveList]=useState(null);
  const [items,setItems]=useState([]);
  const [itemsLoading,setItemsLoading]=useState(false);
  const [newListDrawer,setNewListDrawer]=useState(false);
  const blank={name:'',emoji:'📋'};
  const [form,setForm]=useState(blank);
  const [newItem,setNewItem]=useState('');
  const [editListDrawer,setEditListDrawer]=useState(false);
  const [editListTarget,setEditListTarget]=useState(null);
  const [editListForm,setEditListForm]=useState({name:'',emoji:'📋'});
  useEffect(()=>{
    api.get('/api/lists').then(d=>{if(Array.isArray(d)) setLists(d);}).catch(()=>{});
  },[]);
  useEffect(()=>{
    if(!activeList){setItems([]);return;}
    setItemsLoading(true);
    api.get(`/api/lists/${activeList.id}/items`).then(d=>{if(Array.isArray(d)) setItems(d);}).catch(()=>{}).finally(()=>setItemsLoading(false));
  },[activeList?.id]);
  const saveList=async()=>{
    if(!form.name.trim()){toastAdd('Name required','red');return;}
    const r=await api.post('/api/lists',form).catch(()=>null);
    if(!r?.id){toastAdd('Failed to save','red');return;}
    setLists(p=>[r,...p]);
    setNewListDrawer(false);setForm(blank);
    toastAdd('List created');
  };
  const delList=async id=>{
    try{await api.del(`/api/lists/${id}`);setLists(p=>p.filter(l=>l.id!==id));setActiveList(null);toastAdd('List removed','blue');}
    catch{toastAdd('Failed to remove','red');}
  };
  const saveListEdit=async()=>{
    if(!editListForm.name.trim()){toastAdd('Name required','red');return;}
    const r=await api.put(`/api/lists/${editListTarget.id}`,editListForm).catch(()=>null);
    if(!r?.id){toastAdd('Failed to save','red');return;}
    setLists(p=>p.map(l=>l.id===r.id?r:l));
    if(activeList?.id===r.id) setActiveList(r);
    setEditListDrawer(false);setEditListTarget(null);
    toastAdd('List updated');
  };
  const addItem=async()=>{
    if(!newItem.trim()||!activeList) return;
    const r=await api.post(`/api/lists/${activeList.id}/items`,{name:newItem.trim()}).catch(()=>null);
    if(!r?.id){toastAdd('Failed','red');return;}
    setItems(p=>[...p,r]);
    setNewItem('');
    setLists(p=>p.map(l=>l.id===activeList.id?{...l,item_count:(l.item_count||0)+1,unchecked_count:(l.unchecked_count||0)+1}:l));
  };
  const toggleItem=async it=>{
    const next=it.checked?0:1;
    setItems(p=>p.map(x=>x.id===it.id?{...x,checked:next}:x));
    setLists(p=>p.map(l=>l.id===activeList.id?{...l,unchecked_count:Math.max(0,(l.unchecked_count||0)+(next?-1:1))}:l));
    const r=await api.put(`/api/lists/${activeList.id}/items/${it.id}`,{checked:next}).catch(()=>null);
    if(!r?.id){
      setItems(p=>p.map(x=>x.id===it.id?{...x,checked:it.checked}:x));
      setLists(p=>p.map(l=>l.id===activeList.id?{...l,unchecked_count:Math.max(0,(l.unchecked_count||0)+(next?1:-1))}:l));
      toastAdd('Failed','red');
    }
  };
  const delItem=async id=>{
    try{
      await api.del(`/api/lists/${activeList.id}/items/${id}`);
      const removed=items.find(x=>x.id===id);
      setItems(p=>p.filter(x=>x.id!==id));
      setLists(p=>p.map(l=>l.id===activeList.id?{...l,item_count:Math.max(0,(l.item_count||0)-1),unchecked_count:Math.max(0,(l.unchecked_count||0)-(removed&&!removed.checked?1:0))}:l));
    }catch{toastAdd('Failed to remove','red');}
  };
  const clearChecked=async()=>{
    try{
      await api.del(`/api/lists/${activeList.id}/items/checked`);
      setItems(p=>p.filter(x=>!x.checked));
      const remaining=items.filter(x=>!x.checked).length;
      setLists(p=>p.map(l=>l.id===activeList.id?{...l,item_count:remaining,unchecked_count:remaining}:l));
      toastAdd('Cleared','blue');
    }catch{toastAdd('Failed','red');}
  };
  if(activeList){
    const sorted=[...items].sort((a,b)=>(a.checked?1:0)-(b.checked?1:0));
    const checkedCount=items.filter(x=>x.checked).length;
    return(
      <div>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:24}}>
          <button onClick={()=>setActiveList(null)} style={{background:A.inputBg,border:'none',borderRadius:A.rPill,padding:'7px 14px',fontSize:13,fontWeight:600,color:A.label2,cursor:'pointer'}}>← Lists</button>
          <h1 style={{fontSize:isMobile?28:34,fontWeight:800,letterSpacing:'-.04em',lineHeight:1.05,flex:1}}>{activeList.emoji} {activeList.name}</h1>
          <button onClick={()=>{setEditListTarget(activeList);setEditListForm({name:activeList.name,emoji:activeList.emoji||'📋'});setEditListDrawer(true);}} style={{background:'none',border:'none',color:A.label3,fontSize:13,cursor:'pointer',fontWeight:500}}>Rename</button>
          <button onClick={()=>delList(activeList.id)} style={{background:'none',border:'none',color:A.red,fontSize:13,cursor:'pointer',fontWeight:500}}>Delete</button>
        </div>
        {itemsLoading?(
          <Card style={{padding:'40px 24px',textAlign:'center'}}><div style={{fontSize:14,color:A.label4}}>Loading…</div></Card>
        ):items.length===0?(
          <Card style={{padding:'52px 24px',textAlign:'center',marginBottom:16}}>
            <div style={{fontSize:15,color:A.label3}}>No items yet. Add one below.</div>
          </Card>
        ):(
          <Card style={{overflow:'hidden',padding:0,marginBottom:16}}>
            {sorted.map((it,i)=>(
              <div key={it.id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                <button onClick={()=>toggleItem(it)} style={{width:22,height:22,borderRadius:'50%',border:`1.5px solid ${it.checked?A.green:A.sep}`,background:it.checked?A.green:'transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  {it.checked&&<svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 6.5l2 2 4-4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>
                <span style={{flex:1,fontSize:15,color:it.checked?A.label4:A.label1,textDecoration:it.checked?'line-through':'none'}}>{it.name}</span>
                <button onClick={()=>delItem(it.id)} style={{background:'none',border:'none',color:A.label4,fontSize:13,cursor:'pointer',padding:'0 4px',flexShrink:0}}>×</button>
              </div>
            ))}
          </Card>
        )}
        {checkedCount>0&&(
          <div style={{marginBottom:16}}>
            <Btn variant="ghost" onClick={clearChecked}>Clear {checkedCount} checked</Btn>
          </div>
        )}
        <div style={{display:'flex',gap:8}}>
          <Inp value={newItem} onChange={e=>setNewItem(e.target.value)} placeholder="Add item…" onKeyDown={e=>e.key==='Enter'&&addItem()}/>
          <Btn onClick={addItem} style={{flexShrink:0}}>Add</Btn>
        </div>
        <Drawer open={editListDrawer} onClose={()=>{setEditListDrawer(false);setEditListTarget(null);}} title="Edit List">
          <FormGroup label="Name">
            <div style={{padding:'12px 16px'}}><Inp value={editListForm.name} onChange={e=>setEditListForm(f=>({...f,name:e.target.value}))}/></div>
          </FormGroup>
          <FormGroup label="Emoji">
            <div style={{padding:'12px 16px',display:'flex',flexWrap:'wrap',gap:8}}>
              {EMOJIS.map(em=>(
                <button key={em} onClick={()=>setEditListForm(f=>({...f,emoji:em}))} style={{width:44,height:44,borderRadius:A.rSm,border:`2px solid ${editListForm.emoji===em?A.blue:A.sep}`,background:editListForm.emoji===em?A.blueFill:A.inputBg,fontSize:22,cursor:'pointer'}}>{em}</button>
              ))}
            </div>
          </FormGroup>
          <div style={{display:'flex',gap:8}}>
            <Btn onClick={saveListEdit} full>Save</Btn>
            {editListTarget&&<Btn variant="ghost" onClick={()=>{delList(editListTarget.id);setEditListDrawer(false);}} full style={{color:A.red}}>Delete List</Btn>}
          </div>
        </Drawer>
      </div>
    );
  }
  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Lists</h1>
        <Btn onClick={()=>{setForm(blank);setNewListDrawer(true);}}>+ New List</Btn>
      </div>
      {lists.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No lists yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Make a list for packing, party prep, or anything you want to share with the family.</div>
        </Card>
      ):(
        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(auto-fill,minmax(220px,1fr))',gap:12}}>
          {lists.map(l=>(
            <div key={l.id} style={{position:'relative'}}>
              <button onClick={()=>setActiveList(l)} style={{width:'100%',textAlign:'left',background:A.cardBg,border:`1px solid ${A.sep}`,borderRadius:A.r,padding:'18px 18px',cursor:'pointer',boxShadow:A.shadowSm,display:'flex',flexDirection:'column',gap:8}}>
                <div style={{fontSize:32}}>{l.emoji}</div>
                <div style={{fontSize:16,fontWeight:600,color:A.label1}}>{l.name}</div>
                <div style={{fontSize:12,color:A.label4}}>{l.item_count||0} {l.item_count===1?'item':'items'} · {l.unchecked_count||0} remaining</div>
              </button>
              <button onClick={e=>{e.stopPropagation();setEditListTarget(l);setEditListForm({name:l.name,emoji:l.emoji||'📋'});setEditListDrawer(true);}} style={{position:'absolute',top:8,right:8,background:'none',border:'none',color:A.label4,fontSize:13,cursor:'pointer',padding:'4px 6px',lineHeight:1}}>···</button>
            </div>
          ))}
        </div>
      )}
      <Drawer open={newListDrawer} onClose={()=>setNewListDrawer(false)} title="New List">
        <FormGroup label="Name">
          <div style={{padding:'12px 16px'}}><Inp value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Packing for Florida"/></div>
        </FormGroup>
        <FormGroup label="Emoji">
          <div style={{padding:'12px 16px',display:'flex',flexWrap:'wrap',gap:8}}>
            {EMOJIS.map(em=>(
              <button key={em} onClick={()=>setForm(f=>({...f,emoji:em}))} style={{width:44,height:44,borderRadius:A.rSm,border:`2px solid ${form.emoji===em?A.blue:A.sep}`,background:form.emoji===em?A.blueFill:A.inputBg,fontSize:22,cursor:'pointer'}}>{em}</button>
            ))}
          </div>
        </FormGroup>
        <Btn onClick={saveList} full>Create List</Btn>
      </Drawer>
      <Drawer open={editListDrawer} onClose={()=>{setEditListDrawer(false);setEditListTarget(null);}} title="Edit List">
        <FormGroup label="Name">
          <div style={{padding:'12px 16px'}}><Inp value={editListForm.name} onChange={e=>setEditListForm(f=>({...f,name:e.target.value}))}/></div>
        </FormGroup>
        <FormGroup label="Emoji">
          <div style={{padding:'12px 16px',display:'flex',flexWrap:'wrap',gap:8}}>
            {EMOJIS.map(em=>(
              <button key={em} onClick={()=>setEditListForm(f=>({...f,emoji:em}))} style={{width:44,height:44,borderRadius:A.rSm,border:`2px solid ${editListForm.emoji===em?A.blue:A.sep}`,background:editListForm.emoji===em?A.blueFill:A.inputBg,fontSize:22,cursor:'pointer'}}>{em}</button>
            ))}
          </div>
        </FormGroup>
        <div style={{display:'flex',gap:8}}>
          <Btn onClick={saveListEdit} full>Save</Btn>
          {editListTarget&&<Btn variant="ghost" onClick={()=>{delList(editListTarget.id);setEditListDrawer(false);}} full style={{color:A.red}}>Delete List</Btn>}
        </div>
      </Drawer>
    </div>
  );
}

function ProjectsScreen({projects,setProjects,toastAdd}){
  const isMobile=useIsMobile();
  const STATUSES=[['planned','Planned'],['in_progress','In Progress'],['done','Done']];
  const PRIORITIES=[['high','High'],['medium','Medium'],['low','Low']];
  const blank={title:'',description:'',status:'planned',priority:'medium',cost_estimate:'',cost_actual:'',due_date:''};
  const [drawer,setDrawer]=useState(false);
  const [editProj,setEditProj]=useState(null);
  const [form,setForm]=useState(blank);
  const [mobileTab,setMobileTab]=useState('planned');
  const [doneTarget,setDoneTarget]=useState(null);
  const [doneActual,setDoneActual]=useState('');
  const priColor=p=>({high:A.red,medium:A.amber,low:A.green}[p]||A.label4);
  const priFill=p=>({high:A.redFill,medium:A.amberFill,low:A.greenFill}[p]||A.inputBg);
  const fmtMoney=n=>`$${(Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2})}`;
  const openNew=()=>{setEditProj(null);setForm(blank);setDrawer(true);};
  const openEdit=p=>{setEditProj(p);setForm({title:p.title,description:p.description||'',status:p.status,priority:p.priority,cost_estimate:p.cost_estimate?String(p.cost_estimate):'',cost_actual:p.cost_actual?String(p.cost_actual):'',due_date:p.due_date||''});setDrawer(true);};
  const save=async()=>{
    if(!form.title.trim()){toastAdd('Title required','red');return;}
    const body={...form,cost_estimate:Number(form.cost_estimate)||0,cost_actual:Number(form.cost_actual)||0};
    if(editProj){
      const r=await api.put(`/api/projects/${editProj.id}`,body).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setProjects(p=>p.map(x=>x.id===r.id?r:x));
    }else{
      const r=await api.post('/api/projects',body).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setProjects(p=>[r,...p]);
    }
    setDrawer(false);setEditProj(null);
    toastAdd(editProj?'Project updated':'Project added');
  };
  const del=async id=>{
    try{await api.del(`/api/projects/${id}`);setProjects(p=>p.filter(x=>x.id!==id));setDrawer(false);setEditProj(null);toastAdd('Removed','blue');}
    catch{toastAdd('Failed to remove','red');}
  };
  const cycleStatus=async p=>{
    const order=['planned','in_progress','done'];
    const next=order[(order.indexOf(p.status)+1)%order.length];
    if(next==='done'){
      setDoneTarget(p);setDoneActual(p.cost_estimate?String(p.cost_estimate):'');
    }else{
      const r=await api.put(`/api/projects/${p.id}`,{status:next}).catch(()=>null);
      if(!r?.id){toastAdd('Failed','red');return;}
      setProjects(prev=>prev.map(x=>x.id===r.id?r:x));
    }
  };
  const confirmDone=async()=>{
    if(!doneTarget) return;
    const body={status:'done'};
    if(doneActual.trim()) body.cost_actual=Number(doneActual)||0;
    const r=await api.put(`/api/projects/${doneTarget.id}`,body).catch(()=>null);
    if(!r?.id){toastAdd('Failed','red');return;}
    setProjects(prev=>prev.map(x=>x.id===r.id?r:x));
    setDoneTarget(null);setDoneActual('');
    toastAdd('Project marked done');
  };
  const Card2=({p})=>{
    const displayCost=p.status==='done'?(p.cost_actual>0?p.cost_actual:p.cost_estimate):p.cost_estimate;
    return(
      <div style={{background:A.cardBg,border:`1px solid ${A.sep}`,borderRadius:A.rSm,padding:'14px 16px',boxShadow:A.shadowSm}}>
        <div style={{display:'flex',alignItems:'flex-start',gap:8,marginBottom:6}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:15,fontWeight:600,color:A.label1,lineHeight:1.3}}>{p.title}</div>
          </div>
          <span style={{fontSize:10,fontWeight:700,color:priColor(p.priority),background:priFill(p.priority),padding:'2px 7px',borderRadius:A.rPill,textTransform:'uppercase',letterSpacing:'.04em',flexShrink:0}}>{p.priority}</span>
        </div>
        <div style={{fontSize:12,color:A.label4,display:'flex',gap:8,flexWrap:'wrap'}}>
          {p.due_date&&<span>Due {p.due_date}</span>}
          {displayCost>0&&<span>{fmtMoney(displayCost)}{p.status==='done'&&p.cost_actual>0?'':p.cost_estimate>0?' est.':''}</span>}
        </div>
        <div style={{display:'flex',gap:6,marginTop:10}}>
          <button onClick={()=>cycleStatus(p)} style={{background:A.inputBg,border:'none',borderRadius:A.rPill,padding:'4px 12px',fontSize:12,fontWeight:600,color:A.label2,cursor:'pointer'}}>{p.status==='planned'?'Start':p.status==='in_progress'?'Mark done':'Reopen'}</button>
          <button onClick={()=>openEdit(p)} style={{background:'none',border:'none',color:A.label4,fontSize:12,cursor:'pointer',padding:'4px 6px'}}>Edit</button>
        </div>
      </div>
    );
  };
  const Column=({title,items})=>(
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>{title} ({items.length})</div>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {items.length===0?(
          <div style={{fontSize:13,color:A.label5,fontStyle:'italic',padding:'8px 4px'}}>None</div>
        ):items.map(p=><Card2 key={p.id} p={p}/>)}
      </div>
    </div>
  );
  const byStatus={planned:[],in_progress:[],done:[]};
  for(const p of (projects||[])) (byStatus[p.status]||byStatus.planned).push(p);
  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Projects</h1>
        <Btn onClick={openNew}>+ Add</Btn>
      </div>
      {(projects||[]).length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No projects yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Plan home improvements and other family projects. Track cost estimates vs actuals.</div>
        </Card>
      ):isMobile?(
        <>
          <div style={{display:'flex',gap:6,marginBottom:16}}>
            {STATUSES.map(([v,l])=>(
              <button key={v} onClick={()=>setMobileTab(v)} style={{flex:1,padding:'8px 4px',borderRadius:A.rXs,border:'none',background:mobileTab===v?A.label1:A.inputBg,color:mobileTab===v?A.cardBg:A.label3,fontSize:13,fontWeight:600,cursor:'pointer'}}>{l} ({byStatus[v].length})</button>
            ))}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {byStatus[mobileTab].length===0?(
              <div style={{fontSize:14,color:A.label4,textAlign:'center',padding:'24px 0'}}>None</div>
            ):byStatus[mobileTab].map(p=><Card2 key={p.id} p={p}/>)}
          </div>
        </>
      ):(
        <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
          <Column title="Planned" items={byStatus.planned}/>
          <Column title="In Progress" items={byStatus.in_progress}/>
          <Column title="Done" items={byStatus.done}/>
        </div>
      )}
      <Drawer open={drawer} onClose={()=>{setDrawer(false);setEditProj(null);}} title={editProj?'Edit Project':'Add Project'}>
        <FormGroup label="Title">
          <div style={{padding:'12px 16px'}}><Inp value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Renovate kitchen"/></div>
        </FormGroup>
        <FormGroup label="Description">
          <div style={{padding:'12px 16px'}}><textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Scope, contractors, etc." style={{width:'100%',minHeight:80,padding:'9px 12px',background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:A.rXs,fontSize:15,color:A.label1,fontFamily:'inherit',resize:'vertical',outline:'none'}}/></div>
        </FormGroup>
        <FormGroup label="Status">
          <div style={{padding:'12px 16px'}}>
            <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              {STATUSES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </FormGroup>
        <FormGroup label="Priority">
          <div style={{padding:'12px 16px'}}>
            <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              {PRIORITIES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </FormGroup>
        <FormGroup label="Due date">
          <div style={{padding:'12px 16px'}}><Inp type="date" value={form.due_date} onChange={e=>setForm(f=>({...f,due_date:e.target.value}))}/></div>
        </FormGroup>
        <FormGroup label="Cost estimate (USD)">
          <div style={{padding:'12px 16px'}}><Inp type="number" value={form.cost_estimate} onChange={e=>setForm(f=>({...f,cost_estimate:e.target.value}))} placeholder="0"/></div>
        </FormGroup>
        <FormGroup label="Cost actual (USD)">
          <div style={{padding:'12px 16px'}}><Inp type="number" value={form.cost_actual} onChange={e=>setForm(f=>({...f,cost_actual:e.target.value}))} placeholder="0"/></div>
        </FormGroup>
        <div style={{display:'flex',gap:8,marginTop:4}}>
          <Btn onClick={save} full>{editProj?'Save Changes':'Add Project'}</Btn>
          {editProj&&<Btn variant="ghost" onClick={()=>del(editProj.id)} full style={{color:A.red}}>Delete</Btn>}
        </div>
        {!editProj&&<Btn variant="ghost" onClick={()=>setDrawer(false)} full style={{marginTop:8}}>Cancel</Btn>}
      </Drawer>
      {doneTarget&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={()=>setDoneTarget(null)}>
          <div style={{background:A.cardBg,borderRadius:A.r,padding:24,width:'100%',maxWidth:320,boxShadow:A.shadowLg}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:17,fontWeight:700,color:A.label1,marginBottom:4}}>Mark as done</div>
            <div style={{fontSize:14,color:A.label3,marginBottom:16}}>{doneTarget.title}</div>
            <div style={{fontSize:12,fontWeight:600,color:A.label4,marginBottom:6}}>Actual cost (optional)</div>
            <Inp type="number" value={doneActual} onChange={e=>setDoneActual(e.target.value)} placeholder="0" style={{marginBottom:16}}/>
            <div style={{display:'flex',gap:8}}>
              <Btn onClick={confirmDone} full>Confirm</Btn>
              <Btn variant="ghost" onClick={()=>setDoneTarget(null)} full>Cancel</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PantryScreen({pantry,setPantry,grocery,setGrocery,toastAdd}){
  const isMobile=useIsMobile();
  const LOCATIONS=['Fridge','Freezer','Pantry','Cabinet','Other'];
  const CATEGORIES=['Produce','Dairy','Meat','Grains','Snacks','Drinks','Spices','Frozen','Other'];
  const blank={name:'',location:'Pantry',quantity:'1',unit:'',expires_on:'',low_stock_at:'0',category:'Other'};
  const [drawer,setDrawer]=useState(false);
  const [editItem,setEditItem]=useState(null);
  const [form,setForm]=useState(blank);
  const [useTarget,setUseTarget]=useState(null);
  const [useAmount,setUseAmount]=useState('1');
  const isLow=p=>p.low_stock_at>0&&Number(p.quantity)<=Number(p.low_stock_at);
  const expBadge=p=>{
    if(p.expiry_status==='expired') return{label:'Expired',color:A.red,bg:A.redFill};
    if(p.expiry_status==='expiring_soon') return{label:p.days_until_expiry===0?'Today':`${p.days_until_expiry}d`,color:A.amber,bg:A.amberFill};
    return null;
  };
  const openNew=()=>{setEditItem(null);setForm(blank);setDrawer(true);};
  const openEdit=p=>{setEditItem(p);setForm({name:p.name,location:p.location||'Pantry',quantity:String(p.quantity??1),unit:p.unit||'',expires_on:p.expires_on||'',low_stock_at:String(p.low_stock_at||0),category:p.category||'Other'});setDrawer(true);};
  const save=async()=>{
    if(!form.name.trim()){toastAdd('Name required','red');return;}
    const body={...form,quantity:Number(form.quantity)||0,low_stock_at:Number(form.low_stock_at)||0};
    if(editItem){
      const r=await api.put(`/api/pantry/${editItem.id}`,body).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setPantry(p=>p.map(x=>x.id===r.id?r:x));
    }else{
      const r=await api.post('/api/pantry',body).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setPantry(p=>[...p,r]);
    }
    setDrawer(false);setEditItem(null);
    toastAdd(editItem?'Item updated':'Item added');
  };
  const del=async id=>{
    try{await api.del(`/api/pantry/${id}`);setPantry(p=>p.filter(x=>x.id!==id));setDrawer(false);setEditItem(null);toastAdd('Removed','blue');}
    catch{toastAdd('Failed to remove','red');}
  };
  const openUse=p=>{setUseTarget(p);setUseAmount('1');};
  const confirmUse=async()=>{
    if(!useTarget) return;
    const amount=Number(useAmount);
    if(!amount||amount<=0){toastAdd('Enter a valid amount','red');return;}
    const r=await api.put(`/api/pantry/${useTarget.id}/use`,{amount}).catch(()=>null);
    if(!r?.id){toastAdd('Failed','red');return;}
    setPantry(prev=>prev.map(x=>x.id===r.id?r:x));
    setUseTarget(null);
    toastAdd(`Used ${amount}`,'blue');
  };
  const needReplace=(pantry||[]).filter(p=>p.expiry_status==='expired'||isLow(p));
  const addBulkToGrocery=async()=>{
    if(!needReplace.length) return;
    const r=await api.post('/api/pantry/add-to-grocery',{ids:needReplace.map(x=>x.id)}).catch(()=>null);
    if(!r){toastAdd('Failed','red');return;}
    api.get('/api/grocery').then(d=>{if(Array.isArray(d)&&setGrocery) setGrocery(d);}).catch(()=>{});
    toastAdd(`Added ${r.added} to grocery`);
  };
  const byLoc=LOCATIONS.map(loc=>({loc,items:(pantry||[]).filter(p=>(p.location||'Other')===loc)})).filter(g=>g.items.length>0);
  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>Pantry</h1>
        <Btn onClick={openNew}>+ Add</Btn>
      </div>
      {needReplace.length>0&&(
        <Card style={{padding:'14px 18px',marginBottom:16,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:160}}>
            <div style={{fontSize:13,fontWeight:600,color:A.label1}}>{needReplace.length} item{needReplace.length===1?'':'s'} expired or low</div>
            <div style={{fontSize:12,color:A.label4,marginTop:2}}>Add them straight to grocery.</div>
          </div>
          <Btn onClick={addBulkToGrocery} sm>Add to grocery</Btn>
        </Card>
      )}
      {(pantry||[]).length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No items yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Track what's in your fridge, freezer, and pantry. Catch expiring food before it's wasted.</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:20}}>
          {byLoc.map(({loc,items})=>(
            <div key={loc}>
              <div style={{fontSize:12,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{loc}</div>
              <Card style={{overflow:'hidden',padding:0}}>
                {items.map((p,i)=>{
                  const eb=expBadge(p);
                  const low=isLow(p);
                  return(
                    <div key={p.id} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 18px',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                          <span style={{fontSize:15,fontWeight:600,color:A.label1}}>{p.name}</span>
                          {eb&&<span style={{fontSize:11,fontWeight:700,color:eb.color,background:eb.bg,padding:'2px 8px',borderRadius:A.rPill}}>{eb.label}</span>}
                          {low&&<span style={{fontSize:11,fontWeight:700,color:A.amber,background:A.amberFill,padding:'2px 8px',borderRadius:A.rPill}}>Low</span>}
                        </div>
                        <div style={{fontSize:12,color:A.label4,marginTop:2}}>{p.quantity}{p.unit?` ${p.unit}`:''}</div>
                      </div>
                      <button onClick={()=>openUse(p)} style={{background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:20,padding:'5px 14px',fontSize:12,fontWeight:600,color:A.label3,cursor:'pointer',flexShrink:0}}>Use</button>
                      <button onClick={()=>openEdit(p)} style={{background:'none',border:'none',color:A.label4,cursor:'pointer',fontSize:13,padding:'0 4px',flexShrink:0}}>Edit</button>
                    </div>
                  );
                })}
              </Card>
            </div>
          ))}
        </div>
      )}
      <Drawer open={drawer} onClose={()=>{setDrawer(false);setEditItem(null);}} title={editItem?'Edit Item':'Add Item'}>
        <FormGroup label="Name">
          <div style={{padding:'12px 16px'}}><Inp value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Eggs"/></div>
        </FormGroup>
        <FormGroup label="Location">
          <div style={{padding:'12px 16px'}}>
            <select value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              {LOCATIONS.map(l=><option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </FormGroup>
        <FormGroup label="Quantity">
          <div style={{padding:'12px 16px',display:'flex',gap:8}}>
            <Inp type="number" value={form.quantity} onChange={e=>setForm(f=>({...f,quantity:e.target.value}))} style={{flex:1}}/>
            <Inp value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))} placeholder="oz, lbs, etc." style={{flex:1}}/>
          </div>
        </FormGroup>
        <FormGroup label="Expires on (optional)">
          <div style={{padding:'12px 16px'}}><Inp type="date" value={form.expires_on} onChange={e=>setForm(f=>({...f,expires_on:e.target.value}))}/></div>
        </FormGroup>
        <FormGroup label="Low stock threshold (0 = disabled)" footer="Show 'Low' badge when quantity is at or below this number.">
          <div style={{padding:'12px 16px'}}><Inp type="number" value={form.low_stock_at} onChange={e=>setForm(f=>({...f,low_stock_at:e.target.value}))}/></div>
        </FormGroup>
        <FormGroup label="Category">
          <div style={{padding:'12px 16px'}}>
            <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </FormGroup>
        <div style={{display:'flex',gap:8,marginTop:4}}>
          <Btn onClick={save} full>{editItem?'Save Changes':'Add Item'}</Btn>
          {editItem&&<Btn variant="ghost" onClick={()=>del(editItem.id)} full style={{color:A.red}}>Delete</Btn>}
        </div>
        {!editItem&&<Btn variant="ghost" onClick={()=>setDrawer(false)} full style={{marginTop:8}}>Cancel</Btn>}
      </Drawer>
      {useTarget&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={()=>setUseTarget(null)}>
          <div style={{background:A.cardBg,borderRadius:A.r,padding:24,width:'100%',maxWidth:320,boxShadow:A.shadowLg}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:17,fontWeight:700,color:A.label1,marginBottom:4}}>Use item</div>
            <div style={{fontSize:14,color:A.label3,marginBottom:16}}>{useTarget.name} · {useTarget.quantity}{useTarget.unit?` ${useTarget.unit}`:''} remaining</div>
            <div style={{fontSize:12,fontWeight:600,color:A.label4,marginBottom:6}}>Amount to use</div>
            <Inp type="number" value={useAmount} onChange={e=>setUseAmount(e.target.value)} placeholder="1" style={{marginBottom:16}}/>
            <div style={{display:'flex',gap:8}}>
              <Btn onClick={confirmUse} full>Use</Btn>
              <Btn variant="ghost" onClick={()=>setUseTarget(null)} full>Cancel</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SchoolScreen({members=[],toastAdd}){
  const isMobile=useIsMobile();
  const DAYS_OPTS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const [schoolMembers,setSchoolMembers]=useState([]);
  const [loaded,setLoaded]=useState(false);
  const blankM={member_id:'',school_name:'',grade:'',teacher_name:'',teacher_email:'',school_phone:'',start_time:'',end_time:'',notes:''};
  const blankC={period:'',subject:'',teacher:'',room:'',days:'Mon,Tue,Wed,Thu,Fri'};
  const [mDrawer,setMDrawer]=useState(false);
  const [editM,setEditM]=useState(null);
  const [mForm,setMForm]=useState(blankM);
  const [cDrawer,setCDrawer]=useState(false);
  const [cContext,setCContext]=useState(null); // {schoolMemberId, edit?}
  const [cForm,setCForm]=useState(blankC);
  const [expanded,setExpanded]=useState(null);
  useEffect(()=>{
    api.get('/api/school').then(d=>{if(Array.isArray(d)) setSchoolMembers(d);setLoaded(true);}).catch(()=>setLoaded(true));
  },[]);
  const openNewM=()=>{setEditM(null);setMForm(blankM);setMDrawer(true);};
  const openEditM=s=>{setEditM(s);setMForm({member_id:s.member_id?String(s.member_id):'',school_name:s.school_name||'',grade:s.grade||'',teacher_name:s.teacher_name||'',teacher_email:s.teacher_email||'',school_phone:s.school_phone||'',start_time:s.start_time||'',end_time:s.end_time||'',notes:s.notes||''});setMDrawer(true);};
  const saveM=async()=>{
    if(!mForm.school_name.trim()){toastAdd('School name required','red');return;}
    const body={...mForm,member_id:mForm.member_id?Number(mForm.member_id):null};
    if(editM){
      const r=await api.put(`/api/school/${editM.id}`,body).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setSchoolMembers(p=>p.map(x=>x.id===r.id?r:x));
    }else{
      const r=await api.post('/api/school',body).catch(()=>null);
      if(!r?.id){toastAdd('Failed to save','red');return;}
      setSchoolMembers(p=>[...p,r]);
    }
    setMDrawer(false);setEditM(null);
    toastAdd(editM?'School updated':'School added');
  };
  const delM=async id=>{
    try{await api.del(`/api/school/${id}`);setSchoolMembers(p=>p.filter(x=>x.id!==id));setMDrawer(false);setEditM(null);toastAdd('Removed','blue');}
    catch{toastAdd('Failed to remove','red');}
  };
  const openNewC=schoolMemberId=>{setCContext({schoolMemberId,edit:null});setCForm(blankC);setCDrawer(true);};
  const openEditC=(schoolMemberId,cls)=>{setCContext({schoolMemberId,edit:cls});setCForm({period:cls.period||'',subject:cls.subject,teacher:cls.teacher||'',room:cls.room||'',days:cls.days||'Mon,Tue,Wed,Thu,Fri'});setCDrawer(true);};
  const saveC=async()=>{
    if(!cForm.subject.trim()){toastAdd('Subject required','red');return;}
    const sid=cContext.schoolMemberId;
    if(cContext.edit){
      const r=await api.put(`/api/school/${sid}/classes/${cContext.edit.id}`,cForm).catch(()=>null);
      if(!r?.id){toastAdd('Failed','red');return;}
      setSchoolMembers(p=>p.map(s=>s.id===sid?{...s,classes:s.classes.map(c=>c.id===r.id?r:c)}:s));
    }else{
      const r=await api.post(`/api/school/${sid}/classes`,cForm).catch(()=>null);
      if(!r?.id){toastAdd('Failed','red');return;}
      setSchoolMembers(p=>p.map(s=>s.id===sid?{...s,classes:[...(s.classes||[]),r]}:s));
    }
    setCDrawer(false);setCContext(null);
    toastAdd('Saved');
  };
  const delC=async()=>{
    if(!cContext?.edit) return;
    const sid=cContext.schoolMemberId;
    const cid=cContext.edit.id;
    try{
      await api.del(`/api/school/${sid}/classes/${cid}`);
      setSchoolMembers(p=>p.map(s=>s.id===sid?{...s,classes:(s.classes||[]).filter(c=>c.id!==cid)}:s));
      setCDrawer(false);setCContext(null);
      toastAdd('Class removed','blue');
    }catch{toastAdd('Failed','red');}
  };
  const toggleDay=d=>{
    const arr=cForm.days?cForm.days.split(','):[];
    const next=arr.includes(d)?arr.filter(x=>x!==d):[...arr,d];
    const order=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    next.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
    setCForm(f=>({...f,days:next.join(',')}));
  };
  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <h1 style={{fontSize:isMobile?34:44,fontWeight:800,letterSpacing:'-.05em',lineHeight:1.05}}>School</h1>
        <Btn onClick={openNewM}>+ Add</Btn>
      </div>
      {!loaded?(
        <Card style={{padding:'40px 24px',textAlign:'center'}}><div style={{fontSize:14,color:A.label4}}>Loading…</div></Card>
      ):schoolMembers.length===0?(
        <Card style={{padding:'52px 24px',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:700,color:A.label5,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}}>No school info yet</div>
          <div style={{fontSize:15,color:A.label3,fontWeight:500}}>Track schools, grades, teachers, and class schedules for each kid.</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {schoolMembers.map(s=>{
            const linked=members.find(m=>m.id===s.member_id);
            const ex=expanded===s.id;
            return(
              <Card key={s.id} style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'16px 18px',display:'flex',alignItems:'flex-start',gap:12}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      {linked&&<div style={{width:24,height:24,borderRadius:'50%',background:linked.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#fff'}}>{linked.initials}</div>}
                      <span style={{fontSize:16,fontWeight:600,color:A.label1}}>{s.school_name||'Untitled school'}</span>
                      {s.grade&&<span style={{fontSize:11,fontWeight:700,color:A.label4,background:A.inputBg,padding:'2px 8px',borderRadius:A.rPill}}>{s.grade}</span>}
                    </div>
                    <div style={{fontSize:12,color:A.label4,marginTop:4,display:'flex',gap:8,flexWrap:'wrap'}}>
                      {s.start_time&&s.end_time&&<span>{s.start_time}–{s.end_time}</span>}
                      {s.teacher_name&&<span>{s.teacher_name}</span>}
                      {s.school_phone&&<a href={`tel:${s.school_phone}`} style={{color:A.blue,textDecoration:'none'}}>{s.school_phone}</a>}
                    </div>
                  </div>
                  <button onClick={()=>setExpanded(ex?null:s.id)} style={{background:A.inputBg,border:'none',borderRadius:A.rPill,padding:'5px 12px',fontSize:12,fontWeight:600,color:A.label2,cursor:'pointer'}}>{ex?'Hide classes':`Classes (${(s.classes||[]).length})`}</button>
                  <button onClick={()=>openEditM(s)} style={{background:'none',border:'none',color:A.label4,fontSize:13,cursor:'pointer',padding:'0 4px'}}>Edit</button>
                </div>
                {ex&&(
                  <div style={{padding:'0 18px 16px',borderTop:`1px solid ${A.sep}`}}>
                    {(s.classes||[]).length===0?(
                      <div style={{fontSize:13,color:A.label4,padding:'14px 0',textAlign:'center',fontStyle:'italic'}}>No classes added</div>
                    ):(s.classes||[]).map((c,i)=>(
                      <div key={c.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderTop:i>0?`1px solid ${A.sep}`:'none'}}>
                        {c.period&&<span style={{fontSize:11,fontWeight:700,color:A.label4,background:A.inputBg,padding:'2px 7px',borderRadius:A.rPill,flexShrink:0}}>{c.period}</span>}
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:14,fontWeight:600,color:A.label1}}>{c.subject}</div>
                          <div style={{fontSize:11,color:A.label4,marginTop:1}}>
                            {[c.teacher,c.room,c.days].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <button onClick={()=>openEditC(s.id,c)} style={{background:'none',border:'none',color:A.label4,fontSize:13,cursor:'pointer',padding:'0 4px'}}>Edit</button>
                      </div>
                    ))}
                    <div style={{marginTop:12}}>
                      <Btn variant="ghost" sm onClick={()=>openNewC(s.id)}>+ Add Class</Btn>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <Drawer open={mDrawer} onClose={()=>{setMDrawer(false);setEditM(null);}} title={editM?'Edit School Info':'Add School Info'}>
        <FormGroup label="Family member (optional)">
          <div style={{padding:'12px 16px'}}>
            <select value={mForm.member_id} onChange={e=>setMForm(f=>({...f,member_id:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:A.rXs,border:`1px solid ${A.sep}`,background:A.inputBg,fontSize:15,color:A.label1}}>
              <option value="">— Not linked —</option>
              {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </FormGroup>
        <FormGroup label="School name">
          <div style={{padding:'12px 16px'}}><Inp value={mForm.school_name} onChange={e=>setMForm(f=>({...f,school_name:e.target.value}))} placeholder="Oakwood Elementary"/></div>
        </FormGroup>
        <FormGroup label="Grade">
          <div style={{padding:'12px 16px'}}><Inp value={mForm.grade} onChange={e=>setMForm(f=>({...f,grade:e.target.value}))} placeholder="3rd grade"/></div>
        </FormGroup>
        <FormGroup label="Teacher name">
          <div style={{padding:'12px 16px'}}><Inp value={mForm.teacher_name} onChange={e=>setMForm(f=>({...f,teacher_name:e.target.value}))} placeholder="Ms. Johnson"/></div>
        </FormGroup>
        <FormGroup label="Teacher email">
          <div style={{padding:'12px 16px'}}><Inp type="email" value={mForm.teacher_email} onChange={e=>setMForm(f=>({...f,teacher_email:e.target.value}))} placeholder="johnson@school.org"/></div>
        </FormGroup>
        <FormGroup label="School phone">
          <div style={{padding:'12px 16px'}}><Inp type="tel" value={mForm.school_phone} onChange={e=>setMForm(f=>({...f,school_phone:e.target.value}))} placeholder="(404) 555-0100"/></div>
        </FormGroup>
        <FormGroup label="Start time">
          <div style={{padding:'12px 16px'}}><Inp type="time" value={mForm.start_time} onChange={e=>setMForm(f=>({...f,start_time:e.target.value}))}/></div>
        </FormGroup>
        <FormGroup label="End time">
          <div style={{padding:'12px 16px'}}><Inp type="time" value={mForm.end_time} onChange={e=>setMForm(f=>({...f,end_time:e.target.value}))}/></div>
        </FormGroup>
        <FormGroup label="Notes">
          <div style={{padding:'12px 16px'}}><textarea value={mForm.notes} onChange={e=>setMForm(f=>({...f,notes:e.target.value}))} placeholder="Pickup details, lunch account, etc." style={{width:'100%',minHeight:60,padding:'9px 12px',background:A.inputBg,border:`1.5px solid ${A.sep}`,borderRadius:A.rXs,fontSize:15,color:A.label1,fontFamily:'inherit',resize:'vertical',outline:'none'}}/></div>
        </FormGroup>
        <div style={{display:'flex',gap:8,marginTop:4}}>
          <Btn onClick={saveM} full>{editM?'Save Changes':'Add School'}</Btn>
          {editM&&<Btn variant="ghost" onClick={()=>delM(editM.id)} full style={{color:A.red}}>Delete</Btn>}
        </div>
        {!editM&&<Btn variant="ghost" onClick={()=>setMDrawer(false)} full style={{marginTop:8}}>Cancel</Btn>}
      </Drawer>
      <Drawer open={cDrawer} onClose={()=>{setCDrawer(false);setCContext(null);}} title={cContext?.edit?'Edit Class':'Add Class'}>
        <FormGroup label="Period (optional)">
          <div style={{padding:'12px 16px'}}><Inp value={cForm.period} onChange={e=>setCForm(f=>({...f,period:e.target.value}))} placeholder="1, 2nd, Block A…"/></div>
        </FormGroup>
        <FormGroup label="Subject">
          <div style={{padding:'12px 16px'}}><Inp value={cForm.subject} onChange={e=>setCForm(f=>({...f,subject:e.target.value}))} placeholder="Algebra II"/></div>
        </FormGroup>
        <FormGroup label="Teacher">
          <div style={{padding:'12px 16px'}}><Inp value={cForm.teacher} onChange={e=>setCForm(f=>({...f,teacher:e.target.value}))} placeholder="Mr. Davis"/></div>
        </FormGroup>
        <FormGroup label="Room">
          <div style={{padding:'12px 16px'}}><Inp value={cForm.room} onChange={e=>setCForm(f=>({...f,room:e.target.value}))} placeholder="204"/></div>
        </FormGroup>
        <FormGroup label="Days">
          <div style={{padding:'12px 16px',display:'flex',flexWrap:'wrap',gap:6}}>
            {DAYS_OPTS.map(d=>{
              const active=(cForm.days||'').split(',').includes(d);
              return(
                <button key={d} onClick={()=>toggleDay(d)} style={{padding:'6px 12px',borderRadius:A.rPill,border:`1.5px solid ${active?A.blue:A.sep}`,background:active?A.blueFill:A.inputBg,color:active?A.blue:A.label3,fontSize:12,fontWeight:600,cursor:'pointer'}}>{d}</button>
              );
            })}
          </div>
        </FormGroup>
        <div style={{display:'flex',gap:8,marginTop:4}}>
          <Btn onClick={saveC} full>{cContext?.edit?'Save Changes':'Add Class'}</Btn>
          {cContext?.edit&&<Btn variant="ghost" onClick={delC} full style={{color:A.red}}>Delete</Btn>}
        </div>
        {!cContext?.edit&&<Btn variant="ghost" onClick={()=>setCDrawer(false)} full style={{marginTop:8}}>Cancel</Btn>}
      </Drawer>
    </div>
  );
}

function ManageMode({onDisplay,onLogout,events,setEvents,chores,setChores,grocery,setGrocery,meals,setMeals,icsSources,setIcsSources,inboxCount,setInboxCount,countdowns,setCountdowns,members,setMembers,photos,setPhotos,clockFormat,setClockFormat,weather,nightModeStart,setNightModeStart,nightModeEnd,setNightModeEnd,setRefreshMs,parseRefreshMs,goals,setGoals,notes,setNotes,polls,setPolls,bookmarks,setBookmarks,quickActions,setQuickActions,setRotationMs,setWifiQrData,darkMode,onDarkMode,packages,setPackages,messages,setMessages,recipes,setRecipes,bills,setBills,payments,setPayments,vehicles,setVehicles,appliances,setAppliances,consumables,setConsumables,pets,setPets,contacts,setContacts,maintenanceItems,setMaintenanceItems,budget,setBudget,subscriptions,setSubscriptions,projects,setProjects,pantry,setPantry,isAdmin=false}){
  const isMobile=useIsMobile();
  const [screen,setScreen]=useState('dashboard');
  const {toasts,add:toastAdd}=useToast();
  const [scrolled,setScrolled]=useState(false);
  const [serverUp,setServerUp]=useState(null);
  const [globalSearch,setGlobalSearch]=useState('');
  const [searchOpen,setSearchOpen]=useState(false);
  const searchRef=useRef(null);
  useEffect(()=>{
    if(!searchOpen) return;
    const onKey=(e)=>{if(e.key==='Escape'){setSearchOpen(false);setGlobalSearch('');}};
    const onPointer=(e)=>{if(searchRef.current&&!searchRef.current.contains(e.target)){setSearchOpen(false);setGlobalSearch('');}};
    window.addEventListener('keydown',onKey);
    window.addEventListener('pointerdown',onPointer);
    return()=>{window.removeEventListener('keydown',onKey);window.removeEventListener('pointerdown',onPointer);};
  },[searchOpen]);
  const searchResults=useMemo(()=>{
    const q=globalSearch.trim().toLowerCase();
    if(q.length<2) return null;
    const match=(str)=>(str||'').toLowerCase().includes(q);
    const noteMatches=(notes||[]).filter(n=>match(n.title)||match(n.content)).slice(0,3).map(n=>({type:'Notes',label:n.title,screen:'notes'}));
    const contactMatches=(contacts||[]).filter(c=>match(c.name)||match(c.role)||match(c.phone)).slice(0,3).map(c=>({type:'Contacts',label:c.name,screen:'contacts'}));
    const recipeMatches=(recipes||[]).filter(r=>match(r.name)).slice(0,3).map(r=>({type:'Recipes',label:r.name,screen:'recipes'}));
    const choreMatches=(chores||[]).filter(c=>match(c.name)).slice(0,3).map(c=>({type:'Chores',label:c.name,screen:'chores'}));
    const subMatches=(subscriptions||[]).filter(s=>match(s.name)||match(s.notes)).slice(0,3).map(s=>({type:'Subscriptions',label:s.name,screen:'subscriptions'}));
    const projMatches=(projects||[]).filter(p=>match(p.title)||match(p.description)).slice(0,3).map(p=>({type:'Projects',label:p.title,screen:'projects'}));
    const pantryMatches=(pantry||[]).filter(p=>match(p.name)).slice(0,3).map(p=>({type:'Pantry',label:p.name,screen:'pantry'}));
    return [...noteMatches,...contactMatches,...recipeMatches,...choreMatches,...subMatches,...projMatches,...pantryMatches];
  },[globalSearch,notes,contacts,recipes,chores,subscriptions,projects,pantry]);
  useEffect(()=>{
    const ping=()=>api.get('/api/uptime').then(()=>setServerUp(true)).catch(()=>setServerUp(false));
    ping();
    const id=setInterval(ping,60000);
    return()=>clearInterval(id);
  },[]);

  // Decode JWT payload to check family_role for kid mode
  const _jwtPayload=useMemo(()=>{
    try{const t=localStorage.getItem('kith_token')||'';const p=t.split('.')[1];if(!p) return null;return JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/')));}catch{return null;}
  },[]);
  const isKidMode=_jwtPayload?.role==='member'&&_jwtPayload?.family_role==='kid';
  const KID_SCREENS=new Set(['dashboard','chores','grocery','calendar']);

  const allNav=[
    {id:'dashboard',label:'Dashboard',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="1" y="1" width="6" height="6" rx="2" fill="currentColor" opacity=".9"/><rect x="10" y="1" width="6" height="6" rx="2" fill="currentColor" opacity=".9"/><rect x="1" y="10" width="6" height="6" rx="2" fill="currentColor" opacity=".9"/><rect x="10" y="10" width="6" height="6" rx="2" fill="currentColor" opacity=".9"/></svg>},
    {id:'calendar',label:'Calendar',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="1.5" y="3.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1.5 7h14" stroke="currentColor" strokeWidth="1.5"/><path d="M5.5 1.5v3M11.5 1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'chores',label:'Chores',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="2" y="1.5" width="13" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5.5 7l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 11h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'grocery',label:'Grocery',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M2 4h13l-1.5 8H3.5L2 4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M6 4l.5-2.5h4L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>},
    {id:'pantry',label:'Pantry',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="3" y="3" width="11" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M3 7h11" stroke="currentColor" strokeWidth="1.5"/><path d="M6 1.5v2M11 1.5v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'countdowns',label:'Countdowns',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8.5 5.5V9l2.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 1.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'family',label:'Family',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1 14c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M12 9c1.66 0 3 1.34 3 3v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'school',label:'School',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M1.5 6.5L8.5 3l7 3.5-7 3.5-7-3.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M4 8v4c0 1 2 2 4.5 2s4.5-1 4.5-2V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'goals',label:'Goals',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="6.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="8.5" cy="8.5" r="3" stroke="currentColor" strokeWidth="1.5"/><circle cx="8.5" cy="8.5" r="1" fill="currentColor"/></svg>},
    {id:'projects',label:'Projects',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M3 11l4-4 3 3 4-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M11 5h3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 14h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'notes',label:'Notes',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="2" y="2" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 6h7M5 9h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'bookmarks',label:'Bookmarks',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M3.5 2h10a1 1 0 011 1v12l-5.5-3.5L3.5 15V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>},
    {id:'polls',label:'Polls',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="2" y="9" width="3" height="6" rx="1" fill="currentColor" opacity=".5"/><rect x="7" y="5" width="3" height="10" rx="1" fill="currentColor" opacity=".7"/><rect x="12" y="2" width="3" height="13" rx="1" fill="currentColor"/></svg>},
    {id:'bills',label:'Bills',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="1.5" y="3" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 8h4M5 11h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M11.5 6.5v4M9.5 8.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'subscriptions',label:'Subscriptions',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="2" y="4" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M2 7h13" stroke="currentColor" strokeWidth="1.5"/><path d="M5 10h2M9 10h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'budget',label:'Budget',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="2" y="9" width="3" height="6" rx="1" fill="currentColor" opacity=".5"/><rect x="7" y="5" width="3" height="10" rx="1" fill="currentColor" opacity=".7"/><rect x="12" y="2" width="3" height="13" rx="1" fill="currentColor"/></svg>},
    {id:'vehicles',label:'Vehicles',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M2 10l1.5-4.5A1 1 0 014.4 5h8.2a1 1 0 01.9.5L15 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><rect x="1" y="10" width="15" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="4.5" cy="14" r="1.5" fill="currentColor"/><circle cx="12.5" cy="14" r="1.5" fill="currentColor"/></svg>},
    {id:'home',label:'Home',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M2 7.5L8.5 2 15 7.5V15a1 1 0 01-1 1H3a1 1 0 01-1-1V7.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M6 16v-6h5v6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>},
    {id:'pets',label:'Pets',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="5" cy="4" r="1.5" fill="currentColor"/><circle cx="12" cy="4" r="1.5" fill="currentColor"/><circle cx="3" cy="8" r="1.5" fill="currentColor"/><circle cx="14" cy="8" r="1.5" fill="currentColor"/><ellipse cx="8.5" cy="12" rx="4" ry="3.5" stroke="currentColor" strokeWidth="1.5"/></svg>},
    {id:'contacts',label:'Contacts',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="6" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M2 15c0-3.31 2.91-6 6.5-6s6.5 2.69 6.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'emergency',label:'Emergency',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M8.5 1.5l6 2v5c0 3.5-2.5 6.5-6 7.5-3.5-1-6-4-6-7.5v-5l6-2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M8.5 6v3M8.5 11v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'packages',label:'Packages',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="2" y="5" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5.5 5V3.5a3 3 0 016 0V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M2 8.5h13" stroke="currentColor" strokeWidth="1.5"/></svg>,badge:packages?.length||0},
    {id:'messages',label:'Messages',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M2 3h13a1 1 0 011 1v8a1 1 0 01-1 1H5l-4 3V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,badge:messages?.length||0},
    {id:'lists',label:'Lists',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M5 4h10M5 8.5h10M5 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="2.5" cy="4" r="1" fill="currentColor"/><circle cx="2.5" cy="8.5" r="1" fill="currentColor"/><circle cx="2.5" cy="13" r="1" fill="currentColor"/></svg>},
    {id:'recipes',label:'Recipes',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M3 2h11a1 1 0 011 1v11a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5"/><path d="M5 6h7M5 9h5M5 12h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
    {id:'inbox',label:'Inbox',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="1.5" y="3.5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1.5 6.5l7 4 7-4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,badge:inboxCount},
    {id:'settings',label:'Settings',icon:<svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8.5 1v2M8.5 14v2M1 8.5h2M14 8.5h2M3.05 3.05l1.42 1.42M12.53 12.53l1.42 1.42M12.53 3.05l-1.42 1.42M4.47 12.53l-1.42 1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>},
  ];
  const nav=isKidMode?allNav.filter(item=>KID_SCREENS.has(item.id)):allNav;

  const screens={
    dashboard:  <DashboardScreen events={events} setEvents={setEvents} chores={chores} grocery={grocery} meals={meals} countdowns={countdowns} weather={weather} clockFormat={clockFormat} quickActions={quickActions} bills={bills} payments={payments} projects={projects} subscriptions={subscriptions} pantry={pantry}/>,
    calendar:   <CalendarScreen events={events} setEvents={setEvents} icsSources={icsSources} toastAdd={toastAdd} members={members} clockFormat={clockFormat}/>,
    chores:     <ChoresScreen chores={chores} setChores={setChores} goals={goals} members={members} toastAdd={toastAdd}/>,
    grocery:    <GroceryScreen grocery={grocery} setGrocery={setGrocery} meals={meals} setMeals={setMeals} recipes={recipes} toastAdd={toastAdd}/>,
    pantry:     <PantryScreen pantry={pantry} setPantry={setPantry} grocery={grocery} setGrocery={setGrocery} toastAdd={toastAdd}/>,
    countdowns: <CountdownsScreen countdowns={countdowns} setCountdowns={setCountdowns} toastAdd={toastAdd}/>,
    family:     <FamilyScreen members={members} setMembers={setMembers} toastAdd={toastAdd}/>,
    school:     <SchoolScreen members={members} toastAdd={toastAdd}/>,
    goals:      <GoalsScreen goals={goals} setGoals={setGoals} toastAdd={toastAdd}/>,
    projects:   <ProjectsScreen projects={projects} setProjects={setProjects} toastAdd={toastAdd}/>,
    notes:      <NotesScreen notes={notes} setNotes={setNotes} toastAdd={toastAdd}/>,
    bookmarks:  <BookmarksScreen bookmarks={bookmarks} setBookmarks={setBookmarks} toastAdd={toastAdd}/>,
    polls:      <PollsScreen polls={polls} setPolls={setPolls} toastAdd={toastAdd}/>,
    bills:      <BillsScreen bills={bills} setBills={setBills} payments={payments} setPayments={setPayments} toastAdd={toastAdd}/>,
    subscriptions: <SubscriptionsScreen subscriptions={subscriptions} setSubscriptions={setSubscriptions} toastAdd={toastAdd}/>,
    budget:     <BudgetScreen budget={budget} setBudget={setBudget} toastAdd={toastAdd}/>,
    vehicles:   <VehiclesScreen vehicles={vehicles} setVehicles={setVehicles} toastAdd={toastAdd}/>,
    home:       <HomeScreen appliances={appliances} setAppliances={setAppliances} consumables={consumables} setConsumables={setConsumables} maintenanceItems={maintenanceItems} setMaintenanceItems={setMaintenanceItems} toastAdd={toastAdd}/>,
    pets:       <PetsScreen pets={pets} setPets={setPets} toastAdd={toastAdd}/>,
    contacts:   <ContactsScreen contacts={contacts} setContacts={setContacts} toastAdd={toastAdd}/>,
    emergency:  <EmergencyScreen toastAdd={toastAdd}/>,
    packages:   <PackagesScreen packages={packages} setPackages={setPackages} toastAdd={toastAdd}/>,
    messages:   <MessagesScreen messages={messages} setMessages={setMessages} members={members} toastAdd={toastAdd}/>,
    lists:      <ListsScreen toastAdd={toastAdd}/>,
    recipes:    <RecipesScreen recipes={recipes} setRecipes={setRecipes} toastAdd={toastAdd}/>,
    inbox:      <InboxScreen toastAdd={toastAdd} events={events} setEvents={setEvents} setInboxCount={setInboxCount}/>,
    settings:   <SettingsScreen toastAdd={toastAdd} icsSources={icsSources} setIcsSources={setIcsSources} onDisplay={onDisplay} photos={photos} setPhotos={setPhotos} clockFormat={clockFormat} setClockFormat={setClockFormat} nightModeStart={nightModeStart} setNightModeStart={setNightModeStart} nightModeEnd={nightModeEnd} setNightModeEnd={setNightModeEnd} setRefreshMs={setRefreshMs} parseRefreshMs={parseRefreshMs} setQuickActions={setQuickActions} setRotationMs={setRotationMs} setWifiQrData={setWifiQrData} darkMode={darkMode} onDarkMode={onDarkMode}/>,
  };

  if(isMobile){
    return(
      <div style={{display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden',background:A.systemBg}}>
        {/* Mobile top bar */}
        <div className="hdr" style={{paddingTop:'max(12px, env(safe-area-inset-top))',background:A.cardBg,borderBottom:`1px solid ${A.sep}`,boxShadow:scrolled?A.shadowSm:'none',display:'flex',alignItems:'center',justifyContent:'space-between',padding:`max(12px, env(safe-area-inset-top)) 16px 12px`,flexShrink:0}}>
          <span style={{fontSize:17,fontWeight:700,letterSpacing:'-.03em',color:A.label1}}>{nav.find(n=>n.id===screen)?.label}</span>
          {!isKidMode && <button onClick={()=>setScreen('settings')} style={{width:30,height:30,borderRadius:'50%',background:A.inputBg,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:A.label3}}>
            <svg width="15" height="15" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8.5 1v2M8.5 14v2M1 8.5h2M14 8.5h2M3.05 3.05l1.42 1.42M12.53 12.53l1.42 1.42M12.53 3.05l-1.42 1.42M4.47 12.53l-1.42 1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>}
        </div>
        {/* Content */}
        <div key={screen} className="screen fade-scroll" onScroll={e=>setScrolled(e.currentTarget.scrollTop>12)} style={{flex:1,overflowY:'auto',padding:screen==='calendar'?0:'16px 20px',paddingBottom:`calc(96px + env(safe-area-inset-bottom))`}}>
          {isKidMode && !KID_SCREENS.has(screen) ? screens['dashboard'] : screens[screen]}
        </div>
        {/* Bottom tab bar */}
        <div style={{position:'fixed',bottom:'max(12px, env(safe-area-inset-bottom))',left:'50%',transform:'translateX(-50%)',width:'calc(100% - 32px)',maxWidth:560,background:A.cardBg,border:`1px solid ${A.sep}`,borderRadius:28,boxShadow:A.shadowMd,display:'flex',padding:'0 2px',zIndex:50,height:58,alignItems:'center'}}>
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
        <QuickAddFAB screen={screen} setGrocery={setGrocery} setChores={setChores} toastAdd={toastAdd} isAdmin={isAdmin}/>
        <ToastStack toasts={toasts}/>
      </div>
    );
  }

  return(
    <div style={{display:'flex',height:'100vh',overflow:'hidden',background:A.systemBg}}>
      <div style={{width:220,flexShrink:0,background:A.chrome,borderRight:`1px solid ${A.sep}`,display:'flex',flexDirection:'column'}}>
        <div style={{padding:'22px 18px 14px'}}>
          <div style={{fontSize:22,fontWeight:800,letterSpacing:'-.05em',color:A.label1}}>Kith</div>
          <div style={{fontSize:12,color:A.label5,marginTop:1,letterSpacing:'-.01em'}}>Family Dashboard</div>
        </div>
        <div style={{flex:1,padding:'4px 10px',overflowY:'auto'}}>
          {nav.map(item=>{
            const active=screen===item.id;
            return(
              <button key={item.id} onClick={()=>setScreen(item.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:A.rSm,border:'none',cursor:'pointer',width:'100%',background:active?A.label1:'transparent',color:active?A.cardBg:A.label3,fontSize:14,fontWeight:active?600:400,textAlign:'left',marginBottom:1,transition:'background .12s,color .12s'}}
                onMouseEnter={e=>{if(!active)e.currentTarget.style.background=A.inputBg;}}
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
          <button onClick={onDisplay} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderRadius:A.rSm,border:`1px solid ${A.sep}`,cursor:'pointer',width:'100%',background:'transparent',color:A.label3,fontSize:13,fontWeight:500,textAlign:'left',marginBottom:8,transition:'background .12s'}}
            onMouseEnter={e=>e.currentTarget.style.background=A.inputBg}
            onMouseLeave={e=>e.currentTarget.style.background='transparent'}
          >
            <svg width="15" height="12" viewBox="0 0 15 12" fill="none"><rect x=".75" y=".75" width="13.5" height="9" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M4 11.25h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M7.5 9.75v1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            Display Mode
          </button>
          <button onClick={onLogout} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderRadius:A.rSm,border:'none',cursor:'pointer',width:'100%',background:'transparent',color:A.label4,fontSize:13,fontWeight:400,textAlign:'left',marginBottom:10,transition:'background .12s'}}
            onMouseEnter={e=>e.currentTarget.style.background=A.inputBg}
            onMouseLeave={e=>e.currentTarget.style.background='transparent'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 13H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10 10l3-3-3-3M13 7H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Switch user
          </button>
          <div style={{width:8,height:8,borderRadius:'50%',background:serverUp===null?A.label5:serverUp?A.green:A.red,transition:'background .3s'}}/>
        </div>
      </div>

      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div className="hdr" style={{height:54,background:A.cardBg,borderBottom:`1px solid ${A.sep}`,boxShadow:scrolled?A.shadowSm:'none',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 26px',flexShrink:0,position:'relative'}}>
          <span style={{fontSize:17,fontWeight:700,letterSpacing:'-.03em',color:A.label1}}>{nav.find(n=>n.id===screen)?.label}</span>
          <div style={{display:'flex',alignItems:'center',gap:14}}>
            <button onClick={()=>{setSearchOpen(s=>!s);setGlobalSearch('');}} style={{width:30,height:30,borderRadius:'50%',background:searchOpen?A.blue:A.inputBg,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:searchOpen?'#fff':A.label3}}>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10.5 10.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
            <button onClick={()=>setScreen('settings')} style={{width:30,height:30,borderRadius:'50%',background:A.inputBg,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:A.label3}}>
              <svg width="15" height="15" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8.5 1v2M8.5 14v2M1 8.5h2M14 8.5h2M3.05 3.05l1.42 1.42M12.53 12.53l1.42 1.42M12.53 3.05l-1.42 1.42M4.47 12.53l-1.42 1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
          {searchOpen&&(
            <div ref={searchRef} style={{position:'absolute',top:54,right:0,width:380,background:A.cardBg,border:`1px solid ${A.sep}`,borderRadius:A.r,boxShadow:A.shadowLg,zIndex:200,overflow:'hidden'}}>
              <div style={{padding:'10px 14px',borderBottom:`1px solid ${A.sep}`}}>
                <Inp value={globalSearch} onChange={e=>setGlobalSearch(e.target.value)} placeholder="Search notes, contacts, recipes, chores…" autoFocus/>
              </div>
              {searchResults&&searchResults.length===0&&globalSearch.length>=2&&(
                <div style={{padding:'18px 16px',fontSize:14,color:A.label4,textAlign:'center'}}>No results</div>
              )}
              {searchResults&&searchResults.length>0&&(()=>{
                const groups={};
                for(const r of searchResults){if(!groups[r.type]) groups[r.type]=[];groups[r.type].push(r);}
                return Object.entries(groups).map(([type,items])=>(
                  <div key={type}>
                    <div style={{padding:'8px 14px 4px',fontSize:11,fontWeight:700,color:A.label4,textTransform:'uppercase',letterSpacing:'.07em'}}>{type}</div>
                    {items.map((item,i)=>(
                      <button key={i} onClick={()=>{setScreen(item.screen);setSearchOpen(false);setGlobalSearch('');}}
                        style={{display:'block',width:'100%',textAlign:'left',padding:'10px 14px',border:'none',background:'none',cursor:'pointer',fontSize:14,color:A.label1,fontWeight:500,borderTop:`1px solid ${A.sep}`}}
                        onMouseEnter={e=>e.currentTarget.style.background=A.inputBg}
                        onMouseLeave={e=>e.currentTarget.style.background='none'}
                      >{item.label}</button>
                    ))}
                  </div>
                ));
              })()}
              {(!searchResults||searchResults.length===0)&&globalSearch.length<2&&(
                <div style={{padding:'18px 16px',fontSize:14,color:A.label4,textAlign:'center'}}>Type at least 2 characters to search</div>
              )}
            </div>
          )}
        </div>
        <div key={screen} className="screen fade-scroll" onScroll={e=>setScrolled(e.currentTarget.scrollTop>12)} style={{flex:1,overflowY:'auto',padding:screen==='calendar'?0:'28px 32px'}}>
          {isKidMode && !KID_SCREENS.has(screen) ? screens['dashboard'] : screens[screen]}
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
    fetch('/api/members').then(r=>r.json()).then(d=>{if(Array.isArray(d))setMembers(d);}).catch(()=>{});
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
        <div key={s} style={{width:s===step?24:8,height:8,borderRadius:4,background:s<=step?A.blue:A.sep,transition:'all .3s'}}/>
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
          {COLORS.map(c=><button key={c} onClick={()=>setMemberColor(c)} style={{width:30,height:30,borderRadius:'50%',border:`3px solid ${memberColor===c?A.label1:'transparent'}`,background:c,cursor:'pointer'}}/>)}
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
          <option value="deepseek">DeepSeek Chat (cost-optimized)</option>
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

/* ── Quick Add FAB (mobile-only floating action button) ─────────────── */
function QuickAddFAB({screen,setGrocery,setChores,toastAdd,isAdmin}){
  const [open,setOpen]=useState(false);
  const [type,setType]=useState(null);
  const [input,setInput]=useState('');
  const fabRef=useRef();

  // Non-admins can't create chores; if on chores screen default to grocery for them
  const defaultType=screen==='grocery'?'grocery':screen==='chores'&&isAdmin?'chore':null;
  const activeType=type||defaultType;

  const close=useCallback(()=>{setOpen(false);setType(null);setInput('');},[]);
  useEffect(()=>{close();},[screen]);

  const submit=async()=>{
    if(!input.trim()||!activeType) return;
    try{
      if(activeType==='grocery'){
        const item=await api.post('/api/grocery',{name:input.trim()});
        setGrocery(p=>[...p,item]);
        toastAdd(`${input.trim()} added`);
      } else {
        const item=await api.post('/api/chores',{name:input.trim(),recurrence:'Weekly',start:localDate(),points:1});
        if(item.id) setChores(p=>[...p,item]);
        toastAdd(`${input.trim()} added`);
      }
      close();
    }catch{toastAdd('Failed to add','red');}
  };

  return(
    <>
      <button onClick={()=>setOpen(true)}
        style={{position:'fixed',bottom:'calc(80px + max(12px, env(safe-area-inset-bottom)))',right:20,width:50,height:50,borderRadius:'50%',background:A.blue,color:'#fff',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:`0 4px 16px rgba(0,122,255,0.40)`,zIndex:49,transition:'transform .12s,box-shadow .12s'}}
        onMouseDown={e=>e.currentTarget.style.transform='scale(.94)'}
        onMouseUp={e=>e.currentTarget.style.transform='scale(1)'}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></svg>
      </button>
      {open&&(
        <>
          <div onClick={close} style={{position:'fixed',inset:0,zIndex:200,background:'rgba(0,0,0,0.18)',animation:'fadeIn .15s'}}/>
          <div style={{position:'fixed',bottom:0,left:0,right:0,zIndex:201,background:A.cardBg,borderRadius:'20px 20px 0 0',padding:'16px 20px',paddingBottom:`calc(20px + max(16px, env(safe-area-inset-bottom)))`,boxShadow:`0 -4px 24px rgba(0,0,0,0.14)`}}>
            <div style={{width:36,height:4,borderRadius:2,background:A.sep,margin:'0 auto 16px'}}/>
            <div style={{fontSize:17,fontWeight:700,marginBottom:14,color:A.label1}}>Quick Add</div>
            {!activeType&&(
              <div style={{display:'flex',gap:10,marginBottom:4}}>
                <button onClick={()=>setType('grocery')} style={{flex:1,padding:'13px',borderRadius:A.r,background:A.greenFill,color:A.green,fontWeight:600,border:'none',cursor:'pointer',fontSize:14}}>Grocery Item</button>
                {isAdmin&&<button onClick={()=>setType('chore')} style={{flex:1,padding:'13px',borderRadius:A.r,background:A.amberFill,color:A.amber,fontWeight:600,border:'none',cursor:'pointer',fontSize:14}}>Chore</button>}
              </div>
            )}
            {activeType&&(
              <div style={{display:'flex',gap:8}}>
                <Inp value={input} onChange={e=>setInput(e.target.value)}
                  placeholder={activeType==='grocery'?'Item name…':'Chore name…'}
                  onKeyDown={e=>e.key==='Enter'&&submit()}
                  autoFocus/>
                <Btn onClick={submit}>Add</Btn>
              </div>
            )}
            {activeType&&type&&<button onClick={()=>setType(null)} style={{marginTop:10,fontSize:13,color:A.label4,background:'none',border:'none',cursor:'pointer'}}>Back</button>}
          </div>
        </>
      )}
    </>
  );
}

function App(){
  const [auth,setAuth]=useState('');
  const [kiosk,setKiosk]=useState(false);
  const [authChecked,setAuthChecked]=useState(false);
  const [currentMember,setCurrentMember]=useState(null);
  const [darkMode,setDarkMode]=useState(()=>localStorage.getItem('kith_dark')||'System');
  useEffect(()=>{
    const apply=()=>{
      const sysDark=window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark=darkMode==='Dark'||(darkMode==='System'&&sysDark);
      if(isDark) document.documentElement.setAttribute('data-dark','true');
      else document.documentElement.removeAttribute('data-dark');
    };
    apply();
    const mq=window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change',apply);
    return ()=>mq.removeEventListener('change',apply);
  },[darkMode]);
  const handleDarkMode=v=>{setDarkMode(v);localStorage.setItem('kith_dark',v);};
  const [mode,setMode]=useState(()=>localStorage.getItem('kith_mode')||'manage');
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
  const [packages,setPackages]=useState([]);
  const [messages,setMessages]=useState([]);
  const [recipes,setRecipes]=useState([]);
  const [bills,setBills]=useState([]);
  const [payments,setPayments]=useState([]);
  const [vehicles,setVehicles]=useState([]);
  const [budget,setBudget]=useState({categories:[],entries:[]});
  const [appliances,setAppliances]=useState([]);
  const [consumables,setConsumables]=useState([]);
  const [maintenanceItems,setMaintenanceItems]=useState([]);
  const [pets,setPets]=useState([]);
  const [contacts,setContacts]=useState([]);
  const [subscriptions,setSubscriptions]=useState([]);
  const [projects,setProjects]=useState([]);
  const [pantry,setPantry]=useState([]);
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
      setWizardDone(s?.wizard_completed==='1');
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
      api.get('/api/packages'),
      api.get('/api/messages'),
      api.get('/api/recipes'),
      api.get('/api/bills'),
      api.get('/api/vehicles'),
      api.get('/api/home/appliances'),
      api.get('/api/home/consumables'),
      api.get('/api/home/maintenance'),
      api.get('/api/pets'),
      api.get('/api/contacts'),
      api.get('/api/budget'),
      api.get('/api/subscriptions'),
      api.get('/api/projects'),
      api.get('/api/pantry'),
    ]).then(([ev,ch,gr,ml,ics,inb,cd,mb,ph,st,gl,nt,pl,qa,bm,pk,ms,rc,bl,veh,appl,cons,maint,petsData,contsData,bdg,subs,proj,pntr])=>{
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
      if(pk.status==='fulfilled'&&Array.isArray(pk.value)) setPackages(pk.value);
      if(ms.status==='fulfilled'&&Array.isArray(ms.value)) setMessages(ms.value);
      if(rc.status==='fulfilled'&&Array.isArray(rc.value)) setRecipes(rc.value);
      if(bl.status==='fulfilled'&&bl.value?.bills){setBills(bl.value.bills);setPayments(bl.value.payments||[]);}
      if(veh.status==='fulfilled'&&Array.isArray(veh.value)) setVehicles(veh.value);
      if(appl.status==='fulfilled'&&Array.isArray(appl.value)) setAppliances(appl.value);
      if(cons.status==='fulfilled'&&Array.isArray(cons.value)) setConsumables(cons.value);
      if(maint.status==='fulfilled'&&Array.isArray(maint.value)) setMaintenanceItems(maint.value);
      if(petsData.status==='fulfilled'&&Array.isArray(petsData.value)) setPets(petsData.value);
      if(contsData.status==='fulfilled'&&Array.isArray(contsData.value)) setContacts(contsData.value);
      if(bdg.status==='fulfilled'&&bdg.value?.categories) setBudget(bdg.value);
      if(subs.status==='fulfilled'&&Array.isArray(subs.value)) setSubscriptions(subs.value);
      if(proj.status==='fulfilled'&&Array.isArray(proj.value)) setProjects(proj.value);
      if(pntr.status==='fulfilled'&&Array.isArray(pntr.value)) setPantry(pntr.value);
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
        api.get('/api/messages'),
        api.get('/api/packages'),
      ]).then(([ev,ch,gr,cd,inb,ml,mb,ph,ms,pk])=>{
        if(ev.status==='fulfilled'&&Array.isArray(ev.value)) setEvents(ev.value);
        if(ch.status==='fulfilled'&&Array.isArray(ch.value)) setChores(ch.value);
        if(gr.status==='fulfilled'&&Array.isArray(gr.value)) setGrocery(gr.value);
        if(cd.status==='fulfilled'&&Array.isArray(cd.value)) setCountdowns(cd.value);
        if(inb.status==='fulfilled'&&Array.isArray(inb.value?.pending)) setInboxCount(inb.value.pending.length);
        if(ml.status==='fulfilled'&&Array.isArray(ml.value)) setMeals(ml.value);
        if(mb.status==='fulfilled'&&Array.isArray(mb.value)) setMembers(mb.value);
        if(ph.status==='fulfilled'&&Array.isArray(ph.value)) setPhotos(ph.value);
        if(ms.status==='fulfilled'&&Array.isArray(ms.value)) setMessages(ms.value);
        if(pk.status==='fulfilled'&&Array.isArray(pk.value)) setPackages(pk.value);
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

  const goDisplay=()=>{localStorage.setItem('kith_mode','display');setMode('display');};
  const goManage=()=>{localStorage.setItem('kith_mode','manage');setMode('manage');};
  return mode==='display'
    ?<DisplayMode onManage={goManage} events={events} chores={chores} setChores={setChores} meals={meals} grocery={grocery} setGrocery={setGrocery} countdowns={countdowns} photos={photos} clockFormat={clockFormat} weather={weather} nightModeStart={nightModeStart} nightModeEnd={nightModeEnd} goals={goals} notes={notes} polls={polls} rotationMs={rotationMs} wifiQrData={wifiQrData} quickActions={quickActions} members={members} packages={packages} setPackages={setPackages} messages={messages} setMessages={setMessages} appliances={appliances} consumables={consumables} maintenanceItems={maintenanceItems} pets={pets} subscriptions={subscriptions} pantry={pantry} projects={projects}/>
    :<ManageMode onDisplay={goDisplay} onLogout={handleLogout} events={events} setEvents={setEvents} chores={chores} setChores={setChores} grocery={grocery} setGrocery={setGrocery} meals={meals} setMeals={setMeals} icsSources={icsSources} setIcsSources={setIcsSources} inboxCount={inboxCount} setInboxCount={setInboxCount} countdowns={countdowns} setCountdowns={setCountdowns} members={members} setMembers={setMembers} photos={photos} setPhotos={setPhotos} clockFormat={clockFormat} setClockFormat={setClockFormat} weather={weather} nightModeStart={nightModeStart} setNightModeStart={setNightModeStart} nightModeEnd={nightModeEnd} setNightModeEnd={setNightModeEnd} setRefreshMs={setRefreshMs} parseRefreshMs={parseRefreshMs} goals={goals} setGoals={setGoals} notes={notes} setNotes={setNotes} polls={polls} setPolls={setPolls} bookmarks={bookmarks} setBookmarks={setBookmarks} quickActions={quickActions} setQuickActions={setQuickActions} setRotationMs={setRotationMs} setWifiQrData={setWifiQrData} darkMode={darkMode} onDarkMode={handleDarkMode} packages={packages} setPackages={setPackages} messages={messages} setMessages={setMessages} recipes={recipes} setRecipes={setRecipes} bills={bills} setBills={setBills} payments={payments} setPayments={setPayments} vehicles={vehicles} setVehicles={setVehicles} appliances={appliances} setAppliances={setAppliances} consumables={consumables} setConsumables={setConsumables} pets={pets} setPets={setPets} contacts={contacts} setContacts={setContacts} maintenanceItems={maintenanceItems} setMaintenanceItems={setMaintenanceItems} budget={budget} setBudget={setBudget} subscriptions={subscriptions} setSubscriptions={setSubscriptions} projects={projects} setProjects={setProjects} pantry={pantry} setPantry={setPantry} isAdmin={!!auth&&!currentMember&&!kiosk}/>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
