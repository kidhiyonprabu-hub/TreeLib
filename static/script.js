"use strict";

const state = {
  demo: false,
  books: [],
  categories: [],
  page: 1,
  pages: 1,
  sortDirection: "asc",
  labTree: null,
  labNodeId: -1,
  highlighted: [],
  categoryChart: null,
  availabilityChart: null,
  pendingDeleteId: null,
  discoveryOffset: 0,
  treeZoom: 1,
  treeWidth: 0,
  traversalTimer: null,
  traversalItems: [],
  traversalIndex: 0,
};
let treeResizeFrame = 0;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const safeText = (tag, text, className) => {
  const element = document.createElement(tag);
  element.textContent = text == null ? "" : String(text);
  if (className) element.className = className;
  return element;
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response.");
  }
  if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
  return payload;
}

function toast(message, type = "success") {
  const toastRegion = $("#toastRegion");
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  const icon = safeText("span", type === "success" ? "✓" : "!", "toast-symbol");
  const text = safeText("span", message);
  item.append(icon, text);
  toastRegion.append(item);
  window.setTimeout(() => item.remove(), 3800);
}

function setLoading(button, loading, label) {
  if (!button) return;
  if (loading) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label || "Working…";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
    delete button.dataset.originalLabel;
  }
}

function demoQuery() {
  return state.demo ? "?demo=1" : "";
}

function renderStats(data) {
  $("#totalStat").textContent = data.total;
  $("#availableStat").textContent = data.available;
  $("#issuedStat").textContent = data.issued;
  $("#categoryStat").textContent = Object.keys(data.categories).length;
  const canGrow = data.growth_available && !state.demo;
  $("#catalogGrowth").hidden = !canGrow;
  $("#discoveryGrid").closest(".discovery-panel").classList.toggle("full-width", !canGrow);
  $("#growthMessage").textContent = canGrow
    ? `Add illustrative sample titles across ${data.catalog_category_count} categories. Your existing books stay safe.`
    : state.demo
      ? "Explore sample picks from the demo library. Your saved collection stays untouched."
      : `Your collection has reached ${data.total} books across ${Object.keys(data.categories).length} categories. Keep exploring the smart shelf below.`;
  renderCharts(data);
  renderActivities(data.activities);
}

function renderCharts(data) {
  const labels = Object.keys(data.categories);
  const values = labels.map(label => data.categories[label]);
  const categoryCanvas = $("#categoryChart");
  const categoryEmpty = $("#categoryEmpty");
  const availabilityCanvas = $("#availabilityChart");
  const availabilityEmpty = $("#availabilityEmpty");
  const categoryChartBox = categoryCanvas.parentElement;

  categoryCanvas.hidden = labels.length === 0;
  categoryEmpty.hidden = labels.length > 0;
  availabilityCanvas.hidden = data.total === 0;
  availabilityEmpty.hidden = data.total > 0;
  categoryChartBox.style.height = `${Math.max(202, labels.length * 22)}px`;
  if (!window.Chart) {
    if (labels.length) categoryEmpty.textContent = labels.map((label, index) => `${label}: ${values[index]}`).join(" · ");
    categoryEmpty.hidden = labels.length === 0;
    if (data.total) availabilityEmpty.textContent = `${data.available} available · ${data.issued} issued`;
    availabilityEmpty.hidden = data.total === 0;
    return;
  }

  const palette = ["#a98afa", "#63d9b4", "#ffba76", "#81b8fb", "#f28ca4", "#d0a6ff", "#83d0e7"];
  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--line").trim();
  const horizontal = labels.length > 10;
  const categoryScales = {
    x: horizontal
      ? { beginAtZero: true, ticks: { color: textColor, precision: 0, font: { size: 9 } }, grid: { color: gridColor }, border: { display: false } }
      : { ticks: { color: textColor, font: { size: 9 } }, grid: { display: false }, border: { display: false } },
    y: horizontal
      ? { ticks: { color: textColor, font: { size: 9 } }, grid: { display: false }, border: { display: false } }
      : { beginAtZero: true, ticks: { color: textColor, precision: 0, font: { size: 9 } }, grid: { color: gridColor }, border: { display: false } },
  };
  if (!state.categoryChart) {
    state.categoryChart = new Chart(categoryCanvas, {
      type: "bar",
      data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderRadius: 6, maxBarThickness: 30 }] },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: categoryScales,
      },
    });
  }
  state.categoryChart.options.indexAxis = horizontal ? "y" : "x";
  state.categoryChart.options.scales = categoryScales;
  state.categoryChart.data.labels = labels;
  state.categoryChart.data.datasets[0].data = values;
  state.categoryChart.data.datasets[0].backgroundColor = labels.map((_, index) => palette[index % palette.length]);
  state.categoryChart.update();
  if (!state.availabilityChart) {
    state.availabilityChart = new Chart(availabilityCanvas, {
      type: "doughnut",
      data: {
        labels: ["Available", "Issued"],
        datasets: [{ data: [0, 0], backgroundColor: ["#63d9b4", "#ffba76"], borderColor: "transparent", borderWidth: 0, hoverOffset: 4 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "70%",
        plugins: { legend: { position: "bottom", labels: { color: textColor, boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 18, font: { size: 9 } } } },
      },
    });
  }
  state.availabilityChart.data.datasets[0].data = [data.available, data.issued];
  state.availabilityChart.options.plugins.legend.labels.color = textColor;
  state.availabilityChart.update();
}

function renderActivities(activities) {
  const list = $("#activityList");
  list.replaceChildren();
  if (!activities.length) {
    list.append(safeText("p", "No activity yet. Add a book or update its status to get started.", "empty-activity"));
    return;
  }
  const glyphs = { Added: "+", Updated: "✎", Deleted: "−", Issued: "↗", Returned: "↙" };
  activities.forEach(activity => {
    const item = document.createElement("div");
    item.className = "activity-item";
    item.append(safeText("span", glyphs[activity.action] || "•", "activity-symbol"));
    const copy = document.createElement("span");
    copy.className = "activity-text";
    copy.append(safeText("strong", activity.book_title), safeText("small", `${activity.action} · ${activity.created_at}`));
    item.append(copy);
    list.append(item);
  });
}

async function loadDashboard() {
  const discoveryQuery = new URLSearchParams({ offset: String(state.discoveryOffset) });
  if (state.demo) discoveryQuery.set("demo", "1");
  const [data, discovery] = await Promise.all([
    api(`/api/dashboard${demoQuery()}`),
    api(`/api/discover?${discoveryQuery.toString()}`),
  ]);
  renderStats(data);
  renderDiscovery(discovery);
}

function renderDiscovery(data) {
  const grid = $("#discoveryGrid");
  grid.replaceChildren();
  if (!data.books.length) {
    const empty = document.createElement("div");
    empty.className = "discovery-empty";
    empty.append(
      safeText("strong", "No available books to recommend yet."),
      safeText("span", "Add a book or return an issued title to refresh your shelf.")
    );
    grid.append(empty);
    return;
  }
  const colors = ["lilac", "teal", "amber"];
  data.books.forEach((book, index) => {
    const card = document.createElement("article");
    card.className = "discovery-card";
    const cover = safeText("div", String(book.category).slice(0, 2).toUpperCase(), `discovery-cover ${colors[index % colors.length]}`);
    const detail = document.createElement("div");
    detail.className = "discovery-detail";
    detail.append(
      safeText("span", book.category, "discovery-category"),
      safeText("strong", book.title),
      safeText("small", book.author),
      safeText("span", `${book.shelf_size} in this category`, "shelf-count")
    );
    const action = safeText("button", "Explore shelf →", "discovery-action");
    action.type = "button";
    action.dataset.discoverCategory = book.category;
    card.append(cover, detail, action);
    grid.append(card);
  });
}

function currentBookFilters() {
  const query = new URLSearchParams({
    search: $("#bookFilter").value.trim(),
    category: $("#categoryFilter").value,
    availability: $("#availabilityFilter").value,
    sort: $("#sortFilter").value,
    direction: state.sortDirection,
    page: String(state.page),
    per_page: "12",
  });
  if (state.demo) query.set("demo", "1");
  return query.toString();
}

async function loadBooks() {
  const data = await api(`/api/books?${currentBookFilters()}`);
  state.books = data.books;
  state.pages = data.pages;
  renderBooks(data);
}

function renderBooks(data) {
  const tbody = $("#bookRows");
  tbody.replaceChildren();
  $("#bookCountLabel").textContent = `${data.total} ${data.total === 1 ? "book" : "books"}`;
  $("#resultsLabel").textContent = data.total ? `Showing ${data.books.length} of ${data.total} books` : "No books found";
  $("#pageLabel").textContent = `${data.page} / ${data.pages}`;
  $("#prevPage").disabled = data.page <= 1;
  $("#nextPage").disabled = data.page >= data.pages;

  if (!data.books.length) {
    const row = document.createElement("tr");
    const cell = safeText("td", $("#bookFilter").value ? "No matching books. Try another search or filter." : "Your library is empty. Add a book or try the sample demo.", "table-empty");
    cell.colSpan = 5;
    row.append(cell);
    tbody.append(row);
    return;
  }
  data.books.forEach(book => {
    const row = document.createElement("tr");
    const bookCell = document.createElement("td");
    bookCell.append(safeText("strong", book.title), safeText("small", `ID #${book.id}`));
    const authorCell = safeText("td", book.author);
    const categoryCell = document.createElement("td");
    categoryCell.append(safeText("span", book.category, "category-tag"));
    const statusCell = document.createElement("td");
    statusCell.append(safeText("span", book.available ? "Available" : "Issued", `status-tag ${book.available ? "status-available" : "status-issued"}`));
    const actions = document.createElement("td");
    const actionGroup = document.createElement("div");
    actionGroup.className = "row-actions";
    const statusButton = safeText("button", book.available ? "Issue" : "Return");
    statusButton.type = "button";
    statusButton.dataset.action = book.available ? "issue" : "return";
    statusButton.dataset.id = book.id;
    statusButton.disabled = state.demo;
    const editButton = safeText("button", "Edit", "edit-action");
    editButton.type = "button";
    editButton.dataset.action = "edit";
    editButton.dataset.id = book.id;
    editButton.disabled = state.demo;
    const deleteButton = safeText("button", "Delete", "delete-action");
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete";
    deleteButton.dataset.id = book.id;
    deleteButton.disabled = state.demo;
    actionGroup.append(statusButton, editButton, deleteButton);
    actions.append(actionGroup);
    row.append(bookCell, authorCell, categoryCell, statusCell, actions);
    tbody.append(row);
  });
}

async function loadCategories() {
  const data = await api(`/api/dashboard${demoQuery()}`);
  state.categories = Object.keys(data.categories);
  const filter = $("#categoryFilter");
  const selected = filter.value;
  filter.replaceChildren(new Option("All categories", ""));
  state.categories.forEach(category => filter.add(new Option(category, category)));
  if (state.categories.includes(selected)) filter.value = selected;
  const datalist = $("#categoryOptions");
  datalist.replaceChildren();
  state.categories.forEach(category => datalist.append(new Option(category, category)));
}

async function loadTree({ keepLab = false } = {}) {
  const data = await api(`/api/bst${demoQuery()}`);
  state.labTree = data.tree;
  state.highlighted = [];
  $("#treeSource").textContent = state.demo ? "SAMPLE DEMO TREE" : "DATABASE TREE";
  $("#rootMetric").textContent = data.tree ? `${data.tree.title} · #${data.tree.id}` : "Empty";
  $("#heightMetric").textContent = data.height;
  $("#nodeMetric").textContent = data.nodes;
  $("#leafMetric").textContent = data.leaves;
  renderTree();
  if (!keepLab) $("#treeMessage").textContent = `Rebuilt from the ${state.demo ? "sample" : "database"} in book ID insertion order.`;
}

function renderTree() {
  cancelTraversal();
  const canvas = $("#treeCanvas");
  canvas.replaceChildren();
  $("#treeNodeDetail").textContent = "Select a tree node to see its title, author, and left/right children.";
  if (!state.labTree) {
    canvas.append(safeText("p", "This tree is empty. Add a book or insert a temporary sample node in the lab.", "tree-empty"));
    state.treeWidth = 0;
    return;
  }
  const SVG_NS = "http://www.w3.org/2000/svg";
  const nodes = [];
  let rank = 0;
  let maxDepth = 0;
  const collect = (node, parent = null, side = "ROOT", depth = 0) => {
    if (!node) return;
    collect(node.left, node, "LEFT", depth + 1);
    const item = { node, parent, side, depth, rank: rank++ };
    nodes.push(item);
    maxDepth = Math.max(maxDepth, depth);
    collect(node.right, node, "RIGHT", depth + 1);
  };
  collect(state.labTree);

  const spacingX = nodes.length > 40 ? 64 : 112;
  const spacingY = 76;
  const padding = 38;
  const width = Math.max(560, nodes.length * spacingX + padding * 2);
  const height = Math.max(160, (maxDepth + 1) * spacingY + padding * 2);
  state.treeWidth = width;
  const positionById = new Map(
    nodes.map(item => [
      Number(item.node.id),
      { x: padding + item.rank * spacingX, y: padding + item.depth * spacingY },
    ])
  );
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("tree-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Binary search tree with ${nodes.length} nodes and ${maxDepth + 1} levels`);

  nodes.forEach(item => {
    if (!item.parent) return;
    const parentPosition = positionById.get(Number(item.parent.id));
    const childPosition = positionById.get(Number(item.node.id));
    const edge = document.createElementNS(SVG_NS, "line");
    edge.classList.add("tree-edge-line");
    edge.setAttribute("x1", String(parentPosition.x));
    edge.setAttribute("y1", String(parentPosition.y + 16));
    edge.setAttribute("x2", String(childPosition.x));
    edge.setAttribute("y2", String(childPosition.y - 16));
    svg.append(edge);
  });

  nodes.forEach(item => {
    const node = item.node;
    const position = positionById.get(Number(node.id));
    const group = document.createElementNS(SVG_NS, "g");
    group.classList.add("tree-svg-node");
    group.dataset.id = String(node.id);
    group.setAttribute("transform", `translate(${position.x} ${position.y})`);
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    group.setAttribute("aria-label", `${item.side === "ROOT" ? "Root" : `${item.side.toLowerCase()} child`}: ${node.title}, ${node.author}`);
    if (item.side === "ROOT") group.classList.add("root-node");
    if (state.highlighted.includes(Number(node.id))) group.classList.add("path-node");
    if (node.temporary) group.classList.add("lab-node");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${item.side === "ROOT" ? "Root" : `${item.side} child`}: ${node.title} · ${node.author}`;
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("r", "17");
    const idLabel = document.createElementNS(SVG_NS, "text");
    idLabel.classList.add("tree-svg-id");
    idLabel.setAttribute("text-anchor", "middle");
    idLabel.setAttribute("dy", "4");
    idLabel.textContent = String(node.id);
    const sideLabel = document.createElementNS(SVG_NS, "text");
    sideLabel.classList.add("tree-svg-side");
    sideLabel.setAttribute("text-anchor", "middle");
    sideLabel.setAttribute("y", "31");
    sideLabel.textContent = item.side;
    group.append(title, circle, idLabel, sideLabel);
    svg.append(group);
  });

  canvas.append(svg);
  applyTreeZoom(true);
  const rootPosition = positionById.get(Number(state.labTree.id));
  showTreeNodeDetail(state.labTree, "ROOT", rootPosition);
}

function applyTreeZoom(fit = false) {
  const canvas = $("#treeCanvas");
  const svg = $(".tree-svg", canvas);
  if (!svg) return;
  if (fit) {
    const viewportWidth = $("#treeViewport").clientWidth || 700;
    state.treeZoom = Math.min(1, Math.max(0.02, (viewportWidth - 44) / state.treeWidth));
  }
  const svgHeight = Number(svg.getAttribute("height"));
  canvas.style.width = `${Math.ceil(state.treeWidth * state.treeZoom)}px`;
  canvas.style.height = `${Math.ceil(svgHeight * state.treeZoom)}px`;
  svg.style.width = `${state.treeWidth * state.treeZoom}px`;
  svg.style.height = `${svgHeight * state.treeZoom}px`;
  if (fit) $("#treeViewport").scrollLeft = 0;
}

function showTreeNodeDetail(node, side = "NODE") {
  if (!node) return;
  const left = node.left ? node.left.title : "None";
  const right = node.right ? node.right.title : "None";
  const position = side === "ROOT" || side.includes("CHILD") ? side : `${side} CHILD`;
  $("#treeNodeDetail").textContent = `${position} · #${node.id} · ${node.title} · ${node.author || "Unknown author"} · Left: ${left} · Right: ${right}`;
}

function findLabNodeById(root, id) {
  const pending = root ? [root] : [];
  while (pending.length) {
    const node = pending.pop();
    if (Number(node.id) === Number(id)) return node;
    if (node.left) pending.push(node.left);
    if (node.right) pending.push(node.right);
  }
  return null;
}

function selectTreeNode(group) {
  const node = findLabNodeById(state.labTree, group.dataset.id);
  if (!node) return;
  $$(".tree-svg-node.selected").forEach(item => item.classList.remove("selected"));
  group.classList.add("selected");
  showTreeNodeDetail(node, node === state.labTree ? "ROOT" : group.querySelector(".tree-svg-side").textContent);
}

function updateLabMetrics() {
  const visit = node => {
    if (!node) return { height: 0, nodes: 0, leaves: 0 };
    const left = visit(node.left);
    const right = visit(node.right);
    return {
      height: 1 + Math.max(left.height, right.height),
      nodes: 1 + left.nodes + right.nodes,
      leaves: (node.left || node.right ? 0 : 1) + left.leaves + right.leaves,
    };
  };
  const metrics = visit(state.labTree);
  $("#rootMetric").textContent = state.labTree ? `${state.labTree.title} · #${state.labTree.id}` : "Empty";
  $("#heightMetric").textContent = metrics.height;
  $("#nodeMetric").textContent = metrics.nodes;
  $("#leafMetric").textContent = metrics.leaves;
}

function compareNodes(first, second) {
  const titleOrder = String(first.title).toLocaleLowerCase().localeCompare(String(second.title).toLocaleLowerCase());
  return titleOrder || Number(first.id) - Number(second.id);
}

function insertLabNode(title, author) {
  const node = { id: state.labNodeId--, title, author, available: 1, temporary: true, left: null, right: null };
  if (!state.labTree) {
    state.labTree = node;
  } else {
    let current = state.labTree;
    while (true) {
      const direction = compareNodes(node, current) < 0 ? "left" : "right";
      if (!current[direction]) {
        current[direction] = node;
        break;
      }
      current = current[direction];
    }
  }
  return node;
}

function findLabNode(title) {
  let current = state.labTree;
  const path = [];
  const target = title.toLocaleLowerCase();
  while (current) {
    path.push(current);
    const value = current.title.toLocaleLowerCase();
    if (target === value) return { found: current, path };
    current = target < value ? current.left : current.right;
  }
  return { found: null, path };
}

function deleteLabNode(root, target) {
  if (!root) return null;
  const comparison = compareNodes(target, root);
  if (comparison < 0) {
    root.left = deleteLabNode(root.left, target);
  } else if (comparison > 0) {
    root.right = deleteLabNode(root.right, target);
  } else if (!root.left) {
    return root.right;
  } else if (!root.right) {
    return root.left;
  } else {
    let successor = root.right;
    while (successor.left) successor = successor.left;
    root.id = successor.id;
    root.title = successor.title;
    root.author = successor.author;
    root.available = successor.available;
    root.temporary = successor.temporary;
    root.right = deleteLabNode(root.right, successor);
  }
  return root;
}

function traverseLab(node, order, result = []) {
  if (!node) return result;
  if (order === "preorder") result.push(node);
  traverseLab(node.left, order, result);
  if (order === "inorder") result.push(node);
  traverseLab(node.right, order, result);
  if (order === "postorder") result.push(node);
  return result;
}

function openBookDialog(book = null) {
  if (state.demo) {
    toast("The sample demo is read-only. Exit demo mode to edit your library.", "error");
    return;
  }
  const dialog = $("#bookDialog");
  $("#bookId").value = book ? book.id : "";
  $("#bookTitle").value = book ? book.title : "";
  $("#bookAuthor").value = book ? book.author : "";
  $("#bookCategory").value = book ? book.category : "";
  $("#bookDialogTitle").textContent = book ? "Edit book" : "Add a book";
  $("#saveBook").textContent = book ? "Save changes" : "Save book";
  dialog.showModal();
  $("#bookTitle").focus();
}

async function refreshData({ tree = true } = {}) {
  await Promise.all([loadDashboard(), loadBooks(), loadCategories(), ...(tree ? [loadTree()] : [])]);
}

function setDemoMode(enabled) {
  state.demo = enabled;
  state.page = 1;
  state.labNodeId = -1;
  $("#demoToggle").setAttribute("aria-pressed", String(enabled));
  $("#demoToggle").textContent = enabled ? "✓ Demo active" : "▷ Try demo";
  $("#demoBanner").hidden = !enabled;
  $("#bookFilter").disabled = false;
  refreshData().catch(error => toast(error.message, "error"));
  if (enabled) toast("Sample library loaded. Your saved database is unchanged.");
  else toast("Returned to your saved library.");
}

function showView(viewId) {
  const view = $(`#${viewId}`);
  if (!view || !view.classList.contains("view-section")) return;
  $$(".view-section").forEach(section => section.classList.toggle("active", section === view));
  $$(".nav-link").forEach(link => link.classList.toggle("active", link.dataset.view === viewId));
  $("#pageTitle").textContent = view.dataset.title;
  $("#sidebar").classList.remove("open");
  $("#menuToggle").setAttribute("aria-expanded", "false");
  if (viewId === "books") Promise.all([loadBooks(), loadCategories()]).catch(error => toast(error.message, "error"));
  if (viewId === "visualizer") loadTree().catch(error => toast(error.message, "error"));
}

function renderComparison(result) {
  const container = $("#comparisonResult");
  container.replaceChildren();
  const found = result.found;
  const banner = safeText("div", found ? `Found “${found.title}” by ${found.author} (ID #${found.id}).` : "Target title not found in this collection.", `found-banner${found ? "" : " not-found"}`);
  container.append(banner);
  const grid = document.createElement("div");
  grid.className = "comparison-grid";
  const maxComparisons = Math.max(1, result.linear.comparisons, result.bst.comparisons);
  [
    { title: "Linear search", data: result.linear, path: "Checked books in database insertion order." },
    { title: "BST search", data: result.bst, path: result.path.length ? `Path: ${result.path.join(" → ")}` : "No nodes visited." },
  ].forEach(item => {
    const card = document.createElement("article");
    card.className = "comparison-card";
    card.append(safeText("h3", item.title));
    const comparisons = document.createElement("div");
    comparisons.className = "comparison-stat-row";
    comparisons.append(safeText("span", "Comparisons"), safeText("strong", item.data.comparisons));
    const time = document.createElement("div");
    time.className = "comparison-stat-row";
    time.append(safeText("span", "Approx. time"), safeText("strong", `${(item.data.time_ns / 1000).toFixed(2)} µs`, "time-value"));
    const complexity = document.createElement("div");
    complexity.className = "comparison-stat-row";
    complexity.append(safeText("span", "Complexity"), safeText("strong", item.data.complexity));
    const bar = document.createElement("div");
    bar.className = "comparison-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.max(4, item.data.comparisons / maxComparisons * 100)}%`;
    bar.append(fill);
    card.append(comparisons, time, complexity, bar, safeText("p", item.path, "path-copy"));
    grid.append(card);
  });
  container.append(grid);
  container.append(safeText("p", `This database-order BST has height ${result.tree_height}. Timings are approximate and system-load dependent; comparison counts and actual tree shape are more meaningful.`, "comparison-note"));
}

function animateTraversal(order, data) {
  cancelTraversal();
  state.traversalItems = data.books.map(book => book.book || book);
  state.traversalIndex = 0;
  const output = $("#traversalOutput");
  output.replaceChildren();
  $("#traversalExplanation").textContent = data.explanation;
  $("#traversalProgress").textContent = state.traversalItems.length
    ? `${state.traversalItems.length} books · complete order shown`
    : "Empty tree";
  $("#playTraversal").disabled = state.traversalItems.length === 0;
  $("#skipTraversal").hidden = true;
  $$(".tree-svg-node.traversal-current").forEach(node => node.classList.remove("traversal-current"));
  if (!data.books.length) {
    $("#traversalExplanation").textContent = `${data.explanation} The current tree is empty.`;
    return;
  }
  state.traversalItems.forEach((book, index) => {
    const item = document.createElement("li");
    item.dataset.id = String(book.id);
    item.append(
      safeText("span", String(index + 1).padStart(2, "0"), "traversal-number"),
      safeText("span", book.title, "traversal-title")
    );
    item.setAttribute("aria-label", `${index + 1}: ${book.title}`);
    output.append(item);
  });
}

function cancelTraversal() {
  window.clearInterval(state.traversalTimer);
  state.traversalTimer = null;
  if ($("#playTraversal")) $("#playTraversal").disabled = state.traversalItems.length === 0;
  if ($("#skipTraversal")) $("#skipTraversal").hidden = true;
  $$(".tree-svg-node.traversal-current").forEach(node => node.classList.remove("traversal-current"));
}

function playTraversal() {
  if (!state.traversalItems.length) return;
  window.clearInterval(state.traversalTimer);
  state.traversalTimer = null;
  state.traversalIndex = 0;
  $("#playTraversal").disabled = true;
  $("#skipTraversal").hidden = false;
  const items = $$("#traversalOutput li");
  const step = () => {
    if (state.traversalIndex >= state.traversalItems.length) {
      window.clearInterval(state.traversalTimer);
      state.traversalTimer = null;
      state.highlighted = [];
      $$(".tree-svg-node.traversal-current").forEach(node => node.classList.remove("traversal-current"));
      $("#traversalProgress").textContent = `${state.traversalItems.length} / ${state.traversalItems.length} visited · finished`;
      $("#playTraversal").disabled = false;
      $("#skipTraversal").hidden = true;
      return;
    }
    const index = state.traversalIndex++;
    const book = state.traversalItems[index];
    items.forEach(item => item.classList.toggle("visited", Number(item.dataset.id) === Number(book.id)));
    $$(".tree-svg-node.traversal-current").forEach(node => node.classList.remove("traversal-current"));
    const currentNode = $(`.tree-svg-node[data-id="${CSS.escape(String(book.id))}"]`);
    if (currentNode) {
      currentNode.classList.add("traversal-current");
      currentNode.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    $("#traversalProgress").textContent = `${index + 1} / ${state.traversalItems.length} visited · ${book.title}`;
    $("#treeNodeDetail").textContent = `Traversal step ${index + 1}: ${book.title} · ${book.author || "Unknown author"}`;
  };
  step();
  state.traversalTimer = window.setInterval(step, 180);
}

function finishTraversal() {
  window.clearInterval(state.traversalTimer);
  state.traversalTimer = null;
  $$("#traversalOutput li").forEach(item => item.classList.add("visited"));
  $$(".tree-svg-node.traversal-current").forEach(node => node.classList.remove("traversal-current"));
  state.traversalIndex = state.traversalItems.length;
  $("#traversalProgress").textContent = `${state.traversalItems.length} / ${state.traversalItems.length} visited · finished`;
  $("#playTraversal").disabled = false;
  $("#skipTraversal").hidden = true;
}

function graphWalk(kind) {
  const graph = { A: ["B", "C"], B: ["A", "D", "E"], C: ["A", "F"], D: ["B"], E: ["B"], F: ["C"] };
  const visited = [];
  const start = "A";
  if (kind === "BFS") {
    const queue = [start];
    const seen = new Set([start]);
    while (queue.length) {
      const node = queue.shift();
      visited.push(node);
      graph[node].forEach(neighbor => {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      });
    }
  } else {
    const stack = [start];
    const seen = new Set();
    while (stack.length) {
      const node = stack.pop();
      if (seen.has(node)) continue;
      seen.add(node);
      visited.push(node);
      [...graph[node]].reverse().forEach(neighbor => {
        if (!seen.has(neighbor)) stack.push(neighbor);
      });
    }
  }
  $("#graphOutput").textContent = `${kind}: ${visited.join(" → ")} (separate graph demo)`;
}

document.addEventListener("click", async event => {
  const discoveryAction = event.target.closest("[data-discover-category]");
  if (discoveryAction) {
    const category = discoveryAction.dataset.discoverCategory;
    showView("books");
    try {
      await loadCategories();
      $("#categoryFilter").value = category;
      state.page = 1;
      await loadBooks();
      history.replaceState(null, "", "#books");
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }
  const nav = event.target.closest("[data-view]");
  if (nav) {
    event.preventDefault();
    showView(nav.dataset.view);
  }
  if (event.target.closest("[data-open-add]")) openBookDialog();
});

$$(".brand, .nav-link, .course-card a, .subtle-link, .outcome-row > a").forEach(link => {
  link.addEventListener("click", () => {
    const viewId = link.dataset.view;
    if (viewId) history.replaceState(null, "", `#${viewId}`);
  });
});

$("#menuToggle").addEventListener("click", () => {
  const isOpen = $("#sidebar").classList.toggle("open");
  $("#menuToggle").setAttribute("aria-expanded", String(isOpen));
});

$("#themeToggle").addEventListener("click", () => {
  const root = document.documentElement;
  const light = root.dataset.theme !== "light";
  root.dataset.theme = light ? "light" : "dark";
  localStorage.setItem("treelib-theme", root.dataset.theme);
  $("#themeToggle").setAttribute("aria-label", `Switch to ${light ? "dark" : "light"} theme`);
  renderChartsFromLoadedData();
});

function renderChartsFromLoadedData() {
  loadDashboard().catch(error => toast(error.message, "error"));
}

$("#demoToggle").addEventListener("click", () => setDemoMode(!state.demo));
$("#exitDemo").addEventListener("click", () => setDemoMode(false));
$("#discoverNext").addEventListener("click", async () => {
  state.discoveryOffset += 3;
  try {
    const query = new URLSearchParams({ offset: String(state.discoveryOffset) });
    if (state.demo) query.set("demo", "1");
    const recommendations = await api(`/api/discover?${query.toString()}`);
    renderDiscovery(recommendations);
  } catch (error) {
    toast(error.message, "error");
  }
});
$("#seedCatalog").addEventListener("click", async event => {
  const button = event.currentTarget;
  setLoading(button, true, "Growing your library…");
  try {
    const result = await api("/api/catalog/seed-100", { method: "POST" });
    state.page = 1;
    state.discoveryOffset = 0;
    toast(result.message);
    await refreshData();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(button, false);
  }
});
$("#startDemo").addEventListener("click", () => {
  setDemoMode(true);
  showView("dashboard");
  history.replaceState(null, "", "#dashboard");
});

$("#bookFilter").addEventListener("input", () => {
  state.page = 1;
  window.clearTimeout($("#bookFilter")._timer);
  $("#bookFilter")._timer = window.setTimeout(() => loadBooks().catch(error => toast(error.message, "error")), 180);
});
["categoryFilter", "availabilityFilter", "sortFilter"].forEach(id => {
  $(`#${id}`).addEventListener("change", () => {
    state.page = 1;
    if (id === "sortFilter") state.sortDirection = "asc";
    loadBooks().catch(error => toast(error.message, "error"));
  });
});
$("#sortFilter").addEventListener("dblclick", () => {
  state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  loadBooks().catch(error => toast(error.message, "error"));
});
$("#prevPage").addEventListener("click", () => {
  if (state.page > 1) {
    state.page -= 1;
    loadBooks().catch(error => toast(error.message, "error"));
  }
});
$("#nextPage").addEventListener("click", () => {
  if (state.page < state.pages) {
    state.page += 1;
    loadBooks().catch(error => toast(error.message, "error"));
  }
});

$("#bookRows").addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const bookId = Number(button.dataset.id);
  const book = state.books.find(item => Number(item.id) === bookId);
  if (!book) return;
  if (button.dataset.action === "edit") {
    openBookDialog(book);
    return;
  }
  if (button.dataset.action === "delete") {
    if (state.demo) return;
    state.pendingDeleteId = bookId;
    $("#confirmMessage").textContent = `“${book.title}” will be permanently removed from your library. This cannot be undone.`;
    $("#confirmOverlay").hidden = false;
    $("#confirmCancel").focus();
    return;
  }
  try {
    await api(`/api/books/${bookId}/${button.dataset.action}`, { method: "POST" });
    toast(`“${book.title}” ${button.dataset.action === "issue" ? "issued" : "returned"}.`);
    await refreshData();
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#confirmCancel").addEventListener("click", () => {
  $("#confirmOverlay").hidden = true;
  state.pendingDeleteId = null;
});
$("#confirmOverlay").addEventListener("click", event => {
  if (event.target === $("#confirmOverlay")) $("#confirmCancel").click();
});
$("#confirmDelete").addEventListener("click", async () => {
  if (state.pendingDeleteId == null) return;
  const button = $("#confirmDelete");
  setLoading(button, true, "Deleting…");
  try {
    await api(`/api/books/${state.pendingDeleteId}`, { method: "DELETE" });
    $("#confirmOverlay").hidden = true;
    toast("Book deleted.");
    state.pendingDeleteId = null;
    await refreshData();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(button, false);
  }
});

$("#closeDialog").addEventListener("click", () => $("#bookDialog").close());
$("#cancelDialog").addEventListener("click", () => $("#bookDialog").close());
$("#bookDialog").addEventListener("click", event => {
  if (event.target === $("#bookDialog")) $("#bookDialog").close();
});
$("#bookForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = {
    title: $("#bookTitle").value.trim(),
    author: $("#bookAuthor").value.trim(),
    category: $("#bookCategory").value.trim(),
  };
  if (!values.title || !values.author || !values.category) {
    toast("Title, author, and category are required.", "error");
    form.reportValidity();
    return;
  }
  if (values.title.length > 160 || values.author.length > 120 || values.category.length > 80) {
    toast("One or more fields exceed the allowed length.", "error");
    return;
  }
  const id = $("#bookId").value;
  const button = $("#saveBook");
  setLoading(button, true, "Saving…");
  try {
    const response = await api(id ? `/api/books/${id}` : "/api/books", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(values),
    });
    $("#bookDialog").close();
    toast(response.message);
    state.page = 1;
    await refreshData();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(button, false);
  }
});

$("#rebuildTree").addEventListener("click", () => {
  state.labNodeId = -1;
  loadTree().then(() => toast("Tree rebuilt from the current library.")).catch(error => toast(error.message, "error"));
});

$("#treeZoomOut").addEventListener("click", () => {
  state.treeZoom = Math.max(0.02, state.treeZoom / 1.25);
  applyTreeZoom();
});
$("#treeZoomIn").addEventListener("click", () => {
  state.treeZoom = Math.min(3, state.treeZoom * 1.25);
  applyTreeZoom();
});
$("#treeFit").addEventListener("click", () => applyTreeZoom(true));
window.addEventListener("resize", () => {
  if (!state.treeWidth) return;
  window.cancelAnimationFrame(treeResizeFrame);
  treeResizeFrame = window.requestAnimationFrame(() => applyTreeZoom(true));
});
$("#treeCanvas").addEventListener("click", event => {
  const node = event.target.closest(".tree-svg-node");
  if (node) selectTreeNode(node);
});
$("#treeCanvas").addEventListener("keydown", event => {
  const node = event.target.closest(".tree-svg-node");
  if (node && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    selectTreeNode(node);
  }
});

$("#labInsert").addEventListener("click", () => {
  const title = $("#labTitle").value.trim();
  const author = $("#labAuthor").value.trim();
  if (!title || !author) {
    toast("Enter a title and author for the temporary BST node.", "error");
    return;
  }
  if (title.length > 160 || author.length > 120) {
    toast("Title or author is too long.", "error");
    return;
  }
  if (findLabNode(title).found) {
    toast("A node with this title is already in the tree. Duplicate titles are not inserted in the lab.", "error");
    return;
  }
  const inserted = insertLabNode(title, author);
  updateLabMetrics();
  renderTree();
  $("#treeMessage").textContent = `Inserted “${inserted.title}” by comparing titles from the root until an empty child slot was found. This lab node is temporary.`;
  $("#labTitle").value = "";
  $("#labAuthor").value = "";
  toast("Temporary BST node inserted.");
});

$("#labSearch").addEventListener("click", () => {
  const title = $("#labTitle").value.trim();
  if (!title) {
    toast("Enter a title to search the BST.", "error");
    return;
  }
  const result = findLabNode(title);
  state.highlighted = result.path.map(node => Number(node.id));
  renderTree();
  $("#treeMessage").textContent = result.found
    ? `Found “${result.found.title}” in ${result.path.length} comparison${result.path.length === 1 ? "" : "s"}. Green nodes show the search path.`
    : `Not found after ${result.path.length} comparison${result.path.length === 1 ? "" : "s"}. Green nodes show the path taken.`;
});

$("#labDelete").addEventListener("click", () => {
  const title = $("#labTitle").value.trim();
  if (!title) {
    toast("Enter the exact title of a node to delete.", "error");
    return;
  }
  const result = findLabNode(title);
  if (!result.found) {
    state.highlighted = result.path.map(node => Number(node.id));
    renderTree();
    $("#treeMessage").textContent = `Could not delete “${title}”: title not found after ${result.path.length} comparisons.`;
    return;
  }
  state.labTree = deleteLabNode(state.labTree, result.found);
  state.highlighted = [];
  updateLabMetrics();
  renderTree();
  $("#treeMessage").textContent = `Deleted “${title}”. A node with two children is replaced by its inorder successor. The database is unchanged.`;
  $("#labTitle").value = "";
  toast("Temporary BST node deleted.");
});

$$(".traversal-button").forEach(button => {
  button.addEventListener("click", async () => {
    cancelTraversal();
    try {
      const data = state.labTree
        ? { order: button.dataset.order, books: traverseLab(state.labTree, button.dataset.order), explanation: traversalExplanation(button.dataset.order) }
        : await api(`/api/traversal/${button.dataset.order}${demoQuery()}`);
      animateTraversal(button.dataset.order, data);
    } catch (error) {
      toast(error.message, "error");
    }
  });
});

$("#playTraversal").addEventListener("click", playTraversal);
$("#skipTraversal").addEventListener("click", finishTraversal);

function traversalExplanation(order) {
  return {
    inorder: "Visit left subtree, current node, then right subtree. For a BST this lists titles alphabetically.",
    preorder: "Visit current node, then left subtree, then right subtree. The root is listed first.",
    postorder: "Visit left subtree, then right subtree, then current node. The root is listed last.",
  }[order];
}

$("#compareSearch").addEventListener("click", async () => {
  const title = $("#algorithmTarget").value.trim();
  if (!title) {
    toast("Enter a target title to compare search algorithms.", "error");
    return;
  }
  const button = $("#compareSearch");
  setLoading(button, true, "Comparing…");
  try {
    const query = new URLSearchParams({ title });
    if (state.demo) query.set("demo", "1");
    const result = await api(`/api/search?${query.toString()}`);
    renderComparison(result);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(button, false);
  }
});
$("#algorithmTarget").addEventListener("keydown", event => {
  if (event.key === "Enter") $("#compareSearch").click();
});
$("#labTitle").addEventListener("keydown", event => {
  if (event.key === "Enter") $("#labSearch").click();
});
$("#graphBfs").addEventListener("click", () => graphWalk("BFS"));
$("#graphDfs").addEventListener("click", () => graphWalk("DFS"));

const savedTheme = localStorage.getItem("treelib-theme");
if (savedTheme === "light") {
  document.documentElement.dataset.theme = "light";
  $("#themeToggle").setAttribute("aria-label", "Switch to dark theme");
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("#confirmOverlay").hidden) {
    $("#confirmOverlay").hidden = true;
    state.pendingDeleteId = null;
  }
});

const initialView = window.location.hash.slice(1);
if (initialView && $(`#${initialView}`)?.classList.contains("view-section")) showView(initialView);
refreshData().catch(error => {
  toast(error.message, "error");
  $("#activityList").replaceChildren(safeText("p", "Could not load library data. Check the Flask server and SQLite database.", "empty-activity"));
});
