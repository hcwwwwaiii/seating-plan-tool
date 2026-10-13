const viewEl = id => document.getElementById(id);
let viewData = {}, viewedClass = new URL(location.href).searchParams.get('class');
const viewSize = value => Math.max(1, Math.min(15, Math.round(Number(value) || 6)));
function viewNode(tag, text, className, parent) {
    const node = document.createElement(tag); node.textContent = text; node.className = className; parent.append(node); return node;
}
function readSeatingTables() {
    try {
        const raw = localStorage.getItem('seatingPro');
        viewData = raw ? JSON.parse(raw) : {};
        if (!viewData || typeof viewData !== 'object') throw Error('Invalid saved data');
        const saved = viewData.classes;
        viewData.classes = saved && typeof saved === 'object' && !Array.isArray(saved)
            ? Object.fromEntries(Object.entries(saved).filter(([, data]) => data && typeof data === 'object' && !Array.isArray(data))) : {};
        const ids = Object.keys(viewData.classes);
        if (!ids.includes(viewedClass)) viewedClass = ids.includes(viewData.currentClass) ? viewData.currentClass : ids[0];
        viewEl('viewEmpty').hidden = ids.length > 0;
        viewEl('viewClassroom').hidden = ids.length === 0;
        if (!ids.length) {
            viewEl('emptyTitle').textContent = '未有座位表';
            viewEl('emptyMessage').textContent = '請在同一個瀏覽器的編排頁新增班別和名單，或匯入已保存的 TXT。';
        }
        renderViewClasses(); if (ids.length) renderViewedClass();
    } catch {
        viewEl('viewClasses').replaceChildren(); viewEl('viewClassroom').hidden = true; viewEl('viewEmpty').hidden = false;
        viewEl('emptyTitle').textContent = '暫時無法讀取座位表';
        viewEl('emptyMessage').textContent = '請返回編排頁確認資料，或匯入 TXT 備份。';
    }
}
function renderViewClasses() {
    const tabs = viewEl('viewClasses'); tabs.replaceChildren();
    Object.entries(viewData.classes).forEach(([id, data]) => {
        const button = viewNode('button', String(data.name || '未命名班別'), 'class-button', tabs);
        button.type = 'button'; button.setAttribute('aria-current', String(id === viewedClass));
        viewNode('span', `${Array.isArray(data.students) ? data.students.length : 0} 人`, 'class-count', button);
        button.addEventListener('click', () => {
            viewedClass = id;
            const url = new URL(location.href); url.searchParams.set('class', id); history.replaceState(null, '', url);
            renderViewClasses(); renderViewedClass();
        });
    });
}
function renderViewedClass() {
    const data = viewData.classes[viewedClass]; if (!data) return;
    const rows = viewSize(data.rows), cols = viewSize(data.cols);
    const disabled = new Set(Array.isArray(data.disabled) ? data.disabled : []);
    const locked = new Map(Array.isArray(data.locked) ? data.locked.filter(entry => Array.isArray(entry) && entry.length >= 2) : []);
    const seating = Array.from({length: rows * cols}, (_, index) => disabled.has(index) ? null : data.seating?.[index] || null);
    const count = Array.isArray(data.students) ? data.students.length : 0, placed = seating.filter(Boolean).length;
    const details = viewEl('showDetails').checked;
    viewEl('classTitle').textContent = String(data.name || '未命名班別');
    document.title = `${data.name || '班別'} · 座位表查看`;
    viewEl('classStats').textContent = `${rows} 行 × ${cols} 列 · 已入座 ${placed}／${count} 人`;
    viewEl('viewDesk').className = 'desk-row ' + ({'desk-center':'center','desk-right':'right'}[data.desk || viewData.desk] || 'left');
    const grid = viewEl('viewSeats'); grid.replaceChildren();
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(76px, 1fr))`;
    grid.style.minWidth = `${cols * 76 + (cols - 1) * 10}px`;
    seating.forEach((student, index) => {
        const seat = viewNode('article', '', 'seat', grid); seat.setAttribute('role', 'listitem');
        const position = `第 ${Math.floor(index / cols) + 1} 行第 ${index % cols + 1} 列`;
        if (disabled.has(index)) { seat.classList.add('disabled'); seat.textContent = '禁用'; seat.setAttribute('aria-label', position + '，禁用'); return; }
        if (!student) { seat.classList.add('empty'); seat.textContent = locked.has(index) ? '空位 · 已鎖定' : '空位'; seat.setAttribute('aria-label', position + '，' + seat.textContent); return; }
        seat.setAttribute('aria-label', position + '，' + String(student.nameZh || '未命名'));
        if (details) seat.classList.add(student.gender === '女' ? 'female' : 'male');
        viewNode('span', String(student.id ?? '') + (details ? ' · ' + String(student.gender || '') : ''), 'seat-number', seat);
        viewNode('span', String(student.nameZh || '未命名'), 'seat-name', seat);
        if (student.nameEn) viewNode('span', String(student.nameEn), 'seat-english', seat);
        if (details && Array.isArray(student.special) && student.special.length) viewNode('span', student.special.map(String).join('／'), 'seat-tags', seat);
    });
    viewEl('viewNotice').textContent = !count ? '這個班別未加入學生，請到編排頁加入名單。' : count > placed ? `尚有 ${count - placed} 位學生未入座，請到編排頁完成安排。` : '查看模式 · 座位不會因點選或拖曳而更改。';
}
viewEl('refreshBtn').addEventListener('click', readSeatingTables);
viewEl('showDetails').addEventListener('change', renderViewedClass);
window.addEventListener('storage', event => { if (event.key === 'seatingPro' || event.key === null) readSeatingTables(); });
window.addEventListener('pageshow', readSeatingTables);
document.addEventListener('visibilitychange', () => { if (!document.hidden) readSeatingTables(); });
readSeatingTables();
