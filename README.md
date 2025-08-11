# Blockbusters — Online (Next.js + Supabase)

Two-player Blockbusters board with Supabase Realtime and anonymous auth.

## Quick start

1) Install deps
```bash
npm i
```

2) Add `.env.local` in the project root:
```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

3) Run locally
```bash
npm run dev
```

4) Deploy on Vercel
- Push this repo to GitHub
- Import the repo on Vercel
- In Vercel → Project → Settings → Environment Variables, add the same two vars for All environments
- Redeploy

## Notes
- The app signs in anonymously on load.
- Create a room or join with a 5-char code.
- Clicking a lettered hex fetches a question for that letter from `questions` (if any) or uses a fallback demo question.
- Answering calls the `claim_cell` RPC and the board syncs via Realtime.
