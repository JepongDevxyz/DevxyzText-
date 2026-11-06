# DevxyzText

Sariling TextBee-style SMS gateway ni Jepong: isang Android phone + SIM ang
gumaganap na SMS gateway. Ang backend API ang tumatanggap ng send requests,
ang phone ang automatic na nagse-send ng totoong SMS pag may API call —
basta naka-on ang phone at tumatakbo ang gateway service.

```
Your app / curl ──POST /api/send──▶ DevxyzText server ──job queue──▶ Android app (polls every 5s)
                                                                              │ SmsManager
                                                                              ▼
                                                                        Recipient (+63 …)
                                                              phone ◀──POST status: sent/failed──┘
```

## Layout

- `server/` — Node.js backend + single-page dashboard. **No npm dependencies** —
  runs anywhere with `node server.js` (Node 18+).
- `android/` — Kotlin gateway app, package `com.jepongdevxyz.devxyztext`.
- MVP scope: 1 device, send SMS + status report, daily counter (Asia/Manila).
  No receive-SMS forwarding yet (phase 2).

## 1. Run the server

```bash
cd server
node server.js
```

On startup it prints everything you need:

```
DevxyzText server listening on http://localhost:3000
Dashboard:        http://localhost:3000/
Pairing code:     123456   (enter this in the Android app)
Default API key:  sk-devxyz-...   (use this as the x-api-key header)
Daily limit:      unlimited (DAILY_LIMIT=0)
```

The pairing code and default API key are created **once** on first run and
stored in `server/data.json` (created automatically). Delete `data.json` to
reset everything.

Config (environment variables):

| Variable      | Default     | Meaning                                             |
|---------------|-------------|-----------------------------------------------------|
| `PORT`        | `3000`      | Port to listen on                                   |
| `DAILY_LIMIT` | `0`         | Max messages created per day (Asia/Manila). `0` = unlimited — it's your own SIM |
| `DATA_FILE`   | `./data.json` | Where state is stored                             |

Examples:

```bash
PORT=8080 node server.js
DAILY_LIMIT=100 node server.js
```

> **Security note:** the dashboard bootstrap endpoint (`GET /api/dashboard-info`)
> shows the API key + pairing code without a login so the local dashboard can
> work. Run this on your own machine / private network / behind auth — do not
> expose a bare instance to the public internet.

## 2. Dashboard

Open <http://localhost:3000/> — it shows:

- API key and pairing code
- Paired device + last-seen time
- Today's sent count (Asia/Manila day)
- A send-test-SMS form
- Message history (auto-refreshes every 3 seconds)

## 3. Pair the phone

1. Build/install the Android app (see below).
2. Make sure the phone can reach the server:
   - Same Wi-Fi: use the PC's LAN IP, e.g. `http://192.168.1.10:3000`
   - Or the server's public/VPS URL.
3. In the app, enter:
   - **Server URL** — e.g. `http://192.168.1.10:3000`
   - **Pairing code** — the 6-digit code from the server startup / dashboard
4. Tap **Pair device** — the device token fills in and saves automatically.
   (You can also paste a device token manually + **Save settings**.)
5. Tap **Start gateway**. Grant the SMS permission when asked.
6. Tap **Allow background run (battery exemption)** and allow it, so Android
   does not kill the gateway service.
7. Leave the phone on, charged, and connected. It polls every 5 seconds.

## 4. Send an SMS via the API

```bash
curl -X POST http://localhost:3000/api/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-devxyz-YOUR_KEY_HERE" \
  -d '{"to":"09171234567","message":"Hello from DevxyzText"}'
```

Response (`201`):

```json
{"id":"msg_…","to":"09171234567","message":"Hello from DevxyzText","status":"pending",…}
```

Within ~5 seconds the phone picks the job up, sends the SMS, and the status
becomes `sent` (check the dashboard or `GET /api/messages`).

### API reference

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/send` | `x-api-key` | Queue an SMS. Body: `{to, message}` → message object |
| `GET /api/device/jobs` | `x-device-token` | Phone polls; returns pending jobs and marks them `picked` |
| `POST /api/device/jobs/:id/status` | `x-device-token` | Phone reports `{status: "sent"\|"failed", error?, resultCode?}` |
| `POST /api/devices/pair` | pairing code in body `{code, name?}` | Exchanges the pairing code for a device token |
| `GET /api/messages` | `x-api-key` | Message list + statuses (newest first, `?limit=`) |
| `GET /api/quota` | `x-api-key` or `x-device-token` | `{date, today_count, sent_today, daily_limit, remaining}` for the Asia/Manila day |
| `GET /api/health` | — | `{ok: true}` |

Long messages (>160 chars) are sent as multipart SMS by the app, exactly
like a normal phone text.

## 5. Build the Android app

Local Gradle builds are **not** used for this project in Jepong's VM
(Gradle daemon issue) — the APK is built by GitHub Actions:

1. Push the contents of `android/` as the root of a GitHub repo
   (the workflow in `.github/workflows/android.yml` builds on every push).
2. Wait for the **Android** workflow to finish (green).
3. Download the `DevxyzText-debug-apk` artifact from the run — that's the APK.
4. Install it on the phone (debug-signed; if Play Protect blocks it, allow
   the install for this app).

The workflow provisions JDK 17 + Gradle 7.6.1 (AGP 7.4.2) itself, so the
missing local `gradle-wrapper.jar` is not a problem in CI.

## 6. Test the server

```bash
cd server
node test.js
```

Boots the server on a throwaway port + temp data file, pairs a simulated
device, sends a message, polls as the device, posts status `sent`, and
asserts `/api/messages` and `/api/quota`. Expect `ALL TESTS PASSED`.

## Limits / honest notes (MVP)

- Delivery proof: the app reports `sent` when Android accepts the message
  for sending (no exception from `SmsManager`). That is not a telco delivery
  receipt — carrier delivery reports are phase 2.
- Polling adds up to ~5 s latency. WebSocket/FCM instant push is phase 2.
- Carrier rules still apply: your SIM / unli-SMS promo pays for the texts,
  and bulk-looking traffic from a consumer SIM can be filtered by telcos.
- Sender shown to recipients is your SIM's number — no alphanumeric sender ID.

Powered by Jepong Devxyz
