# Changelog

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
