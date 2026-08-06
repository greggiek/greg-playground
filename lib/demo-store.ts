export type PunchAction = 'clock_in' | 'clock_out';
export type DemoEmployee = { id: string; firstName: string; lastName: string; pin: string; location: string; jobTitle: string };
export type DemoPunch = { id: string; employeeId: string; action: PunchAction; occurredAt: string; location: string };

export const demoEmployees: DemoEmployee[] = [
  { id: 'emp-greg', firstName: 'Greg', lastName: 'Kleczka', pin: '1234', location: 'Amityville', jobTitle: 'Director of Operations' },
  { id: 'emp-jay', firstName: 'Jay', lastName: 'Gambino', pin: '2468', location: 'Amityville', jobTitle: 'Branch Manager' },
  { id: 'emp-jeff', firstName: 'Jeff', lastName: 'Demo', pin: '7300', location: 'Windham', jobTitle: 'Branch Manager' }
];

const punches: DemoPunch[] = [];

export function findDemoEmployee(pin: string) { return demoEmployees.find((e) => e.pin === pin); }
export function currentDemoStatus(employeeId: string) {
  const latest = punches.filter((p) => p.employeeId === employeeId).sort((a,b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  return latest?.action === 'clock_in' ? 'clocked_in' : 'clocked_out';
}
export function addDemoPunch(employeeId: string, action: PunchAction, location: string) {
  const punch = { id: crypto.randomUUID(), employeeId, action, occurredAt: new Date().toISOString(), location };
  punches.push(punch); return punch;
}
export function getDemoRows() {
  return demoEmployees.map((employee) => {
    const events = punches.filter((p) => p.employeeId === employee.id).sort((a,b) => b.occurredAt.localeCompare(a.occurredAt));
    return { employee, status: events[0]?.action === 'clock_in' ? 'clocked_in' : 'clocked_out', latest: events[0] ?? null, events };
  });
}
