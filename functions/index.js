const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { Resend } = require('resend');

setGlobalOptions({ region: 'asia-northeast3', maxInstances: 10 });

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  RESEND_API_KEY,
  NOTIFY_EMAIL,
  EMAIL_FROM = 'onboarding@resend.dev',
  ADMIN_URL = 'https://jasup-feedback.web.app/admin.html'
} = process.env;

const RISK_KEYWORDS = ['힘들','그만','못 하겠','못하겠','자퇴','우울','죽고','포기','괴로','싫어'];
const RISK_CONDITIONS = new Set(['burnout', 'worry', 'peer_pressure']);
const PRIORITY_THRESHOLD = 4;

const CATEGORY_LABELS = {
  env_bad: {
    too_hot: '너무 덥다', too_cold: '너무 춥다', stuffy_air: '공기 탁함',
    lighting: '조명 불편', desk_chair: '책상·의자 불편', outlet: '콘센트 부족',
    corridor_noise: '방음 안 됨', restroom_water: '화장실·정수기 멂',
    whispering: '속삭임', chatting_time: '특정 시간대 소란', sleeping: '잠자는 학생',
    snack_noise: '간식 소리', repetitive_sound: '반복적 소리', movement: '잦은 출입',
    phone_vibrate: '휴대폰 진동'
  },
  op_bad: {
    study_too_long: '자습시간 길다', seating: '좌석 배치', too_strict: '규칙 엄격',
    too_loose: '규칙 느슨', teacher_diff: '감독 선생님 차이', time_adjust: '야간자습 시간',
    class_pace: '수업 속도·난이도', class_visibility: '칠판 안 보임'
  },
  condition: {
    focus_drop: '집중 어려움', dont_know_what: '계획 헷갈림', sleepy: '잠 부족',
    burnout: '지침', worry: '고민 많음', peer_pressure: '비교 불안', condition_none: '괜찮음'
  }
};

function parseArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
}

function computeRisk(d) {
  const envBad = parseArr(d.env_bad).length
    + parseArr(d.facility).filter(k => !k.endsWith('_none')).length
    + parseArr(d.noise).filter(k => !k.endsWith('_none')).length;
  const opBad = parseArr(d.op_bad).length
    + parseArr(d.rules).filter(k => !k.endsWith('_none')).length;
  const cond = parseArr(d.condition);
  const condBad = cond.filter(v => v !== 'condition_none').length;
  const condRisk = cond.filter(v => RISK_CONDITIONS.has(v)).length;
  const text = [d.free_text, d.condition_etc, d.env_etc, d.op_etc, d.facility_etc, d.noise_etc, d.rules_etc]
    .filter(Boolean).join(' ').toLowerCase();
  const hitKeyword = RISK_KEYWORDS.find(k => text.includes(k)) || null;
  const keywordBoost = hitKeyword ? 2 : 0;
  const total = envBad + opBad + condBad + condRisk + keywordBoost;
  return { total, hitKeyword, envBad, opBad, condBad };
}

function summarize(d, risk) {
  const negBad = [];
  const cond = parseArr(d.condition);
  cond.filter(v => v !== 'condition_none').forEach(k => {
    if (CATEGORY_LABELS.condition[k]) negBad.push(CATEGORY_LABELS.condition[k]);
  });
  parseArr(d.env_bad).slice(0, 3).forEach(k => {
    if (CATEGORY_LABELS.env_bad[k]) negBad.push(CATEGORY_LABELS.env_bad[k]);
  });
  parseArr(d.op_bad).slice(0, 3).forEach(k => {
    if (CATEGORY_LABELS.op_bad[k]) negBad.push(CATEGORY_LABELS.op_bad[k]);
  });
  return negBad.slice(0, 6);
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    logger.warn('Telegram env 미설정 - 알림 건너뜀');
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram 발송 실패 ${res.status}: ${body}`);
  }
}

async function sendEmail({ subject, html }) {
  if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
    logger.warn('Resend env 미설정 - 이메일 건너뜀');
    return;
  }
  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: NOTIFY_EMAIL,
    subject,
    html
  });
  if (error) throw new Error(`이메일 발송 실패: ${JSON.stringify(error)}`);
}

function shortenText(s, len = 200) {
  if (!s) return '';
  const t = String(s).trim();
  return t.length > len ? t.slice(0, len) + '…' : t;
}

exports.notifyOnFeedback = onDocumentCreated('study_room_reports/{docId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const d = snap.data();
  const risk = computeRisk(d);
  const isPriority = d.priority_flag === true || risk.total >= PRIORITY_THRESHOLD || d.want_talk === 'yes' || !!risk.hitKeyword;
  const priorityIcon = isPriority ? '🚨' : '📮';
  const room = d.study_room || '?';
  const name = d.student_name && d.student_name !== '익명' ? d.student_name : '익명';
  const summary = summarize(d, risk);
  const wantTalk = d.want_talk === 'yes' ? ' · 🙋 면담 희망' : '';

  // 텔레그램: 모든 응답
  try {
    let tgText = `${priorityIcon} <b>말해보살 새 응답</b>\n`;
    tgText += `📍 <b>${room}</b> · ${name}${wantTalk}\n`;
    tgText += `⚠️ 위험도: <b>${risk.total}</b>${risk.hitKeyword ? ` · 🔍 "${risk.hitKeyword}" 감지` : ''}\n`;
    if (summary.length) tgText += `📌 ${summary.join(' · ')}\n`;
    if (d.free_text) tgText += `\n💬 ${shortenText(d.free_text, 300)}\n`;
    if (d.one_wish) tgText += `⭐ ${shortenText(d.one_wish, 150)}\n`;
    if (d.gratitude_text) tgText += `💝 감사·응원: ${shortenText(d.gratitude_text, 150)}\n`;
    const adminLink = `${ADMIN_URL}${ADMIN_URL.includes('?') ? '&' : '?'}id=${event.params.docId}`;
    tgText += `\n<a href="${adminLink}">🔗 이 응답 바로 열기</a>`;
    await sendTelegram(tgText);
    logger.info('텔레그램 발송 성공', { docId: event.params.docId, priority: isPriority });
  } catch (e) {
    logger.error('텔레그램 발송 오류', e);
  }

  // 이메일: 우선 처리 대상만
  if (isPriority) {
    try {
      const rows = [];
      const push = (k, v) => { if (v && String(v).trim()) rows.push(`<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;color:#4b3a2c;width:120px;">${k}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#111;">${escapeHtml(String(v))}</td></tr>`); };
      push('자습관', room);
      push('이름', name);
      push('위험도', risk.total);
      if (risk.hitKeyword) push('감지 키워드', `"${risk.hitKeyword}"`);
      if (d.want_talk === 'yes') push('면담', '희망 🙋');
      if (summary.length) push('부정 항목', summary.join(', '));
      push('자유 서술', d.free_text);
      push('환경 의견', d.env_etc);
      push('운영 의견', d.op_etc);
      push('컨디션 의견', d.condition_etc);
      push('가장 바라는 것', d.one_wish);
      push('감사·응원', d.gratitude_text);

      const html = `
        <div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#f8f6f1;padding:28px;">
          <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:2px solid ${risk.hitKeyword ? '#ef4444' : '#f43f5e'};box-shadow:0 6px 20px rgba(0,0,0,0.06);">
            <div style="font-size:12px;font-weight:800;color:#e11d48;letter-spacing:2px;margin-bottom:6px;">🚨 무엇이든 말해보살 · 우선 확인</div>
            <h1 style="font-size:22px;font-weight:900;color:#1a1310;margin:0 0 16px;">${room} · ${name} 학생의 응답</h1>
            <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;">${rows.join('')}</table>
            <div style="margin-top:22px;text-align:center;">
              <a href="${ADMIN_URL}${ADMIN_URL.includes('?') ? '&' : '?'}id=${event.params.docId}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#f43f5e,#e11d48);color:white;border-radius:12px;text-decoration:none;font-weight:800;font-size:14px;">→ 이 응답 바로 열기</a>
            </div>
            <div style="margin-top:20px;padding-top:14px;border-top:1px dashed #eee;font-size:11px;color:#9ca3af;text-align:center;">
              이 이메일은 <strong>위험도 ${PRIORITY_THRESHOLD} 이상</strong> 또는 <strong>위험 키워드 감지</strong> 또는 <strong>면담 희망</strong> 시에만 발송됩니다.
            </div>
          </div>
        </div>
      `;
      const subject = `🚨 [말해보살] ${room} · ${name} 학생 우선 확인 필요`;
      await sendEmail({ subject, html });
      logger.info('이메일 발송 성공', { docId: event.params.docId });
    } catch (e) {
      logger.error('이메일 발송 오류', e);
    }
  }
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}
