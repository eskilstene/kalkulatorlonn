'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from './lib/supabase'

const RED_DAYS = new Set([
  "2025-01-01","2025-04-17","2025-04-18","2025-04-20","2025-04-21",
  "2025-05-01","2025-05-17","2025-05-29","2025-06-08","2025-06-09",
  "2025-12-25","2025-12-26",
  "2026-01-01","2026-04-02","2026-04-03","2026-04-05","2026-04-06",
  "2026-05-01","2026-05-14","2026-05-17","2026-05-24","2026-05-25",
  "2026-12-25","2026-12-26"
])

const MONTH_NAMES = ["Januar","Februar","Mars","April","Mai","Juni","Juli","August","September","Oktober","November","Desember"]
const DAY_NAMES = ["Man","Tir","Ons","Tor","Fre","Lør","Søn"]

const C = {
  bg0:"#0f1117", bg1:"#181c27", bg2:"#1f2433", bg3:"#272d3d",
  border:"#2e3547", border2:"#3d4560",
  text:"#e8eaf0", muted:"#8891aa", hint:"#545d73",
  accent:"#5b8af5", accentBg:"#1a2340", accentText:"#93b4ff",
  red:"#f56565", redBg:"#2d1a1a", redText:"#fc9090",
  green:"#48bb78", greenBg:"#1a2d22", greenText:"#7ee8a2",
  amber:"#f6ad55", amberBg:"#2d2010", amberText:"#fcd28a",
  purple:"#b794f4", purpleBg:"#211a30", purpleText:"#d6b9ff",
}

const DEFAULT_SETTINGS = {
  baseWage: 200,
  rates: {
    eve:     { val:25,  type:"pct" },
    night:   { val:50,  type:"pct" },
    weekend: { val:50,  type:"pct" },
    red:     { val:100, type:"pct" },
    overtime:{ val:50,  type:"pct" },
  },
  overtimeEnabled: true,
  weeklyLimit: 35,
  taxEnabled: false,
  taxPct: 22,
}

const RATE_LABELS = {
  eve:     "Kveldsarbeid (17:00–21:00)",
  night:   "Nattarbeid (21:00–06:00)",
  weekend: "Lørdag / søndag",
  red:     "Røde dager / helligdager",
}

const TAG_STYLES = {
  red:      { bg:C.redBg,    color:C.redText    },
  night:    { bg:C.purpleBg, color:C.purpleText },
  eve:      { bg:C.amberBg,  color:C.amberText  },
  weekend:  { bg:C.greenBg,  color:C.greenText  },
  overtime: { bg:"#1e1a10",  color:"#f6c744"    },
}
const TAG_LABELS = { red:"Rød dag", night:"Natt", eve:"Kveld", weekend:"Helg", overtime:"Overtid" }

function pad(n){ return String(n).padStart(2,"0") }
function dateKey(y,m,d){ return `${y}-${pad(m+1)}-${pad(d)}` }
function isRed(key){ return RED_DAYS.has(key) }
function isWeekend(y,m,d){ const day=new Date(y,m,d).getDay(); return day===0||day===6 }
function timeToMins(t){ const[h,m]=t.split(":").map(Number); return h*60+m }
function hoursInRange(a,b,sh,eh){ const s=sh*60,e=eh*60,x=Math.max(a,s),y=Math.min(b,e); return y>x?(y-x)/60:0 }

function getWeekKey(dateStr){
  const[y,m,d]=dateStr.split("-").map(Number)
  const date=new Date(y,m-1,d)
  const day=date.getDay()===0?7:date.getDay()
  const mon=new Date(date); mon.setDate(d-day+1)
  return `${mon.getFullYear()}-${pad(mon.getMonth()+1)}-${pad(mon.getDate())}`
}

function calcAllShifts(shifts, settings){
  const base=parseFloat(settings.baseWage)||0
  const eff=(cat)=>{ const r=settings.rates[cat]; return r.type==="pct"?base*(r.val/100):parseFloat(r.val)||0 }
  const limit=parseFloat(settings.weeklyLimit)||0
  const otEnabled=settings.overtimeEnabled
  const otAdd=eff("overtime")
  const weekHours={}
  const results={}

  Object.keys(shifts).sort().forEach(key=>{
    const shift=shifts[key]
    const fromM=timeToMins(shift.from)
    let toM=timeToMins(shift.to)
    if(toM<=fromM) toM+=24*60
    const[y,mm,d]=key.split("-").map(Number)
    const red=isRed(key), wknd=isWeekend(y,mm-1,d)
    const hours=(toM-fromM)/60
    const wk=getWeekKey(key)
    if(!weekHours[wk]) weekHours[wk]=0
    const prevWeekH=weekHours[wk]
    const normalH=(otEnabled&&limit>0)?Math.max(0,Math.min(hours,limit-prevWeekH)):hours
    const overtimeHours=hours-normalH
    const tags=new Set()
    let total=0

    const calcSegment=(segH,isOT)=>{
      if(segH<=0) return 0
      const otBonus=isOT?otAdd:0
      if(isOT) tags.add("overtime")
      if(red){ tags.add("red"); return segH*(base+eff("red")+otBonus) }
      else if(wknd){ tags.add("weekend"); return segH*(base+eff("weekend")+otBonus) }
      else {
        let t=0
        const ratio=segH/hours
        const hDay=hoursInRange(fromM,toM,6,17)*ratio
        const hEve=hoursInRange(fromM,toM,17,21)*ratio
        const hNight=(hoursInRange(fromM,toM,21,24)+hoursInRange(fromM,toM,0,6))*ratio
        t+=hDay*(base+otBonus)
        if(hEve>0){ tags.add("eve"); t+=hEve*(base+eff("eve")+otBonus) }
        if(hNight>0){ tags.add("night"); t+=hNight*(base+eff("night")+otBonus) }
        return t
      }
    }

    total+=calcSegment(normalH,false)
    total+=calcSegment(overtimeHours,true)
    weekHours[wk]+=hours
    results[key]={ total, tags:[...tags], hours, overtimeHours, weekKey:wk }
  })
  return { results, weekHours }
}

export default function Kalkulator({ user, onSignOut }) {
  const supabase = createClient()
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [shifts, setShifts] = useState({})
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [view, setView] = useState("settings")
  const [modal, setModal] = useState(null)
  const [mFrom, setMFrom] = useState("08:00")
  const [mTo, setMTo] = useState("16:00")
  const [expandedMonth, setExpandedMonth] = useState(null)
  const [saving, setSaving] = useState(false)

  // Last inn data fra Supabase
  useEffect(()=>{
    if(!user) return
    const load = async () => {
      const { data: settingsData } = await supabase
        .from('settings')
        .select('data')
        .eq('user_id', user.id)
        .single()
      if(settingsData) {
        setSettings({ ...DEFAULT_SETTINGS, ...settingsData.data, rates: { ...DEFAULT_SETTINGS.rates, ...(settingsData.data.rates||{}) } })
      }

      const { data: shiftsData } = await supabase
        .from('shifts')
        .select('*')
        .eq('user_id', user.id)
      if(shiftsData) {
        const obj = {}
        shiftsData.forEach(s => { obj[s.date] = { from: s.from_time, to: s.to_time } })
        setShifts(obj)
      }
    }
    load()
  }, [user])

  // Lagre innstillinger
  const saveSettings = async (newSettings) => {
    setSettings(newSettings)
    await supabase.from('settings').upsert({ user_id: user.id, data: newSettings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  }

  const updateRate = (key, field, value) => {
    const newSettings = { ...settings, rates: { ...settings.rates, [key]: { ...settings.rates[key], [field]: value } } }
    saveSettings(newSettings)
  }

  const openModal = (key) => {
    if(shifts[key]){ setMFrom(shifts[key].from); setMTo(shifts[key].to) }
    else { setMFrom("08:00"); setMTo("16:00") }
    setModal(key)
  }

  const confirmShift = async () => {
    if(!mFrom||!mTo) return
    setSaving(true)
    const newShifts = { ...shifts, [modal]: { from: mFrom, to: mTo } }
    setShifts(newShifts)
    await supabase.from('shifts').upsert({ user_id: user.id, date: modal, from_time: mFrom, to_time: mTo }, { onConflict: 'user_id,date' })
    setSaving(false)
    setModal(null)
  }

  const deleteShift = async (key) => {
    const newShifts = { ...shifts }
    delete newShifts[key]
    setShifts(newShifts)
    await supabase.from('shifts').delete().eq('user_id', user.id).eq('date', key)
  }

  const firstDay = new Date(year,month,1).getDay()
  const offset = firstDay===0?6:firstDay-1
  const daysInMonth = new Date(year,month+1,0).getDate()

  const buildMonthSummaries = () => {
    const { results } = calcAllShifts(shifts, settings)
    const byMonth = {}
    Object.entries(shifts).forEach(([k,sh])=>{
      const ym=k.slice(0,7)
      if(!byMonth[ym]) byMonth[ym]=[]
      byMonth[ym].push({key:k,sh})
    })
    return Object.entries(byMonth).sort(([a],[b])=>a.localeCompare(b)).map(([ym,entries])=>{
      let gross=0, totalHours=0, totalOT=0
      const rows=entries.sort((a,b)=>a.key.localeCompare(b.key)).map(({key,sh})=>{
        const r=results[key]
        gross+=r.total; totalHours+=r.hours; totalOT+=r.overtimeHours
        return {key,sh,...r}
      })
      const net=settings.taxEnabled?gross*(1-(parseFloat(settings.taxPct)||0)/100):null
      const [y,m]=ym.split("-").map(Number)
      return {ym,label:`${MONTH_NAMES[m-1]} ${y}`,rows,gross,net,totalHours,totalOT}
    })
  }

  const inp = { width:"100%", padding:"8px 10px", border:`0.5px solid ${C.border2}`, borderRadius:8, fontSize:14, background:C.bg2, color:C.text, outline:"none" }
  const cardStyle = { background:C.bg1, border:`0.5px solid ${C.border}`, borderRadius:12, padding:"1.25rem", marginBottom:"1rem" }
  const Tab = ({id,label}) => (
    <button onClick={()=>setView(id)} style={{ flex:1, padding:"9px 4px", borderRadius:8, border:view===id?`1px solid ${C.accent}`:`0.5px solid ${C.border}`, background:view===id?C.accentBg:C.bg1, fontWeight:view===id?500:400, fontSize:13, color:view===id?C.accentText:C.muted, cursor:"pointer" }}>
      {label}
    </button>
  )
  const Badge = ({t}) => (
    <span style={{ fontSize:11, padding:"2px 7px", borderRadius:20, background:TAG_STYLES[t].bg, color:TAG_STYLES[t].color, marginLeft:3 }}>{TAG_LABELS[t]}</span>
  )

  return (
    <div style={{ background:C.bg0, minHeight:"100vh", padding:"1.5rem 1rem", fontFamily:"sans-serif", color:C.text }}>
      <div style={{ maxWidth:640, margin:"0 auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.5rem" }}>
          <h2 style={{ fontSize:18, fontWeight:500, color:C.text, margin:0 }}>Lønnskalkulator</h2>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:13, color:C.muted }}>{user.email}</span>
            <button onClick={onSignOut} style={{ padding:"6px 12px", background:C.bg2, border:`0.5px solid ${C.border2}`, borderRadius:8, color:C.muted, fontSize:13, cursor:"pointer" }}>Logg ut</button>
          </div>
        </div>

        <div style={{ display:"flex", gap:6, marginBottom:"1.5rem" }}>
          <Tab id="settings" label="Innstillinger" />
          <Tab id="shifts"   label="Vakter" />
          <Tab id="result"   label="Resultat" />
        </div>

        {view==="settings" && <>
          <div style={cardStyle}>
            <div style={{ fontSize:15, fontWeight:500, marginBottom:12, color:C.text }}>Grunnlønn</div>
            <label style={{ fontSize:13, color:C.muted, display:"block", marginBottom:4 }}>Timelønn (kr/t)</label>
            <input type="number" value={settings.baseWage} min={0} step={1} style={{...inp, width:160}}
              onChange={e=>saveSettings({...settings, baseWage:e.target.value})} />
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize:15, fontWeight:500, marginBottom:12, color:C.text }}>Tilleggssatser</div>
            {Object.entries(RATE_LABELS).map(([key,label])=>{
              const r=settings.rates[key]
              const base=parseFloat(settings.baseWage)||0
              const preview=r.type==="pct"?`+${Math.round(base*(parseFloat(r.val)||0)/100)} kr/t`:`+${r.val} kr/t`
              return (
                <div key={key} style={{ marginBottom:14 }}>
                  <label style={{ fontSize:13, color:C.muted, display:"block", marginBottom:6 }}>{label}</label>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 100px 80px", gap:8, alignItems:"center" }}>
                    <input type="number" value={r.val} min={0} step={1} style={inp} onChange={e=>updateRate(key,"val",e.target.value)} />
                    <select value={r.type} onChange={e=>updateRate(key,"type",e.target.value)} style={{...inp, cursor:"pointer"}}>
                      <option value="pct">%</option>
                      <option value="kr">kr/t</option>
                    </select>
                    <span style={{ fontSize:12, color:C.hint }}>{preview}</span>
                  </div>
                </div>
              )
            })}
          </div>

          <div style={cardStyle}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
              <div style={{ fontSize:15, fontWeight:500, color:C.text }}>Overtid</div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <input type="checkbox" id="ot" checked={settings.overtimeEnabled}
                  onChange={e=>saveSettings({...settings, overtimeEnabled:e.target.checked})}
                  style={{ width:"auto", accentColor:C.accent }} />
                <label htmlFor="ot" style={{ fontSize:13, color:C.muted, cursor:"pointer" }}>Aktiver</label>
              </div>
            </div>
            {settings.overtimeEnabled && <>
              <div style={{ marginBottom:14 }}>
                <label style={{ fontSize:13, color:C.muted, display:"block", marginBottom:6 }}>Timegrense per uke</label>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <input type="number" value={settings.weeklyLimit} min={1} max={60} step={1}
                    style={{...inp, width:100}} onChange={e=>saveSettings({...settings, weeklyLimit:e.target.value})} />
                  <span style={{ fontSize:13, color:C.muted }}>timer/uke</span>
                </div>
              </div>
              <div>
                <label style={{ fontSize:13, color:C.muted, display:"block", marginBottom:6 }}>Overtidstillegg</label>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 100px 80px", gap:8, alignItems:"center" }}>
                  <input type="number" value={settings.rates.overtime.val} min={0} step={1} style={inp}
                    onChange={e=>updateRate("overtime","val",e.target.value)} />
                  <select value={settings.rates.overtime.type} onChange={e=>updateRate("overtime","type",e.target.value)} style={{...inp, cursor:"pointer"}}>
                    <option value="pct">%</option>
                    <option value="kr">kr/t</option>
                  </select>
                  <span style={{ fontSize:12, color:C.hint }}>
                    {settings.rates.overtime.type==="pct"
                      ? `+${Math.round((parseFloat(settings.baseWage)||0)*(parseFloat(settings.rates.overtime.val)||0)/100)} kr/t`
                      : `+${settings.rates.overtime.val} kr/t`}
                  </span>
                </div>
              </div>
            </>}
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize:15, fontWeight:500, marginBottom:12, color:C.text }}>Skattetrekk</div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <input type="checkbox" id="tax" checked={settings.taxEnabled}
                onChange={e=>saveSettings({...settings, taxEnabled:e.target.checked})}
                style={{ width:"auto", accentColor:C.accent }} />
              <label htmlFor="tax" style={{ fontSize:14, color:C.text, margin:0, cursor:"pointer" }}>Legg til skattetrekk</label>
            </div>
            {settings.taxEnabled && (
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <input type="number" value={settings.taxPct} min={0} max={100} step={1}
                  style={{...inp, width:100}} onChange={e=>saveSettings({...settings, taxPct:e.target.value})} />
                <span style={{ fontSize:14, color:C.muted }}>%</span>
              </div>
            )}
          </div>

          <button onClick={()=>setView("shifts")} style={{ width:"100%", padding:11, background:C.accentBg, border:`0.5px solid ${C.accent}`, borderRadius:8, fontSize:14, fontWeight:500, color:C.accentText, cursor:"pointer" }}>
            Gå til vakter →
          </button>
        </>}

        {view==="shifts" && <>
          <div style={cardStyle}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <button onClick={()=>setMonth(m=>{ if(m===0){setYear(y=>y-1);return 11;} return m-1; })}
                style={{ background:C.bg2, border:`0.5px solid ${C.border2}`, borderRadius:8, padding:"5px 14px", cursor:"pointer", fontSize:15, color:C.text }}>‹</button>
              <span style={{ fontWeight:500, fontSize:15, color:C.text }}>{MONTH_NAMES[month]} {year}</span>
              <button onClick={()=>setMonth(m=>{ if(m===11){setYear(y=>y+1);return 0;} return m+1; })}
                style={{ background:C.bg2, border:`0.5px solid ${C.border2}`, borderRadius:8, padding:"5px 14px", cursor:"pointer", fontSize:15, color:C.text }}>›</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:6 }}>
              {DAY_NAMES.map(d=><div key={d} style={{ textAlign:"center", fontSize:11, color:C.hint, padding:"3px 0" }}>{d}</div>)}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3 }}>
              {Array.from({length:offset}).map((_,i)=><div key={"e"+i} />)}
              {Array.from({length:daysInMonth},(_,i)=>i+1).map(d=>{
                const key=dateKey(year,month,d)
                const red=isRed(key), wknd=isWeekend(year,month,d), has=!!shifts[key]
                let bg=C.bg2, border=`0.5px solid ${C.border}`, color=C.text
                if(has&&red){ bg=C.redBg; border=`1.5px solid ${C.red}`; color=C.redText }
                else if(has){ bg=C.accentBg; border=`1.5px solid ${C.accent}`; color=C.accentText }
                else if(red){ color=C.red; border=`0.5px solid ${C.redBg}` }
                else if(wknd){ color=C.muted }
                return (
                  <div key={d} onClick={()=>openModal(key)}
                    style={{ aspectRatio:"1", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontSize:13, borderRadius:7, cursor:"pointer", background:bg, border, color, fontWeight:has||red?500:400, position:"relative", userSelect:"none" }}>
                    {d}
                    {has&&<div style={{ width:4, height:4, borderRadius:"50%", background:"currentColor", position:"absolute", bottom:3 }} />}
                  </div>
                )
              })}
            </div>
          </div>

          {Object.keys(shifts).length>0 && (
            <div style={cardStyle}>
              <div style={{ fontSize:15, fontWeight:500, marginBottom:12, color:C.text }}>Registrerte vakter ({Object.keys(shifts).length})</div>
              <div style={{ maxHeight:220, overflowY:"auto" }}>
                {(()=>{
                  const {results}=calcAllShifts(shifts,settings)
                  return Object.keys(shifts).sort().map(k=>{
                    const[,mm,d]=k.split("-")
                    const {tags,hours}=results[k]
                    return (
                      <div key={k} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:`0.5px solid ${C.border}`, fontSize:13 }}>
                        <span style={{ color:C.text }}>{d}.{mm} &nbsp; {shifts[k].from}–{shifts[k].to}
                          &nbsp;<span style={{ color:C.hint }}>{hours.toFixed(1)}t</span>
                          {tags.map(t=><Badge key={t} t={t} />)}
                        </span>
                        <button onClick={()=>deleteShift(k)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:17, padding:"0 4px", lineHeight:1 }}>×</button>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          )}

          <button onClick={()=>setView("result")} style={{ width:"100%", padding:11, background:C.accentBg, border:`0.5px solid ${C.accent}`, borderRadius:8, fontSize:14, fontWeight:500, color:C.accentText, cursor:"pointer" }}>
            Se resultat →
          </button>
        </>}

        {view==="result" && (()=>{
          const summaries=buildMonthSummaries()
          if(!summaries.length) return (
            <div style={{ color:C.muted, fontSize:14, padding:"3rem 0", textAlign:"center" }}>Ingen vakter registrert ennå.</div>
          )
          const totalGross=summaries.reduce((a,s)=>a+s.gross,0)
          const totalNet=settings.taxEnabled?summaries.reduce((a,s)=>a+(s.net??0),0):null
          return <>
            <div style={{ display:"grid", gridTemplateColumns:totalNet!==null?"1fr 1fr":"1fr", gap:10, marginBottom:"1rem" }}>
              <div style={{ background:C.bg2, borderRadius:8, padding:"1rem", textAlign:"center" }}>
                <div style={{ fontSize:12, color:C.muted, marginBottom:4 }}>Total brutto</div>
                <div style={{ fontSize:22, fontWeight:500, color:C.text }}>{Math.round(totalGross).toLocaleString("no")} kr</div>
              </div>
              {totalNet!==null && (
                <div style={{ background:C.bg2, borderRadius:8, padding:"1rem", textAlign:"center" }}>
                  <div style={{ fontSize:12, color:C.muted, marginBottom:4 }}>Total netto (est.)</div>
                  <div style={{ fontSize:22, fontWeight:500, color:C.text }}>{Math.round(totalNet).toLocaleString("no")} kr</div>
                </div>
              )}
            </div>
            {summaries.map(({ym,label,rows,gross,net,totalHours,totalOT})=>(
              <div key={ym} style={cardStyle}>
                <div onClick={()=>setExpandedMonth(expandedMonth===ym?null:ym)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}>
                  <div>
                    <span style={{ fontWeight:500, fontSize:15, color:C.text }}>{label}</span>
                    <span style={{ fontSize:12, color:C.muted, marginLeft:10 }}>{rows.length} vakter · {totalHours.toFixed(1)}t</span>
                    {totalOT>0&&<span style={{ fontSize:11, padding:"2px 7px", borderRadius:20, background:"#1e1a10", color:"#f6c744", marginLeft:6 }}>{totalOT.toFixed(1)}t overtid</span>}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:500, fontSize:15, color:C.text }}>{Math.round(gross).toLocaleString("no")} kr</div>
                    {net!==null&&<div style={{ fontSize:12, color:C.muted }}>netto: {Math.round(net).toLocaleString("no")} kr</div>}
                  </div>
                </div>
                {expandedMonth===ym&&(
                  <div style={{ marginTop:12, borderTop:`0.5px solid ${C.border}`, paddingTop:10 }}>
                    {rows.map(r=>{
                      const[,mm,d]=r.key.split("-")
                      return (
                        <div key={r.key} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:`0.5px solid ${C.border}`, fontSize:13 }}>
                          <span style={{ color:C.text }}>{d}.{mm} &nbsp; {r.sh.from}–{r.sh.to}
                            &nbsp;<span style={{ color:C.hint }}>{r.hours.toFixed(1)}t</span>
                            {r.tags.map(t=><Badge key={t} t={t} />)}
                          </span>
                          <span style={{ fontWeight:500, color:C.text }}>{Math.round(r.total).toLocaleString("no")} kr</span>
                        </div>
                      )
                    })}
                    <div style={{ display:"flex", justifyContent:"space-between", paddingTop:10, fontSize:13, color:C.muted, borderTop:`0.5px solid ${C.border}`, marginTop:4 }}>
                      <span>Timer totalt: {totalHours.toFixed(1)}t{totalOT>0?` (${totalOT.toFixed(1)}t overtid)`:""}</span>
                      {net!==null&&<span>Netto: {Math.round(net).toLocaleString("no")} kr</span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </>
        })()}

        {modal&&(
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
            <div style={{ background:C.bg1, borderRadius:12, padding:"1.5rem", width:300, border:`0.5px solid ${C.border2}` }}>
              <div style={{ fontWeight:500, fontSize:15, marginBottom:"1rem", color:C.text }}>
                Vakt {modal.split("-")[2]}.{modal.split("-")[1]}
                {isRed(modal)&&<span style={{ fontSize:11, padding:"2px 7px", borderRadius:20, background:C.redBg, color:C.redText, marginLeft:8 }}>Rød dag</span>}
              </div>
              <div style={{ marginBottom:12 }}>
                <label style={{ fontSize:13, color:C.muted, display:"block", marginBottom:4 }}>Fra</label>
                <input type="time" value={mFrom} onChange={e=>setMFrom(e.target.value)} style={inp} />
              </div>
              <div style={{ marginBottom:"1rem" }}>
                <label style={{ fontSize:13, color:C.muted, display:"block", marginBottom:4 }}>Til</label>
                <input type="time" value={mTo} onChange={e=>setMTo(e.target.value)} style={inp} />
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>setModal(null)} style={{ flex:1, padding:10, borderRadius:8, cursor:"pointer", fontSize:13, border:`0.5px solid ${C.border2}`, background:C.bg2, color:C.text }}>Avbryt</button>
                <button onClick={confirmShift} disabled={saving} style={{ flex:1, padding:10, borderRadius:8, cursor:"pointer", fontSize:13, border:`0.5px solid ${C.accent}`, background:C.accentBg, color:C.accentText, fontWeight:500 }}>
                  {saving ? "Lagrer..." : "Lagre"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}