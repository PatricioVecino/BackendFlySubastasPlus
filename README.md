# SubastasPlus

## Supabase quick start (API client)

1. In the Supabase dashboard for your project, go to Settings → API and copy `Project URL` and the `anon public` key.
2. Create a local `.env` from `.env.example` and paste the values:

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key
```

3. Install dependencies (already done):

```bash
npm install
```

4. Run the quick test which will query the `auctions` table (change table name if needed):

```bash
node supabase-test.js
```

Notes:

- If the `anon` key lacks permissions to read your table, configure Row Level Security (RLS) or test from server using a `service_role` key (do NOT put service_role in client code).
- For production use, keep keys in environment variables in your hosting/CI.
