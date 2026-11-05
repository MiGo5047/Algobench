"use client";

import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from "recharts";
import {
  Play, Loader2, AlertTriangle, AlertOctagon, CheckCircle2, Terminal, Timer, ListChecks, Plus, Trash2, Zap,
  type LucideIcon,
} from "lucide-react";

type Severity = "high" | "med" | "low";
interface Warning { sev: Severity; title: string; detail: string; line: number }
interface Analysis { warnings: Warning[]; detected: "O(N)" | "O(N log N)" | "O(N²)"; depth: number }
interface EdgeCase { id: number; text: string; done: boolean }

const SAMPLE = `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    cin >> n;
    int sum = 0;
    vector<int> a(n);
    for (int i = 0; i < n; i++) {
        cin >> a[i];
        sum += a[i] * a[i];
    }
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) {
            if (a[i] > a[j]) sum++;
        }
    }
    long long big = 1 << 35;
    cout << sum << endl;
}
`;

const DEFAULT_CASES = [
  "N = 1 (single element)",
  "N = 0 / empty input",
  "Maximum N with maximum values (overflow check)",
  "All elements equal",
  "Negative numbers and zero",
  "Disconnected components in the graph",
  "Array indices stay within bounds (0- vs 1-indexed)",
  "Multiple test cases: reset global state between runs",
];

const SEV: Record<Severity, { icon: LucideIcon; text: string; border: string }> = {
  high: { icon: AlertOctagon, text: "text-red-400", border: "border-l-red-400" },
  med: { icon: AlertTriangle, text: "text-amber-400", border: "border-l-amber-400" },
  low: { icon: AlertTriangle, text: "text-sky-400", border: "border-l-sky-400" },
};
const ORDER: Severity[] = ["high", "med", "low"];
const OPS_PER_SEC = 1e8;

// Mocked analysis: basic regex heuristics on the pasted source.
function analyze(src: string): Analysis {
  const lines = src.split("\n");
  const found: Warning[] = [];
  const seen = new Set<string>();
  const add = (sev: Severity, title: string, detail: string, line: number) => {
    const key = title + line;
    if (!seen.has(key)) { seen.add(key); found.push({ sev, title, detail, line }); }
  };

  if (/\b(cin|cout)\b/.test(src) && !/sync_with_stdio\s*\(\s*(false|0)\s*\)/.test(src)) {
    add("high", "Missing ios_base::sync_with_stdio(false)",
      "cin/cout stay synced with C stdio, which can be 3–10× slower on large inputs. Add sync_with_stdio(false) and cin.tie(nullptr) at the top of main.",
      lines.findIndex((l) => /\bmain\s*\(/.test(l)) + 1);
  }

  lines.forEach((raw, i) => {
    const code = raw.replace(/\/\/.*$/, "");
    const ln = i + 1;
    let m: RegExpMatchArray | null;
    if (/\bendl\b/.test(code)) add("med", "endl flushes the output buffer", "Use '\\n' instead — flushing on every line is a common cause of TLE.", ln);
    if ((m = code.match(/\bint\s+(sum|ans|res|result|total|cnt|prod|fact)\b/)))
      add("high", `Potential int overflow in "${m[1]}"`, "A 32-bit int tops out near 2.1×10⁹. Accumulators over large N usually need long long.", ln);
    if ((m = code.match(/\b1\s*<<\s*(\d+)/)) && Number(m[1]) >= 31)
      add("high", `1 << ${m[1]} overflows int`, "Shifting a 32-bit int by 31 or more is undefined behaviour. Use 1LL << k.", ln);
    if (
      /=/.test(code) && /\b\w+(?:\[\w+\])?\s*\*\s*\w+(?:\[\w+\])?/.test(code) &&
      !/^\s*[#*]/.test(code) && !/\b(int|long|char|double|float|auto|void)\s*\*/.test(code) &&
      !/long long|1LL|\(ll\)|\blll\b/.test(code) && !/\bfor\b/.test(code)
    ) add("med", "Product computed in 32-bit arithmetic", "Multiplying two ints overflows before any widening. Cast one operand: (long long)a * b.", ln);
  });

  // Loop nesting estimated from indentation.
  const stack: number[] = [];
  let depth = 0;
  lines.forEach((l) => {
    if (!/^\s*(for|while)\b/.test(l)) return;
    const ind = (l.match(/^\s*/) as RegExpMatchArray)[0].length;
    while (stack.length && stack[stack.length - 1] >= ind) stack.pop();
    stack.push(ind);
    depth = Math.max(depth, stack.length);
  });
  const usesLog = /\bsort\s*\(|\bset<|\bmap<|priority_queue/.test(src);
  const detected: Analysis["detected"] = depth >= 2 ? "O(N²)" : usesLog || depth === 1 ? "O(N log N)" : "O(N)";
  if (depth >= 2)
    found.push({ sev: "high", title: `Nested loops detected (depth ${depth})`, detail: `Roughly O(N^${depth}). At N = 10⁵ that is far beyond a 1-second budget.`, line: 0 });

  found.sort((a, b) => ORDER.indexOf(a.sev) - ORDER.indexOf(b.sev));
  return { warnings: found, detected, depth };
}

const fmtN = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(n));

export default function Home() {
  const [code, setCode] = useState<string>(SAMPLE);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Analysis | null>(null);
  const [cases, setCases] = useState<EdgeCase[]>(DEFAULT_CASES.map((text, id) => ({ id, text, done: false })));
  const [draft, setDraft] = useState("");

  const run = () => {
    setLoading(true);
    setResult(null);
    setTimeout(() => { setResult(analyze(code)); setLoading(false); }, 1400);
  };

  const data = useMemo(() => {
    const pts: { n: number; nlogn: number; n2: number }[] = [];
    for (let n = 1000; n <= 100000; n += 1000)
      pts.push({ n, nlogn: (n * Math.log2(n)) / OPS_PER_SEC, n2: (n * n) / OPS_PER_SEC });
    return pts;
  }, []);

  const doneCount = cases.filter((c) => c.done).length;
  const pct = cases.length ? Math.round((doneCount / cases.length) * 100) : 0;
  const addCase = () => {
    const text = draft.trim();
    if (!text) return;
    setCases((prev) => [...prev, { id: Date.now(), text, done: false }]);
    setDraft("");
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-slate-200">
      <header className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-5 py-3">
        <Zap className="h-5 w-5 text-indigo-400" />
        <h1 className="text-lg font-semibold">Algo<span className="text-indigo-400">Bench</span></h1>
        <span className="ml-3 hidden text-sm text-slate-500 sm:inline">Pre-submission checks for C++ solutions</span>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-2">
        {/* Editor */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <Terminal className="h-4 w-4" />solution.cpp
            </h2>
            <button
              onClick={run}
              disabled={loading || !code.trim()}
              className="flex items-center gap-2 rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {loading ? "Analyzing…" : "Run Analysis"}
            </button>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            placeholder="Paste your C++ solution here…"
            className="h-[460px] w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[13px] leading-5 text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-400"
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", tabSize: 4 }}
          />
        </section>

        {/* Dashboard */}
        <section className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <AlertTriangle className="h-4 w-4" />Pitfall warnings
            </h2>
            {loading && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />Scanning for I/O, overflow and complexity issues…
              </div>
            )}
            {!loading && !result && <p className="text-sm text-slate-500">Click “Run Analysis” to scan your code.</p>}
            {result && result.warnings.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-green-400"><CheckCircle2 className="h-4 w-4" />No pitfalls detected by the heuristics.</p>
            )}
            {result && result.warnings.length > 0 && (
              <ul className="max-h-64 space-y-2 overflow-auto pr-1">
                {result.warnings.map((w, i) => {
                  const S = SEV[w.sev];
                  const Icon = S.icon;
                  return (
                    <li key={i} className={`rounded-lg border border-l-4 border-zinc-800 bg-zinc-950 p-3 ${S.border}`}>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Icon className={`h-4 w-4 ${S.text}`} />{w.title}
                        {w.line > 0 && <span className="ml-auto font-mono text-xs text-slate-500">L{w.line}</span>}
                      </div>
                      <p className="mt-1 text-[13px] text-slate-400">{w.detail}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Timer className="h-4 w-4" />Complexity vs 1 s limit
              </h2>
              {result && (
                <span className="rounded-full border border-zinc-700 px-2.5 py-0.5 text-xs">
                  Your code looks like <b className={result.detected === "O(N²)" ? "text-red-400" : "text-green-400"}>{result.detected}</b>
                </span>
              )}
            </div>
            <p className="mb-2 text-xs text-slate-500">Estimated seconds at 10⁸ simple operations/s (log scale), N up to 10⁵.</p>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis dataKey="n" tickFormatter={(n: number) => fmtN(n)} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis
                    scale="log" domain={[0.0001, 100]} allowDataOverflow ticks={[0.0001, 0.01, 1, 100]}
                    tickFormatter={(v: number) => `${v}s`} tick={{ fill: "#94a3b8", fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v) => `${Number(v).toFixed(4)} s`}
                    labelFormatter={(n) => `N = ${Number(n).toLocaleString()}`}
                    contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={1} stroke="#f87171" strokeDasharray="6 4" label={{ value: "1 s limit", fill: "#f87171", fontSize: 11, position: "insideTopLeft" }} />
                  <Line type="monotone" dataKey="nlogn" name="O(N log N)" stroke="#4ade80" strokeWidth={result?.detected === "O(N log N)" ? 3 : 2} dot={false} />
                  <Line type="monotone" dataKey="n2" name="O(N²)" stroke="#fbbf24" strokeWidth={result?.detected === "O(N²)" ? 3 : 2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <ListChecks className="h-4 w-4" />Edge-case checklist
              </h2>
              <span className="text-xs text-slate-400">{doneCount}/{cases.length} · {pct}%</span>
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-indigo-400 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <ul className="space-y-1">
              {cases.map((c) => (
                <li key={c.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-800/60">
                  <input
                    id={`case-${c.id}`} type="checkbox" checked={c.done}
                    onChange={() => setCases((prev) => prev.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))}
                    className="h-4 w-4 accent-indigo-400"
                  />
                  <label htmlFor={`case-${c.id}`} className={`flex-1 cursor-pointer text-sm ${c.done ? "text-slate-500 line-through" : ""}`}>{c.text}</label>
                  <button
                    onClick={() => setCases((prev) => prev.filter((x) => x.id !== c.id))}
                    aria-label="Remove edge case"
                    className="text-slate-600 opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCase()}
                placeholder="Add your own edge case…"
                className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm outline-none placeholder:text-slate-600 focus:border-indigo-400"
              />
              <button onClick={addCase} className="flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:border-indigo-400">
                <Plus className="h-4 w-4" />Add
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}