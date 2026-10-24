# Matchday Live in the cloud

`ogsf var` shows your matches on the Mac that runs them. To watch from a
phone, another computer or a TV, deploy Matchday Live to your own Vercel
account with a Supabase database, and connect each Mac with a relay. It
takes about twenty minutes, and the free plans of both are enough.

Nothing here is required. The fleet works the same without it; the cloud
is a mirror of your Macs, never the source.

## 1 · Create the database

1. Create a project at [supabase.com](https://supabase.com).
2. Open **Project Settings → Database** and copy the **transaction pooler**
   connection string (port 6543). It looks like
   `postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`.

You do not need to create any tables: the page does that in step 4.

## 2 · Deploy the page

1. Push the fleet's repository to your own GitHub account (a fork is fine).
2. In Vercel, **Add New → Project**, import the repository, and set the
   **Root Directory** to `modernized/matchday_live`. The rest (Vite, the
   functions, the security headers) comes from its `vercel.json`.
3. Before deploying, add the environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the pooler string from step 1 |
| `MATCHDAY_PASSWORD` | a long passphrase: it protects the page and the Claude connector |
| `MATCHDAY_SESSION_SECRET` | 32 or more random characters, for example from `openssl rand -base64 48` |
| `MATCHDAY_TIMEZONE` | optional: an IANA zone such as `Europe/London`, for the connector's report days (default UTC) |
| `MATCHDAY_CONNECTOR_REDIRECTS` | optional: extra hosts the connector's sign-in may return to, comma-separated (claude.ai, claude.com and localhost always may) |

4. Deploy. Every secret stays in Vercel; the page only ever learns whether
   each variable is set.

A deployment without `DATABASE_URL` still works: it plays the demo. That
is a good way to check the deploy before the database is ready.

## 3 · Sign in

Open `https://<your app>.vercel.app`, choose **Sign in**, and enter your
`MATCHDAY_PASSWORD`. The sign-in lasts seven days on that browser.

## 4 · Apply the schema and mint fleet tokens

On **Connections**:

1. **Cloud store → Apply the schema.** This creates every table in
   Supabase (the SQL is in `supabase/migrations/`; you can also paste it
   into Supabase's SQL editor yourself). Run it again after an update: it
   only adds what is missing.
2. **Fleet machines → mint a token** for each Mac, with a label you will
   recognise ("studio iMac"). The token is shown **once**: copy it now. The
   database stores only its SHA-256 hash.

## 5 · Connect each Mac

In the `.env` at the root of the repository the fleet works in:

```sh
CLUB_RELAY_URL=https://<your app>.vercel.app
CLUB_RELAY_TOKEN=<the token you minted for this Mac>
# CLUB_MACHINE=studio-imac          # optional: how this Mac is labelled
```

Check it, and send everything the Mac already has:

```sh
ogsf relay status          # is a relay set up, how many rows wait
ogsf relay push --all      # queue the whole match log, then send it
```

From now on every match streams to the page as it plays, and `ogsf
scheduler` relays the Upcoming Matches too. An offline Mac keeps its rows
and sends them on the next match, or when you run `ogsf relay push`.

## 6 · Use it from another Mac, or anywhere

Open your deployment, sign in, and choose **Connections → What this page
reads → This deployment**. You see every connected Mac's matches, the
reports across all of them, and Upcoming Matches.

Two other ways to look, without the cloud:

- The deployed page can read a Mac's `ogsf var` directly, with no
  database: start it with `ogsf var --allow-origin https://<your app>.vercel.app`,
  then choose **A fleet at an address** and enter `http://127.0.0.1:4600`.
  `ogsf var` listens on `127.0.0.1` only, so from another computer, forward
  the port first: `ssh -L 4600:127.0.0.1:4600 <that Mac>`.
- `?demo` at the end of the address plays the demo recording, with no
  fleet and no database.

## Turning a Mac off

Revoke its token on **Connections → Fleet machines**. That Mac's next send
is refused; its matches already in the cloud stay. Remove the two lines
from its `.env` to stop it trying.
