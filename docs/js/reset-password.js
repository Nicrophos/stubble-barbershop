'use strict';
(() => {
    const token = new URLSearchParams(location.search).get('token');
    const form = document.querySelector('#reset-form');
    const status = document.querySelector('#reset-status');
    if (!token) {
        status.textContent = 'Отсутствует токен восстановления.';
        form.hidden = true;
        return;
    }
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        if (data.password !== data.confirm) {
            status.textContent = 'Пароли не совпадают.';
            return;
        }
        try {
            const csrfResponse = await fetch('/api/auth/csrf');
            const { token: csrf } = await csrfResponse.json();
            const response = await fetch('/api/auth/reset', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
                body: JSON.stringify({ token, password: data.password })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Ошибка восстановления.');
            status.textContent = result.message;
            form.hidden = true;
            document.querySelector('#reset-home').hidden = false;
            history.replaceState(null, '', '/reset-password.html');
        } catch (error) { status.textContent = error.message; }
    });
})();
