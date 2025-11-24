const state = {
    settings: {},
    config: {},
    preferences: {},
    prompts: {},
    mockApi: {},
    bootstrap: { tasks: [] },
    tasks: [],
    timers: new Map(),
    pendingLog: null,
};

const defaultData = {
    settings: {
        timeFormat: 'HH:mm:ss',
        autosave: true,
        storageKey: 'offline-worklog',
    },
    config: {
        taskCounterKey: 'offline-worklog-counter',
        exportFileName: 'worklog-export.csv',
    },
    preferences: {
        theme: 'system',
        showDescriptions: true,
    },
    prompts: {
        summary: 'Summarize the work completed in one paragraph.',
    },
    mockApi: {
        profile: { name: 'Offline operator', role: 'Owner' },
    },
    bootstrap: {
        tasks: [
            {
                id: 'sample-project',
                type: 'project',
                name: 'Sample Project',
                reference: 'PRJ-001',
                isCritical: true,
                description: 'You can edit or remove this project once you add your own items.',
                elapsedMs: 0,
                logs: [],
                isRunning: false,
                isArchived: false,
                lastLog: null,
                createdAt: Date.now(),
                lastUpdatedMs: Date.now(),
                lastChecked: null,
            },
        ],
    },
};

function normalizeTask(task) {
    const now = Date.now();
    const createdAt = Number.isFinite(task.createdAt) ? task.createdAt : now;
    const lastUpdatedMs = Number.isFinite(task.lastUpdatedMs) ? task.lastUpdatedMs : createdAt;

    const normalized = {
        ...task,
        name: task.name?.trim() || 'Untitled item',
        description: task.description || '',
        logs: Array.isArray(task.logs) ? task.logs : [],
        elapsedMs: Number.isFinite(task.elapsedMs) ? task.elapsedMs : 0,
        isRunning: false,
        isArchived: Boolean(task.isArchived),
        createdAt,
        lastUpdatedMs,
        lastChecked: task.lastChecked ?? null,
    };

    delete normalized.startedAt;
    return normalized;
}

function calculateDuplicates(tasks) {
    const nameCounts = new Map();
    const referenceCounts = new Map();

    tasks.forEach((task) => {
        const nameKey = typeof task.name === 'string' ? task.name.trim().toLowerCase() : '';
        const referenceKey = typeof task.reference === 'string' ? task.reference.trim().toLowerCase() : '';

        if (nameKey) nameCounts.set(nameKey, (nameCounts.get(nameKey) || 0) + 1);
        if (referenceKey) referenceCounts.set(referenceKey, (referenceCounts.get(referenceKey) || 0) + 1);
    });

    return {
        names: new Set([...nameCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key)),
        references: new Set([...referenceCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key)),
    };
}

function isToday(timestamp) {
    if (!timestamp) return false;
    const date = new Date(timestamp);
    const now = new Date();
    return date.toDateString() === now.toDateString();
}

function formatLastUpdated(task) {
    if (!task.lastUpdatedMs) return 'No updates yet';
    const date = new Date(task.lastUpdatedMs);
    const formatted = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return `Last update: ${formatted}`;
}

async function fetchJson(path, fallback) {
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error('Network error');
        return await response.json();
    } catch (error) {
        console.warn(`Falling back to defaults for ${path}`, error);
        return structuredClone(fallback);
    }
}

async function bootstrapApp() {
    const [settings, config, preferences, prompts, mockApi, bootstrap] = await Promise.all([
        fetchJson('data/settings.json', defaultData.settings),
        fetchJson('data/config.json', defaultData.config),
        fetchJson('data/preferences.json', defaultData.preferences),
        fetchJson('data/prompts.json', defaultData.prompts),
        fetchJson('data/api-responses.json', defaultData.mockApi),
        fetchJson('data/data-store.json', defaultData.bootstrap),
    ]);

    Object.assign(state.settings, settings);
    Object.assign(state.config, config);
    Object.assign(state.preferences, preferences);
    Object.assign(state.prompts, prompts);
    Object.assign(state.mockApi, mockApi);
    Object.assign(state.bootstrap, bootstrap);

    const existing = loadFromStorage();
    const seededTasks = existing?.tasks?.length ? existing.tasks : structuredClone(state.bootstrap.tasks);
    state.tasks = seededTasks.map(normalizeTask);

    render();
    attachEvents();
    updateDuplicateHints();
}

function loadFromStorage() {
    try {
        const raw = localStorage.getItem(state.settings.storageKey || defaultData.settings.storageKey);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (error) {
        console.warn('Unable to parse saved data', error);
        return null;
    }
}

function persist() {
    const payload = { tasks: state.tasks };
    localStorage.setItem(state.settings.storageKey || defaultData.settings.storageKey, JSON.stringify(payload));
}

function nextTaskCode() {
    const key = state.config.taskCounterKey || defaultData.config.taskCounterKey;
    const raw = localStorage.getItem(key);
    const next = raw ? parseInt(raw, 10) + 1 : 1;
    localStorage.setItem(key, String(next));
    return String(next).padStart(3, '0');
}

function attachEvents() {
    const form = document.getElementById('taskForm');
    const nameInput = form.elements.name;
    const referenceInput = form.elements.reference;

    [nameInput, referenceInput].forEach((input) => {
        input.addEventListener('input', updateDuplicateHints);
    });

    form.addEventListener('change', (event) => {
        if (event.target.name === 'itemType') {
            toggleFormFields(event.target.value);
            updateDuplicateHints();
        }
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const type = data.get('itemType');
        const name = data.get('name')?.trim();
        const description = data.get('description')?.trim();
        const critical = data.get('critical') === 'yes';
        const reference = data.get('reference')?.trim();

        if (!name) return;
        if (type === 'project' && !reference) {
            alert('Projects require a reference number.');
            return;
        }

        const now = Date.now();
        const task = normalizeTask({
            id: crypto.randomUUID(),
            type,
            name,
            description,
            isCritical: critical,
            reference: type === 'project' ? reference : `Task #${data.get('taskCode') || nextTaskCode()}`,
            elapsedMs: 0,
            logs: [],
            isRunning: false,
            lastLog: null,
            createdAt: now,
            lastUpdatedMs: now,
            lastChecked: null,
        });

        state.tasks.unshift(task);
        persist();
        render();
        form.reset();
        toggleFormFields('project');
        updateDuplicateHints();
    });

    document.getElementById('filterType').addEventListener('change', render);
    document.getElementById('filterCritical').addEventListener('change', render);
    document.getElementById('filterArchived').addEventListener('change', render);
    document.getElementById('sortBy').addEventListener('change', render);

    form.addEventListener('reset', () => {
        setTimeout(() => updateDuplicateHints(), 0);
    });

    const dialog = document.getElementById('logDialog');
    const logForm = document.getElementById('logForm');
    const discard = document.getElementById('discardLog');

    logForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const comment = logForm.elements.logComment.value.trim();
        if (!state.pendingLog) return;
        if (!comment) {
            document.getElementById('logWarning').textContent = 'You must enter a log comment to keep this time.';
            return;
        }

        finalizeLog(comment);
        dialog.close();
    });

    discard.addEventListener('click', () => {
        if (!state.pendingLog) return;
        const task = state.tasks.find((t) => t.id === state.pendingLog.id);
        if (task) {
            task.isRunning = false;
            task.lastLog = 'Discarded session';
            task.lastUpdatedMs = Date.now();
        }
        state.pendingLog = null;
        persist();
        render();
        dialog.close();
    });
}

function toggleFormFields(type) {
    const projectField = document.querySelector('[data-field="projectRef"]');
    const taskField = document.querySelector('[data-field="taskCode"]');
    if (type === 'project') {
        projectField.hidden = false;
        taskField.hidden = true;
    } else {
        projectField.hidden = true;
        taskField.hidden = false;
        taskField.querySelector('input').value = nextTaskCode();
    }
}

function updateDuplicateHints() {
    const form = document.getElementById('taskForm');
    if (!form) return;

    const type = form.elements.itemType.value;
    const name = form.elements.name.value.trim().toLowerCase();
    const reference = form.elements.reference.value.trim().toLowerCase();

    const { names, references } = calculateDuplicates(state.tasks);

    const nameNote = document.getElementById('duplicateNameNote');
    const isNameDuplicate = !!name && names.has(name);
    nameNote.hidden = !isNameDuplicate;
    nameNote.textContent = isNameDuplicate ? 'A project or task already uses this title.' : '';
    nameNote.classList.toggle('warning', isNameDuplicate);

    const refNote = document.getElementById('duplicateReferenceNote');
    const shouldCheckReference = type === 'project';
    const isRefDuplicate = shouldCheckReference && !!reference && references.has(reference);
    refNote.hidden = !isRefDuplicate;
    refNote.textContent = isRefDuplicate ? 'This reference number already exists.' : '';
    refNote.classList.toggle('warning', isRefDuplicate);
}

function render() {
    renderStats();
    renderTable();
}

function renderStats() {
    const activeTasks = state.tasks.filter((task) => !task.isArchived);
    const running = activeTasks.filter((task) => task.isRunning).length;
    const projects = activeTasks.filter((task) => task.type === 'project').length;
    const tasks = activeTasks.filter((task) => task.type === 'task').length;
    const hours = activeTasks.reduce((total, task) => total + task.elapsedMs + currentRunTime(task), 0);

    document.querySelector('[data-stat="running"]').textContent = running;
    document.querySelector('[data-stat="projects"]').textContent = projects;
    document.querySelector('[data-stat="tasks"]').textContent = tasks;
    document.querySelector('[data-stat="hours"]').textContent = formatHours(hours);
}

function renderTable() {
    const container = document.getElementById('taskTable');
    container.innerHTML = '';

    const filterType = document.getElementById('filterType').value;
    const filterCritical = document.getElementById('filterCritical').value;
    const filterArchived = document.getElementById('filterArchived').value;
    const sortBy = document.getElementById('sortBy').value;

    const duplicates = calculateDuplicates(state.tasks);

    const filtered = state.tasks.filter((task) => {
        const typeMatch = filterType === 'all' || task.type === filterType;
        const criticalMatch = filterCritical === 'all' || (filterCritical === 'critical' ? task.isCritical : !task.isCritical);
        const archiveMatch =
            filterArchived === 'all'
                || (filterArchived === 'archived' ? task.isArchived : !task.isArchived);
        return typeMatch && criticalMatch && archiveMatch;
    });

    const sorted = [...filtered].sort((a, b) => sortTasks(a, b, sortBy));

    if (!filtered.length) {
        container.innerHTML = '<div class="empty-state">No items yet. Use the form above to add your first task.</div>';
        return;
    }

    const template = document.getElementById('taskRowTemplate');

    sorted.forEach((task) => {
        const clone = template.content.cloneNode(true);
        const row = clone.querySelector('.task-row');
        row.dataset.id = task.id;
        row.classList.toggle('archived', task.isArchived);
        row.querySelector('[data-field="type"]').textContent = task.type.toUpperCase();
        row.querySelector('[data-field="name"]').textContent = task.name;
        row.querySelector('[data-field="reference"]').textContent = task.reference;
        row.querySelector('[data-field="description"]').textContent = task.description || 'No additional details provided.';
        const criticalChip = row.querySelector('[data-field="critical"]');
        criticalChip.dataset.critical = task.isCritical;
        criticalChip.textContent = task.isCritical ? 'Critical' : 'Normal';
        row.querySelector('[data-field="status"]').textContent = task.isArchived ? 'Archived' : task.isRunning ? 'In progress' : 'Idle';
        row.querySelector('[data-field="elapsed"]').textContent = formatDuration(task.elapsedMs + currentRunTime(task));
        row.querySelector('[data-field="lastLog"]').textContent = task.lastLog || 'No logs yet';
        row.querySelector('[data-field="lastUpdated"]').textContent = formatLastUpdated(task);

        const duplicateNameChip = row.querySelector('[data-field="duplicateName"]');
        const duplicateReferenceChip = row.querySelector('[data-field="duplicateReference"]');
        const nameKey = task.name.trim().toLowerCase();
        const refKey = task.reference?.trim().toLowerCase();
        const isDuplicateName = !!nameKey && duplicates.names.has(nameKey);
        const isDuplicateRef = !!refKey && duplicates.references.has(refKey);
        duplicateNameChip.hidden = !isDuplicateName;
        duplicateReferenceChip.hidden = !isDuplicateRef;

        const checkedChip = row.querySelector('[data-field="checked"]');
        const checkedToday = isToday(task.lastChecked);
        checkedChip.textContent = checkedToday ? 'Checked today' : 'Not checked today';
        checkedChip.classList.toggle('stale', !checkedToday);

        const archivedChip = row.querySelector('[data-field="archived"]');
        archivedChip.hidden = !task.isArchived;

        const logsContainer = row.querySelector('.task-logs ul');
        task.logs.forEach((log) => {
            const li = document.createElement('li');
            li.textContent = `${log.date} — ${log.duration} — ${log.comment}`;
            logsContainer.appendChild(li);
        });

        const logsWrapper = row.querySelector('.task-logs');
        row.querySelector('[data-action="logs"]').addEventListener('click', () => {
            logsWrapper.hidden = !logsWrapper.hidden;
        });

        const startBtn = row.querySelector('[data-action="start"]');
        const stopBtn = row.querySelector('[data-action="stop"]');
        startBtn.disabled = task.isRunning || task.isArchived;
        stopBtn.disabled = !task.isRunning;

        startBtn.addEventListener('click', () => startTimer(task.id));
        stopBtn.addEventListener('click', () => stopTimer(task.id));

        row.querySelector('[data-action="export"]').addEventListener('click', () => exportTask(task));

        const checkBtn = row.querySelector('[data-action="check"]');
        checkBtn.textContent = checkedToday ? 'Checked' : 'Mark checked';
        checkBtn.disabled = checkedToday || task.isArchived;
        checkBtn.addEventListener('click', () => markChecked(task.id));

        const archiveBtn = row.querySelector('[data-action="archive"]');
        archiveBtn.textContent = task.isArchived ? 'Restore' : 'Archive';
        archiveBtn.disabled = task.isRunning;
        archiveBtn.addEventListener('click', () => archiveTask(task.id));

        const deleteBtn = row.querySelector('[data-action="delete"]');
        deleteBtn.addEventListener('click', () => deleteTask(task.id));

        container.appendChild(clone);
    });
}

function startTimer(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task || task.isRunning || task.isArchived) return;

    task.isRunning = true;
    task.startedAt = Date.now();
    task.lastUpdatedMs = Date.now();

    if (state.timers.has(id)) {
        clearInterval(state.timers.get(id));
    }

    const interval = setInterval(() => {
        updateElapsedDisplay(id);
    }, 1000);

    state.timers.set(id, interval);
    persist();
    render();
}

function stopTimer(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task || !task.isRunning) return;

    const duration = Date.now() - task.startedAt;
    clearInterval(state.timers.get(id));
    state.timers.delete(id);

    task.isRunning = false;
    delete task.startedAt;
    task.lastUpdatedMs = Date.now();

    state.pendingLog = { id: task.id, duration };
    const dialog = document.getElementById('logDialog');
    dialog.querySelector('textarea').value = '';
    document.getElementById('dialogTimer').textContent = formatDuration(duration);
    document.getElementById('logWarning').textContent = 'Leaving this empty will discard the tracked time.';
    dialog.showModal();
}

function finalizeLog(comment) {
    if (!state.pendingLog) return;
    const { id, duration } = state.pendingLog;
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;

    task.elapsedMs += duration;
    const entry = {
        date: new Date().toLocaleDateString(),
        duration: formatDuration(duration),
        comment,
        timestamp: Date.now(),
    };
    task.logs.unshift(entry);
    task.lastLog = `${entry.date} · ${entry.duration}`;
    task.lastUpdatedMs = entry.timestamp;
    task.lastChecked = entry.timestamp;
    state.pendingLog = null;
    persist();
    render();
}

function markChecked(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;

    const now = Date.now();
    task.lastChecked = now;
    task.lastUpdatedMs = Math.max(task.lastUpdatedMs || 0, now);
    persist();
    render();
}

function archiveTask(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    if (task.isRunning) {
        alert('Stop the timer before archiving this item.');
        return;
    }

    task.isArchived = !task.isArchived;
    task.lastUpdatedMs = Date.now();
    persist();
    render();
}

function deleteTask(id) {
    const index = state.tasks.findIndex((t) => t.id === id);
    if (index === -1) return;

    const task = state.tasks[index];
    if (task.isRunning) {
        alert('Stop the timer before deleting this item.');
        return;
    }

    const confirmDelete = confirm('This will remove the task and its logs. Continue?');
    if (!confirmDelete) return;

    if (state.timers.has(id)) {
        clearInterval(state.timers.get(id));
        state.timers.delete(id);
    }

    state.tasks.splice(index, 1);
    persist();
    render();
}

function currentRunTime(task) {
    if (!task.isRunning || !task.startedAt) return 0;
    return Date.now() - task.startedAt;
}

function updateElapsedDisplay(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    const row = document.querySelector(`.task-row[data-id="${id}"]`);
    if (!row) return;
    row.querySelector('[data-field="elapsed"]').textContent = formatDuration(task.elapsedMs + currentRunTime(task));
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600)
        .toString()
        .padStart(2, '0');
    const minutes = Math.floor((totalSeconds % 3600) / 60)
        .toString()
        .padStart(2, '0');
    const seconds = Math.floor(totalSeconds % 60)
        .toString()
        .padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function formatHours(ms) {
    const totalMinutes = Math.floor(ms / (60 * 1000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
}

function sortTasks(a, b, sortBy) {
    switch (sortBy) {
        case 'critical':
            return Number(b.isCritical) - Number(a.isCritical) || (b.lastUpdatedMs || 0) - (a.lastUpdatedMs || 0);
        case 'type':
            return a.type.localeCompare(b.type) || (b.lastUpdatedMs || 0) - (a.lastUpdatedMs || 0);
        case 'name':
            return a.name.localeCompare(b.name);
        case 'recent':
        default:
            return (b.lastUpdatedMs || 0) - (a.lastUpdatedMs || 0);
    }
}

function exportTask(task) {
    if (!task.logs.length) {
        alert('No logs to export for this item yet.');
        return;
    }
    const headers = ['Name', 'Date', 'Time Spent', 'Comment'];
    const rows = task.logs.map((log) => [task.name, log.date, log.duration, log.comment]);
    const csv = [headers, ...rows]
        .map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${task.name.replace(/\s+/g, '_').toLowerCase()}_logs.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

bootstrapApp();
