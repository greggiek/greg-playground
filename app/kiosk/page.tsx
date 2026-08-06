'use client';
import { useEffect, useState } from 'react';

type EmployeeState = { employeeId: string; firstName: string; status: 'clocked_in' | 'clocked_out' };

export default function KioskPage() {
  const [pin, setPin] = useState(''); const [now, setNow] = useState(new Date());
  const [employee, setEmployee] = useState<EmployeeState | null>(null); const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false); const [success, setSuccess] = useState<{title:string;time:string}|null>(null);
  const kioskToken = process.env.NEXT_PUBLIC_KIOSK_TOKEN || '';
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!success) return; const timer = setTimeout(reset, 3000); return () => clearTimeout(timer); }, [success]);
  function reset(){ setPin(''); setEmployee(null); setMessage(''); setSuccess(null); setBusy(false); }
  async function send(action: 'identify'|'clock_in'|'clock_out') {
    setBusy(true); setMessage('');
    try {
      const res = await fetch('/api/punch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin,action,employeeId:employee?.employeeId,kioskToken})});
      const data = await res.json();
      if(!res.ok) throw new Error(data.message || 'Unable to continue.');
      if(action==='identify') setEmployee(data);
      else setSuccess({title: action==='clock_in'?'CLOCKED IN':'CLOCKED OUT',time:new Date(data.occurredAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})});
    } catch(error){ setMessage(error instanceof Error ? error.message : 'Unable to continue.'); }
    finally { setBusy(false); }
  }
  function digit(value:string){ if(!employee && pin.length<4) setPin(pin+value); }
  if(success) return <main className="shell"><section className="card success"><div className="check">✓</div><h1>{success.title}</h1><div className="successTime">{success.time}</div><p>Have a good {success.title==='CLOCKED IN'?'shift':'day'}.</p></section></main>;
  return <main className="shell"><section className="card kioskCard">
    <div className="topline"><div><div className="brand">BM TIME</div><div className="location">{process.env.NEXT_PUBLIC_KIOSK_LOCATION || 'Unregistered location'}</div></div><div className="date">{now.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})}</div></div>
    <div className="clock">{now.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</div>
    {!employee ? <>
      <h1 className="prompt">Enter Employee PIN</h1><div className="pinDots">{[0,1,2,3].map(i=><span key={i} className={i<pin.length?'filled':''}/>)}</div>
      <div className="keypad">{['1','2','3','4','5','6','7','8','9'].map(n=><button key={n} onClick={()=>digit(n)}>{n}</button>)}<button className="quiet" onClick={()=>setPin('')}>Clear</button><button onClick={()=>digit('0')}>0</button><button className="quiet" onClick={()=>setPin(pin.slice(0,-1))}>⌫</button></div>
      <button className="primary" disabled={pin.length!==4||busy} onClick={()=>send('identify')}>{busy?'Checking…':'Continue'}</button>
    </> : <div className="employeePanel"><p className="welcome">Welcome, <strong>{employee.firstName}</strong></p><div className="status">Status: <strong>{employee.status==='clocked_in'?'Clocked In':'Clocked Out'}</strong></div><button className={employee.status==='clocked_in'?'danger':'primary'} disabled={busy} onClick={()=>send(employee.status==='clocked_in'?'clock_out':'clock_in')}>{busy?'Saving…':employee.status==='clocked_in'?'Clock Out':'Clock In'}</button><button className="cancel" onClick={reset}>Cancel</button></div>}
    {message && <div className="error">{message}</div>}<div className="demoNote">{process.env.NEXT_PUBLIC_DEMO_MODE==='true'?'Demo PINs: 1234, 2468, 7300':''}</div>
  </section></main>;
}
