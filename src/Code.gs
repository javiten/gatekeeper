// =====================================================================
//  GATEKEEPER
//  Hands-free gate opener + call alerts for Twilio, built on Google Apps Script.
//
//  Twilio ──(incoming call)──► doPost(type=voice)  → TwiML: wait, send DTMF "9", hang up
//  Twilio ──(call finished)──► doPost            → classify, log to Sheets, email you
//  You    ──(email button)───► doGet             → pause / resume automatic opening
//  Trigger ─(Sundays 8 PM)──► weeklySummary()    → summary email
// =====================================================================

// ---------------------------------------------------------------------
//  CONFIGURATION — edit these values
// ---------------------------------------------------------------------
const EMAIL       = 'you@example.com';                 // where alerts are sent
const TOKEN       = 'CHANGE_ME_TO_A_LONG_RANDOM_STRING'; // secret included in every URL
const ACCOUNT_SID = 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // your Twilio Account SID
const CALL_BOX    = '+15550100123';                    // phone number your gate call box dials from
const OPEN_DIGIT  = '9';                               // DTMF digit that opens your gate
const TZ          = 'America/New_York';                // your time zone
const NIGHT_FROM  = 0;                                 // "night opening" alert: from 12:00 AM...
const NIGHT_TO    = 6;                                 // ...until 5:59 AM
const WEB_URL     = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'; // set after first deploy

const PROPS  = PropertiesService.getScriptProperties();
const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ---------------------------------------------------------------------
//  WEB ENTRY POINTS
// ---------------------------------------------------------------------
function doPost(e) {
  const p = (e && e.parameter) || {};
  if (p.k !== TOKEN || p.AccountSid !== ACCOUNT_SID) return txt('forbidden');
  if (p.type === 'voice') return answerCall(p);   // Twilio: "A call comes in"
  return callFinished(p);                        // Twilio: "Call status changes"
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.k !== TOKEN) return HtmlService.createHtmlOutput('Access denied');
  if (p.action === 'pause')  PROPS.setProperty('paused', '1');
  if (p.action === 'resume') PROPS.deleteProperty('paused');
  return statusPage(p.action);
}

// ---------------------------------------------------------------------
//  1) ANSWER THE CALL — open the gate unless paused
// ---------------------------------------------------------------------
function answerCall(p) {
  const paused = isPaused();
  CacheService.getScriptCache().put('c_' + p.CallSid, paused ? 'paused' : 'opened', 21600);
  const twiml = paused
    ? '<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>'
    : '<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Play digits="' + OPEN_DIGIT + '"/><Pause length="1"/><Hangup/></Response>';
  return ContentService.createTextOutput(twiml).setMimeType(ContentService.MimeType.XML);
}

// ---------------------------------------------------------------------
//  2) CALL FINISHED — classify, log and notify
// ---------------------------------------------------------------------
function callFinished(p) {
  const date = p.Timestamp ? new Date(p.Timestamp) : new Date();
  const mode = CacheService.getScriptCache().get('c_' + p.CallSid);   // opened | paused | null
  const dur  = Number(p.CallDuration || 0);
  const hour24 = Number(Utilities.formatDate(date, TZ, 'H'));

  let status;
  if (mode === 'paused')                              status = 'paused';
  else if (p.CallStatus === 'completed' && dur >= 2)  status = 'opened';
  else                                                status = 'failed';

  const d = {
    status,
    fromCallBox: p.From === CALL_BOX,
    night: status === 'opened' && hour24 >= NIGHT_FROM && hour24 < NIGHT_TO,
    time:  Utilities.formatDate(date, TZ, 'h:mm a'),
    day:   longDate(date),
    who:   p.From === CALL_BOX ? 'Call box' : formatPhone(p.From),
    dur:   dur + ' s',
    from:  p.From || '',
    sid:   p.CallSid || '',
    twilioStatus: p.CallStatus || ''
  };

  try { logToSheet(date, d); } catch (err) { console.error('Sheet: ' + err); }
  sendAlert(d);
  return txt('ok');
}

function sendAlert(d) {
  const t = theme(d);
  const subject = t.icon + ' ' + t.title + ' · ' + d.time;
  const plain   = t.title + '\n' + d.day + ' · ' + d.time + '\nFrom: ' + d.who + ' · Duration: ' + d.dur;
  MailApp.sendEmail({ to: EMAIL, subject: subject, body: plain, htmlBody: callEmail(d, t), name: 'Gatekeeper' });
}

// Priority: failed > paused > night > unknown caller > normal
function theme(d) {
  if (d.status === 'failed') return { icon: '❌', title: 'Gate did NOT open',      color: '#dc2626', bg: '#fee2e2', digit: ['❌', 'No'] };
  if (d.status === 'paused') return { icon: '⏸️', title: 'Call rejected (paused)', color: '#475569', bg: '#e2e8f0', digit: ['⏸️', 'Paused'] };
  if (d.night)               return { icon: '🌙', title: 'Night opening',          color: '#7c3aed', bg: '#ede9fe', digit: ['9️⃣', 'Sent'] };
  if (!d.fromCallBox)        return { icon: '⚠️', title: 'Call from another number', color: '#d97706', bg: '#fef3c7', digit: ['9️⃣', 'Sent'] };
  return                            { icon: '🔓', title: 'Gate opened',            color: '#16a34a', bg: '#dcfce7', digit: ['9️⃣', 'Sent'] };
}

// ---------------------------------------------------------------------
//  3) CALL HISTORY IN GOOGLE SHEETS
// ---------------------------------------------------------------------
const COLS = ['Date & time', 'Day', 'Time', 'From', 'Call box', 'Result', 'Duration (s)', 'Night', 'Twilio status', 'Call SID'];

function sheet() {
  return SpreadsheetApp.openById(PROPS.getProperty('sheetId')).getSheets()[0];
}

function logToSheet(date, d) {
  const names = { opened: 'Opened', failed: 'Did NOT open', paused: 'Rejected (paused)' };
  sheet().appendRow([date, d.day, d.time, d.from, d.fromCallBox ? 'Yes' : 'No', names[d.status],
                     parseInt(d.dur, 10), d.night ? 'Yes' : 'No', d.twilioStatus, d.sid]);
}

// ---------------------------------------------------------------------
//  4) WEEKLY SUMMARY (Sundays 8 PM)
// ---------------------------------------------------------------------
function weeklySummary() {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = sheet().getDataRange().getValues().slice(1).filter(r => r[0] instanceof Date && r[0] >= since);

  const opened   = rows.filter(r => r[5] === 'Opened');
  const failed   = rows.filter(r => r[5] === 'Did NOT open').length;
  const paused   = rows.filter(r => r[5] === 'Rejected (paused)').length;
  const unknown  = rows.filter(r => r[4] === 'No').length;
  const night    = rows.filter(r => r[7] === 'Yes').length;

  const byHour = {}, byDay = {};
  opened.forEach(r => {
    const h  = Number(Utilities.formatDate(r[0], TZ, 'H'));
    const dw = Number(Utilities.formatDate(r[0], TZ, 'u')) % 7;
    byHour[h] = (byHour[h] || 0) + 1;
    byDay[dw] = (byDay[dw] || 0) + 1;
  });
  const top = o => Object.keys(o).sort((a, b) => o[b] - o[a])[0];
  const hTop = top(byHour), dTop = top(byDay);

  const range = Utilities.formatDate(since, TZ, 'M/d') + ' – ' + Utilities.formatDate(new Date(), TZ, 'M/d');
  const s = {
    range, opened: opened.length, failed, paused, unknown, night,
    peakHour: hTop === undefined ? '—' : hourLabel(Number(hTop)),
    busiestDay: dTop === undefined ? '—' : DAYS[Number(dTop)]
  };
  const plain = 'Gatekeeper weekly summary (' + range + ')\nOpened: ' + s.opened + ' · Failed: ' + failed +
                ' · Rejected: ' + paused + ' · Other numbers: ' + unknown + ' · Night: ' + night;
  MailApp.sendEmail({ to: EMAIL, subject: '📊 Gatekeeper weekly summary · ' + range, body: plain,
                      htmlBody: summaryEmail(s), name: 'Gatekeeper' });
}

// ---------------------------------------------------------------------
//  5) ONE-TIME SETUP — run once from the editor
// ---------------------------------------------------------------------
function setup() {
  if (!PROPS.getProperty('sheetId')) {
    const ss = SpreadsheetApp.create('Gatekeeper · Call history');
    const sh = ss.getSheets()[0];
    sh.setName('Calls');
    sh.appendRow(COLS);
    sh.getRange(1, 1, 1, COLS.length).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('yyyy-MM-dd HH:mm:ss');
    sh.getRange('D:D').setNumberFormat('@');          // keep the "+" in phone numbers
    sh.setColumnWidths(1, COLS.length, 130);
    ss.setSpreadsheetTimeZone(TZ);
    PROPS.setProperty('sheetId', ss.getId());
    PROPS.setProperty('sheetUrl', ss.getUrl());
  }
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'weeklySummary')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('weeklySummary').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(20).inTimezone(TZ).create();
  console.log('Done. History sheet: ' + PROPS.getProperty('sheetUrl'));
}

// ---------------------------------------------------------------------
//  HTML TEMPLATES
// ---------------------------------------------------------------------
const FONT = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';

function stat(emoji, value, label) {
  return '<td align="center" style="padding:0 6px;width:33%;vertical-align:top">' +
    '<div style="width:60px;height:60px;line-height:60px;border-radius:50%;background:#f1f5f9;font-size:26px;margin:0 auto">' + emoji + '</div>' +
    '<div style="font-size:15px;font-weight:700;color:#0f172a;margin-top:8px">' + value + '</div>' +
    '<div style="font-size:12px;color:#64748b">' + label + '</div></td>';
}

function roundButton(href, emoji, label, bg) {
  return '<td align="center" style="padding:0 8px;vertical-align:top"><a href="' + href + '" style="text-decoration:none">' +
    '<div style="width:56px;height:56px;line-height:56px;border-radius:50%;background:' + bg + ';font-size:24px;margin:0 auto">' + emoji + '</div>' +
    '<div style="font-size:12px;color:#334155;margin-top:6px">' + label + '</div></a></td>';
}

function card(content, footer) {
  return '<div style="background:#f8fafc;padding:24px 12px;' + FONT + '">' +
    '<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:24px;padding:32px 18px;box-shadow:0 2px 12px rgba(0,0,0,.06)">' +
    content + '</div><div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:12px">' + (footer || '') + '</div></div>';
}

function header(icon, title, big, small, color, bg) {
  return '<div style="width:96px;height:96px;line-height:96px;border-radius:50%;background:' + bg + ';border:3px solid ' + color + ';font-size:44px;text-align:center;margin:0 auto">' + icon + '</div>' +
    '<div style="text-align:center;font-size:24px;font-weight:800;color:' + color + ';margin-top:16px">' + title + '</div>' +
    '<div style="text-align:center;font-size:30px;font-weight:700;color:#0f172a;margin-top:4px">' + big + '</div>' +
    '<div style="text-align:center;font-size:14px;color:#64748b">' + small + '</div>';
}

function buttonRow(extra) {
  const paused = isPaused();
  const sheetUrl = PROPS.getProperty('sheetUrl') || '#';
  const panel = WEB_URL + '?k=' + TOKEN;
  return '<div style="height:1px;background:#e2e8f0;margin:28px 0 22px"></div>' +
    '<table role="presentation" align="center" style="margin:0 auto;border-collapse:collapse"><tr>' +
      (extra || '') +
      roundButton(sheetUrl, '📊', 'History', '#fef9c3') +
      (paused ? roundButton(panel, '▶️', 'Resume', '#dcfce7') : roundButton(panel, '⏸️', 'Pause', '#f1f5f9')) +
    '</tr></table>';
}

function callEmail(d, t) {
  const pausedNote = (isPaused() && d.status !== 'paused')
    ? '<div style="text-align:center;margin-top:14px;font-size:13px;color:#475569;background:#f1f5f9;border-radius:12px;padding:8px">⏸️ Automatic opening is paused</div>' : '';
  const failNote = d.status === 'failed'
    ? '<div style="text-align:center;margin-top:14px;font-size:13px;color:#991b1b;background:#fee2e2;border-radius:12px;padding:8px">Twilio status: ' + d.twilioStatus + '</div>' : '';
  return card(
    header(t.icon, t.title, d.time, d.day, t.color, t.bg) + failNote + pausedNote +
    '<table role="presentation" width="100%" style="margin-top:28px;border-collapse:collapse"><tr>' +
      stat('📞', d.who, 'Caller') + stat('⏱️', d.dur, 'Duration') + stat(t.digit[0], t.digit[1], 'Open signal') +
    '</tr></table>' +
    buttonRow(
      roundButton('https://console.twilio.com/us1/monitor/logs/calls/' + d.sid, '📋', 'Call log', '#e0e7ff') +
      roundButton('tel:' + d.from, '📲', 'Call back', '#dcfce7')),
    d.sid);
}

function summaryEmail(s) {
  const row = (a, b, c) => '<table role="presentation" width="100%" style="margin-top:22px;border-collapse:collapse"><tr>' + a + b + c + '</tr></table>';
  return card(
    header('📊', 'Weekly summary', s.opened + ' openings', s.range, '#2563eb', '#dbeafe') +
    row(stat('🔓', s.opened, 'Opened'), stat('❌', s.failed, 'Failed'), stat('⏸️', s.paused, 'Rejected')) +
    row(stat('🌙', s.night, 'Night'), stat('⚠️', s.unknown, 'Other numbers'), stat('🕐', s.peakHour, 'Peak hour')) +
    '<div style="text-align:center;margin-top:18px;font-size:14px;color:#475569">Busiest day: <b>' + s.busiestDay + '</b></div>' +
    buttonRow(''),
    'Sent every Sunday at 8 PM');
}

function statusPage(action) {
  const paused = isPaused();
  const t = paused
    ? { icon: '⏸️', title: 'Opening paused', text: 'Calls from the call box are rejected and the gate will NOT open.', color: '#475569', bg: '#e2e8f0',
        btn: 'Resume opening', act: 'resume', btnBg: '#16a34a' }
    : { icon: '🔓', title: 'Opening active', text: 'The gate opens automatically when the call box dials in.',      color: '#16a34a', bg: '#dcfce7',
        btn: 'Pause opening',  act: 'pause',  btnBg: '#475569' };
  const saved = action ? '<div style="margin-top:16px;color:#16a34a;font-weight:600">✓ Saved</div>' : '';
  const html = '<div style="' + FONT + ';text-align:center;padding:48px 20px;max-width:420px;margin:0 auto">' +
    '<div style="width:120px;height:120px;line-height:120px;border-radius:50%;background:' + t.bg + ';border:4px solid ' + t.color + ';font-size:56px;margin:0 auto">' + t.icon + '</div>' +
    '<h1 style="color:' + t.color + ';font-size:28px;margin:20px 0 8px">' + t.title + '</h1>' +
    '<p style="color:#475569;font-size:16px;margin:0">' + t.text + '</p>' + saved +
    '<a target="_top" href="' + WEB_URL + '?k=' + TOKEN + '&action=' + t.act + '" style="display:inline-block;margin-top:32px;background:' + t.btnBg + ';color:#fff;text-decoration:none;font-size:18px;font-weight:700;padding:16px 32px;border-radius:999px">' + t.btn + '</a>' +
    '</div>';
  return HtmlService.createHtmlOutput(html).setTitle('Gatekeeper').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------------------
//  UTILITIES
// ---------------------------------------------------------------------
function isPaused() { return PROPS.getProperty('paused') === '1'; }
function txt(s) { return ContentService.createTextOutput(s); }
function hourLabel(h) { return ((h % 12) || 12) + ' ' + (h < 12 ? 'AM' : 'PM'); }

function longDate(f) {
  const z = s => Number(Utilities.formatDate(f, TZ, s));
  return DAYS[z('u') % 7] + ', ' + MONTHS[z('M') - 1] + ' ' + z('d');
}

function formatPhone(n) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n || '');
  return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : (n || 'Unknown');
}

// ---------------------------------------------------------------------
//  MANUAL TESTS (run from the editor)
// ---------------------------------------------------------------------
function testSummary() { weeklySummary(); }
