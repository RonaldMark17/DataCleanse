/**
 * DataCleanse & Applied Analytics Studio - Client JavaScript Logic
 */

let state = {
    datasetName: "",
    totalRows: 0,
    totalCols: 0,
    columns: [],
    numericColumns: [],
    categoricalColumns: [],
    currentPage: 1,
    perPage: 15,
    totalPages: 1,
    searchQuery: "",
    sortBy: "",
    sortDir: "asc"
};

// Global Chart instance references & 3D state
let missingValuesChartInstance = null;
let trendChartInstance = null;
let demoChartsMap = {};
let cachedTrendData = null;
let trend3DCameraState = { eye: { x: 1.5, y: 1.5, z: 1.25 } };

// Global Theme Toggle Management
function initTheme() {
    const savedTheme = localStorage.getItem('appTheme') || 'dark';
    applyTheme(savedTheme);
}

function applyTheme(theme) {
    const icon = document.getElementById('themeIcon');
    const text = document.getElementById('themeText');
    if (theme === 'light') {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
        if (icon) icon.className = 'fa-solid fa-sun text-amber';
        if (text) text.innerText = 'Light';
    } else {
        document.body.classList.remove('light-theme');
        document.body.classList.add('dark-theme');
        if (icon) icon.className = 'fa-solid fa-moon text-indigo';
        if (text) text.innerText = 'Dark';
    }
    localStorage.setItem('appTheme', theme);
}

function toggleTheme() {
    const currentTheme = document.body.classList.contains('light-theme') ? 'light' : 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);

    // Re-render active charts with updated theme colors
    if (missingValuesChartInstance) loadOverview();
    if (trendChartInstance) renderTrendChart();
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadOverview();
});

// ==========================================
// Navigation & Tab Management
// ==========================================
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('.wizard-step').forEach(step => step.classList.remove('active'));

    const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
    if (activeBtn) activeBtn.classList.add('active');

    const activeContent = document.getElementById(`tab-${tabId}`);
    if (activeContent) activeContent.classList.add('active');

    // Highlight wizard step
    const stepMap = { 'overview': 'step1', 'cleaning': 'step2', 'correlation': 'step3', 'survival': 'step4', 'explorer': 'step5' };
    if (stepMap[tabId]) {
        const stepEl = document.getElementById(stepMap[tabId]);
        if (stepEl) stepEl.classList.add('active');
    }

    // Trigger tab-specific initialization
    if (tabId === 'overview') {
        loadOverview();
    } else if (tabId === 'cleaning') {
        loadCleaningTab();
    } else if (tabId === 'correlation') {
        loadCorrelationMatrix();
    } else if (tabId === 'survival') {
        loadDemographicsAndSurvival();
    } else if (tabId === 'explorer') {
        loadRecords();
    }
}

async function triggerAutoClean() {
    try {
        const overviewRes = await fetch('/api/overview');
        const overviewData = await overviewRes.json();

        if (!overviewData.has_data) {
            alert("Please upload a file first before cleaning data!");
            return;
        }

        const missingStrategies = {};
        overviewData.audit.columns.forEach(col => {
            if (col.missing_count > 0) {
                if (overviewData.numeric_columns.includes(col.column)) {
                    missingStrategies[col.column] = "median";
                } else {
                    missingStrategies[col.column] = "mode";
                }
            }
        });

        const payload = {
            remove_duplicates: true,
            missing_strategies: missingStrategies,
            clip_outliers: overviewData.numeric_columns
        };

        const res = await fetch('/api/clean', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            const logList = document.getElementById('cleaningLogList');
            logList.innerHTML = data.logs.map(log => `<li><i class="fa-solid fa-check text-emerald"></i> ${log}</li>`).join('');
            alert("Data Cleaning Operation Complete: Duplicate records removed, missing values imputed, and numerical outliers processed successfully.");
            switchTab('overview');
        }
    } catch (err) {
        alert("Auto-clean error: " + err.message);
    }
}

// ==========================================
// File Upload & Drag-and-Drop Handlers
// ==========================================
function triggerFileInput() {
    document.getElementById('fileUploadInput').click();
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    const hero = document.getElementById('uploadDropzoneHero');
    if (hero) hero.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    const hero = document.getElementById('uploadDropzoneHero');
    if (hero) hero.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const hero = document.getElementById('uploadDropzoneHero');
    if (hero) hero.classList.remove('drag-over');

    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
        uploadSingleFile(files[0]);
    }
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (file) {
        uploadSingleFile(file);
    }
}

async function uploadSingleFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.error) {
            alert("Upload Error: " + data.error);
        } else {
            alert(`File "${data.filename}" imported successfully (${data.rows} rows, ${data.columns} columns)!`);
            switchTab('overview');
        }
    } catch (err) {
        alert("Failed to upload file: " + err.message);
    }
}

async function confirmClearDataset() {
    if (!state.datasetName || state.datasetName === "No File Uploaded") return;
    const confirmMsg = `Are you sure you want to remove the imported dataset "${state.datasetName}"?\n\nThis will clear the current session and return to the upload dropzone.`;
    if (confirm(confirmMsg)) {
        await clearDataset();
    }
}

async function clearDataset() {
    try {
        const res = await fetch('/api/clear', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            state.datasetName = "No File Uploaded";
            state.totalRows = 0;
            state.totalCols = 0;
            state.columns = [];
            state.numericColumns = [];
            state.categoricalColumns = [];
            state.currentPage = 1;

            const fileInput = document.getElementById('fileUploadInput');
            if (fileInput) fileInput.value = '';

            await loadOverview();
        }
    } catch (err) {
        alert("Failed to remove dataset: " + err.message);
    }
}

// ==========================================
// Tab 1: Overview & Data Audit
// ==========================================
async function loadOverview() {
    try {
        const res = await fetch('/api/overview');
        const data = await res.json();

        state.datasetName = data.dataset_name;
        state.columns = data.column_names;
        state.numericColumns = data.numeric_columns;
        state.categoricalColumns = data.categorical_columns;

        document.getElementById('activeDatasetName').innerText = data.dataset_name;
        document.getElementById('activeDatasetRows').innerText = `${data.audit.total_rows} Rows`;

        const dropzone = document.getElementById('uploadDropzoneHero');
        const btnRemove = document.getElementById('btnRemoveDataset');
        if (data.has_data) {
            if (dropzone) dropzone.style.display = 'none';
            if (btnRemove) btnRemove.style.display = 'inline-flex';
        } else {
            if (dropzone) dropzone.style.display = 'block';
            if (btnRemove) btnRemove.style.display = 'none';
        }

        // Update Top Metric Cards
        document.getElementById('statTotalRows').innerText = data.audit.total_rows.toLocaleString();
        document.getElementById('statTotalCols').innerText = data.audit.total_columns;
        document.getElementById('statMissingCells').innerText = data.audit.total_missing_cells;
        document.getElementById('statDuplicateRows').innerText = data.audit.duplicate_rows;
        document.getElementById('statQualityScore').innerText = `${data.audit.quality_score}%`;

        // Render Automated Insights
        const insightsContainer = document.getElementById('insightsContainer');
        insightsContainer.innerHTML = data.insights.map(item => `
            <div class="insight-item">
                ${formatMarkdownBold(item)}
            </div>
        `).join('');

        // Render Missing Values Bar Chart
        renderMissingValuesChart(data.audit.columns);

        // Render Audit Table
        const tbody = document.getElementById('auditTableBody');
        tbody.innerHTML = data.audit.columns.map(col => `
            <tr>
                <td><strong>${col.column}</strong></td>
                <td><code class="badge-type">${col.dtype}</code></td>
                <td class="${col.missing_count > 0 ? 'text-amber' : ''}">${col.missing_count}</td>
                <td>${col.missing_pct}%</td>
                <td>${col.unique_count}</td>
                <td>${col.outliers_count > 0 ? `<span class="text-rose">${col.outliers_count}</span>` : '0'}</td>
                <td><small class="text-muted">${col.sample_values.join(', ')}</small></td>
            </tr>
        `).join('');

    } catch (err) {
        console.error("Overview error:", err);
    }
}

function getChartTextColor() {
    return document.body.classList.contains('light-theme') ? '#334155' : '#cbd5e1';
}

function getChartMutedColor() {
    return document.body.classList.contains('light-theme') ? '#64748b' : '#94a3b8';
}

function getChartGridColor() {
    return document.body.classList.contains('light-theme') ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
}

function formatMarkdownBold(text) {
    let formatted = text.replace(/\[High Quality \((.*?)\)\]/g, '<span class="insight-badge badge-emerald"><i class="fa-solid fa-circle-check"></i> High Quality $1</span>');
    formatted = formatted.replace(/\[Moderate Quality \((.*?)\)\]/g, '<span class="insight-badge badge-amber"><i class="fa-solid fa-triangle-exclamation"></i> Quality $1</span>');
    formatted = formatted.replace(/\[Low Quality \((.*?)\)\]/g, '<span class="insight-badge badge-rose"><i class="fa-solid fa-circle-exclamation"></i> Low Quality $1</span>');
    formatted = formatted.replace(/\[Structure\]/g, '<span class="insight-badge badge-indigo"><i class="fa-solid fa-database"></i> Structure</span>');
    formatted = formatted.replace(/\[Covariance\]/g, '<span class="insight-badge badge-blue"><i class="fa-solid fa-link"></i> Covariance</span>');
    formatted = formatted.replace(/\[Demographics\]/g, '<span class="insight-badge badge-purple"><i class="fa-solid fa-users"></i> Demographics</span>');
    formatted = formatted.replace(/\[Upload Required\]/g, '<span class="insight-badge badge-amber"><i class="fa-solid fa-cloud-arrow-up"></i> Upload Required</span>');
    formatted = formatted.replace(/\[(.*?)]/g, '<span class="insight-badge badge-slate">$1</span>');
    return formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

function renderMissingValuesChart(columns) {
    const ctx = document.getElementById('missingValuesChart').getContext('2d');
    
    if (missingValuesChartInstance) {
        missingValuesChartInstance.destroy();
    }

    if (!columns || columns.length === 0) {
        return;
    }

    const labels = columns.map(c => c.column);
    const missingCounts = columns.map(c => c.missing_count);
    const missingPcts = columns.map(c => c.missing_pct);
    const colsWithMissing = columns.filter(c => c.missing_count > 0).length;
    const totalMissing = missingCounts.reduce((a, b) => a + b, 0);

    const badge = document.getElementById('missingSummaryBadge');
    if (badge) {
        if (totalMissing === 0) {
            badge.innerHTML = `<i class="fa-solid fa-circle-check text-emerald"></i> 100% Complete (0 Missing)`;
        } else {
            badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-amber"></i> ${colsWithMissing} Column(s) Need Cleaning`;
        }
    }

    const backgroundColors = missingCounts.map(c => c > 0 ? 'rgba(245, 158, 11, 0.85)' : 'rgba(99, 102, 241, 0.4)');
    const borderColors = missingCounts.map(c => c > 0 ? '#f59e0b' : '#6366f1');

    missingValuesChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Missing Values',
                data: missingCounts,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 10,
                    bottom: 15,
                    left: 10,
                    right: 10
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const idx = context.dataIndex;
                            const count = missingCounts[idx];
                            const pct = missingPcts[idx];
                            return `Missing: ${count} cells (${pct}%)`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: getChartMutedColor(),
                        precision: 0
                    },
                    grid: { color: getChartGridColor() }
                },
                x: {
                    ticks: {
                        color: getChartTextColor(),
                        font: { size: 11, weight: '600' },
                        autoSkip: false,
                        maxRotation: columns.length > 6 ? 45 : 0,
                        minRotation: columns.length > 6 ? 45 : 0
                    },
                    grid: { display: false }
                }
            }
        }
    });
}

// ==========================================
// Tab 2: Data Cleaning & DB Prep
// ==========================================
async function loadCleaningTab() {
    try {
        const res = await fetch('/api/overview');
        const data = await res.json();
        
        const container = document.getElementById('missingStrategiesContainer');
        container.innerHTML = data.audit.columns.map(col => {
            if (col.missing_count === 0) return '';
            return `
                <div class="strategy-row">
                    <span>${col.column} (${col.missing_count} missing)</span>
                    <select class="form-control-sm" name="missing_${col.column}">
                        <option value="none">No Action</option>
                        <option value="drop">Drop Rows with Nulls</option>
                        ${data.numeric_columns.includes(col.column) ? '<option value="mean">Impute Mean</option>' : ''}
                        ${data.numeric_columns.includes(col.column) ? '<option value="median">Impute Median</option>' : ''}
                        <option value="mode">Impute Mode</option>
                        ${data.numeric_columns.includes(col.column) ? '<option value="zero">Fill 0</option>' : ''}
                        <option value="constant">Fill "Unknown"</option>
                    </select>
                </div>
            `;
        }).join('') || '<div class="text-muted" style="font-size:0.85rem;">No missing values detected in current dataset!</div>';

        const outlierContainer = document.getElementById('outlierClippingContainer');
        outlierContainer.innerHTML = data.numeric_columns.map(col => `
            <label class="checkbox-card">
                <input type="checkbox" name="clip_${col}">
                <span>Clip outliers (1%-99%): <strong>${col}</strong></span>
            </label>
        `).join('');

    } catch (err) {
        console.error("Cleaning tab error:", err);
    }
}

async function applyDataCleaning(e) {
    e.preventDefault();
    const removeDuplicates = document.getElementById('chkRemoveDuplicates').checked;
    
    const missingStrategies = {};
    const selectEls = document.querySelectorAll('#missingStrategiesContainer select');
    selectEls.forEach(sel => {
        const colName = sel.name.replace('missing_', '');
        if (sel.value !== 'none') {
            missingStrategies[colName] = sel.value;
        }
    });

    const clipOutliers = [];
    const clipInputs = document.querySelectorAll('#outlierClippingContainer input[type="checkbox"]:checked');
    clipInputs.forEach(inp => {
        clipOutliers.push(inp.name.replace('clip_', ''));
    });

    const payload = {
        remove_duplicates: removeDuplicates,
        missing_strategies: missingStrategies,
        clip_outliers: clipOutliers
    };

    try {
        const res = await fetch('/api/clean', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.success) {
            const logList = document.getElementById('cleaningLogList');
            logList.innerHTML = data.logs.map(log => `<li><i class="fa-solid fa-check text-emerald"></i> ${log}</li>`).join('');
            alert("Data cleaning transformations applied successfully!");
        }
    } catch (err) {
        alert("Cleaning error: " + err.message);
    }
}

// ==========================================
// Tab 3: Correlation Analysis & Heatmap
// ==========================================
async function loadCorrelationMatrix() {
    const method = document.getElementById('corrMethodSelect').value || 'pearson';
    try {
        const res = await fetch(`/api/correlation?method=${method}`);
        const data = await res.json();

        if (data.error) {
            document.getElementById('heatmapGridContainer').innerHTML = `<div class="text-amber">${data.error}</div>`;
            return;
        }

        renderHeatmapGrid(data);

        const pairsContainer = document.getElementById('topCorrelationsContainer');
        pairsContainer.innerHTML = data.top_correlations.map(pair => {
            const isPos = pair.correlation >= 0;
            const absVal = Math.abs(pair.correlation);
            const badgeClass = absVal >= 0.6 ? (isPos ? 'badge-emerald' : 'badge-rose') : (absVal >= 0.3 ? 'badge-indigo' : 'badge-slate');
            const icon = isPos ? '<i class="fa-solid fa-arrow-trend-up"></i>' : '<i class="fa-solid fa-arrow-trend-down"></i>';
            return `
                <div class="corr-pair-card">
                    <div class="corr-pair-vars">
                        <strong>${pair.var1}</strong> <i class="fa-solid fa-link text-muted" style="font-size:0.8rem;"></i> <strong>${pair.var2}</strong>
                    </div>
                    <span class="badge ${badgeClass}">${icon} r = ${isPos ? '+' : ''}${pair.correlation} (${pair.strength})</span>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error("Correlation error:", err);
    }
}

function renderHeatmapGrid(data) {
    const cols = data.columns;
    const matrix = data.matrix;

    let html = `<table class="heatmap-table"><thead><tr><th></th>`;
    cols.forEach(c => { html += `<th>${c}</th>`; });
    html += `</tr></thead><tbody>`;

    cols.forEach(row => {
        html += `<tr><th>${row}</th>`;
        cols.forEach(col => {
            const val = matrix[row][col];
            const bg = getHeatmapColor(val);
            const textColor = Math.abs(val) > 0.4 ? '#fff' : '#94a3b8';
            html += `<td class="heatmap-cell" style="background-color: ${bg}; color: ${textColor};" title="${row} vs ${col}: ${val}">${val}</td>`;
        });
        html += `</tr>`;
    });

    html += `</tbody></table>`;
    document.getElementById('heatmapGridContainer').innerHTML = html;
}

function getHeatmapColor(val) {
    if (val > 0) {
        // Indigo / Emerald gradient
        const alpha = Math.min(1, Math.abs(val));
        return `rgba(99, 102, 241, ${0.15 + alpha * 0.75})`;
    } else if (val < 0) {
        // Rose gradient
        const alpha = Math.min(1, Math.abs(val));
        return `rgba(244, 63, 94, ${0.15 + alpha * 0.75})`;
    }
    return 'rgba(255, 255, 255, 0.05)';
}

// ==========================================
// Tab 4: Universal Trend & Demographic Analytics
// ==========================================
async function loadDemographicsAndSurvival() {
    try {
        const overviewRes = await fetch('/api/overview');
        const overviewData = await overviewRes.json();

        const xSel = document.getElementById('selTrendXCol');
        const ySel = document.getElementById('selTrendYCol');

        if (xSel && ySel && overviewData.column_names) {
            xSel.innerHTML = overviewData.column_names.map(c => `<option value="${c}">${c}</option>`).join('');
            
            const numCols = overviewData.numeric_columns.length > 0 ? overviewData.numeric_columns : overviewData.column_names;
            ySel.innerHTML = numCols.map(c => `<option value="${c}">${c}</option>`).join('');

            // Select smart defaults
            if (overviewData.column_names.length >= 1) xSel.value = overviewData.column_names[0];
            if (numCols.length >= 1) ySel.value = numCols[0];

            // If x and y are identical and we have alternatives, pick a different y
            if (xSel.value === ySel.value && numCols.length >= 2) {
                const alt = numCols.find(c => c !== xSel.value);
                if (alt) ySel.value = alt;
            }
        }

        computeTrendAnalysis(new Event('submit'));
        loadCategoricalDemographics();

    } catch (err) {
        console.error("Trends tab load error:", err);
    }
}

async function computeTrendAnalysis(e) {
    if (e && e.preventDefault) e.preventDefault();

    const xCol = document.getElementById('selTrendXCol').value;
    const yCol = document.getElementById('selTrendYCol').value;
    const agg = document.getElementById('selTrendAgg').value || 'sum';

    if (!xCol || !yCol) return;

    try {
        const res = await fetch('/api/trend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                x_col: xCol,
                y_col: yCol,
                aggregation: agg
            })
        });
        const data = await res.json();

        if (!res.ok || data.error) {
            document.getElementById('statTrendN').innerText = '--';
            document.getElementById('statTrendTotal').innerText = '--';
            document.getElementById('statTrendAvg').innerText = '--';
            console.warn("Trend Analysis Note:", data.error || res.statusText);
            return;
        }

        cachedTrendData = data;
        document.getElementById('statTrendN').innerText = data.sample_size ? data.sample_size.toLocaleString() : '--';
        document.getElementById('statTrendTotal').innerText = data.total_value !== undefined ? data.total_value.toLocaleString() : '--';
        document.getElementById('statTrendAvg').innerText = data.average_value !== undefined ? data.average_value.toLocaleString() : '--';

        renderTrendChart();

    } catch (err) {
        console.error("Trend compute error:", err);
    }
}

function renderTrendChart() {
    if (!cachedTrendData || !cachedTrendData.data) return;

    const ctx = document.getElementById('trendChart').getContext('2d');
    if (trendChartInstance) {
        trendChartInstance.destroy();
    }

    const chartType = document.getElementById('selTrendChartType').value || 'line';
    const isArea = chartType === 'area';
    const actualChartType = (chartType === 'area' || chartType === 'line') ? 'line' : 'bar';

    const labels = cachedTrendData.data.map(d => d.x);
    const values = cachedTrendData.data.map(d => d.y);

    trendChartInstance = new Chart(ctx, {
        type: actualChartType,
        data: {
            labels: labels,
            datasets: [{
                label: `${cachedTrendData.aggregation.toUpperCase()}(${cachedTrendData.y_col})`,
                data: values,
                borderColor: '#6366f1',
                backgroundColor: isArea ? 'rgba(99, 102, 241, 0.25)' : (actualChartType === 'bar' ? 'rgba(99, 102, 241, 0.75)' : '#6366f1'),
                fill: isArea,
                tension: 0.3,
                borderRadius: actualChartType === 'bar' ? 4 : 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, labels: { color: getChartTextColor() } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: cachedTrendData.x_col, color: getChartMutedColor() },
                    ticks: { color: getChartTextColor() },
                    grid: { color: getChartGridColor() }
                },
                y: {
                    title: { display: true, text: `${cachedTrendData.aggregation.toUpperCase()} of ${cachedTrendData.y_col}`, color: getChartMutedColor() },
                    beginAtZero: true,
                    ticks: { color: getChartTextColor() },
                    grid: { color: getChartGridColor() }
                }
            }
        }
    });
}

function downloadTrendPlotImage() {
    const canvas = document.getElementById('trendChart');
    if (!canvas || !trendChartInstance) {
        alert("No trend plot available to download!");
        return;
    }

    const imageURI = canvas.toDataURL('image/png', 1.0);
    const link = document.createElement('a');
    const xName = cachedTrendData ? cachedTrendData.x_col : 'x';
    const yName = cachedTrendData ? cachedTrendData.y_col : 'y';
    link.download = `trend_plot_${xName}_vs_${yName}.png`;
    link.href = imageURI;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

let cachedDemographicsData = null;

async function loadCategoricalDemographics() {
    try {
        const res = await fetch('/api/demographics');
        const data = await res.json();
        cachedDemographicsData = data;

        // Populate Demographic Column Dropdown
        const selCol = document.getElementById('selDemographicCol');
        if (selCol && data.categorical_distributions) {
            const keys = Object.keys(data.categorical_distributions);
            selCol.innerHTML = `<option value="all">-- Show All Categories (${keys.length}) --</option>` +
                keys.map(k => `<option value="${k}">${k}</option>`).join('');
        }

        // Populate Numeric Summary Table Body
        const numTableBody = document.getElementById('numericSummaryTableBody');
        if (numTableBody && data.numeric_summary) {
            if (data.numeric_summary.length === 0) {
                numTableBody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">No numeric columns found in current dataset.</td></tr>`;
            } else {
                numTableBody.innerHTML = data.numeric_summary.map(row => `
                    <tr>
                        <td><strong>${row.column}</strong></td>
                        <td>${row.count}</td>
                        <td>${row.mean}</td>
                        <td>${row.std}</td>
                        <td>${row.median}</td>
                        <td>${row.min}</td>
                        <td>${row.max}</td>
                        <td>${row.q25}</td>
                        <td>${row.q75}</td>
                        <td>${row.skewness}</td>
                    </tr>
                `).join('');
            }
        }

        renderSelectedDemographics();

    } catch (err) {
        console.error("Demographics load error:", err);
    }
}

function renderSelectedDemographics() {
    if (!cachedDemographicsData || !cachedDemographicsData.categorical_distributions) return;

    const selectedCol = document.getElementById('selDemographicCol').value || 'all';
    const chartType = document.getElementById('selDemographicChartType').value || 'doughnut';

    const grid = document.getElementById('demographicsChartsGrid');
    grid.innerHTML = '';

    // Destroy existing demo charts
    Object.values(demoChartsMap).forEach(chart => {
        if (chart && typeof chart.destroy === 'function') chart.destroy();
    });
    demoChartsMap = {};

    let distsToRender = {};
    if (selectedCol === 'all') {
        distsToRender = cachedDemographicsData.categorical_distributions;
    } else if (cachedDemographicsData.categorical_distributions[selectedCol]) {
        distsToRender[selectedCol] = cachedDemographicsData.categorical_distributions[selectedCol];
    }

    const keys = Object.keys(distsToRender);
    if (keys.length === 0) {
        grid.innerHTML = `<div class="text-muted p-3">No categorical columns available for demographic breakdown.</div>`;
        return;
    }

    for (const colName of keys) {
        const chartBoxId = `demo_chart_${colName.replace(/\s+/g, '_')}`;
        grid.innerHTML += `
            <div class="demo-chart-box">
                <h4><i class="fa-solid fa-chart-pie text-indigo"></i> Demographic Breakdown: ${colName}</h4>
                <div class="demo-chart-canvas-container" style="height: 220px; position: relative;">
                    <canvas id="${chartBoxId}"></canvas>
                </div>
            </div>
        `;
    }

    setTimeout(() => {
        const colors = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];
        for (const [colName, dist] of Object.entries(distsToRender)) {
            const chartBoxId = `demo_chart_${colName.replace(/\s+/g, '_')}`;
            const canvasEl = document.getElementById(chartBoxId);
            if (canvasEl) {
                const ctx = canvasEl.getContext('2d');
                
                const sliceColors = colors.slice(0, dist.length);
                const isPieOrDonut = chartType === 'doughnut' || chartType === 'pie';

                let datasetConfig = {
                    label: 'Record Count',
                    data: dist.map(d => d.count),
                    backgroundColor: sliceColors,
                    borderColor: isPieOrDonut ? 'rgba(255, 255, 255, 0.25)' : sliceColors,
                    borderWidth: isPieOrDonut ? 2 : 1,
                    borderRadius: chartType === 'bar' ? 6 : 0,
                    hoverOffset: isPieOrDonut ? 16 : 6,
                    spacing: isPieOrDonut ? 4 : 0,
                    offset: isPieOrDonut ? 6 : 0
                };

                let chartConfig = {
                    type: chartType,
                    data: {
                        labels: dist.map(d => d.category),
                        datasets: [datasetConfig]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: chartType === 'doughnut' ? '55%' : 0,
                        plugins: {
                            legend: {
                                display: true,
                                position: chartType === 'bar' ? 'top' : 'right',
                                labels: {
                                    color: getChartTextColor(),
                                    font: { size: 11, weight: '600' },
                                    usePointStyle: true,
                                    pointStyle: 'circle',
                                    padding: 12
                                }
                            },
                            tooltip: {
                                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                                titleFont: { size: 12, weight: 'bold' },
                                bodyFont: { size: 12 },
                                cornerRadius: 8,
                                padding: 10
                            }
                        }
                    }
                };

                if (chartType === 'bar') {
                    chartConfig.options.scales = {
                        y: { beginAtZero: true, ticks: { color: getChartMutedColor() }, grid: { color: getChartGridColor() } },
                        x: { ticks: { color: getChartTextColor() }, grid: { display: false } }
                    };
                }

                demoChartsMap[colName] = new Chart(ctx, chartConfig);
            }
        }
    }, 50);
}

// ==========================================
// Tab 5: Record Explorer & Paginated Table
// ==========================================
async function loadRecords() {
    try {
        const url = `/api/records?page=${state.currentPage}&per_page=${state.perPage}&search=${encodeURIComponent(state.searchQuery)}&sort_by=${state.sortBy}&sort_dir=${state.sortDir}`;
        const res = await fetch(url);
        const data = await res.json();

        if (!res.ok || data.error) {
            console.warn("Records load note:", data.error || res.statusText);
            return;
        }

        state.totalPages = data.total_pages;

        document.getElementById('lblPage').innerText = data.page;
        document.getElementById('lblTotalPages').innerText = data.total_pages;
        document.getElementById('lblTotalRecords').innerText = data.total_records ? data.total_records.toLocaleString() : '0';

        // Render Table Header
        const thead = document.getElementById('recordsTableHeader');
        thead.innerHTML = `
            <tr>
                ${data.columns.map(col => `
                    <th style="cursor:pointer;" onclick="sortByColumn('${col}')">
                        ${col} ${state.sortBy === col ? (state.sortDir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                `).join('')}
            </tr>
        `;

        // Render Table Rows
        const tbody = document.getElementById('recordsTableBody');
        if (data.records.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${data.columns.length}" class="text-center text-muted" style="padding:20px;">No matching records found.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.records.map(row => `
            <tr>
                ${data.columns.map(col => `<td>${row[col] !== null ? row[col] : '<span class="text-muted">null</span>'}</td>`).join('')}
            </tr>
        `).join('');

    } catch (err) {
        console.error("Records load error:", err);
    }
}

function handleSearchKeyUp(event) {
    state.searchQuery = event.target.value;
    state.currentPage = 1;
    loadRecords();
}

function sortByColumn(col) {
    if (state.sortBy === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        state.sortBy = col;
        state.sortDir = 'asc';
    }
    loadRecords();
}

function changePage(delta) {
    const newPage = state.currentPage + delta;
    if (newPage >= 1 && newPage <= state.totalPages) {
        state.currentPage = newPage;
        loadRecords();
    }
}
