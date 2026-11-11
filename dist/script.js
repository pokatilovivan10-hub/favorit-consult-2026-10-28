/*
  ЮЦ «Фаворит». Интеграция заявок:
  1. На сервере настройте безопасный HTTPS-обработчик заявок.
  2. Перед подключением script.js установите window.FAVORIT_LEAD_ENDPOINT = '/api/leads';
  3. Обработчик должен возвращать HTTP 2xx только после успешного приёма заявки.
  Без обработчика формы работают в режиме демонстрации и ЧЕСТНО сообщают,
  что данные не были отправлены (вместо ложного сообщения об успехе).
*/
(() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const API_ENDPOINT = typeof window.FAVORIT_LEAD_ENDPOINT === 'string' ? window.FAVORIT_LEAD_ENDPOINT.trim() : '';
  const phoneLink = '<a href="tel:88006008475">8 (800) 600-84-75</a>';

  $('#year').textContent = new Date().getFullYear();
  // Mobile menu, closes after selecting any link.
  const nav = $('#main-nav');
  const menu = $('#menu-toggle');
  menu.addEventListener('click', () => {
    const opened = menu.getAttribute('aria-expanded') === 'true';
    menu.setAttribute('aria-expanded', String(!opened));
    menu.setAttribute('aria-label', opened ? 'Открыть меню' : 'Закрыть меню');
    nav.classList.toggle('open', !opened);
  });
  $$('#main-nav a').forEach(a => a.addEventListener('click', () => {
    nav.classList.remove('open');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Открыть меню');
  }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#callback-modal').hidden) closeModal();
  });

  const questions = [
    { title:'Какая общая сумма ваших долгов?', hint:'Укажите примерную общую задолженность — точность до рубля не нужна.', type:'radio', values:['Менее 300 000 ₽','300 000–500 000 ₽','500 000–1 000 000 ₽','Более 1 000 000 ₽'] },
    { title:'Какие у вас долги?', hint:'Можно выбрать несколько вариантов.', type:'checkbox', values:['Банковские кредиты','Микрозаймы','Налоги и взносы','ЖКХ','Долги по расписке','Другое'] },
    { title:'Есть ли просрочки по платежам?', hint:'Выберите наиболее подходящий ответ.', type:'radio', values:['Нет, плачу вовремя','Есть, менее 3 месяцев','Есть, более 3 месяцев','Платежи не вношу'] },
    { title:'Есть ли ипотека или автокредит?', hint:'Это важно для оценки рисков в отношении имущества.', type:'radio', values:['Да, ипотека','Да, автокредит','И ипотека, и автокредит','Нет'] },
    { title:'Как вам удобнее получить результат?', hint:'Подберём удобный способ связи.', type:'radio', values:['Звонок по телефону','Telegram','WhatsApp','Не принципиально'] }
  ];
  const answers = Array(questions.length).fill(null);
  let step = 0; // 0..4 are questions, 5 is the contact panel.
  const questionNode = $('#quiz-question'), optionsNode = $('#quiz-options'), contactNode = $('#quiz-contact');
  const errorNode = $('#quiz-error'), next = $('#quiz-next'), back = $('#quiz-back'), bar = $('#progress-bar');
  const showError = msg => { errorNode.textContent = msg; errorNode.hidden = !msg; };
  function renderQuiz() {
    showError('');
    const last = step === questions.length;
    $('#step-counter').textContent = last ? 'Последний шаг' : `Вопрос ${step + 1} из ${questions.length}`;
    bar.style.width = `${last ? 100 : ((step + 1) / questions.length * 100)}%`;
    questionNode.hidden = last; optionsNode.hidden = last; contactNode.hidden = !last;
    back.disabled = step === 0;
    next.innerHTML = last ? 'Отправить заявку <span aria-hidden="true">→</span>' : 'Далее <span aria-hidden="true">→</span>';
    if (last) { $('#quiz-name').focus({ preventScroll: true }); return; }
    const q = questions[step], selected = answers[step] || [];
    questionNode.replaceChildren();
    const h = document.createElement('h3'); h.textContent = q.title;
    const p = document.createElement('p'); p.textContent = q.hint;
    questionNode.append(h, p);
    optionsNode.replaceChildren();
    q.values.forEach((value, idx) => {
      const label = document.createElement('label');
      label.className = 'quiz-option' + (q.type === 'checkbox' ? ' checkbox' : '') + (selected.includes(value) ? ' selected' : '');
      const input = document.createElement('input');
      input.type = q.type; input.name = 'question-' + step; input.value = value;
      input.checked = selected.includes(value);
      const mark = document.createElement('span'); mark.className = 'option-mark'; mark.setAttribute('aria-hidden','true');
      const txt = document.createElement('span'); txt.textContent = value;
      label.append(input, mark, txt);
      input.addEventListener('change', () => {
        if (q.type === 'radio') answers[step] = [value];
        else {
          const set = new Set(answers[step] || []);
          input.checked ? set.add(value) : set.delete(value);
          answers[step] = [...set];
        }
        $$('.quiz-option', optionsNode).forEach(el => el.classList.toggle('selected', $('input',el).checked));
        showError('');
      });
      optionsNode.append(label);
    });
  }
  next.addEventListener('click', async () => {
    if (step < questions.length) {
      if (!answers[step]?.length) return showError('Пожалуйста, выберите хотя бы один вариант.');
      step += 1; renderQuiz();
    } else {
      const data = getValidatedFormData($('#quiz-form'), 'quiz');
      if (!data.ok) return showError(data.error);
      showError('');
      next.disabled = true;
      await submitLead(data.lead, $('#quiz-result'));
      next.disabled = false;
    }
  });
  back.addEventListener('click', () => { if(step > 0){step-=1;renderQuiz();} });
  renderQuiz();

  // Shared validation and safe submission for all forms.
  function cleanPhone(value) {
    const raw = String(value || '').replace(/\D/g, '');
    const digits = raw.length === 11 && (raw[0] === '7' || raw[0] === '8') ? raw.slice(1) : raw;
    return digits.length === 10 ? '+7' + digits : null;
  }
  function getValidatedFormData(form, source) {
    const name = $('[name="name"]', form)?.value.trim().replace(/\s+/g,' ') || '';
    const phone = cleanPhone($('[name="phone"]', form)?.value);
    const consent = $('input[type="checkbox"][id$="consent"]',form)?.checked;
    if (name.length < 2) return {ok:false,error:'Укажите имя (не менее двух символов).'};
    if (!phone) return {ok:false,error:'Введите российский номер телефона: +7 и 10 цифр.'};
    if (!consent) return {ok:false,error:'Для обратной связи нужно согласие на обработку данных.'};
    return {ok:true,lead:{source, name, phone, consent:true,
      quiz:source==='quiz' ? Object.fromEntries(questions.map((q,i)=>[q.title, answers[i] || []])) : undefined,
      page:window.location.href.split('#')[0],createdAt:new Date().toISOString()}};
  }
  function displayResult(node, text, ok) {
    node.hidden = false; node.classList.toggle('success', !!ok);
    node.innerHTML = text;
  }
  async function submitLead(lead, target) {
    if (!API_ENDPOINT) {
      displayResult(target, `Это демонстрационная версия: заявка <strong>не отправлена</strong>. Чтобы связаться с компанией, позвоните ${phoneLink}. Для онлайн-приёма заявок необходимо подключить CRM или обработчик формы.`, false);
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      let response;
      try { response = await fetch(API_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(lead),signal:controller.signal,credentials:'same-origin'}); }
      finally { clearTimeout(timeout); }
      if (!response.ok) throw new Error('Submission failed');
      displayResult(target,'Спасибо! Ваша заявка получена. Свяжемся с вами по указанному номеру.',true);
    } catch(err) {
      displayResult(target,`Не удалось отправить заявку. Попробуйте позже или позвоните ${phoneLink}.`,false);
    }
  }
  function bindRegularForm(id, resultId, source) {
    const form = $(id), result = $(resultId);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const data = getValidatedFormData(form,source);
      if (!data.ok) { displayResult(result,data.error,false); return; }
      const btn = $('button[type="submit"]',form);btn.disabled = true;
      await submitLead(data.lead, result);
      btn.disabled = false;
    });
  }
  bindRegularForm('#contact-form','#contact-result','contact');
  bindRegularForm('#modal-form','#modal-result','modal');

  const modal = $('#callback-modal');
  let lastFocused = null;
  function openModal() {
    lastFocused = document.activeElement;
    modal.hidden = false; modal.setAttribute('aria-hidden','false');
    document.body.classList.add('modal-open');
    $('#modal-name').focus();
  }
  function closeModal() {
    modal.hidden = true; modal.setAttribute('aria-hidden','true');
    document.body.classList.remove('modal-open');
    lastFocused?.focus?.();
  }
  $$('.open-modal').forEach(b => b.addEventListener('click',openModal));
  $('#modal-close').addEventListener('click',closeModal);
  $('.modal-backdrop').addEventListener('click',closeModal);
  modal.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const focusables = $$('a[href],button:not([disabled]),input:not([disabled])',modal).filter(el => el.offsetParent !== null);
    const first = focusables[0], last = focusables[focusables.length-1];
    if (e.shiftKey && document.activeElement === first) {e.preventDefault();last.focus();}
    else if (!e.shiftKey && document.activeElement === last) {e.preventDefault();first.focus();}
  });
})();
