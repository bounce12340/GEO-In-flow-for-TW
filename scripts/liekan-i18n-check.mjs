import {
  assertDisplayMetadata,
  assertIdentityTranslations,
  assertLanguagePair,
  assertOwnedSourceMetadata,
  assertTraditionalPair,
} from './liekan-i18n-contract.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const roots = ['messages', 'help-messages'];
const messages = new Map();
const coreMessages = new Map();
const normalize = text => text.trim().replace(/\s+/g, ' ');
for (const directory of roots) {
  const chinese = JSON.parse(readFileSync(`src/lib/liekan/i18n/${directory}/zh-CN.json`, 'utf8'));
  const english = JSON.parse(readFileSync(`src/lib/liekan/i18n/${directory}/en-US.json`, 'utf8'));
  const traditional = JSON.parse(
    readFileSync(`src/lib/liekan/i18n/${directory}/zh-TW.json`, 'utf8'),
  );
  assertLanguagePair(chinese, english, directory);
  assertTraditionalPair(chinese, traditional, directory);
  for (const [key, source] of Object.entries(chinese)) {
    messages.set(normalize(source), key);
    if (directory === 'messages') coreMessages.set(normalize(source), key);
  }
}
for (const file of [
  'src/lib/liekan/contracts/feature-pages.json',
  'config/liekan/navigation-ui.json',
])
  assertDisplayMetadata(JSON.parse(readFileSync(file, 'utf8')), messages.keys(), file);
const ownedMetadata = {
  'src/components/liekan/data.ts': { pages: ['title', 'actions', 'group'] },
  'src/lib/liekan/contracts/navigation.ts': {
    globalNavigation: ['label', 'sectionLabel'],
    websiteNavigation: ['label', 'sectionLabel'],
    websiteAnalysisTabs: ['label'],
    accountNavigation: ['label'],
    adminNavigation: ['label'],
  },
  'src/lib/liekan/contracts/product.ts': {
    liekanFooterLinks: ['label'],
    liekanProjectInitiators: ['description'],
  },
  'src/lib/liekan/contracts/management.ts': { managementLabels: '*' },
  'src/lib/liekan/contracts/workspace.ts': { workspaceRoleLabels: '*' },
  'src/lib/liekan/contracts/team-users.ts': { teamUserRoleChoices: '*' },
  'src/lib/liekan/contracts/installation.ts': { logMethodLabels: '*' },
  'src/lib/liekan/ai/templates.ts': { AI_TEMPLATES: ['notes', 'region'] },
  'src/components/liekan/features/AiChatHome.tsx': { prompts: '*' },
};
for (const [file, variables] of Object.entries(ownedMetadata))
  assertOwnedSourceMetadata(readFileSync(file, 'utf8'), variables, coreMessages.keys(), file);
const visit = directory =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? visit(file) : [file];
  });
for (const file of [...visit('src/components/liekan'), 'src/lib/liekan/i18n/text.ts'].filter(
  file => /\.tsx?$/.test(file) && !/\.(test|spec)\./.test(file),
)) {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function check(node) {
    if (
      ts.isCallExpression(node) &&
      /^(?:i18n\.(?:english\.)?(?:text|fragment|label|unit|system)|translate(?:Text|SystemText))$/.test(
        node.expression.getText(ast),
      ) &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const text = normalize(node.arguments[0].text);
      if (
        /[\u3400-\u9fff]/.test(text) &&
        !(file.endsWith('/HelpCenter.tsx') ? messages : coreMessages).has(text)
      )
        throw new Error(
          `Missing English message at ${file}:${ast.getLineAndCharacterOfPosition(node.pos).line + 1}: ${text}`,
        );
    }

    ts.forEachChild(node, check);
  }
  check(ast);
  assertIdentityTranslations(ast, file);
}
console.log(
  `Liekan zh-TW/zh-CN/en-US catalogs passed: ${messages.size} messages, placeholders and executable literals preserved.`,
);
