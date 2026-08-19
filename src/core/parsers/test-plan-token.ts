export const TOKEN_RE = /\[(?<change>[A-Za-z0-9-]+)-T(?<n>\d+)\]/g;

export interface FoundToken { readonly token: string; readonly change: string; readonly id: string; }

export function caseToken(changeName: string, id: string): string {
  return `[${changeName}-${id}]`;
}

export function findTokens(blob: string): FoundToken[] {
  const out: FoundToken[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(blob)) !== null) {
    out.push({ token: m[0], change: m.groups!.change, id: `T${m.groups!.n}` });
  }
  return out;
}
