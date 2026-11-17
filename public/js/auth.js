'use strict';
// ЛР4. Всплывающие формы. Пользовательские данные выводим только через textContent.
(() => {
    const nav = document.querySelector('#site-nav');
    if (!nav) return;

    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'auth-nav-button';
    entry.textContent = 'ВОЙТИ';
    nav.append(entry);

    const dialog = document.createElement('dialog');
    dialog.className = 'auth-dialog';
    dialog.setAttribute('aria-label', 'Вход и регистрация');
    dialog.innerHTML = `
      <div class="auth-window">
        <button class="auth-close" type="button" aria-label="Закрыть окно">×</button>
        <p class="auth-caption">STUBBLE / ЛИЧНЫЙ КАБИНЕТ</p>
        <h2 id="auth-title">ВОЙТИ</h2>
        <p id="auth-message" class="auth-message" role="status" aria-live="polite"></p>

        <form id="form-login" class="auth-form">
          <label>Логин<input name="login" autocomplete="username" required minlength="3" maxlength="30"></label>
          <label>Пароль<input type="password" name="password" autocomplete="current-password" required></label>
          <button type="submit" class="auth-submit">ВОЙТИ</button>
          <div class="auth-links"><button type="button" data-screen="register">Регистрация</button><button type="button" data-screen="forgot">Забыли пароль?</button></div>
        </form>

        <form id="form-register" class="auth-form" hidden enctype="multipart/form-data">
          <label>Логин (латиница, цифры, _)<input name="login" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]+" autocomplete="username"></label>
          <label>ФИО<input name="fullName" required minlength="2" maxlength="120" autocomplete="name"></label>
          <label>Электронная почта<input type="email" name="email" required autocomplete="email"></label>
          <label>Пароль (от 8 символов)<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
          <label>Аватар (JPG, PNG, WEBP; до 2 МБ)<input type="file" name="avatar" accept="image/jpeg,image/png,image/webp"></label>
          <button type="submit" class="auth-submit">ЗАРЕГИСТРИРОВАТЬСЯ</button>
          <div class="auth-links"><button type="button" data-screen="login">Уже есть аккаунт? Войти</button></div>
        </form>

        <form id="form-forgot" class="auth-form" hidden>
          <p class="auth-hint">Для лабораторной ссылка восстановления показывается прямо здесь (без отправки письма).</p>
          <label>Почта аккаунта<input type="email" name="email" required autocomplete="email"></label>
          <button type="submit" class="auth-submit">ПОЛУЧИТЬ ССЫЛКУ</button>
          <div id="auth-reset-link" class="auth-reset-link"></div>
          <div class="auth-links"><button type="button" data-screen="login">Назад ко входу</button></div>
        </form>
      </div>`;
    document.body.append(dialog);

    const title = dialog.querySelector('#auth-title');
    const message = dialog.querySelector('#auth-message');
    const forms = {
        login: dialog.querySelector('#form-login'),
        register: dialog.querySelector('#form-register'),
        forgot: dialog.querySelector('#form-forgot')
    };
    const titles = { login: 'ВОЙТИ', register: 'РЕГИСТРАЦИЯ', forgot: 'ВОССТАНОВЛЕНИЕ' };
    let csrf = '';
    async function loadCsrf() {
        const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
        if (!response.ok) throw new Error('Ошибка связи с сервером.');
        csrf = (await response.json()).token;
    }
    async function api(url, options = {}) {
        if (!csrf) await loadCsrf();
        const response = await fetch(url, {
            method: options.method || 'POST',
            credentials: 'same-origin',
            headers: { 'x-csrf-token': csrf, ...options.headers },
            body: options.body
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
        return data;
    }
    function screen(name) {
        for (const [key, form] of Object.entries(forms)) form.hidden = key !== name;
        title.textContent = titles[name];
        message.textContent = '';
        dialog.querySelector('#auth-reset-link').replaceChildren();
    }
    function open(name = 'login') {
        screen(name);
        dialog.showModal();
    }
    entry.addEventListener('click', () => open('login'));
    dialog.querySelector('.auth-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.querySelectorAll('[data-screen]').forEach(button => {
        button.addEventListener('click', () => screen(button.dataset.screen));
    });
    async function submit(form, url, multipart = false) {
        const button = form.querySelector('[type="submit"]');
        const original = button.textContent;
        button.disabled = true;
        button.textContent = 'ПОДОЖДИТЕ...';
        message.textContent = '';
        try {
            const data = new FormData(form);
            const body = multipart ? data : JSON.stringify(Object.fromEntries(data));
            const result = await api(url, {
                body, headers: multipart ? {} : { 'content-type': 'application/json' }
            });
            return result;
        } catch (error) {
            message.textContent = error.message;
            return null;
        } finally {
            button.disabled = false;
            button.textContent = original;
        }
    }
    forms.login.addEventListener('submit', async event => {
        event.preventDefault();
        if (await submit(forms.login, '/api/auth/login')) location.assign('/profile');
    });
    forms.register.addEventListener('submit', async event => {
        event.preventDefault();
        if (await submit(forms.register, '/api/auth/register', true)) location.assign('/profile');
    });
    forms.forgot.addEventListener('submit', async event => {
        event.preventDefault();
        const result = await submit(forms.forgot, '/api/auth/forgot');
        if (!result) return;
        message.textContent = result.message;
        if (result.resetUrl) {
            const link = document.createElement('a');
            link.href = result.resetUrl;
            link.textContent = 'Открыть ссылку для смены пароля';
            dialog.querySelector('#auth-reset-link').replaceChildren(link);
        }
    });
    // Состояние входа узнаём только у сервера, а не из localStorage.
    fetch('/api/me', { credentials: 'same-origin' })
        .then(res => {
            if (res.ok) {
                entry.textContent = 'ЛИЧНЫЙ КАБИНЕТ';
                entry.addEventListener('click', event => {
                    event.stopImmediatePropagation();
                    location.assign('/profile');
                }, { capture: true });
            }
        }).catch(() => {});
    if (new URLSearchParams(location.search).get('auth') === 'login') {
        open('login');
    }
})();
