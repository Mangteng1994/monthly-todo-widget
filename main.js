(function () {
  "use strict";

  const els = {
    form: document.getElementById("summaryForm"),
    notebook: document.getElementById("notebookSelect"),
    month: document.getElementById("monthInput"),
    heading: document.getElementById("headingInput"),
    refresh: document.getElementById("refreshButton"),
    status: document.getElementById("status"),
    result: document.getElementById("result"),
  };

  const state = {
    notebooks: [],
    context: null,
    groups: [],
    rowMap: new Map(),
    savingRows: new Set(),
  };

  function getApiBase() {
    return `${location.origin}/api`;
  }

  async function postApi(path, data) {
    const response = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data || {}),
    });

    if (!response.ok) {
      throw new Error(`API 请求失败：${response.status}`);
    }

    const body = await response.json();
    if (body.code && body.code !== 0) {
      throw new Error(body.msg || `API 返回错误：${body.code}`);
    }

    return body.data;
  }

  const api = {
    async listNotebooks() {
      const data = await postApi("/notebook/lsNotebooks");
      return (data && data.notebooks ? data.notebooks : []).filter((item) => !item.closed);
    },

    async sql(statement) {
      return (await postApi("/query/sql", { stmt: statement })) || [];
    },

    async getBlockById(blockId) {
      const rows = await this.sql(
        "select id, parent_id, root_id, box, path, hpath, name, content, markdown, type, subtype " +
          `from blocks where id = '${sqlText(blockId)}' limit 1`
      );
      return rows[0] || null;
    },

    async getChildBlocks(blockId) {
      return (await postApi("/block/getChildBlocks", { id: blockId })) || [];
    },

    async updateBlock(blockId, markdown) {
      return postApi("/block/updateBlock", {
        id: blockId,
        dataType: "markdown",
        data: markdown,
      });
    },
  };

  function normalizeMonthText(value) {
    return value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  }

  function sqlText(value) {
    return String(value).replace(/'/g, "''");
  }

  function stripSySuffix(name) {
    return String(name || "").replace(/\.sy$/i, "");
  }

  function isDailyDoc(doc, monthText) {
    const title = stripSySuffix(doc.content || doc.name || doc.hpath || "");
    const escapedMonth = monthText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escapedMonth}-\\d{2}\\b`).test(title);
  }

  function dailyDocSortTitle(doc) {
    return stripSySuffix(doc.content || doc.name || doc.hpath || "");
  }

  function compareDailyDoc(a, b) {
    return dailyDocSortTitle(a).localeCompare(dailyDocSortTitle(b), "zh-Hans");
  }

  async function findMonthDocs(notebookId, monthText) {
    const box = sqlText(notebookId);
    const title = sqlText(monthText);
    const hpathEndsWith = sqlText(`/${monthText}`);

    return api.sql(
      "select id, box, content, hpath from blocks " +
        `where type = 'd' and box = '${box}' ` +
        `and (content = '${title}' or hpath like '%${hpathEndsWith}') ` +
        "order by hpath"
    );
  }

  async function findDailyDocs(notebookId, monthText) {
    const monthDocs = await findMonthDocs(notebookId, monthText);
    if (!monthDocs.length) {
      return [];
    }

    const dateDocs = [];
    const seen = new Set();

    for (const monthDoc of monthDocs) {
      const monthHPath = String(monthDoc.hpath || "").replace(/\/+$/, "");
      if (!monthHPath) {
        continue;
      }

      const likePattern = sqlText(`${monthHPath}/%`);
      const docs = await api.sql(
        "select id, box, content, hpath from blocks " +
          `where type = 'd' and box = '${sqlText(notebookId)}' ` +
          `and hpath like '${likePattern}' order by hpath`
      );

      for (const doc of docs) {
        if (!doc.id || seen.has(doc.id) || !isDailyDoc(doc, monthText)) {
          continue;
        }
        seen.add(doc.id);
        dateDocs.push(doc);
      }
    }

    return dateDocs.sort(compareDailyDoc);
  }

  async function findHeadingBlocks(dateDoc, targetTitle) {
    const rootId = sqlText(dateDoc.id);
    const title = sqlText(targetTitle);
    return api.sql(
      "select id, root_id, content, markdown from blocks " +
        `where root_id = '${rootId}' and type = 'h' ` +
        `and content = '${title}' order by sort`
    );
  }

  async function readBlockTree(blockId, depth) {
    if (depth <= 0) {
      return [];
    }

    const blocks = await api.getChildBlocks(blockId);
    for (const block of blocks) {
      block.children = await readBlockTree(block.id, depth - 1);
    }
    return blocks;
  }

  function textFromBlock(block) {
    const raw = block.markdown || block.content || "";
    return raw
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\s*\d+\.\s+/, "")
      .replace(/^\s*\[[ xX]\]\s+/, "")
      .trim();
  }

  function isTaskMarkdown(markdown) {
    return /^\s*[-*+]\s+\[[ xX]\]\s+/.test(markdown || "");
  }

  function isTaskChecked(markdown) {
    return /^\s*[-*+]\s+\[[xX]\]\s+/.test(markdown || "");
  }

  function taskTextFromMarkdown(markdown) {
    return String(markdown || "")
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "")
      .trim();
  }

  function markdownForTask(text, checked) {
    return `- [${checked ? "x" : " "}] ${String(text || "").trim()}`;
  }

  function parseLinkedBlockId(markdown, sourceId) {
    const text = String(markdown || "");
    const patterns = [
      /siyuan:\/\/blocks\/([A-Za-z0-9-]+)/g,
      /\(\(([A-Za-z0-9-]+)(?:\s+["'][^"']*["'])?\)\)/g,
    ];

    for (const pattern of patterns) {
      let match = pattern.exec(text);
      while (match) {
        if (match[1] && match[1] !== sourceId) {
          return match[1];
        }
        match = pattern.exec(text);
      }
    }

    return "";
  }

  function flattenTodoItems(blocks) {
    const items = [];
    const seenIds = new Set();
    const seenTexts = new Set();

    function isUnorderedList(block) {
      return block.type === "l" && (block.subType === "u" || block.subtype === "u");
    }

    function isListItem(block) {
      return block.type === "i";
    }

    function addItem(block, task) {
      const text = textFromBlock(block);
      if (!text) {
        return;
      }

      const textKey = text.replace(/\s+/g, " ");
      if ((block.id && seenIds.has(block.id)) || seenTexts.has(textKey)) {
        return;
      }

      if (block.id) {
        seenIds.add(block.id);
      }
      seenTexts.add(textKey);
      items.push({
        sourceId: block.id,
        sourceText: text,
        sourceMarkdown: block.markdown || block.content || "",
        sourceTask: task || isTaskMarkdown(block.markdown),
      });
    }

    function directTextChildren(block) {
      return (block.children || []).filter((child) => {
        return !isUnorderedList(child) && !isListItem(child) && textFromBlock(child);
      });
    }

    function walk(blocksToRead, parentIsUnorderedList) {
      for (const block of blocksToRead) {
        const text = textFromBlock(block);

        if (isUnorderedList(block)) {
          walk(block.children || [], true);
          continue;
        }

        if (isListItem(block)) {
          if (parentIsUnorderedList) {
            const textChildren = directTextChildren(block);
            if (textChildren.length) {
              for (const child of textChildren) {
                addItem(child, true);
              }
            } else {
              addItem(block, true);
            }

            walk(
              (block.children || []).filter((child) => isUnorderedList(child)),
              false
            );
          } else {
            walk(block.children || [], false);
          }
          continue;
        }

        if (text) {
          addItem(block, false);
          continue;
        }

        walk(block.children || [], false);
      }
    }

    walk(blocks || [], false);
    return items;
  }

  function dedupeTodoItems(items) {
    const seenIds = new Set();
    const seenTexts = new Set();
    return items.filter((item) => {
      const textKey = item.sourceText.replace(/\s+/g, " ");
      if ((item.sourceId && seenIds.has(item.sourceId)) || seenTexts.has(textKey)) {
        return false;
      }
      if (item.sourceId) {
        seenIds.add(item.sourceId);
      }
      seenTexts.add(textKey);
      return true;
    });
  }

  function flattenTaskBlocks(blocks) {
    const rows = [];
    const seen = new Set();

    function walk(items) {
      for (const block of items || []) {
        const markdown = block.markdown || block.content || "";
        if (block.id && !seen.has(block.id) && isTaskMarkdown(markdown)) {
          seen.add(block.id);
          rows.push(createTaskRow(block));
        }
        walk(block.children || []);
      }
    }

    walk(blocks);
    return rows;
  }

  function blockTitle(block) {
    return textFromBlock(block) || stripSySuffix(block.content || block.name || block.hpath || "") || block.id;
  }

  function createTaskRow(block) {
    const markdown = block.markdown || block.content || "";
    const task = isTaskMarkdown(markdown);
    return {
      id: block.id,
      type: block.type,
      text: task ? taskTextFromMarkdown(markdown) : textFromBlock(block),
      checked: task && isTaskChecked(markdown),
      task,
      editable: block.type !== "d",
      openId: block.id,
    };
  }

  async function buildBoundTodoItem(sourceItem, targetId) {
    const target = await api.getBlockById(targetId);
    if (!target) {
      return {
        source: sourceItem,
        bound: false,
        broken: true,
        targetId,
        title: "任务链接失效",
        rows: [],
      };
    }

    let rows = [];
    if (isTaskMarkdown(target.markdown || target.content || "")) {
      rows = [createTaskRow(target)];
    } else {
      try {
        const children = await readBlockTree(target.id, 4);
        rows = flattenTaskBlocks(children);
      } catch (error) {
        rows = [];
      }
    }

    if (!rows.length) {
      rows = [createTaskRow(target)];
    }

    return {
      source: sourceItem,
      bound: true,
      broken: false,
      targetId,
      title: blockTitle(target),
      rows,
    };
  }

  async function buildTodoItem(sourceItem) {
    const targetId = parseLinkedBlockId(sourceItem.sourceMarkdown, sourceItem.sourceId);
    if (!targetId) {
      return {
        source: sourceItem,
        bound: false,
        broken: false,
        targetId: "",
        title: "未绑定任务笔记",
        rows: [
          {
            id: sourceItem.sourceId,
            text: sourceItem.sourceText,
            task: false,
            checked: false,
            editable: false,
            openId: sourceItem.sourceId,
          },
        ],
      };
    }

    try {
      return await buildBoundTodoItem(sourceItem, targetId);
    } catch (error) {
      return {
        source: sourceItem,
        bound: false,
        broken: true,
        targetId,
        title: "任务读取失败",
        error: error.message,
        rows: [],
      };
    }
  }

  async function collectTodos(notebookId, monthText, targetTitle) {
    const docs = await findDailyDocs(notebookId, monthText);

    if (!docs.length) {
      return { reason: "no-daily-docs", groups: [] };
    }

    const groups = [];
    for (const doc of docs) {
      const headings = await findHeadingBlocks(doc, targetTitle);
      const items = [];

      for (const heading of headings) {
        const children = await readBlockTree(heading.id, 6);
        items.push(...flattenTodoItems(children));
      }

      const sourceItems = dedupeTodoItems(items);
      const todoItems = [];
      for (const sourceItem of sourceItems) {
        todoItems.push(await buildTodoItem(sourceItem));
      }

      if (todoItems.length) {
        groups.push({
          doc,
          title: stripSySuffix(doc.content),
          items: todoItems,
        });
      }
    }

    return {
      reason: groups.length ? "" : "no-todo-content",
      groups,
    };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char];
    });
  }

  function blockLink(blockId) {
    return `siyuan://blocks/${encodeURIComponent(blockId)}`;
  }

  function collapseStorageKey(docId) {
    const context = state.context || {};
    return [
      "monthly-todo-widget",
      "collapsed",
      context.notebookId || "",
      context.monthText || "",
      context.targetTitle || "",
      docId,
    ].join(":");
  }

  function isGroupCollapsed(docId) {
    return localStorage.getItem(collapseStorageKey(docId)) === "1";
  }

  function setGroupCollapsed(docId, collapsed) {
    const key = collapseStorageKey(docId);
    if (collapsed) {
      localStorage.setItem(key, "1");
    } else {
      localStorage.removeItem(key);
    }
  }

  function rowKey(sourceId, rowId) {
    return `${sourceId || ""}:${rowId || ""}`;
  }

  function renderTodoItem(item) {
    const sourceLink = blockLink(item.source.sourceId);
    const rows = item.rows
      .map((row) => {
        const key = rowKey(item.source.sourceId, row.id);
        state.rowMap.set(key, { item, row });

        const checkbox = row.task
          ? `<input class="task-checkbox" type="checkbox" data-row-key="${escapeHtml(key)}" ${row.checked ? "checked" : ""}>`
          : '<span class="task-checkbox-spacer" aria-hidden="true"></span>';
        const text = row.editable
          ? `<span class="task-text" contenteditable="true" spellcheck="false" data-row-key="${escapeHtml(key)}">${escapeHtml(row.text)}</span>`
          : `<span class="task-text task-text--readonly">${escapeHtml(row.text)}</span>`;

        return `
          <li class="task-row">
            ${checkbox}
            ${text}
            <a class="icon-link" href="${blockLink(row.openId)}" title="打开任务">打开</a>
          </li>
        `;
      })
      .join("");

    const badgeClass = item.bound ? "task-card__badge" : "task-card__badge task-card__badge--warn";
    const badgeText = item.bound ? "任务笔记" : item.broken ? "链接失效" : "未绑定任务笔记";
    const titleLink = item.bound && item.targetId ? blockLink(item.targetId) : sourceLink;
    const error = item.error ? `<div class="task-card__error">${escapeHtml(item.error)}</div>` : "";

    return `
      <li class="task-card">
        <div class="task-card__head">
          <a class="task-card__title" href="${titleLink}" title="${item.bound ? "打开任务笔记/任务块" : "打开日记 TODO 条目"}">${escapeHtml(item.title)}</a>
          <span class="${badgeClass}">${badgeText}</span>
        </div>
        ${rows ? `<ul class="task-rows">${rows}</ul>` : ""}
        ${error}
        <div class="task-card__source">
          来源：<a href="${sourceLink}" title="打开原日记 TODO 条目">${escapeHtml(item.source.sourceText)}</a>
        </div>
      </li>
    `;
  }

  function renderGroups(groups) {
    state.rowMap.clear();
    els.result.innerHTML = groups
      .map((group) => {
        const collapsed = isGroupCollapsed(group.doc.id);
        const tasks = group.items.map(renderTodoItem).join("");
        const content = collapsed ? "" : `<div class="day__content"><ul class="tasks">${tasks}</ul></div>`;

        return `
          <article class="day" data-doc-id="${escapeHtml(group.doc.id)}">
            <h2 class="day__title">
              <span>${escapeHtml(group.title)}</span>
              <span class="day__actions">
                <a href="${blockLink(group.doc.id)}" title="打开日记文档">打开</a>
                <button class="link-button" type="button" data-action="toggle-day" data-doc-id="${escapeHtml(group.doc.id)}">
                  ${collapsed ? "展开" : "折叠"}
                </button>
              </span>
            </h2>
            ${content}
          </article>
        `;
      })
      .join("");
  }

  async function updateTaskChecked(checkbox) {
    const key = checkbox.dataset.rowKey;
    const record = state.rowMap.get(key);
    if (!record || !record.row.task || state.savingRows.has(key)) {
      return;
    }

    const nextChecked = checkbox.checked;
    const previousChecked = record.row.checked;
    state.savingRows.add(key);
    checkbox.disabled = true;

    try {
      await api.updateBlock(record.row.id, markdownForTask(record.row.text, nextChecked));
      record.row.checked = nextChecked;
      setStatus("");
    } catch (error) {
      checkbox.checked = previousChecked;
      setStatus(`勾选同步失败：${error.message}`);
    } finally {
      checkbox.disabled = false;
      state.savingRows.delete(key);
    }
  }

  async function saveTaskText(element) {
    const key = element.dataset.rowKey;
    const record = state.rowMap.get(key);
    if (!record || !record.row.editable || state.savingRows.has(key)) {
      return;
    }

    const previousText = element.dataset.originalText || record.row.text;
    const nextText = element.textContent.trim();
    if (element.dataset.cancelEdit === "1") {
      element.dataset.cancelEdit = "";
      element.textContent = previousText;
      return;
    }

    if (nextText === previousText) {
      return;
    }

    if (!nextText) {
      element.textContent = previousText;
      setStatus("任务内容不能为空。");
      return;
    }

    state.savingRows.add(key);
    element.classList.add("is-saving");

    try {
      const markdown = record.row.task ? markdownForTask(nextText, record.row.checked) : nextText;
      await api.updateBlock(record.row.id, markdown);
      record.row.text = nextText;
      element.dataset.originalText = nextText;
      element.textContent = nextText;
      setStatus("");
    } catch (error) {
      element.textContent = previousText;
      setStatus(`内容保存失败：${error.message}`);
    } finally {
      element.classList.remove("is-saving");
      state.savingRows.delete(key);
    }
  }

  function handleResultClick(event) {
    const toggle = event.target.closest('[data-action="toggle-day"]');
    if (!toggle) {
      return;
    }

    const docId = toggle.dataset.docId;
    setGroupCollapsed(docId, !isGroupCollapsed(docId));
    renderGroups(state.groups);
  }

  function handleResultChange(event) {
    if (event.target.classList.contains("task-checkbox")) {
      updateTaskChecked(event.target);
    }
  }

  function handleResultFocusIn(event) {
    if (event.target.classList.contains("task-text")) {
      event.target.dataset.originalText = event.target.textContent.trim();
      event.target.dataset.cancelEdit = "";
    }
  }

  function handleResultFocusOut(event) {
    if (event.target.classList.contains("task-text")) {
      saveTaskText(event.target);
    }
  }

  function handleResultKeyDown(event) {
    if (!event.target.classList.contains("task-text")) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.target.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.target.dataset.cancelEdit = "1";
      event.target.blur();
    }
  }

  function setStatus(message) {
    els.status.textContent = message || "";
  }

  function setBusy(isBusy) {
    els.refresh.disabled = isBusy;
    els.refresh.textContent = isBusy ? "汇总中..." : "刷新汇总";
  }

  function renderNotebookOptions() {
    els.notebook.innerHTML = '<option value="">请选择笔记本</option>';
    for (const notebook of state.notebooks) {
      const option = document.createElement("option");
      option.value = notebook.id;
      option.textContent = notebook.name;
      els.notebook.appendChild(option);
    }
  }

  async function loadNotebooks() {
    try {
      state.notebooks = await api.listNotebooks();
      renderNotebookOptions();
      setStatus(state.notebooks.length ? "请选择笔记本和月份文档后刷新。" : "未找到可用笔记本。");
    } catch (error) {
      els.notebook.innerHTML = '<option value="">笔记本加载失败</option>';
      setStatus(error.message);
    }
  }

  async function handleRefresh(event) {
    event.preventDefault();
    els.result.innerHTML = "";

    const notebookId = els.notebook.value;
    const monthText = normalizeMonthText(els.month.value);
    const targetTitle = els.heading.value.trim() || "TODO";
    state.context = {
      notebookId,
      monthText,
      targetTitle,
    };
    state.groups = [];

    if (!notebookId) {
      setStatus("未选择笔记本。");
      return;
    }

    if (!monthText) {
      setStatus("未选择月份文档。");
      return;
    }

    setBusy(true);
    setStatus("正在读取日期文档...");

    try {
      const summary = await collectTodos(notebookId, monthText, targetTitle);

      if (summary.reason === "no-daily-docs") {
        setStatus("当前月份未找到日期文档。");
        return;
      }

      if (summary.reason === "no-todo-content") {
        setStatus(`当前月份未找到 ${targetTitle} 内容。`);
        return;
      }

      setStatus("");
      state.groups = summary.groups;
      renderGroups(summary.groups);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  function bindEvents() {
    els.form.addEventListener("submit", handleRefresh);
    els.result.addEventListener("click", handleResultClick);
    els.result.addEventListener("change", handleResultChange);
    els.result.addEventListener("focusin", handleResultFocusIn);
    els.result.addEventListener("focusout", handleResultFocusOut);
    els.result.addEventListener("keydown", handleResultKeyDown);
  }

  function init() {
    bindEvents();
    loadNotebooks();
  }

  init();
})();
