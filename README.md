# 🔓 Gatekeeper

**Hands-free gate opener with beautiful email alerts — built on Twilio + Google Apps Script.**

Gatekeeper automates access to a **gated community**. The community's call box phones me every time a visitor or delivery arrives, and I had to pick up and press **9** to open the gate. Gatekeeper answers those calls automatically, opens the gate, and emails me a clean card with what happened. It also keeps a call history, sends a weekly summary, and lets me pause automatic opening from my phone.

It costs about **$0.01 per call** on Twilio. Everything else runs free on Google.

> [!WARNING]
> **Use at your own risk.** Gatekeeper opens your gate for **anyone** who dials your unit from the call box. You only find out **when** the gate opened, not **who** came in. It's very convenient for family use, but read the [disclaimer](#%EF%B8%8F-disclaimer) before you set it up.

![Gatekeeper alert emails](docs/screenshots/hero-alerts.png)

---

## ✨ Features

| | Feature | What it does |
|---|---|---|
| 🔓 | **Auto-open** | Answers the call box, waits 1 second, plays DTMF `9`, hangs up. |
| 📧 | **Email after every call** | Card-style HTML email: time, caller, duration and whether the open signal was sent. |
| ❌ | **Failure alert** | Red email if the call failed or dropped before the `9` was sent. |
| 🌙 | **Night alert** | Purple email when the gate opens between 12 AM and 6 AM. |
| ⚠️ | **Unknown caller** | Orange email if the call didn't come from your call box number. |
| 📊 | **Call history** | Every call is logged as a row in a Google Sheet. |
| 🗓️ | **Weekly summary** | Sunday 8 PM email: openings, failures, night openings, peak hour, busiest day. |
| ⏸️ | **Pause / resume** | One tap from any email to stop auto-opening (vacation mode). Calls are rejected while paused. |
| 🛟 | **Fail-safe** | If Google is unreachable, Twilio falls back to a static TwiML Bin, so the gate keeps opening. |

---

## 🧭 How it works

```mermaid
sequenceDiagram
    participant Box as Gate call box
    participant T as Twilio number
    participant GAS as Apps Script web app
    participant Bin as TwiML Bin (fallback)
    participant You as You (Gmail / Sheets)

    Box->>T: Visitor presses your unit
    T->>GAS: POST "A call comes in" (type=voice)
    alt Active
        GAS-->>T: <Pause/> <Play digits="9"/> <Hangup/>
        T-->>Box: DTMF 9 → gate opens
    else Paused
        GAS-->>T: <Reject reason="busy"/>
    end
    Note over T,Bin: If Apps Script errors or times out,<br/>Twilio uses the TwiML Bin instead
    T->>GAS: POST "Call status changes" (call finished)
    GAS->>You: Log row in Google Sheet
    GAS->>You: HTML alert email
```

---

## 📸 Screenshots

<table>
<tr>
<td width="50%" valign="top">

**Weekly summary**<br/>
<img src="docs/screenshots/email-summary.png" alt="Weekly summary email"/>

</td>
<td width="50%" valign="top">

**Pause / resume page** (opened from the ⏸️ button)<br/>
<img src="docs/screenshots/pause-pages.png" alt="Pause and resume page"/>

</td>
</tr>
</table>

> All screenshots use sample data.

---

## 🚀 Setup (about 15 minutes)

### What you need
- A **Twilio** account with a voice-capable phone number. This is the number your gate call box dials.
- A **Google** account (Gmail + Apps Script, both free).
- The **phone number your call box calls from**, and the **digit** that opens your gate (usually `9`).

### 1. Create the fallback TwiML Bin
In Twilio Console → **TwiML Bins** → *Create*, paste [`twilio/gate-auto-answer.xml`](twilio/gate-auto-answer.xml) and save it as `Gate Auto-Answer`.

### 2. Create the Apps Script project
1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Replace the contents of `Code.gs` with [`src/Code.gs`](src/Code.gs).
3. Edit the **CONFIGURATION** block at the top:

   | Constant | Example | Notes |
   |---|---|---|
   | `EMAIL` | `you@example.com` | Where alerts go. |
   | `TOKEN` | a long random string | A secret that protects your URLs. Generate one with `openssl rand -hex 16`. |
   | `ACCOUNT_SID` | `AC…` | Twilio Console → Account info. |
   | `CALL_BOX` | `+15550100123` | The number your call box calls from, in E.164 format. |
   | `OPEN_DIGIT` | `9` | The digit your gate expects. |
   | `TZ` | `America/New_York` | Your time zone. |

4. Select the `setup` function and click **Run**. Approve the permissions. Google will warn that the app is unverified; that's expected for your own script (*Advanced → Go to project*).
   This creates the **Gatekeeper · Call history** sheet and the Sunday summary trigger.

### 3. Deploy as a web app
**Deploy → New deployment → Web app**
- *Execute as:* **Me**
- *Who has access:* **Anyone**. Twilio needs to reach it. Requests without your `TOKEN` and `ACCOUNT_SID` are rejected.

Copy the `/exec` URL, paste it into `WEB_URL` in the config, save, then **Deploy → Manage deployments → Edit → New version**. The URL stays the same.

### 4. Wire up your Twilio number
Twilio Console → **Phone Numbers → Active numbers → (your number) → Voice configuration**:

| Field | Value |
|---|---|
| **A call comes in** | Webhook → `https://script.google.com/macros/s/…/exec?k=YOUR_TOKEN&type=voice` (HTTP POST) |
| **Primary handler fails** | TwiML Bin → `Gate Auto-Answer` |
| **Call status changes** | `https://script.google.com/macros/s/…/exec?k=YOUR_TOKEN` (HTTP POST) |

Save, then call your Twilio number from the call box (or any phone) to test.

> 💡 **Just want the email alerts?** Leave *A call comes in* pointing at your existing TwiML Bin and only set *Call status changes*. You'll get every alert except pause/resume.

---

## 🔐 Security notes

- **Treat `TOKEN` like a password.** Anyone who has it can pause your gate. Never commit your real config. Rotate it by changing the constant, redeploying, and updating the two Twilio URLs.
- Requests must include both the token and your Twilio `AccountSid`. Anything else gets `forbidden`.
- The pause link opens a confirmation page first, so email link scanners can't toggle it by accident.
- Fail-open by design: if the script is down, the TwiML Bin keeps opening the gate exactly as before.

---

## 🛠️ Customizing

- **Night window:** `NIGHT_FROM` / `NIGHT_TO`
- **Summary schedule:** edit the trigger in `setup()` (default Sunday 8 PM), then run `setup()` again
- **Look & feel:** the `stat`, `roundButton`, `header` and `card` helpers build the emails, using inline CSS for Gmail and iOS Mail
- **Test the summary:** run `testSummary()` from the editor

---

## ⚠️ Disclaimer

Gatekeeper is a **personal project**, shared freely so others can learn from it and adapt it. Please understand the risks before using it:

- **It can be dangerous.** While it's active, *anyone* who reaches your unit on the call box gets in: visitors, delivery drivers, or a stranger who simply tries your number.
- **You don't know who enters.** Gatekeeper tells you the date and time the gate opened and which number called. It cannot identify the person at the gate.
- **It's best for family or household use**, where the convenience of not having to answer every call outweighs the risk. Use the ⏸️ pause button when you're away or don't expect anyone.
- **Check your community's rules.** Some HOAs or property managers don't allow automated gate access.
- **Use at your own risk.** The author(s) take **no responsibility** for misuse of this project, unauthorized access, property loss, or any other damage resulting from its use. The software is provided "as is", without warranty of any kind (see [LICENSE](LICENSE)).

Gatekeeper is free to use, modify and share. Using it is your decision and your responsibility.

---

## 📄 License

[MIT](LICENSE)
