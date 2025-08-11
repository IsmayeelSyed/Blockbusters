
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/*
  Next.js + Supabase client for Online Blockbusters
  -------------------------------------------------
  - Anonymous sign-in on load
  - Create / Join room (5-char code)
  - Live board via Realtime on public.board_cells, public.games, public.game_players
  - Claim cell through RPC claim_cell()
  - Question fetch from public.questions by letter (random) with fallback MCQ
*/

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
if (!supabaseUrl || !supabaseAnon) {
  console.warn("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
}
const supabase: SupabaseClient = createClient(supabaseUrl!, supabaseAnon!);

type Owner = "P1" | "P2" | "NONE";

type DBCell = {
  game_id: string;
  row_idx: number;
  col_idx: number;
  letter: string;
  owner: "P1" | "P2" | null;
  updated_at: string;
};

type GameRow = { id: string; room_code: string; status: "waiting" | "active" | "finished" };

type PlayerRow = { game_id: string; player_uid: string; name: string; side: "P1" | "P2" };

type MCQ = { prompt: string; options: string[]; correctIndex: number };

const HEX_W = 88;
const HEX_H = 76;
const COL_GAP = 6;
const ROW_GAP = 6;

function hexPoints(w = HEX_W, h = HEX_H) {
  const a = w / 4;
  return [
    [a, 0],
    [w - a, 0],
    [w, h / 2],
    [w - a, h],
    [a, h],
    [0, h / 2],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
}

function hexPosition(row: number, col: number) {
  const x = col * (HEX_W + COL_GAP);
  const offset = (HEX_H + ROW_GAP) / 2;
  const y = row * (HEX_H + ROW_GAP) + (col % 2 === 0 ? 0 : offset);
  return { x, y };
}

function inBounds(r: number, c: number) {
  return r >= 0 && r < 4 && c >= 0 && c < 5;
}

const NEIGHBOR_OFFSETS_EVEN = [
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
  { dr: -1, dc: 0 },
  { dr: 1, dc: 0 },
  { dr: -1, dc: 1 },
  { dr: 1, dc: 1 },
];
const NEIGHBOR_OFFSETS_ODD = [
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
  { dr: -1, dc: -1 },
  { dr: 1, dc: -1 },
  { dr: -1, dc: 0 },
  { dr: 1, dc: 0 },
];

function neighborsOf(r: number, c: number) {
  const offsets = c % 2 === 0 ? NEIGHBOR_OFFSETS_EVEN : NEIGHBOR_OFFSETS_ODD;
  const out: [number, number][] = [];
  for (const { dr, dc } of offsets) {
    const nr = r + dr;
    const nc = c + dc;
    if (inBounds(nr, nc)) out.push([nr, nc]);
  }
  return out;
}

function hasWinningPath(cells: DBCell[], player: Owner): boolean {
  const belongs = (r: number, c: number) => cells.find((x) => x.row_idx === r && x.col_idx === c)?.owner === (player === "NONE" ? null : player);
  if (player === "P1") {
    const visited = new Set<string>();
    const stack: [number, number][] = [];
    for (let c = 0; c < 5; c++) if (belongs(0, c)) stack.push([0, c]);
    while (stack.length) {
      const [r, c] = stack.pop()!;
      if (r === 3) return true;
      const key = `${r},${c}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const [nr, nc] of neighborsOf(r, c)) if (belongs(nr, nc)) stack.push([nr, nc]);
    }
    return false;
  } else if (player === "P2") {
    const visited = new Set<string>();
    const stack: [number, number][] = [];
    for (let r = 0; r < 4; r++) if (belongs(r, 0)) stack.push([r, 0]);
    while (stack.length) {
      const [r, c] = stack.pop()!;
      if (c === 4) return true;
      const key = `${r},${c}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const [nr, nc] of neighborsOf(r, c)) if (belongs(nr, nc)) stack.push([nr, nc]);
    }
    return false;
  }
  return false;
}

function computeOneAway(cells: DBCell[], player: Owner): Set<string> {
  const result = new Set<string>();
  for (const cell of cells) {
    if (cell.owner !== null) continue;
    const clone = cells.map((c) => (c.row_idx === cell.row_idx && c.col_idx === cell.col_idx ? { ...c, owner: player as "P1" | "P2" } : c));
    if (hasWinningPath(clone, player)) result.add(`${cell.row_idx}-${cell.col_idx}`);
  }
  return result;
}

const DEMO_QBANK: Record<string, { prompt: string; correct: string; distractors: string[] } | undefined> = {
  A: { prompt: "Which A is the world's largest rainforest?", correct: "Amazon", distractors: ["Atlas", "Ardennes", "Alps"] },
  B: { prompt: "Which B is a yellow curved fruit?", correct: "Banana", distractors: ["Broccoli", "Basil", "Barley"] },
  C: { prompt: "Which C is a common household pet?", correct: "Cat", distractors: ["Caribou", "Caiman", "Cobra"] },
  D: { prompt: "Which D is a precious gemstone?", correct: "Diamond", distractors: ["Dolomite", "Diorite", "Dacite"] },
  E: { prompt: "Which E is the largest land animal?", correct: "Elephant", distractors: ["Emu", "Echidna", "Eland"] },
  F: { prompt: "Which F is a country in Western Europe?", correct: "France", distractors: ["Fiji", "Finland", "Faroe Islands"] },
  G: { prompt: "Which G is a stringed musical instrument?", correct: "Guitar", distractors: ["Glockenspiel", "Guiro", "Gong"] },
  H: { prompt: "Which H is the lightest element?", correct: "Hydrogen", distractors: ["Helium-4", "Hassium", "Holmium"] },
  I: { prompt: "Which I is a large lizard often kept as a pet?", correct: "Iguana", distractors: ["Ibis", "Impala", "Isopod"] },
  J: { prompt: "Which J is the largest planet in the Solar System?", correct: "Jupiter", distractors: ["Janus", "Juno", "Jasmina"] },
  K: { prompt: "Which K is a marsupial native to Australia?", correct: "Kangaroo", distractors: ["Kea", "Kiwi", "Kudu"] },
  L: { prompt: "Which L is the capital of the UK?", correct: "London", distractors: ["Lagos", "Lima", "Lyon"] },
  M: { prompt: "Which M is a planet closest to the Sun?", correct: "Mercury", distractors: ["Mars", "Mimas", "Makemake"] },
  N: { prompt: "Which N is a distant ice giant planet?", correct: "Neptune", distractors: ["Naiad", "Nix", "Nemesis"] },
  O: { prompt: "Which O do we breathe?", correct: "Oxygen", distractors: ["Osmium", "Ozone", "Oxide"] },
  P: { prompt: "Which P is an 88-key musical instrument?", correct: "Piano", distractors: ["Piccolo", "Pan flute", "Pipe"] },
  Q: { prompt: "Which Q is a common mineral used in watches?", correct: "Quartz", distractors: ["Quartzite", "Quinoa", "Quark"] },
  R: { prompt: "Which R shows a spectrum of colors in the sky?", correct: "Rainbow", distractors: ["Ray", "Ripple", "Ridge"] },
  S: { prompt: "Which S is a ringed planet?", correct: "Saturn", distractors: ["Sirius", "Sedna", "Sextans"] },
  T: { prompt: "Which T is a large striped cat?", correct: "Tiger", distractors: ["Tapir", "Tahr", "Toucan"] },
  U: { prompt: "Which U is an ice giant planet?", correct: "Uranus", distractors: ["Umbriel", "Ultima Thule", "Ursa Major"] },
  V: { prompt: "Which V is a bowed string instrument?", correct: "Violin", distractors: ["Vuvuzela", "Vibraphone", "Vielle"] },
  W: { prompt: "Which W is the largest mammal?", correct: "Whale", distractors: ["Wildebeest", "Walrus", "Wombat"] },
  X: { prompt: "Which X is a musical instrument often used in schools?", correct: "Xylophone", distractors: ["Xylose", "Xenon", "Xiphos"] },
  Y: { prompt: "Which Y is a US national park famous for geysers?", correct: "Yellowstone", distractors: ["Yala", "Yosemite", "Yukon"] },
  Z: { prompt: "Which Z is a striped African animal?", correct: "Zebra", distractors: ["Zebu", "Zorilla", "Zander"] },
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchQuestion(letter: string): Promise<MCQ> {
  const { data, error } = await supabase
    .from("questions")
    .select("prompt, option_a, option_b, option_c, option_d, correct_index")
    .eq("letter", letter)
    .limit(1)
    .order("updated_at", { ascending: false });

  if (!error && data && data.length) {
    const q = data[0] as any;
    const options = [q.option_a, q.option_b, q.option_c, q.option_d];
    return { prompt: q.prompt, options, correctIndex: q.correct_index };
  }

  const base = DEMO_QBANK[letter] ?? {
    prompt: `Pick the option that starts with "${letter}"`,
    correct: `${letter}${letter.toLowerCase()}-answer`,
    const options = shuffle([base.correct, ...base.distractors]);
    distractors: ["Alpha", "Beta", "Gamma"],
  };
  const options = shuffle([base.correct, *base.distractors]) as string[];
  return { prompt: base.prompt, options, correctIndex: options.indexOf(base.correct) };
}

function QuestionModal({ open, letter, onClose, onAnswer }: { open: boolean; letter: string | null; onClose: () => void; onAnswer: (correct: boolean) => void; }) {
  const [mcq, setMcq] = useState<MCQ | null>(null);

  useEffect(() => {
    if (!open || !letter) return;
    let alive = true;
    (async () => {
      const q = await fetchQuestion(letter);
      if (alive) setMcq(q);
    })();
    return () => { alive = false; };
  }, [open, letter]);

  if (!open || !letter) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">Question for "{letter}"</h2>
          <button onClick={onClose} className="rounded-full px-3 py-1 text-sm hover:bg-gray-100">✕</button>
        </div>
        {!mcq ? (
          <div className="mt-6 text-sm text-gray-500">Loading question…</div>
        ) : (
          <div className="mt-4">
            <div className="text-base font-medium leading-relaxed">{mcq.prompt}</div>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {mcq.options.map((opt, idx) => (
                <button key={idx} className="rounded-xl border px-3 py-2 text-left hover:border-black" onClick={() => onAnswer(idx === mcq.correctIndex)}>
                  <span className="mr-2 inline-block w-6 font-mono">{String.fromCharCode(65 + idx)}.</span>
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  const [sessionReady, setSessionReady] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState("");
  const [game, setGame] = useState<GameRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [cells, setCells] = useState<DBCell[]>([]);
  const [mySide, setMySide] = useState<Owner>("NONE");
  const [name, setName] = useState("Player");

  const [selected, setSelected] = useState<{ r: number; c: number; letter: string } | null>(null);
  const [qOpen, setQOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const { data: sign } = await supabase.auth.signInAnonymously();
        setUid(sign.session?.user.id ?? null);
      } else {
        setUid(data.session.user.id);
      }
      setSessionReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!game?.id) return;
    const channel = supabase
      .channel(`game-${game.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "board_cells", filter: `game_id=eq.${game.id}` }, (payload) => {
        if (payload.eventType === "INSERT") setCells((prev) => [...prev, payload.new as DBCell]);
        if (payload.eventType === "UPDATE") setCells((prev) => prev.map((c) => (c.row_idx === (payload.new as any).row_idx && c.col_idx === (payload.new as any).col_idx ? (payload.new as DBCell) : c)));
        if (payload.eventType === "DELETE") setCells((prev) => prev.filter((c) => !(c.row_idx === (payload.old as any).row_idx && c.col_idx === (payload.old as any).col_idx)));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "game_players", filter: `game_id=eq.${game.id}` }, () => refreshPlayers(game.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${game.id}` }, () => refreshGame(game.id))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [game?.id]);

  async function refreshGame(id: string) {
    const { data } = await supabase.from("games").select("id, room_code, status").eq("id", id).single();
    if (data) setGame(data as GameRow);
  }

  async function refreshPlayers(id: string) {
    const { data } = await supabase.from("game_players").select("game_id, player_uid, name, side").eq("game_id", id);
    if (data) setPlayers(data as PlayerRow[]);
  }

  async function refreshBoard(id: string) {
    const { data } = await supabase
      .from("board_cells")
      .select("game_id, row_idx, col_idx, letter, owner, updated_at")
      .eq("game_id", id)
      .order("row_idx")
      .order("col_idx");
    if (data) setCells(data as DBCell[]);
  }

  async function handleCreate() {
    if (!sessionReady) return;
    const { data, error } = await supabase.rpc("create_game", { host_name: name });
    if (error) { setMessage(error.message); return; }
    const [{ game_id, room_code }] = data as any[];
    setRoomCode(room_code);
    await refreshGame(game_id);
    await refreshPlayers(game_id);
    await refreshBoard(game_id);
    setMySide("P1");
  }

  async function handleJoin() {
    if (!sessionReady || !roomCode.trim()) return;
    const { data, error } = await supabase.rpc("join_game", { room_code: roomCode.trim().toUpperCase(), player_name: name });
    if (error) { setMessage(error.message); return; }
    const [{ game_id, side }] = data as any[];
    await refreshGame(game_id);
    await refreshPlayers(game_id);
    await refreshBoard(game_id);
    setMySide(side as Owner);
  }

  const winner: Owner | null = useMemo(() => {
    if (!cells.length) return null;
    if (hasWinningPath(cells, "P1")) return "P1";
    if (hasWinningPath(cells, "P2")) return "P2";
    return null;
  }, [cells]);

  const oneAwayP1 = useMemo(() => computeOneAway(cells, "P1"), [cells]);
  const oneAwayP2 = useMemo(() => computeOneAway(cells, "P2"), [cells]);

  function cellFill(owner: DBCell["owner"]) {
    if (owner === "P1") return "fill-sky-300";
    if (owner === "P2") return "fill-amber-300";
    return "fill-white";
  }
  function cellStroke(owner: DBCell["owner"], isHot: boolean) {
    const base = owner === "P1" ? "stroke-sky-600" : owner === "P2" ? "stroke-amber-600" : "stroke-gray-400";
    return base + (isHot ? " animate-pulse" : "");
  }

  const boardWidth = 5 * (HEX_W + COL_GAP) - COL_GAP;
  const boardHeight = 4 * (HEX_H + ROW_GAP) + (HEX_H + ROW_GAP) / 2;

  async function openQuestion(r: number, c: number, letter: string) {
    if (!game || winner) return;
    const already = cells.find((x) => x.row_idx === r && x.col_idx === c)?.owner;
    if (already) return;
    setSelected({ r, c, letter });
    setQOpen(true);
  }

  async function handleAnswer(correct: boolean) {
    if (!selected || !game) return;
    setQOpen(false);
    try {
      const { error } = await supabase.rpc("claim_cell", {
        p_game_id: game.id,
        p_row: selected.r,
        p_col: selected.c,
        p_side: mySide === "NONE" ? "P1" : (mySide as "P1" | "P2"),
        p_correct: correct,
      });
      if (error) setMessage(error.message);
      if (correct) {
        setCells((prev) => prev.map((x) => (x.row_idx === selected.r && x.col_idx === selected.c ? { ...x, owner: mySide as "P1" | "P2" } : x)));
      }
    } catch (e: any) {
      setMessage(e.message ?? String(e));
    } finally {
      setSelected(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
      <header className="mb-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
        <h1 className="text-2xl font-bold tracking-tight">Blockbusters — Online</h1>
        <div className="flex items-center gap-2">
          <input className="w-44 rounded border px-2 py-1" placeholder="Your display name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="w-32 rounded border px-2 py-1 uppercase" placeholder="ROOM" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} />
          <button onClick={handleCreate} className="rounded-xl border px-3 py-2 hover:bg-gray-50">Create Room</button>
          <button onClick={handleJoin} className="rounded-xl bg-black px-3 py-2 text-white hover:bg-gray-800">Join Room</button>
        </div>
      </header>

      {game ? (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border p-3 shadow-sm">
            <div className="text-sm">Room Code</div>
            <div className="text-2xl font-bold tracking-wider">{game.room_code}</div>
            <div className="mt-1 text-xs text-gray-600">Share this code with the other player.</div>
          </div>
          <PlayersPanel gameId={game.id} />
          <div className="rounded-2xl border p-3 shadow-sm">
            <div className="text-sm font-semibold">Status</div>
            <div className="text-sm">{game.status}</div>
            {winner && <div className="mt-2 rounded bg-green-50 p-2 text-green-700">{winner} wins!</div>}
          </div>
        </div>
      ) : (
        <div className="mb-3 rounded-2xl border p-3 text-sm text-gray-700">
          Create a room, or enter a code and click Join Room.
        </div>
      )}

      {cells.length ? (
        <Board
          cells={cells}
          oneAwayP1={oneAwayP1}
          oneAwayP2={oneAwayP2}
          onPick={openQuestion}
        />
      ) : null}

      <QuestionModal open={qOpen} letter={selected?.letter ?? null} onClose={() => { setQOpen(false); setSelected(null); }} onAnswer={handleAnswer} />

      {message && <div className="mt-4 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">{message}</div>}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border p-3">
          <div className="mb-1 text-sm font-semibold">Legend</div>
          <ul className="text-sm text-gray-700">
            <li><span className="mr-1 inline-block h-3 w-3 rounded-full bg-sky-400" /> P1 connects <strong>Top↕Bottom</strong></li>
            <li><span className="mr-1 inline-block h-3 w-3 rounded-full bg-amber-400" /> P2 connects <strong>Left↔Right</strong></li>
            <li><span className="mr-1 inline-block h-3 w-3 rounded-full bg-gray-300" /> Grey hex = unclaimed; click to answer</li>
            <li>Small ↕ / ↔ hints on neutral hexes indicate one‑away cells</li>
          </ul>
        </div>
        <div className="rounded-2xl border p-3">
          <div className="mb-1 text-sm font-semibold">Notes</div>
          <p className="text-sm text-gray-700">Questions come from the DB table <code>questions</code> (random by letter). If none exist for a letter, a built‑in fallback question is shown. Answers call the <code>claim_cell</code> RPC, and Realtime pushes update the board for both players.</p>
        </div>
      </div>
    </div>
  );
}

function PlayersPanel({ gameId }: { gameId: string }) {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("game_players").select("game_id, player_uid, name, side").eq("game_id", gameId);
      if (data) setPlayers(data as PlayerRow[]);
    })();
    const ch = supabase
      .channel(`players-${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_players", filter: `game_id=eq.${gameId}` }, async () => {
        const { data } = await supabase.from("game_players").select("game_id, player_uid, name, side").eq("game_id", gameId);
        if (data) setPlayers(data as PlayerRow[]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId]);

  return (
    <div className="rounded-2xl border p-3 shadow-sm">
      <div className="text-sm font-semibold">Players</div>
      <ul className="mt-1 text-sm">
        {players.map((p) => (
          <li key={p.player_uid} className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${p.side === "P1" ? "bg-sky-500" : "bg-amber-500"}`}></span>
            <span>{p.name}</span>
            <span className="text-gray-500">({p.side})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Board({ cells, oneAwayP1, oneAwayP2, onPick }:{ cells: DBCell[], oneAwayP1: Set<string>, oneAwayP2: Set<string>, onPick: (r:number,c:number,letter:string)=>void }) {
  const boardWidth = 5 * (HEX_W + COL_GAP) - COL_GAP;
  const boardHeight = 4 * (HEX_H + ROW_GAP) + (HEX_H + ROW_GAP) / 2;

  function cellFill(owner: DBCell["owner"]) {
    if (owner === "P1") return "fill-sky-300";
    if (owner === "P2") return "fill-amber-300";
    return "fill-white";
  }
  function cellStroke(owner: DBCell["owner"], isHot: boolean) {
    const base = owner === "P1" ? "stroke-sky-600" : owner === "P2" ? "stroke-amber-600" : "stroke-gray-400";
    return base + (isHot ? " animate-pulse" : "");
  }

  return (
    <div className="mx-auto w-full overflow-x-auto">
      <svg width={boardWidth} height={boardHeight} className="mx-auto block">
        {cells.map((cell) => {
          const x = cell.col_idx * (HEX_W + COL_GAP);
          const y = cell.row_idx * (HEX_H + ROW_GAP) + (cell.col_idx % 2 === 0 ? 0 : (HEX_H + ROW_GAP) / 2);
          const isOneAwayP1 = oneAwayP1.has(`${cell.row_idx}-${cell.col_idx}`);
          const isOneAwayP2 = oneAwayP2.has(`${cell.row_idx}-${cell.col_idx}`);
          const isHot = cell.owner === null && (isOneAwayP1 || isOneAwayP2);
          return (
            <g key={`${cell.row_idx}-${cell.col_idx}`} transform={`translate(${x}, ${y})`}>
              <polygon
                points={hexPoints()}
                className={`${cellFill(cell.owner)} ${cellStroke(cell.owner, isHot)}`}
                strokeWidth={3}
                onClick={() => cell.owner === null && onPick(cell.row_idx, cell.col_idx, cell.letter)}
                style={{ cursor: cell.owner === null ? "pointer" : "default" }}
              />
              <text x={HEX_W / 2} y={HEX_H / 2 + 6} textAnchor="middle" className={`select-none font-semibold ${cell.owner === null ? "fill-gray-700" : "fill-black"}`} style={{ fontSize: 28 }}>
                {cell.letter}
              </text>
              {cell.owner === null && (isOneAwayP1 || isOneAwayP2) ? (
                <text x={HEX_W - 12} y={18} textAnchor="end" className="fill-gray-400 text-[10px]">
                  {isOneAwayP1 && "↕"}
                  {isOneAwayP2 && "↔"}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
