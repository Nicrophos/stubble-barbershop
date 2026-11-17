// Мобильное меню STUBBLE
const button = document.querySelector('.menu-toggle');
const menu = document.querySelector('.nav');

if (button && menu) {
    button.addEventListener('click', function () {
        menu.classList.toggle('is-open');
        button.setAttribute('aria-expanded', String(menu.classList.contains('is-open')));
    });
}

// Лабораторная №3: переключение обычного и печатного CSS без перезагрузки.
const printButton = document.querySelector('.print-toggle');
const printStyles = document.querySelector('#print-styles');

if (printButton && printStyles) {
    printButton.addEventListener('click', function () {
        const printMode = printStyles.media === 'print';
        printStyles.media = printMode ? 'all' : 'print';
        printButton.textContent = printMode ? 'Обычная версия' : 'Версия для печати';
        printButton.setAttribute('aria-pressed', String(printMode));
    });
}
