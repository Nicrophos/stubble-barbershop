const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#site-nav');

if (menuButton && navigation) {
    const closeMenu = () => {
        menuButton.setAttribute('aria-expanded', 'false');
        menuButton.setAttribute('aria-label', 'Открыть меню');
        navigation.classList.remove('is-open');
    };

    menuButton.addEventListener('click', () => {
        const opened = menuButton.getAttribute('aria-expanded') === 'true';
        menuButton.setAttribute('aria-expanded', String(!opened));
        menuButton.setAttribute('aria-label', opened ? 'Открыть меню' : 'Закрыть меню');
        navigation.classList.toggle('is-open', !opened);
    });

    navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeMenu();
    });
    document.addEventListener('click', event => {
        if (!navigation.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
    });
    window.addEventListener('resize', () => {
        if (window.innerWidth > 800) closeMenu();
    });
}
