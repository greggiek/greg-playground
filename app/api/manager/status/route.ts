import { NextResponse } from 'next/server';
import { getDemoRows } from '@/lib/demo-store';
import { getAdminClient } from '@/lib/supabase-server';
export async function POST(request: Request){
  const { password } = await request.json().catch(()=>({}));
  if(!process.env.MANAGER_PASSWORD || password!==process.env.MANAGER_PASSWORD) return NextResponse.json({message:'Incorrect manager password.'},{status:401});
  if(process.env.NEXT_PUBLIC_DEMO_MODE==='true') return NextResponse.json({rows:getDemoRows().map(r=>({id:r.employee.id,name:`${r.employee.firstName} ${r.employee.lastName}`,location:r.employee.location,jobTitle:r.employee.jobTitle,status:r.status,latest:r.latest?.occurredAt||null}))});
  const supabase=getAdminClient(); if(!supabase) return NextResponse.json({message:'Supabase is not configured.'},{status:503});
  const {data,error}=await supabase.from('employees').select('id,first_name,last_name,locations!employees_primary_location_id_fkey(name),job_titles(name),punch_events(action,occurred_at)').eq('active',true).order('last_name');
  if(error) return NextResponse.json({message:error.message},{status:500});
  const rows=(data||[]).map((e:any)=>{const events=[...(e.punch_events||[])].sort((a:any,b:any)=>b.occurred_at.localeCompare(a.occurred_at));return{id:e.id,name:`${e.first_name} ${e.last_name}`,location:e.locations?.name||'',jobTitle:e.job_titles?.name||'',status:events[0]?.action==='clock_in'?'clocked_in':'clocked_out',latest:events[0]?.occurred_at||null}});
  return NextResponse.json({rows});
}
