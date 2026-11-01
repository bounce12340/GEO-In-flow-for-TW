import { createHash } from 'node:crypto';
import ts from 'typescript';

export function assertIdentityTranslations(source, file = 'source.tsx') {
  const ast =
    typeof source === 'string'
      ? ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      : source;
  const methods = /^i18n\.(?:english\.)?(text|fragment|label|system|unit)$/;
  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      [
        'key',
        'value',
        'defaultValue',
        'id',
        'href',
        'className',
        'action',
        'page',
        'websiteId',
        'siteId',
        'teamId',
        'sort',
        'sortValue',
        'filter',
      ].includes(node.name.getText(ast))
    ) {
      const attributes = node.parent.properties;
      const expression =
        node.initializer && ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : undefined;
      const anonymousReadonlyDisplay =
        node.name.getText(ast) === 'value' &&
        node.parent.parent.tagName?.getText(ast) === 'Field' &&
        attributes.some(
          attr =>
            ts.isJsxAttribute(attr) &&
            attr.name.getText(ast) === 'readOnly' &&
            (!attr.initializer ||
              (ts.isJsxExpression(attr.initializer) &&
                attr.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword)),
        ) &&
        !attributes.some(
          attr =>
            ts.isJsxSpreadAttribute(attr) ||
            (ts.isJsxAttribute(attr) && ['name', 'onChange'].includes(attr.name.getText(ast))),
        ) &&
        expression &&
        ts.isCallExpression(expression) &&
        expression.expression.getText(ast) === 'i18n.text' &&
        expression.arguments.length === 1 &&
        ts.isStringLiteral(expression.arguments[0]);
      if (!anonymousReadonlyDisplay) {
        const translated = child => {
          if (ts.isCallExpression(child) && methods.test(child.expression.getText(ast)))
            throw new Error(
              `Display translation in identity attribute: ${file}:${ast.getLineAndCharacterOfPosition(child.pos).line + 1}`,
            );
          ts.forEachChild(child, translated);
        };
        translated(node);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      ['===', '!==', '==', '!='].includes(node.operatorToken.getText(ast))
    ) {
      const translated = child => {
        if (
          ts.isCallExpression(child) &&
          /^(i18n\.(text|label|system)|translateText)$/.test(child.expression.getText(ast)) &&
          ts.isStringLiteral(child.arguments[0]) &&
          /[\u3400-\u9fff]/.test(child.arguments[0].text)
        )
          throw new Error(
            `Display translation in identity comparison: ${file}:${ast.getLineAndCharacterOfPosition(child.pos).line + 1}`,
          );
        ts.forEachChild(child, translated);
      };
      translated(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}

const protectedLiterals = new Set([
  'eq.AI 搜索引荐',
  'select[aria-label="分析网站"]',
  'textarea[aria-label="分析问题"]',
]);
const matcherHelp = '按目标匹配次数排序，或选取名称匹配白皮书/download 的已配置目标。';
const preservedNames = new Set(['姚金刚', '向阳乔木']);
export function assertDisplayMetadata(metadata, sources, file = 'metadata') {
  const normalize = text => text.trim().replace(/\s+/g, ' ');
  const messages = new Set([...sources].map(normalize));
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (
      typeof value.id === 'string' &&
      /-editor$/.test(value.id) &&
      typeof value.title === 'string'
    ) {
      const editTitle = value.title.replace(/^创建/, '编辑');
      if (/[\u3400-\u9fff]/.test(editTitle) && !messages.has(normalize(editTitle)))
        throw new Error(`Missing English metadata in ${file}: ${editTitle}`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (
        ['title', 'label', 'summary'].includes(key) &&
        typeof child === 'string' &&
        /[\u3400-\u9fff]/.test(child) &&
        !messages.has(normalize(child))
      )
        throw new Error(`Missing English metadata in ${file}: ${child}`);
      visit(child);
    }
  };
  visit(metadata);
}
export function assertLanguagePair(chinese, english, directory = 'catalog') {
  if (JSON.stringify(Object.keys(chinese)) !== JSON.stringify(Object.keys(english)))
    throw new Error(`Language catalog key/order mismatch: ${directory}`);
  const tokens = text => text.match(/\{[^{}]+\}/g) || [];
  for (const [key, source] of Object.entries(chinese)) {
    const value = english[key];
    if (key !== `m_${createHash('sha256').update(source).digest('hex').slice(0, 12)}`)
      throw new Error(`Message identity changed: ${key}`);
    if (typeof value !== 'string' || !value.trim())
      throw new Error(`Empty English message: ${key}`);
    if (JSON.stringify(tokens(source)) !== JSON.stringify(tokens(value)))
      throw new Error(`Message placeholders differ: ${key}`);
    if (protectedLiterals.has(source) && value !== source)
      throw new Error(`Executable/query literal changed: ${key}`);
    if (preservedNames.has(source) && value !== source)
      throw new Error(`Personal name changed: ${key}`);
    const display =
      protectedLiterals.has(source) || preservedNames.has(source)
        ? ''
        : source === matcherHelp
          ? value.replace('白皮书', '')
          : value;
    if (/[\u3400-\u9fff]/.test(display))
      throw new Error(`Unreviewed Chinese in English message: ${key}`);
  }
}

// Simplified-only characters that must not survive in the Taiwan catalog outside preserved names.
const simplifiedOnly = /[们这网设据数为务时发实点开关内显动应让说请没对载传选种问认证码录统专业车马长门见页风飞览码输击复杂]/;
const preservedTraditional = ['北京日报社智源GEO', '猎看官网（示例数据）', '猎看科技', '猎看'];
export function assertTraditionalPair(chinese, traditional, directory = 'catalog') {
  if (JSON.stringify(Object.keys(chinese)) !== JSON.stringify(Object.keys(traditional)))
    throw new Error(`Traditional catalog key/order mismatch: ${directory}`);
  const tokens = text => text.match(/\{[^{}]+\}/g) || [];
  for (const [key, source] of Object.entries(chinese)) {
    const value = traditional[key];
    if (typeof value !== 'string' || !value.trim())
      throw new Error(`Empty Traditional Chinese message: ${key}`);
    if (JSON.stringify(tokens(source)) !== JSON.stringify(tokens(value)))
      throw new Error(`Traditional message placeholders differ: ${key}`);
    if ((protectedLiterals.has(source) || preservedNames.has(source)) && value !== source)
      throw new Error(`Protected literal changed in Traditional catalog: ${key}`);
    const display =
      protectedLiterals.has(source) || preservedNames.has(source)
        ? ''
        : preservedTraditional.reduce((text, name) => text.split(name).join(''), value);
    if (simplifiedOnly.test(display))
      throw new Error(`Simplified character in Traditional message: ${key}`);
  }
}

/** Covers explicitly owned TS metadata without executing modules or inspecting raw values. */
export function assertOwnedSourceMetadata(source, variables, sources, file = 'metadata.ts') {
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const normalize = text => text.trim().replace(/\s+/g, ' ');
  const messages = new Set([...sources].map(normalize));
  const requireMessage = node => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /[\u3400-\u9fff]/.test(node.text) &&
      !messages.has(normalize(node.text))
    )
      throw new Error(
        `Missing English owned metadata at ${file}:${ast.getLineAndCharacterOfPosition(node.pos).line + 1}: ${node.text}`,
      );
    ts.forEachChild(node, requireMessage);
  };
  const properties = (node, keys) => {
    if (
      ts.isPropertyAssignment(node) &&
      keys.includes(node.name.getText(ast).replace(/^['"]|['"]$/g, ''))
    )
      requireMessage(node.initializer);
    else ts.forEachChild(node, child => properties(child, keys));
  };
  const found = new Set();
  const visit = node => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      Object.hasOwn(variables, node.name.getText(ast))
    ) {
      const name = node.name.getText(ast);
      found.add(name);
      const keys = variables[name];
      if (keys === '*') requireMessage(node.initializer);
      else properties(node.initializer, keys);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  for (const name of Object.keys(variables))
    if (!found.has(name)) throw new Error(`Owned metadata declaration missing in ${file}: ${name}`);
}
