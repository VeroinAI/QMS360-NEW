export type HistoricalProject={id:string;name:string;code:string;label:string};

/** Names are resolved against current server-owned Project Master data, never workbook IDs. */
export function historicalProjectCatalogue(projects:{id:string;name:string;code:string}[]):HistoricalProject[]{
  const counts=new Map<string,number>();
  for(const p of projects)counts.set(p.name,(counts.get(p.name)??0)+1);
  const result=projects.map(p=>({...p,label:counts.get(p.name)!>1?`${p.name} (${p.code})`:p.name}));
  if(new Set(result.map(p=>p.label)).size!==result.length)
    throw new Error("Project Master contains ambiguous display names. Ask an administrator to make the project names distinct before loading balances.");
  return result;
}
