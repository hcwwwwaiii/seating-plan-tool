let students = [], currentSeating = [];
let rows = 6, cols = 6;
let disabledSeats = new Set(), lockedSeats = new Map();
let currentClass = 'default';
let classes = { default: { name: '預設座位表', students: [], history: [], seating: [], disabled: [], locked: [], rows: 6, cols: 6 } };
let selectedSeat = null, draggedIndex = null, contextMenuTarget = null;
const undoStacks = new Map();
const redoStacks = new Map();
let touchDrag = null, suppressSeatClickUntil = 0;
const defaultRules = { genderAlternate: false, frontPoorVision: true, backTall: true };
const modes = ['smart', 'id-vertical-ltr', 'id-vertical-rtl', 'id-horizontal-ltr', 'id-horizontal-rtl'];
const el = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const newUid = () => 'student_' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
const clampSize = value => Math.max(1, Math.min(15, Math.round(Number(value) || 6)));

const UI = {
    showToast(message, isError = false) {
        const toast = el('toast');
        toast.textContent = (isError ? '❌ ' : '✅ ') + message;
        toast.style.borderLeftColor = isError ? 'var(--danger)' : 'var(--success)';
        toast.classList.add('show');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    },
    openModal(title, message, inputShow, defaultValue, onConfirm) {
        el('modalTitle').textContent = title;
        el('modalMsg').textContent = message;
        el('modalInput').style.display = inputShow ? 'block' : 'none';
        el('modalInput').value = defaultValue;
        el('customModal').classList.add('show');
        const close = () => el('customModal').classList.remove('show');
        el('modalConfirmBtn').onclick = () => { close(); onConfirm(inputShow ? el('modalInput').value.trim() : true); };
        el('modalCancelBtn').onclick = close;
        el('modalInput').onkeydown = event => { if (event.key === 'Enter') el('modalConfirmBtn').click(); };
        (inputShow ? el('modalInput') : el('modalConfirmBtn')).focus();
    },
    confirm(title, message, callback) { this.openModal(title, message, false, '', callback); },
    prompt(title, message, value, callback) { this.openModal(title, message, true, value, callback); }
};

document.addEventListener('DOMContentLoaded', () => {
    loadFromStorage();
    bindEvents();
    document.addEventListener('click', event => {
        if (!event.target.closest('#contextMenu')) el('contextMenu').classList.remove('show');
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') { finishTouchDrag(); cancelSeatSelection(); el('contextMenu').classList.remove('show'); el('customModal').classList.remove('show'); }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.target.closest('input,textarea,select')) {
            event.preventDefault(); event.shiftKey ? redoLastAction() : undoLastAction();
        }
    });
    document.addEventListener('touchmove', moveTouchDrag, { passive: false });
    document.addEventListener('touchend', endTouchDrag, { passive: false });
    document.addEventListener('touchcancel', () => finishTouchDrag());
    window.addEventListener('blur', () => finishTouchDrag());
});

function bindEvents() {
    ['rows', 'cols'].forEach(field => el(field).addEventListener('change', event => {
        const value = clampSize(event.target.value);
        event.target.value = value;
        if (value === (field === 'rows' ? rows : cols)) return;
        rememberUndo('更改教室大小');
        if (field === 'rows') rows = value; else cols = value;
        const size = rows * cols;
        disabledSeats = new Set([...disabledSeats].filter(index => index < size));
        lockedSeats = new Map([...lockedSeats].filter(([index]) => index < size));
        selectedSeat = null;
        updateSeatingGrid(); saveToStorage();
    }));
    el('teacherDeskPos').addEventListener('change', () => {
        rememberUndo('更改教師桌位置');
        el('teacherDeskContainer').className = 'teacher-desk-container ' + el('teacherDeskPos').value;
        saveToStorage();
    });
    el('arrangeMode').addEventListener('change', () => { rememberUndo('更改編排方式'); toggleRuleOptions(); saveToStorage(); });
    Object.keys(defaultRules).forEach(id => el(id).addEventListener('change', () => { rememberUndo('更改編排規則'); saveToStorage(); }));
    el('applyStudentList').addEventListener('click', applyPastedRoster);
    el('addStudentBtn').addEventListener('click', () => {
        rememberUndo('新增學生');
        students.push({ uid: newUid(), id: String(nextStudentNumber()), nameZh: '', nameEn: '', gender: '男', special: [] });
        rosterChanged(); renderStudentTable();
        el('studentTableBody').lastElementChild.querySelector('[data-field="nameZh"]').focus();
    });
    el('studentTableBody').addEventListener('change', event => {
        const row = event.target.closest('[data-uid]');
        const student = students.find(item => item.uid === row?.dataset.uid);
        const field = event.target.dataset.field;
        if (!student || !field) return;
        rememberUndo('編輯學生資料');
        if (field === 'special') {
            student.special = student.special.filter(tag => tag !== event.target.value);
            if (event.target.checked) student.special.push(event.target.value);
        } else student[field] = event.target.value.trim();
        rosterChanged();
    });
    el('studentTableBody').addEventListener('click', event => {
        const button = event.target.closest('[data-delete]');
        if (!button) return;
        const student = students.find(item => item.uid === button.dataset.delete);
        UI.confirm('刪除學生', `刪除「${student.nameZh || student.id || '未命名學生'}」及其座位？可使用復原還原。`, () => {
            rememberUndo('刪除學生'); students = students.filter(item => item.uid !== student.uid);
            rosterChanged(); renderStudentTable();
        });
    });
    el('undoBtn').addEventListener('click', undoLastAction);
    el('redoBtn').addEventListener('click', redoLastAction);
    el('seatLockBtn').addEventListener('click', () => toggleSeatLock(selectedSeat));
    el('seatDisableBtn').addEventListener('click', () => toggleSeatStatus(selectedSeat));
    el('seatCancelBtn').addEventListener('click', cancelSeatSelection);
    el('cmToggleLock').addEventListener('click', () => toggleSeatLock(contextMenuTarget));
    el('cmToggleStatus').addEventListener('click', () => toggleSeatStatus(contextMenuTarget));
}

function toggleRuleOptions() { el('ruleOptionsGroup').hidden = el('arrangeMode').value !== 'smart'; }

function normalizeStudent(student) {
    return {
        uid: typeof student.uid === 'string' && student.uid ? student.uid : newUid(),
        id: String(student.id ?? '-'), nameZh: String(student.nameZh ?? ''), nameEn: String(student.nameEn ?? ''),
        gender: ['女', 'F'].includes(student.gender) ? '女' : '男',
        special: Array.isArray(student.special) ? [...new Set(student.special.filter(tag => typeof tag === 'string'))] : []
    };
}

function resolveStudent(student) {
    if (!student) return null;
    if (student.uid) return students.find(item => item.uid === student.uid) || null;
    const exact = students.filter(item => item.id === String(student.id) && item.nameZh === student.nameZh);
    if (exact.length === 1) return exact[0];
    const sameId = students.filter(item => item.id !== '-' && item.id === String(student.id));
    return sameId.length === 1 ? sameId[0] : null;
}

function syncSeatStudents() {
    const occupied = new Set();
    currentSeating = currentSeating.map((student, index) => {
        const resolved = disabledSeats.has(index) ? null : resolveStudent(student);
        if (!resolved || occupied.has(resolved.uid)) return null;
        occupied.add(resolved.uid); return resolved;
    });
    lockedSeats = new Map([...lockedSeats].filter(([index]) => index >= 0 && index < rows * cols && !disabledSeats.has(index))
        .map(([index, student]) => [index, resolveStudent(student)]));
}

function nextStudentNumber() { return Math.max(0, ...students.map(student => Number(student.id) || 0)) + 1; }

function renderStudentTable() {
    const body = el('studentTableBody'); body.replaceChildren();
    students.forEach(student => {
        const row = document.createElement('tr'); row.dataset.uid = student.uid;
        for (const field of ['id', 'nameZh', 'nameEn']) {
            const cell = row.insertCell(), input = document.createElement('input');
            input.type = 'text'; input.value = student[field]; input.dataset.field = field;
            input.setAttribute('aria-label', { id: '學號', nameZh: '中文名', nameEn: '英文名（選填）' }[field]);
            if (field === 'id') input.inputMode = 'numeric';
            cell.append(input);
        }
        const select = document.createElement('select'); select.dataset.field = 'gender'; select.setAttribute('aria-label', '性別');
        ['男', '女'].forEach(value => { const option = new Option(value, value); select.add(option); });
        select.value = student.gender; row.insertCell().append(select);
        ['視力照顧', '高個子'].forEach(tag => {
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.field = 'special';
            checkbox.value = tag; checkbox.checked = student.special.includes(tag); checkbox.setAttribute('aria-label', tag);
            const label = document.createElement('label'); label.className = 'table-check'; label.append(checkbox);
            row.insertCell().append(label);
        });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-student';
        remove.dataset.delete = student.uid; remove.textContent = '×'; remove.setAttribute('aria-label', `刪除 ${student.nameZh || student.id}`);
        row.insertCell().append(remove); body.append(row);
    });
    el('rosterEmpty').hidden = students.length > 0;
    el('rosterCount').textContent = `${students.length} 位學生`;
}

function csvField(value) { const text = String(value ?? ''); return /[,"\n\r]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; }
function rosterText() { return students.map(student => [student.id, student.nameZh, student.nameEn, student.gender, ...student.special].map(csvField).join(',')).join('\n'); }
function parseRosterLine(line) {
    if (line.includes('\t') && !line.includes(',')) return line.split('\t').map(value => value.trim());
    const fields = []; let value = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
        else if (line[i] === ',' && !quoted) { fields.push(value.trim()); value = ''; } else value += line[i];
    }
    fields.push(value.trim()); return fields;
}
function parseStudentList(text = el('studentList').value) {
    const previous = students;
    const next = text.split(/\r?\n/).filter(line => line.trim()).map(line => {
        const parts = parseRosterLine(line);
        let data;
        if (parts.length >= 4) data = { id: parts[0], nameZh: parts[1], nameEn: parts[2], gender: parts[3], special: parts.slice(4).filter(Boolean) };
        else if (parts.length === 3 && ['男', '女', 'M', 'F'].includes(parts[2])) data = /^\d+$/.test(parts[0])
            ? { id: parts[0], nameZh: parts[1], gender: parts[2] } : { id: '-', nameZh: parts[0], nameEn: parts[1], gender: parts[2] };
        else if (parts.length === 3) data = { id: parts[0], nameZh: parts[1], nameEn: parts[2], gender: '男' };
        else data = { id: '-', nameZh: parts[0], gender: parts[1] || '男' };
        if (data.id === '學號' && data.nameZh === '中文名') return null;
        const match = previous.filter(item => data.id !== '-' && item.id === data.id);
        const exact = previous.filter(item => item.id === data.id && item.nameZh === data.nameZh);
        if (match.length === 1) data.uid = match[0].uid;
        else if (exact.length === 1) data.uid = exact[0].uid;
        return normalizeStudent(data);
    }).filter(Boolean);
    const used = new Set();
    next.forEach(student => { if (used.has(student.uid)) student.uid = newUid(); used.add(student.uid); });
    students = next;
}
function applyPastedRoster() {
    UI.confirm('套用名單', '以貼上的內容更新學生名單。現有學生會依學號保留座位；可使用復原還原。', () => {
        rememberUndo('套用名單'); parseStudentList(); rosterChanged(); renderStudentTable();
        el('bulkRoster').open = false; UI.showToast('名單已更新，可逐人勾選特徵');
    });
}
function rosterChanged() {
    syncSeatStudents(); el('studentList').value = rosterText();
    updateSeatDisplay(); updateStats(); saveToStorage();
}

function rememberUndo(label) {
    finishTouchDrag();
    redoStacks.delete(currentClass);
    // The saved class is the state before a control's change event updates the live view.
    const stack = undoStacks.get(currentClass) || [];
    stack.push({ label, data: clone(classes[currentClass]) });
    if (stack.length > 30) stack.shift(); undoStacks.set(currentClass, stack); updateUndoButton();
}
function updateUndoButton() {
    const stack = undoStacks.get(currentClass) || [];
    el('undoBtn').disabled = stack.length === 0;
    el('undoBtn').textContent = stack.length ? `↶ 復原：${stack.at(-1).label}` : '↶ 復原上一步';
    const redo = redoStacks.get(currentClass) || [];
    el('redoBtn').disabled = redo.length === 0;
    el('redoBtn').textContent = redo.length ? `↷ 重做：${redo.at(-1).label}` : '↷ 重做上一步';
}
function undoLastAction() {
    const item = undoStacks.get(currentClass)?.pop(); if (!item) return;
    const redo = redoStacks.get(currentClass) || [];
    redo.push({ label: item.label, data: clone(classes[currentClass]) }); redoStacks.set(currentClass, redo);
    classes[currentClass] = item.data; loadClassData(item.data); saveToStorage();
    UI.showToast(`已復原：${item.label}`);
}
function redoLastAction() {
    const item = redoStacks.get(currentClass)?.pop(); if (!item) return;
    const undo = undoStacks.get(currentClass) || [];
    undo.push({ label: item.label, data: clone(classes[currentClass]) }); undoStacks.set(currentClass, undo);
    classes[currentClass] = item.data; loadClassData(item.data); saveToStorage();
    UI.showToast(`已重做：${item.label}`);
}

function updateSeatingGrid() {
    finishTouchDrag();
    const grid = el('seatingGrid'); grid.replaceChildren();
    grid.style.gridTemplateColumns = `repeat(${cols}, 80px)`;
    currentSeating = Array.from({ length: rows * cols }, (_, index) => currentSeating[index] || null);
    for (let index = 0; index < rows * cols; index++) {
        const seat = document.createElement('div'); seat.className = 'seat'; seat.dataset.index = index;
        seat.tabIndex = 0; seat.setAttribute('role', 'button');
        seat.addEventListener('click', event => { if (Date.now() < suppressSeatClickUntil) { event.preventDefault(); return; } selectSeat(index); });
        seat.addEventListener('touchstart', startTouchDrag, { passive: true });
        seat.addEventListener('keydown', event => { if (event.target === seat && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectSeat(index); } });
        seat.addEventListener('dragstart', handleDragStart);
        seat.addEventListener('dragend', () => { draggedIndex = null; document.querySelectorAll('.seat').forEach(item => item.classList.remove('dragging', 'drop-target')); });
        seat.addEventListener('dragover', event => { if (draggedIndex !== null && !disabledSeats.has(index) && !lockedSeats.has(index)) { event.preventDefault(); seat.classList.add('drop-target'); } });
        seat.addEventListener('dragleave', () => seat.classList.remove('drop-target'));
        seat.addEventListener('drop', handleDrop); seat.addEventListener('contextmenu', handleRightClick);
        grid.append(seat);
    }
    syncSeatStudents(); updateSeatDisplay(); updateStats();
}
function updateSeatDisplay() {
    document.querySelectorAll('.seat').forEach((seat, index) => {
        const student = currentSeating[index], locked = lockedSeats.has(index), disabled = disabledSeats.has(index);
        seat.replaceChildren(); seat.className = 'seat'; seat.draggable = !!student && !locked && !disabled;
        seat.classList.toggle('selected', selectedSeat === index); seat.setAttribute('aria-pressed', String(selectedSeat === index));
        seat.setAttribute('aria-label', `第 ${Math.floor(index / cols) + 1} 行第 ${index % cols + 1} 列，${disabled ? '禁用' : student?.nameZh || '空位'}${locked ? '，已鎖定' : ''}`);
        if (disabled) seat.classList.add('disabled');
        else {
            if (locked) seat.classList.add('locked');
            if (student) {
                seat.classList.add(student.gender === '女' ? 'female' : 'male');
                [['s-id', student.id], ['s-name-zh', student.nameZh || '未命名'], ['s-name-en', student.nameEn]].forEach(([className, value]) => {
                    const node = document.createElement('div'); node.className = className; node.textContent = value; seat.append(node);
                });
                [['視力照顧', 'poor-vision'], ['高個子', 'tall']].forEach(([tag, className]) => {
                    if (student.special.includes(tag)) { const badge = document.createElement('span'); badge.className = 'badge ' + className; badge.title = tag; seat.append(badge); }
                });
                if (locked) { const icon = document.createElement('span'); icon.className = 'seat-lock'; icon.textContent = '🔒'; seat.append(icon); }
            } else { seat.classList.add('empty'); seat.textContent = locked ? '🔒 鎖定' : '空位'; }
        }
    });
    updateSeatActions();
}
function selectSeat(index) {
    el('contextMenu').classList.remove('show');
    if (selectedSeat === index) { cancelSeatSelection(); return; }
    if (selectedSeat !== null && currentSeating[selectedSeat] && !lockedSeats.has(selectedSeat) && !disabledSeats.has(selectedSeat)) {
        if (lockedSeats.has(index) || disabledSeats.has(index)) { UI.showToast('目標座位已鎖定或禁用，請先解鎖／啟用', true); return; }
        swapSeats(selectedSeat, index); return;
    }
    selectedSeat = index; updateSeatDisplay();
}
function cancelSeatSelection() { finishTouchDrag(); selectedSeat = null; updateSeatDisplay(); }
function updateSeatActions() {
    const selected = selectedSeat !== null;
    el('seatActions').hidden = !selected;
    el('selectionHint').textContent = !selected ? '點選換位，或長按學生拖到另一座位' :
        lockedSeats.has(selectedSeat) ? '座位已鎖定，解鎖後才能換位' : disabledSeats.has(selectedSeat) ? '座位已禁用，可在下方啟用' :
        currentSeating[selectedSeat] ? '再點另一座位換位，或使用座位選單' : '已選中空位，可鎖定或禁用';
    if (!selected) return;
    el('selectedSeatLabel').textContent = `第 ${Math.floor(selectedSeat / cols) + 1} 行 · 第 ${selectedSeat % cols + 1} 列${currentSeating[selectedSeat] ? ' · ' + (currentSeating[selectedSeat].nameZh || '未命名') : ''}`;
    el('seatLockBtn').textContent = lockedSeats.has(selectedSeat) ? '🔓 解鎖' : '🔒 鎖定';
    el('seatLockBtn').disabled = disabledSeats.has(selectedSeat);
    el('seatDisableBtn').textContent = disabledSeats.has(selectedSeat) ? '✅ 啟用座位' : '🚫 禁用座位';
}
function swapSeats(from, to) {
    if (from === to || !currentSeating[from] || disabledSeats.has(from) || disabledSeats.has(to) || lockedSeats.has(from) || lockedSeats.has(to)) {
        UI.showToast('鎖定或禁用的座位不能換位', true); return;
    }
    rememberUndo('換位'); [currentSeating[from], currentSeating[to]] = [currentSeating[to], currentSeating[from]];
    selectedSeat = null; updateSeatDisplay(); saveToStorage(); UI.showToast('座位交換成功');
}
function handleDragStart(event) {
    if (touchDrag) { event.preventDefault(); return; }
    const index = Number(event.currentTarget.dataset.index);
    if (lockedSeats.has(index) || disabledSeats.has(index) || !currentSeating[index]) { event.preventDefault(); return; }
    draggedIndex = index; selectedSeat = null; updateSeatActions();
    event.currentTarget.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index));
}
function handleDrop(event) {
    event.preventDefault(); const to = Number(event.currentTarget.dataset.index);
    if (draggedIndex !== null) swapSeats(draggedIndex, to);
    draggedIndex = null; document.querySelectorAll('.seat').forEach(item => item.classList.remove('drop-target', 'dragging'));
}
function startTouchDrag(event) {
    finishTouchDrag();
    const from = Number(event.currentTarget.dataset.index);
    if (event.touches.length !== 1 || !currentSeating[from] || lockedSeats.has(from) || disabledSeats.has(from)) return;
    const finger = event.touches[0];
    const drag = touchDrag = { from, id: finger.identifier, x: finger.clientX, y: finger.clientY, active: false, target: null, source: event.currentTarget };
    drag.timer = setTimeout(() => {
        if (touchDrag !== drag) return;
        drag.active = true;
        suppressSeatClickUntil = Date.now() + 800;
        el('contextMenu').classList.remove('show');
        drag.source.classList.add('touch-drag-source');
        drag.ghost = drag.source.cloneNode(true);
        drag.ghost.className = 'seat touch-drag-ghost ' + (currentSeating[from].gender === '女' ? 'female' : 'male');
        drag.ghost.removeAttribute('role'); drag.ghost.removeAttribute('tabindex'); drag.ghost.setAttribute('aria-hidden', 'true');
        document.body.append(drag.ghost);
        positionTouchDrag(drag.x, drag.y);
        el('selectionHint').textContent = '拖到藍色座位後放開換位；紅色座位不可放置';
    }, 450);
}
function positionTouchDrag(x, y) {
    const drag = touchDrag; if (!drag?.active) return;
    drag.ghost.style.left = `${x}px`; drag.ghost.style.top = `${y - 28}px`;
    document.querySelectorAll('.touch-drop-target,.touch-drop-blocked').forEach(seat => seat.classList.remove('touch-drop-target', 'touch-drop-blocked'));
    const seat = document.elementFromPoint(x, y)?.closest('#seatingGrid .seat');
    drag.target = seat ? Number(seat.dataset.index) : null;
    if (seat && drag.target !== drag.from) seat.classList.add(lockedSeats.has(drag.target) || disabledSeats.has(drag.target) ? 'touch-drop-blocked' : 'touch-drop-target');
}
function moveTouchDrag(event) {
    const drag = touchDrag; if (!drag) return;
    if (event.touches.length !== 1) { finishTouchDrag(); return; }
    const finger = [...event.touches].find(item => item.identifier === drag.id); if (!finger) return;
    if (!drag.active) {
        if (Math.hypot(finger.clientX - drag.x, finger.clientY - drag.y) > 10) finishTouchDrag();
        return;
    }
    event.preventDefault(); positionTouchDrag(finger.clientX, finger.clientY);
}
function endTouchDrag(event) {
    const drag = touchDrag; if (!drag) return;
    const finger = [...event.changedTouches].find(item => item.identifier === drag.id); if (!finger) return;
    if (!drag.active) { finishTouchDrag(); return; }
    event.preventDefault(); positionTouchDrag(finger.clientX, finger.clientY);
    const from = drag.from, to = drag.target;
    finishTouchDrag();
    if (to !== null && to !== from) swapSeats(from, to);
}
function finishTouchDrag() {
    if (!touchDrag) return;
    clearTimeout(touchDrag.timer);
    if (touchDrag.active) suppressSeatClickUntil = Date.now() + 500;
    touchDrag.ghost?.remove(); touchDrag = null;
    document.querySelectorAll('.touch-drag-source,.touch-drop-target,.touch-drop-blocked').forEach(seat => seat.classList.remove('touch-drag-source', 'touch-drop-target', 'touch-drop-blocked'));
    updateSeatActions();
}
function handleRightClick(event) {
    if (touchDrag || Date.now() < suppressSeatClickUntil) { event.preventDefault(); return; }
    event.preventDefault(); contextMenuTarget = Number(event.currentTarget.dataset.index); selectedSeat = contextMenuTarget; updateSeatDisplay();
    const menu = el('contextMenu'); menu.classList.add('show');
    menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8)) + 'px';
    el('cmToggleStatus').textContent = disabledSeats.has(contextMenuTarget) ? '✅ 啟用座位' : '🚫 禁用座位';
    el('cmToggleLock').textContent = lockedSeats.has(contextMenuTarget) ? '🔓 解鎖座位' : '🔒 鎖定座位';
    el('cmToggleLock').disabled = disabledSeats.has(contextMenuTarget);
}
function toggleSeatLock(index) {
    if (index === null || disabledSeats.has(index)) return;
    rememberUndo(lockedSeats.has(index) ? '解鎖座位' : '鎖定座位');
    if (lockedSeats.has(index)) lockedSeats.delete(index); else lockedSeats.set(index, currentSeating[index]);
    el('contextMenu').classList.remove('show'); updateSeatDisplay(); saveToStorage();
}
function toggleSeatStatus(index) {
    if (index === null) return;
    const apply = () => {
        rememberUndo(disabledSeats.has(index) ? '啟用座位' : '禁用座位');
        if (disabledSeats.has(index)) disabledSeats.delete(index);
        else { disabledSeats.add(index); lockedSeats.delete(index); currentSeating[index] = null; }
        el('contextMenu').classList.remove('show'); updateSeatDisplay(); updateStats(); saveToStorage();
    };
    if (!disabledSeats.has(index) && (currentSeating[index] || lockedSeats.has(index))) UI.confirm('禁用座位', '禁用會移走這個座位的學生並解除鎖定。可使用復原還原。', apply);
    else apply();
}

function generateSeating() {
    if (!students.length) return UI.showToast('請先加入學生', true);
    if (students.some(student => !student.nameZh.trim())) return UI.showToast('請先填寫所有學生的中文名', true);
    const availableCount = rows * cols - disabledSeats.size - [...lockedSeats.values()].filter(student => !student).length;
    if (students.length > availableCount) return UI.showToast('可用座位不足，請增加座位或解除空位鎖定', true);
    rememberUndo('自動編排'); selectedSeat = null;
    const mode = el('arrangeMode').value;
    let availableStudents = [...students]; currentSeating = Array(rows * cols).fill(null);
    lockedSeats.forEach((student, index) => {
        if (student && !disabledSeats.has(index)) { currentSeating[index] = student; availableStudents = availableStudents.filter(item => item.uid !== student.uid); }
    });
    if (mode === 'smart') {
        shuffleArray(availableStudents);
        if (el('genderAlternate').checked) arrangeSmartWithGenderAlt(availableStudents, el('frontPoorVision').checked, el('backTall').checked);
        else {
            if (el('frontPoorVision').checked) placeSpecial(availableStudents, '視力照顧', true);
            if (el('backTall').checked) placeSpecial(availableStudents, '高個子', false);
            shuffleArray(availableStudents); placeRemaining(availableStudents, 'normal');
        }
    } else { availableStudents.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })); placeRemaining(availableStudents, mode.replace('id-', '')); }
    updateSeatDisplay(); updateStats(); saveHistory(); saveToStorage(); UI.showToast('座位編排完成');
}
function clearSeating() {
    UI.confirm('清空座位', '清空所有未鎖定的座位？可使用復原還原。', () => {
        rememberUndo('清空座位'); selectedSeat = null; currentSeating = currentSeating.map((student, index) => lockedSeats.has(index) ? student : null);
        updateSeatDisplay(); updateStats(); saveToStorage(); UI.showToast('未鎖定的座位已清空');
    });
}

function saveCurrentClassState() {
    if (!classes[currentClass]) return;
    Object.assign(classes[currentClass], {
        students: [...students], seating: [...currentSeating], disabled: [...disabledSeats], locked: [...lockedSeats], rows, cols,
        desk: el('teacherDeskPos').value, arrangeMode: el('arrangeMode').value,
        rules: Object.fromEntries(Object.keys(defaultRules).map(id => [id, el(id).checked]))
    });
}
function saveToStorage() {
    saveCurrentClassState();
    try {
        localStorage.setItem('seatingPro', JSON.stringify({ version: 2, classes, currentClass, desk: el('teacherDeskPos').value }));
        el('saveStatus').textContent = '已儲存於此瀏覽器';
    } catch { el('saveStatus').textContent = '儲存失敗，請匯出 TXT 備份'; UI.showToast('瀏覽器無法儲存資料，請匯出 TXT 備份', true); }
    updateUndoButton();
}
function loadClassData(data) {
    finishTouchDrag();
    rows = clampSize(data.rows); cols = clampSize(data.cols);
    students = (Array.isArray(data.students) ? data.students : []).map(normalizeStudent);
    const used = new Set(); students.forEach(student => { if (used.has(student.uid)) student.uid = newUid(); used.add(student.uid); });
    const validSeat = index => Number.isInteger(index) && index >= 0 && index < rows * cols;
    disabledSeats = new Set((data.disabled || []).filter(validSeat));
    lockedSeats = new Map((data.locked || []).filter(entry => Array.isArray(entry) && validSeat(entry[0])));
    currentSeating = Array.from({ length: rows * cols }, (_, index) => data.seating?.[index] || null);
    el('rows').value = rows; el('cols').value = cols;
    el('teacherDeskPos').value = ['desk-left', 'desk-center', 'desk-right'].includes(data.desk) ? data.desk : 'desk-left';
    el('teacherDeskContainer').className = 'teacher-desk-container ' + el('teacherDeskPos').value;
    el('arrangeMode').value = modes.includes(data.arrangeMode) ? data.arrangeMode : 'smart';
    Object.entries(defaultRules).forEach(([id, fallback]) => el(id).checked = typeof data.rules?.[id] === 'boolean' ? data.rules[id] : fallback);
    selectedSeat = null; draggedIndex = null; el('contextMenu').classList.remove('show');
    syncSeatStudents(); el('studentList').value = rosterText();
    renderStudentTable(); toggleRuleOptions(); updateClassTabs(); updateSeatingGrid(); renderHistory(); updateUndoButton();
}
function loadFromStorage() {
    try {
        const raw = localStorage.getItem('seatingPro');
        if (raw) {
            const data = JSON.parse(raw);
            if (data.classes && Object.keys(data.classes).length) {
                classes = data.classes; currentClass = classes[data.currentClass] ? data.currentClass : Object.keys(classes)[0];
                Object.values(classes).forEach(item => { if (!item.desk) item.desk = data.desk || 'desk-left'; });
            }
        }
        loadClassData(classes[currentClass]); saveToStorage();
    } catch { loadClassData(classes[currentClass]); el('saveStatus').textContent = '無法讀取儲存資料'; UI.showToast('無法讀取儲存資料，請匯入 TXT 備份', true); }
}

function updateClassTabs() {
    el('classTabs').replaceChildren();
    Object.keys(classes).forEach(id => {
        const tab = document.createElement('div'); tab.className = 'class-tab' + (id === currentClass ? ' active' : '');
        const name = document.createElement('button'); name.type = 'button'; name.className = 'class-name'; name.textContent = classes[id].name;
        name.onclick = () => switchClass(id); name.setAttribute('aria-current', id === currentClass ? 'true' : 'false'); tab.append(name);
        [['✎', '重新命名', editClass], ['×', '刪除方案', delClass]].forEach(([text, label, callback]) => {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'action-icon'; button.textContent = text;
            button.setAttribute('aria-label', label + ' ' + classes[id].name); button.onclick = event => callback(id, event); tab.append(button);
        }); el('classTabs').append(tab);
    });
    const add = document.createElement('button'); add.type = 'button'; add.className = 'class-tab add-tab'; add.textContent = '+ 新增編排';
    add.onclick = () => UI.prompt('新增座位編排', '請輸入座位編排名稱：', '新座位編排', name => {
        if (!name) return; saveCurrentClassState(); const id = 'class_' + Date.now();
        classes[id] = { name, students: [], history: [], seating: [], disabled: [], locked: [], rows: 6, cols: 6 };
        switchClass(id);
    }); el('classTabs').append(add);
}
function switchClass(id) {
    if (id === currentClass || !classes[id]) return;
    saveCurrentClassState(); currentClass = id; loadClassData(classes[id]); saveToStorage();
}
function editClass(id, event) {
    event.stopPropagation(); UI.prompt('重新命名', '請輸入新名稱：', classes[id].name, name => {
        if (!name) return; classes[id].name = name; updateClassTabs(); saveToStorage();
    });
}
function delClass(id, event) {
    event.stopPropagation(); if (Object.keys(classes).length === 1) return UI.showToast('必須保留至少一個方案', true);
    UI.confirm('刪除方案', `確定刪除「${classes[id].name}」？此操作不能復原。`, () => {
        delete classes[id]; undoStacks.delete(id); redoStacks.delete(id);
        if (currentClass === id) { currentClass = Object.keys(classes)[0]; loadClassData(classes[currentClass]); }
        else updateClassTabs(); saveToStorage();
    });
}
function saveHistory() {
    const history = classes[currentClass].history ||= [];
    history.unshift({ time: new Date().toLocaleString(), seating: clone(currentSeating), r: rows, c: cols, disabled: [...disabledSeats], locked: clone([...lockedSeats]) });
    if (history.length > 8) history.pop(); renderHistory();
}
function renderHistory() {
    const box = el('historyList'); box.replaceChildren();
    const history = classes[currentClass].history || [];
    if (!history.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = '暫無紀錄'; box.append(empty); }
    history.forEach((item, index) => {
        const row = document.createElement('div'); row.className = 'history-item';
        const load = document.createElement('button'); load.className = 'history-load'; load.textContent = `${item.time} · ${item.r}×${item.c}`;
        load.onclick = () => UI.confirm('載入紀錄', '覆蓋當前的座位表？可使用復原還原。', () => {
            rememberUndo('載入歷史紀錄'); rows = clampSize(item.r); cols = clampSize(item.c);
            currentSeating = clone(item.seating); disabledSeats = new Set(item.disabled || []); lockedSeats = new Map(item.locked || []);
            selectedSeat = null; el('rows').value = rows; el('cols').value = cols; updateSeatingGrid(); saveToStorage(); UI.showToast('歷史紀錄已載入');
        });
        const remove = document.createElement('button'); remove.className = 'history-delete'; remove.textContent = '×'; remove.setAttribute('aria-label', '刪除歷史紀錄');
        remove.onclick = () => { rememberUndo('刪除歷史紀錄'); history.splice(index, 1); renderHistory(); saveToStorage(); };
        row.append(load, remove); box.append(row);
    });
}
function updateStats() {
    const total = students.length, males = students.filter(student => student.gender === '男').length;
    el('statTotal').textContent = `全班人數：${total} 人`;
    el('statMale').textContent = `男：${males} 人 (${total ? Math.round(males / total * 100) : 0}%)`;
    el('statFemale').textContent = `女：${total - males} 人 (${total ? Math.round((total - males) / total * 100) : 0}%)`;
    el('statSeats').textContent = `可用座位：${rows * cols - disabledSeats.size - [...lockedSeats.values()].filter(student => !student).length} 個`;
    const seated = new Set(currentSeating.filter(Boolean).map(student => student.uid));
    el('statUnseated').textContent = `未入座：${students.filter(student => !seated.has(student.uid)).length} 人`;
}

function exportTxtConfig() {
    saveCurrentClassState(); const data = classes[currentClass];
    const config = { version: '2.0', className: data.name, rows, cols, students, currentSeating, disabledSeats: [...disabledSeats], lockedSeats: [...lockedSeats], deskPos: data.desk, arrangeMode: data.arrangeMode, rules: data.rules };
    const text = `同學各位找個位 - 座位編排與學生名單設定檔\n班級名稱：${data.name}\n\n【學生名單】\n${rosterText()}\n\n---CONFIG_START---\n${JSON.stringify(config, null, 2)}\n---CONFIG_END---\n`;
    const link = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    link.href = url; link.download = `${data.name}_座位設定與名單.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); UI.showToast('TXT 設定檔已匯出');
}
function importTxtConfig() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.txt';
    input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        try {
            const text = await file.text(), match = text.match(/---CONFIG_START---([\s\S]*?)---CONFIG_END---/);
            if (match) {
                const config = JSON.parse(match[1]);
                if (!Array.isArray(config.students) || (config.currentSeating && !Array.isArray(config.currentSeating))) throw new Error('Invalid config');
                saveCurrentClassState(); const id = 'class_' + Date.now();
                classes[id] = { name: String(config.className || '匯入班級'), students: config.students, seating: config.currentSeating || [], history: [], rows: clampSize(config.rows), cols: clampSize(config.cols), disabled: config.disabledSeats || [], locked: config.lockedSeats || [], desk: config.deskPos, arrangeMode: config.arrangeMode, rules: config.rules };
                currentClass = id; loadClassData(classes[id]); saveToStorage(); UI.showToast('設定、名單及座位表已匯入');
            } else { el('studentList').value = text; el('bulkRoster').open = true; applyPastedRoster(); }
        } catch { UI.showToast('匯入失敗，請確認 TXT 格式', true); }
    }; input.click();
}


function arrangeSmartWithGenderAlt(availableStudents, isFrontPoor, isBackTall) {
            const mCount = availableStudents.filter(s => s.gender === '男').length;
            const fCount = availableStudents.filter(s => s.gender === '女').length;
            
            const primaryGender = mCount >= fCount ? '男' : '女';
            const secondaryGender = primaryGender === '男' ? '女' : '男';

            const getTargetGender = (r, c) => ((r + c) % 2 === 0 ? primaryGender : secondaryGender);

            if (isFrontPoor) {
                placeSpecialWithGender(availableStudents, '視力照顧', true, getTargetGender);
            }
            if (isBackTall) {
                placeSpecialWithGender(availableStudents, '高個子', false, getTargetGender);
            }

            const remainingMales = availableStudents.filter(s => s.gender === '男');
            const remainingFemales = availableStudents.filter(s => s.gender === '女');
            shuffleArray(remainingMales);
            shuffleArray(remainingFemales);

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const idx = r * cols + c;
                    if (disabledSeats.has(idx) || lockedSeats.has(idx) || currentSeating[idx]) continue;

                    const targetGender = getTargetGender(r, c);
                    if (targetGender === '男') {
                        if (remainingMales.length > 0) currentSeating[idx] = remainingMales.pop();
                        else if (remainingFemales.length > 0) currentSeating[idx] = remainingFemales.pop();
                    } else {
                        if (remainingFemales.length > 0) currentSeating[idx] = remainingFemales.pop();
                        else if (remainingMales.length > 0) currentSeating[idx] = remainingMales.pop();
                    }
                }
            }
        }

        function placeSpecialWithGender(list, tag, isFront, getTargetGenderFn) {
            const specials = list.filter(s => s.special.includes(tag));
            if (specials.length === 0) return;

            shuffleArray(specials);

            const startRow = isFront ? 0 : Math.max(0, rows - 2);
            const endRow = isFront ? Math.min(2, rows) : rows;

            let candidateSeats = [];
            for (let r = startRow; r < endRow; r++) {
                for (let c = 0; c < cols; c++) {
                    const idx = r * cols + c;
                    if (!disabledSeats.has(idx) && !lockedSeats.has(idx) && !currentSeating[idx]) {
                        candidateSeats.push({ idx, r, c });
                    }
                }
            }

            shuffleArray(candidateSeats);

            specials.forEach(stu => {
                if (candidateSeats.length === 0) return;

                let seatObjIndex = candidateSeats.findIndex(s => getTargetGenderFn(s.r, s.c) === stu.gender);
                if (seatObjIndex === -1) {
                    seatObjIndex = 0;
                }

                const chosenSeat = candidateSeats.splice(seatObjIndex, 1)[0];
                currentSeating[chosenSeat.idx] = stu;

                const stuIndex = list.findIndex(s => s === stu);
                if (stuIndex !== -1) {
                    list.splice(stuIndex, 1);
                }
            });
        }

        function placeSpecial(list, tag, isFront) {
            const specials = list.filter(s => s.special.includes(tag));
            if (specials.length === 0) return;

            shuffleArray(specials);

            const startRow = isFront ? 0 : Math.max(0, rows - 2);
            const endRow = isFront ? Math.min(2, rows) : rows;

            let candidateSeats = [];
            for (let r = startRow; r < endRow; r++) {
                for (let c = 0; c < cols; c++) {
                    const idx = r * cols + c;
                    if (!disabledSeats.has(idx) && !lockedSeats.has(idx) && !currentSeating[idx]) {
                        candidateSeats.push(idx);
                    }
                }
            }

            shuffleArray(candidateSeats);

            specials.forEach(stu => {
                if (candidateSeats.length > 0) {
                    const seatIdx = candidateSeats.shift();
                    currentSeating[seatIdx] = stu;
                    const stuIndex = list.indexOf(stu);
                    if (stuIndex !== -1) {
                        list.splice(stuIndex, 1);
                    }
                }
            });
        }

        function placeRemaining(list, mode) {
            let stuIdx = 0;
            if (mode === 'vertical-ltr') {
                for (let c = 0; c < cols; c++) {
                    for (let r = 0; r < rows; r++) {
                        const idx = r * cols + c;
                        if (!disabledSeats.has(idx) && !lockedSeats.has(idx) && !currentSeating[idx] && stuIdx < list.length) {
                            currentSeating[idx] = list[stuIdx++];
                        }
                    }
                }
            } else if (mode === 'vertical-rtl') {
                for (let c = cols - 1; c >= 0; c--) {
                    for (let r = 0; r < rows; r++) {
                        const idx = r * cols + c;
                        if (!disabledSeats.has(idx) && !lockedSeats.has(idx) && !currentSeating[idx] && stuIdx < list.length) {
                            currentSeating[idx] = list[stuIdx++];
                        }
                    }
                }
            } else if (mode === 'horizontal-ltr') {
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const idx = r * cols + c;
                        if (!disabledSeats.has(idx) && !lockedSeats.has(idx) && !currentSeating[idx] && stuIdx < list.length) {
                            currentSeating[idx] = list[stuIdx++];
                        }
                    }
                }
            } else if (mode === 'horizontal-rtl') {
                for (let r = 0; r < rows; r++) {
                    for (let c = cols - 1; c >= 0; c--) {
                        const idx = r * cols + c;
                        if (!disabledSeats.has(idx) && !lockedSeats.has(idx) && !currentSeating[idx] && stuIdx < list.length) {
                            currentSeating[idx] = list[stuIdx++];
                        }
                    }
                }
            } else {
                for (let i = 0; i < rows * cols && stuIdx < list.length; i++) {
                    if (!disabledSeats.has(i) && !lockedSeats.has(i) && !currentSeating[i]) {
                        currentSeating[i] = list[stuIdx++];
                    }
                }
            }
        }

        function shuffleArray(arr) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
        }

        
function exportHighResSeating() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const scale = 3; 
            const seatW = 110, seatH = 130, gap = 16;
            const topMargin = 220;
            const legendMargin = 100;
            
            const layoutW = cols * (seatW + gap) - gap;
            const layoutH = rows * (seatH + gap) - gap;
            
            canvas.width = Math.max(layoutW + 100, 800) * scale;
            canvas.height = (topMargin + layoutH + legendMargin) * scale;
            
            ctx.scale(scale, scale);
            const w = canvas.width / scale;
            const h = canvas.height / scale;

            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(0, 0, w, h);

            ctx.fillStyle = '#1e293b';
            ctx.font = 'bold 28px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(`${classes[currentClass].name} - 座位表`, w / 2, 40);
            
            ctx.font = '14px sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.fillText(`生成時間：${new Date().toLocaleString()} | 人數：${students.length}`, w / 2, 65);

            const cx = w / 2;
            const boardW = Math.min(layoutW, 600);
            ctx.fillStyle = '#274e13';
            ctx.fillRect(cx - boardW/2, 90, boardW, 40);
            ctx.strokeStyle = '#8b5a2b';
            ctx.lineWidth = 4;
            ctx.strokeRect(cx - boardW/2, 90, boardW, 40);
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.font = 'bold 16px sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText('黑板', cx, 110);

            const deskPos = document.getElementById('teacherDeskPos').value;
            let deskX = cx;
            if (deskPos === 'desk-left') deskX = cx - boardW/2 + 60;
            if (deskPos === 'desk-right') deskX = cx + boardW/2 - 60;
            
            ctx.fillStyle = '#d4a373';
            ctx.fillRect(deskX - 60, 140, 120, 30);
            ctx.strokeStyle = '#b5835a';
            ctx.lineWidth = 2;
            ctx.strokeRect(deskX - 60, 140, 120, 30);
            ctx.fillStyle = '#5c3a21';
            ctx.font = 'bold 13px sans-serif';
            ctx.fillText('👨‍🏫 教師桌', deskX, 155);

            const startX = (w - layoutW) / 2;
            const startY = topMargin;

            currentSeating.forEach((stu, idx) => {
                const r = Math.floor(idx / cols);
                const c = idx % cols;
                const x = startX + c * (seatW + gap);
                const y = startY + r * (seatH + gap);

                ctx.fillStyle = '#ffffff';
                if (disabledSeats.has(idx)) ctx.fillStyle = '#fef2f2';
                else if (stu) ctx.fillStyle = stu.gender === '男' ? '#eff6ff' : '#fdf2f8';
                
                ctx.beginPath();
                ctx.roundRect(x, y, seatW, seatH, 8);
                ctx.fill();

                ctx.lineWidth = 2;
                ctx.strokeStyle = disabledSeats.has(idx) ? '#fca5a5' : (stu ? (stu.gender === '男' ? '#93c5fd' : '#f9a8d4') : '#cbd5e1');
                ctx.stroke();

                if (disabledSeats.has(idx)) {
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
                    ctx.font = '30px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('🚫', x + seatW/2, y + seatH/2);
                } else if (stu) {
                    ctx.fillStyle = '#64748b';
                    ctx.font = 'bold 11px sans-serif';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';
                    ctx.fillText(stu.id, x + 8, y + 8);
                    
                    ctx.fillStyle = stu.gender === '男' ? '#1d4ed8' : '#be185d';
                    ctx.font = 'bold 20px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(stu.nameZh, x + seatW / 2, y + 52);
                    
                    ctx.fillStyle = '#94a3b8';
                    ctx.font = '11px sans-serif';
                    ctx.textAlign = 'center';

                    const enName = (stu.nameEn || '').trim();
                    if (enName) {
                        const maxWidth = seatW - 12;
                        if (ctx.measureText(enName).width <= maxWidth) {
                            ctx.textBaseline = 'middle';
                            ctx.fillText(enName, x + seatW / 2, y + 102);
                        } else {
                            const words = enName.split(' ');
                            let line1 = '', line2 = '';
                            for (let w of words) {
                                if (ctx.measureText(line1 + (line1 ? ' ' : '') + w).width <= maxWidth) {
                                    line1 += (line1 ? ' ' : '') + w;
                                } else {
                                    line2 += (line2 ? ' ' : '') + w;
                                }
                            }
                            if (!line1 && line2) { line1 = line2; line2 = ''; }
                            if (ctx.measureText(line2).width > maxWidth) {
                                while (line2.length > 0 && ctx.measureText(line2 + '...').width > maxWidth) {
                                    line2 = line2.slice(0, -1);
                                }
                                line2 += '...';
                            }
                            ctx.textBaseline = 'middle';
                            if (line2) {
                                ctx.fillText(line1, x + seatW / 2, y + 94);
                                ctx.fillText(line2, x + seatW / 2, y + 108);
                            } else {
                                ctx.fillText(line1, x + seatW / 2, y + 102);
                            }
                        }
                    }

                    if (stu.special.includes('視力照顧')) {
                        ctx.fillStyle = '#9333ea';
                        ctx.beginPath(); ctx.arc(x + seatW - 10, y + 10, 6, 0, Math.PI*2); ctx.fill();
                        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
                    }
                    if (stu.special.includes('高個子')) {
                        ctx.fillStyle = '#ea580c';
                        ctx.beginPath(); ctx.arc(x + seatW - 24, y + 10, 6, 0, Math.PI*2); ctx.fill();
                        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
                    }
                } else {
                    ctx.fillStyle = '#94a3b8';
                    ctx.font = '500 14px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(lockedSeats.has(idx) ? '🔒' : '空位', x + seatW/2, y + seatH/2);
                }
            });

            const legendY = startY + layoutH + 45;
            const legendItems = [
                { label: '男同學', color: '#eff6ff', border: '#93c5fd', type: 'box' },
                { label: '女同學', color: '#fdf2f8', border: '#f9a8d4', type: 'box' },
                { label: '空位', color: '#f8fafc', border: '#cbd5e1', type: 'box' },
                { label: '禁用座位', color: '#fef2f2', border: '#fca5a5', type: 'box' },
                { label: '視力照顧', color: '#9333ea', type: 'dot' },
                { label: '高個子', color: '#ea580c', type: 'dot' }
            ];

            ctx.font = '13px sans-serif';
            let totalLegendW = 0;
            legendItems.forEach(item => {
                totalLegendW += (item.type === 'box' ? 20 : 16) + ctx.measureText(item.label).width + 20;
            });

            const legendBoxW = totalLegendW + 20;
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(cx - legendBoxW / 2, legendY - 18, legendBoxW, 36, 6);
            ctx.fill();
            ctx.stroke();

            let currLegX = cx - totalLegendW / 2 + 10;
            legendItems.forEach(item => {
                ctx.textBaseline = 'middle';
                if (item.type === 'box') {
                    ctx.fillStyle = item.color;
                    ctx.fillRect(currLegX, legendY - 7, 14, 14);
                    ctx.strokeStyle = item.border;
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(currLegX, legendY - 7, 14, 14);

                    ctx.fillStyle = '#334155';
                    ctx.textAlign = 'left';
                    ctx.fillText(item.label, currLegX + 20, legendY);

                    currLegX += 20 + ctx.measureText(item.label).width + 20;
                } else if (item.type === 'dot') {
                    ctx.fillStyle = item.color;
                    ctx.beginPath();
                    ctx.arc(currLegX + 6, legendY, 6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();

                    ctx.fillStyle = '#334155';
                    ctx.textAlign = 'left';
                    ctx.fillText(item.label, currLegX + 18, legendY);

                    currLegX += 18 + ctx.measureText(item.label).width + 20;
                }
            });

            const link = document.createElement('a');
            link.download = `${classes[currentClass].name}_座位表.png`;
            link.href = canvas.toDataURL('image/png', 1.0);
            link.click();
            UI.showToast('高解析度座位表已匯出！');
        }

        
