// Лабораторная №3: умный фильтр услуг без перезагрузки страницы.
const filterForm = document.querySelector('#smart-filter');

if (filterForm) {
    const rows = [...document.querySelectorAll('.price-table tbody tr')];
    const checkboxes = [...filterForm.querySelectorAll('input[type="checkbox"]')];
    const criteria = ['category', 'duration', 'price', 'area', 'feature'];
    const result = document.querySelector('#filter-result');
    const reset = document.querySelector('#filter-reset');

    // Собираем выбранные значения каждого критерия.
    function selectedValues() {
        const selected = {};
        for (const criterion of criteria) {
            selected[criterion] = checkboxes
                .filter(box => box.name === criterion && box.checked)
                .map(box => box.value);
        }
        return selected;
    }

    // У услуги может быть несколько зон и процедур (значения через пробел).
    function hasValue(row, criterion, value) {
        return (row.dataset[criterion] || '').split(' ').includes(value);
    }

    // Внутри критерия — ИЛИ, между критериями — И.
    function matches(row, selected, ignoredCriterion = '') {
        return criteria.every(criterion => {
            if (criterion === ignoredCriterion) return true;
            const values = selected[criterion];
            return values.length === 0 || values.some(value => hasValue(row, criterion, value));
        });
    }

    function updateFilter() {
        const selected = selectedValues();
        let visible = 0;

        // Показываем только подходящие строки таблицы.
        for (const row of rows) {
            row.hidden = !matches(row, selected);
            if (!row.hidden) visible++;
        }
        result.textContent = `Найдено услуг: ${visible} из ${rows.length}`;

        // Умная часть: не позволяем выбрать вариант без результатов.
        for (const box of checkboxes) {
            const available = rows.some(row =>
                hasValue(row, box.name, box.value) &&
                matches(row, selected, box.name)
            );
            box.disabled = !box.checked && !available;
            box.closest('label').classList.toggle('is-disabled', box.disabled);
        }
    }

    filterForm.addEventListener('change', updateFilter);
    reset.addEventListener('click', function () {
        checkboxes.forEach(box => box.checked = false);
        updateFilter();
    });

    updateFilter();
}
