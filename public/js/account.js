'use strict';
(() => {
    const status = document.querySelector('#profile-message');
    const avatar = document.querySelector('#profile-avatar');
    const name = document.querySelector('#profile-name');
    let csrf = '';
    const showMessage = (text, error = false) => {
        status.textContent = text;
        status.classList.toggle('is-error', error);
    };
    async function getCsrf() {
        const response = await fetch('/api/auth/csrf');
        if (!response.ok) throw new Error('Не удалось получить токен формы.');
        csrf = (await response.json()).token;
    }
    async function request(url, method, body, multipart = false) {
        if (!csrf) await getCsrf();
        const response = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: { 'x-csrf-token': csrf, ...(body && !multipart ? { 'content-type': 'application/json' } : {}) },
            ...(body ? { body: multipart ? body : JSON.stringify(body) } : {})
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Ошибка запроса.');
        return data;
    }
    function render(user) {
        document.querySelector('#profile-login').textContent = user.login;
        name.textContent = user.fullName;
        document.querySelector('#profile-email').textContent = user.email;
        document.querySelector('#edit-name').value = user.fullName;
        document.querySelector('#edit-email').value = user.email;
        avatar.src = user.hasAvatar ? `/api/me/avatar?v=${Date.now()}` : '/images/avatar-placeholder.svg';
    }
    async function refresh() {
        const response = await fetch('/api/me', { credentials: 'same-origin' });
        if (response.status === 401) return location.replace('/?auth=login');
        if (!response.ok) throw new Error('Не удалось загрузить профиль.');
        render((await response.json()).user);
    }
    function bind(id, callback) {
        document.querySelector(id).addEventListener('submit', async event => {
            event.preventDefault();
            const button = event.currentTarget.querySelector('[type=submit]');
            button.disabled = true;
            showMessage('');
            try { await callback(event.currentTarget); }
            catch (error) { showMessage(error.message, true); }
            finally { button.disabled = false; }
        });
    }
    bind('#profile-edit', async form => {
        const fields = Object.fromEntries(new FormData(form));
        const result = await request('/api/me', 'PATCH', fields);
        render(result.user);
        showMessage('Данные профиля сохранены.');
    });
    bind('#profile-password', async form => {
        const fields = Object.fromEntries(new FormData(form));
        if (fields.newPassword !== fields.confirmPassword) throw new Error('Новые пароли не совпадают.');
        await request('/api/me/password', 'POST', {
            currentPassword: fields.currentPassword,
            newPassword: fields.newPassword
        });
        form.reset();
        showMessage('Пароль успешно изменён.');
    });
    bind('#profile-photo', async form => {
        const data = new FormData(form);
        await request('/api/me/avatar', 'POST', data, true);
        await refresh();
        form.reset();
        showMessage('Аватар обновлён.');
    });
    document.querySelector('#remove-avatar').addEventListener('click', async () => {
        try {
            await request('/api/me/avatar', 'DELETE');
            await refresh();
            showMessage('Аватар удалён.');
        } catch (error) { showMessage(error.message, true); }
    });
    document.querySelector('#profile-logout').addEventListener('click', async () => {
        try {
            await request('/api/auth/logout', 'POST');
            location.assign('/');
        } catch (error) { showMessage(error.message, true); }
    });
    Promise.all([getCsrf(), refresh()]).catch(error => showMessage(error.message, true));
})();
