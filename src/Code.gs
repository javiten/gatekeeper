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
const PANEL_HOST  = 'https://javiten.github.io/gatekeeper/panel/';   // static admin panel (or host docs/panel yourself)
// </CONFIG> -----------------------------------------------------------

const VERSION = '1.3.0';
const PROPS   = PropertiesService.getScriptProperties();
const ACTIONS = ['reject', 'forward', 'message', 'open_alert', 'pin'];
const FAIL_ACTIONS = ['reject', 'forward', 'message'];

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
      opened_pin: '{n} came in', guest: 'Guest', saidName: 'Said their name is', pinFail: 'Wrong code ({n} attempts)', pinLocked: 'Code entry locked (too many wrong codes)',
      act_pin: 'Ask for name + access code', pins: 'Access codes (PIN)', pinsHint: 'Guests say their name and then their code out loud, in English or Spanish. A correct code opens the gate and the email tells you who came in.',
      pinDays: 'Days', pinHours: 'Hours', always: 'Always', expires: 'Expires', never: 'Never (unlimited)', maxUses: 'Max uses', unlimited: 'Unlimited', once: 'Single use',
      usesLeft: '{n} left', expired: 'Expired', err_pintime: 'Check the guest hours (both times, or leave both empty for always).',
      pinOff: 'Codes are saved but not requested yet. Turn them on in Mode → Outside schedules → "Ask for name + code" (or use that action in a schedule).', pinOffBtn: 'Turn codes on',
      ph_guest: 'e.g. Mom', ph_pin: '4821', ph_rule: 'e.g. Night', ph_time1: 'e.g. 09:00', ph_time2: 'e.g. 18:00', ph_date: 'e.g. 12/31/2026',
      ph_phone: 'e.g. +13055551234', ph_msg: 'e.g. No one can open right now, please call me.', validity: 'Validity',
      addPin: 'Add guest', pinName: 'Guest name', pinCode: 'Code', validFrom: 'Valid from', validTo: 'Valid until', anyDate: 'any date',
      uses: 'Used {n}×', lastUse: 'last', neverUsed: 'Never used', pinLen: 'Code length', digits: 'digits', attempts: 'Attempts', callOwner: 'Guests without a code can say "call" to be forwarded to my phone',
      pinFailAct: 'After the last wrong attempt', outside: 'Outside schedules', out_open: 'Open right away', out_pin: 'Ask for name + code', lockNote: 'Code entry is locked until {t} because of repeated wrong codes.',
      err_pin: 'Each guest needs a code of exactly {n} digits.', err_pindup: 'Two guests have the same code.', sumByCode: 'Came in with a code',
      subjectLock: 'Gatekeeper: code entry locked', lockMail: 'Too many wrong codes in the last hour. Code entry is locked for 60 minutes. Calls follow the "after the last wrong attempt" action.',
      caller: 'Caller', duration: 'Duration', openSignal: 'Open signal', sent: 'Sent', no: 'No', callBox: 'Call box',
      unknownNum: 'Unknown', callLog: 'Call log', callBack: 'Call back', history: 'History', panel: 'Panel',
      manualPause: 'Manual pause', schedule: 'Schedule', twilioStatus: 'Twilio status', yes: 'Yes',
      weekly: 'Weekly summary', openings: 'openings', sumOpened: 'Opened', sumFailed: 'Failed', sumBlocked: 'Blocked',
      sumForwarded: 'Forwarded', sumNight: 'Night', sumOther: 'Other numbers', peak: 'Peak hour', busiest: 'Busiest day',
      sumFooter: 'Sent every Sunday at 8 PM', subjectWeekly: 'Gatekeeper weekly summary',
      cols: ['Date & time','Day','Time','From','Call box','Result','Duration (s)','Night','Twilio status','Call SID','Code','Reason','Guest','Said name'],
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
      opened_pin: 'Entró {n}', guest: 'Invitado', saidName: 'Dijo llamarse', pinFail: 'Código incorrecto ({n} intentos)', pinLocked: 'Códigos bloqueados (demasiados intentos fallidos)',
      act_pin: 'Pedir nombre + código', pins: 'Códigos de acceso (PIN)', pinsHint: 'El invitado dice su nombre y después su código en voz alta, en español o inglés. Si el código es correcto se abre el gate y el email te dice quién entró.',
      pinDays: 'Días', pinHours: 'Horario', always: 'Siempre', expires: 'Vence', never: 'Nunca (ilimitado)', maxUses: 'Usos máximos', unlimited: 'Ilimitados', once: 'Un solo uso',
      usesLeft: 'quedan {n}', expired: 'Vencido', err_pintime: 'Revisá el horario del invitado (las dos horas, o dejá ambas vacías para siempre).',
      pinOff: 'Los códigos están guardados pero todavía no se piden. Activalos en Modo → Fuera de los horarios → "Pedir nombre + código" (o usá esa acción en un horario).', pinOffBtn: 'Activar códigos',
      ph_guest: 'ej. Mamá', ph_pin: '4821', ph_rule: 'ej. Noche', ph_time1: 'ej. 09:00', ph_time2: 'ej. 18:00', ph_date: 'ej. 31/12/2026',
      ph_phone: 'ej. +13055551234', ph_msg: 'ej. En este momento no podemos abrir, por favor llamame.', validity: 'Vigencia',
      addPin: 'Agregar invitado', pinName: 'Nombre del invitado', pinCode: 'Código', validFrom: 'Válido desde', validTo: 'Válido hasta', anyDate: 'cualquier fecha',
      uses: 'Usado {n} veces', lastUse: 'último', neverUsed: 'Sin usar todavía', pinLen: 'Largo del código', digits: 'dígitos', attempts: 'Intentos', callOwner: 'Quien no tenga código puede decir "llamar" y se desvía a mi celular',
      pinFailAct: 'Después del último intento fallido', outside: 'Fuera de los horarios', out_open: 'Abrir directo', out_pin: 'Pedir nombre + código', lockNote: 'Los códigos están bloqueados hasta las {t} por intentos fallidos repetidos.',
      err_pin: 'Cada invitado necesita un código de exactamente {n} dígitos.', err_pindup: 'Hay dos invitados con el mismo código.', sumByCode: 'Entraron con código',
      subjectLock: 'Gatekeeper: códigos bloqueados', lockMail: 'Hubo demasiados códigos incorrectos en la última hora. Los códigos quedan bloqueados 60 minutos y las llamadas siguen la acción "después del último intento fallido".',
      caller: 'Llamó', duration: 'Duración', openSignal: 'Apertura', sent: 'Enviado', no: 'No', callBox: 'Portero',
      unknownNum: 'Desconocido', callLog: 'Ver log', callBack: 'Llamar', history: 'Historial', panel: 'Panel',
      manualPause: 'Pausa manual', schedule: 'Horario', twilioStatus: 'Estado de Twilio', yes: 'Sí',
      weekly: 'Resumen semanal', openings: 'aperturas', sumOpened: 'Aperturas', sumFailed: 'Fallos', sumBlocked: 'Bloqueadas',
      sumForwarded: 'Desviadas', sumNight: 'Nocturnas', sumOther: 'Otros números', peak: 'Hora pico', busiest: 'Día con más movimiento',
      sumFooter: 'Se envía todos los domingos a las 8 PM', subjectWeekly: 'Resumen semanal del gate',
      cols: ['Fecha y hora','Día','Hora','De','Portero','Resultado','Duración (s)','Nocturna','Estado Twilio','Call SID','Código','Motivo','Invitado','Nombre dicho'],
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
    summary: true,
    outside: 'open',              // automatic mode, outside schedules: open | pin
    pins: [],                     // [{id, name, pin, enabled, from, to (dates or ''), days:[0-6], tFrom, tTo ('HH:MM' or '' = always), maxUses (0 = unlimited)}]
    pinOpts: { length: 4, attempts: 3, callOwner: true, fail: 'reject' }
  };
}

function cfg_() {
  const d = defaults_();
  let c = {};
  try { c = JSON.parse(PROPS.getProperty('config') || '{}'); } catch (e) {}
  // v1.0 → v1.1: the old "paused" / "pausado" flag becomes mode = paused
  if (!c.mode && (PROPS.getProperty('paused') === '1' || PROPS.getProperty('pausado') === '1')) c.mode = 'paused';
  return Object.assign(d, c, { forward: Object.assign(d.forward, c.forward || {}), night: Object.assign(d.night, c.night || {}),
                               pinOpts: Object.assign(d.pinOpts, c.pinOpts || {}) });
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
  if (c.outside === 'pin') return { open: false, reason: 'auto', action: 'pin' };
  return { open: true, reason: 'auto' };
}

// ---------------------------------------------------------------------
//  WEB ENTRY POINTS
// ---------------------------------------------------------------------
function doPost(e) {
  // JSON API used by the hosted admin panel (Twilio always posts form-urlencoded)
  if (e && e.postData && !/x-www-form-urlencoded/.test(e.postData.type || '')) {
    let b = null; try { b = JSON.parse(e.postData.contents); } catch (err) {}
    if (b && b.api) return api_(b);
  }
  const p = (e && e.parameter) || {};
  if (p.k !== TOKEN || p.AccountSid !== ACCOUNT_SID) return txt_('forbidden');
  const type = p.type || p.tipo;
  if (type === 'voice' || type === 'voz') return answerCall_(p);
  if (type === 'dial') return dialEnded_(p);
  if (type === 'pin') return pinStep_(p);
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
function panelLink_() { return PANEL_HOST + '#api=' + encodeURIComponent(WEB_URL) + '&k=' + panelKey_(); }

function api_(b) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  try {
    const meta = () => ({ T: T, days: L.daysShort, version: VERSION, link: panelLink_() });
    if (b.api === 'data')    return out(Object.assign(panelData(b.key), meta()));
    if (b.api === 'save')    return out(Object.assign(panelSave(b.cfg || {}, b.key), meta()));
    if (b.api === 'newLink') return out({ link: panelNewLink(b.key) });
    return out({ error: 'unknown' });
  } catch (err) { return out({ error: String(err.message || err) }); }
}
function auth_(key) { if (!(isOwner_() || (key && key === panelKey_()))) throw new Error(T.denied); }

// ---------------------------------------------------------------------
//  1) ANSWER THE CALL
// ---------------------------------------------------------------------
function answerCall_(p) {
  const c = cfg_();
  const s = state_(new Date(), c);
  const why = { why: s.reason };
  if (s.rule) why.rule = s.rule.name + ' (' + s.rule.from + '–' + s.rule.to + ')';
  if (s.open) { putRec_(p.CallSid, Object.assign({ o: 'opened' }, why)); return xmlOut_(openTwiml_()); }
  if (s.action === 'pin') {
    if (pinLocked_()) {                                      // too many wrong codes recently
      const a = runAction_(c.pinOpts.fail, c);
      putRec_(p.CallSid, Object.assign({ o: a.o, locked: true }, why));
      return xmlOut_(a.twiml);
    }
    putRec_(p.CallSid, Object.assign({ o: 'pin_pending' }, why));
    return xmlOut_(gather_('name', 1, sayBoth_('Diga su nombre.', 'Say your name.')));
  }
  const a = runAction_(s.action, c);
  putRec_(p.CallSid, Object.assign({ o: a.o }, why));
  return xmlOut_(a.twiml);
}

// Builds the TwiML for a non-PIN action → { o, twiml }
function runAction_(action, c) {
  if (action === 'open_alert') return { o: 'opened_alert', twiml: openTwiml_() };
  if (action === 'forward' && /^\+\d{8,15}$/.test(c.forward.number)) {
    const url = xml_(WEB_URL + '?k=' + TOKEN + '&type=dial');
    return { o: 'forwarded', twiml: '<Response><Dial timeout="' + Number(c.forward.timeout || 25) + '" answerOnBridge="true" action="' + url + '" method="POST">' +
             '<Number>' + xml_(c.forward.number) + '</Number></Dial></Response>' };
  }
  if (action === 'message') return { o: 'message', twiml: '<Response><Pause length="1"/><Say language="' + L.voice.language + '" voice="' + L.voice.voice + '">' +
             xml_(c.message || L.defaultMessage) + '</Say><Hangup/></Response>' };
  return { o: 'rejected', twiml: '<Response><Reject reason="busy"/></Response>' };
}

// ---------------------------------------------------------------------
//  1b) GUEST CODES — ask name, then PIN, by voice (Spanish or English)
// ---------------------------------------------------------------------
function sayBoth_(es, en) {
  return '<Say language="es-MX" voice="Polly.Mia">' + xml_(es) + '</Say><Say language="en-US" voice="Polly.Joanna">' + xml_(en) + '</Say>';
}

// bargeIn="false": many call boxes have no echo cancellation, so the prompt leaks back into the
// microphone. Without this, the recognizer hears its own prompt, cuts it off and treats it as the answer.
const DIGIT_HINTS = 'cero,uno,dos,tres,cuatro,cinco,seis,siete,ocho,nueve,zero,one,two,three,four,five,six,seven,eight,nine,llamar,call';
function gather_(step, n, prompt) {
  const url = xml_(WEB_URL + '?k=' + TOKEN + '&type=pin&step=' + step + '&n=' + n);
  return '<Response><Gather input="speech" speechModel="deepgram_nova-3" language="multi" bargeIn="false" speechTimeout="2" timeout="8" ' +
         (step === 'pin' ? 'hints="' + DIGIT_HINTS + '" ' : '') +
         'actionOnEmptyResult="true" action="' + url + '" method="POST">' + prompt + '</Gather><Redirect method="POST">' + url + '</Redirect></Response>';
}

function pinStep_(p) {
  const c = cfg_(), o = c.pinOpts;
  const rec = getRec_(p.CallSid) || { o: 'pin_pending', why: 'auto' };
  const n = Number(p.n || 1), said = String(p.SpeechResult || '').trim();
  const askPin = (pre) => gather_('pin', n, (pre || '') + sayBoth_('Ahora su código, número por número.', 'Now your code, digit by digit.') +
    (o.callOwner && /^\+\d{8,15}$/.test(c.forward.number) ? sayBoth_('Sin código, diga llamar.', 'No code? Say call.') : ''));

  if (p.step === 'name') {                                      // name is only for the record
    rec.said = said.slice(0, 60);
    putRec_(p.CallSid, rec);
    return xmlOut_(askPin(''));
  }

  // step = pin
  const norm = said.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (o.callOwner && /\b(llamar|llama|llamada|call|owner|dueno|duena)\b/.test(norm) && !/\d/.test(spokenDigits_(said))) {
    const a = runAction_('forward', c);
    rec.o = a.o; rec.askedCall = true; putRec_(p.CallSid, rec);
    return xmlOut_(a.twiml);
  }
  const digits = spokenDigits_(said);
  const guest = matchPin_(digits, c);
  if (guest) {
    rec.o = 'opened_pin'; rec.guest = guest.name; rec.pinId = guest.id;
    putRec_(p.CallSid, rec); bumpPinStats_(guest.id);
    return xmlOut_(openTwiml_());
  }
  if (n < o.attempts) {
    return xmlOut_(gather_('pin', n + 1, sayBoth_('Código incorrecto. Repita su código.', 'Wrong code. Say it again.')));
  }
  recordPinFail_();
  const a = runAction_(o.fail, c);
  rec.o = a.o; rec.pinFail = n; putRec_(p.CallSid, rec);
  return xmlOut_(a.twiml);
}

// "uno dos tres cuatro", "one two three four", "1 2 3 4", "1234" → "1234"
function spokenDigits_(s) {
  const W = { cero: 0, zero: 0, oh: 0, uno: 1, una: 1, un: 1, one: 1, won: 1, dos: 2, two: 2, to: 2, too: 2, tres: 3, three: 3, tree: 3,
              cuatro: 4, four: 4, for: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, ate: 8, nueve: 9, nine: 9 };
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .map(t => /^\d+$/.test(t) ? t : (t in W ? String(W[t]) : '')).join('');
}

function matchPin_(digits, c) {
  if (!digits) return null;
  const g = (c.pins || []).filter(x => x.pin === digits)[0];
  return g && pinValidNow_(g, new Date()) ? g : null;
}

// Is a guest code usable right now? (enabled, date range, days, hours, uses left)
function pinValidNow_(g, d) {
  if (!g.enabled) return false;
  const today = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  if ((g.from && today < g.from) || (g.to && today > g.to)) return false;
  const days = g.days && g.days.length ? g.days : [0, 1, 2, 3, 4, 5, 6];
  if (g.tFrom && g.tTo) { if (!ruleActive_({ enabled: true, days: days, from: g.tFrom, to: g.tTo }, d)) return false; }
  else if (days.indexOf(nowParts_(d).dow) < 0) return false;
  if (g.maxUses > 0) {
    let st = {}; try { st = JSON.parse(PROPS.getProperty('pinStats') || '{}'); } catch (e) {}
    if (((st[g.id] && st[g.id].uses) || 0) >= g.maxUses) return false;
  }
  return true;
}

function bumpPinStats_(id) {
  let st = {}; try { st = JSON.parse(PROPS.getProperty('pinStats') || '{}'); } catch (e) {}
  st[id] = { uses: ((st[id] && st[id].uses) || 0) + 1, last: Utilities.formatDate(new Date(), TZ, LANG === 'es' ? 'd/M h:mm a' : 'M/d h:mm a') };
  PROPS.setProperty('pinStats', JSON.stringify(st));
}

// Lock code entry for 60 min after 5 failed calls within an hour (brute-force protection)
function recordPinFail_() {
  const now = Date.now();
  let f = []; try { f = JSON.parse(PROPS.getProperty('pinFails') || '[]'); } catch (e) {}
  f = f.filter(t => now - t < 3600e3).concat(now);
  PROPS.setProperty('pinFails', JSON.stringify(f));
  if (f.length >= 5 && !pinLocked_()) {
    PROPS.setProperty('pinLockUntil', String(now + 3600e3));
    MailApp.sendEmail({ to: EMAIL, subject: '🔒 ' + T.subjectLock, body: T.lockMail, name: 'Gatekeeper' });
  }
}
function pinLocked_() { return Number(PROPS.getProperty('pinLockUntil') || 0) > Date.now(); }

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
  if (o === 'opened' || o === 'opened_alert' || o === 'opened_pin') code = ok ? o : 'failed';
  else if (o === 'pin_pending') code = 'failed';                 // hung up before finishing
  else if (o === 'forwarded') code = rec.dial === 'completed' ? 'fwd_answered' : (rec.fb === 'opened' ? 'fwd_opened' : 'fwd_missed');
  else code = o;                                           // rejected | message

  const d = {
    code: code,
    fromCallBox: p.From === CALL_BOX,
    night: (code === 'opened' || code === 'opened_alert' || code === 'fwd_opened' || code === 'opened_pin') && inNight_(hour, c.night),
    time: Utilities.formatDate(date, TZ, 'h:mm a'),
    day: longDate_(date),
    who: rec && rec.guest ? rec.guest : (p.From === CALL_BOX ? T.callBox : formatPhone_(p.From)),
    guest: (rec && rec.guest) || '',
    said: (rec && rec.said) || '',
    dur: dur + ' s',
    from: p.From || '',
    sid: p.CallSid || '',
    twilioStatus: p.CallStatus || '',
    reason: [rec && rec.locked ? T.pinLocked : '', rec && rec.pinFail ? T.pinFail.replace('{n}', rec.pinFail) : '',
             rec && rec.why === 'manual' ? T.manualPause : (rec && rec.rule ? T.schedule + ': ' + rec.rule : '')].filter(String).join(' · ')
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
    opened_pin:   { icon: '🔑', color: '#16a34a', bg: '#dcfce7', sig: ['9️⃣', T.sent] },
    opened:       { icon: '🔓', color: '#16a34a', bg: '#dcfce7', sig: ['9️⃣', T.sent] }
  };
  let k = d.code, x = Object.assign({ title: String(T[k] || T.opened).replace('{n}', d.guest || '') }, K[k] || K.opened);
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
                parseInt(d.dur, 10), d.night ? T.yes : 'No', d.twilioStatus, d.sid, d.code, d.reason, d.guest, d.said]);
}

function recentCalls_(n) {
  try {
    const sh = sheet_(), last = sh.getLastRow();
    if (last < 2) return [];
    const from = Math.max(2, last - n + 1);
    return sh.getRange(from, 1, last - from + 1, Math.min(sh.getLastColumn(), 14)).getValues().reverse().map(r => ({
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

  const opened  = rows.filter(is(['opened', 'opened_alert', 'fwd_opened', 'opened_pin']));
  const guests = {}; rows.filter(is(['opened_pin'])).forEach(r => { const g = String(r[12] || '?'); guests[g] = (guests[g] || 0) + 1; });
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
  s.guests = Object.keys(guests).sort((a, b) => guests[b] - guests[a]).map(g => g + ' (' + guests[g] + ')').join(', ');
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
  let st = {}; try { st = JSON.parse(PROPS.getProperty('pinStats') || '{}'); } catch (e) {}
  const lock = Number(PROPS.getProperty('pinLockUntil') || 0);
  return { cfg: c, state: describeState_(s, c), recent: recentCalls_(8), sheetUrl: PROPS.getProperty('sheetUrl') || '',
           pinStats: st, pinLock: lock > Date.now() ? Utilities.formatDate(new Date(lock), TZ, 'h:mm a') : '' };
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
  out.outside = c.outside === 'pin' ? 'pin' : 'open';
  const po = c.pinOpts || {};
  out.pinOpts = { length: Math.min(8, Math.max(4, Number(po.length) || 4)), attempts: Math.min(5, Math.max(1, Number(po.attempts) || 3)),
                  callOwner: po.callOwner !== false, fail: FAIL_ACTIONS.indexOf(po.fail) >= 0 ? po.fail : 'reject' };
  const seen = {};
  out.pins = (c.pins || []).slice(0, 100).map((g, i) => {
    const pin = String(g.pin || '').replace(/\D/g, '');
    if (pin.length !== out.pinOpts.length) throw new Error(T.err_pin.replace('{n}', out.pinOpts.length));
    if (seen[pin]) throw new Error(T.err_pindup); seen[pin] = 1;
    const dt = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '';
    const tm = v => /^\d{1,2}:\d{2}$/.test(v || '') ? v : '';
    const tFrom = tm(g.tFrom), tTo = tm(g.tTo);
    if (!!tFrom !== !!tTo) throw new Error(T.err_pintime);
    const days = (g.days && g.days.length ? g.days : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter(x => x >= 0 && x <= 6);
    if (!days.length) throw new Error(T.err_days);
    return { id: String(g.id || ('g' + Date.now() + i)).slice(0, 40), name: String(g.name || T.guest).slice(0, 40), pin: pin,
             enabled: g.enabled !== false, from: dt(g.from), to: dt(g.to), days: days, tFrom: tFrom, tTo: tTo,
             maxUses: Math.min(999, Math.max(0, parseInt(g.maxUses, 10) || 0)) };
  });
  if (out.pinOpts.fail === 'forward' && !/^\+\d{8,15}$/.test(out.forward.number)) throw new Error(T.err_phone);
  return out;
}

function describeState_(s, c) {
  const act = a => T['act_' + a];
  if (s.reason === 'forced') return { kind: 'open', icon: '🔓', title: T.s_forced, sub: T.will_open };
  if (s.reason === 'auto' && s.action === 'pin') return { kind: 'sched', icon: '🔑', title: T.out_pin, sub: T.act_pin };
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
                (d.said ? note_('🗣️ ' + T.saidName + ': “' + xml_(d.said) + '”', '#1e3a8a', '#dbeafe') : '') +
                (d.reason ? note_(d.reason, '#475569', '#f1f5f9') : '');
  return card_(
    header_(t.icon, t.title, d.time, d.day, t.color, t.bg) + notes +
    '<table role="presentation" width="100%" style="margin-top:28px;border-collapse:collapse"><tr>' +
      stat_(d.guest ? '🔑' : '📞', d.who, d.guest ? T.guest : T.caller) + stat_('⏱️', d.dur, T.duration) + stat_(t.sig[0], t.sig[1], T.openSignal) +
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
    (s.guests ? '<div style="text-align:center;margin-top:8px;font-size:14px;color:#475569">🔑 ' + T.sumByCode + ': <b>' + xml_(s.guests) + '</b></div>' : '') +
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

const PANEL_HTML_ = `<!doctype html><html><head><meta charset="utf-8"><title>Gatekeeper</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Gatekeeper"><meta name="referrer" content="no-referrer">
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
label.f{display:block;font-size:13px;color:var(--mute);margin:12px 0 6px}select,input[type=text],input[type=tel],input[type=time],input[type=date],textarea{width:100%;border:1px solid var(--line);border-radius:12px;padding:11px 12px;font:inherit;background:#fff;color:var(--ink)}
textarea{min-height:70px;resize:vertical}
.rule{border:1px solid var(--line);border-radius:18px;padding:14px;margin-bottom:10px}.rule.off{opacity:.55}
.rh{display:flex;gap:10px;align-items:center}.rh input{flex:1;font-weight:700}
.x{border:0;background:#fee2e2;color:#b91c1c;width:36px;height:36px;border-radius:50%;font-size:16px;cursor:pointer}
.days{display:flex;gap:6px;margin-top:12px}.days button{flex:1;aspect-ratio:1;max-width:44px;border-radius:50%;border:0;background:#f1f5f9;font-weight:700;color:var(--slate);cursor:pointer}
.days button.on{background:var(--violet);color:#fff}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.two>*{min-width:0}
input[type=date],input[type=time]{-webkit-appearance:none;appearance:none;display:block;min-width:0;max-width:100%;min-height:46px;text-align:left}
input::-webkit-date-and-time-value{text-align:left}input::placeholder,textarea::placeholder{color:#94a3b8;opacity:1}input[data-gk=pin]::placeholder{color:#cbd5e1}
input[type=date]::-webkit-calendar-picker-indicator,input[type=time]::-webkit-calendar-picker-indicator{opacity:.5}
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
var B=__BOOT__, T, S, D, dirty=false, API=null, KEY='';
function call(fn,arg,ok,bad){
  if(window.google&&google.script&&google.script.run){var r=google.script.run.withSuccessHandler(ok).withFailureHandler(bad);
    if(fn=='save')r.panelSave(arg,B.key);else if(fn=='newLink')r.panelNewLink(B.key);return}
  fetch(API,{method:'POST',body:JSON.stringify({api:fn,key:KEY,cfg:arg})}).then(function(r){return r.json()})
    .then(function(j){if(j.error)bad({message:j.error});else ok(fn=='newLink'?j.link:j)}).catch(function(e){bad({message:String(e)})});
}
function start(b){B=b;T=B.T;D=B.data;S=JSON.parse(JSON.stringify(D.cfg));var sv=document.getElementById('save');sv.onclick=save;sv.textContent=T.save;render()}
function boot(){
  if(B){start(B);return}
  var q={};(location.hash||'').replace(/^#/,'').split('&').forEach(function(kv){var i=kv.indexOf('=');if(i>0)q[kv.slice(0,i)]=decodeURIComponent(kv.slice(i+1))});
  try{if(q.api&&q.k)localStorage.setItem('gk',JSON.stringify(q));else q=JSON.parse(localStorage.getItem('gk')||'{}')}catch(e){}
  API=q.api;KEY=q.k;var app=document.getElementById('app');
  if(!API||!KEY){app.innerHTML='<div class="card hero k-paused"><div class="ring">🔒</div><div class="t">Gatekeeper</div><div class="s">Abrí tu link privado del panel · Open your private panel link</div></div>';return}
  app.innerHTML='<div class="card hero k-open"><div class="ring">⏳</div><div class="t">Gatekeeper</div><div class="s">…</div></div>';
  call('data',null,function(j){start({data:j,key:KEY,link:j.link,T:j.T,days:j.days,version:j.version})},
    function(e){app.innerHTML='<div class="card hero k-paused"><div class="ring">⚠️</div><div class="t">Gatekeeper</div><div class="s">'+h(e.message)+'</div></div>'});
}
var ACT=['reject','forward','message','open_alert','pin'],FAILACT=['reject','forward','message'];
var ICON={opened_pin:'🔑',opened:'🔓',opened_alert:'🚨',failed:'❌',rejected:'⛔',message:'🔇',fwd_answered:'📲',fwd_missed:'📵',fwd_opened:'🔓'};
function h(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function opts(list,sel,lab){return list.map(function(v){return '<option value="'+v+'"'+(v==sel?' selected':'')+'>'+h(lab(v))+'</option>'}).join('')}
function hours(sel){var o='';for(var i=0;i<=24;i++){o+='<option value="'+i+'"'+(i==sel?' selected':'')+'>'+((i%12)||12)+(i<12||i==24?' AM':' PM')+'</option>'}return o}
function dt(type,attrs,val,ph){return '<input '+attrs+' data-dt="'+type+'" type="'+(val?type:'text')+'" value="'+h(val||'')+'" placeholder="'+h(ph)+'" inputmode="none">'}
function mark(){dirty=true;var b=document.getElementById('save');b.classList.add('dirty');b.textContent=T.save}
function render(){
  var st=D.state, m=S.mode, html='';
  html+='<h1>🔓 '+T.p_title+'<small>'+T.version+' '+B.version+'</small></h1>';
  html+='<div class="card hero k-'+st.kind+'"><div class="ring">'+st.icon+'</div><div class="t">'+h(st.title)+'</div><div class="s">'+h(st.sub)+'</div></div>';
  html+='<div class="card"><h2>'+T.p_mode+'</h2><div class="seg">'+
    [['auto','🤖',T.m_auto],['open','🔓',T.m_open],['paused','⏸️',T.m_paused]].map(function(x){return '<button data-mode="'+x[0]+'" class="'+(m==x[0]?'on':'')+'"><span class="e">'+x[1]+'</span>'+x[2]+'</button>'}).join('')+
    '</div><div class="hint">'+T['m_'+m+'_d']+'</div>'+
    (m=='paused'?'<label class="f">'+T.pausedAction+'</label><select id="pa">'+opts(ACT,S.pausedAction,function(a){return T['act_'+a]})+'</select>':'')+
    (m=='auto'?'<label class="f">'+T.outside+'</label><select id="os">'+opts(['open','pin'],S.outside,function(v){return T['out_'+v]})+'</select>':'')+'</div>';
  var po=S.pinOpts, st=D.pinStats||{};
  html+='<div class="card"><h2>🔑 '+T.pins+'</h2><div class="hint" style="margin:-4px 0 12px">'+T.pinsHint+'</div>'+
    (D.pinLock?'<div class="err" style="display:block">🔒 '+h(T.lockNote.replace('{t}',D.pinLock))+'</div>':'')+
    ((S.pins.length&&S.outside!='pin'&&S.pausedAction!='pin'&&!S.rules.some(function(r){return r.enabled&&r.action=='pin'}))?
      '<div style="background:#fef3c7;color:#92400e;border-radius:14px;padding:12px;margin-bottom:12px;font-size:14px">⚠️ '+h(T.pinOff)+
      (S.mode=='auto'?'<br><button class="add" id="pinon" style="margin-top:10px;border-style:solid;color:#92400e;background:#fff">🔑 '+h(T.pinOffBtn)+'</button>':'')+'</div>':'');
  S.pins.forEach(function(g,i){var u=st[g.id];
    html+='<div class="rule'+(g.enabled?'':' off')+'" data-g="'+i+'"><div class="rh"><label class="sw"><input type="checkbox" data-gk="enabled"'+(g.enabled?' checked':'')+'><span></span></label>'+
      '<input type="text" data-gk="name" value="'+h(g.name)+'" maxlength="40" placeholder="'+h(T.ph_guest)+'"><button class="x" data-gdel="'+i+'">✕</button></div>'+
      '<div class="two"><div><label class="f">'+T.pinCode+'</label><div style="display:flex;gap:6px"><input type="text" inputmode="numeric" data-gk="pin" value="'+h(g.pin)+'" maxlength="'+po.length+'" placeholder="'+h(T.ph_pin)+'" style="font:700 20px ui-monospace,monospace;letter-spacing:4px;min-width:0"><button class="x" style="background:#ede9fe;color:#6d28d9" data-grnd="'+i+'">🎲</button></div></div>'+
      '<div><label class="f">&nbsp;</label><div class="hint" style="margin-top:12px">'+(u?h(T.uses.replace('{n}',u.uses))+' · '+T.lastUse+' '+h(u.last):T.neverUsed)+'</div></div></div>'+
      '<label class="f">'+T.pinDays+'</label><div class="days" style="margin-top:0">'+B.days.map(function(d,j){return '<button data-gday="'+j+'" class="'+((g.days||[0,1,2,3,4,5,6]).indexOf(j)>=0?'on':'')+'">'+d+'</button>'}).join('')+'</div>'+
      '<label class="f">'+T.pinHours+'</label>'+
      '<div class="two">'+dt('time','data-gk="tFrom"',g.tFrom,T.ph_time1)+dt('time','data-gk="tTo"',g.tTo,T.ph_time2)+'</div>'+
      '<div class="hint">'+((g.tFrom&&g.tTo)?'':'⏰ '+T.always)+'</div>'+
      '<label class="f">'+T.validity+'</label>'+
      '<div class="two"><div><label class="f" style="margin-top:0">'+T.validFrom+'</label>'+dt('date','data-gk="from"',g.from,T.ph_date)+'</div>'+
      '<div><label class="f" style="margin-top:0">'+T.expires+'</label>'+dt('date','data-gk="to"',g.to,T.ph_date)+'</div></div>'+
      '<div class="hint">'+(g.to?'':'♾️ '+T.never)+'</div>'+
      '<label class="f">'+T.maxUses+'</label><select data-gk="maxUses">'+opts([0,1,2,3,5,10,20,50],g.maxUses||0,function(v){return v==0?T.unlimited:(v==1?T.once:v)})+'</select>'+
      (g.maxUses>0&&u?'<div class="hint">'+h(T.usesLeft.replace('{n}',Math.max(0,g.maxUses-u.uses)))+'</div>':'')+'</div>';
  });
  html+='<button class="add" id="addg">＋ '+T.addPin+'</button>'+
    '<div class="two"><div><label class="f">'+T.pinLen+'</label><select id="pl">'+opts([4,5,6,7,8],po.length,function(v){return v+' '+T.digits})+'</select></div>'+
    '<div><label class="f">'+T.attempts+'</label><select id="pt">'+opts([1,2,3,4,5],po.attempts,function(v){return v})+'</select></div></div>'+
    '<label class="f">'+T.pinFailAct+'</label><select id="pf">'+opts(FAILACT,po.fail,function(a){return T['act_'+a]})+'</select>'+
    '<div class="row"><span>'+T.callOwner+'</span><label class="sw"><input type="checkbox" id="pco"'+(po.callOwner?' checked':'')+'><span></span></label></div></div>';
  html+='<div class="card"><h2>'+T.schedules+'</h2><div class="hint" style="margin:-4px 0 12px">'+T.sched_hint+'</div>';
  S.rules.forEach(function(r,i){
    html+='<div class="rule'+(r.enabled?'':' off')+'" data-i="'+i+'"><div class="rh"><label class="sw"><input type="checkbox" data-k="enabled"'+(r.enabled?' checked':'')+'><span></span></label>'+
      '<input type="text" data-k="name" value="'+h(r.name)+'" maxlength="40" placeholder="'+h(T.ph_rule)+'"><button class="x" data-del="'+i+'">✕</button></div>'+
      '<div class="days">'+B.days.map(function(d,j){return '<button data-day="'+j+'" class="'+(r.days.indexOf(j)>=0?'on':'')+'">'+d+'</button>'}).join('')+'</div>'+
      '<div class="two"><div><label class="f">'+T.from+'</label>'+dt('time','data-k="from"',r.from,T.ph_time1)+'</div><div><label class="f">'+T.to+'</label>'+dt('time','data-k="to"',r.to,T.ph_time2)+'</div></div>'+
      '<label class="f">'+T.action+'</label><select data-k="action">'+opts(ACT,r.action,function(a){return T['act_'+a]})+'</select></div>';
  });
  html+='<button class="add" id="add">＋ '+T.addRule+'</button></div>';
  html+='<div class="card"><h2>'+T.fwd+'</h2><label class="f">'+T.fwdNumber+'</label><input type="tel" id="fn" placeholder="'+h(T.ph_phone)+'" value="'+h(S.forward.number)+'">'+
    '<div class="two"><div><label class="f">'+T.fwdTimeout+'</label><select id="ft">'+opts([15,20,25,30,45,60],S.forward.timeout,function(v){return v+' '+T.seconds})+'</select></div>'+
    '<div><label class="f">'+T.fwdFallback+'</label><select id="fb">'+opts(['hangup','open'],S.forward.fallback,function(v){return T['fb_'+v]})+'</select></div></div></div>';
  html+='<div class="card"><h2>'+T.msg+'</h2><textarea id="msg" maxlength="300" placeholder="'+h(T.ph_msg)+'">'+h(S.message)+'</textarea><div class="hint">'+T.msgHint+'</div></div>';
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
  app.querySelectorAll('[data-dt]').forEach(function(i){
    i.addEventListener('focus',function(){if(i.type!==i.dataset.dt){i.type=i.dataset.dt;i.removeAttribute('inputmode');try{i.showPicker&&i.showPicker()}catch(e){}}});
    i.addEventListener('blur',function(){if(!i.value){i.type='text';i.setAttribute('inputmode','none')}});
  });
  app.querySelectorAll('[data-mode]').forEach(function(b){b.onclick=function(){S.mode=b.dataset.mode;render();save()}});
  var pa=document.getElementById('pa'); if(pa) pa.onchange=function(){S.pausedAction=pa.value;mark()};
  var os=document.getElementById('os'); if(os) os.onchange=function(){S.outside=os.value;mark()};
  var pon=document.getElementById('pinon'); if(pon) pon.onclick=function(){S.outside='pin';render();save()};
  function rnd(){var n=S.pinOpts.length,x='';for(var k=0;k<n;k++)x+=Math.floor(Math.random()*10);return x}
  app.querySelectorAll('[data-g]').forEach(function(el){var g=S.pins[+el.dataset.g];
    el.querySelectorAll('[data-gk]').forEach(function(inp){inp.oninput=inp.onchange=function(){var k=inp.dataset.gk;g[k]=inp.type=='checkbox'?inp.checked:(k=='pin'?inp.value.replace(/\D/g,''):inp.value);if(k=='pin')inp.value=g.pin;if(inp.type=='checkbox')el.classList.toggle('off',!inp.checked);mark()}});
    var rb=el.querySelector('[data-grnd]');rb.onclick=function(){g.pin=rnd();el.querySelector('[data-gk=pin]').value=g.pin;mark()};
    el.querySelectorAll('[data-gday]').forEach(function(b){b.onclick=function(){g.days=g.days||[0,1,2,3,4,5,6];var d=+b.dataset.gday,k=g.days.indexOf(d);if(k>=0)g.days.splice(k,1);else g.days.push(d);b.classList.toggle('on');mark()}});
    var mu=el.querySelector('[data-gk=maxUses]');mu.onchange=function(){g.maxUses=+mu.value;mark()};
  });
  app.querySelectorAll('[data-gdel]').forEach(function(b){b.onclick=function(){S.pins.splice(+b.dataset.gdel,1);render();mark()}});
  document.getElementById('addg').onclick=function(){S.pins.push({id:'g'+Date.now(),name:'',pin:rnd(),enabled:true,from:'',to:'',days:[0,1,2,3,4,5,6],tFrom:'',tTo:'',maxUses:0});render();mark()};
  [['pl',function(v){S.pinOpts.length=+v}],['pt',function(v){S.pinOpts.attempts=+v}],['pf',function(v){S.pinOpts.fail=v}]].forEach(function(x){var e=document.getElementById(x[0]);e.onchange=function(){x[1](e.value);mark();if(x[0]=='pl')render()}});
  document.getElementById('pco').onchange=function(e){S.pinOpts.callOwner=e.target.checked;mark()};
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
  document.getElementById('nl').onclick=function(){if(!confirm(T.newLinkConfirm))return;call('newLink',null,function(u){B.link=u;var m=document.getElementById('nlmsg');m.innerHTML=T.newLinkDone+'<br><a class="link" target="_top" href="'+h(u)+'">'+h(u)+'</a>';try{var q=JSON.parse(localStorage.getItem('gk')||'{}');var k=(u.match(/[#&]k=([a-f0-9]+)/)||[])[1];if(k){KEY=k;B.key=k;q.k=k;localStorage.setItem('gk',JSON.stringify(q))}}catch(e){}},fail)};
}
function fail(e){var er=document.getElementById('err');er.textContent=(e&&e.message)||e;er.style.display='block'}
function save(){
  var b=document.getElementById('save'),err=document.getElementById('err');b.textContent=T.saving;err.style.display='none';
  call('save',S,function(d){D=d;S=JSON.parse(JSON.stringify(d.cfg));dirty=false;render();b.classList.remove('dirty');b.textContent=T.saved;setTimeout(function(){if(!dirty)b.textContent=T.save},1800)},
    function(e){fail(e);b.textContent=T.save;b.classList.add('dirty')});
}
boot();
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
