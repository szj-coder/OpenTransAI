(() => {
  const A = globalThis.OpenTransAIPage;
  const node = (tag, children, attrs = {}) => ({ tag, children, attrs });
  const heading = line => /^(#{1,3})\s+(.+)$/.exec(line);
  const item = line => /^(\s*)([-+*]|\d+[.)])\s+(.+)$/.exec(line);
  const fence = line => /^\s*```[^`]*$/.test(line);
  function inline(text) {
    const children = []; let start = 0;
    for (const match of text.matchAll(/(?<!\\)(\*\*([^*\n]+)\*\*|`([^`\n]+)`)/g)) {
      if (match.index > start) children.push(text.slice(start, match.index));
      children.push(node(match[2] ? 'strong' : 'code', [match[2] || match[3]])); start = match.index + match[0].length;
    }
    if (start < text.length) children.push(text.slice(start));
    return children;
  }
  const visible = children => children.map(child => typeof child === 'string' ? child : visible(child.children)).join('');
  function cells(line) {
    const raw = line.trim();
    if (!raw.startsWith('|') || !raw.endsWith('|') || raw.length < 3) return null;
    const values = []; let value = '';
    for (let i = 1; i < raw.length - 1; i++) {
      if (raw[i] === '\\' && ['|', '\\'].includes(raw[i + 1])) value += raw[++i];
      else if (raw[i] === '|') { values.push(value.trim()); value = ''; }
      else value += raw[i];
    }
    values.push(value.trim()); return values.length > 1 ? values : null;
  }
  A.imageDocument = text => {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n'), blocks = [], plain = [];
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].trim()) { i++; continue; }
      if (fence(lines[i])) {
        i++; const code = [];
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
        if (i < lines.length) i++;
        const value = code.join('\n'); blocks.push(node('pre', [node('code', [value])])); plain.push(value); continue;
      }
      const title = heading(lines[i]);
      if (title) { const content = inline(title[2]); blocks.push(node(`h${title[1].length + 1}`, content)); plain.push(visible(content)); i++; continue; }
      const first = item(lines[i]);
      if (first) {
        const ordered = /^\d/.test(first[2]), children = [], rows = [];
        while (i < lines.length) {
          const match = item(lines[i]); if (!match || /^\d/.test(match[2]) !== ordered) break;
          const content = inline(match[3]), depth = Math.min(8, Math.floor(match[1].replace(/\t/g, '  ').length / 2));
          const attrs = { style: `margin-inline-start:${depth * 16}px` };
          if (ordered) attrs.value = match[2].slice(0, -1);
          children.push(node('li', content, attrs)); rows.push(`${'  '.repeat(depth)}${ordered ? match[2] : '-'} ${visible(content)}`); i++;
        }
        blocks.push(node(ordered ? 'ol' : 'ul', children)); plain.push(rows.join('\n')); continue;
      }
      // A table needs an explicit header separator and consistent cell counts.
      // Incomplete streamed rows or ambiguous layouts fall back without dropping cells.
      if (lines[i].trim().startsWith('|')) {
        const raw = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) raw.push(lines[i++]);
        const pending = raw.length > 2 && !raw.at(-1).trim().endsWith('|') ? raw.at(-1) : null;
        const rows = (pending ? raw.slice(0, -1) : raw).map(cells), columns = rows[0]?.length;
        if (rows.length >= 2 && columns && rows.every(row => row?.length === columns) && rows[1].every(cell => /^:?-{3,}:?$/.test(cell))) {
          const values = [rows[0], ...rows.slice(2)];
          const header = node('thead', [node('tr', values[0].map(cell => node('th', inline(cell), { scope: 'col' })))]);
          const body = node('tbody', values.slice(1).map(row => node('tr', row.map(cell => node('td', inline(cell))))));
          blocks.push(node('div', [node('table', [header, body], { style: `min-width:${columns * 88}px` })], { class: 'image-table', tabindex: '0', role: 'region', 'aria-label': '图片中的表格，可左右滚动' }));
          plain.push(values.map(row => row.map(cell => visible(inline(cell))).join('\t')).join('\n'));
          // Keep completed rows mounted while the last streamed row is unfinished.
          if (pending) { blocks.push(node('p', [pending])); plain[plain.length - 1] += `\n${pending}`; }
        } else { blocks.push(node('p', [raw.join('\n')])); plain.push(raw.join('\n')); }
        continue;
      }
      const paragraph = [lines[i++]];
      while (i < lines.length && lines[i].trim() && !heading(lines[i]) && !item(lines[i]) && !fence(lines[i]) && !lines[i].trim().startsWith('|')) paragraph.push(lines[i++]);
      const content = inline(paragraph.join('\n')); blocks.push(node('p', content)); plain.push(visible(content));
    }
    return { blocks, plain: plain.join('\n\n') };
  };
  function sync(parent, descriptions) {
    descriptions.forEach((description, index) => {
      let current = parent.childNodes[index];
      if (typeof description === 'string') {
        if (current?.nodeType !== 3) {
          const next = document.createTextNode(description);
          if (current) current.replaceWith(next); else parent.append(next);
        } else if (current.data !== description) {
          if (description.startsWith(current.data)) current.appendData(description.slice(current.data.length));
          else current.data = description;
        }
        return;
      }
      if (current?.nodeName.toLowerCase() !== description.tag) {
        const next = document.createElement(description.tag);
        if (current) current.replaceWith(next); else parent.append(next);
        current = next;
      }
      // All tags and attribute names/values originate in this parser, never HTML from the model.
      for (const attr of [...current.attributes]) if (!(attr.name in description.attrs)) current.removeAttribute(attr.name);
      for (const [name, value] of Object.entries(description.attrs)) if (current.getAttribute(name) !== value) current.setAttribute(name, value);
      sync(current, description.children);
    });
    while (parent.childNodes.length > descriptions.length) parent.lastChild.remove();
  }
  A.createImageRenderer = container => {
    let previous, plain = '';
    return text => {
      if (text !== previous) { const result = A.imageDocument(text); sync(container, result.blocks); previous = text; plain = result.plain; }
      return plain;
    };
  };
})();
