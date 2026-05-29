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

    async listDocsByPath(notebookId, path) {
      const data = await postApi("/filetree/listDocsByPath", {
        notebook: notebookId,
        path,
        sort: 0,
        maxListCount: 1024,
      });
      return data && data.files ? data.files : [];
    },

    async sql(statement) {
      return (await postApi("/query/sql", { stmt: statement })) || [];
    },

    async getChildBlocks(blockId) {
      return (await postApi("/block/getChildBlocks", { id: blockId })) || [];
    },
  };

  function normalizeDocPath(value) {
    const path = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return path ? `/${path}` : "";
  }

  function sqlText(value) {
    return String(value).replace(/'/g, "''");
  }

  function stripSySuffix(name) {
    return String(name || "").replace(/\.sy$/i, "");
  }

  function isDailyDoc(doc, monthText) {
    const title = stripSySuffix(doc.name || doc.hPath || doc.path || "");
    const escapedMonth = monthText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escapedMonth}-\\d{2}\\b`).test(title);
  }

  function compareDailyDoc(a, b) {
    return stripSySuffix(b.name).localeCompare(stripSySuffix(a.name), "zh-Hans");
  }

  async function findHeadingBlocks(dateDoc, targetTitle) {
    const rootId = sqlText(dateDoc.id);
    const title = sqlText(targetTitle);
    return api.sql(
      "select id, root_id, content, markdown from blocks " +
        `where root_id = '${rootId}' and type = 'h' ` +
        `and (content = '${title}' or markdown = '${title}') order by sort`
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

  function flattenTodoItems(blocks, parentIsUnorderedList) {
    const items = [];

    for (const block of blocks) {
      const isList = block.type === "l";
      const isUnorderedList = isList && (block.subType === "u" || block.subtype === "u");
      const isListItem = block.type === "i";
      const text = textFromBlock(block);

      if (isListItem && parentIsUnorderedList && text) {
        items.push({
          id: block.id,
          text,
          task: true,
        });
      } else if (!isList && !isListItem && text) {
        items.push({
          id: block.id,
          text,
          task: false,
        });
      }

      items.push(...flattenTodoItems(block.children || [], isUnorderedList));
    }

    return items;
  }

  async function collectTodos(notebookId, monthPath, targetTitle) {
    const monthText = monthPath.split("/").pop();
    const docs = (await api.listDocsByPath(notebookId, monthPath))
      .filter((doc) => doc.id && isDailyDoc(doc, monthText))
      .sort(compareDailyDoc);

    if (!docs.length) {
      return { reason: "no-daily-docs", groups: [] };
    }

    const groups = [];
    for (const doc of docs) {
      const headings = await findHeadingBlocks(doc, targetTitle);
      const items = [];

      for (const heading of headings) {
        const children = await readBlockTree(heading.id, 6);
        items.push(...flattenTodoItems(children, false));
      }

      if (items.length) {
        groups.push({
          doc,
          title: stripSySuffix(doc.name),
          items,
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

  function renderGroups(groups) {
    els.result.innerHTML = groups
      .map((group) => {
        const tasks = group.items
          .map((item) => {
            const marker = item.task ? '<input type="checkbox" disabled /> ' : "";
            return `<li>${marker}<a href="${blockLink(item.id)}" title="打开原块">${escapeHtml(item.text)}</a></li>`;
          })
          .join("");

        return `
          <article class="day">
            <h2 class="day__title">
              <span>${escapeHtml(group.title)}</span>
              <a href="${blockLink(group.doc.id)}" title="打开日记文档">打开</a>
            </h2>
            <ul class="tasks">${tasks}</ul>
          </article>
        `;
      })
      .join("");
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
    const monthPath = normalizeDocPath(els.month.value);
    const targetTitle = els.heading.value.trim() || "TODO";

    if (!notebookId) {
      setStatus("未选择笔记本。");
      return;
    }

    if (!monthPath) {
      setStatus("未选择月份文档。");
      return;
    }

    setBusy(true);
    setStatus("正在读取日期文档...");

    try {
      const summary = await collectTodos(notebookId, monthPath, targetTitle);

      if (summary.reason === "no-daily-docs") {
        setStatus("当前月份未找到日期文档。");
        return;
      }

      if (summary.reason === "no-todo-content") {
        setStatus(`当前月份未找到 ${targetTitle} 内容。`);
        return;
      }

      setStatus("");
      renderGroups(summary.groups);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  function bindEvents() {
    els.form.addEventListener("submit", handleRefresh);
  }

  function init() {
    bindEvents();
    loadNotebooks();
  }

  init();
})();
