# Changelog

## v1.4.0 — 2026-11-17
### Changed
- **Code only, no name step.** Gatekeeper now just says **"Say code."** and listens for the PIN. A shorter prompt means less of the call box's own audio echoes back into its microphone, and the guest can talk sooner. Wrong code → "Wrong code. Say code."

## v1.3.3 — 2026-11-15
### Fixed
- **Voice codes on half-duplex call boxes**: prompts can no longer be interrupted (`bargeIn="false"`). The call box speaker was leaking into its microphone, so the recognizer heard its own prompt and treated it as the answer.
- **Pauses between digits**: digits now add up across short listens, so "four… eight two… one" works while opening stays fast (1 s end-of-speech on the code step, no pause before the open digit).
### Added
- Failed attempts log what was heard («…») in the history and the email, to make troubleshooting easier.
- Panel warning (with a one-tap button) when codes are saved but not requested yet.
- Example placeholders in every panel field. Date/time fields no longer overlap on iPhone.

## v1.3.0 — 2026-11-14
### Added
- **Guest access codes by voice**: the visitor says their name (for the record) and then their PIN, in English or Spanish (`<Gather input="speech" speechModel="deepgram_nova-3" language="multi">`). Works with call boxes whose keypad doesn't send tones during the call.
- Spoken digit parsing: "uno dos tres cuatro", "one two three four", "1 2 3 4", "1234".
- Per-code rules: valid from / expires (or unlimited), days of the week, hours (or always), max uses (unlimited, single use, or N), on/off switch, plus usage stats in the panel.
- New action **"Ask for name + code"**, available for schedules, manual pause, and for automatic mode outside schedules.
- Retries (1–5), configurable action after the last failure, optional "say *call* to reach the owner" forwarding.
- Brute-force protection: 5 failed calls within an hour lock code entry for 60 minutes and send an email alert.
- Emails and history show the guest ("🔑 Juan came in") and the name they said. The weekly summary lists who came in with a code.

## v1.2.0 — 2026-11-10
### Changed
- **The admin panel is now hosted on GitHub Pages** and talks to Apps Script through a JSON API (`doPost` with `{api, key, cfg}`). It opens reliably on iPhone and Android, even with no Google session or with several Google accounts.
- The private link format is `PANEL_HOST#api=<web app URL>&k=<key>`. The key stays after the `#`, so it's never sent to the page host.
- New config value: `PANEL_HOST`.
### Compatibility
- Opening the web app URL while signed in as the owner still serves the built-in panel.

## v1.1.1 — 2026-11-10
### Fixed
- The admin panel failed to open on phones ("Sorry, unable to open the file at this time") when Safari wasn't signed in to Google or had several Google accounts. It now opens with a **private link** (`…/exec?p=<key>`) that works without Google sign-in.
### Added
- **Access** section in the panel: copy the link, or create a new one (the old link stops working).
- The ⚙️ Panel button in emails uses the private link.

## v1.1.0 — 2026-11-10

### Added
- **Admin panel**: mobile web app that only the script owner can open (Google sign-in).
  - Modes: **Automatic** (follows schedules), **Always open**, **Paused**.
  - **Schedules**: name, days of the week, from/to time, overnight ranges (e.g. 22:00 → 06:00), on/off switch.
  - **Pause actions**, per schedule and for manual pause: reject, forward to your phone, play a message, or open anyway + urgent alert.
  - **Call forwarding** settings: your number, ring time, and what to do if you don't answer (hang up or open anyway).
  - Custom spoken message, night-alert window, weekly-summary toggle, recent calls.
- New alert emails: forwarded (answered / missed / opened anyway), rejected, message played, opened during restricted hours. Each one shows the reason (manual pause or which schedule).
- Spanish / English (`LANG`).
- Call history: new `Code` and `Reason` columns. The v1.0 header is upgraded automatically.

### Changed
- The ⚙️ **Panel** button replaces ⏸️ Pause in the emails.
- Weekly summary now also counts blocked and forwarded calls.
- Strangers hitting the web app URL get plain text instead of an HTML page.

### Compatibility
- Existing Twilio URLs keep working (`type=voice` and the legacy `tipo=voz`).
- The v1.0 pause flag is migrated to *Paused* mode by `setup()`.

## v1.0.0 — 2026-11-10
- Auto-open (DTMF 9), card-style email alerts (opened / night / failed / unknown caller), Google Sheets history, weekly summary, token-protected pause page, TwiML Bin fallback.
