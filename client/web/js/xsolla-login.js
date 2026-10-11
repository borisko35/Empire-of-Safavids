// Виджет входа Xsolla (login-sdk).
//
// ЗАЧЕМ. У проекта уже есть свой вход по почте, но Xsolla Login даёт «один
// аккаунт на все игры» издателя и социальные входы. Лендинг — единственное
// место, где ему место: на странице /game/ лежит токен авторизации и идут
// платежи, и сторонний скрипт там стоит несравнимо дороже.
//
// ЭТО СКРИПТ ПЛАТЁЖНОГО ПРОВАЙДЕРА, не реклама. Его домен тот же, что у
// платёжек, уже интегрированных в проект. Но файл всё равно чужой, поэтому
// грузится отдельным модулем и не трогает главный main.js.
//
// ГЛАВНОЕ — STATE. В документации Xsolla в примере стоит строка-заглушка
// "yourStateHere". Постоянное значение обнуляет смысл параметра state: он
// защищает от подстановки чужого кода авторизации (CSRF), а защита работает,
// только если значение случайное и сверяется при возврате. Здесь
// генерируется случайное и ЖДЁТ сверки на redirect-URI.
(function () {
  'use strict';

  var PROJECT_ID = '6a10f634-6de2-4cd2-b8ca-aa48f488d17a';
  var CLIENT_ID = '18679';
  var REDIRECT_URI = 'https://game.eos-gameonline.com/';
  // Ключ в localStorage для state. Срок — час: дольше смысла нет, короче —
  // не хватит на возврат с почты.
  var STATE_KEY = 'eos_xsolla_state';
  var STATE_TTL_MS = 3600000;

  function generateState() {
    var buf = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(buf);
    } else {
      for (var i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
    }
    var out = '';
    for (var j = 0; j < buf.length; j++) out += ('0' + buf[j].toString(16)).slice(-2);
    return out;
  }

  function rememberState(value) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ value: value, at: Date.now() }));
    } catch (e) {
      // Приватный режим: сверять state будет нечем, но вход всё равно лучше,
      // чем его отсутствие. Логируем тихо — это не ошибка игры.
      if (window.console) console.warn('[Xsolla] state не сохранён', e);
    }
  }

  function loadSdk() {
    return new Promise(function (resolve, reject) {
      if (window.XsollaLogin && window.XsollaLogin.Widget) {
        resolve();
        return;
      }
      var s = document.createElement('script');
      s.type = 'text/javascript';
      s.async = true;
      s.src = 'https://login-sdk.xsolla.com/latest/';
      s.addEventListener('load', function () { resolve(); });
      s.addEventListener('error', function () {
        reject(new Error('не удалось загрузить login-sdk.xsolla.com'));
      });
      var head = document.getElementsByTagName('head')[0];
      head.appendChild(s);
    });
  }

  // Язык виджета — по языку страницы, а не зашит в русский.
  // Xsolla знает не все языки: азербайджанского у него нет, и для az
  // откатываемся на английский, а не показываем русский не тем людям.
  var ЛОКАЛЬ = { ru: 'ru_ru', en: 'en_us', az: 'en_us' };

  function preferredLocale() {
    var lang = (document.documentElement.lang || 'ru').slice(0, 2).toLowerCase();
    return ЛОКАЛЬ[lang] || ЛОКАЛЬ.en;
  }

  function mount() {
    var host = document.getElementById('xl_auth');
    if (!host) return;
    var state = generateState();
    rememberState(state);
    var xl = new window.XsollaLogin.Widget({
      projectId: PROJECT_ID,
      preferredLocale: preferredLocale(),
      clientId: CLIENT_ID,
      responseType: 'code',
      state: state,
      redirectUri: REDIRECT_URI,
    });
    xl.mount('xl_auth');
    // Кнопка «открыть виджет» теперь тоже настоящая: без ссылки на
    // экземпляр виджета функция openWidget из документации была бы пустой.
    window.openXsollaWidget = function () {
      try {
        xl.open();
      } catch (e) {
        if (window.console) console.warn('[Xsolla] open() не сработал', e);
      }
    };
  }

  loadSdk().then(mount).catch(function (e) {
    if (window.console) console.warn('[Xsolla]', e);
    var host = document.getElementById('xl_auth');
    if (host) host.setAttribute('data-xsolla-error', '1');
  });
})();
