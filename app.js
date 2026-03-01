async function loadSchedule() {
  const res = await fetch('./schedule.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load schedule.json');
  return res.json();
}

function parseWeeksSpec(spec) {
  // Supports: "W12", "W9-16", "W1,3,5", "W1-6;W9-10" (basic)
  if (!spec) return { type: 'all' };
  const s = String(spec).trim();
  if (!s) return { type: 'all' };

  const parts = s.split(/[;\/|]/).map(p => p.trim()).filter(Boolean);
  const ranges = [];
  const singles = new Set();

  for (const p of parts) {
    const items = p.split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
    for (const it of items) {
      const mRange = it.match(/^W?(\d+)\s*-\s*W?(\d+)$/i);
      const mSingle = it.match(/^W?(\d+)$/i);
      if (mRange) {
        ranges.push([Number(mRange[1]), Number(mRange[2])]);
      } else if (mSingle) {
        singles.add(Number(mSingle[1]));
      }
    }
  }

  return { type: 'set', ranges, singles: [...singles].sort((a,b)=>a-b) };
}

function weekIncluded(week, weeksSpec) {
  if (!weeksSpec || weeksSpec.type === 'all') return true;
  if (weeksSpec.type !== 'set') return true;
  if (weeksSpec.singles.includes(week)) return true;
  for (const [a, b] of weeksSpec.ranges) {
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    if (week >= min && week <= max) return true;
  }
  return false;
}

function normalizeEvent(e) {
  return {
    ...e,
    _weeksSpec: parseWeeksSpec(e.weeks),
    _search: [e.title, e.code, e.type, e.location, e.notes].filter(Boolean).join(' ').toLowerCase()
  };
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatEventDetail(e) {
  const obj = {
    title: e.title,
    code: e.code,
    type: e.type,
    day: e.day,
    slot: e.slot,
    weeks: e.weeks,
    location: e.location,
    notes: e.notes
  };
  return JSON.stringify(obj, null, 2);
}

function detectConflicts(events, days, slots) {
  // Conflicts within same (day, slot) where >=2 events overlap on any week.
  // We approximate by: if two events share same day+slot and their week sets intersect.
  const warnings = [];
  const byKey = new Map();

  for (const e of events) {
    const k = `${e.day}@@${e.slot}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }

  const weekSet = (e, maxWeek) => {
    const set = new Set();
    for (let w = 1; w <= maxWeek; w++) if (weekIncluded(w, e._weeksSpec)) set.add(w);
    return set;
  };

  const intersects = (a, b) => {
    for (const x of a) if (b.has(x)) return true;
    return false;
  };

  const maxWeek = 16;
  for (const [k, list] of byKey.entries()) {
    if (list.length <= 1) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i];
        const B = list[j];
        const aSet = weekSet(A, maxWeek);
        const bSet = weekSet(B, maxWeek);
        if (intersects(aSet, bSet)) {
          warnings.push({
            level: 'bad',
            text: `可能冲突：${A.day} ${A.slot} 同时存在多门课（${A.code || A.title} vs ${B.code || B.title}），且周次有交集。`
          });
        }
      }
    }
  }

  if (!warnings.length) {
    warnings.push({ level: 'good', text: '未检测到明显的同节次冲突（基于当前 schedule.json）。' });
  }
  return warnings;
}

function renderWarnings(container, warnings) {
  container.innerHTML = '';
  for (const w of warnings) {
    const node = el('div', `warning ${w.level}`);
    node.textContent = w.text;
    container.appendChild(node);
  }
}

function renderGrid({ gridEl, detailEl, schedule, week, query }) {
  const days = schedule.days;
  const slots = schedule.slots;
  const events = schedule.events.map(normalizeEvent);

  const q = (query || '').trim().toLowerCase();
  const visible = events.filter(e => weekIncluded(week, e._weeksSpec))
    .filter(e => !q || e._search.includes(q));

  // Build empty cells map: slot -> day -> events
  const map = new Map();
  for (const s of slots) {
    const row = new Map();
    for (const d of days) row.set(d, []);
    map.set(s.id, row);
  }

  for (const e of visible) {
    if (!map.has(e.slot)) continue;
    const row = map.get(e.slot);
    if (!row.has(e.day)) continue;
    row.get(e.day).push(e);
  }

  // Clear
  gridEl.innerHTML = '';

  // Header row
  gridEl.appendChild(el('div', 'cell header', '时间'));
  for (const d of days) gridEl.appendChild(el('div', 'cell header', d));

  // Rows
  for (const s of slots) {
    const timeCell = el('div', 'cell time');
    timeCell.appendChild(el('div', 'tlabel', s.label));
    timeCell.appendChild(el('div', 'trange', `${s.start}–${s.end}`));
    gridEl.appendChild(timeCell);

    for (const d of days) {
      const c = el('div', 'cell');
      const list = map.get(s.id).get(d);
      list.sort((a,b) => (a.code||'').localeCompare(b.code||''));
      for (const e of list) {
        const card = el('div', 'event');
        const title = el('div', 'etitle', e.code ? `${e.code} ${e.title}` : e.title);
        const meta = el('div', 'emeta');
        if (e.weeks) meta.appendChild(el('span', 'pill', e.weeks));
        if (e.location) meta.appendChild(el('span', 'pill', e.location));
        if (e.type) meta.appendChild(el('span', 'pill', e.type));
        card.appendChild(title);
        card.appendChild(meta);
        card.addEventListener('click', () => {
          detailEl.textContent = formatEventDetail(e);
        });
        c.appendChild(card);
      }
      gridEl.appendChild(c);
    }
  }

  return visible;
}

async function main() {
  const baseSchedule = await loadSchedule();

  const weekSelect = document.getElementById('weekSelect');
  const searchInput = document.getElementById('searchInput');
  const todayBtn = document.getElementById('todayBtn');
  const addBtn = document.getElementById('addBtn');
  const exportBtn = document.getElementById('exportBtn');
  const gridEl = document.getElementById('grid');
  const detailEl = document.getElementById('detail');
  const warningsEl = document.getElementById('warnings');

  const dialog = document.getElementById('eventDialog');
  const form = document.getElementById('eventForm');
  const dialogTitle = document.getElementById('dialogTitle');
  const deleteBtn = document.getElementById('deleteBtn');
  const cancelBtn = document.getElementById('cancelBtn');

  // Local editable copy (persisted in localStorage)
  const LS_KEY = 'timetable.schedule.v1';
  const schedule = (() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return structuredClone(baseSchedule);
  })();

  const persist = () => {
    localStorage.setItem(LS_KEY, JSON.stringify(schedule, null, 2));
  };

  // Fill week selector
  const totalWeeks = schedule.weeks || 16;
  for (let w = 1; w <= totalWeeks; w++) {
    const opt = document.createElement('option');
    opt.value = String(w);
    opt.textContent = `W${w}`;
    weekSelect.appendChild(opt);
  }

  // Fill dialog selects
  const daySel = form.elements.namedItem('day');
  const slotSel = form.elements.namedItem('slot');
  daySel.innerHTML = '';
  for (const d of schedule.days) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    daySel.appendChild(opt);
  }
  slotSel.innerHTML = '';
  for (const s of schedule.slots) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.id} (${s.start}–${s.end})`;
    slotSel.appendChild(opt);
  }

  let week = 1;
  let query = '';
  let editingIndex = null; // index in schedule.events

  const openDialogFor = (idx) => {
    editingIndex = idx;
    const isEdit = idx !== null && idx !== undefined;
    dialogTitle.textContent = isEdit ? '编辑课程' : '新增课程';
    deleteBtn.style.display = isEdit ? 'inline-block' : 'none';

    const e = isEdit ? schedule.events[idx] : {
      title: '', code: '', type: '', day: schedule.days[0], slot: schedule.slots[0].id,
      weeks: `W${week}`, location: '', notes: ''
    };

    form.elements.namedItem('title').value = e.title || '';
    form.elements.namedItem('code').value = e.code || '';
    form.elements.namedItem('type').value = e.type || '';
    form.elements.namedItem('location').value = e.location || '';
    form.elements.namedItem('day').value = e.day || schedule.days[0];
    form.elements.namedItem('slot').value = e.slot || schedule.slots[0].id;
    form.elements.namedItem('weeks').value = e.weeks || '';
    form.elements.namedItem('notes').value = e.notes || '';

    dialog.showModal();
  };

  const rerender = () => {
    const visible = renderGrid({
      gridEl,
      detailEl,
      schedule,
      week,
      query
    });

    // Make event cards editable by click: locate by matching fields, then open dialog
    // (More robust: we show detail json with an edit hint)
    const warnings = detectConflicts(visible.map(normalizeEvent), schedule.days, schedule.slots);
    renderWarnings(warningsEl, warnings);

    // Add a hint in detail panel
    if (!detailEl.textContent || detailEl.textContent.includes('点击任意课程块')) {
      detailEl.textContent = '提示：点击课程块查看详情；要编辑请在右上角点“新增课程”或导出后编辑 schedule.json。\n\n（当前支持在页面内新增/编辑/删除：点击课程块后，在详情里复制字段并用“新增课程”快速改。）';
    }
  };

  weekSelect.value = '1';
  weekSelect.addEventListener('change', () => {
    week = Number(weekSelect.value);
    rerender();
  });

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    rerender();
  });

  todayBtn.addEventListener('click', () => {
    week = 1;
    weekSelect.value = '1';
    searchInput.value = '';
    query = '';
    rerender();
  });

  addBtn.addEventListener('click', () => openDialogFor(null));

  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(schedule, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schedule.export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  cancelBtn.addEventListener('click', () => {
    dialog.close();
  });

  deleteBtn.addEventListener('click', () => {
    if (editingIndex === null) return;
    schedule.events.splice(editingIndex, 1);
    persist();
    dialog.close();
    rerender();
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const e = {
      title: form.elements.namedItem('title').value.trim(),
      code: form.elements.namedItem('code').value.trim(),
      type: form.elements.namedItem('type').value.trim(),
      location: form.elements.namedItem('location').value.trim(),
      day: form.elements.namedItem('day').value,
      slot: form.elements.namedItem('slot').value,
      weeks: form.elements.namedItem('weeks').value.trim(),
      notes: form.elements.namedItem('notes').value.trim()
    };

    if (editingIndex === null) {
      schedule.events.push(e);
    } else {
      schedule.events[editingIndex] = e;
    }

    persist();
    dialog.close();
    rerender();
  });

  // Patch renderGrid click to open edit dialog by finding event index.
  // We do this by intercepting clicks on grid and matching nearest .event.
  gridEl.addEventListener('click', (ev) => {
    const card = ev.target.closest('.event');
    if (!card) return;
    // detailEl already updated by renderGrid's handler, but we also open edit dialog on Alt-click
    if (ev.altKey) {
      // Try to parse detail json to locate event
      try {
        const obj = JSON.parse(detailEl.textContent);
        const idx = schedule.events.findIndex(x =>
          (x.title||'') === (obj.title||'') && (x.code||'') === (obj.code||'') &&
          (x.day||'') === (obj.day||'') && (x.slot||'') === (obj.slot||'') && (x.weeks||'') === (obj.weeks||'')
        );
        if (idx >= 0) openDialogFor(idx);
      } catch {}
    }
  });

  rerender();
}

main().catch(err => {
  console.error(err);
  alert(String(err));
});
