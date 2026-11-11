// =====================================================================
//  GATEKEEPER v1.1
//  Hands-free gate opener + alerts + schedules + admin panel.
//  Twilio + Google Apps Script.  https://github.com/javiten/gatekeeper
//
//  Twilio ──(incoming call)──► doPost type=voice → open / reject / forward / message
//  Twilio ──(forward ended)──► doPost type=dial  → optional "open anyway" fallback
//  Twilio ──(call finished)──► doPost            → classify, log to Sheets, email you
//  You    ──(browser)────────► doGet             → admin panel (owner only)
//  Trigger ─(Sundays 8 PM)──► weeklySummary()    → summary email
// =====================================================================

// <CONFIG> ------------------------------------------------------------
const LANG        = 'en';                                // 'en' or 'es'
const EMAIL       = 'you@example.com';                   // where alerts are sent
const TOKEN       = 'CHANGE_ME_TO_A_LONG_RANDOM_STRING'; // secret included in Twilio URLs
const ACCOUNT_SID = 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // your Twilio Account SID
const CALL_BOX    = '+15550100123';                      // number your call box dials from
const OPEN_DIGIT  = '9';                                 // DTMF digit that opens your gate
const TZ          = 'America/New_York';                  // your time zone
const WEB_URL     = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'; // public (Twilio) deployment URL
// </CONFIG> -----------------------------------------------------------

const VERSION = '1.1.1';
const PROPS   = PropertiesService.getScriptProperties();
const ACTIONS = ['reject', 'forward', 'message', 'open_alert'];

// ---------------------------------------------------------------------
//  TEXTS (es / en)
// ---------------------------------------------------------------------
const I18N = {
  en: {
    days: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
    daysShort: ['S','M','T','W','T','F','S'],
    months: ['January','February','March','April','May','June','July','August','September','October','November','December'],
    longDate: (dw, d, m) => dw + ', ' + m + ' ' + d,
    voice: { language: 'en-US', voice: 'Polly.Joanna' },
    defaultMessage: 'No one is available to open the gate right now. Thank you.',
    t: {
      opened: 'Gate opened', night: 'Night opening', unknown: 'Call from another number', failed: 'Gate did NOT open',
      rejected: 'Call rejected', message: 'Message played', fwd_answered: 'Forwarded · you answered',
      fwd_missed: 'Forwarded · missed', fwd_opened: 'Forwarded · opened anyway', opened_alert: 'Opened during restricted hours',
      caller: 'Caller', duration: 'Duration', openSignal: 'Open signal', sent: 'Sent', no: 'No', callBox: 'Call box',
      unknownNum: 'Unknown', callLog: 'Call log', callBack: 'Call back', history: 'History', panel: 'Panel',
      manualPause: 'Manual pause', schedule: 'Schedule', twilioStatus: 'Twilio status', yes: 'Yes',
      weekly: 'Weekly summary', openings: 'openings', sumOpened: 'Opened', sumFailed: 'Failed', sumBlocked: 'Blocked',
      sumForwarded: 'Forwarded', sumNight: 'Night', sumOther: 'Other numbers', peak: 'Peak hour', busiest: 'Busiest day',
      sumFooter: 'Sent every Sunday at 8 PM', subjectWeekly: 'Gatekeeper weekly summary',
      cols: ['Date & time','Day','Time','From','Call box','Result','Duration (s)','Night','Twilio status','Call SID','Code','Reason'],
      sheetName: 'Gatekeeper · Call history', tabName: 'Calls',
      act_reject: 'Reject the call', act_forward: 'Forward to my phone', act_message: 'Play a message and hang up', act_open_alert: 'Open anyway + urgent alert',
      // panel
      p_title: 'Gatekeeper', p_now: 'Right now', p_mode: 'Mode', m_auto: 'Automatic', m_open: 'Always open', m_paused: 'Paused',
      m_auto_d: 'Opens automatically and follows your schedules.', m_open_d: 'Always opens. Schedules are ignored.', m_paused_d: 'Never opens automatically.',
      s_open: 'Opening automatically', s_forced: 'Always open', s_paused: 'Paused', s_sched: 'Paused by schedule', until: 'until',
      will_open: 'Calls open the gate', will: 'Calls will:', pausedAction: 'While paused, calls should…',
      schedules: 'Schedules', sched_hint: 'During these times the gate does not open automatically.', addRule: 'Add schedule',
      ruleName: 'Name', from: 'From', to: 'To', action: 'Action', allDay: 'all day', newRule: 'Night',
      fwd: 'Call forwarding', fwdNumber: 'My phone number', fwdTimeout: 'Ring for', seconds: 'seconds', fwdFallback: 'If I don\'t answer', fb_hangup: 'Hang up', fb_open: 'Open the gate anyway',
      msg: 'Message', msgHint: 'Read aloud to the visitor when the action is "Play a message".',
      alerts: 'Alerts', nightWin: 'Night alert window', summaryOn: 'Weekly summary email (Sundays 8 PM)',
      recent: 'Recent calls', noCalls: 'No calls yet', save: 'Save changes', saved: 'Saved ✓', saving: 'Saving…',
      err_phone: 'Enter your phone number in +1XXXXXXXXXX format to use forwarding.', err_time: 'Check the schedule times (HH:MM).',
      err_days: 'Each schedule needs at least one day.', version: 'Version',
      denied: 'Access denied', sp_active: 'Opening active', sp_paused: 'Opening paused', sp_active_d: 'The gate opens automatically when the call box dials in.',
      sp_paused_d: 'Calls from the call box will NOT open the gate.', sp_pause: 'Pause opening', sp_resume: 'Resume opening', sp_saved: '✓ Saved',
      access: 'Access', accessHint: 'This page opens with your private link. Save it to your home screen and don\'t share it: anyone with the link can control the gate.',
      copyLink: 'Copy link', copied: 'Copied ✓', newLink: 'Create a new link', newLinkConfirm: 'The current link (and the ⚙️ button in old emails) will stop working. Continue?', newLinkDone: 'New link created. Open it and save it to your home screen:'
    }
  },
  es: {
    days: ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'],
    daysShort: ['D','L','M','M','J','V','S'],
    months: ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],
    longDate: (dw, d, m) => cap_(dw) + ' ' + d + ' de ' + m,
    voice: { language: 'es-MX', voice: 'Polly.Mia' },
    defaultMessage: 'En este momento no hay nadie disponible para abrir. Gracias.',
    t: {
      opened: 'Gate abierto', night: 'Apertura nocturna', unknown: 'Llamada de otro número', failed: 'El gate NO se abrió',
      rejected: 'Llamada rechazada', message: 'Mensaje y corte', fwd_answered: 'Desviada · atendiste',
      fwd_missed: 'Desviada · no atendiste', fwd_opened: 'Desviada · se abrió igual', opened_alert: 'Abierto en horario restringido',
      caller: 'Llamó', duration: 'Duración', openSignal: 'Apertura', sent: 'Enviado', no: 'No', callBox: 'Portero',
      unknownNum: 'Desconocido', callLog: 'Ver log', callBack: 'Llamar', history: 'Historial', panel: 'Panel',
      manualPause: 'Pausa manual', schedule: 'Horario', twilioStatus: 'Estado de Twilio', yes: 'Sí',
      weekly: 'Resumen semanal', openings: 'aperturas', sumOpened: 'Aperturas', sumFailed: 'Fallos', sumBlocked: 'Bloqueadas',
      sumForwarded: 'Desviadas', sumNight: 'Nocturnas', sumOther: 'Otros números', peak: 'Hora pico', busiest: 'Día con más movimiento',
      sumFooter: 'Se envía todos los domingos a las 8 PM', subjectWeekly: 'Resumen semanal del gate',
      cols: ['Fecha y hora','Día','Hora','De','Portero','Resultado','Duración (s)','Nocturna','Estado Twilio','Call SID','Código','Motivo'],
      sheetName: 'Gate · Historial de llamadas', tabName: 'Llamadas',
      act_reject: 'Rechazar la llamada', act_forward: 'Desviar a mi celular', act_message: 'Reproducir un mensaje y cortar', act_open_alert: 'Abrir igual + alerta urgente',
      p_title: 'Gatekeeper', p_now: 'Ahora mismo', p_mode: 'Modo', m_auto: 'Automático', m_open: 'Siempre abrir', m_paused: 'Pausado',
      m_auto_d: 'Abre solo y respeta tus horarios.', m_open_d: 'Abre siempre. Ignora los horarios.', m_paused_d: 'No abre automáticamente.',
      s_open: 'Abriendo automáticamente', s_forced: 'Siempre abierto', s_paused: 'En pausa', s_sched: 'En pausa por horario', until: 'hasta',
      will_open: 'Las llamadas abren el gate', will: 'Las llamadas van a:', pausedAction: 'Durante la pausa, las llamadas…',
      schedules: 'Horarios', sched_hint: 'En estos horarios el gate no se abre automáticamente.', addRule: 'Agregar horario',
      ruleName: 'Nombre', from: 'Desde', to: 'Hasta', action: 'Acción', allDay: 'todo el día', newRule: 'Noche',
      fwd: 'Desvío de llamadas', fwdNumber: 'Mi número de celular', fwdTimeout: 'Sonar durante', seconds: 'segundos', fwdFallback: 'Si no atiendo', fb_hangup: 'Cortar', fb_open: 'Abrir el gate igual',
      msg: 'Mensaje', msgHint: 'Se lee en voz alta al visitante cuando la acción es "Reproducir un mensaje".',
      alerts: 'Alertas', nightWin: 'Alerta de apertura nocturna', summaryOn: 'Resumen semanal por email (domingos 8 PM)',
      recent: 'Últimas llamadas', noCalls: 'Todavía no hay llamadas', save: 'Guardar cambios', saved: 'Guardado ✓', saving: 'Guardando…',
      err_phone: 'Ingresá tu celular en formato +1XXXXXXXXXX para usar el desvío.', err_time: 'Revisá las horas de los horarios (HH:MM).',
      err_days: 'Cada horario necesita al menos un día.', version: 'Versión',
      denied: 'Acceso denegado', sp_active: 'Apertura activa', sp_paused: 'Apertura en pausa', sp_active_d: 'El gate se abre solo cuando llama el portero.',
      sp_paused_d: 'Las llamadas del portero NO abren el gate.', sp_pause: 'Pausar apertura', sp_resume: 'Activar apertura', sp_saved: '✓ Cambio guardado',
      access: 'Acceso', accessHint: 'Este panel se abre con tu link privado. Guardalo en la pantalla de inicio y no lo compartas: quien tenga el link puede manejar el gate.',
      copyLink: 'Copiar link', copied: 'Copiado ✓', newLink: 'Generar un link nuevo', newLinkConfirm: 'El link actual (y el botón ⚙️ de los emails viejos) va a dejar de funcionar. ¿Seguir?', newLinkDone: 'Link nuevo creado. Abrilo y guardalo en la pantalla de inicio:'
    }
  }
};
const L = I18N[LANG] || I18N.en;
const T = L.t;

// ---------------------------------------------------------------------
//  SETTINGS (stored in Script Properties, edited from the panel)
// ---------------------------------------------------------------------
function defaults_() {
  return {
    mode: 'auto',                 // auto | open | paused
    pausedAction: 'reject',       // action used while mode = paused
    rules: [],                    // [{id, name, enabled, days:[0-6], from:'HH:MM', to:'HH:MM', action}]
    forward: { number: '', timeout: 25, fallback: 'hangup' },  // fallback: hangup | open
    message: L.defaultMessage,
    night: { from: 0, to: 6 },
    summary: true
  };
}

function cfg_() {
  const d = defaults_();
  let c = {};
  try { c = JSON.parse(PROPS.getProperty('config') || '{}'); } catch (e) {}
  // v1.0 → v1.1: the old "paused" / "pausado" flag becomes mode = paused
  if (!c.mode && (PROPS.getProperty('paused') === '1' || PROPS.getProperty('pausado') === '1')) c.mode = 'paused';
  return Object.assign(d, c, { forward: Object.assign(d.forward, c.forward || {}), night: Object.assign(d.night, c.night || {}) });
}

function saveCfg_(c) {
  PROPS.setProperty('config', JSON.stringify(c));
  PROPS.deleteProperty('paused'); PROPS.deleteProperty('pausado');
}

// ---------------------------------------------------------------------
//  SCHEDULE ENGINE
// ---------------------------------------------------------------------
function toMin_(hhmm) { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; }
function nowParts_(d) {
  return { dow: Number(Utilities.formatDate(d, TZ, 'u')) % 7, min: Number(Utilities.formatDate(d, TZ, 'H')) * 60 + Number(Utilities.formatDate(d, TZ, 'm')) };
}

function ruleActive_(r, d) {
  if (!r.enabled || !r.days || !r.days.length) return false;
  const n = nowParts_(d), f = toMin_(r.from), t = toMin_(r.to);
  if (isNaN(f) || isNaN(t)) return false;
  if (f === t) return r.days.indexOf(n.dow) >= 0;                                  // all day
  if (f < t)   return r.days.indexOf(n.dow) >= 0 && n.min >= f && n.min < t;       // same day
  return (r.days.indexOf(n.dow) >= 0 && n.min >= f) ||                             // overnight
         (r.days.indexOf((n.dow + 6) % 7) >= 0 && n.min < t);
}

// What happens to a call right now?  → { open, reason, action, rule }
function state_(d, c) {
  c = c || cfg_(); d = d || new Date();
  if (c.mode === 'open')   return { open: true,  reason: 'forced' };
  if (c.mode === 'paused') return { open: false, reason: 'manual', action: c.pausedAction };
  const r = c.rules.filter(x => ruleActive_(x, d))[0];
  if (r) return { open: false, reason: 'schedule', action: r.action, rule: r };
  return { open: true, reason: 'auto' };
}

// ---------------------------------------------------------------------
//  WEB ENTRY POINTS
// ---------------------------------------------------------------------
function doPost(e) {
  const p = (e && e.parameter) || {};
  if (p.k !== TOKEN || p.AccountSid !== ACCOUNT_SID) return txt_('forbidden');
  const type = p.type || p.tipo;
  if (type === 'voice' || type === 'voz') return answerCall_(p);
  if (type === 'dial') return dialEnded_(p);
  return callFinished_(p);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.p && p.p === panelKey_()) return panelPage_(p.p);  // private panel link (works on any phone, no Google sign-in)
  if (isOwner_()) return panelPage_('');                  // signed in as the script owner
  if (p.k === TOKEN) return quickPage_(p.action || ({ pausar: 'pause', activar: 'resume' })[p.accion]);
  return txt_(T.denied);   // plain text: no HtmlService bridge for strangers
}

function isOwner_() {
  try {
    const me = Session.getActiveUser().getEmail();
    return !!me && me === Session.getEffectiveUser().getEmail();
  } catch (e) { return false; }
}

// Private panel link: WEB_URL?p=<key>. The key lives only in Script Properties (never in the code).
function panelKey_() {
  let k = PROPS.getProperty('panelKey');
  if (!k) { k = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); PROPS.setProperty('panelKey', k); }
  return k;
}
function panelLink_() { return WEB_URL + '?p=' + panelKey_(); }
function auth_(key) { if (!(isOwner_() || (key && key === panelKey_()))) throw new Error(T.denied); }

// ---------------------------------------------------------------------
//  1) ANSWER THE CALL
// ---------------------------------------------------------------------
function answerCall_(p) {
  const c = cfg_();
  const s = state_(new Date(), c);
  let rec, twiml;

  if (s.open || s.action === 'open_alert') {
    rec = { o: s.open ? 'opened' : 'opened_alert' };
    twiml = openTwiml_();
  } else if (s.action === 'forward' && /^\+\d{8,15}$/.test(c.forward.number)) {
    rec = { o: 'forwarded' };
    const action = xml_(WEB_URL + '?k=' + TOKEN + '&type=dial');
    twiml = '<Response><Dial timeout="' + Number(c.forward.timeout || 25) + '" answerOnBridge="true" action="' + action + '" method="POST">' +
            '<Number>' + xml_(c.forward.number) + '</Number></Dial></Response>';
  } else if (s.action === 'message') {
    rec = { o: 'message' };
    twiml = '<Response><Pause length="1"/><Say language="' + L.voice.language + '" voice="' + L.voice.voice + '">' +
            xml_(c.message || L.defaultMessage) + '</Say><Hangup/></Response>';
  } else {
    rec = { o: 'rejected' };
    twiml = '<Response><Reject reason="busy"/></Response>';
  }
  rec.why = s.reason;
  if (s.rule) rec.rule = s.rule.name + ' (' + s.rule.from + '–' + s.rule.to + ')';
  putRec_(p.CallSid, rec);
  return xmlOut_(twiml);
}

function dialEnded_(p) {
  const rec = getRec_(p.CallSid) || { o: 'forwarded' };
  rec.dial = p.DialCallStatus || '';
  if (rec.dial !== 'completed' && cfg_().forward.fallback === 'open') {
    rec.fb = 'opened';
    putRec_(p.CallSid, rec);
    return xmlOut_(openTwiml_());
  }
  putRec_(p.CallSid, rec);
  return xmlOut_('<Response><Hangup/></Response>');
}

function openTwiml_() {
  return '<Response><Pause length="1"/><Play digits="' + OPEN_DIGIT + '"/><Pause length="1"/><Hangup/></Response>';
}

// ---------------------------------------------------------------------
//  2) CALL FINISHED — classify, log and notify
// ---------------------------------------------------------------------
function callFinished_(p) {
  const c = cfg_();
  const date = p.Timestamp ? new Date(p.Timestamp) : new Date();
  const rec = getRec_(p.CallSid);                         // null when the fallback TwiML Bin answered
  const dur = Number(p.CallDuration || 0);
  const ok = p.CallStatus === 'completed' && dur >= 2;
  const hour = Number(Utilities.formatDate(date, TZ, 'H'));

  let code;
  const o = rec ? rec.o : 'opened';
  if (o === 'opened' || o === 'opened_alert') code = ok ? o : 'failed';
  else if (o === 'forwarded') code = rec.dial === 'completed' ? 'fwd_answered' : (rec.fb === 'opened' ? 'fwd_opened' : 'fwd_missed');
  else code = o;                                           // rejected | message

  const d = {
    code: code,
    fromCallBox: p.From === CALL_BOX,
    night: (code === 'opened' || code === 'opened_alert' || code === 'fwd_opened') && inNight_(hour, c.night),
    time: Utilities.formatDate(date, TZ, 'h:mm a'),
    day: longDate_(date),
    who: p.From === CALL_BOX ? T.callBox : formatPhone_(p.From),
    dur: dur + ' s',
    from: p.From || '',
    sid: p.CallSid || '',
    twilioStatus: p.CallStatus || '',
    reason: rec && rec.why === 'manual' ? T.manualPause : (rec && rec.rule ? T.schedule + ': ' + rec.rule : '')
  };

  try { logToSheet_(date, d); } catch (err) { console.error('Sheet: ' + err); }
  sendAlert_(d);
  return txt_('ok');
}

function inNight_(h, n) { return n.from <= n.to ? (h >= n.from && h < n.to) : (h >= n.from || h < n.to); }

function sendAlert_(d) {
  const t = theme_(d);
  const plain = t.title + '\n' + d.day + ' · ' + d.time + '\n' + T.caller + ': ' + d.who + ' · ' + T.duration + ': ' + d.dur + (d.reason ? '\n' + d.reason : '');
  MailApp.sendEmail({ to: EMAIL, subject: t.icon + ' ' + t.title + ' · ' + d.time, body: plain, htmlBody: callEmail_(d, t), name: 'Gatekeeper' });
}

// Look of each result. Opened variants are refined by night / unknown caller.
function theme_(d) {
  const K = {
    failed:       { icon: '❌', color: '#dc2626', bg: '#fee2e2', sig: ['❌', T.no] },
    rejected:     { icon: '⛔', color: '#475569', bg: '#e2e8f0', sig: ['⛔', T.no] },
    message:      { icon: '🔇', color: '#475569', bg: '#e2e8f0', sig: ['🔇', T.no] },
    fwd_answered: { icon: '📲', color: '#2563eb', bg: '#dbeafe', sig: ['📲', T.yes] },
    fwd_missed:   { icon: '📵', color: '#d97706', bg: '#fef3c7', sig: ['📵', T.no] },
    fwd_opened:   { icon: '🔓', color: '#0891b2', bg: '#cffafe', sig: ['9️⃣', T.sent] },
    opened_alert: { icon: '🚨', color: '#dc2626', bg: '#fee2e2', sig: ['9️⃣', T.sent] },
    opened:       { icon: '🔓', color: '#16a34a', bg: '#dcfce7', sig: ['9️⃣', T.sent] }
  };
  let k = d.code, x = Object.assign({ title: T[k] }, K[k] || K.opened);
  if (k === 'opened' && d.night)       x = Object.assign(x, { icon: '🌙', title: T.night,   color: '#7c3aed', bg: '#ede9fe' });
  else if (k === 'opened' && !d.fromCallBox) x = Object.assign(x, { icon: '⚠️', title: T.unknown, color: '#d97706', bg: '#fef3c7' });
  return x;
}

// ---------------------------------------------------------------------
//  3) CALL HISTORY (Google Sheets)
// ---------------------------------------------------------------------
function sheet_() { return SpreadsheetApp.openById(PROPS.getProperty('sheetId')).getSheets()[0]; }

function logToSheet_(date, d) {
  const sh = sheet_();
  if (sh.getLastColumn() < T.cols.length) sh.getRange(1, 1, 1, T.cols.length).setValues([T.cols]);  // upgrade v1.0 header
  sh.appendRow([date, d.day, d.time, "'" + d.from, d.fromCallBox ? T.yes : 'No', theme_(d).title,
                parseInt(d.dur, 10), d.night ? T.yes : 'No', d.twilioStatus, d.sid, d.code, d.reason]);
}

function recentCalls_(n) {
  try {
    const sh = sheet_(), last = sh.getLastRow();
    if (last < 2) return [];
    const from = Math.max(2, last - n + 1);
    return sh.getRange(from, 1, last - from + 1, Math.min(sh.getLastColumn(), 12)).getValues().reverse().map(r => ({
      day: String(r[1]), time: String(r[2]), from: String(r[3]), result: String(r[5]), code: String(r[10] || 'opened')
    }));
  } catch (e) { return []; }
}

// ---------------------------------------------------------------------
//  4) WEEKLY SUMMARY
// ---------------------------------------------------------------------
function weeklySummary() {
  if (!cfg_().summary) return;
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = sheet_().getDataRange().getValues().slice(1).filter(r => r[0] instanceof Date && r[0] >= since);
  const code = r => String(r[10] || (r[5] === T.failed ? 'failed' : 'opened'));
  const is = list => r => list.indexOf(code(r)) >= 0;

  const opened  = rows.filter(is(['opened', 'opened_alert', 'fwd_opened']));
  const s = {
    opened: opened.length,
    failed: rows.filter(is(['failed'])).length,
    blocked: rows.filter(is(['rejected', 'message', 'fwd_missed'])).length,
    forwarded: rows.filter(is(['fwd_answered', 'fwd_missed', 'fwd_opened'])).length,
    night: rows.filter(r => r[7] === T.yes).length,
    unknown: rows.filter(r => r[4] === 'No').length
  };
  const byHour = {}, byDay = {};
  opened.forEach(r => {
    const h = Number(Utilities.formatDate(r[0], TZ, 'H')), dw = Number(Utilities.formatDate(r[0], TZ, 'u')) % 7;
    byHour[h] = (byHour[h] || 0) + 1; byDay[dw] = (byDay[dw] || 0) + 1;
  });
  const top = o => Object.keys(o).sort((a, b) => o[b] - o[a])[0];
  s.peak = top(byHour) === undefined ? '—' : hourLabel_(Number(top(byHour)));
  s.busiest = top(byDay) === undefined ? '—' : cap_(L.days[Number(top(byDay))]);
  s.range = Utilities.formatDate(since, TZ, LANG === 'es' ? 'd/M' : 'M/d') + ' – ' + Utilities.formatDate(new Date(), TZ, LANG === 'es' ? 'd/M' : 'M/d');

  const plain = T.weekly + ' (' + s.range + ')\n' + T.sumOpened + ': ' + s.opened + ' · ' + T.sumFailed + ': ' + s.failed +
                ' · ' + T.sumBlocked + ': ' + s.blocked + ' · ' + T.sumForwarded + ': ' + s.forwarded;
  MailApp.sendEmail({ to: EMAIL, subject: '📊 ' + T.subjectWeekly + ' · ' + s.range, body: plain, htmlBody: summaryEmail_(s), name: 'Gatekeeper' });
}

// ---------------------------------------------------------------------
//  5) ONE-TIME SETUP (run from the editor)
// ---------------------------------------------------------------------
function setup() {
  if (!isOwner_()) throw new Error(T.denied);
  if (!PROPS.getProperty('sheetId')) {
    const ss = SpreadsheetApp.create(T.sheetName);
    const sh = ss.getSheets()[0];
    sh.setName(T.tabName);
    sh.appendRow(T.cols);
    sh.getRange(1, 1, 1, T.cols.length).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('yyyy-MM-dd HH:mm:ss');
    sh.getRange('D:D').setNumberFormat('@');
    sh.setColumnWidths(1, T.cols.length, 130);
    ss.setSpreadsheetTimeZone(TZ);
    PROPS.setProperty('sheetId', ss.getId());
    PROPS.setProperty('sheetUrl', ss.getUrl());
  }
  if (!PROPS.getProperty('config')) saveCfg_(cfg_());
  ScriptApp.getProjectTriggers().filter(t => ['weeklySummary', 'resumenSemanal'].indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('weeklySummary').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(20).inTimezone(TZ).create();
  console.log('Gatekeeper ' + VERSION + ' ready. History: ' + PROPS.getProperty('sheetUrl'));
  console.log('Admin panel (private link, keep it secret): ' + panelLink_());
}

function testSummary() { if (isOwner_()) weeklySummary(); }

// ---------------------------------------------------------------------
//  6) ADMIN PANEL — server API (owner only)
// ---------------------------------------------------------------------
function panelData(key) {
  auth_(key);
  const c = cfg_(), s = state_(new Date(), c);
  return { cfg: c, state: describeState_(s, c), recent: recentCalls_(8), sheetUrl: PROPS.getProperty('sheetUrl') || '' };
}

function panelSave(c, key) {
  auth_(key);
  saveCfg_(validate_(c));
  return panelData(key);
}

// Invalidate the current private link and create a new one.
function panelNewLink(key) {
  auth_(key);
  PROPS.deleteProperty('panelKey');
  return panelLink_();
}

function validate_(c) {
  const d = defaults_(), out = {};
  out.mode = ['auto', 'open', 'paused'].indexOf(c.mode) >= 0 ? c.mode : 'auto';
  out.pausedAction = ACTIONS.indexOf(c.pausedAction) >= 0 ? c.pausedAction : 'reject';
  out.rules = (c.rules || []).slice(0, 12).map((r, i) => {
    if (isNaN(toMin_(r.from)) || isNaN(toMin_(r.to))) throw new Error(T.err_time);
    const days = (r.days || []).map(Number).filter(x => x >= 0 && x <= 6);
    if (!days.length) throw new Error(T.err_days);
    return { id: String(r.id || ('r' + Date.now() + i)).slice(0, 40), name: String(r.name || T.newRule).slice(0, 40),
             enabled: !!r.enabled, days: days, from: r.from, to: r.to,
             action: ACTIONS.indexOf(r.action) >= 0 ? r.action : 'reject' };
  });
  const f = c.forward || {};
  out.forward = { number: String(f.number || '').replace(/[^\d+]/g, ''),
                  timeout: Math.min(60, Math.max(10, Number(f.timeout) || 25)),
                  fallback: f.fallback === 'open' ? 'open' : 'hangup' };
  const usesFwd = out.pausedAction === 'forward' || out.rules.some(r => r.action === 'forward');
  if (usesFwd && !/^\+\d{8,15}$/.test(out.forward.number)) throw new Error(T.err_phone);
  out.message = String(c.message || d.message).slice(0, 300);
  const n = c.night || {};
  out.night = { from: Math.min(23, Math.max(0, Number(n.from) || 0)), to: Math.min(24, Math.max(0, Number(n.to) || 0)) };
  out.summary = !!c.summary;
  return out;
}

function describeState_(s, c) {
  const act = a => T['act_' + a];
  if (s.reason === 'forced') return { kind: 'open', icon: '🔓', title: T.s_forced, sub: T.will_open };
  if (s.reason === 'auto') return { kind: 'open', icon: '🔓', title: T.s_open, sub: T.will_open };
  if (s.reason === 'manual') return { kind: 'paused', icon: '⏸️', title: T.s_paused, sub: T.will + ' ' + act(s.action).toLowerCase() };
  return { kind: 'sched', icon: '🌙', title: T.s_sched + ' · ' + T.until + ' ' + hhmmLabel_(s.rule.to),
           sub: s.rule.name + ' — ' + act(s.action) };
}

// ---------------------------------------------------------------------
//  7) EMAIL TEMPLATES
// ---------------------------------------------------------------------
const FONT = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';

function stat_(emoji, value, label) {
  return '<td align="center" style="padding:0 6px;width:33%;vertical-align:top">' +
    '<div style="width:60px;height:60px;line-height:60px;border-radius:50%;background:#f1f5f9;font-size:26px;margin:0 auto">' + emoji + '</div>' +
    '<div style="font-size:15px;font-weight:700;color:#0f172a;margin-top:8px">' + value + '</div>' +
    '<div style="font-size:12px;color:#64748b">' + label + '</div></td>';
}
function roundButton_(href, emoji, label, bg) {
  return '<td align="center" style="padding:0 8px;vertical-align:top"><a href="' + href + '" style="text-decoration:none">' +
    '<div style="width:56px;height:56px;line-height:56px;border-radius:50%;background:' + bg + ';font-size:24px;margin:0 auto">' + emoji + '</div>' +
    '<div style="font-size:12px;color:#334155;margin-top:6px">' + label + '</div></a></td>';
}
function card_(content, footer) {
  return '<div style="background:#f8fafc;padding:24px 12px;' + FONT + '">' +
    '<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:24px;padding:32px 18px;box-shadow:0 2px 12px rgba(0,0,0,.06)">' +
    content + '</div><div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:12px">' + (footer || '') + '</div></div>';
}
function header_(icon, title, big, small, color, bg) {
  return '<div style="width:96px;height:96px;line-height:96px;border-radius:50%;background:' + bg + ';border:3px solid ' + color + ';font-size:44px;text-align:center;margin:0 auto">' + icon + '</div>' +
    '<div style="text-align:center;font-size:24px;font-weight:800;color:' + color + ';margin-top:16px">' + title + '</div>' +
    '<div style="text-align:center;font-size:30px;font-weight:700;color:#0f172a;margin-top:4px">' + big + '</div>' +
    '<div style="text-align:center;font-size:14px;color:#64748b">' + small + '</div>';
}
function note_(text, color, bg) {
  return '<div style="text-align:center;margin-top:14px;font-size:13px;color:' + color + ';background:' + bg + ';border-radius:12px;padding:8px">' + text + '</div>';
}
function buttonRow_(extra) {
  const panel = panelLink_();
  return '<div style="height:1px;background:#e2e8f0;margin:28px 0 22px"></div>' +
    '<table role="presentation" align="center" style="margin:0 auto;border-collapse:collapse"><tr>' + (extra || '') +
    roundButton_(PROPS.getProperty('sheetUrl') || '#', '📊', T.history, '#fef9c3') +
    roundButton_(panel, '⚙️', T.panel, '#f1f5f9') + '</tr></table>';
}

function callEmail_(d, t) {
  const notes = (d.code === 'failed' ? note_(T.twilioStatus + ': ' + d.twilioStatus, '#991b1b', '#fee2e2') : '') +
                (d.reason ? note_(d.reason, '#475569', '#f1f5f9') : '');
  return card_(
    header_(t.icon, t.title, d.time, d.day, t.color, t.bg) + notes +
    '<table role="presentation" width="100%" style="margin-top:28px;border-collapse:collapse"><tr>' +
      stat_('📞', d.who, T.caller) + stat_('⏱️', d.dur, T.duration) + stat_(t.sig[0], t.sig[1], T.openSignal) +
    '</tr></table>' +
    buttonRow_(roundButton_('https://console.twilio.com/us1/monitor/logs/calls/' + d.sid, '📋', T.callLog, '#e0e7ff') +
               roundButton_('tel:' + d.from, '📲', T.callBack, '#dcfce7')),
    d.sid);
}

function summaryEmail_(s) {
  const row = (a, b, c) => '<table role="presentation" width="100%" style="margin-top:22px;border-collapse:collapse"><tr>' + a + b + c + '</tr></table>';
  return card_(
    header_('📊', T.weekly, s.opened + ' ' + T.openings, s.range, '#2563eb', '#dbeafe') +
    row(stat_('🔓', s.opened, T.sumOpened), stat_('❌', s.failed, T.sumFailed), stat_('⛔', s.blocked, T.sumBlocked)) +
    row(stat_('📲', s.forwarded, T.sumForwarded), stat_('🌙', s.night, T.sumNight), stat_('⚠️', s.unknown, T.sumOther)) +
    '<div style="text-align:center;margin-top:18px;font-size:14px;color:#475569">' + T.peak + ': <b>' + s.peak + '</b> · ' + T.busiest + ': <b>' + s.busiest + '</b></div>' +
    buttonRow_(''), T.sumFooter);
}

// ---------------------------------------------------------------------
//  8) QUICK PAGE (token link, no Google sign-in) — pause / resume only
// ---------------------------------------------------------------------
function quickPage_(action) {
  if (action === 'pause' || action === 'resume') {
    const c = cfg_(); c.mode = action === 'pause' ? 'paused' : 'auto'; saveCfg_(c);
  }
  const paused = cfg_().mode === 'paused';
  const t = paused
    ? { icon: '⏸️', title: T.sp_paused, text: T.sp_paused_d, color: '#475569', bg: '#e2e8f0', btn: T.sp_resume, act: 'resume', btnBg: '#16a34a' }
    : { icon: '🔓', title: T.sp_active, text: T.sp_active_d, color: '#16a34a', bg: '#dcfce7', btn: T.sp_pause, act: 'pause', btnBg: '#475569' };
  const html = '<div style="' + FONT + ';text-align:center;padding:48px 20px;max-width:420px;margin:0 auto">' +
    '<div style="width:120px;height:120px;line-height:120px;border-radius:50%;background:' + t.bg + ';border:4px solid ' + t.color + ';font-size:56px;margin:0 auto">' + t.icon + '</div>' +
    '<h1 style="color:' + t.color + ';font-size:28px;margin:20px 0 8px">' + t.title + '</h1>' +
    '<p style="color:#475569;font-size:16px;margin:0">' + t.text + '</p>' +
    (action ? '<div style="margin-top:16px;color:#16a34a;font-weight:600">' + T.sp_saved + '</div>' : '') +
    '<a target="_top" href="' + WEB_URL + '?k=' + TOKEN + '&action=' + t.act + '" style="display:inline-block;margin-top:32px;background:' + t.btnBg +
    ';color:#fff;text-decoration:none;font-size:18px;font-weight:700;padding:16px 32px;border-radius:999px">' + t.btn + '</a></div>';
  return HtmlService.createHtmlOutput(html).setTitle('Gatekeeper').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------------------
//  9) ADMIN PANEL — page
// ---------------------------------------------------------------------
function panelPage_(key) {
  const boot = JSON.stringify({ data: panelData(key), key: key, link: panelLink_(), T: T, days: L.daysShort, version: VERSION }).replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutput(PANEL_HTML_.replace('__BOOT__', () => boot))
    .setTitle('Gatekeeper').addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

const PANEL_HTML_ = `<!doctype html><html><head><meta charset="utf-8">
<style>
:root{--bg:#f1f5f9;--card:#fff;--ink:#0f172a;--mute:#64748b;--line:#e2e8f0;--green:#16a34a;--slate:#475569;--violet:#7c3aed;--blue:#2563eb}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px 14px 110px}
.wrap{max-width:520px;margin:0 auto}h1{font-size:20px;margin:4px 4px 14px;display:flex;align-items:center;gap:8px}h1 small{font-size:12px;color:var(--mute);font-weight:500;margin-left:auto}
.card{background:var(--card);border-radius:22px;padding:18px;margin-bottom:14px;box-shadow:0 1px 3px rgba(15,23,42,.06)}
.card h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:0 0 12px}
.hero{text-align:center;padding:26px 18px}.ring{width:104px;height:104px;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:48px;border:4px solid}
.hero .t{font-size:22px;font-weight:800;margin-top:14px}.hero .s{color:var(--mute);margin-top:4px}
.k-open .ring{background:#dcfce7;border-color:var(--green)}.k-open .t{color:var(--green)}
.k-paused .ring{background:#e2e8f0;border-color:var(--slate)}.k-paused .t{color:var(--slate)}
.k-sched .ring{background:#ede9fe;border-color:var(--violet)}.k-sched .t{color:var(--violet)}
.seg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.seg button{border:0;border-radius:16px;padding:12px 6px;background:#f1f5f9;font:inherit;font-weight:700;color:var(--slate);cursor:pointer}
.seg button .e{display:block;font-size:24px;margin-bottom:4px}.seg button.on{background:var(--ink);color:#fff}
.hint{color:var(--mute);font-size:13px;margin-top:10px}
label.f{display:block;font-size:13px;color:var(--mute);margin:12px 0 6px}select,input[type=text],input[type=tel],input[type=time],textarea{width:100%;border:1px solid var(--line);border-radius:12px;padding:11px 12px;font:inherit;background:#fff;color:var(--ink)}
textarea{min-height:70px;resize:vertical}
.rule{border:1px solid var(--line);border-radius:18px;padding:14px;margin-bottom:10px}.rule.off{opacity:.55}
.rh{display:flex;gap:10px;align-items:center}.rh input{flex:1;font-weight:700}
.x{border:0;background:#fee2e2;color:#b91c1c;width:36px;height:36px;border-radius:50%;font-size:16px;cursor:pointer}
.days{display:flex;gap:6px;margin-top:12px}.days button{flex:1;aspect-ratio:1;max-width:44px;border-radius:50%;border:0;background:#f1f5f9;font-weight:700;color:var(--slate);cursor:pointer}
.days button.on{background:var(--violet);color:#fff}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sw{position:relative;width:50px;height:30px;flex:none}.sw input{display:none}.sw span{position:absolute;inset:0;background:#cbd5e1;border-radius:99px;transition:.2s;cursor:pointer}
.sw span:after{content:"";position:absolute;width:24px;height:24px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.sw input:checked+span{background:var(--green)}.sw input:checked+span:after{left:23px}
.add{width:100%;border:2px dashed var(--line);background:transparent;border-radius:16px;padding:12px;font:inherit;font-weight:700;color:var(--violet);cursor:pointer}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}
.calls .c{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}.calls .c:last-child{border:0}
.dot{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;flex:none;background:#f1f5f9}
.c .m{flex:1;min-width:0}.c .r{font-weight:700}.c .w{color:var(--mute);font-size:13px}
.bar{position:fixed;left:0;right:0;bottom:0;padding:12px 14px calc(12px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--bg) 30%);display:flex;justify-content:center}
.save{width:100%;max-width:520px;border:0;border-radius:999px;padding:16px;font:inherit;font-weight:800;font-size:17px;color:#fff;background:var(--ink);cursor:pointer;opacity:.35;pointer-events:none;transition:.2s}
.save.dirty{opacity:1;pointer-events:auto}.err{color:#b91c1c;font-weight:600;text-align:center;margin:-4px 0 10px;display:none}
a.link{color:var(--blue);text-decoration:none;font-weight:600;font-size:14px}
</style></head><body><div class="wrap" id="app"></div>
<div class="bar"><button class="save" id="save"></button></div>
<script>
var B=__BOOT__, T=B.T, S=JSON.parse(JSON.stringify(B.data.cfg)), D=B.data, dirty=false;
var ACT=['reject','forward','message','open_alert'];
var ICON={opened:'🔓',opened_alert:'🚨',failed:'❌',rejected:'⛔',message:'🔇',fwd_answered:'📲',fwd_missed:'📵',fwd_opened:'🔓'};
function h(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function opts(list,sel,lab){return list.map(function(v){return '<option value="'+v+'"'+(v==sel?' selected':'')+'>'+h(lab(v))+'</option>'}).join('')}
function hours(sel){var o='';for(var i=0;i<=24;i++){o+='<option value="'+i+'"'+(i==sel?' selected':'')+'>'+((i%12)||12)+(i<12||i==24?' AM':' PM')+'</option>'}return o}
function mark(){dirty=true;var b=document.getElementById('save');b.classList.add('dirty');b.textContent=T.save}
function render(){
  var st=D.state, m=S.mode, html='';
  html+='<h1>🔓 '+T.p_title+'<small>'+T.version+' '+B.version+'</small></h1>';
  html+='<div class="card hero k-'+st.kind+'"><div class="ring">'+st.icon+'</div><div class="t">'+h(st.title)+'</div><div class="s">'+h(st.sub)+'</div></div>';
  html+='<div class="card"><h2>'+T.p_mode+'</h2><div class="seg">'+
    [['auto','🤖',T.m_auto],['open','🔓',T.m_open],['paused','⏸️',T.m_paused]].map(function(x){return '<button data-mode="'+x[0]+'" class="'+(m==x[0]?'on':'')+'"><span class="e">'+x[1]+'</span>'+x[2]+'</button>'}).join('')+
    '</div><div class="hint">'+T['m_'+m+'_d']+'</div>'+
    (m=='paused'?'<label class="f">'+T.pausedAction+'</label><select id="pa">'+opts(ACT,S.pausedAction,function(a){return T['act_'+a]})+'</select>':'')+'</div>';
  html+='<div class="card"><h2>'+T.schedules+'</h2><div class="hint" style="margin:-4px 0 12px">'+T.sched_hint+'</div>';
  S.rules.forEach(function(r,i){
    html+='<div class="rule'+(r.enabled?'':' off')+'" data-i="'+i+'"><div class="rh"><label class="sw"><input type="checkbox" data-k="enabled"'+(r.enabled?' checked':'')+'><span></span></label>'+
      '<input type="text" data-k="name" value="'+h(r.name)+'" maxlength="40"><button class="x" data-del="'+i+'">✕</button></div>'+
      '<div class="days">'+B.days.map(function(d,j){return '<button data-day="'+j+'" class="'+(r.days.indexOf(j)>=0?'on':'')+'">'+d+'</button>'}).join('')+'</div>'+
      '<div class="two"><div><label class="f">'+T.from+'</label><input type="time" data-k="from" value="'+r.from+'"></div><div><label class="f">'+T.to+'</label><input type="time" data-k="to" value="'+r.to+'"></div></div>'+
      '<label class="f">'+T.action+'</label><select data-k="action">'+opts(ACT,r.action,function(a){return T['act_'+a]})+'</select></div>';
  });
  html+='<button class="add" id="add">＋ '+T.addRule+'</button></div>';
  html+='<div class="card"><h2>'+T.fwd+'</h2><label class="f">'+T.fwdNumber+'</label><input type="tel" id="fn" placeholder="+1XXXXXXXXXX" value="'+h(S.forward.number)+'">'+
    '<div class="two"><div><label class="f">'+T.fwdTimeout+'</label><select id="ft">'+opts([15,20,25,30,45,60],S.forward.timeout,function(v){return v+' '+T.seconds})+'</select></div>'+
    '<div><label class="f">'+T.fwdFallback+'</label><select id="fb">'+opts(['hangup','open'],S.forward.fallback,function(v){return T['fb_'+v]})+'</select></div></div></div>';
  html+='<div class="card"><h2>'+T.msg+'</h2><textarea id="msg" maxlength="300">'+h(S.message)+'</textarea><div class="hint">'+T.msgHint+'</div></div>';
  html+='<div class="card"><h2>'+T.alerts+'</h2><label class="f">'+T.nightWin+'</label><div class="two"><select id="nf">'+hours(S.night.from)+'</select><select id="nt">'+hours(S.night.to)+'</select></div>'+
    '<div class="row"><span>'+T.summaryOn+'</span><label class="sw"><input type="checkbox" id="sum"'+(S.summary?' checked':'')+'><span></span></label></div></div>';
  html+='<div class="card calls"><h2>'+T.recent+'</h2>'+(D.recent.length?D.recent.map(function(c){return '<div class="c"><div class="dot">'+(ICON[c.code]||'📞')+'</div><div class="m"><div class="r">'+h(c.result)+'</div><div class="w">'+h(c.day)+' · '+h(c.time)+'</div></div></div>'}).join(''):'<div class="hint">'+T.noCalls+'</div>')+
    (D.sheetUrl?'<div style="margin-top:10px"><a class="link" target="_blank" href="'+h(D.sheetUrl)+'">📊 '+T.history+' →</a></div>':'')+'</div>';
  html+='<div class="card"><h2>'+T.access+'</h2><div class="hint" style="margin:-4px 0 12px">'+T.accessHint+'</div>'+
    '<div class="two"><button class="add" id="cp" style="border-style:solid">🔗 '+T.copyLink+'</button><button class="add" id="nl" style="border-style:solid;color:#b91c1c">🔄 '+T.newLink+'</button></div><div class="hint" id="nlmsg"></div></div>';
  html+='<div class="err" id="err"></div>';
  document.getElementById('app').innerHTML=html; bind();
}
function bind(){
  var app=document.getElementById('app');
  app.querySelectorAll('[data-mode]').forEach(function(b){b.onclick=function(){S.mode=b.dataset.mode;render();save()}});
  var pa=document.getElementById('pa'); if(pa) pa.onchange=function(){S.pausedAction=pa.value;mark()};
  app.querySelectorAll('.rule').forEach(function(el){
    var r=S.rules[+el.dataset.i];
    el.querySelectorAll('[data-k]').forEach(function(inp){inp.oninput=inp.onchange=function(){r[inp.dataset.k]=inp.type=='checkbox'?inp.checked:inp.value;if(inp.type=='checkbox')el.classList.toggle('off',!inp.checked);mark()}});
    el.querySelectorAll('[data-day]').forEach(function(b){b.onclick=function(){var d=+b.dataset.day,k=r.days.indexOf(d);if(k>=0)r.days.splice(k,1);else r.days.push(d);b.classList.toggle('on');mark()}});
  });
  app.querySelectorAll('[data-del]').forEach(function(b){b.onclick=function(){S.rules.splice(+b.dataset.del,1);render();mark()}});
  document.getElementById('add').onclick=function(){S.rules.push({id:'r'+Date.now(),name:T.newRule,enabled:true,days:[0,1,2,3,4,5,6],from:'00:00',to:'07:00',action:'reject'});render();mark()};
  [['fn',function(v){S.forward.number=v}],['ft',function(v){S.forward.timeout=+v}],['fb',function(v){S.forward.fallback=v}],['msg',function(v){S.message=v}],
   ['nf',function(v){S.night.from=+v}],['nt',function(v){S.night.to=+v}]].forEach(function(x){var e=document.getElementById(x[0]);e.oninput=e.onchange=function(){x[1](e.value);mark()}});
  document.getElementById('sum').onchange=function(e){S.summary=e.target.checked;mark()};
  document.getElementById('cp').onclick=function(){var b=this;try{navigator.clipboard.writeText(B.link).then(function(){b.textContent=T.copied})}catch(e){prompt('',B.link)}};
  document.getElementById('nl').onclick=function(){if(!confirm(T.newLinkConfirm))return;google.script.run.withSuccessHandler(function(u){B.link=u;var m=document.getElementById('nlmsg');m.innerHTML=T.newLinkDone+'<br><a class="link" target="_top" href="'+h(u)+'">'+h(u)+'</a>'}).withFailureHandler(fail).panelNewLink(B.key)};
}
function fail(e){var er=document.getElementById('err');er.textContent=(e&&e.message)||e;er.style.display='block'}
function save(){
  var b=document.getElementById('save'),err=document.getElementById('err');b.textContent=T.saving;err.style.display='none';
  google.script.run.withSuccessHandler(function(d){D=d;S=JSON.parse(JSON.stringify(d.cfg));dirty=false;render();b.classList.remove('dirty');b.textContent=T.saved;setTimeout(function(){if(!dirty)b.textContent=T.save},1800)})
    .withFailureHandler(function(e){fail(e);b.textContent=T.save;b.classList.add('dirty')}).panelSave(S,B.key);
}
document.getElementById('save').onclick=save;document.getElementById('save').textContent=T.save;render();
</script></body></html>`;

// ---------------------------------------------------------------------
//  UTILITIES
// ---------------------------------------------------------------------
function putRec_(sid, rec) { CacheService.getScriptCache().put('c_' + sid, JSON.stringify(rec), 21600); }
function getRec_(sid) {
  const v = CacheService.getScriptCache().get('c_' + sid);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return { o: v === 'paused' || v === 'pausado' ? 'rejected' : 'opened' }; }  // v1.0 cache values
}
function txt_(s) { return ContentService.createTextOutput(s); }
function xmlOut_(body) { return ContentService.createTextOutput('<?xml version="1.0" encoding="UTF-8"?>' + body).setMimeType(ContentService.MimeType.XML); }
function xml_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function cap_(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function hourLabel_(h) { return ((h % 12) || 12) + ' ' + (h < 12 ? 'AM' : 'PM'); }
function hhmmLabel_(hhmm) { const m = toMin_(hhmm), h = Math.floor(m / 60) % 24, mm = m % 60; return ((h % 12) || 12) + ':' + ('0' + mm).slice(-2) + ' ' + (h < 12 ? 'AM' : 'PM'); }
function longDate_(f) {
  const z = s => Number(Utilities.formatDate(f, TZ, s));
  return L.longDate(L.days[z('u') % 7], z('d'), L.months[z('M') - 1]);
}
function formatPhone_(n) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n || '');
  return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : (n || T.unknownNum);
}
