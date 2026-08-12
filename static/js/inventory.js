/* ==========================================================================
   Inventory Management System — inventory.js
   ========================================================================== */

// ── State ─────────────────────────────────────────────────────────────────
let INV = {
    stores: [],
    items: [],
    inventory: [],
    filteredInventory: [],
    selectedStoreId: null,
    editingInvId: null,   // store_inventory.id being edited
    editingStoreId: null,
    searchQuery: '',
    // pagination state for inventory listing
    pagination: {
        page: 1,
        perPage: 10
    }
};

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadStores();
    loadItems();
    loadAllItems();   // Show all items immediately — no store required
    updateStats();

    // Live search
    const searchInput = document.getElementById('invSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            INV.searchQuery = e.target.value.trim().toLowerCase();
            applyFilter();
        });
    }

    // Ensure store form uses JS submit handler to avoid full-page form POST
    const storeForm = document.getElementById('storeForm');
    if (storeForm) {
        // prevent default submit and route to async saveStore
        storeForm.addEventListener('submit', function (e) {
            e.preventDefault();
            saveStore();
        });
    }
});

// ── Utility: Toast ────────────────────────────────────────────────────────
function invToast(msg, type = 'success') {
    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    const container = document.getElementById('invToastContainer');
    const t = document.createElement('div');
    t.className = `inv-toast inv-toast-${type}`;
    t.innerHTML = `<i class="fa-solid ${icons[type] || icons.info} inv-toast-icon"></i><span class="inv-toast-msg">${msg}</span>`;
    container.appendChild(t);
    setTimeout(() => {
        t.classList.add('dismissing');
        setTimeout(() => t.remove(), 350);
    }, 4000);
}

// ── Utility: Field validation ─────────────────────────────────────────────
function invClearErrors(formId) {
    document.querySelectorAll(`#${formId} .inv-form-control`).forEach(el => el.classList.remove('error'));
    document.querySelectorAll(`#${formId} .inv-field-error`).forEach(el => el.classList.remove('show'));
}

function invShowError(fieldId, errId, msg) {
    const field = document.getElementById(fieldId);
    const err   = document.getElementById(errId);
    if (field) field.classList.add('error');
    if (err)   { err.textContent = msg; err.classList.add('show'); }
}

// ── Utility: Format date ──────────────────────────────────────────────────
function fmtDate(dt) {
    if (!dt) return '—';
    const d = new Date(dt.replace(' ', 'T'));
    if (isNaN(d)) return dt;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Normalize a store-inventory id candidate into a numeric id the API expects.
// Accepts numbers, numeric strings, or composite strings like "4:1" and attempts
// to pick the numeric segment that matches a known inventory record when possible.
function normalizeInvId(idCandidate) {
    if (idCandidate == null) return null;
    if (typeof idCandidate === 'number' && Number.isInteger(idCandidate)) return idCandidate;
    const s = String(idCandidate).trim();
    if (!s) return null;
    // Pure digits -> parse directly
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    // Find all numeric sequences in the string
    const matches = s.match(/\d+/g);
    if (!matches || matches.length === 0) return null;
    // If inventory cache is available, prefer a match that corresponds to an existing record
    if (Array.isArray(INV.inventory) && INV.inventory.length) {
        for (const m of matches) {
            const num = parseInt(m, 10);
            // Loose match against known record id or inv_id (compare as strings to be safe)
            const found = INV.inventory.find(r => String(r.id) === String(num) || String(r.inv_id) === String(num));
            if (found) return num;
        }
    }
    // Fallback: return the first numeric sequence
    return parseInt(matches[0], 10);
}

// ═══════════════════════════════════════════════════════════════════════════
// STORES
// ═══════════════════════════════════════════════════════════════════════════
async function loadStores() {
    try {
        const res = await fetch('/api/inventory/stores');
        const data = await res.json();
        INV.stores = data;
        populateStoreDropdown();
        updateStats();
    } catch (e) {
        invToast('Failed to load stores.', 'error');
    }
}

function populateStoreDropdown() {
    const sel = document.getElementById('invStoreSelect');
    if (!sel) return;
    const prev = INV.selectedStoreId;
    sel.innerHTML = '<option value="">— All Items —</option>';
    INV.stores.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name + (s.status === 'inactive' ? ' (Inactive)' : '');
        sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
}

// Populate the store assign dropdown inside the item modal (kept for backward compat)
function populateStoreAssignDropdown(preSelectId) {
    const sel = document.getElementById('invStoreAssign');
    if (!sel) return;
    sel.innerHTML = '<option value="">— No Store / Keep as catalog item —</option>';
    INV.stores.filter(s => s.status === 'active').forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        sel.appendChild(opt);
    });
    if (preSelectId) sel.value = preSelectId;
}

// New helpers for multi-store assignment rows inside the item modal
function getStoreOptionsHtml(selectedId) {
    const opts = ['<option value="">— Select store —</option>'];
    for (const s of INV.stores.filter(s => s.status === 'active')) {
        opts.push(`<option value="${s.id}" ${selectedId && String(s.id) === String(selectedId) ? 'selected' : ''}>${escHtml(s.name)}</option>`);
    }
    return opts.join('');
}

function addStoreAssignRow(pref) {
    // pref: { store_id, qty }
    const container = document.getElementById('invStoreAssignList');
    if (!container) return null;
    const row = document.createElement('div');
    row.className = 'inv-store-row';
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';

    const sel = document.createElement('select');
    sel.className = 'inv-form-control inv-store-select';
    sel.style.minWidth = '220px';
    sel.innerHTML = getStoreOptionsHtml(pref && pref.store_id ? pref.store_id : '');

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.className = 'inv-form-control inv-store-qty';
    qty.min = 0;
    qty.step = 1;
    qty.style.width = '120px';
    qty.value = (pref && typeof pref.qty !== 'undefined') ? String(pref.qty) : '0';
    qty.title = 'Quantity assigned to this store';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-inv-delete';
    removeBtn.style.height = '36px';
    removeBtn.innerHTML = '<i class="fa-solid fa-minus"></i>';
    removeBtn.title = 'Remove store assignment';

    // Event listeners: update totals and refresh options when user interacts
    sel.addEventListener('change', () => {
        refreshStoreOptionsToPreventDuplicates();
    });
    qty.addEventListener('input', () => updateAssignTotals());
    removeBtn.addEventListener('click', () => {
        if (row.parentNode) row.parentNode.removeChild(row);
        refreshStoreOptionsToPreventDuplicates();
        updateAssignTotals();
    });

    row.appendChild(sel);
    row.appendChild(qty);
    row.appendChild(removeBtn);
    container.appendChild(row);

    // After adding a row, prevent duplicate store selection and recalc totals
    refreshStoreOptionsToPreventDuplicates();
    updateAssignTotals();
    return row;
}

function renderStoreAssignRows(assigns) {
    const container = document.getElementById('invStoreAssignList');
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(assigns) || assigns.length === 0) return;
    for (const a of assigns) {
        // a may be {store_id, qty} or {name, qty}
        let storeId = a.store_id || null;
        if (!storeId && a.name) {
            const match = INV.stores.find(s => s.name === a.name);
            if (match) storeId = match.id;
        }
        addStoreAssignRow({ store_id: storeId, qty: a.qty });
    }
}

function collectStoreAssignRows() {
    const container = document.getElementById('invStoreAssignList');
    if (!container) return [];
    const rows = Array.from(container.querySelectorAll('.inv-store-row'));
    const out = [];
    for (const r of rows) {
        const sel = r.querySelector('.inv-store-select');
        const qty = r.querySelector('.inv-store-qty');
        const storeId = sel ? (sel.value ? parseInt(sel.value) : null) : null;
        const q = qty ? parseInt(qty.value || '0') : 0;
        if (storeId) out.push({ store_id: storeId, qty: q });
    }
    return out;
}

// Aggregate inventory entries into one product-per-row view when showing all items
function aggregateInventory(list) {
    const m = new Map();
    for (const r of list) {
        // Determine product key (support several API shapes)
        const pid = r.item_id || r.product_id || r.id || r.itemId || r.inv_item_id || null;
        const key = pid ? String(pid) : (r.name ? ('name:' + r.name) : JSON.stringify(r));
        if (!m.has(key)) {
            m.set(key, {
                id: pid || null,
                name: r.name || r.item_name || r.title || '—',
                unit: r.unit || 'pcs',
                description: r.description || r.desc || r.note || '',
                qty_on_hand: typeof r.qty_on_hand !== 'undefined' ? Number(r.qty_on_hand) : 0,
                qty_on_store: 0,
                store_breakdown: [],
                last_updated: r.last_updated || r.updated_at || r.created_at || null
            });
        }
        const agg = m.get(key);

        // If this record includes a store breakdown array, merge it
        if (Array.isArray(r.store_breakdown) && r.store_breakdown.length) {
            for (const sb of r.store_breakdown) {
                const name = sb.name || (INV.stores.find(s => s.id === sb.store_id) || {}).name || 'Store';
                const qty = Number(sb.qty || sb.qty_on_store || 0);
                agg.store_breakdown.push({ store_id: sb.store_id || null, name, qty });
                agg.qty_on_store += qty;
            }
        } else if (r.store_id) {
            // Single store record
            const name = (INV.stores.find(s => s.id === r.store_id) || {}).name || 'Store';
            const qty = Number(r.qty_on_store || r.qty_on_hand || 0);
            agg.store_breakdown.push({ store_id: r.store_id, name, qty });
            agg.qty_on_store += qty;
        }

        // Prefer any explicit product-level qty_on_hand seen
        if (typeof r.qty_on_hand !== 'undefined' && Number(r.qty_on_hand) > 0) {
            agg.qty_on_hand = Number(r.qty_on_hand);
        }
        // Track most recent update
        if (r.last_updated && (!agg.last_updated || new Date(r.last_updated) > new Date(agg.last_updated))) agg.last_updated = r.last_updated;
    }

    // For aggregated rows, if qty_on_hand is zero but we have assigned quantities, set on_hand to sum of assigns
    const out = [];
    for (const v of m.values()) {
        if (!v.qty_on_hand && v.qty_on_store) v.qty_on_hand = v.qty_on_store;
        out.push(v);
    }
    return out;
}

// Render compact chips for store breakdown with +N more toggle
function renderStoreChips(storeArr, productKey) {
    if (!Array.isArray(storeArr) || storeArr.length === 0) return '';
    // safe id
    const safeKey = String(productKey).replace(/[^a-zA-Z0-9_-]/g, '_');
    const visible = storeArr.slice(0, 2);
    const hidden = storeArr.slice(2);
    let html = '<div class="inv-store-chips">';
    for (const s of visible) {
        html += `<span class="inv-store-chip"><strong>${escHtml(s.name)}</strong>: ${escHtml(String(s.qty))}</span>`;
    }
    if (hidden.length > 0) {
        html += `<span id="inv-sb-hidden-${safeKey}" class="inv-store-hidden">`;
        for (const s of hidden) html += `<span class="inv-store-chip"><strong>${escHtml(s.name)}</strong>: ${escHtml(String(s.qty))}</span>`;
        html += `</span><button type="button" class="inv-store-more" onclick="toggleStoreHidden('${safeKey}')">+${hidden.length} more</button>`;
    }
    html += '</div>';
    return html;
}

function toggleStoreHidden(safeKey) {
    const el = document.getElementById('inv-sb-hidden-' + safeKey);
    if (!el) return;
    if (el.classList.contains('inv-store-hidden')) el.classList.remove('inv-store-hidden');
    else el.classList.add('inv-store-hidden');
}

// Update total assigned and remaining shown in the item modal
function updateAssignTotals() {
    const handEl = document.getElementById('invQtyOnHand');
    const hand = handEl ? Number(handEl.value || 0) : 0;
    const assigns = collectStoreAssignRows();
    const totalAssigned = assigns.reduce((s, a) => s + (Number(a.qty) || 0), 0);
    const remaining = Math.max(0, hand - totalAssigned);
    const totalEl = document.getElementById('invTotalAssigned');
    const remEl = document.getElementById('invRemaining');
    if (totalEl) totalEl.textContent = String(totalAssigned);
    if (remEl) remEl.textContent = String(remaining);
}

// Prevent the same store being selected twice across assign rows
function refreshStoreOptionsToPreventDuplicates() {
    const container = document.getElementById('invStoreAssignList');
    if (!container) return;
    const selects = Array.from(container.querySelectorAll('.inv-store-select'));
    const chosen = new Set(selects.map(s => s.value).filter(v => v));
    // refresh options for each select to disable already chosen options (except itself)
    for (const s of selects) {
        const current = s.value;
        const html = getStoreOptionsHtml(current);
        s.innerHTML = html;
        s.value = current || '';
        // Disable options that are chosen elsewhere
        for (const opt of Array.from(s.options)) {
            if (opt.value && opt.value !== current && chosen.has(opt.value)) opt.disabled = true;
            else opt.disabled = false;
        }
    }
}

function onStoreChange() {
    const sel = document.getElementById('invStoreSelect');
    INV.selectedStoreId = sel.value ? parseInt(sel.value) : null;
    if (INV.selectedStoreId) {
        loadInventory(INV.selectedStoreId);
        const store = INV.stores.find(s => s.id === INV.selectedStoreId);
        updateTableHeader(store ? store.name : 'Store');
    } else {
        loadAllItems();
        updateTableHeader('All Items');
    }
}

// ── Add / Edit Store Modal ─────────────────────────────────────────────────
function openAddStoreModal() {
    INV.editingStoreId = null;
    const titleEl = document.getElementById('storeModalTitle');
    if (titleEl) titleEl.textContent = 'Add New Store';
    const titleIcon = document.getElementById('storeModalTitleIcon');
    if (titleIcon) titleIcon.className = 'fa-solid fa-shop';
    const nameEl = document.getElementById('storeNameInput'); if (nameEl) nameEl.value = '';
    invClearErrors('storeForm');
    // If the Manage Stores modal is open, close it so the add-store modal is visible
    closeModal('storeManageModal');
    openModal('storeModal');
}

function openEditStoreModal(storeId) {
    const store = INV.stores.find(s => s.id === storeId);
    if (!store) return;
    INV.editingStoreId = storeId;
    const titleEl = document.getElementById('storeModalTitle');
    if (titleEl) titleEl.textContent = 'Edit Store';
    const titleIcon = document.getElementById('storeModalTitleIcon');
    if (titleIcon) titleIcon.className = 'fa-solid fa-pen-to-square';
    const nameEl = document.getElementById('storeNameInput'); if (nameEl) nameEl.value = store.name;
    invClearErrors('storeForm');
    closeModal('storeManageModal');
    openModal('storeModal');
}

async function saveStore() {
    invClearErrors('storeForm');
    const nameEl = document.getElementById('storeNameInput');
    const name = nameEl ? (nameEl.value || '').trim() : '';

    let valid = true;
    if (!name) {
        invShowError('storeNameInput', 'storeNameErr', 'Store name is required.');
        valid = false;
    }
    if (!valid) return;

    const btn = document.getElementById('btnSaveStore');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    }

    try {
        const url = INV.editingStoreId ? `/api/inventory/stores/${INV.editingStoreId}` : '/api/inventory/stores';
        const method = INV.editingStoreId ? 'PUT' : 'POST';
        const payload = { name };
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let data;
        try {
            data = await res.json();
        } catch (parseErr) {
            // If the response isn't JSON, capture text for debugging
            const txt = await res.text();
            console.error('saveStore: non-JSON response', txt);
            data = { error: txt };
        }

        if (!res.ok) {
            // If the API returned field-level errors, display them
            if (data && data.errors && typeof data.errors === 'object') {
                Object.keys(data.errors).forEach(field => {
                    const errMsg = Array.isArray(data.errors[field]) ? data.errors[field].join(', ') : String(data.errors[field]);
                    // Map common field names to form IDs
                    if (field === 'name' || field === 'store_name') invShowError('storeNameInput', 'storeNameErr', errMsg);
                });
            }
            invToast(data.error || data.message || 'Save failed.', 'error');
            console.error('saveStore failed', res.status, data);
        } else {
            invToast(INV.editingStoreId ? 'Store updated successfully.' : 'Store created successfully.', 'success');
            closeModal('storeModal');
            await loadStores();
            // Select the new store if just created
            if (!INV.editingStoreId && data && data.id) {
                INV.selectedStoreId = data.id;
                const sel = document.getElementById('invStoreSelect');
                if (sel) sel.value = data.id;
                loadInventory(data.id);
            }
        }
    } catch (e) {
        invToast('Network error. Please try again.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Store';
        }
    }
}

async function deleteStore(storeId) {
    const store = INV.stores.find(s => s.id === storeId);
    if (!store) return;
    showConfirm(
        'Delete Store',
        `Are you sure you want to delete <strong>${escHtml(store.name)}</strong>?<br><small>If the store has inventory records, it will be deactivated instead of permanently deleted.</small>`,
        'warning',
        async () => {
            try {
                const res = await fetch(`/api/inventory/stores/${storeId}`, { method: 'DELETE' });
                const data = await res.json();
                if (!res.ok) {
                    invToast(data.error || 'Delete failed.', 'error');
                } else {
                    invToast(data.message, data.deactivated ? 'warning' : 'success');
                    if (INV.selectedStoreId === storeId) {
                        INV.selectedStoreId = null;
                        INV.inventory = [];
                        renderInventoryTable();
                    }
                    await loadStores();
                    openStoreManageModal();
                }
            } catch (e) {
                invToast('Network error.', 'error');
            }
        }
    );
}

function openStoreManageModal() {
    renderStoresTable();
    openModal('storeManageModal');
}

function renderStoresTable() {
    const tbody = document.getElementById('storesTbody');
    if (!tbody) return;
    if (INV.stores.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="inv-empty-state" style="padding:2rem;text-align:center;color:var(--text-muted);">No stores yet. Add your first store!</td></tr>`;
        return;
    }
    tbody.innerHTML = INV.stores.map(s => `
        <tr>
            <td><strong>${escHtml(s.name)}</strong>${s.description ? `<div class="inv-item-desc">${escHtml(s.description)}</div>` : ''}</td>
            <td>${s.created_at ? s.created_at.slice(0,10) : '—'}</td>
            <td><span class="inv-status-badge ${s.status === 'active' ? 'inv-status-active' : 'inv-status-inactive'}">
                <i class="fa-solid ${s.status === 'active' ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>${s.status}</span></td>
            <td>
                <div style="display:flex;gap:6px;">
                    <button class="btn-inv-edit" onclick="openEditStoreModal(${s.id})"><i class="fa-solid fa-pen"></i> Edit</button>
                    <button class="btn-inv-delete" onclick="deleteStore(${s.id})"><i class="fa-solid fa-trash"></i> Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// ITEMS
// ═══════════════════════════════════════════════════════════════════════════
async function loadItems() {
    try {
        const res = await fetch('/api/inventory/items');
        INV.items = await res.json();
        populateItemsDropdown();
    } catch (e) {
        console.error('Failed to load items:', e);
    }
}

function populateItemsDropdown() {
    const sel = document.getElementById('invItemSelect');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Select an Item —</option>';
    INV.items.forEach(it => {
        const opt = document.createElement('option');
        opt.value = it.id;
        opt.textContent = it.name;
        sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════════════════════════════════
async function loadAllItems() {
    try {
        const res = await fetch('/api/inventory/all-items');
        const data = await res.json();
        INV.inventory = data;
        applyFilter();
        updateStats();
    } catch (e) {
        invToast('Failed to load items.', 'error');
    }
}

async function loadInventory(storeId) {
    updateTableHeader('Loading...');
    try {
        const res = await fetch(`/api/inventory/store-inventory?store_id=${storeId}`);
        const data = await res.json();
        INV.inventory = data;
        applyFilter();
        updateStats();
    } catch (e) {
        invToast('Failed to load inventory.', 'error');
    }
}

function applyFilter() {
    const q = INV.searchQuery;
    if (!q) {
        INV.filteredInventory = [...INV.inventory];
    } else {
        INV.filteredInventory = INV.inventory.filter(r =>
            (r.name  || '').toLowerCase().includes(q) ||
            (r.category || '').toLowerCase().includes(q) ||
            (r.unit  || '').toLowerCase().includes(q)
        );
    }
    // reset to first page on filter change
    INV.pagination.page = 1;
    renderInventoryTable();
}

function renderInventoryTable() {
    const tbody = document.getElementById('invTbody');
    const countEl = document.getElementById('invRecordCount');
    if (!tbody) return;

    if (INV.filteredInventory.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="9">
                <div class="inv-empty-state">
                    <div class="inv-empty-icon"><i class="fa-solid fa-box-open"></i></div>
                    <h4>${INV.searchQuery ? 'No Results Found' : 'No Items Yet'}</h4>
                    <p>${INV.searchQuery ? `No inventory items match "<strong>${escHtml(INV.searchQuery)}</strong>".` : 'Click <strong>+ Add Item</strong> to add your first inventory item to this store.'}</p>
                </div>
            </td></tr>`;
        if (countEl) countEl.textContent = '0 items';
        return;
    }

    // Pagination: determine slice
    const perPage = INV.pagination.perPage || 10;
    const page = Math.max(1, INV.pagination.page || 1);
    const totalItems = INV.filteredInventory.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    // Bound page
    if (page > totalPages) INV.pagination.page = totalPages;

    if (countEl) countEl.textContent = `${totalItems} item${totalItems !== 1 ? 's' : ''} — page ${INV.pagination.page} of ${totalPages}`;

    const LOW_STOCK_THRESHOLD = 10;

    // Sort low stock items first (work on a copy to avoid re-sorting original array repeatedly)
    const sorted = [...INV.filteredInventory].sort((a, b) => {
        const totalA = (a.qty_on_hand || 0) + (a.qty_on_store || 0);
        const totalB = (b.qty_on_hand || 0) + (b.qty_on_store || 0);
        const aLow = totalA <= LOW_STOCK_THRESHOLD ? 0 : 1;
        const bLow = totalB <= LOW_STOCK_THRESHOLD ? 0 : 1;
        if (aLow !== bLow) return aLow - bLow;
        return totalA - totalB;
    });

    const start = (INV.pagination.page - 1) * perPage;
    const end = start + perPage;
    const pageItems = sorted.slice(start, end);

    tbody.innerHTML = pageItems.map(r => {
        const totalPcs = (r.qty_on_hand || 0) + (r.qty_on_store || 0);
        const isLowStock = totalPcs <= LOW_STOCK_THRESHOLD;
        const stockBadge = isLowStock
            ? `<span class="inv-stock-badge inv-stock-low"><i class="fa-solid fa-triangle-exclamation"></i> Low Stock</span>`
            : `<span class="inv-stock-badge inv-stock-ok"><i class="fa-solid fa-circle-check"></i> In Stock</span>`;

        // Render per-store breakdown if provided by API: expect r.store_breakdown = [{ name, qty }, ...]
        let storeBreakdownHtml = '';
        if (Array.isArray(r.store_breakdown) && r.store_breakdown.length > 0) {
            const productKey = r.inv_id || r.id || r.item_id || r.name || '';
            storeBreakdownHtml = renderStoreChips(r.store_breakdown, productKey);
        }

        return `
        <tr class="${isLowStock ? 'inv-row-low-stock' : ''}">
            <td>
                <div class="inv-item-name">${escHtml(r.name)}</div>
                ${r.description ? `<div class="inv-item-desc">${escHtml(r.description)}</div>` : ''}
            </td>
            <td><span class="inv-unit-badge">${escHtml(r.unit || 'pcs')}</span></td>
            <td><span class="inv-qty inv-qty-hand">${r.qty_on_hand}</span></td>
            <td>
                <span class="inv-qty inv-qty-store">${r.qty_on_store}</span>
                ${storeBreakdownHtml}
            </td>
            <td><span class="inv-qty inv-qty-total">${totalPcs}</span></td>
            <td>${stockBadge}</td>
            <td><span class="inv-last-updated">${fmtDate(r.last_updated)}</span></td>
            <td>
                <div class="inv-actions">
                    <button class="btn-inv-edit" onclick="openEditInvModal(${r.inv_id ? r.inv_id : r.id})" title="Edit quantities">
                        <i class="fa-solid fa-pen"></i> Edit
                    </button>
                    <button class="btn-inv-delete" onclick="confirmDeleteInv(${r.inv_id ? r.inv_id : r.id})" title="Remove">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;}).join('');

    // Render pagination controls if container exists
    renderPaginationControls(totalPages);
}

function renderPaginationControls(totalPages) {
    const pager = document.getElementById('invPagination');
    if (!pager) return;
    const page = INV.pagination.page || 1;

    // Clear existing
    pager.innerHTML = '';

    // Prev button ("<")
    const prevBtn = document.createElement('button');
    prevBtn.className = 'inv-pg-btn inv-pg-prev';
    prevBtn.type = 'button';
    prevBtn.title = 'Previous page';
    prevBtn.setAttribute('aria-label', 'Previous page');
    prevBtn.innerText = '<';
    prevBtn.disabled = page <= 1;
    prevBtn.addEventListener('click', invPrevPage);
    pager.appendChild(prevBtn);

    // show a few page buttons around current
    const windowSize = 5;
    const half = Math.floor(windowSize / 2);
    let start = Math.max(1, page - half);
    let end = Math.min(totalPages, start + windowSize - 1);
    if (end - start < windowSize - 1) start = Math.max(1, end - windowSize + 1);

    for (let p = start; p <= end; p++) {
        const b = document.createElement('button');
        b.className = 'inv-pg-btn' + (p === page ? ' active' : '');
        b.type = 'button';
        b.innerText = String(p);
        b.addEventListener('click', () => invGoToPage(p));
        pager.appendChild(b);
    }

    // Next button (">")
    const nextBtn = document.createElement('button');
    nextBtn.className = 'inv-pg-btn inv-pg-next';
    nextBtn.type = 'button';
    nextBtn.title = 'Next page';
    nextBtn.setAttribute('aria-label', 'Next page');
    nextBtn.innerText = '>';
    nextBtn.disabled = page >= totalPages;
    nextBtn.addEventListener('click', invNextPage);
    pager.appendChild(nextBtn);

    // per-page selector
    const perSpan = document.createElement('span');
    perSpan.className = 'inv-pg-perpage';
    perSpan.innerHTML = 'Per page: ';
    const sel = document.createElement('select');
    sel.id = 'invPerPageSel';
    ['5','10','25','50'].forEach(v => {
        const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o);
    });
    sel.value = String(INV.pagination.perPage || 10);
    sel.addEventListener('change', (e) => {
        INV.pagination.perPage = parseInt(e.target.value) || 10;
        INV.pagination.page = 1;
        renderInventoryTable();
    });
    perSpan.appendChild(sel);
    pager.appendChild(perSpan);
}

function invGoToPage(n) {
    const totalPages = Math.max(1, Math.ceil(INV.filteredInventory.length / (INV.pagination.perPage || 10)));
    const target = Math.max(1, Math.min(totalPages, n));
    INV.pagination.page = target;
    renderInventoryTable();
}

function invPrevPage() {
    if (INV.pagination.page > 1) {
        INV.pagination.page -= 1;
        renderInventoryTable();
    }
}

function invNextPage() {
    const totalPages = Math.max(1, Math.ceil(INV.filteredInventory.length / (INV.pagination.perPage || 10)));
    if (INV.pagination.page < totalPages) {
        INV.pagination.page += 1;
        renderInventoryTable();
    }
}

function updateTableHeader(storeName) {
    const el = document.getElementById('invTableStoreLabel');
    if (el) el.textContent = storeName;
}

function updateStats() {
    const totalStores = INV.stores.filter(s => s.status === 'active').length;
    const totalItems = INV.items.length;
    const totalRecords = INV.inventory.length;
    const totalOnHand = INV.inventory.reduce((sum, r) => sum + (r.qty_on_hand || 0), 0);

    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el('statTotalStores', totalStores);
    el('statTotalItems', totalItems);
    el('statTotalRecords', totalRecords);
    el('statTotalOnHand', totalOnHand);
}

// ── Add / Edit Item Modal ─────────────────────────────────────────────────
function openAddItemModal() {
    INV.editingInvId = null;
    const titleEl = document.getElementById('itemModalTitle'); if (titleEl) titleEl.textContent = 'Add Item';
    const iconEl = document.getElementById('itemModalIcon'); if (iconEl) iconEl.className = 'fa-solid fa-plus';

    // Show new-item fields, hide edit display
    const nameSection = document.getElementById('itemNameSection');
    const editDisplay = document.getElementById('itemEditNameDisplay');
    if (nameSection) nameSection.style.display = 'block';
    if (editDisplay) editDisplay.style.display = 'none';

    // Reset form fields
    const elName = document.getElementById('invItemName'); if (elName) elName.value = '';
    const elCat = document.getElementById('invItemCategory'); if (elCat) elCat.value = '';
    const elUnit = document.getElementById('invItemUnit'); if (elUnit) elUnit.value = 'pcs';
    const elDesc = document.getElementById('invItemDesc'); if (elDesc) elDesc.value = '';
    const elHand = document.getElementById('invQtyOnHand'); if (elHand) elHand.value = '0';
    const elStore = document.getElementById('invQtyOnStore'); if (elStore) elStore.value = '0';

    // Pre-select current store filter if one is active
    populateStoreAssignDropdown(INV.selectedStoreId || '');

    // Render multi-store assignment rows: prefill one row when adding
    const assignList = document.getElementById('invStoreAssignList');
    if (assignList) {
        assignList.innerHTML = '';
        if (INV.selectedStoreId) {
            // If user is adding while a store filter is active, prefill that store as an assignment row
            renderStoreAssignRows([{ store_id: INV.selectedStoreId, qty: 0 }]);
        } else {
            // For initial create, do not force a store assignment — user may assign stores later via Edit
            // Leave assignList empty and let the user click [+ Assign Another Store] when ready
        }
    }

    // Keep totals and option disabling in sync
    refreshStoreOptionsToPreventDuplicates();
    updateAssignTotals();
    const handEl = document.getElementById('invQtyOnHand'); if (handEl) handEl.addEventListener('input', updateAssignTotals);

    invClearErrors('itemForm');
    openModal('itemModal');
}

function openEditInvModal(invId) {
    // Inventory array may be either store-specific records (id = store_inventory.id)
    // or aggregated "all-items" rows (id = item.id, inv_id = store_inventory.id).
    // Accept either: normalize the provided id and find a matching record by id or inv_id.
    const normId = normalizeInvId(invId);
    let rec = null;
    if (normId) {
        rec = INV.inventory.find(r => String(r.id) === String(normId) || String(r.inv_id) === String(normId));
    }
    // As a fallback, attempt to match the raw value if normalization failed
    if (!rec && Array.isArray(INV.inventory)) {
        rec = INV.inventory.find(r => String(r.id) === String(invId) || String(r.inv_id) === String(invId));
    }
    if (!rec) return;
    INV.editingInvId = normId || invId;

    const titleEl = document.getElementById('itemModalTitle'); if (titleEl) titleEl.textContent = 'Edit Quantities';
    const iconEl = document.getElementById('itemModalIcon'); if (iconEl) iconEl.className = 'fa-solid fa-pen-to-square';

    // Hide new-item fields, show readonly name
    const nameSection = document.getElementById('itemNameSection');
    const editDisplay = document.getElementById('itemEditNameDisplay');
    if (nameSection) nameSection.style.display = 'none';
    if (editDisplay) editDisplay.style.display = 'block';
    const disp = document.getElementById('invItemDisplayName'); if (disp) disp.textContent = rec.name;

    const handEl = document.getElementById('invQtyOnHand'); if (handEl) handEl.value = (rec.qty_on_hand || 0);
    const storeEl = document.getElementById('invQtyOnStore'); if (storeEl) storeEl.value = (rec.qty_on_store || 0);

    // Render store assignment rows for editing
    const assignList = document.getElementById('invStoreAssignList');
    if (assignList) {
        assignList.innerHTML = '';
        if (Array.isArray(rec.store_breakdown) && rec.store_breakdown.length > 0) {
            // API provided a breakdown: each element may have { name, qty } or { store_id, qty }
            const assigns = rec.store_breakdown.map(sb => ({ store_id: sb.store_id || null, name: sb.name || null, qty: sb.qty || (sb.qty_on_store || 0) }));
            renderStoreAssignRows(assigns);
        } else if (rec.store_id) {
            addStoreAssignRow({ store_id: rec.store_id, qty: rec.qty_on_store || rec.qty_on_hand || 0 });
        } else {
            // No store info — leave list empty for manual assignment
            addStoreAssignRow();
        }
    }

    // Sync options + totals
    refreshStoreOptionsToPreventDuplicates();
    updateAssignTotals();
    const handEl2 = document.getElementById('invQtyOnHand'); if (handEl2) handEl2.addEventListener('input', updateAssignTotals);

    invClearErrors('itemForm');
    openModal('itemModal');
}

async function saveNewItem() {
    invClearErrors('itemForm');

    const qtyOnHandEl  = document.getElementById('invQtyOnHand');
    const qtyOnStoreEl = document.getElementById('invQtyOnStore');
    const qtyOnHand  = qtyOnHandEl ? qtyOnHandEl.value : '';
    const qtyOnStore = qtyOnStoreEl ? qtyOnStoreEl.value : '';
    let valid = true;

    // Validate quantities
    if (qtyOnHand === '' || isNaN(Number(qtyOnHand)) || Number(qtyOnHand) < 0) {
        invShowError('invQtyOnHand', 'invQtyOnHandErr', 'Must be a non-negative number.');
        valid = false;
    }
    if (qtyOnStore === '' || isNaN(Number(qtyOnStore)) || Number(qtyOnStore) < 0) {
        invShowError('invQtyOnStore', 'invQtyOnStoreErr', 'Must be a non-negative number.');
        valid = false;
    }

    // Get selected store from the modal dropdown
    const storeAssignSel = document.getElementById('invStoreAssign');
    const modalStoreId = storeAssignSel ? (storeAssignSel.value ? parseInt(storeAssignSel.value) : null) : INV.selectedStoreId;

    if (INV.editingInvId) {
        // Editing existing record — update store record and adjust product on_hand if needed
        console.log('saveNewItem() - edit path. editingInvId=', INV.editingInvId, 'qtyOnHand=', qtyOnHand, 'qtyOnStore=', qtyOnStore);
        if (!valid) return;
        const btn = document.getElementById('btnSaveItem');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...'; }
        try {
            // Find the original inventory record to compute deltas. Be forgiving about id types and field names.
            let rec = INV.inventory.find(r => r.id === INV.editingInvId || (r.inv_id && r.inv_id === INV.editingInvId));
            if (!rec) {
                // Try loose matching (string vs number, or item_id match)
                rec = INV.inventory.find(r => String(r.id) === String(INV.editingInvId) || String(r.inv_id || '') === String(INV.editingInvId) || String(r.item_id || '') === String(INV.editingInvId));
            }

            if (!rec) {
                console.warn('saveNewItem: could not locate inventory record for id', INV.editingInvId);
                invToast('Unable to locate the inventory record to edit. Please refresh and try again.', 'error');
                // reset UI
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save'; }
                return;
            }

            // Determine the store-inventory id to update. Prefer rec.inv_id, then rec.id, then editingInvId
            const storeInvIdCandidate = rec.inv_id || rec.id || INV.editingInvId;
            const storeInvId = normalizeInvId(storeInvIdCandidate);
            if (!storeInvId) {
                console.error('Unable to determine numeric store-inventory id from', storeInvIdCandidate);
                invToast('Unable to determine the inventory record to update. Please refresh the page and try again.', 'error');
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save'; }
                return;
            }
            console.log('saveNewItem: updating store-inventory id=', storeInvId);

            // Update the specific store inventory record
            const res = await fetch(`/api/inventory/store-inventory/${storeInvId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qty_on_hand: parseInt(qtyOnHand), qty_on_store: parseInt(qtyOnStore) })
            });

            let data = {};
            try { data = await res.json(); } catch(e) { data = {}; }

            if (!res.ok) {
                console.error('store-inventory update failed', res.status, data);
                invToast(data.error || (`Update failed (status ${res.status}).`), 'error');
            } else {
                // If this edit changes the per-store quantity, adjust the product's global on_hand accordingly.
                // previous store qty may be in rec.qty_on_store or inside rec.store_breakdown
                const prevStoreQty = (rec && (rec.qty_on_store || 0));
                const newStoreQty = parseInt(qtyOnStore) || 0;
                const delta = newStoreQty - (prevStoreQty || 0); // positive => more assigned to store, so reduce global on_hand

                // Determine product id and current product on_hand value
                const productId = rec ? (rec.item_id || rec.product_id || rec.inv_item_id || rec.id || null) : null;
                const currentOnHand = rec ? (rec.qty_on_hand || rec.on_hand || 0) : 0;

                // Server does not store a dedicated "on_hand" field on the items table.
                // The store-inventory update above is authoritative; reload data and show success.
                invToast('Quantities updated.', 'success');

                closeModal('itemModal');
                INV.selectedStoreId ? loadInventory(INV.selectedStoreId) : loadAllItems();
                updateStats();
            }
        } catch (e) {
            invToast('Network error. Please try again.', 'error');
            console.error('saveNewItem - edit error', e);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save'; }
        }
        return;
    }

    // Adding new item — name is required
    const name = (document.getElementById('invItemName').value || '').trim();
    const unit  = document.getElementById('invItemUnit').value || 'pcs';
    const desc  = (document.getElementById('invItemDesc').value || '').trim();

    if (!name) {
        invShowError('invItemName', 'invItemNameErr', 'Item name is required.');
        valid = false;
    }
    if (!valid) return;

    const btn = document.getElementById('btnSaveItem');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    try {
        // Step 1: Create the item in the catalog
        const sku = 'AUTO-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
        const itemRes = await fetch('/api/inventory/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, sku, unit, description: desc })
        });
        const itemData = await itemRes.json();
        if (!itemRes.ok) {
            invToast(itemData.error || 'Failed to create item.', 'error');
            return;
        }
        const newItemId = itemData.id;

        // Step 2: If store assignment rows are present, create store_inventory records for each
        const assignRows = collectStoreAssignRows();
        if (assignRows.length > 0) {
            let failures = 0;
            for (const ar of assignRows) {
                try {
                    const invRes = await fetch('/api/inventory/store-inventory', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            store_id: ar.store_id,
                            item_id: newItemId,
                            // Treat per-store qty as both on_store and on_hand for that store record
                            qty_on_hand: parseInt(ar.qty || 0),
                            qty_on_store: parseInt(ar.qty || 0)
                        })
                    });
                    const invData = await (async () => {
                        try { return await invRes.json(); } catch (e) { return { error: 'Invalid response' }; }
                    })();
                    if (!invRes.ok) {
                        failures++;
                        console.warn('Store assignment failed for store_id', ar.store_id, invData);
                    }
                } catch (e) {
                    failures++;
                    console.warn('Network error assigning store', ar.store_id, e);
                }
            }
            if (failures) {
                invToast('Item created, but one or more store assignments failed.', 'warning');
            } else {
                invToast('Item added and assigned to stores!', 'success');
            }
        } else if (modalStoreId) {
            // Backwards-compat: single-store select was used
            const invRes = await fetch('/api/inventory/store-inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    store_id: modalStoreId,
                    item_id: newItemId,
                    qty_on_hand: parseInt(qtyOnHand),
                    qty_on_store: parseInt(qtyOnStore)
                })
            });
            const invData = await (async () => { try { return await invRes.json(); } catch (e) { return { error: 'Invalid response' }; } })();
            if (!invRes.ok) {
                invToast(`Item created, but store assignment failed: ${invData.error || ''}`, 'warning');
            } else {
                invToast('Item added and assigned to store!', 'success');
            }
        } else {
            invToast('Item added to catalog.', 'success');
        }

        closeModal('itemModal');
        await loadItems();
        INV.selectedStoreId ? loadInventory(INV.selectedStoreId) : loadAllItems();
        updateStats();

    } catch (e) {
        invToast('Network error. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
    }
}

function confirmDeleteInv(invId) {
    const normId = normalizeInvId(invId);
    const rec = Array.isArray(INV.inventory) ? INV.inventory.find(r => String(r.id) === String(normId) || String(r.inv_id) === String(normId) || String(r.id) === String(invId) || String(r.inv_id) === String(invId)) : null;
    if (!rec) return;
    const deletingCatalogItem = !INV.selectedStoreId;
    showConfirm(
        deletingCatalogItem ? 'Delete Item' : 'Remove Item',
        deletingCatalogItem
            ? `Permanently delete <strong>${escHtml(rec.name)}</strong>?<br><small>This also removes its inventory records from every store.</small>`
            : `Remove <strong>${escHtml(rec.name)}</strong> from this store?<br><small>The item itself will remain in the catalog.</small>`,
        'danger',
        async () => {
            try {
                const endpoint = deletingCatalogItem
                    ? `/api/inventory/items/${rec.id}`
                    : `/api/inventory/store-inventory/${normId || invId}`;
                const res = await fetch(endpoint, { method: 'DELETE' });
                const data = await res.json();
                if (!res.ok) {
                    invToast(data.error || 'Delete failed.', 'error');
                } else {
                    invToast(deletingCatalogItem ? 'Item deleted.' : 'Item removed from this store.', 'success');
                    await loadItems();
                    INV.selectedStoreId ? loadInventory(INV.selectedStoreId) : loadAllItems();
                }
            } catch (e) {
                invToast('Network error.', 'error');
            }
        }
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// ITEM CATALOG CRUD (Global Item Management)
// ═══════════════════════════════════════════════════════════════════════════
function openItemCatalogModal() {
    renderItemCatalog();
    openModal('itemCatalogModal');
}

function renderItemCatalog() {
    const tbody = document.getElementById('itemCatalogTbody');
    if (!tbody) return;
    if (INV.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--text-muted);">No items in catalog yet.</td></tr>`;
        return;
    }
    tbody.innerHTML = INV.items.map(it => `
        <tr>
            <td><strong>${escHtml(it.name)}</strong></td>
            <td>${it.category ? `<span class="inv-category-badge">${escHtml(it.category)}</span>` : '—'}</td>
            <td><span class="inv-unit-badge">${escHtml(it.unit || 'pcs')}</span></td>
            <td>
                <div style="display:flex;gap:6px;">
                    <button class="btn-inv-edit" onclick="openEditItemCatalogModal(${it.id})"><i class="fa-solid fa-pen"></i> Edit</button>
                    <button class="btn-inv-delete" onclick="confirmDeleteItem(${it.id})"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        </tr>
    `).join('');
}

let editingCatalogItemId = null;

function openNewItemCatalogModal() {
    editingCatalogItemId = null;
    document.getElementById('catalogItemModalTitle').textContent = 'Create New Item';
    document.getElementById('catItemName').value = '';
    document.getElementById('catItemCategory').value = '';
    document.getElementById('catItemUnit').value = 'pcs';
    document.getElementById('catItemDesc').value = '';
    invClearErrors('catalogItemForm');
    closeModal('itemCatalogModal');
    openModal('catalogItemModal');
}

function openEditItemCatalogModal(itemId) {
    const item = INV.items.find(i => i.id === itemId);
    if (!item) return;
    editingCatalogItemId = itemId;
    document.getElementById('catalogItemModalTitle').textContent = 'Edit Item';
    document.getElementById('catItemName').value = item.name;
    document.getElementById('catItemCategory').value = item.category || '';
    document.getElementById('catItemUnit').value = item.unit || 'pcs';
    document.getElementById('catItemDesc').value = item.description || '';
    invClearErrors('catalogItemForm');
    closeModal('itemCatalogModal');
    openModal('catalogItemModal');
}

async function saveCatalogItem() {
    invClearErrors('catalogItemForm');
    const name     = document.getElementById('catItemName').value.trim();
    const category = document.getElementById('catItemCategory').value.trim();
    const unit     = document.getElementById('catItemUnit').value.trim() || 'pcs';
    const description = document.getElementById('catItemDesc').value.trim();

    // Auto-generate SKU
    const sku = 'AUTO-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

    let valid = true;
    if (!name) { invShowError('catItemName', 'catItemNameErr', 'Item name is required.'); valid = false; }
    if (!valid) return;

    const btn = document.getElementById('btnSaveCatalogItem');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    try {
        const url    = editingCatalogItemId ? `/api/inventory/items/${editingCatalogItemId}` : '/api/inventory/items';
        const method = editingCatalogItemId ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, sku, category, unit, description })
        });
        const data = await res.json();
        if (!res.ok) {
            invToast(data.error || 'Save failed.', 'error');
        } else {
            invToast(editingCatalogItemId ? 'Item updated.' : 'Item created.', 'success');
            closeModal('catalogItemModal');
            await loadItems();
            openItemCatalogModal();
            if (INV.selectedStoreId) loadInventory(INV.selectedStoreId);
            updateStats();
        }
    } catch (e) {
        invToast('Network error.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Item';
    }
}

function confirmDeleteItem(itemId) {
    const item = INV.items.find(i => i.id === itemId);
    if (!item) return;
    showConfirm(
        'Delete Item',
        `Permanently delete <strong>${escHtml(item.name)}</strong>?<br><small>All inventory records for this item across all stores will also be removed.</small>`,
        'danger',
        async () => {
            try {
                const res = await fetch(`/api/inventory/items/${itemId}`, { method: 'DELETE' });
                const data = await res.json();
                if (!res.ok) {
                    invToast(data.error || 'Delete failed.', 'error');
                } else {
                    invToast('Item deleted.', 'success');
                    await loadItems();
                    INV.selectedStoreId ? loadInventory(INV.selectedStoreId) : loadAllItems();
                    updateStats();
                }
            } catch (e) {
                invToast('Network error.', 'error');
            }
        }
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════════════════════
let _confirmCallback = null;

function showConfirm(title, bodyHtml, type, callback) {
    _confirmCallback = callback;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmBody').innerHTML = bodyHtml;
    const iconEl = document.getElementById('confirmIcon');
    iconEl.className = `inv-confirm-icon ${type}`;
    if (type === 'danger')  iconEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    if (type === 'warning') iconEl.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
    openModal('confirmModal');
}

function doConfirm() {
    closeModal('confirmModal');
    if (_confirmCallback) _confirmCallback();
    _confirmCallback = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function openModal(id) {
    const overlay = document.getElementById(id);
    if (overlay) overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal(id) {
    const overlay = document.getElementById(id);
    if (overlay) overlay.classList.remove('active');
    // Only restore scroll if no other modals open
    if (document.querySelectorAll('.inv-modal-overlay.active').length === 0) {
        document.body.style.overflow = '';
    }
}

// Close on backdrop click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('inv-modal-overlay')) {
        e.target.classList.remove('active');
        if (document.querySelectorAll('.inv-modal-overlay.active').length === 0) {
            document.body.style.overflow = '';
        }
    }
});

// Escape key to close modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.inv-modal-overlay.active').forEach(m => m.classList.remove('active'));
        document.body.style.overflow = '';
    }
});

// ── Utility ───────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
